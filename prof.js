// Pages du formateur : lancer un quiz, l'ouvrir et le fermer, suivre et noter les réponses, importer un quiz.
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql, readQuiz, normalize, validate, saveQuiz, quizId, isDone, questionScore, timeLeft, plain, SKIP } from './lib.js';
import { httpError, json, readBody, clean, esc } from './web.js';

const digest = (s) => createHash('sha256').update(s).digest();

// Authentification du navigateur : seul le mot de passe compte
function authorized(header = '') {
  const [scheme, encoded = ''] = header.split(' ');
  if (scheme !== 'Basic') return false;
  const password = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
  return timingSafeEqual(digest(password), digest(process.env.PROF_PASSWORD));
}

export async function prof(req, res, url) {
  if (!process.env.PROF_PASSWORD) return json(res, 503, { error: 'PROF_PASSWORD manquant' });
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Suivi des quiz", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Mot de passe requis.');
  }
  const path = url.pathname;
  const params = url.searchParams;
  if (req.method === 'GET' && path === '/prof') {
    const group = clean(params.get('groupe'), 40);
    return params.get('quiz') && group ? session(req, res, params.get('quiz'), group) : dashboard(res, params);
  }
  if (req.method === 'GET' && path === '/prof/export.csv') return exportCsv(res, params.get('quiz') || '', clean(params.get('groupe'), 40));
  if (req.method !== 'POST') throw httpError(404, 'Introuvable');

  // Un autre site ne peut pas envoyer ces formulaires avec le mot de passe mémorisé par le navigateur
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') throw httpError(403, 'Formulaire refusé');
  if (path === '/prof/import') return importQuiz(req, res, params.get('nom') || '');
  const form = new URLSearchParams(await readBody(req));
  const quiz = form.get('quiz') || '';
  const group = clean(form.get('groupe'), 40);
  if (path === '/prof/statut') return setStatus(res, quiz, group, form.get('status'));
  if (path === '/prof/note') return setGrade(res, quiz, group, form);
  if (path === '/prof/effacer') return erase(res, quiz, group);
  throw httpError(404, 'Introuvable');
}

const num = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const when = (utc) =>
  new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
const origin = (req) =>
  `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const sessionUrl = (quiz, group) => `/prof?quiz=${encodeURIComponent(quiz)}&groupe=${encodeURIComponent(group)}`;
const hidden = (quiz, group) =>
  `<input type="hidden" name="quiz" value="${esc(quiz)}"><input type="hidden" name="groupe" value="${esc(group)}">`;

// Espaces insécables avant « : ? ! » et dans les guillemets, pour le texte des questions
const fr = (text) => esc(text).replace(/« /g, '«\u00a0').replace(/ ([»:;?!])/g, '\u00a0$1');

const TYPE_LABEL = { choice: 'choix unique', multiple: 'choix multiple', text: 'réponse courte', open: 'réponse rédigée' };
const STATUS = {
  waiting: { label: 'Pas encore ouvert', text: 'Les élèves qui ont le lien attendent sur la page du quiz.', next: 'open', button: 'Ouvrir le quiz' },
  open: { label: 'Ouvert', text: 'Les élèves peuvent commencer et répondre.', next: 'closed', button: 'Fermer le quiz' },
  closed: { label: 'Fermé', text: 'Les élèves peuvent relire leurs résultats, plus répondre.', next: 'open', button: 'Rouvrir le quiz' },
};

function page(title, body) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Carnet</title>
<link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/quiz.css"><script src="/suivi.js" type="module"></script></head>
<body><header class="topbar"><div class="topbar-inner wide">
<a class="brand" href="/prof">Carnet</a><span class="topbar-title">Suivi des quiz</span></div></header>
<main class="page wide">${body}</main></body></html>`;
}

