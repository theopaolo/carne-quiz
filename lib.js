const LETTERS = 'ABCDEFGH';

// Les clés étrangères ne sont pas vérifiées par SQLite : le serveur contrôle le quiz et le passage.
export const SCHEMA = [
  ['CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL)'],
  [`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, quiz TEXT NOT NULL REFERENCES quizzes(id),
    group_name TEXT NOT NULL, name TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')))`],
  // choice : l'option choisie, les options cochées ("A,C"), le texte tapé, ou '' pour une question passée
  [`CREATE TABLE IF NOT EXISTS answers (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
    question_id TEXT NOT NULL, choice TEXT NOT NULL, correct INTEGER NOT NULL,
    answered_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (run_id, question_id, choice))`],
  // Sans ligne, le quiz n'est pas encore ouvert pour ce groupe. status : 'open' ou 'closed'.
  [`CREATE TABLE IF NOT EXISTS sessions (quiz TEXT NOT NULL, group_name TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (quiz, group_name))`],
  // Premier affichage d'une question minutée, en millisecondes depuis 1970 (horloge du serveur)
  [`CREATE TABLE IF NOT EXISTS shown (run_id TEXT NOT NULL, question_id TEXT NOT NULL, shown_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, question_id))`],
  // Note du formateur : 0, 0,5 ou 1. Elle remplace la note automatique.
  [`CREATE TABLE IF NOT EXISTS grades (run_id TEXT NOT NULL, question_id TEXT NOT NULL, score REAL NOT NULL,
    PRIMARY KEY (run_id, question_id))`],
  // Élèves d'un groupe, un nom par ligne, pour tous ses quiz. Avec une liste, l'élève choisit son nom au lieu de le taper.
  ['CREATE TABLE IF NOT EXISTS rosters (group_name TEXT PRIMARY KEY, names TEXT NOT NULL)'],
  // Avec une liste, un nom appartient au passage qui l'a pris en premier. Le formateur peut le libérer.
  [`CREATE TABLE IF NOT EXISTS claims (quiz TEXT NOT NULL, group_name TEXT NOT NULL, name TEXT NOT NULL, run_id TEXT NOT NULL,
    PRIMARY KEY (quiz, group_name, name))`],
  // Pendant une question : sorties de la page, temps passé hors de la page, copies et collages bloqués par le navigateur
  [`CREATE TABLE IF NOT EXISTS signals (run_id TEXT NOT NULL, question_id TEXT NOT NULL, leaves INTEGER NOT NULL DEFAULT 0,
    away_ms INTEGER NOT NULL DEFAULT 0, copies INTEGER NOT NULL DEFAULT 0, pastes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, question_id))`],
];

export const rosterNames = (row) => (row ? row.names.split('\n') : []);

// Turso par HTTP (pipeline Hrana v2) : une requête, les instructions s'exécutent dans l'ordre.
// Chaque instruction est [sql, ...args]. Renvoie un tableau de lignes par instruction.
export async function sql(...statements) {
  if (process.env.SQLITE_PATH) {
    const { DatabaseSync } = await import('node:sqlite');
    localDb ??= new DatabaseSync(process.env.SQLITE_PATH);
    return statements.map(([query, ...args]) => {
      const statement = localDb.prepare(query);
      return statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
    });
  }
  const base = process.env.TURSO_DATABASE_URL.replace(/^\w+:\/\//, 'https://');
  const res = await fetch(`${base}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        ...statements.map(([text, ...args]) => ({ type: 'execute', stmt: { sql: text, args: args.map(toValue) } })),
        { type: 'close' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status} : ${await res.text()}`);
  const { results } = await res.json();
  return statements.map((_, i) => {
    if (results[i].type === 'error') throw new Error(`Turso : ${results[i].error.message}`);
    const { cols, rows } = results[i].response.result;
    return rows.map((row) => Object.fromEntries(row.map((v, j) => [cols[j].name, fromValue(v)])));
  });
}

let localDb;

function toValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}

