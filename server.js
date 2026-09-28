import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { SCHEMA, sql, publicQuiz, isDone, questionScore, timeLeft } from './lib.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/quiz.js': ['quiz.js', 'text/javascript; charset=utf-8'],
  '/quiz.css': ['quiz.css', 'text/css; charset=utf-8'],
  '/fonts/InclusiveSans.woff2': ['fonts/InclusiveSans-VariableFont_wght.woff2', 'font/woff2'],
  '/fonts/RobotoMono.woff2': ['fonts/RobotoMono-VariableFont_wght.woff2', 'font/woff2'],
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw httpError(413, 'Requête trop grande');
  }
  return body;
}

async function readJson(req) {
  const body = await readBody(req);
  try {
    return JSON.parse(body) || {};
  } catch {
    throw httpError(400, 'JSON invalide');
  }
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

const closedError = (session) => httpError(403, session ? 'Le quiz est fermé' : 'Le quiz n\'est pas encore ouvert');

// Le navigateur reçoit les questions seulement quand le formateur a ouvert le quiz pour le groupe
async function getQuiz(res, id, group) {
  const [[row], [session]] = await sql(
    ['SELECT data FROM quizzes WHERE id = ?', id],
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', id, group],
  );
  if (!row) return json(res, 404, { error: 'Quiz introuvable' });
  const quiz = publicQuiz(JSON.parse(row.data));
  const status = session?.status || 'waiting';
  json(res, 200, status === 'open' ? { status, ...quiz } : { status, title: quiz.title });
}

async function start(res, body) {
  const name = clean(body.name, 60);
  const group = clean(body.group, 40);
  if (!name || !group || typeof body.quiz !== 'string') return json(res, 400, { error: 'Nom, groupe et quiz requis' });
  const [[session]] = await sql(['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', body.quiz, group]);
  if (session?.status !== 'open') throw closedError(session);
  const run = randomUUID();
  await sql(['INSERT INTO runs (id, quiz, group_name, name) VALUES (?, ?, ?, ?)', run, body.quiz, group, name]);
  json(res, 200, { run });
}

// Une question d'un passage, ses réponses et l'heure de son premier affichage. Refusé si le quiz est fermé.
async function load(run, question) {
  const [[row], rows, [seen]] = await sql(
    [`SELECT q.data, s.status FROM runs r JOIN quizzes q ON q.id = r.quiz
      LEFT JOIN sessions s ON s.quiz = r.quiz AND s.group_name = r.group_name WHERE r.id = ?`, run],
    ['SELECT choice, correct FROM answers WHERE run_id = ? AND question_id = ? ORDER BY id', run, question],
    ['SELECT shown_at FROM shown WHERE run_id = ? AND question_id = ?', run, question],
  );
  if (!row) throw httpError(404, 'Passage inconnu');
  if (row.status !== 'open') throw closedError(row.status);
  const q = JSON.parse(row.data).questions.find((x) => x.id === question);
  if (!q) throw httpError(400, 'Question inconnue');
  return { q, rows, shownAt: seen?.shown_at ?? null };
}

// Le chrono d'une question minutée part au premier appel. Un rechargement ne le remet pas à zéro.
// ponytail: le navigateur reçoit toutes les questions au départ et c'est lui qui démarre le chrono.
// Un élève qui écrit ses propres requêtes peut répondre sans chrono. Servir les questions une par une si ça compte.
async function show(res, { run, question }) {
  const { q, rows, shownAt } = await load(run, question);
  if (!q.timeLimit || shownAt !== null) return json(res, 200, outcome(q, rows, shownAt));
  const now = Date.now();
  await sql(['INSERT OR IGNORE INTO shown (run_id, question_id, shown_at) VALUES (?, ?, ?)', run, question, now]);
  json(res, 200, outcome(q, rows, now));
}

// Le serveur corrige : la bonne réponse et l'explication partent seulement quand la question est finie.
// Une question finie renvoie son résultat enregistré, sans nouvelle réponse.
async function answer(res, { run, question, choice }) {
  const { q, rows, shownAt } = await load(run, question);
  if (!q.options.some((o) => o.id === choice)) throw httpError(400, 'Réponse invalide');
  if (!isDone(rows, q.options.length, timeLeft(q, shownAt)) && !rows.some((r) => r.choice === choice)) {
    const correct = choice === q.correctAnswer ? 1 : 0;
    await sql(['INSERT OR IGNORE INTO answers (run_id, question_id, choice, correct) VALUES (?, ?, ?, ?)', run, question, choice, correct]);
    rows.push({ choice, correct });
  }
  json(res, 200, outcome(q, rows, shownAt));
}

// { wrong, done }, plus `left` (ms restantes) pendant le chrono, plus le résultat une fois la question finie
function outcome(q, rows, shownAt) {
  const left = timeLeft(q, shownAt);
  const done = isDone(rows, q.options.length, left);
  return {
    wrong: rows.filter((r) => !r.correct).map((r) => r.choice),
    done,
    ...(!done && left !== null && { left }),
    ...(done && {
      score: questionScore(rows),
      timeUp: !isDone(rows, q.options.length),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || '',
    }),
  };
}

// Après un rechargement : l'état de chaque question du passage
async function resume(res, run) {
  const [[row], rows, seen] = await sql(
    ['SELECT q.data FROM runs r JOIN quizzes q ON q.id = r.quiz WHERE r.id = ?', run],
    ['SELECT question_id, choice, correct FROM answers WHERE run_id = ? ORDER BY id', run],
    ['SELECT question_id, shown_at FROM shown WHERE run_id = ?', run],
  );
  if (!row) return json(res, 404, { error: 'Passage inconnu' });
  const byQuestion = Map.groupBy(rows, (r) => r.question_id);
  const shownAt = new Map(seen.map((s) => [s.question_id, s.shown_at]));
  const { questions } = JSON.parse(row.data);
  json(res, 200, Object.fromEntries(questions.map((q) => [q.id, outcome(q, byQuestion.get(q.id) || [], shownAt.get(q.id) ?? null)])));
}

// Page du formateur, protégée par l'authentification du navigateur (seul le mot de passe compte).
const digest = (s) => createHash('sha256').update(s).digest();

function authorized(header = '') {
  const [scheme, encoded = ''] = header.split(' ');
  if (scheme !== 'Basic') return false;
  const password = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
  return timingSafeEqual(digest(password), digest(process.env.PROF_PASSWORD));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n) => n.toLocaleString('fr-FR');
const when = (utc) =>
  new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
const origin = (req) =>
  `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const page = (title, body) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Carnet</title><link rel="stylesheet" href="/quiz.css"></head>
<body><div class="column"><header class="topbar"><span class="brand">Carnet</span><strong>${esc(title)}</strong></header>
${body}</div></body></html>`;

// Refuse sans mot de passe. Renvoie false si la réponse est déjà partie.
function guard(req, res) {
  if (!process.env.PROF_PASSWORD) {
    json(res, 503, { error: 'PROF_PASSWORD manquant' });
    return false;
  }
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Suivi des quiz", charset="UTF-8"' });
    res.end('Mot de passe requis.');
    return false;
  }
  return true;
}