function send(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function back(res, quiz, group, hash = '') {
  res.writeHead(303, { Location: sessionUrl(quiz, group) + hash });
  res.end();
}

const COUNT = {
  choice: ['à choix unique', 'à choix unique'],
  multiple: ['à choix multiple', 'à choix multiple'],
  text: ['réponse courte', 'réponses courtes'],
  open: ['réponse rédigée', 'réponses rédigées'],
};

// « 7 à choix unique, 3 à choix multiple, 3 réponses rédigées »
function outline(questions) {
  const counts = Map.groupBy(questions, (q) => q.type);
  return [...counts].map(([type, list]) => `${list.length} ${COUNT[type][list.length > 1 ? 1 : 0]}`).join(', ');
}

function timeRange(questions) {
  const limits = questions.map((q) => q.timeLimit).filter(Boolean);
  if (!limits.length) return 'Sans limite';
  const fmt = (s) => (s < 60 ? `${s} s` : `${num(s / 60)} min`);
  const [min, max] = [Math.min(...limits), Math.max(...limits)];
  return `${min === max ? fmt(min) : `${fmt(min)} à ${fmt(max)}`} par question${limits.length < questions.length ? ', certaines sans limite' : ''}`;
}

async function dashboard(res, params) {
  const [quizzes, sessions, runs] = await sql(
    ['SELECT id, data FROM quizzes ORDER BY title COLLATE NOCASE'],
    ['SELECT quiz, group_name, status, created_at FROM sessions'],
    ['SELECT quiz, group_name, COUNT(*) AS n, MAX(started_at) AS last FROM runs GROUP BY quiz, group_name'],
  );
  const list = quizzes.map((q) => ({ id: q.id, ...readQuiz(q.data) }));
  const titles = new Map(list.map((q) => [q.id, q.title]));

  // Un groupe existe dès qu'il a une ligne d'ouverture ou un passage
  const groups = new Map();
  for (const s of sessions) groups.set(`${s.quiz}\n${s.group_name}`, { quiz: s.quiz, group: s.group_name, status: s.status, n: 0, last: s.created_at });
  for (const r of runs) {
    const key = `${r.quiz}\n${r.group_name}`;
    const g = groups.get(key) || { quiz: r.quiz, group: r.group_name, status: null, n: 0, last: r.last };
    groups.set(key, { ...g, n: r.n, last: r.last > g.last ? r.last : g.last });
  }
  const recent = [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));

  const notice = params.get('efface') ? `Les résultats du groupe « ${esc(params.get('efface'))} » sont effacés.`
    : params.get('importe') ? `Le quiz « ${esc(titles.get(params.get('importe')) || params.get('importe'))} » est importé.` : '';

  send(res, page('Suivi des quiz', `
${notice ? `<p class="notice" role="status">${notice}</p>` : ''}
<h1>Suivi des quiz</h1>
<p class="lead">Préparez un lien pour un groupe, ouvrez le quiz quand les élèves sont prêts, puis suivez leurs réponses en direct.</p>

<section class="section" aria-labelledby="launch">
  <h2 id="launch">Lancer un quiz</h2>
  ${list.length ? `<form class="form-row" method="get" action="/prof">
    <div class="field-group"><label for="pick-quiz">Quiz</label>
      <select id="pick-quiz" name="quiz" class="input">${list.map((q) => `<option value="${esc(q.id)}">${esc(q.title)}</option>`).join('')}</select></div>
    <div class="field-group"><label for="pick-group">Nom du groupe</label>
      <input id="pick-group" name="groupe" class="input" required maxlength="40" placeholder="Par exemple : eden-lundi" aria-describedby="pick-help"></div>
    <button class="btn btn-primary">Préparer le lien</button>
  </form>
  <p class="help" id="pick-help">Un nom par classe ou par séance. Le quiz reste fermé tant que vous ne l'ouvrez pas.</p>`
    : '<p>Aucun quiz pour l\'instant. Importez-en un ci-dessous.</p>'}
</section>

${recent.length ? `<section class="section" aria-labelledby="groups">
  <h2 id="groups">Groupes</h2>
  <div class="table-scroll"><table class="data">
    <thead><tr><th scope="col">Groupe</th><th scope="col">Quiz</th><th scope="col">État</th><th scope="col" class="num">Passages</th><th scope="col">Dernière activité</th></tr></thead>
    <tbody>${recent.map((g) => `<tr>
      <th scope="row"><a href="${esc(sessionUrl(g.quiz, g.group))}">${esc(g.group)}</a></th>
      <td>${esc(titles.get(g.quiz) || g.quiz)}</td>
      <td><span class="state state-${g.status || 'waiting'}">${STATUS[g.status || 'waiting'].label}</span></td>
      <td class="num">${g.n}</td><td>${when(g.last)}</td></tr>`).join('')}</tbody>
  </table></div>
</section>` : ''}

<section class="section" aria-labelledby="quizzes">
  <h2 id="quizzes">Quiz disponibles</h2>
  ${list.length ? `<div class="table-scroll"><table class="data">
    <thead><tr><th scope="col">Titre</th><th scope="col">Questions</th><th scope="col">Temps de réponse</th><th scope="col">Identifiant</th></tr></thead>
    <tbody>${list.map((q) => `<tr><th scope="row">${esc(q.title)}</th>
      <td>${q.questions.length} questions<span class="sub">${outline(q.questions)}</span></td><td>${timeRange(q.questions)}</td><td><code>${esc(q.id)}</code></td></tr>`).join('')}</tbody>
  </table></div>` : ''}
  <div class="import">
    <h3>Ajouter un quiz</h3>
    <p>Un quiz s'écrit dans un fichier JSON. Partez de l'exemple : il montre les quatre types de questions, le chrono et le lien de retour au cours. Le nom du fichier devient l'identifiant du quiz. Un fichier du même nom remplace le quiz existant, sans effacer les réponses déjà données.</p>
    <div class="actions-row">
      <label class="btn btn-primary file-btn">Importer un fichier JSON<input type="file" id="import-file" accept=".json,application/json"></label>
      <a class="btn" href="/exemple.json" download="exemple.json">Télécharger l'exemple</a>
    </div>
    <div id="import-result" role="status"></div>
  </div>
</section>`));
}

// Pour chaque passage : l'état de chaque question. score null : pas finie, ou réponse rédigée à noter.
function tally(quiz, runs, answers, seen, grades) {
  const key = (run, question) => `${run} ${question}`;
  const byKey = Map.groupBy(answers, (a) => key(a.run_id, a.question_id));
  const shownAt = new Map(seen.map((s) => [key(s.run_id, s.question_id), s.shown_at]));
  const graded = new Map(grades.map((g) => [key(g.run_id, g.question_id), g.score]));
  const attempts = new Map();
  return runs
    .map((r) => {
      const attempt = (attempts.get(plain(r.name)) || 0) + 1;
      attempts.set(plain(r.name), attempt);
      const cells = quiz.questions.map((q) => {
        const k = key(r.id, q.id);
        const rows = byKey.get(k) || [];
        const grade = graded.get(k) ?? null;
        const done = isDone(q, rows, timeLeft(q, shownAt.get(k) ?? null));
        return { q, rows, grade, done, score: done ? questionScore(q, rows, grade) : null };
      });
      return {
        ...r,
        attempt,
        cells,
        finished: cells.every((c) => c.done),
        doneCount: cells.filter((c) => c.done).length,
        pending: cells.filter((c) => c.done && c.score === null).length,
        total: cells.reduce((sum, c) => sum + (c.score ?? 0), 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.attempt - b.attempt);
}

async function load(quizId, group) {
  const inGroup = 'JOIN runs r ON r.id = x.run_id WHERE r.quiz = ? AND r.group_name = ?';
  const [[row], [sess], runs, answers, seen, grades] = await sql(
    ['SELECT data FROM quizzes WHERE id = ?', quizId],
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', quizId, group],
    ['SELECT id, name, started_at FROM runs WHERE quiz = ? AND group_name = ? ORDER BY started_at', quizId, group],
    [`SELECT x.run_id, x.question_id, x.choice, x.correct FROM answers x ${inGroup} ORDER BY x.id`, quizId, group],
    [`SELECT x.run_id, x.question_id, x.shown_at FROM shown x ${inGroup}`, quizId, group],
    [`SELECT x.run_id, x.question_id, x.score FROM grades x ${inGroup}`, quizId, group],
  );
  if (!row) throw httpError(404, 'Quiz introuvable');
  const quiz = readQuiz(row.data);
  return { quiz, status: sess?.status || 'waiting', results: tally(quiz, runs, answers, seen, grades) };
}

const cellClass = (s) => (s === 1 ? 's-ok' : s > 0 ? 's-half' : 's-ko');
const nameCell = (r) => `${esc(r.name)}${r.attempt > 1 ? ` <span class="attempt">essai ${r.attempt}</span>` : ''}`;
const anchor = (r, q) => `n-${r.id}-${q.id}`;

async function session(req, res, quizId, group) {
  const { quiz, status, results } = await load(quizId, group);
  const state = STATUS[status];
  const link = `${origin(req)}/?quiz=${encodeURIComponent(quizId)}&groupe=${encodeURIComponent(group)}`;

  send(res, page(`${quiz.title}, ${group}`, `
<p class="back"><a href="/prof">Tous les quiz</a></p>
<h1>${esc(quiz.title)}</h1>
<p class="lead">Groupe <strong>${esc(group)}</strong>. ${quiz.questions.length} questions : ${outline(quiz.questions)}.</p>

<section class="control" aria-label="Ouverture du quiz">
  <p class="control-state"><span class="state state-${status}">${state.label}</span> ${state.text}</p>
  <form method="post" action="/prof/statut">${hidden(quizId, group)}
    <button class="btn ${status === 'open' ? '' : 'btn-primary'}" name="status" value="${state.next}">${state.button}</button></form>
</section>

<section class="share">
  <label for="share-link">Lien à donner aux élèves</label>
  <div class="copy">
    <input id="share-link" class="input" readonly value="${esc(link)}">
    <button type="button" class="btn" data-copy="share-link">Copier le lien</button>
  </div>
</section>

<div id="live">${live(quiz, quizId, group, results)}</div>

<section class="section tools" aria-labelledby="tools">
  <h2 id="tools">Exporter et effacer</h2>
  <div class="actions-row">
    <a class="btn" href="/prof/export.csv?quiz=${encodeURIComponent(quizId)}&amp;groupe=${encodeURIComponent(group)}">Exporter en CSV</a>
    <form method="post" action="/prof/effacer" data-confirm="Effacer tous les passages et les notes du groupe ${esc(group)} ? Cette action est définitive.">
      ${hidden(quizId, group)}<button class="btn btn-danger">Effacer les résultats du groupe</button></form>
  </div>
  <p class="help">Le fichier CSV s'ouvre dans un tableur. Effacez les résultats une fois la note reportée : les élèves sont mineurs, leurs réponses n'ont pas à rester en ligne.</p>
</section>`));
}

function live(quiz, quizId, group, results) {
  const questions = quiz.questions;
  const finished = results.filter((r) => r.finished);
  const pending = results.reduce((sum, r) => sum + r.pending, 0);
  const average = finished.length ? finished.reduce((sum, r) => sum + r.total, 0) / finished.length : null;
  const updated = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });

  return `
<p class="updated">Mis à jour à ${updated}. La page se met à jour toute seule toutes les 5 secondes.</p>
<dl class="stats">
  <div><dt>Passages</dt><dd>${results.length}</dd></div>
  <div><dt>Terminés</dt><dd>${finished.length}</dd></div>
  <div><dt>Moyenne des terminés</dt><dd>${average === null ? '–' : `${num(average)} <small>/ ${questions.length}</small>`}</dd></div>
  <div><dt>Réponses à noter</dt><dd>${pending ? `<a href="#a-noter">${pending}</a>` : 0}</dd></div>
</dl>

<section class="section" aria-labelledby="results">
  <h2 id="results">Résultats</h2>
  ${results.length ? `<div class="table-scroll"><table class="data grid">
    <thead><tr><th scope="col">Élève</th><th scope="col">Avancement</th><th scope="col" class="num">Score</th>
      ${questions.map((q, i) => `<th scope="col" class="q"><a href="#q-${i + 1}" title="${esc(q.question)}">${i + 1}</a></th>`).join('')}</tr></thead>
    <tbody>${results.map((r) => `<tr>
      <th scope="row">${nameCell(r)}</th>
      <td>${r.finished ? 'Terminé' : `Question ${Math.min(r.doneCount + 1, questions.length)} sur ${questions.length}`}</td>
      <td class="num"><strong>${num(r.total)}</strong> / ${questions.length}</td>
      ${r.cells.map((c) => (!c.done ? '<td class="cell"></td>'
        : c.score === null ? `<td class="cell s-pending"><a href="#${anchor(r, c.q)}" title="À noter">?</a></td>`
        : `<td class="cell ${cellClass(c.score)}">${num(c.score)}</td>`)).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Réussite</th><td></td><td></td>${questions.map((_, i) => `<td class="q">${rate(results, i) ?? ''}</td>`).join('')}</tr></tfoot>
  </table></div>
  <ul class="legend">
    <li><span class="cell s-ok">1</span> juste au premier essai</li>
    <li><span class="cell s-half">0,5</span> juste au deuxième essai</li>
    <li><span class="cell s-ko">0</span> faux, passée ou temps écoulé</li>
    <li><span class="cell s-pending">?</span> réponse rédigée à noter</li>
    <li><span class="cell"></span> pas encore répondu</li>
  </ul>` : '<p class="empty">Aucun passage pour l\'instant. Les élèves apparaissent ici dès qu\'ils commencent.</p>'}
</section>
${grading(questions, quizId, group, results)}
${questionStats(questions, results)}`;
}

// Taux de réussite d'une question : la moyenne des points de ceux qui l'ont finie
function rate(results, i) {
  const scores = results.map((r) => r.cells[i].score).filter((s) => s !== null);
  return scores.length ? `${Math.round((100 * scores.reduce((a, b) => a + b, 0)) / scores.length)} %` : null;
}

// Réponses rédigées, et réponses courtes refusées que le formateur peut accepter
function grading(questions, quizId, group, results) {
  const blocks = questions
    .map((q, i) => {
      if (q.type !== 'open' && q.type !== 'text') return '';
      const items = results
        .map((r) => ({ r, c: r.cells[i] }))
        .filter(({ c }) => c.done && c.rows.some((row) => row.choice !== SKIP) && (q.type === 'open' || c.grade !== null || c.score < 1));
      if (!items.length) return '';
      const todo = items.filter(({ c }) => c.score === null).length;
      return `<article class="grade-block">
  <h3><span class="qnum">${i + 1}</span> ${fr(q.question)}</h3>
  ${q.type === 'open' ? `<p class="expected"><strong>Réponse attendue :</strong> ${fr(q.expected || 'non précisée')}</p>`
    : `<p class="expected"><strong>Réponses acceptées :</strong> ${q.accept.map(esc).join(', ')}. Les réponses ci-dessous ont été refusées. Donnez des points si elles sont justes.</p>`}
  ${todo ? `<p class="help">${todo} à noter.</p>` : ''}
  <ul class="grade-list">${items.map(({ r, c }) => gradeItem(q, r, c, quizId, group)).join('')}</ul>
</article>`;
    })
    .filter(Boolean);
  return blocks.length ? `<section class="section" aria-labelledby="a-noter"><h2 id="a-noter">Réponses écrites</h2>${blocks.join('')}</section>` : '';
}

function gradeItem(q, r, c, quizId, group) {
  const tries = c.rows.filter((row) => row.choice !== SKIP);
  const id = anchor(r, q);
  return `<li class="grade-item${c.score === null ? ' is-todo' : ''}" id="${esc(id)}">
  <p class="grade-who">${nameCell(r)}</p>
  ${q.type === 'open' ? `<p class="answer-text">${esc(tries[0].choice)}</p>`
    : `<p class="answer-tries">${tries.map((t) => `<span class="try${t.correct ? ' is-ok' : ''}">${esc(t.choice)}</span>`).join(' puis ')}</p>`}
  <form class="grade" method="post" action="/prof/note" data-inline>
    ${hidden(quizId, group)}<input type="hidden" name="run" value="${esc(r.id)}"><input type="hidden" name="question" value="${esc(q.id)}">
    <span class="grade-label">Note</span>
    ${[0, 0.5, 1].map((s) => {
      const pressed = c.grade === s;
      return `<button class="grade-btn" id="${esc(`${id}-${s}`)}" name="score" value="${pressed ? '' : s}" aria-pressed="${pressed}">${num(s)}</button>`;
    }).join('')}
    <span class="help">${c.grade !== null ? 'Recliquez sur la note pour l\'enlever.' : q.type === 'text' ? `Note automatique : ${num(c.score)}` : ''}</span>
  </form>
</li>`;
}

// Pour chaque question : le taux de réussite et, pour les choix, ce que les élèves ont choisi au premier essai
function questionStats(questions, results) {
  if (!results.length) return '';
  return `<section class="section" aria-labelledby="per-question">
  <h2 id="per-question">Question par question</h2>
  <ol class="qstats">${questions.map((q, i) => {
    const firsts = results.map((r) => r.cells[i].rows[0]?.choice).filter(Boolean);
    const count = (id) => firsts.filter((v) => v.split(',').includes(id)).length;
    const right = new Set(q.type === 'choice' ? [q.correctAnswer] : q.correctAnswers || []);
    return `<li id="q-${i + 1}">
    <p class="qstats-head"><span class="qnum">${i + 1}</span> <span class="kind">${TYPE_LABEL[q.type]}</span>
      <span class="rate">${rate(results, i) ? `${rate(results, i)} de réussite` : 'pas encore de réponse'}</span></p>
    <p class="qtext">${fr(q.question)}</p>
    ${(q.type === 'choice' || q.type === 'multiple') && firsts.length ? `<ul class="dist" aria-label="Premier choix des élèves">${q.options.map((o) => `
      <li class="${right.has(o.id) ? 'is-right' : ''}"><span class="dist-label">${esc(o.label)}${right.has(o.id) ? ' <span class="sr-only">(bonne réponse)</span>' : ''}</span>
        <span class="dist-bar"><span style="width:${Math.round((100 * count(o.id)) / firsts.length)}%"></span></span><span class="dist-n">${count(o.id)}</span></li>`).join('')}</ul>` : ''}
  </li>`;
  }).join('')}</ol>
  <p class="help">Les barres comptent le premier choix de chaque élève. La bonne réponse est en vert.</p>
</section>`;
}

async function setStatus(res, quiz, group, status) {
  if (!group || !['open', 'closed'].includes(status)) throw httpError(400, 'Formulaire invalide');
  const [found] = await sql(['SELECT 1 FROM quizzes WHERE id = ?', quiz]);
  if (!found.length) throw httpError(404, 'Quiz introuvable');
  await sql([
    'INSERT INTO sessions (quiz, group_name, status) VALUES (?, ?, ?) ON CONFLICT (quiz, group_name) DO UPDATE SET status = excluded.status',
    quiz, group, status,
  ]);
  back(res, quiz, group);
}

// Une note vide enlève la note du formateur : la note automatique revient
async function setGrade(res, quiz, group, form) {
  const run = form.get('run') || '';
  const question = form.get('question') || '';
  const score = form.get('score');
  if (!['0', '0.5', '1', ''].includes(score)) throw httpError(400, 'Note invalide');
  const [found] = await sql(['SELECT 1 FROM runs WHERE id = ? AND quiz = ? AND group_name = ?', run, quiz, group]);
  if (!found.length) throw httpError(404, 'Passage introuvable');
  await sql(score === ''
    ? ['DELETE FROM grades WHERE run_id = ? AND question_id = ?', run, question]
    : ['INSERT INTO grades (run_id, question_id, score) VALUES (?, ?, ?) ON CONFLICT (run_id, question_id) DO UPDATE SET score = excluded.score',
      run, question, Number(score)]);
  back(res, quiz, group, `#n-${run}-${question}`);
}

async function erase(res, quiz, group) {
  const runs = 'SELECT id FROM runs WHERE quiz = ? AND group_name = ?';
  await sql(
    [`DELETE FROM answers WHERE run_id IN (${runs})`, quiz, group],
    [`DELETE FROM shown WHERE run_id IN (${runs})`, quiz, group],
    [`DELETE FROM grades WHERE run_id IN (${runs})`, quiz, group],
    ['DELETE FROM runs WHERE quiz = ? AND group_name = ?', quiz, group],
    ['DELETE FROM sessions WHERE quiz = ? AND group_name = ?', quiz, group],
  );
  res.writeHead(303, { Location: `/prof?efface=${encodeURIComponent(group)}` });
  res.end();
}

async function importQuiz(req, res, fileName) {
  const id = quizId(fileName);
  if (!id) throw httpError(400, 'Nom de fichier manquant');
  let data;
  try {
    data = JSON.parse(await readBody(req, 300_000));
  } catch (err) {
    if (err.status) throw err;
    return json(res, 400, { errors: ['Le fichier n\'est pas un JSON valide. Vérifiez les virgules et les guillemets, par exemple sur jsonlint.com.'] });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(res, 400, { errors: ['Le fichier doit contenir un objet { "title": …, "questions": […] }.'] });
  const quiz = normalize(data);
  const errors = validate(quiz);
  if (errors.length) return json(res, 400, { errors });
  await saveQuiz(id, quiz);
  json(res, 200, { id, title: quiz.title, count: quiz.questions.length });
}

// Une ligne par passage, points en virgule décimale et séparateur point-virgule, pour les tableurs français
async function exportCsv(res, quizId, group) {
  const { quiz, results } = await load(quizId, group);
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['Nom', 'Essai', 'Début', 'Terminé', 'Score', 'Sur', ...quiz.questions.map((_, i) => `Q${i + 1}`)],
    ...results.map((r) => [r.name, r.attempt, when(r.started_at), r.finished ? 'oui' : 'non', num(r.total), quiz.questions.length,
      ...r.cells.map((c) => (!c.done ? '' : c.score === null ? 'à noter' : num(c.score)))]),
  ];
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${quizId}-${plain(group).replace(/ /g, '-') || 'groupe'}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end(`﻿${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`);
}
