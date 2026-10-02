import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestions, draw, spins } from './public/roulette-draw.js';

test('roulette : priorité, nombre de tours, absents et retour des questions ratées', () => {
  const questions = parseQuestions('## UI\n- Question A ?\n  > Réponse A : oui.\n- Question B ?\n## UX\nQuestion C ?\nQuestion A ?');
  assert.equal(questions.length, 3);
  assert.equal(questions[1].topic, 'UI');
  assert.equal(questions[1].id, 'Question B ?');
  assert.equal(questions[1].question, 'Question B ?');
  assert.equal(parseQuestions('- Q ?\n  > Réponse A :\n  > suite.')[0].answer, 'Réponse A : suite.');
  const names = ['Ada', 'Sam', 'Lou'];
  const history = [];
  for (let i = 0; i < 9; i++) {
    const next = draw(names, questions, history, 3, () => 0);
    assert.ok(next);
    assert.notEqual(next.name, history.at(-1)?.name);
    assert.notEqual(next.questionId, history.at(-1)?.questionId);
    history.push(next);
    assert.equal(draw(names, questions, history, 3), null);
    next.correct = false;
    const counts = names.map((name) => history.filter((h) => h.name === name).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  assert.equal(draw(names, questions, history, 3), null);
  assert.ok(names.every((name) => history.filter((h) => h.name === name).length === 3));
  assert.equal(draw(names, questions, history, 2), null);
  assert.equal(draw([], questions, [], 3), null);
  assert.equal(draw(names, [], [], 3), null);
  assert.equal(draw(['Ada'], questions, [{ name: 'Lou', questionId: questions[0].id, correct: false }], 2, () => 0).name, 'Ada');
  const passed = [{ name: 'Ada', questionId: questions[0].id, correct: true }];
  assert.notEqual(draw(names, questions, passed, 3, () => 0).questionId, questions[0].id);
  assert.equal(draw(names, questions, questions.map((q) => ({ name: 'Ada', questionId: q.id, correct: true })), 3), null);
  assert.equal(draw(['Ada'], [questions[0]], [{ name: 'Ada', questionId: questions[0].id, correct: false }], 2).questionId, questions[0].id);
});

test('la banque de roulette couvre UI, UX et accessibilité sans doublons', async () => {
  const markdown = await readFile(new URL('./decks/questions-courtes.md', import.meta.url), 'utf8');
  const questions = parseQuestions(markdown);
  for (const topic of ['UI', 'UX', 'Accessibilité']) assert.ok(questions.some((q) => q.topic === topic));
  assert.equal(questions.length, markdown.split('\n').filter((line) => line.startsWith('- ')).length);
  assert.deepEqual(questions.filter((q) => !q.answer).map((q) => q.id), []);
});

test('les rouleaux finissent sur leur ligne, les élèves avant les questions', () => {
  for (const value of [0, 0.5, 0.999]) {
    const [students, questions] = spins(() => value);
    for (const { rows, keyframes } of [students, questions]) {
      assert.ok(Number.isInteger(rows) && rows >= 8);
      assert.ok(keyframes.every((k, i) => !i || k.offset > keyframes[i - 1].offset));
      assert.equal(keyframes.at(-1).offset, 1);
      assert.equal(keyframes.at(-1).y, rows);
      assert.ok(keyframes.at(-2).y > rows);
    }
    const end = (reel) => reel.delay + reel.duration;
    assert.ok(end(questions) - end(students) > 0.399);
  }
});