const STATUS = {
  waiting: ['Pas encore ouvert : les élèves qui ont le lien attendent sur la page du quiz.', 'open', 'Ouvrir le quiz'],
  open: ['Ouvert : les élèves peuvent commencer et répondre.', 'closed', 'Fermer le quiz'],
  closed: ['Fermé : les élèves ne peuvent plus commencer ni répondre.', 'open', 'Rouvrir le quiz'],
};

async function prof(req, res, params) {
  if (!guard(req, res)) return;
  const quizId = params.get('quiz') || '';
  const group = clean(params.get('groupe'), 40);
  const [quizzes, sessions] = await sql(
    ['SELECT id, title FROM quizzes ORDER BY id'],
    [`SELECT s.quiz, s.group_name, s.status, COUNT(r.id) AS n FROM sessions s
      LEFT JOIN runs r ON r.quiz = s.quiz AND r.group_name = s.group_name
      GROUP BY s.quiz, s.group_name, s.status, s.created_at ORDER BY s.created_at DESC`],
  );
  const titles = new Map(quizzes.map((q) => [q.id, q.title]));

  let body = `<form class="pick" method="get" action="/prof">
<label>Quiz <select name="quiz">${quizzes.map((q) => `<option value="${esc(q.id)}"${q.id === quizId ? ' selected' : ''}>${esc(q.title)}</option>`).join('')}</select></label>
<label>Groupe <input name="groupe" value="${esc(group)}" required maxlength="40"></label>
<button class="button">Voir le lien et les résultats</button></form>`;

  if (titles.has(quizId) && group) body += await results(req, quizId, group);

  if (sessions.length) {
    body += `<h2>Groupes</h2><ul class="sessions">${sessions
      .map((s) => `<li><a href="/prof?quiz=${encodeURIComponent(s.quiz)}&amp;groupe=${encodeURIComponent(s.group_name)}">${esc(titles.get(s.quiz) || s.quiz)}, groupe ${esc(s.group_name)}</a> : ${s.status === 'open' ? 'ouvert' : 'fermé'}, ${s.n} passage${s.n > 1 ? 's' : ''}</li>`)
      .join('')}</ul>`;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page('Suivi des quiz', body));
}

