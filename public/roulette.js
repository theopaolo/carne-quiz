import { draw, spins } from './roulette-draw.js';

// La régie (/prof/roulette) et l'écran des élèves (/prof/roulette/ecran) partagent la séance du groupe,
// enregistrée dans le navigateur. Chaque page relit la séance quand l'autre l'enregistre.
const data = document.getElementById('roulette-data');
if (data) {
  const roulette = session(JSON.parse(data.textContent));
  if (el('stage')) screen(roulette);
  else desk(roulette);
}

function el(id) {
  return document.getElementById(`roulette-${id}`);
}

function error(message) {
  el('error').textContent = message;
  el('error').hidden = !message;
}

// Une question écartée ne sort plus, pour tous les groupes de cet appareil.
const DISCARDED = 'carnet:roulette:ecartees';

function keep(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    error('Les tirages ne peuvent pas être enregistrés. Gardez cette page ouverte pour conserver la séance.');
  }
}

function session({ group, names, questions }) {
  const key = `carnet:roulette:${group}`;
  const s = {
    names,
    questions,
    onchange: () => {},
    active: () => names.filter((name) => !s.state.excluded.includes(name)),
    pool: () => questions.filter((q) => (!s.state.topic || q.topic === s.state.topic) && !s.discarded.includes(q.id)),
    passed: () => new Set(s.state.history.filter((h) => h.correct === true).map((h) => h.questionId)),
    current: () => s.state.history.at(-1),
    question: () => questions.find((q) => q.id === s.current()?.questionId),
    count: (name) => s.state.history.filter((h) => h.name === name).length,
    remaining: () => s.active().reduce((sum, name) => sum + Math.max(0, s.state.turns - s.count(name)), 0),
    save: () => keep(key, s.state),
    next() {
      const next = !s.damaged && draw(s.active(), s.pool(), s.state.history, s.state.turns);
      if (next) {
        s.state.history.push(next);
        s.save();
      }
      return next;
    },
    grade(correct) {
      if (s.current()?.correct !== null) return false;
      s.current().correct = correct;
      s.save();
      return true;
    },
    // L'élève garde son tour avec une autre question, ou le rend si plus aucune question ne reste
    discard() {
      const last = s.current();
      if (last?.correct !== null) return false;
      s.discarded.push(last.questionId);
      keep(DISCARDED, s.discarded);
      const history = s.state.history.slice(0, -1);
      const next = draw([last.name], s.pool(), history, s.state.turns);
      s.state.history = next ? [...history, next] : history;
      s.save();
      return true;
    },
    restore(id) {
      s.discarded = s.discarded.filter((d) => d !== id);
      keep(DISCARDED, s.discarded);
    },
  };
  function loadDiscarded() {
    try {
      const value = JSON.parse(localStorage.getItem(DISCARDED) || '[]');
      s.discarded = Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    } catch {
      s.discarded = [];
    }
  }
  function load() {
    s.state = { history: [], excluded: [], turns: 3, topic: '' };
    s.damaged = false;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const value = JSON.parse(saved);
        if (!Array.isArray(value.history) || !value.history.every((h, i) => h && typeof h.name === 'string'
          && typeof h.questionId === 'string' && (typeof h.correct === 'boolean' || (h.correct === null && i === value.history.length - 1)))
          || !Array.isArray(value.excluded) || !value.excluded.every((name) => typeof name === 'string')
          || ![2, 3].includes(value.turns) || typeof value.topic !== 'string') throw new Error('Tirages invalides');
        s.state = value;
        s.state.history = s.state.history.filter((h) => questions.some((q) => q.id === h.questionId));
        if (s.current()?.correct === null && !names.includes(s.current().name)) s.state.history.pop();
        if (!questions.some((q) => q.topic === s.state.topic)) s.state.topic = '';
      }
      error('');
    } catch (err) {
      if (err.name === 'SecurityError') error('Le navigateur bloque l’enregistrement. Gardez cette page ouverte pour conserver les tirages.');
      else {
        s.damaged = true;
        error('Les tirages enregistrés sont illisibles. Cliquez sur « Recommencer les tirages » dans la régie pour démarrer une nouvelle séance.');
      }
    }
  }
  loadDiscarded();
  load();
  addEventListener('storage', (event) => {
    if (event.key === DISCARDED) loadDiscarded();
    else if (event.key === key) load();
    else return;
    s.onchange();
  });
  return s;
}