function fromValue(v) {
  if (v.type === 'null') return null;
  if (v.type === 'integer') return Number(v.value);
  return v.value;
}

export const TYPES = ['choice', 'multiple', 'text', 'open'];

// Un deck devient un quiz : type par défaut, temps hérité du quiz sauf pour une question à chercher dans le cours,
// sans chrono si elle n'a pas son propre timeLimit. Les anciens decks de flashcards
// ({ flashcards: [{ question, choices, correct_choice_index }] }) deviennent des questions à choix.
export function normalize(data) {
  const { flashcards, ...quiz } = data;
  const questions = data.questions || fromFlashcards(flashcards || []);
  return {
    ...quiz,
    questions: questions.map((q) => ({ ...q, type: q.type || 'choice', timeLimit: q.timeLimit ?? (q.lookup ? 0 : data.timeLimit) })),
  };
}

// Une carte sans correct_choice_index garde la réponse dont `reponse` commence par le texte d'un choix.
// Une carte sans réponse retrouvée est laissée de côté.
function fromFlashcards(cards) {
  const plainText = (t) => (t || '').replace(/`/g, '').trim().toLowerCase();
  const questions = [];
  for (const c of cards) {
    if (!Array.isArray(c.choices) || !c.choices.length) continue;
    const correct = c.correct_choice_index ?? c.choices.findIndex((ch) => plainText(c.reponse).startsWith(plainText(ch)));
    if (correct < 0) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      question: c.question,
      options: c.choices.map((label, j) => ({ id: LETTERS[j], label })),
      correctAnswer: LETTERS[correct],
      explanation: c.explanation || '',
    });
  }
  return questions;
}

// Liste les erreurs d'un quiz normalisé. Vide si le quiz est utilisable.
export function validate(quiz) {
  const errors = [];
  if (!quiz.title) errors.push('title manquant');
  if (quiz.courseUrl && !/^https?:\/\//.test(quiz.courseUrl)) errors.push('courseUrl doit commencer par https://');
  if (!quiz.questions?.length) errors.push('aucune question');
  const ids = new Set();
  for (const q of quiz.questions || []) {
    const at = `question ${q.id}`;
    if (!q.id || ids.has(q.id)) errors.push(`id manquant ou en double : ${q.id}`);
    ids.add(q.id);
    if (!q.question) errors.push(`${at} : texte de la question vide`);
    if (!TYPES.includes(q.type)) errors.push(`${at} : type inconnu « ${q.type} », attendu ${TYPES.join(', ')}`);
    if (q.timeLimit != null && !(Number.isFinite(q.timeLimit) && q.timeLimit >= 0)) errors.push(`${at} : timeLimit doit être un nombre de secondes, 0 pour aucun chrono`);
    if (q.lookupUrl && !(q.lookup && /^https?:\/\//.test(q.lookupUrl))) errors.push(`${at} : lookupUrl doit commencer par https:// et accompagner lookup`);
    if (q.image && !(/^https?:\/\//.test(q.image) && q.imageAlt)) errors.push(`${at} : image doit commencer par https:// et avoir un imageAlt`);
    const options = new Set((q.options || []).map((o) => o.id));
    if (q.type === 'choice' || q.type === 'multiple') {
      if (!(q.options?.length >= 2) || options.size !== q.options.length || q.options.length > LETTERS.length)
        errors.push(`${at} : il faut de 2 à 8 options, avec des id différents`);
    }
    if (q.type === 'choice' && !options.has(q.correctAnswer)) errors.push(`${at} : correctAnswer absent des options`);
    if (q.type === 'multiple' && !(q.correctAnswers?.length && q.correctAnswers.every((id) => options.has(id))))
      errors.push(`${at} : correctAnswers doit lister des id d'options`);
    if (q.type === 'text' && !(q.accept?.length && q.accept.every((a) => typeof a === 'string' && core(a))))
      errors.push(`${at} : accept doit lister au moins une réponse acceptée`);
    if (q.trap !== undefined && !(typeof q.trap === 'string' && q.trap.trim())) errors.push(`${at} : trap doit être un texte`);
    const traps = q.trapAnswers;
    if (traps === undefined) continue;
    if (!(Array.isArray(traps) && traps.length && traps.every((t) => typeof t === 'string' && plain(t)))) errors.push(`${at} : trapAnswers doit lister des réponses`);
    else if (q.type === 'choice' || q.type === 'multiple') {
      const right = [q.correctAnswer, ...(q.correctAnswers || [])];
      if (!traps.every((id) => options.has(id) && !right.includes(id))) errors.push(`${at} : trapAnswers doit lister des id de mauvaises options`);
    } else if (q.type === 'text' && traps.some((t) => q.accept?.some((a) => plain(a).includes(plain(t)))))
      errors.push(`${at} : trapAnswers ne doit pas se trouver dans une réponse acceptée`);
  }
  return errors;
}

// Essais permis. Une réponse rédigée s'envoie une fois. Une question à choix finit quand il ne reste qu'une option.
export function maxTries(q) {
  if (q.type === 'open') return 1;
  if (q.type === 'choice') return Math.min(2, q.options.length - 1);
  return 2;
}

// Ce que reçoit le navigateur : sans les réponses, les variantes acceptées ni les explications.
export function publicQuiz(quiz) {
  return {
    title: quiz.title,
    description: quiz.description || '',
    courseUrl: quiz.courseUrl || '',
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      hint: q.hint,
      topics: q.topics,
      timeLimit: q.timeLimit,
      lookup: q.lookup,
      lookupUrl: q.lookupUrl,
      image: q.image,
      imageAlt: q.imageAlt,
      // Le texte copié à la place de la question, sous un nom qui ne le trahit pas dans les outils de développement
      copy: q.trap,
    })),
  };
}

