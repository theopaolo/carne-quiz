const LETTERS = 'ABCDEFGH';
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const quizId = params.get('quiz');
const group = params.get('groupe');
// Le passage en cours survit à un rechargement de l'onglet, pas à sa fermeture
const runKey = `carnet-quiz:${quizId}:${group}`;

let quiz = null;
let run = null;
let current = 0;
let busy = false;
let timer;

// Le stockage peut être bloqué (navigation privée, cookies refusés) : le quiz marche sans
function recall(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function remember(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* rien à garder */ }
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

function say(text, tone = 'ko') {
  // Le même texte n'est pas réécrit : un lecteur d'écran le relirait
  if ($('message').textContent === text) return;
  $('message').textContent = text;
  $('message').className = `message ${tone}`;
  $('message').hidden = !text;
}

// 403 : le formateur a fermé le quiz pendant le passage
function failed(err) {
  if (err.status === 403) return showResults('Le formateur a fermé le quiz. Vos réponses sont enregistrées.');
  say(`${err.message}. Vérifiez la connexion et réessayez.`);
}

const boot = () => init().catch((err) => say(`Impossible de charger le quiz : ${err.message}.`));

async function init() {
  if (!quizId || !group) return say('Ce lien est incomplet. Demandez le lien du quiz au formateur.');
  const data = await api(`/api/quiz/${encodeURIComponent(quizId)}?groupe=${encodeURIComponent(group)}`);
  $('quiz-title').textContent = data.title;
  document.title = `${data.title} | Carnet`;
  if (data.status === 'closed') return say('Ce quiz est fermé.', 'info');
  if (data.status === 'waiting') {
    say('Le quiz n\'est pas encore ouvert. Cette page se met à jour toute seule dès que le formateur l\'ouvre.', 'info');
    return setTimeout(boot, 5000);
  }
  say('');
  quiz = data;
  quiz.questions.forEach((q) => Object.assign(q, { shuffled: shuffle(q.options), wrong: [], done: false, score: 0, hintShown: false }));
  run = recall(sessionStorage, runKey);
  if (run) {
    try {
      const state = await api(`/api/run/${encodeURIComponent(run)}`);
      quiz.questions.forEach((q) => Object.assign(q, state[q.id], { hintShown: state[q.id].wrong.length > 0 }));
      current = quiz.questions.findIndex((q) => !q.done);
      if (current < 0) return showResults();
      render();
      return startTimer();
    } catch {
      // Passage effacé ou introuvable : l'élève recommence
      run = null;
      current = 0;
    }
  }
  $('name').value = recall(localStorage, 'carnet-quiz:name') || '';
  $('start').hidden = false;
  $('name').focus();
}

async function start(e) {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const name = $('name').value.trim();
  try {
    ({ run } = await api('/api/start', { quiz: quizId, group, name }));
    remember(localStorage, 'carnet-quiz:name', name);
    remember(sessionStorage, runKey, run);
    say('');
    $('start').hidden = true;
    render();
    $('question').focus();
    startTimer().catch(failed);
  } catch (err) {
    say(`Impossible de commencer : ${err.message}.`);
  }
  busy = false;
}

// Le serveur note le premier affichage d'une question minutée : recharger la page ne redonne pas de temps
async function startTimer() {
  clearInterval(timer);
  const q = quiz.questions[current];
  if (!q.timeLimit || q.done) return;
  $('timer').textContent = `${q.timeLimit} s`;
  const state = await api('/api/show', { run, question: q.id });
  if (q !== quiz.questions[current] || q.done) return;
  // Seul un résultat final remplace l'état : une réponse envoyée entre-temps reste valable
  if (state.done) {
    Object.assign(q, state);
    return render();
  }
  const end = Date.now() + state.left;
  const tick = async () => {
    if (q.done || q !== quiz.questions[current]) return clearInterval(timer);
    const left = end - Date.now();
    $('timer').textContent = `${Math.max(0, Math.ceil(left / 1000))} s`;
    $('timer').classList.toggle('short', left < 10_000);
    if (left > 0) return;
    if (!q.locked) {
      q.locked = true;
      render();
    }
    // Le serveur prend encore une réponse 2 s après la fin, puis il envoie la correction
    if (left < -2500 && !busy) {
      busy = true;
      try {
        const final = await api('/api/show', { run, question: q.id });
        if (final.done && !q.done) {
          Object.assign(q, final);
          render();
          $('next-btn').focus();
        }
      } finally {
        busy = false;
      }
    }
  };
  clearInterval(timer);
  timer = setInterval(() => tick().catch(failed), 250);
  tick().catch(failed);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const totalScore = () => quiz.questions.reduce((s, q) => s + q.score, 0);
const num = (n) => n.toLocaleString('fr-FR');

function render() {
  const q = quiz.questions[current];
  const total = quiz.questions.length;

  $('progress').textContent = `${current + 1} / ${total}`;
  $('score').textContent = `score ${num(totalScore())}`;
  $('meta').textContent = [q.difficulty, ...(q.topics || [])].filter(Boolean).join(', ');
  $('question').innerHTML = highlightCode(q.question);

  $('options').innerHTML = q.shuffled.map((o, i) => {
    const cls = ['option'];
    if (q.done && o.id === q.correctAnswer) cls.push('correct');
    if (q.wrong.includes(o.id)) cls.push('wrong');
    const disabled = q.done || q.locked || q.wrong.includes(o.id) ? 'disabled' : '';
    return `<button type="button" class="${cls.join(' ')}" data-id="${o.id}" ${disabled}>
      <span class="letter">${LETTERS[i]}</span>
      <span class="label">${highlightCode(o.label)}</span>
    </button>`;
  }).join('');

  $('hint').hidden = !q.hintShown || !q.hint;
  $('hint').innerHTML = q.hint ? `Indice : ${highlightCode(q.hint)}` : '';
  $('hint-btn').hidden = q.done || q.locked || q.hintShown || !q.hint;
  // Une question finie garde le temps qu'il restait : la mise en page ne bouge pas
  $('timer').hidden = !q.timeLimit;

  $('feedback').className = 'feedback';
  $('feedback').innerHTML = '';
  if (q.done) {
    const correctLabel = q.options.find((o) => o.id === q.correctAnswer).label;
    const verdict = q.score === 1 ? 'Juste.'
      : q.score > 0 ? 'Juste au deuxième essai.'
      : `${q.timeUp ? 'Temps écoulé' : 'Faux'}. Réponse : ${highlightCode(correctLabel)}`;
    $('feedback').classList.add(q.score > 0 ? 'ok' : 'ko');
    $('feedback').innerHTML = `<p class="verdict">${verdict}</p>` +
      (q.explanation ? `<p class="explanation">${highlightCode(q.explanation)}</p>` : '');
  } else if (q.locked) {
    $('feedback').classList.add('ko');
    $('feedback').innerHTML = '<p class="verdict">Temps écoulé.</p>';
  }

  $('next-btn').hidden = !q.done;
  $('next-btn').innerHTML = `${current + 1 < total ? 'Suivant' : 'Résultat'} <kbd>Entrée</kbd>`;
  $('question-card').hidden = false;
}

async function answer(optionId) {
  const q = quiz.questions[current];
  if (busy || q.done || q.locked || q.wrong.includes(optionId)) return;
  busy = true;
  try {
    // { wrong, done } et, une fois la question finie, { score, timeUp, correctAnswer, explanation }
    Object.assign(q, await api('/api/answer', { run, question: q.id, choice: optionId }));
    if (!q.done) q.hintShown = true;
    say('');
  } catch (err) {
    failed(err);
  }
  busy = false;
  if (!$('results').hidden) return;
  render();
  // Les boutons sont recréés : le focus revient sur la suite ou sur la première option libre
  (q.done ? $('next-btn') : $('options').querySelector('.option:not(:disabled)'))?.focus();
}

function showHint() {
  quiz.questions[current].hintShown = true;
  render();
}

function next() {
  if (!quiz.questions[current].done) return;
  if (current + 1 < quiz.questions.length) {
    current++;
    render();
    $('question').focus();
    startTimer().catch(failed);
  } else {
    showResults();
  }
}

function showResults(note = 'Vos réponses sont enregistrées.') {
  clearInterval(timer);
  say('');
  const total = quiz.questions.length;
  const missed = quiz.questions.filter((q) => q.score < 1);
  $('question-card').hidden = true;
  $('progress').textContent = 'Terminé';
  $('score').textContent = '';
  $('results').hidden = false;
  $('results').innerHTML = `
    <h1 class="final-score" tabindex="-1">Score : ${num(totalScore())} / ${total}</h1>
    <p>${note}</p>
    ${missed.length ? `<h2 class="meta">À revoir : ${missed.length}</h2><ol class="missed">` +
      missed.map((q) => `<li>${highlightCode(q.question)}<br>
        ${q.done ? `<span class="missed-answer">${highlightCode(q.options.find((o) => o.id === q.correctAnswer).label)}</span>` : 'Pas de réponse'}</li>`).join('') +
      '</ol>' : '<p>Sans faute.</p>'}`;
  $('results').querySelector('h1').focus();
}

$('start').addEventListener('submit', start);
$('options').addEventListener('click', (e) => {
  const btn = e.target.closest('.option');
  if (btn) answer(btn.dataset.id);
});
$('hint-btn').addEventListener('click', showHint);
$('next-btn').addEventListener('click', next);

document.addEventListener('keydown', (e) => {
  if (!quiz || !run || !$('results').hidden || e.target.matches('input')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const q = quiz.questions[current];
  const idx = LETTERS.indexOf(e.key.toUpperCase());
  if (idx > -1 && idx < q.shuffled.length) answer(q.shuffled[idx].id);
  else if (e.key.toUpperCase() === 'H') showHint();
  // Entrée sur un bouton déclenche déjà son clic
  else if ((e.key === 'Enter' && !e.target.matches('button')) || e.key === 'ArrowRight') next();
});

// `code` et ```blocs``` en HTML, le reste échappé
function highlightCode(text) {
  if (!text) return '';
  let result = escapeHtml(text).replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`);
  result = result.replace(/`([^`]+)`/g, (m, code) => `<code>${code}</code>`);
  if (!result.includes('<pre>')) result = result.replace(/\n/g, '<br>');
  return result;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

boot();
