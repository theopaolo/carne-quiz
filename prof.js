// Pages du formateur : lancer un quiz, l'ouvrir et le fermer, suivre et noter les réponses, importer un quiz.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseQuestions } from './public/roulette-draw.js';
import {
  sql, readQuiz, normalize, validate, saveQuiz, quizId, isDone, questionScore, timeLeft, plain, SKIP, rosterNames, AWAY, flagged, trapped,
} from './lib.js';
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
  if (req.method === 'GET' && path === '/prof/roulette') return roulette(res, pickedGroup(params));
  if (req.method === 'GET' && path === '/prof/roulette/ecran') return rouletteScreen(res, clean(params.get('groupe'), 40));
  if (req.method === 'GET' && path === '/prof/equipes') return equipes(res, pickedGroup(params));
  if (req.method === 'GET' && path === '/prof/equipes/ecran') return equipesScreen(res, clean(params.get('groupe'), 40));
  if (req.method === 'GET' && path === '/prof') {
    const group = pickedGroup(params);
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
  if (path === '/prof/eleves') return setRoster(res, quiz, group, form.get('eleves') || '', form.get('retour'));
  if (path === '/prof/liberer') return release(res, quiz, group, form.get('run') || '');
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

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Carnet</title>
<link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/quiz.css"><script src="/suivi.js" type="module"></script>${script}</head>
<body><header class="topbar"><div class="topbar-inner wide">
<a class="brand" href="/prof">Carnet</a><span class="topbar-title">Suivi des quiz</span><nav class="topbar-who class-tools" aria-label="Outils de classe"><a href="/prof/roulette">Quiz-roulette</a><a href="/prof/equipes">Équipes</a></nav></div></header>
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
  const [quizzes, sessions, runs, groupRows] = await sql(
    ['SELECT id, data FROM quizzes ORDER BY title COLLATE NOCASE'],
    ['SELECT quiz, group_name, status, created_at FROM sessions'],
    ['SELECT quiz, group_name, COUNT(*) AS n, MAX(started_at) AS last FROM runs GROUP BY quiz, group_name'],
    [GROUPS],
  );
  const list = quizzes.map((q) => ({ id: q.id, ...readQuiz(q.data) }));
  const titles = new Map(list.map((q) => [q.id, q.title]));

  // Un quiz est lancé pour un groupe dès qu'il a une ligne d'ouverture ou un passage
  const launched = new Map();
  for (const s of sessions) launched.set(`${s.quiz}\n${s.group_name}`, { quiz: s.quiz, group: s.group_name, status: s.status, n: 0, last: s.created_at });
  for (const r of runs) {
    const key = `${r.quiz}\n${r.group_name}`;
    const g = launched.get(key) || { quiz: r.quiz, group: r.group_name, status: null, n: 0, last: r.last };
    launched.set(key, { ...g, n: r.n, last: r.last > g.last ? r.last : g.last });
  }
  const recent = [...launched.values()].sort((a, b) => b.last.localeCompare(a.last));

  const notice = params.get('efface') ? `Les résultats du groupe « ${esc(params.get('efface'))} » sont effacés.`
    : params.get('importe') ? `Le quiz « ${esc(titles.get(params.get('importe')) || params.get('importe'))} » est importé.` : '';

  send(res, page('Suivi des quiz', `
${notice ? `<p class="notice" role="status">${notice}</p>` : ''}
<h1>Suivi des quiz</h1>
<p class="lead">Préparez un lien pour un groupe, ouvrez le quiz quand les élèves sont prêts, puis suivez leurs réponses en direct.</p>

<section class="section" aria-labelledby="roulette-launch">
  <h2 id="roulette-launch">Outils de classe</h2>
  <p>Un élève, une question courte. Faites 2 ou 3 tours de classe en donnant la priorité aux moins interrogés. Les questions réussies sortent du tirage.</p>
  <p>Composez aussi des équipes de tailles choisies, puis tirez leur ordre de passage à l’oral.</p>
  <div class="actions-row"><a class="btn" href="/prof/roulette">Ouvrir le quiz-roulette</a><a class="btn" href="/prof/equipes">Tirer les équipes</a></div>
</section>

<section class="section" aria-labelledby="launch">
  <h2 id="launch">Lancer un quiz</h2>
  ${list.length ? `<form class="form-row group-picker" method="get" action="/prof">
    <div class="field-group"><label for="pick-quiz">Quiz</label>
      <select id="pick-quiz" name="quiz" class="input">${list.map((q) => `<option value="${esc(q.id)}">${esc(q.title)}</option>`).join('')}</select></div>
    ${groupFields(groupRows.map((g) => g.group_name), recent[0]?.group)}
    <button class="btn btn-primary">Préparer le lien</button>
  </form>
  <p class="help">Un groupe par classe : sa liste d'élèves sert pour tous ses quiz. Le quiz reste fermé tant que vous ne l'ouvrez pas.</p>`
    : '<p>Aucun quiz pour l\'instant. Importez-en un ci-dessous.</p>'}
</section>

${recent.length ? `<section class="section" aria-labelledby="groups">
  <h2 id="groups">Quiz lancés</h2>
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

// Un groupe existe dès qu'il a une liste d'élèves, un quiz lancé ou un passage
const GROUPS = 'SELECT group_name FROM rosters UNION SELECT group_name FROM sessions UNION SELECT group_name FROM runs ORDER BY 1 COLLATE NOCASE';

async function groupRoster(group) {
  const [groups, [roster]] = await sql([GROUPS], ['SELECT names FROM rosters WHERE group_name = ?', group]);
  return { groups: groups.map((g) => g.group_name), names: rosterNames(roster) };
}

async function rouletteData(group) {
  const { groups, names } = await groupRoster(group);
  const questions = parseQuestions(await readFile(new URL('./decks/questions-courtes.md', import.meta.url), 'utf8'));
  return { groups, names, questions };
}

const pageJson = (id, value) => `<script id="${id}" type="application/json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;

// Choix du groupe : liste des groupes enregistrés, ou « Nouveau groupe… » qui affiche le champ libre (CSS :has).
// Le formulaire envoie groupe ou nouveau : pickedGroup lit le premier rempli.
const pickedGroup = (params) => clean(params.get('groupe') || params.get('nouveau'), 40);
const groupFields = (groups, group) => `${groups.length ? `<div class="field-group"><label for="group-pick">Groupe</label><select class="input" id="group-pick" name="groupe">
        ${groups.map((g) => `<option${g === group ? ' selected' : ''}>${esc(g)}</option>`).join('')}
        <option value="">Nouveau groupe…</option></select></div>` : ''}
      <div class="field-group group-picker-new"><label for="group-new">${groups.length ? 'Nom du nouveau groupe' : 'Groupe'}</label>
        <input class="input" id="group-new" name="nouveau" maxlength="40" placeholder="Par exemple : eden-lundi"${groups.length ? '' : ' required'}></div>`;
const groupPicker = (action, groups, group) => `<form class="form-row group-picker" method="get" action="${action}">
      ${groupFields(groups, group)}
      <button class="btn" type="submit">${group ? 'Changer de groupe' : 'Choisir ce groupe'}</button>
    </form>`;

async function equipes(res, group) {
  const { groups, names } = await groupRoster(group);
  const groupForm = groupPicker('/prof/equipes', groups, group);
  if (!group) return send(res, page('Équipes au hasard', `
<h1>Équipes au hasard</h1>
<p class="lead">Choisissez une classe pour composer ses équipes et tirer leur ordre de passage à l’oral.</p>
${groupForm}`));
  send(res, page('Équipes au hasard', `
<div class="roulette-heading">
  <div><h1>Équipes au hasard</h1><p class="lead">Classe <strong>${esc(group)}</strong></p></div>
  <a class="btn" id="equipes-open" href="/prof/equipes/ecran?groupe=${encodeURIComponent(group)}" target="carnet-equipes-ecran"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>Ouvrir l’écran des élèves</a>
</div>
<p class="alert" id="equipes-error" role="alert" hidden></p>
<details class="rules equipes-roster"${names.length ? '' : ' open'}>
  <summary>Liste et présences <span id="equipes-present-count"></span></summary>
  <div class="rules-body">
    <fieldset class="roulette-presence" id="equipes-presence"><legend>Élèves présents</legend></fieldset>
    <p class="help">Décochez les absents avant le tirage.</p>
    <form class="roulette-roster" method="post" action="/prof/eleves">
      <input type="hidden" name="groupe" value="${esc(group)}"><input type="hidden" name="retour" value="equipes">
      <label for="equipes-names">Liste de la classe, un nom par ligne</label>
      <textarea class="input" name="eleves" id="equipes-names" rows="6" aria-describedby="equipes-roster-help">${esc(names.join('\n'))}</textarea>
      <p class="help" id="equipes-roster-help">La liste est partagée avec les quiz et le quiz-roulette. Les présences de cet outil sont indépendantes.</p>
      <button class="btn" type="submit">Enregistrer la liste</button>
    </form>
    <div class="roulette-group">${groupForm}</div>
  </div>
</details>
<div class="equipes-layout">
  <section class="equipes-config" aria-labelledby="equipes-config-title">
    <h2 id="equipes-config-title">Composition</h2>
    <form id="equipes-form">
      <fieldset class="equipes-presets" id="equipes-presets" aria-describedby="equipes-presets-help">
        <legend>Répartir les présents en équipes de</legend>
        <div>${[2, 3, 4, 5].map((n) => `<button class="btn" type="button" data-size="${n}" aria-pressed="false">${n}</button>`).join('')}</div>
        <p class="help" id="equipes-presets-help">Tailles égales à un élève près. Ajustez chaque ligne si besoin.</p>
      </fieldset>
      <div class="equipes-plan" id="equipes-plan"></div>
      <button class="btn btn-quiet" type="button" id="equipes-add">Ajouter une taille</button>
      <p id="equipes-capacity" role="status" aria-live="polite"></p>
      <button class="btn btn-primary" type="submit" id="equipes-draw" disabled>Tirer les équipes</button>
    </form>
  </section>
  <section class="equipes-results" aria-labelledby="equipes-title">
    <div class="equipes-heading"><h2 id="equipes-title" tabindex="-1">Les équipes</h2><button class="btn" type="button" id="equipes-fun" hidden>Noms avec emojis</button></div>
    <p class="help" id="equipes-stale" role="status" hidden>Les réglages ou les présences ont changé. Refaites le tirage pour les appliquer aux équipes.</p>
    <div class="equipes-empty" id="equipes-empty">
      <p>Les équipes s’afficheront ici. Choisissez une taille d’équipe, puis tirez les équipes.</p>
      <p>Pour faire le tirage devant la classe, ouvrez d’abord l’écran des élèves sur le projecteur.</p>
    </div>
    <div class="equipes-passage" id="equipes-passage" hidden>
      <p id="equipes-passage-status" tabindex="-1"></p>
      <div class="actions-row">
        <button class="btn" type="button" id="equipes-prev" hidden>Précédente</button>
        <button class="btn btn-primary" type="button" id="equipes-next" hidden>Commencer les oraux</button>
        <button class="btn" type="button" id="equipes-order-draw">Tirer l’ordre de passage</button>
      </div>
    </div>
    <p class="help" id="equipes-names-help" hidden>Cliquez sur le nom d’une équipe pour le modifier.</p>
    <div class="equipes-list" id="equipes-list"></div>
  </section>
</div>
<p class="sr-only" id="equipes-result" role="status" aria-live="polite" aria-atomic="true"></p>
<noscript><p class="alert">Activez JavaScript pour tirer les équipes et l’ordre de passage.</p></noscript>
${pageJson('equipes-data', { group, names })}`, '<script src="/equipes.js" type="module"></script>'));
}

// Écran des élèves, à projeter : les équipes en grand, puis l'équipe à l'oral et l'ordre de passage
async function equipesScreen(res, group) {
  if (!group) {
    res.writeHead(303, { Location: '/prof/equipes' });
    return res.end();
  }
  const { names } = await groupRoster(group);
  send(res, `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Équipes | Carnet</title>
<link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/quiz.css"><script src="/equipes.js" type="module"></script></head>
<body><main class="equipes-screen">
  <header class="equipes-screen-head"><h1>Équipes <span>${esc(group)}</span></h1><p id="equipes-status"></p></header>
  <div class="equipes-stage" id="equipes-stage"></div>
  <p class="sr-only" id="equipes-result" role="status" aria-live="polite" aria-atomic="true"></p>
  <div class="roulette-bar">
    <button class="btn" type="button" id="equipes-fullscreen" hidden>Plein écran</button>
    <p><kbd>Espace</kbd> ordre de passage, puis équipe suivante <kbd>←</kbd> équipe précédente <kbd>F</kbd> plein écran</p>
    <p class="alert" id="equipes-error" role="alert" hidden></p>
  </div>
  <noscript><p class="alert">Activez JavaScript pour afficher les équipes.</p></noscript>
  ${pageJson('equipes-data', { group, names })}
</main></body></html>`);
}

// Régie du formateur : tirage en cours avec sa réponse, évaluation, réglages. L'écran des élèves s'ouvre à part.
async function roulette(res, group) {
  const { groups, names, questions } = await rouletteData(group);
  const groupForm = groupPicker('/prof/roulette', groups, group);
  if (!group) {
    return send(res, page('Quiz-roulette', `
<h1>Quiz-roulette</h1>
<p class="lead">Choisissez un groupe existant ou donnez un nom à votre classe. Vous pourrez ensuite ajouter sa liste d’élèves.</p>
${groupForm}`));
  }
  send(res, page('Quiz-roulette', `
<div class="roulette-heading">
  <div><h1>Quiz-roulette</h1><p class="lead">Groupe <strong>${esc(group)}</strong></p></div>
  <a class="btn" id="roulette-open" href="/prof/roulette/ecran?groupe=${encodeURIComponent(group)}" target="carnet-roulette-ecran"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>Ouvrir l’écran des élèves</a>
</div>
<section class="roulette-now" aria-label="Tirage en cours">
  <div><p class="roulette-label">Élève</p><p class="roulette-student" id="roulette-student"></p></div>
  <div>
    <p class="roulette-label">Question <span id="roulette-question-topic"></span></p>
    <p class="roulette-question" id="roulette-question"></p>
    <div class="roulette-answer" id="roulette-answer-block" hidden><p class="roulette-label">Réponse</p><p id="roulette-answer"></p></div>
  </div>
</section>
<p class="sr-only" id="roulette-result" role="status" aria-live="polite" aria-atomic="true"></p>
<div class="roulette-actions">
  <button class="btn btn-primary" type="button" id="roulette-draw" disabled>Tirer au sort</button>
  <div class="roulette-grading" id="roulette-grading" hidden>
    <button class="btn roulette-good" type="button" id="roulette-good"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>Bonne réponse</button>
    <button class="btn roulette-bad" type="button" id="roulette-bad"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>Mauvaise réponse</button>
    <button class="btn btn-quiet" type="button" id="roulette-discard">Écarter la question</button>
  </div>
  <p id="roulette-feedback" role="status"></p>
  <p class="help" id="roulette-progress"></p>
</div>
<p class="help roulette-status" id="roulette-status">Chargement des tirages…</p>
<p class="alert" id="roulette-error" role="alert" hidden></p>
<details class="rules roulette-settings"${names.length ? '' : ' open'}>
  <summary>Réglages <span id="roulette-settings-summary"></span></summary>
  <div class="rules-body">
    <div class="roulette-toolbar">
      <div class="field-group"><label for="roulette-topic">Questions</label><select class="input" id="roulette-topic">
        <option value="">Tous les thèmes</option>${[...new Set(questions.map((q) => q.topic))].map((topic) => `<option>${esc(topic)}</option>`).join('')}</select></div>
      <div class="field-group"><label for="roulette-turns">Passages par élève</label><select class="input" id="roulette-turns"><option value="2">2 passages</option><option value="3" selected>3 passages</option></select></div>
    </div>
    <fieldset class="roulette-presence" id="roulette-presence"><legend>Élèves présents</legend></fieldset>
    <p class="help">Décochez les absents. Les élèves les moins interrogés passent en priorité. Une question réussie sort du tirage, une question ratée peut revenir.</p>
    <div class="roulette-discarded" id="roulette-discarded-block" hidden>
      <h3>Questions écartées</h3>
      <p class="help">Elles ne sortent plus, pour tous les groupes de cet appareil. Pour en supprimer une partout, retirez-la de decks/questions-courtes.md.</p>
      <ul id="roulette-discarded"></ul>
    </div>
    <form class="roulette-roster" method="post" action="/prof/eleves">
      <input type="hidden" name="groupe" value="${esc(group)}"><input type="hidden" name="retour" value="roulette">
      <label for="roulette-names">Liste du groupe, un nom par ligne</label>
      <textarea class="input" name="eleves" id="roulette-names" rows="6" aria-describedby="roulette-roster-help">${esc(names.join('\n'))}</textarea>
      <p class="help" id="roulette-roster-help">Cette liste est partagée avec les quiz du groupe. Les tirages et les présences restent sur cet appareil.</p>
      <button class="btn" type="submit">Enregistrer la liste</button>
    </form>
    ${groupForm}
  </div>
</details>
<div class="roulette-bottom">
  <details class="rules roulette-history"><summary id="roulette-history-title">Historique des tirages</summary><ol id="roulette-history"></ol></details>
  <button class="btn btn-quiet" type="button" id="roulette-reset">Recommencer les tirages</button>
</div>
<noscript><p class="alert">Activez JavaScript pour utiliser le quiz-roulette.</p></noscript>
${pageJson('roulette-data', { group, names, questions })}`, '<script src="/roulette.js" type="module"></script>'));
}

// Écran des élèves, à projeter : les deux rouleaux seuls, sans les réponses
async function rouletteScreen(res, group) {
  if (!group) {
    res.writeHead(303, { Location: '/prof/roulette' });
    return res.end();
  }
  const { names, questions } = await rouletteData(group);
  send(res, `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Quiz-roulette | Carnet</title>
<link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/quiz.css"><script src="/roulette.js" type="module"></script></head>
<body><main class="roulette-screen">
  <div class="roulette-columns roulette-labels" aria-hidden="true"><span>Élève</span><span>Question <span id="roulette-question-topic"></span></span></div>
  <div class="roulette-columns roulette-stage" id="roulette-stage" aria-hidden="true">
    <div class="roulette-window"><ol class="roulette-reel" id="roulette-students"></ol></div>
    <div class="roulette-window"><ol class="roulette-reel" id="roulette-questions"></ol></div>
  </div>
  <p class="roulette-verdict" id="roulette-verdict"></p>
  <p class="sr-only" id="roulette-result" role="status" aria-live="polite" aria-atomic="true"></p>
  <div class="roulette-bar">
    <button class="btn" type="button" id="roulette-fullscreen" hidden>Plein écran</button>
    <p><kbd>Espace</kbd> tirer au sort <kbd>B</kbd> bonne réponse <kbd>M</kbd> mauvaise réponse <kbd>E</kbd> écarter la question <kbd>F</kbd> plein écran</p>
    <p class="alert" id="roulette-error" role="alert" hidden></p>
  </div>
  <noscript><p class="alert">Activez JavaScript pour utiliser le quiz-roulette.</p></noscript>
  ${pageJson('roulette-data', { group, names, questions: questions.map(({ answer, ...q }) => q) })}
</main></body></html>`);
}

// Pour chaque passage : l'état de chaque question. score null : pas finie, ou réponse rédigée à noter.
function tally(quiz, runs, answers, seen, grades, signals) {
  const key = (run, question) => `${run} ${question}`;
  const signalled = new Map(signals.map((s) => [key(s.run_id, s.question_id), s]));
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
        const signal = { leaves: 0, away_ms: 0, copies: 0, pastes: 0, ...signalled.get(k) };
        const alert = { ...signal, traps: Number(trapped(q, rows, signal.copies)) };
        return { q, rows, grade, done, score: done ? questionScore(q, rows, grade) : null, alert, flag: flagged(q, alert) };
      });
      // Les sorties d'une question de recherche ne comptent pas : chercher dans le cours fait quitter la page
      const alerts = { leaves: 0, away_ms: 0, copies: 0, pastes: 0, traps: 0 };
      for (const { q, alert: a } of cells) {
        if (!q.lookup) {
          alerts.leaves += a.leaves;
          alerts.away_ms += a.away_ms;
        }
        alerts.copies += a.copies;
        alerts.pastes += a.pastes;
        alerts.traps += a.traps;
      }
      return {
        ...r,
        attempt,
        cells,
        finished: cells.every((c) => c.done),
        doneCount: cells.filter((c) => c.done).length,
        pending: cells.filter((c) => c.done && c.score === null).length,
        total: cells.reduce((sum, c) => sum + (c.score ?? 0), 0),
        alerts,
        flag: cells.some((c) => c.flag),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.attempt - b.attempt);
}

async function load(quizId, group) {
  const inGroup = 'JOIN runs r ON r.id = x.run_id WHERE r.quiz = ? AND r.group_name = ?';
  const [[row], [sess], runs, answers, seen, grades, [roster], claims, signals] = await sql(
    ['SELECT data FROM quizzes WHERE id = ?', quizId],
    ['SELECT status FROM sessions WHERE quiz = ? AND group_name = ?', quizId, group],
    ['SELECT id, name, started_at FROM runs WHERE quiz = ? AND group_name = ? ORDER BY started_at', quizId, group],
    [`SELECT x.run_id, x.question_id, x.choice, x.correct FROM answers x ${inGroup} ORDER BY x.id`, quizId, group],
    [`SELECT x.run_id, x.question_id, x.shown_at FROM shown x ${inGroup}`, quizId, group],
    [`SELECT x.run_id, x.question_id, x.score FROM grades x ${inGroup}`, quizId, group],
    ['SELECT names FROM rosters WHERE group_name = ?', group],
    ['SELECT run_id FROM claims WHERE quiz = ? AND group_name = ?', quizId, group],
    [`SELECT x.run_id, x.question_id, x.leaves, x.away_ms, x.copies, x.pastes FROM signals x ${inGroup}`, quizId, group],
  );
  if (!row) throw httpError(404, 'Quiz introuvable');
  const quiz = readQuiz(row.data);
  const holders = new Set(claims.map((c) => c.run_id));
  const results = tally(quiz, runs, answers, seen, grades, signals).map((r) => ({ ...r, holds: holders.has(r.id) }));
  return { quiz, status: sess?.status || 'waiting', names: rosterNames(roster), results };
}

const cellClass = (s) => (s === 1 ? 's-ok' : s > 0 ? 's-half' : 's-ko');
const nameCell = (r) => `${esc(r.name)}${r.attempt > 1 ? ` <span class="attempt">essai ${r.attempt}</span>` : ''}`;
const anchor = (r, q) => `n-${r.id}-${q.id}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const secs = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};

// [« 3 sorties (1 min 05) », « 1 question copiée », « 1 réponse piège »]
function alertParts(s) {
  return [
    s.leaves && `${plural(s.leaves, 'sortie', 'sorties')}${s.away_ms ? ` (${secs(s.away_ms)})` : ''}`,
    s.copies && plural(s.copies, 'question copiée', 'questions copiées'),
    s.pastes && plural(s.pastes, 'collage bloqué', 'collages bloqués'),
    s.traps && plural(s.traps, 'réponse piège', 'réponses pièges'),
  ].filter(Boolean);
}

// Une case du tableau : la note, et un coin rouge si la question est à vérifier. Le détail s'affiche au survol.
function scoreCell(r, c) {
  const [tone, content] = !c.done ? ['', '']
    : c.score === null ? ['s-pending', `<a href="#${anchor(r, c.q)}" title="À noter">?</a>`]
    : [cellClass(c.score), num(c.score)];
  const parts = alertParts(c.alert);
  const note = parts.length ? parts.join(', ') + (c.q.lookup ? ', question de recherche' : '') : '';
  return `<td class="${['cell', tone, c.flag && 'is-flag'].filter(Boolean).join(' ')}"${note ? ` title="${esc(note)}"` : ''}>${content}${
    c.flag ? `<span class="sr-only">, à vérifier : ${esc(note)}</span>` : ''}</td>`;
}

// Le passage qui détient un nom de la liste. Le libérer laisse un autre appareil commencer sous ce nom.
const releaseForm = (r, quizId, group) => `<form class="release" method="post" action="/prof/liberer"
  data-confirm="Libérer le nom ${esc(r.name)} ? Le prochain élève qui le choisit pourra commencer. Les réponses déjà données restent.">
  ${hidden(quizId, group)}<input type="hidden" name="run" value="${esc(r.id)}"><button class="link-btn">Libérer le nom</button></form>`;

async function session(req, res, quizId, group) {
  const { quiz, status, names, results } = await load(quizId, group);
  const state = STATUS[status];
  const link = `${origin(req)}/?quiz=${encodeURIComponent(quizId)}&groupe=${encodeURIComponent(group)}`;

  send(res, page(`${quiz.title}, ${group}`, `
<p class="back"><a href="/prof">Tous les quiz</a></p>
<h1>${esc(quiz.title)}</h1>
<p class="lead">Groupe <strong>${esc(group)}</strong>. ${quiz.questions.length} questions : ${outline(quiz.questions)}.</p>
<p class="actions-row"><a href="/prof/roulette?groupe=${encodeURIComponent(group)}">Quiz-roulette avec ce groupe</a><a href="/prof/equipes?groupe=${encodeURIComponent(group)}">Tirer les équipes de ce groupe</a></p>

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

<details class="rules roster"${names.length ? '' : ' open'}>
  <summary>Liste des élèves : ${names.length ? `${names.length} noms` : 'aucune, les élèves tapent leur nom'}</summary>
  <form class="rules-body" method="post" action="/prof/eleves">${hidden(quizId, group)}
    <label for="roster-names">Un nom par ligne</label>
    <textarea id="roster-names" name="eleves" class="input" rows="10" aria-describedby="roster-help">${esc(names.join('\n'))}</textarea>
    <p class="help" id="roster-help">Avec une liste, l'élève choisit son nom dans un menu et ne peut pas en taper un autre. La liste vaut pour tous les quiz du groupe ${esc(group)}. Videz-la pour laisser les élèves taper leur nom.</p>
    <button class="btn">Enregistrer la liste</button>
  </form>
</details>

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
    <thead><tr><th scope="col">Élève</th><th scope="col">Avancement</th><th scope="col" class="num">Score</th><th scope="col">Alertes</th>
      ${questions.map((q, i) => `<th scope="col" class="q"><a href="#q-${i + 1}" title="${esc(q.question)}">${i + 1}</a></th>`).join('')}</tr></thead>
    <tbody>${results.map((r) => `<tr>
      <th scope="row">${nameCell(r)}${r.holds ? releaseForm(r, quizId, group) : ''}</th>
      <td>${r.finished ? 'Terminé' : `Question ${Math.min(r.doneCount + 1, questions.length)} sur ${questions.length}`}</td>
      <td class="num"><strong>${num(r.total)}</strong> / ${questions.length}</td>
      <td class="alerts${r.flag ? ' is-flag' : ''}">${alertParts(r.alerts).join('<br>')}</td>
      ${r.cells.map((c) => scoreCell(r, c)).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Réussite</th><td></td><td></td><td></td>${questions.map((_, i) => `<td class="q">${rate(results, i) ?? ''}</td>`).join('')}</tr></tfoot>
  </table></div>
  <ul class="legend">
    <li><span class="cell s-ok">1</span> juste au premier essai</li>
    <li><span class="cell s-half">0,5</span> juste au deuxième essai</li>
    <li><span class="cell s-ko">0</span> faux, passée ou temps écoulé</li>
    <li><span class="cell s-pending">?</span> réponse rédigée à noter</li>
    <li><span class="cell"></span> pas encore répondu</li>
    <li><span class="cell is-flag"></span> à vérifier : question copiée, collage bloqué, réponse piège, ${AWAY.leaves} sorties ou ${AWAY.ms / 1000} s hors de la page. Les questions de recherche ne comptent pas leurs sorties.</li>
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
  <p class="grade-who">${nameCell(r)}${alertParts(c.alert).length ? `<span class="alerts${c.flag ? ' is-flag' : ''}">${alertParts(c.alert).join(', ')}</span>` : ''}</p>
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

// Un nom par ligne, sans doublon. Une liste vide est retirée : les élèves tapent de nouveau leur nom.
async function setRoster(res, quiz, group, text, returnTo = '') {
  if (!group) throw httpError(400, 'Formulaire invalide');
  const names = [...new Set(text.split('\n').map((n) => clean(n, 60)).filter(Boolean))];
  await sql(names.length
    ? ['INSERT INTO rosters (group_name, names) VALUES (?, ?) ON CONFLICT (group_name) DO UPDATE SET names = excluded.names', group, names.join('\n')]
    : ['DELETE FROM rosters WHERE group_name = ?', group]);
  if (['roulette', 'equipes'].includes(returnTo)) {
    res.writeHead(303, { Location: `/prof/${returnTo}?groupe=${encodeURIComponent(group)}` });
    return res.end();
  }
  back(res, quiz, group);
}

async function release(res, quiz, group, run) {
  await sql(['DELETE FROM claims WHERE quiz = ? AND group_name = ? AND run_id = ?', quiz, group, run]);
  back(res, quiz, group);
}

async function erase(res, quiz, group) {
  const runs = 'SELECT id FROM runs WHERE quiz = ? AND group_name = ?';
  await sql(
    [`DELETE FROM answers WHERE run_id IN (${runs})`, quiz, group],
    [`DELETE FROM shown WHERE run_id IN (${runs})`, quiz, group],
    [`DELETE FROM grades WHERE run_id IN (${runs})`, quiz, group],
    [`DELETE FROM signals WHERE run_id IN (${runs})`, quiz, group],
    ['DELETE FROM runs WHERE quiz = ? AND group_name = ?', quiz, group],
    ['DELETE FROM sessions WHERE quiz = ? AND group_name = ?', quiz, group],
    ['DELETE FROM claims WHERE quiz = ? AND group_name = ?', quiz, group],
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
    ['Nom', 'Essai', 'Début', 'Terminé', 'Score', 'Sur', 'Alertes', ...quiz.questions.map((_, i) => `Q${i + 1}`)],
    ...results.map((r) => [r.name, r.attempt, when(r.started_at), r.finished ? 'oui' : 'non', num(r.total), quiz.questions.length, alertParts(r.alerts).join(', '),
      ...r.cells.map((c) => (!c.done ? '' : c.score === null ? 'à noter' : num(c.score)))]),
  ];
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${quizId}-${plain(group).replace(/ /g, '-') || 'groupe'}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end(`﻿${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`);
}
