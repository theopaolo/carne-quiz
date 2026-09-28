const $ = (id) => document.getElementById(id);
const KEYS = 'ABCDEFGH';

const KIND = {
  choice: 'Une seule réponse',
  multiple: 'Plusieurs réponses possibles, cochez toutes les bonnes',
  text: 'Réponse courte, à taper',
  open: 'Réponse rédigée, notée par le formateur',
};
const COUNT = {
  choice: ['question à choix unique', 'questions à choix unique'],
  multiple: ['question à choix multiple', 'questions à choix multiple'],
  text: ['réponse courte à taper', 'réponses courtes à taper'],
  open: ['réponse rédigée', 'réponses rédigées'],
};
const ICON = {
  ok: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  ko: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  time: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
  info: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  book: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5M12 6.5C14 5 17 4.5 20 5v13c-3-.5-6 0-8 1.5M12 6.5v13"/></svg>',
};
const TAG = {
  right: `${ICON.ok}Bonne réponse`,
  wrong: `${ICON.ko}Faux`,
  missed: `${ICON.ok}À cocher aussi`,
};

const params = new URLSearchParams(location.search);
const quizId = params.get('quiz');
const group = params.get('groupe');
// Le passage est gardé sur l'appareil : rouvrir le lien ramène à ses réponses, « Recommencer » en crée un autre
const key = (what) => `carnet-quiz:${quizId}:${group}:${what}`;

let quiz = null;
let run = null;
let name = '';
let current = 0;
let busy = false;
let timer = null;
let poller = null;

// Le stockage peut être bloqué (navigation privée, cookies refusés) : le quiz marche sans
function recall(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function remember(k, value) {
  try { value == null ? localStorage.removeItem(k) : localStorage.setItem(k, value); } catch { /* rien à garder */ }
}

async function api(path, body) {
  const res = await fetch(path, body && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `erreur ${res.status}`), { status: res.status });
  return data;
}

const num = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const points = (n) => `${num(n)} point${n >= 2 ? 's' : ''}`;
const plural = (n, [one, many]) => `${n} ${n > 1 ? many : one}`;
const cur = () => quiz.questions[current];
const total = () => quiz.questions.reduce((sum, q) => sum + (q.done ? q.score ?? 0 : 0), 0);
const fresh = (q) => ({ ...q, tries: [], done: false, score: null, locked: false });
const plain = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const draftKey = (q) => key(`brouillon:${run}:${q.id}`);

function show(section) {
  for (const id of ['loading', 'fatal', 'intro', 'play', 'end']) $(id).hidden = id !== section;
}