// Boutons Ouvrir et Fermer. Un autre site ne peut pas envoyer ce formulaire avec le mot de passe mémorisé.
async function setStatus(req, res) {
  if (!guard(req, res)) return;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') throw httpError(403, 'Formulaire refusé');
  const form = new URLSearchParams(await readBody(req));
  const quiz = form.get('quiz') || '';
  const group = clean(form.get('groupe'), 40);
  const status = form.get('status');
  if (!group || !['open', 'closed'].includes(status)) throw httpError(400, 'Formulaire invalide');
  const [found] = await sql(['SELECT 1 FROM quizzes WHERE id = ?', quiz]);
  if (!found.length) throw httpError(404, 'Quiz introuvable');
  await sql([
    'INSERT INTO sessions (quiz, group_name, status) VALUES (?, ?, ?) ON CONFLICT (quiz, group_name) DO UPDATE SET status = excluded.status',
    quiz, group, status,
  ]);
  res.writeHead(303, { Location: `/prof?quiz=${encodeURIComponent(quiz)}&groupe=${encodeURIComponent(group)}` });
  res.end();
}

async function results(req, quizId, group) {
  const [[row], [session], runs, answers, seen] = await sql(
    ['SELECT data FROM quizzes WHERE id = ?', quizId],
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', quizId, group],
    ['SELECT id, name, started_at FROM runs WHERE quiz = ? AND group_name = ? ORDER BY name COLLATE NOCASE, started_at', quizId, group],
    [`SELECT a.run_id, a.question_id, a.correct FROM answers a JOIN runs r ON r.id = a.run_id
      WHERE r.quiz = ? AND r.group_name = ? ORDER BY a.id`, quizId, group],
    [`SELECT s.run_id, s.question_id, s.shown_at FROM shown s JOIN runs r ON r.id = s.run_id
      WHERE r.quiz = ? AND r.group_name = ?`, quizId, group],
  );
  const { title, questions } = JSON.parse(row.data);
  const link = `${origin(req)}/?quiz=${encodeURIComponent(quizId)}&groupe=${encodeURIComponent(group)}`;
  const [statusText, nextStatus, buttonText] = STATUS[session?.status || 'waiting'];
  const byRun = Map.groupBy(answers, (a) => `${a.run_id} ${a.question_id}`);
  const shownAt = new Map(seen.map((s) => [`${s.run_id} ${s.question_id}`, s.shown_at]));
  // null : question pas encore finie
  const grid = runs.map((r) =>
    questions.map((q) => {
      const key = `${r.id} ${q.id}`;
      const rows = byRun.get(key) || [];
      return isDone(rows, q.options.length, timeLeft(q, shownAt.get(key) ?? null)) ? questionScore(rows) : null;
    }),
  );
  const success = questions.map((_, i) => {
    const done = grid.map((cells) => cells[i]).filter((s) => s !== null);
    return done.length ? `${Math.round((100 * done.reduce((a, b) => a + b, 0)) / done.length)} %` : '';
  });

  const now = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });

  return `<h2>${esc(title)}, groupe ${esc(group)}</h2>
<p>Lien à donner aux élèves : <a href="${esc(link)}">${esc(link)}</a></p>
<form class="status-form" method="post" action="/prof">
<input type="hidden" name="quiz" value="${esc(quizId)}"><input type="hidden" name="groupe" value="${esc(group)}">
<p class="status-line">${statusText}</p>
<button class="button" name="status" value="${nextStatus}">${buttonText}</button></form>
<div id="live">
<p class="meta">Mis à jour à ${now}. La page se met à jour toute seule toutes les 5 secondes.</p>
${runs.length ? `<div class="table-scroll"><table class="results">
<thead><tr><th scope="col">Nom</th><th scope="col">Début</th><th scope="col">Score</th>${questions.map((q, i) => `<th scope="col" title="${esc(q.question)}">${i + 1}</th>`).join('')}</tr></thead>
<tbody>${runs
    .map((r, i) => {
      const cells = grid[i];
      const total = cells.reduce((a, b) => a + (b ?? 0), 0);
      return `<tr><th scope="row">${esc(r.name)}</th><td>${when(r.started_at)}</td><td>${num(total)} / ${questions.length}</td>${cells.map((s) => `<td>${s === null ? '' : num(s)}</td>`).join('')}</tr>`;
    })
    .join('')}</tbody>
