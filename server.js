import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  SCHEMA,
  SKIP,
  isCorrect,
  isDone,
  parseValue,
  publicQuiz,
  questionScore,
  quizOutline,
  readQuiz,
  rosterNames,
  sameAnswer, solution,
  sql,
  timeLeft,
} from './lib.js';
import { prof } from './prof.js';
import { clean, httpError, json, readJson } from './web.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/quiz.js': ['quiz.js', 'text/javascript; charset=utf-8'],
  '/suivi.js': ['suivi.js', 'text/javascript; charset=utf-8'],
  '/roulette.js': ['roulette.js', 'text/javascript; charset=utf-8'],
  '/roulette-draw.js': ['roulette-draw.js', 'text/javascript; charset=utf-8'],
  '/equipes.js': ['equipes.js', 'text/javascript; charset=utf-8'],
  '/equipes-draw.js': ['equipes-draw.js', 'text/javascript; charset=utf-8'],
  '/quiz.css': ['quiz.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/exemple.json': ['exemple.json', 'application/json; charset=utf-8'],
  '/fonts/InclusiveSans.woff2': ['fonts/InclusiveSans-VariableFont_wght.woff2', 'font/woff2'],
  '/fonts/RobotoMono.woff2': ['fonts/RobotoMono-VariableFont_wght.woff2', 'font/woff2'],
};

const closedError = (status) => httpError(403, status ? 'Le quiz est fermé' : 'Le quiz n\'est pas encore ouvert');

// Avant l'ouverture, le navigateur reçoit le titre et la forme du quiz, sans le texte des questions.
// Après la fermeture, les questions restent lisibles pour relire ses réponses.
async function getQuiz(res, id, group) {
  const [[row], [session], [roster], claims] = await sql(
    ['SELECT data FROM quizzes WHERE id = ?', id],
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', id, group],
    ['SELECT names FROM rosters WHERE group_name = ?', group],
    ['SELECT name FROM claims WHERE quiz = ? AND group_name = ?', id, group],
  );
  if (!row) return json(res, 404, { error: 'Quiz introuvable' });
  const quiz = readQuiz(row.data);
  const status = session?.status || 'waiting';
  json(res, 200, {
    status,
    names: rosterNames(roster),
    taken: claims.map((c) => c.name),
    ...(status === 'waiting' ? quizOutline(quiz) : publicQuiz(quiz)),
  });
}

async function start(res, body) {
  const name = clean(body.name, 60);
  const group = clean(body.group, 40);
  if (!name || !group || typeof body.quiz !== 'string') return json(res, 400, { error: 'Nom, groupe et quiz requis' });
  const [[session], [roster]] = await sql(
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', body.quiz, group],
    ['SELECT names FROM rosters WHERE group_name = ?', group],
  );
  if (session?.status !== 'open') throw closedError(session);
  const run = randomUUID();
  if (!roster) {
    await sql(['INSERT INTO runs (id, quiz, group_name, name) VALUES (?, ?, ?, ?)', run, body.quiz, group, name]);
    return json(res, 200, { run, name });
  }
  if (!rosterNames(roster).includes(name)) throw httpError(400, 'Choisissez votre nom dans la liste');
  // Le nom revient au premier qui le prend. L'appareil qui le détient peut recommencer : il envoie son passage
  // précédent (`previous`). Chaque instruction est atomique, deux élèves qui cliquent ensemble ne l'ont pas tous les deux.
  const [, , [claim]] = await sql(
    [`INSERT INTO claims (quiz, group_name, name, run_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (quiz, group_name, name) DO UPDATE SET run_id = excluded.run_id WHERE claims.run_id = ?`,
    body.quiz, group, name, run, typeof body.previous === 'string' ? body.previous : null],
    [`INSERT INTO runs (id, quiz, group_name, name) SELECT ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM claims WHERE quiz = ? AND group_name = ? AND name = ? AND run_id = ?)`,
    run, body.quiz, group, name, body.quiz, group, name, run],
    ['SELECT run_id FROM claims WHERE quiz = ? AND group_name = ? AND name = ?', body.quiz, group, name],
  );
  if (claim?.run_id !== run) throw httpError(409, 'Ce nom est déjà pris. Si c\'est le vôtre, demandez au formateur de le libérer');
  json(res, 200, { run, name });
}

