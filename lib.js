const LETTERS = 'ABCDEFGH';

// Les clés étrangères ne sont pas vérifiées par SQLite : le serveur contrôle le quiz et le passage.
export const SCHEMA = [
  ['CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL)'],
  [`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, quiz TEXT NOT NULL REFERENCES quizzes(id),
    group_name TEXT NOT NULL, name TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')))`],
  [`CREATE TABLE IF NOT EXISTS answers (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
    question_id TEXT NOT NULL, choice TEXT NOT NULL, correct INTEGER NOT NULL,
    answered_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (run_id, question_id, choice))`],
  // Sans ligne, le quiz n'est pas encore ouvert pour ce groupe. status : 'open' ou 'closed'.
  [`CREATE TABLE IF NOT EXISTS sessions (quiz TEXT NOT NULL, group_name TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (quiz, group_name))`],
  // Premier affichage d'une question minutée, en millisecondes depuis 1970 (horloge du serveur)
  [`CREATE TABLE IF NOT EXISTS shown (run_id TEXT NOT NULL, question_id TEXT NOT NULL, shown_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, question_id))`],
];

// Turso par HTTP (pipeline Hrana v2) : une requête, les instructions s'exécutent dans l'ordre.
// Chaque instruction est [sql, ...args]. Renvoie un tableau de lignes par instruction.
export async function sql(...statements) {
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

// Les anciens decks de flashcards ({ flashcards: [{ question, choices, correct_choice_index }] })
// prennent la forme des quiz. Une carte sans correct_choice_index garde la réponse dont `reponse`
// commence par le texte d'un choix. Une carte sans réponse retrouvée est laissée de côté.
export function normalize(data) {
  const questions = data.questions || fromFlashcards(data.flashcards || []);
  // Temps de réponse en secondes : celui de la question, sinon celui du quiz, sinon pas de limite
  return { title: data.title, questions: questions.map((q) => ({ ...q, timeLimit: q.timeLimit ?? data.timeLimit })) };
}

function fromFlashcards(cards) {
  const plain = (t) => (t || '').replace(/`/g, '').trim().toLowerCase();
  const questions = [];
  for (const c of cards) {
    if (!Array.isArray(c.choices) || !c.choices.length) continue;
    const correct = c.correct_choice_index ?? c.choices.findIndex((ch) => plain(c.reponse).startsWith(plain(ch)));
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
  if (!quiz.questions?.length) errors.push('aucune question');
  const ids = new Set();
  for (const q of quiz.questions || []) {
    if (!q.id || ids.has(q.id)) errors.push(`id manquant ou en double : ${q.id}`);
    ids.add(q.id);
    if (!q.question) errors.push(`${q.id} : question vide`);
    if (!(q.options?.length >= 2)) errors.push(`${q.id} : moins de 2 options`);
    else if (!q.options.some((o) => o.id === q.correctAnswer)) errors.push(`${q.id} : correctAnswer absent des options`);
    if (q.timeLimit != null && !(Number.isFinite(q.timeLimit) && q.timeLimit > 0)) errors.push(`${q.id} : timeLimit doit être un nombre de secondes`);
  }
  return errors;
}

// Ce que reçoit le navigateur : sans la bonne réponse ni l'explication.
export function publicQuiz(quiz) {
  return {
    title: quiz.title,
    questions: quiz.questions.map(({ id, question, options, hint, difficulty, topics, timeLimit }) => ({
      id, question, options, hint, difficulty, topics, timeLimit,
    })),
  };
}

// Le serveur accepte encore une réponse 2 s après la fin du temps affiché, le temps qu'elle arrive.
export const GRACE = 2000;

// Millisecondes restantes pour répondre. null si la question n'a pas de limite ou n'a pas été affichée.
export function timeLeft(q, shownAt, now = Date.now()) {
  return q.timeLimit && shownAt != null ? shownAt + q.timeLimit * 1000 - now : null;
}

// `rows` : les réponses d'un passage à une question, dans l'ordre d'envoi. `left` : timeLeft().
// Une question est finie quand la bonne réponse est trouvée, qu'il ne reste qu'une option ou que le temps est écoulé.
export function isDone(rows, optionCount, left = null) {
  return rows.some((r) => r.correct) || rows.length >= optionCount - 1 || (left !== null && left < -GRACE);
}

// 1 point au premier essai, 0,5 au deuxième, 0 ensuite. Le barème se règle ici.
export function questionScore(rows) {
  const hit = rows.findIndex((r) => r.correct);
  return hit === 0 ? 1 : hit === 1 ? 0.5 : 0;
}
