import { readFile } from 'node:fs/promises';
import { SCHEMA, sql, normalize, validate, saveQuiz, quizId } from './lib.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage : npm run import -- decks/mon-quiz.json');
  process.exit(1);
}

await sql(...SCHEMA);
for (const file of files) {
  const id = quizId(file);
  const quiz = normalize(JSON.parse(await readFile(file, 'utf8')));
  quiz.title ||= id;
  const errors = validate(quiz);
  if (errors.length) {
    console.error(`${file} :\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
    continue;
  }
  await saveQuiz(id, quiz);
  console.log(`${id} : ${quiz.questions.length} questions, « ${quiz.title} »`);
}