// Une question d'un passage : ses réponses, l'heure de son premier affichage et la note du formateur.
// Refusé si le quiz est fermé.
async function load(run, question) {
  const [[row], rows, [seen], [grade]] = await sql(
    [`SELECT q.data, s.status FROM runs r JOIN quizzes q ON q.id = r.quiz
      LEFT JOIN sessions s ON s.quiz = r.quiz AND s.group_name = r.group_name WHERE r.id = ?`, run],
    ['SELECT choice, correct FROM answers WHERE run_id = ? AND question_id = ? ORDER BY id', run, question],
    ['SELECT shown_at FROM shown WHERE run_id = ? AND question_id = ?', run, question],
    ['SELECT score FROM grades WHERE run_id = ? AND question_id = ?', run, question],
  );
  if (!row) throw httpError(404, 'Passage inconnu');
  if (row.status !== 'open') throw closedError(row.status);
  const q = readQuiz(row.data).questions.find((x) => x.id === question);
  if (!q) throw httpError(400, 'Question inconnue');
  return { q, rows, shownAt: seen?.shown_at ?? null, grade: grade?.score ?? null };
}

// Le chrono d'une question minutée part au premier appel. Un rechargement ne le remet pas à zéro.
// ponytail: le navigateur reçoit toutes les questions au départ et c'est lui qui démarre le chrono.
// Un élève qui écrit ses propres requêtes peut répondre sans chrono. Servir les questions une par une si ça compte.
async function show(res, { run, question }) {
  const { q, rows, shownAt, grade } = await load(run, question);
  if (!q.timeLimit || shownAt !== null) return json(res, 200, outcome(q, rows, shownAt, grade));
  const now = Date.now();
  await sql(['INSERT OR IGNORE INTO shown (run_id, question_id, shown_at) VALUES (?, ?, ?)', run, question, now]);
  json(res, 200, outcome(q, rows, now, grade));
}

// Le serveur corrige : la bonne réponse et l'explication partent seulement quand la question est finie.
// Une réponse déjà essayée ou une question finie renvoie l'état enregistré, sans nouvel essai.
async function answer(res, { run, question, value, skip }) {
  const { q, rows, shownAt, grade } = await load(run, question);
  const choice = skip === true ? SKIP : parseValue(q, value);
  if (choice === null) throw httpError(400, 'Réponse invalide');
  if (!isDone(q, rows, timeLeft(q, shownAt)) && !rows.some((r) => sameAnswer(q, r.choice, choice))) {
    const correct = choice !== SKIP && isCorrect(q, choice) ? 1 : 0;
    await sql(['INSERT OR IGNORE INTO answers (run_id, question_id, choice, correct) VALUES (?, ?, ?, ?)', run, question, choice, correct]);
    rows.push({ choice, correct });
  }
  json(res, 200, outcome(q, rows, shownAt, grade));
}

