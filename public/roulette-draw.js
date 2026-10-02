// Une question par ligne sous un titre « ## Thème ». Une ligne « > … » juste après donne la réponse attendue,
// affichée au formateur seulement. Espaces insécables avant « ? ! : » pour l'affichage.
export function parseQuestions(markdown) {
  let topic = 'Général';
  let last = null;
  const nbsp = (text) => text.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
  const questions = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith('## ')) {
      topic = text.slice(3).trim();
    } else if (text.startsWith('>')) {
      if (last) last.answer = nbsp([last.answer, text.slice(1).trim()].filter(Boolean).join(' '));
    } else if (text && !text.startsWith('#') && !text.startsWith('<!--')) {
      const question = text.replace(/^(?:[-*]\s+|\d+\.\s+)/, '');
      last = { id: question, topic, question: nbsp(question), answer: '' };
      questions.set(question, last);
    }
  }
  return [...questions.values()];
}

export function draw(names, questions, history, turns, random = Math.random) {
  if (history.at(-1)?.correct === null) return null;
  const counts = new Map(names.map((name) => [name, history.filter((h) => h.name === name).length]));
  const minimum = Math.min(...counts.values());
  if (minimum >= turns) return null;
  let students = names.filter((name) => counts.get(name) === minimum);
  if (students.length > 1) students = students.filter((name) => name !== history.at(-1)?.name);
  const passed = new Set(history.filter((h) => h.correct === true).map((h) => h.questionId));
  let pool = questions.filter((q) => !passed.has(q.id));
  if (!pool.length) return null;
  if (pool.length > 1) pool = pool.filter((q) => q.id !== history.at(-1)?.questionId);
  const pick = (items) => items[Math.floor(random() * items.length)];
  return { name: pick(students), questionId: pick(pool).id, correct: null };
}

// Mouvement des deux rouleaux, comme une machine à sous : chacun accélère, file, freine,
// dépasse un peu sa ligne puis s'y cale. Les questions partent après les élèves et s'arrêtent 0,4 à 0,9 s après eux.
// Durées, vitesse et dépassement changent à chaque tirage. Distances en lignes, durées en secondes.
export function spins(random = Math.random) {
  const between = (min, max) => min + random() * (max - min);
  const students = { delay: 0, accel: 0.3, cruise: between(0.3, 0.8), brake: between(0.7, 1.1) };
  const questions = { delay: between(0.15, 0.4), accel: 0.3, brake: between(0.9, 1.4) };
  const stop = students.delay + students.accel + students.cruise + students.brake + between(0.4, 0.9);
  questions.cruise = Math.max(0.2, stop - questions.delay - questions.accel - questions.brake);
  return [students, questions].map((reel) => motion(reel, between(22, 30), between(0.06, 0.18)));
}

// Accélération et freinage quadratique puis cubique : la vitesse reste continue d'une étape à l'autre.
function motion({ delay, accel, cruise, brake }, speed, overshoot, settle = 0.25) {
  const span = accel / 2 + cruise + brake / 3;
  const rows = Math.max(8, Math.round(speed * span - overshoot));
  const v = (rows + overshoot) / span;
  const duration = accel + cruise + brake + settle;
  return {
    rows,
    delay,
    duration,
    keyframes: [
      { offset: 0, y: 0, easing: 'cubic-bezier(.33, 0, .67, .33)' },
      { offset: accel / duration, y: (v * accel) / 2, easing: 'linear' },
      { offset: (accel + cruise) / duration, y: v * (accel / 2 + cruise), easing: 'cubic-bezier(.33, 1, .67, 1)' },
      { offset: (accel + cruise + brake) / duration, y: rows + overshoot, easing: 'ease-in-out' },
      { offset: 1, y: rows },
    ],
  };
}