function alertIn(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function announce(text) {
  $('announce').textContent = text;
}

function fatal(title, text) {
  show('fatal');
  $('fatal-title').textContent = title;
  $('fatal-text').textContent = text;
}

async function init() {
  if (!quizId || !group) return fatal('Ce lien est incomplet', 'Demandez le lien du quiz au formateur.');
  let data;
  try {
    data = await api(`/api/quiz/${encodeURIComponent(quizId)}?groupe=${encodeURIComponent(group)}`);
  } catch (err) {
    return err.status === 404
      ? fatal('Quiz introuvable', 'Vérifiez le lien avec le formateur.')
      : fatal('Le quiz ne se charge pas', `${err.message}. Rechargez la page dans un instant.`);
  }
  setQuiz(data);
  run = recall(key('run'));
  if (run && quiz.status !== 'waiting') {
    try {
      await resume();
      const next = quiz.questions.findIndex((q) => !q.done);
      if (next < 0) return showEnd();
      if (quiz.status === 'closed') return showEnd('Le quiz est fermé. Vos réponses sont enregistrées.');
      return play(next);
    } catch {
      // Passage effacé par le formateur : l'élève recommence
      forgetRun();
    }
  }
  showIntro();
}

function setQuiz(data) {
  quiz = { ...data, base: data.questions, questions: data.questions.map(fresh) };
  $('quiz-title').textContent = data.title;
  document.title = `${data.title} | Carnet`;
}

function forgetRun() {
  remember(key('run'), null);
  run = null;
  quiz.questions = quiz.base.map(fresh);
}

async function resume() {
  const state = await api(`/api/run/${encodeURIComponent(run)}`);
  name = state.name;
  $('who').textContent = name;
  quiz.questions.forEach((q) => Object.assign(q, state.questions[q.id]));
}

// « 7 questions à choix unique, 3 questions à choix multiple et 3 réponses rédigées »
function outline(questions) {
  const parts = Object.keys(COUNT)
    .map((type) => [type, questions.filter((q) => q.type === type).length])
    .filter(([, n]) => n)
    .map(([type, n]) => plural(n, COUNT[type]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}.` : `${parts[0]}.`;
}

function duration(seconds) {
  return seconds < 60 ? `${seconds} s` : `${num(seconds / 60)} min`;
}

function timeRange(questions) {
  const limits = questions.map((q) => q.timeLimit).filter(Boolean);
  if (!limits.length) return 'Sans chrono';
  const [min, max] = [Math.min(...limits), Math.max(...limits)];
  return min === max ? `${duration(min)} par question` : `${duration(min)} à ${duration(max)} par question`;
}

function showIntro() {
  clearInterval(timer);
  show('intro');
  const questions = quiz.questions;
  const waiting = quiz.status === 'waiting';
  const closed = quiz.status === 'closed';
  $('intro-group').textContent = `Groupe ${group}`;
  $('intro-title').textContent = quiz.title;
  $('intro-desc').textContent = quiz.description;
  $('intro-desc').hidden = !quiz.description;
  $('fact-count').textContent = plural(questions.length, ['question', 'questions']);
  $('fact-time').textContent = timeRange(questions);
  $('fact-max').textContent = `Noté sur ${num(questions.length)}`;
  $('fact-types').textContent = outline(questions);
  $('rule-time').hidden = !questions.some((q) => q.timeLimit);
  $('rule-lookup').hidden = !questions.some((q) => q.lookup);
  $('rule-open').hidden = !questions.some((q) => q.type === 'open');
  $('start').hidden = closed;
  $('closed-note').hidden = !closed;
  $('start-btn').disabled = waiting;
  $('waiting').hidden = !waiting;
  if (!$('name').value) $('name').value = recall('carnet-quiz:name') || '';
  clearTimeout(poller);
  if (waiting) poller = setTimeout(poll, 5000);
}

// En attente de l'ouverture, la page redemande l'état du quiz toutes les 5 secondes
async function poll() {
  const data = await api(`/api/quiz/${encodeURIComponent(quizId)}?groupe=${encodeURIComponent(group)}`).catch(() => null);
  if (!data || data.status === 'waiting') {
    poller = setTimeout(poll, 5000);
    return;
  }
  setQuiz(data);
  showIntro();
  if (data.status === 'open') {
    announce('Le quiz est ouvert. Vous pouvez commencer.');
    $('name').focus();
  }
}

async function start(e) {
  e.preventDefault();
  if (busy) return;
  const typed = $('name').value.trim();
  if (!typed) {
    alertIn('intro-message', 'Écrivez votre prénom et votre nom pour commencer.');
    return $('name').focus();
  }
  busy = true;
  $('start-btn').setAttribute('aria-busy', 'true');
  try {
    ({ run, name } = await api('/api/start', { quiz: quizId, group, name: typed }));
    remember(key('run'), run);
    remember('carnet-quiz:name', typed);
    $('who').textContent = name;
    quiz.questions = quiz.base.map(fresh);
    alertIn('intro-message', '');
    busy = false;
    play(0);
  } catch (err) {
    alertIn('intro-message', err.status === 403 ? `${err.message}.` : `Impossible de commencer : ${err.message}.`);
  } finally {
    busy = false;
    $('start-btn').removeAttribute('aria-busy');
  }
}

function play(index) {
  current = index;
  show('play');
  alertIn('play-message', '');
  mount();
  paint();
  $('question').focus();
  startTimer().catch(failed);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Construit la zone de réponse d'une question. paint() met ensuite à jour son état sans la recréer.
function mount() {
  const q = cur();
  $('kind').textContent = KIND[q.type];
  $('question').innerHTML = rich(q.question);
  const source = q.lookupUrl
    ? `<a href="${esc(q.lookupUrl)}" target="_blank" rel="noopener">${rich(q.lookup)}<span class="sr-only"> (nouvel onglet)</span></a>`
    : rich(q.lookup || '');
  $('lookup').hidden = !q.lookup;
  $('lookup').innerHTML = `${ICON.book}<span><strong>Question de recherche, sans chrono.</strong> Cherchez la réponse dans ${source}.</span>`;
  const area = $('answer');
  if (q.type === 'choice' || q.type === 'multiple') {
    // Les lettres suivent l'ordre affiché, mélangé à chaque chargement
    q.order ||= shuffle(q.options);
    const type = q.type === 'choice' ? 'radio' : 'checkbox';
    area.innerHTML = `<fieldset class="choices is-${q.type}" aria-labelledby="question">${q.order.map((o, i) => `
      <label class="choice" data-id="${esc(o.id)}">
        <input type="${type}" name="choice" value="${esc(o.id)}">
        <span class="key" aria-hidden="true">${KEYS[i]}</span>
        <span class="label">${rich(o.label)}</span>
        <span class="tag"></span>
      </label>`).join('')}</fieldset>`;
  } else if (q.type === 'text') {
    area.innerHTML = `<label class="sr-only" for="field">Votre réponse</label>
      <input id="field" class="field" type="text" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Votre réponse">`;
  } else {
    area.innerHTML = `<label class="sr-only" for="field">Votre réponse</label>
      <textarea id="field" class="field" maxlength="1500" rows="8" aria-describedby="field-count" placeholder="Rédigez votre réponse ici"></textarea>
      <p class="field-note"><span id="field-count"></span></p>`;
    const field = $('field');
    field.value = recall(draftKey(q)) || '';
    const count = () => ($('field-count').textContent = `${field.value.length} / 1500 caractères`);
    count();
    // Le brouillon survit à un rechargement
    field.addEventListener('input', () => {
      count();
      remember(draftKey(q), field.value);
    });
  }
}

function paint() {
  const q = cur();
  const n = quiz.questions.length;
  const locked = q.done || q.locked;
  $('counter').textContent = `Question ${current + 1} sur ${n}`;
  $('points').textContent = points(total());
  $('timer').hidden = !q.timeLimit || q.done;
  paintTrack();
  if (q.type === 'choice' || q.type === 'multiple') paintChoices(q, locked);
  else paintField(q, locked);

  const [tone, html] = feedback(q);
  $('feedback').className = `feedback${tone ? ` is-${tone}` : ''}`;
  $('feedback').innerHTML = html;

  $('submit-btn').hidden = locked;
  $('skip-btn').hidden = locked;
  $('submit-btn').innerHTML = q.type === 'open' ? 'Envoyer ma réponse' : 'Valider <kbd>Entrée</kbd>';
  $('next-btn').hidden = !q.done;
  $('next-btn').innerHTML = `${current + 1 < n ? 'Question suivante' : 'Voir mon résultat'} <kbd>Entrée</kbd>`;
  $('keys').innerHTML = keysHelp(q);
}

function paintTrack() {
  $('track').style.setProperty('--n', quiz.questions.length);
  $('track').innerHTML = quiz.questions.map((q, i) => {
    const state = !q.done ? '' : q.score === null ? 'pending' : q.score >= 1 ? 'ok' : q.score > 0 ? 'half' : 'ko';
    return `<li class="${[state && `is-${state}`, i === current && 'is-current'].filter(Boolean).join(' ')}"></li>`;
  }).join('');
}

function paintChoices(q, locked) {
  const last = q.tries.at(-1)?.value.split(',') || [];
  const right = new Set(q.done ? [q.solution].flat() : []);
  for (const label of $('answer').querySelectorAll('.choice')) {
    const id = label.dataset.id;
    const input = label.querySelector('input');
    const triedWrong = q.type === 'choice' && q.tries.some((t) => t.value === id && !t.correct);
    let state = '';
    if (right.has(id)) state = q.type === 'multiple' && !last.includes(id) ? 'missed' : 'right';
    else if (triedWrong || (q.done && q.type === 'multiple' && last.includes(id))) state = 'wrong';
    label.className = ['choice', state && `is-${state}`, (locked || triedWrong) && 'is-locked'].filter(Boolean).join(' ');
    label.querySelector('.tag').innerHTML = TAG[state] || '';
    input.disabled = locked || triedWrong;
    // Une fois la question finie, les couleurs montrent la correction à la place de la sélection
    if (q.done || triedWrong) input.checked = false;
  }
}

function paintField(q, locked) {
  const field = $('field');
  field.disabled = locked;
  if (q.done && q.tries.length) field.value = q.tries.at(-1).value;
  if (q.type !== 'text') return;
  field.classList.toggle('is-right', q.done && q.score > 0);
  field.classList.toggle('is-wrong', q.done && !(q.score > 0) && q.tries.length > 0);
}

function label(q, id) {
  return rich(q.options.find((o) => o.id === id)?.label ?? id);
}

function solutionText(q) {
  if (q.type === 'choice') return label(q, q.solution);
  if (q.type === 'multiple') return q.solution.map((id) => label(q, id)).join(', ');
  return rich(q.solution);
}

// [ton, html] du message sous les réponses
function feedback(q) {
  const box = (title, icon, body = '') => `<p class="feedback-title">${icon}<span>${title}</span></p>${body}`;
  const explanation = q.explanation ? `<p class="explanation">${rich(q.explanation)}</p>` : '';
  if (!q.done) {
    if (q.locked) return ['ko', box('Temps écoulé.', ICON.time, '<p>La correction arrive.</p>')];
    const wrong = q.tries.filter((t) => !t.correct);
    if (!wrong.length) return ['', ''];
    const title = q.type === 'multiple' ? 'Ce n\'est pas la bonne combinaison.'
      : q.type === 'text' ? `« ${esc(wrong.at(-1).value)} » n'est pas la réponse attendue.`
      : 'Ce n\'est pas cette réponse.';
    const hint = q.hint ? `<p class="hint"><strong>Indice :</strong> ${rich(q.hint)}</p>` : '';
    return ['retry', box(title, ICON.ko, `<p>Il vous reste un essai, qui vaut 0,5 point.</p>${hint}`)];
  }
  if (q.type === 'open') {
    const expected = q.solution ? `<p><strong>Ce qui était attendu :</strong> ${rich(q.solution)}</p>` : '';
    if (!q.tries.length) return ['ko', box(q.skipped ? 'Question passée. 0 point.' : 'Temps écoulé. 0 point.', q.skipped ? ICON.info : ICON.time, expected + explanation)];
    if (q.score === null) return ['info', box('Réponse envoyée.', ICON.ok, `<p>Le formateur la notera sur 1 point.</p>${expected}${explanation}`)];
    return [q.score >= 1 ? 'ok' : q.score > 0 ? 'half' : 'ko', box(`Note du formateur : ${points(q.score)}.`, ICON.info, expected + explanation)];
  }
  if (q.score >= 1) return ['ok', box('Bonne réponse. +1 point', ICON.ok, explanation)];
  if (q.score > 0) return ['half', box('Bonne réponse au deuxième essai. +0,5 point', ICON.ok, explanation)];
  const title = q.skipped ? 'Question passée. 0 point.' : q.timeUp ? 'Temps écoulé. 0 point.' : 'Pas la bonne réponse. 0 point.';
  const lead = q.type === 'multiple' ? 'Les bonnes réponses' : 'La bonne réponse';
  return ['ko', box(title, q.timeUp ? ICON.time : ICON.ko, `<p><strong>${lead} :</strong> ${solutionText(q)}</p>${explanation}`)];
}

function keysHelp(q) {
  const k = (t) => `<kbd>${t}</kbd>`;
  if (q.done) return `${k('Entrée')} pour continuer.`;
  if (q.locked) return '';
  const letters = `${k('A')} à ${k(KEYS[q.options?.length - 1])}`;
  if (q.type === 'choice') return `Clavier : ${letters} pour choisir, ${k('Entrée')} pour valider.`;
  if (q.type === 'multiple') return `Clavier : ${letters} pour cocher ou décocher, ${k('Entrée')} pour valider.`;
  if (q.type === 'text') return `${k('Entrée')} pour valider.`;
  return `${k('Ctrl')} + ${k('Entrée')}, ou ${k('Cmd')} + ${k('Entrée')} sur Mac, pour envoyer.`;
}

function readValue(q) {
  if (q.type === 'choice') return $('answer').querySelector('input:checked')?.value ?? null;
  if (q.type === 'multiple') {
    const ids = [...$('answer').querySelectorAll('input:checked')].map((i) => i.value);
    return ids.length ? ids : null;
  }
  return $('field').value.trim() || null;
}

function alreadyTried(q, value) {
  const same = q.type === 'multiple' ? [...value].sort().join(',') : q.type === 'text' ? plain(value) : value;
  return q.tries.some((t) => (q.type === 'text' ? plain(t.value) : t.value) === same);
}

async function submit(e) {
  e?.preventDefault();
  const q = cur();
  if (busy || q.done || q.locked) return;
  const value = readValue(q);
  if (value === null) {
    return alertIn('play-message', q.type === 'choice' ? 'Choisissez une réponse, puis validez.'
      : q.type === 'multiple' ? 'Cochez au moins une réponse, puis validez.' : 'Écrivez votre réponse, puis validez.');
  }
  if (alreadyTried(q, value)) return alertIn('play-message', 'Vous avez déjà essayé cette réponse.');
  await send({ value });
}

async function send(body) {
  const q = cur();
  busy = true;
  $('submit-btn').setAttribute('aria-busy', 'true');
  try {
    // { tries, done } et, une fois la question finie, { score, skipped, timeUp, solution, explanation }
    Object.assign(q, await api('/api/answer', { run, question: q.id, ...body }));
    alertIn('play-message', '');
    if (q.done) remember(draftKey(q), null);
  } catch (err) {
    failed(err);
  }
  busy = false;
  $('submit-btn').removeAttribute('aria-busy');
  if ($('play').hidden || q !== cur()) return;
  paint();
  // Les boutons changent : le focus va à la suite, ou revient à la réponse pour le deuxième essai
  if (q.done) $('next-btn').focus();
  else if (q.type === 'choice') $('answer').querySelector('input:not(:disabled)')?.focus();
  else if (q.type === 'text') $('field').select();
}

function skip() {
  const q = cur();
  if (!busy && !q.done && !q.locked) send({ skip: true });
}

function clock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Le serveur note le premier affichage d'une question minutée : recharger la page ne redonne pas de temps
async function startTimer() {
  clearInterval(timer);
  const q = cur();
  if (!q.timeLimit || q.done) return;
  $('timer-text').textContent = clock(q.timeLimit * 1000);
  $('timer').classList.remove('is-short');
  const state = await api('/api/show', { run, question: q.id });
  if (q !== cur() || q.done) return;
  // Seul un résultat final remplace l'état : une réponse envoyée entre-temps reste valable
  if (state.done) {
    Object.assign(q, state);
    return paint();
  }
  const end = Date.now() + state.left;
  let warned = false;
  const tick = async () => {
    if (q.done || q !== cur() || $('play').hidden) return clearInterval(timer);
    const left = end - Date.now();
    $('timer-text').textContent = clock(Math.max(0, left));
    $('timer').classList.toggle('is-short', left < 10_500);
    if (!warned && left < 10_500 && left > 0) {
      warned = true;
      announce('Plus que 10 secondes.');
    }
    if (left > 0) return;
    if (!q.locked) {
      q.locked = true;
      announce('Temps écoulé.');
      // La réponse en cours part avant le blocage : le serveur l'accepte encore 2 secondes
      const value = readValue(q);
      if (value !== null && !busy && !alreadyTried(q, value)) await send({ value });
      else paint();
    }
    if (left < -2500 && !busy && !q.done) {
      busy = true;
      try {
        const final = await api('/api/show', { run, question: q.id });
        if (final.done && !q.done && q === cur()) {
          Object.assign(q, final);
          paint();
          $('next-btn').focus();
        }
      } finally {
        busy = false;
      }
    }
  };
  clearInterval(timer);
  timer = setInterval(() => tick().catch(failed), 250);
  await tick();
}

// 403 : le formateur a fermé le quiz. 404 : il a effacé les résultats du groupe.
function failed(err) {
  if (err.status === 403) {
    quiz.status = 'closed';
    return showEnd('Le formateur a fermé le quiz. Vos réponses sont enregistrées.');
  }
  if (err.status === 404) {
    forgetRun();
    showIntro();
    return alertIn('intro-message', 'Ce passage n\'existe plus. Vous pouvez recommencer le quiz.');
  }
  alertIn('play-message', `${err.message}. Vérifiez votre connexion, puis réessayez.`);
}

function next() {
  if (!cur().done) return;
  if (current + 1 < quiz.questions.length) play(current + 1);
  else showEnd();
}

function verdict(ratio) {
  if (ratio >= 0.85) return 'Très bon résultat. Vous savez appliquer les méthodes vues en cours.';
  if (ratio >= 0.6) return 'Bon résultat. Relisez les questions manquées ci-dessous pour consolider.';
  if (ratio >= 0.4) return 'Les bases sont là. Reprenez dans le cours les points des questions manquées.';
  return 'Reprenez le cours sur les questions manquées, puis recommencez le quiz.';
}

function showEnd(note = '') {
  clearInterval(timer);
  show('end');
  const questions = quiz.questions;
  const max = questions.length;
  const got = total();
  const scored = questions.filter((q) => q.done && q.score !== null);
  const pending = questions.filter((q) => q.done && q.score === null).length;
  const unanswered = questions.filter((q) => !q.done).length;
  const count = (test) => scored.filter((q) => test(q.score)).length;

  alertIn('end-note', note);
  $('end-kicker').textContent = unanswered ? 'Quiz interrompu' : 'Quiz terminé';
  $('end-title').textContent = name ? `${name}, voici votre résultat` : 'Votre résultat';
  $('score-value').textContent = num(got);
  $('score-max').textContent = `sur ${points(max)}`;
  $('meter-fill').style.width = `${(100 * got) / max}%`;
  $('verdict').textContent = scored.length ? verdict(got / scored.length) : '';
  $('tally').innerHTML = [
    ['ok', count((s) => s >= 1), 'justes, 1 point'],
    ['half', count((s) => s > 0 && s < 1), 'à moitié, 0,5 point'],
    ['ko', count((s) => s === 0), 'manquées, 0 point'],
    ['pending', pending, 'à noter par le formateur'],
    ['none', unanswered, 'sans réponse'],
  ].filter(([tone, n]) => n || tone === 'ok' || tone === 'ko')
    .map(([tone, n, text]) => `<div class="tally-${tone}"><dt>${text}</dt><dd>${n}</dd></div>`).join('');
  $('pending-note').hidden = !pending;
  $('pending-note').textContent = pending
    ? `${plural(pending, ['réponse rédigée attend', 'réponses rédigées attendent'])} la note du formateur : jusqu'à ${points(pending)} de plus. Rouvrez ce lien plus tard pour voir la note.`
    : '';
  $('course-link').hidden = !quiz.courseUrl;
  if (quiz.courseUrl) $('course-link').href = quiz.courseUrl;
  $('restart-btn').hidden = quiz.status !== 'open';
  $('restart-btn').className = quiz.courseUrl ? 'btn' : 'btn btn-primary';
  $('review').innerHTML = questions.map(reviewItem).join('');
  $('end-title').focus();
}

function answerText(q) {
  if (!q.tries.length) return q.skipped ? 'Question passée' : q.timeUp ? 'Pas de réponse, temps écoulé' : 'Pas de réponse';
  if (q.type === 'open') return `<span class="pre">${esc(q.tries[0].value)}</span>`;
  const one = (t) => (q.type === 'choice' ? label(q, t.value)
    : q.type === 'multiple' ? t.value.split(',').map((id) => label(q, id)).join(', ') : `« ${esc(t.value)} »`);
  return q.tries.map(one).join(', puis ');
}

function reviewItem(q, i) {
  const [tone, badge] = !q.done ? ['none', 'Sans réponse']
    : q.score === null ? ['pending', 'À noter']
    : q.score >= 1 ? ['ok', '1 point']
    : q.score > 0 ? ['half', '0,5 point'] : ['ko', '0 point'];
  const right = q.done && q.type !== 'open' && q.score < 1 ? `<div><dt>${q.type === 'multiple' ? 'Bonnes réponses' : 'Bonne réponse'}</dt><dd>${solutionText(q)}</dd></div>` : '';
  const expected = q.done && q.type === 'open' && q.solution ? `<div><dt>Ce qui était attendu</dt><dd>${rich(q.solution)}</dd></div>` : '';
  return `<li class="review-item">
    <p class="review-head"><span>Question ${i + 1}</span><span class="badge badge-${tone}">${badge}</span></p>
    <p class="review-q">${rich(q.question)}</p>
    <dl class="review-answers">
      <div><dt>Votre réponse</dt><dd>${answerText(q)}</dd></div>${right}${expected}
    </dl>
    ${q.done && q.explanation ? `<p class="review-expl">${rich(q.explanation)}</p>` : ''}
  </li>`;
}

function restart() {
  forgetRun();
  showIntro();
  $('name').focus();
}

$('start').addEventListener('submit', start);
$('answer-form').addEventListener('submit', submit);
$('skip-btn').addEventListener('click', skip);
$('next-btn').addEventListener('click', next);
$('restart-btn').addEventListener('click', restart);

document.addEventListener('keydown', (e) => {
  if (!quiz || $('play').hidden) return;
  const q = cur();
  if (e.key === 'Enter') {
    if (e.target.matches('textarea')) {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submit();
      }
      return;
    }
    // Entrée sur un bouton ou un lien déclenche déjà son action
    if (e.target.matches('button, a') || e.altKey || e.shiftKey) return;
    e.preventDefault();
    return q.done ? next() : submit();
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input[type=text], textarea')) return;
  const inputs = $('answer').querySelectorAll('.choice input');
  const i = KEYS.indexOf(e.key.toUpperCase());
  if (i > -1 && i < inputs.length && !inputs[i].disabled) {
    e.preventDefault();
    inputs[i].click();
    inputs[i].focus();
  }
});

// Texte des questions : `code` et ```blocs``` en HTML, le reste échappé. Les espaces avant « : ? ! »
// et dans les guillemets deviennent insécables, pour qu'un signe ne parte pas seul à la ligne.
function rich(text) {
  if (!text) return '';
  let html = frenchSpaces(esc(text)).replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, (m, code) => `<code>${code}</code>`);
  return html.includes('<pre>') ? html : html.replace(/\n/g, '<br>');
}

function frenchSpaces(text) {
  return text.replace(/« /g, '«\u00a0').replace(/ ([»:;?!])/g, '\u00a0$1');
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

init();
