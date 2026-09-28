import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SCHEMA, sql, normalize, validate } from './lib.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage : npm run import -- decks/mon-quiz.json');
  process.exit(1);
}

await sql(...SCHEMA);
for (const file of files) {
  const quiz = normalize(JSON.parse(await readFile(file, 'utf8')));
  const errors = validate(quiz);
  if (errors.length) {
    console.error(`${file} :\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
    continue;
  }
  // Le nom du fichier sert d'identifiant dans le lien : decks/ux-j1-fin.json devient ?quiz=ux-j1-fin
  const id = basename(file, '.json');
  quiz.title ||= id;
  await sql([
    'INSERT INTO quizzes (id, title, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, data = excluded.data',
    id, quiz.title, JSON.stringify(quiz),
  ]);
  console.log(`${id} : ${quiz.questions.length} questions, « ${quiz.title} »`);
}