// Régie du formateur : le tirage en cours avec sa réponse, l'évaluation, les réglages et l'historique
function desk(r) {
  for (const name of r.names) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    label.append(input, document.createElement('span'));
    el('presence').append(label);
  }

  function render() {
    const { state } = r;
    const last = r.current();
    const question = r.question();
    const pending = last?.correct === null;
    const active = r.active();
    const eligible = r.pool();
    const passed = r.passed();
    const available = eligible.filter((q) => !passed.has(q.id));
    const remaining = r.remaining();
    const discarded = r.questions.filter((q) => r.discarded.includes(q.id));
    el('draw').hidden = pending;
    el('draw').disabled = r.damaged || !remaining || !available.length;
    el('draw').textContent = state.history.length ? 'Tirage suivant' : 'Tirer au sort';
    el('grading').hidden = !pending;
    el('student').textContent = last?.name || 'Qui répond ?';
    el('question').textContent = question?.question || 'Quelle question ?';
    el('student').classList.toggle('is-empty', !last);
    el('question').classList.toggle('is-empty', !question);
    el('question-topic').textContent = question?.topic || '';
    el('answer').textContent = question?.answer || '';
    el('answer-block').hidden = !question?.answer;
    el('result').textContent = last ? `${last.name}. ${question.question}` : '';
    el('feedback').textContent = last?.correct === true ? 'Bonne réponse. Cette question sort du tirage.'
      : last?.correct === false ? 'Mauvaise réponse. Cette question pourra revenir.' : '';
    el('feedback').className = last?.correct === true ? 'roulette-correct' : 'roulette-incorrect';
    el('progress').textContent = r.names.length
      ? `${remaining} passages restants. ${eligible.length - available.length}/${eligible.length} questions réussies.` : '';
    el('status').textContent = r.damaged ? 'Recommencez les tirages pour débloquer la séance.'
      : !r.names.length ? 'Ajoutez la liste des élèves dans les réglages.'
      : !active.length ? 'Cochez au moins un élève présent dans les réglages.'
      : pending ? ''
      : !remaining ? `Les ${state.turns} passages sont terminés pour tous les élèves présents.`
      : !available.length ? `Toutes les questions de ce thème sont réussies${discarded.length ? ' ou écartées' : ''}. Changez de thème dans les réglages ou recommencez les tirages.`
      : !state.history.length ? 'Ouvrez l’écran des élèves sur le projecteur, puis lancez le premier tirage.' : '';
    el('status').hidden = !el('status').textContent;

    el('turns').value = state.turns;
    el('topic').value = state.topic;
    el('turns').disabled = el('topic').disabled = el('presence').disabled = pending;
    el('settings-summary').textContent = `${state.topic || 'Tous les thèmes'}, ${state.turns} passages, ${active.length}/${r.names.length} présents`
      + (discarded.length ? `, ${discarded.length} question${discarded.length > 1 ? 's' : ''} écartée${discarded.length > 1 ? 's' : ''}` : '');
    el('discarded-block').hidden = !discarded.length;
    el('discarded').replaceChildren(...discarded.map((q) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = q.question;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-quiet';
      button.value = q.id;
      button.textContent = 'Remettre';
      li.append(text, button);
      return li;
    }));
    for (const input of el('presence').querySelectorAll('input')) {
      input.checked = !state.excluded.includes(input.value);
      input.nextElementSibling.textContent = `${input.value} (${r.count(input.value)}/${state.turns})`;
    }
    el('reset').disabled = !state.history.length && !r.damaged;
    el('history-title').textContent = `Historique des tirages (${state.history.length})`;
    el('history').replaceChildren(...state.history.slice().reverse().map((h) => {
      const li = document.createElement('li');
      const who = document.createElement('strong');
      who.textContent = h.name;
      const text = document.createElement('span');
      text.textContent = r.questions.find((q) => q.id === h.questionId).question;
      const result = document.createElement('span');
      result.className = h.correct === true ? 'roulette-correct' : h.correct === false ? 'roulette-incorrect' : '';
      result.textContent = h.correct === true ? 'Réussie' : h.correct === false ? 'À revoir' : 'À évaluer';
      li.append(who, text, result);
      return li;
    }));
  }

  r.onchange = render;
  el('draw').addEventListener('click', () => {
    if (!r.next()) return;
    render();
    el('good').focus({ preventScroll: true });
  });
  for (const [id, correct] of [['good', true], ['bad', false]]) {
    el(id).addEventListener('click', () => {
      if (!r.grade(correct)) return;
      render();
      if (el('draw').disabled) el('status').focus({ preventScroll: true });
      else el('draw').focus({ preventScroll: true });
    });
  }
  el('discard').addEventListener('click', () => {
    const name = r.current()?.name;
    if (!r.discard()) return;
    render();
    const again = r.current()?.correct === null;
    el('feedback').className = '';
    el('feedback').textContent = again ? `Question écartée. Nouvelle question pour ${name}.`
      : `Question écartée. Plus aucune question disponible, ${name} garde son passage.`;
    if (!again) el(el('draw').disabled ? 'status' : 'draw').focus({ preventScroll: true });
  });
  el('discarded').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    r.restore(button.value);
    render();
    (el('discarded').querySelector('button') || el('settings-summary').parentElement).focus({ preventScroll: true });
  });
  el('status').tabIndex = -1;
  for (const id of ['topic', 'turns']) el(id).addEventListener('change', () => {
    r.state.topic = el('topic').value;
    r.state.turns = Number(el('turns').value);
    r.save();
    render();
  });
  el('presence').addEventListener('change', () => {
    r.state.excluded = [...el('presence').querySelectorAll('input:not(:checked)')].map((input) => input.value);
    r.save();
    render();
  });
  el('reset').addEventListener('click', () => {
    if (!confirm('Recommencer les tirages ? L’historique et les questions réussies de ce groupe seront remis à zéro sur cet appareil.')) return;
    r.state.history = [];
    r.damaged = false;
    error('');
    r.save();
    render();
    el('draw').focus({ preventScroll: true });
  });
  // Une fenêtre à part, à glisser sur le projecteur. Si le navigateur la bloque, le lien ouvre un onglet.
  el('open').addEventListener('click', (event) => {
    if (window.open(el('open').href, el('open').target, 'popup,width=1280,height=720')) event.preventDefault();
  });
  render();
}

