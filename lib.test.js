import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, validate, publicQuiz, isDone, questionScore, timeLeft, GRACE } from './lib.js';

test('un ancien deck de flashcards devient un quiz', () => {
  const quiz = normalize({
    flashcards: [
      { question: 'Q1', choices: ['a', 'b'], correct_choice_index: 1 },
      { question: 'Q2', choices: ['`x`', 'y'], reponse: 'x, parce que' },
      { question: 'Q3', choices: ['a', 'b'], reponse: 'rien de tout ça' },
    ],
  });
  assert.deepEqual(quiz.questions.map((q) => [q.id, q.correctAnswer]), [['q1', 'B'], ['q2', 'A']]);
  assert.deepEqual(validate(quiz), []);
});

test('validate signale une bonne réponse absente', () => {
  const errors = validate({ questions: [{ id: 'q1', question: 'Q', options: [{ id: 'A' }, { id: 'B' }], correctAnswer: 'C' }] });
  assert.deepEqual(errors, ['q1 : correctAnswer absent des options']);
});

test('le navigateur ne reçoit ni la réponse ni l\'explication', () => {
  const [q] = publicQuiz({ title: 'T', questions: [{ id: 'q1', question: 'Q', options: [], correctAnswer: 'A', explanation: 'E' }] }).questions;
  assert.equal(q.correctAnswer, undefined);
  assert.equal(q.explanation, undefined);
});

test('points et fin de question', () => {
  const ok = { correct: 1 };
  const ko = { correct: 0 };
  assert.equal(questionScore([ok]), 1);
  assert.equal(questionScore([ko, ok]), 0.5);
  assert.equal(questionScore([ko, ko, ok]), 0);
  assert.equal(isDone([ko], 3), false);
  assert.equal(isDone([ko, ko], 3), true);
  assert.equal(isDone([ko, ok], 4), true);
});

test('temps de réponse', () => {
  const quiz = normalize({ timeLimit: 30, questions: [{ id: 'q1' }, { id: 'q2', timeLimit: 90 }] });
  assert.deepEqual(quiz.questions.map((q) => q.timeLimit), [30, 90]);
  assert.deepEqual(validate({ questions: [{ id: 'q1', question: 'Q', options: [{ id: 'A' }, { id: 'B' }], correctAnswer: 'A', timeLimit: '30' }] }),
    ['q1 : timeLimit doit être un nombre de secondes']);

  const [q] = quiz.questions;
  assert.equal(timeLeft({}, 0, 1000), null);
  assert.equal(timeLeft(q, null, 1000), null);
  assert.equal(timeLeft(q, 0, 10_000), 20_000);
  // Une réponse qui arrive juste après la fin compte encore, au-delà de GRACE la question est finie
  assert.equal(isDone([], 3, timeLeft(q, 0, 30_000 + GRACE)), false);
  assert.equal(isDone([], 3, timeLeft(q, 0, 30_001 + GRACE)), true);
  assert.equal(questionScore([]), 0);
});