// Pendant une question, le navigateur signale chaque sortie de la page, le retour avec sa durée en ms,
// et chaque copie ou collage qu'il a bloqué. Le formateur voit les totaux dans les résultats.
// ponytail: les compteurs viennent du navigateur. Un élève qui bloque ces requêtes ne laisse pas de trace, un téléphone non plus.
// Si ça compte, mesurer aussi côté serveur le temps entre l'affichage d'une question et la réponse.
const KINDS = ['leave', 'back', 'copy', 'paste'];
async function signal(res, { run, question, kind, ms }) {
  if (!KINDS.includes(kind)) throw httpError(400, 'Signal inconnu');
  await load(run, question);
  const away = kind === 'back' ? Math.min(Math.max(Math.round(ms) || 0, 0), 3_600_000) : 0;
  await sql([
    `INSERT INTO signals (run_id, question_id, leaves, away_ms, copies, pastes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, question_id) DO UPDATE SET leaves = leaves + excluded.leaves, away_ms = away_ms + excluded.away_ms,
     copies = copies + excluded.copies, pastes = pastes + excluded.pastes`,
    run, question, Number(kind === 'leave'), away, Number(kind === 'copy'), Number(kind === 'paste'),
  ]);
  json(res, 200, {});
}

// { tries, done }, plus `left` (ms restantes) pendant le chrono, plus la correction une fois la question finie.
// score vaut null pour une réponse rédigée pas encore notée.
function outcome(q, rows, shownAt, grade = null) {
  const left = timeLeft(q, shownAt);
  const done = isDone(q, rows, left);
  const tries = rows.filter((r) => r.choice !== SKIP).map((r) => ({ value: r.choice, correct: Boolean(r.correct) }));
  if (!done) return { tries, done, ...(left !== null && { left }) };
  return {
    tries,
    done,
    score: questionScore(q, rows, grade),
    skipped: rows.some((r) => r.choice === SKIP),
    timeUp: !isDone(q, rows),
    solution: solution(q),
    explanation: q.explanation || '',
  };
}

// Après un rechargement ou au retour sur le lien : le nom et l'état de chaque question du passage
async function resume(res, run) {
  const [[row], rows, seen, grades] = await sql(
    ['SELECT r.name, q.data FROM runs r JOIN quizzes q ON q.id = r.quiz WHERE r.id = ?', run],
    ['SELECT question_id, choice, correct FROM answers WHERE run_id = ? ORDER BY id', run],
    ['SELECT question_id, shown_at FROM shown WHERE run_id = ?', run],
    ['SELECT question_id, score FROM grades WHERE run_id = ?', run],
  );
  if (!row) return json(res, 404, { error: 'Passage inconnu' });
  const byQuestion = Map.groupBy(rows, (r) => r.question_id);
  const shownAt = new Map(seen.map((s) => [s.question_id, s.shown_at]));
  const graded = new Map(grades.map((g) => [g.question_id, g.score]));
  const { questions } = readQuiz(row.data);
  json(res, 200, {
    name: row.name,
    questions: Object.fromEntries(questions.map((q) =>
      [q.id, outcome(q, byQuestion.get(q.id) || [], shownAt.get(q.id) ?? null, graded.get(q.id) ?? null)])),
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type === 'font/woff2' ? 'public, max-age=604800' : 'no-cache' });
    return res.end(await readFile(new URL(`public/${file}`, import.meta.url)));
  }
  if (path === '/prof' || path.startsWith('/prof/')) return prof(req, res, url);
  if (req.method === 'GET' && path.startsWith('/api/quiz/'))
    return getQuiz(res, decodeURIComponent(path.slice(10)), clean(url.searchParams.get('groupe'), 40));
  if (req.method === 'GET' && path.startsWith('/api/run/')) return resume(res, decodeURIComponent(path.slice(9)));
  if (req.method === 'POST' && path === '/api/start') return start(res, await readJson(req));
  if (req.method === 'POST' && path === '/api/show') return show(res, await readJson(req));
  if (req.method === 'POST' && path === '/api/answer') return answer(res, await readJson(req));
  if (req.method === 'POST' && path === '/api/signal') return signal(res, await readJson(req));
  json(res, 404, { error: 'Introuvable' });
}

await sql(...SCHEMA);
const port = Number(process.env.PORT) || 3001;
createServer((req, res) =>
  handle(req, res).catch((err) => {
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Erreur du serveur' });
  }),
).listen(port, () => console.log(`Quiz sur http://localhost:${port}, suivi sur /prof`));