// Écran des élèves : les deux rouleaux, sans réglage ni réponse. Le clavier ou une télécommande de présentation
// lance le tirage et l'évaluation, pour animer depuis cet écran seul.
function screen(r) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let shown = { length: r.state.history.length, questionId: r.current()?.questionId };
  let busy = false;

  function rows(items, selected, placeholder) {
    const index = items.indexOf(selected);
    return Array.from({ length: 5 }, (_, i) => {
      if (!items.length) return i === 2 ? placeholder : '';
      if (index < 0) return i === 2 ? placeholder : items[(i < 2 ? i : i - 1) % items.length];
      return items[(index + i - 2 + items.length * 2) % items.length];
    });
  }

  function setReel(reel, values, selected = 2) {
    reel.replaceChildren(...values.map((text, i) => {
      const li = document.createElement('li');
      li.className = `roulette-slot${i === selected ? ' is-selected' : ''}`;
      li.textContent = text;
      return li;
    }));
  }

  function render() {
    const last = r.current();
    const question = r.question();
    const verdict = last?.correct === true ? 'good' : last?.correct === false ? 'bad' : '';
    if (verdict && verdict !== el('stage').dataset.verdict && !reduced.matches) {
      el('stage').animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
    el('stage').dataset.verdict = verdict;
    el('verdict').textContent = verdict === 'good' ? 'Bonne réponse' : verdict === 'bad' ? 'Mauvaise réponse' : '';
    el('verdict').className = `roulette-verdict ${verdict === 'good' ? 'roulette-correct' : 'roulette-incorrect'}`;
    setReel(el('students'), rows(r.active(), last?.name, 'Qui répond ?'));
    const passed = r.passed();
    const displayed = r.pool().filter((q) => !passed.has(q.id) || q.id === last?.questionId);
    if (question && !displayed.includes(question)) displayed.push(question);
    setReel(el('questions'), rows(displayed.map((q) => q.question), question?.question, 'Quelle question ?'));
    el('question-topic').textContent = question?.topic || '';
    el('result').textContent = last ? `${last.name}. ${question.question}` : '';
  }

  async function spin(reel, items, selected, { rows: count, delay, duration, keyframes }) {
    const previous = [...reel.children].map((li) => li.textContent);
    const filler = Array.from({ length: count - previous.length }, () => items[Math.floor(Math.random() * items.length)]);
    const final = rows(items, selected, '');
    setReel(reel, [...previous, ...filler, ...final], -1);
    const height = reel.firstElementChild.getBoundingClientRect().height;
    reel.parentElement.classList.add('is-spinning');
    const animation = reel.animate(
      keyframes.map(({ y, ...frame }) => ({ ...frame, transform: `translateY(${-y * height}px)` })),
      { delay: delay * 1000, duration: duration * 1000, fill: 'forwards' },
    );
    await animation.finished;
    setReel(reel, final);
    animation.cancel();
    reel.parentElement.classList.remove('is-spinning');
  }

  // Un nouveau tirage fait tourner les deux rouleaux, une question écartée seulement celui des questions.
  // Une évaluation ou un tirage reçus pendant la rotation attendent la fin.
  async function update() {
    if (busy) return;
    const last = r.current();
    const student = r.state.history.length !== shown.length;
    const drawn = last?.correct === null && (student || last.questionId !== shown.questionId);
    shown = { length: r.state.history.length, questionId: last?.questionId };
    if (!drawn || reduced.matches) return render();
    busy = true;
    el('stage').dataset.verdict = '';
    el('verdict').textContent = el('question-topic').textContent = el('result').textContent = '';
    const passed = r.passed();
    const [students, questions] = spins();
    try {
      await Promise.all([
        student && spin(el('students'), r.active(), last.name, students),
        spin(el('questions'), r.pool().filter((q) => !passed.has(q.id)).map((q) => q.question), r.question().question, questions),
      ]);
    } finally {
      busy = false;
    }
    update();
  }

  r.onchange = update;
  addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if ([' ', 'enter', 'arrowright', 'arrowdown', 'pagedown'].includes(key)) {
      if (event.target.closest('button')) return;
      event.preventDefault();
      if (!busy && r.next()) update();
    } else if ((key === 'b' || key === 'm') && !busy && r.grade(key === 'b')) {
      render();
    } else if (key === 'e' && !busy && r.discard()) {
      update();
    } else if (key === 'f') {
      fullscreen();
    }
  });
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      error('Le plein écran est indisponible. Agrandissez la fenêtre sur le projecteur.');
    }
  }
  el('fullscreen').hidden = !document.fullscreenEnabled;
  el('fullscreen').addEventListener('click', fullscreen);
  render();
}