// Avant l'ouverture, l'accueil annonce le nombre et le type des questions sans leur texte
export const quizOutline = (quiz) => ({
  ...publicQuiz(quiz),
  questions: quiz.questions.map(({ type, timeLimit, lookup }) => ({ type, timeLimit, lookup: Boolean(lookup) })),
});

// Minuscules, sans accents ni ponctuation : « Loi de Jakob ! » devient « loi de jakob »
export function plain(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Mots qui entourent la réponse sans la changer : « c'est la loi de Jakob » se compare comme « jakob »
const FILLERS = new Set('c est ce cest le la les l un une des de du d loi lois principe effet regle the a an of law effect principle'.split(' '));
const core = (text) => plain(text).split(' ').filter((w) => !FILLERS.has(w)).join(' ');

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// Une réponse tapée est juste si, mots de liaison retirés, elle vaut une variante acceptée à une faute
// de frappe près dès 5 lettres, deux dès 10. Toute la réponse compte : « Jakob Hick » ne vaut pas « Jakob ».
export function textMatches(input, accepted) {
  const x = core(input);
  return accepted.some((variant) => {
    const y = core(variant);
    return distance(x, y) <= (y.length >= 10 ? 2 : y.length >= 5 ? 1 : 0);
  });
}

export const SKIP = '';

// La valeur envoyée par le navigateur, mise en forme pour la base. null si elle ne convient pas à la question.
export function parseValue(q, value) {
  if (q.type === 'choice') return q.options.some((o) => o.id === value) ? value : null;
  if (q.type === 'multiple') {
    if (!Array.isArray(value) || !value.length) return null;
    const ids = [...new Set(value)].sort();
    return ids.every((id) => q.options.some((o) => o.id === id)) ? ids.join(',') : null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  const max = q.type === 'open' ? 1500 : 200;
  return text && text.length <= max ? text : null;
}

export function isCorrect(q, value) {
  if (q.type === 'choice') return value === q.correctAnswer;
  if (q.type === 'multiple') return value === [...q.correctAnswers].sort().join(',');
  if (q.type === 'text') return textMatches(value, q.accept);
  return false;
}

// Deux envois identiques ne comptent qu'une fois. « Jakob » et « jakob » sont le même essai.
export function sameAnswer(q, a, b) {
  return q.type === 'text' ? plain(a) === plain(b) : a === b;
}

// Le serveur accepte encore une réponse 2 s après la fin du temps affiché, le temps qu'elle arrive.
export const GRACE = 2000;

// Millisecondes restantes pour répondre. null si la question n'a pas de limite ou n'a pas été affichée.
export function timeLeft(q, shownAt, now = Date.now()) {
  return q.timeLimit && shownAt != null ? shownAt + q.timeLimit * 1000 - now : null;
}

// `rows` : les réponses d'un passage à une question, dans l'ordre d'envoi. `left` : timeLeft().
// Finie quand la réponse est trouvée, la question passée, les essais épuisés ou le temps écoulé.
export function isDone(q, rows, left = null) {
  return rows.some((r) => r.correct || r.choice === SKIP) || rows.length >= maxTries(q) || (left !== null && left < -GRACE);
}

// 1 point au premier essai, 0,5 au deuxième, 0 ensuite. La note du formateur l'emporte.
// null : réponse rédigée en attente de note.
export function questionScore(q, rows, grade = null) {
  if (grade !== null) return grade;
  if (q.type === 'open') return rows.some((r) => r.choice !== SKIP) ? null : 0;
  const hit = rows.findIndex((r) => r.correct);
  return hit === 0 ? 1 : hit === 1 ? 0.5 : 0;
}

// Une question à vérifier : question copiée, collage bloqué, réponse piège, ou 3 sorties ou 10 s hors de la page.
// Une question de recherche fait quitter la page : ses sorties ne comptent pas.
// ponytail: seuils fixes, à ajuster ici si le formateur voit trop ou trop peu de questions signalées
export const AWAY = { leaves: 3, ms: 10_000 };
export function flagged(q, s) {
  return Boolean(s && (s.copies || s.pastes || s.traps || (!q.lookup && (s.leaves >= AWAY.leaves || s.away_ms >= AWAY.ms))));
}

// Une réponse qui trahit une IA. Un texte qui contient un morceau de trapAnswers compte toujours :
// « endou » repère « progrès endoué » comme « endouée ». Une option piège peut être choisie de bonne foi :
// elle compte seulement si l'élève a copié la question.
export function trapped(q, rows, copies) {
  const traps = q.trapAnswers || [];
  if (q.type === 'choice' || q.type === 'multiple') return copies > 0 && rows.some((r) => r.choice.split(',').some((id) => traps.includes(id)));
  return rows.some((r) => !r.correct && r.choice !== SKIP && traps.some((t) => plain(r.choice).includes(plain(t))));
}

// La bonne réponse, montrée une fois la question finie
export function solution(q) {
  if (q.type === 'choice') return q.correctAnswer;
  if (q.type === 'multiple') return q.correctAnswers;
  if (q.type === 'text') return q.accept[0];
  return q.expected || '';
}

// « decks/UX J1 fin.json » devient l'identifiant « ux-j1-fin », utilisé dans le lien du quiz
export const quizId = (fileName) => plain(fileName.replace(/^.*[\\/]/, '').replace(/\.json$/i, '')).replace(/ /g, '-');

export function saveQuiz(id, quiz) {
  return sql([
    'INSERT INTO quizzes (id, title, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, data = excluded.data',
    id, quiz.title, JSON.stringify(quiz),
  ]);
}

// Un quiz lu en base repasse par normalize : ceux enregistrés avant l'ajout des types restent lisibles
export const readQuiz = (data) => normalize(JSON.parse(data));