<tfoot><tr><th scope="row">Réussite</th><td></td><td></td>${success.map((s) => `<td>${s}</td>`).join('')}</tr></tfoot>
</table></div>
<p class="meta">1 : juste au premier essai. 0,5 : au deuxième. 0 : ensuite ou temps écoulé. Case vide : pas encore répondu. Une ligne par passage : un élève qui recommence apparaît deux fois.</p>`
    : '<p>Aucun passage pour l\'instant.</p>'}
</div>
<details><summary>Les questions</summary><ol>${questions.map((q) => `<li>${esc(q.question)}${q.timeLimit ? ` (${q.timeLimit} s)` : ''}</li>`).join('')}</ol></details>
<script>
setInterval(async () => {
  if (document.hidden) return;
  // URL absolue : une page ouverte avec le mot de passe dans l'adresse refuse un fetch relatif
  const html = await fetch(location.origin + location.pathname + location.search).then((r) => r.text()).catch(() => '');
  const live = new DOMParser().parseFromString(html, 'text/html').getElementById('live');
  if (live) document.getElementById('live').replaceWith(live);
}, 5000);
</script>`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type === 'font/woff2' ? 'public, max-age=604800' : 'no-cache' });
    return res.end(await readFile(new URL(`public/${file}`, import.meta.url)));
  }
  if (req.method === 'GET' && path.startsWith('/api/quiz/'))
    return getQuiz(res, decodeURIComponent(path.slice(10)), clean(url.searchParams.get('groupe'), 40));
  if (req.method === 'GET' && path.startsWith('/api/run/')) return resume(res, decodeURIComponent(path.slice(9)));
  if (req.method === 'POST' && path === '/api/start') return start(res, await readJson(req));
  if (req.method === 'POST' && path === '/api/show') return show(res, await readJson(req));
  if (req.method === 'POST' && path === '/api/answer') return answer(res, await readJson(req));
  if (req.method === 'GET' && path === '/prof') return prof(req, res, url.searchParams);
  if (req.method === 'POST' && path === '/prof') return setStatus(req, res);
  json(res, 404, { error: 'Introuvable' });
}

await sql(...SCHEMA);
const port = Number(process.env.PORT) || 3000;
createServer((req, res) =>
  handle(req, res).catch((err) => {
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Erreur du serveur' });
  }),
).listen(port, () => console.log(`Quiz sur http://localhost:${port}, suivi sur /prof`));
