import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, validate, publicQuiz, isDone, questionScore, timeLeft, GRACE, textMatches, parseValue, isCorrect, SKIP, maxTries, flagged, trapped,
} from './lib.js';

const choice = { id: 'q1', type: 'choice', question: 'Q', options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }], correctAnswer: 'B' };
const multiple = { id: 'q2', type: 'multiple', question: 'Q', options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], correctAnswers: ['C', 'A'] };
const text = { id: 'q3', type: 'text', question: 'Q', accept: ['Jakob'] };
const open = { id: 'q4', type: 'open', question: 'Q', expected: 'E' };
const ok = { choice: 'x', correct: 1 };
const ko = { choice: 'y', correct: 0 };

test('un ancien deck de flashcards devient un quiz', () => {
  const quiz = normalize({
    title: 'T',
    flashcards: [
      { question: 'Q1', choices: ['a', 'b'], correct_choice_index: 1 },
      { question: 'Q2', choices: ['`x`', 'y'], reponse: 'x, parce que' },
      { question: 'Q3', choices: ['a', 'b'], reponse: 'rien de tout ça' },
    ],
  });
  assert.deepEqual(quiz.questions.map((q) => [q.id, q.type, q.correctAnswer]), [['q1', 'choice', 'B'], ['q2', 'choice', 'A']]);
  assert.deepEqual(validate(quiz), []);
});

test('validate signale les erreurs de chaque type', () => {
  assert.deepEqual(validate({ title: 'T', questions: [choice, multiple, text, open] }), []);
  const errors = validate({
    title: 'T',
    courseUrl: 'javascript:alert(1)',
    questions: [{ ...choice, correctAnswer: 'Z' }, { ...multiple, id: 'q2', correctAnswers: ['Z'] }, { ...text, accept: ['la loi'] }, { ...open, type: 'essai' }, { ...open, id: 'q5', lookup: 'Le cours', lookupUrl: 'javascript:alert(1)' },
      { ...open, id: 'q6', image: 'https://exemple.fr/a.png' }, { ...open, id: 'q7', image: 'javascript:alert(1)', imageAlt: 'A' }],
  });
  assert.equal(errors.length, 8);
});

test('le navigateur ne reçoit ni les réponses ni les explications', () => {
  const sent = JSON.stringify(publicQuiz({ title: 'T', questions: [{ ...choice, explanation: 'E' }, multiple, { ...text, trap: 'Piège', trapAnswers: ['Hick'] }, open] }));
  for (const secret of ['correctAnswer', 'correctAnswers', 'accept', 'expected', 'explanation', 'Jakob', 'trap', 'Hick']) assert.ok(!sent.includes(secret), secret);
  // Le texte piégé part sous un nom neutre : le navigateur le met dans le presse-papiers
  assert.ok(sent.includes('"copy":"Piège"'));
});

test('réponses tapées : variantes, mots de liaison et fautes de frappe', () => {
  assert.ok(textMatches("C'est la loi de Jakob !", ['Jakob']));
  assert.ok(textMatches('jakop', ['Jakob']));
  assert.ok(textMatches("L'effet de gradation du but", ['gradation du but']));
  assert.ok(textMatches('proximite', ['proximité']));
  assert.ok(!textMatches('Jakob Hick Fitts', ['Jakob']));
  assert.ok(!textMatches('Hick', ['Jakob']));
  assert.ok(!textMatches('fit', ['Fitts']));
});

test('valeurs envoyées et correction', () => {
  assert.equal(parseValue(multiple, ['C', 'A', 'A']), 'A,C');
  assert.equal(parseValue(multiple, ['Z']), null);
  assert.equal(parseValue(choice, 'Z'), null);
  assert.equal(parseValue(text, '   '), null);
  assert.equal(parseValue(open, 'x'.repeat(1501)), null);
  assert.ok(isCorrect(multiple, 'A,C'));
  assert.ok(!isCorrect(multiple, 'A'));
  assert.ok(!isCorrect(open, 'tout'));
});

test('points, essais et fin de question', () => {
  assert.equal(questionScore(choice, [ok]), 1);
  assert.equal(questionScore(choice, [ko, ok]), 0.5);
  assert.equal(questionScore(choice, [ko, ko]), 0);
  assert.equal(questionScore(choice, [ko, ko], 1), 1);
  assert.equal(questionScore(open, [{ choice: 'texte', correct: 0 }]), null);
  assert.equal(questionScore(open, [{ choice: SKIP, correct: 0 }]), 0);
  assert.equal(isDone(choice, [ko]), false);
  assert.equal(isDone(choice, [ko, ko]), true);
  assert.equal(isDone(choice, [{ choice: SKIP, correct: 0 }]), true);
  assert.equal(isDone(open, [{ choice: 'texte', correct: 0 }]), true);
  assert.equal(maxTries({ ...choice, options: [{ id: 'A' }, { id: 'B' }] }), 1);
});

test('temps de réponse', () => {
  const quiz = normalize({ title: 'T', timeLimit: 30, questions: [
    { id: 'q1' }, { id: 'q2', timeLimit: 90 }, { id: 'q3', timeLimit: 0 }, { id: 'q4', lookup: 'Le cours' }, { id: 'q5', lookup: 'Le cours', timeLimit: 300 },
  ] });
  assert.deepEqual(quiz.questions.map((q) => q.timeLimit), [30, 90, 0, 0, 300]);
  const [q] = quiz.questions;
  assert.equal(timeLeft({}, 0, 1000), null);
  assert.equal(timeLeft(quiz.questions[2], 0, 1000), null);
  assert.equal(timeLeft(q, null, 1000), null);
  assert.equal(timeLeft(q, 0, 10_000), 20_000);
  // Une réponse qui arrive juste après la fin compte encore, au-delà de GRACE la question est finie
  assert.equal(isDone(choice, [], timeLeft(q, 0, 30_000 + GRACE)), false);
  assert.equal(isDone(choice, [], timeLeft(q, 0, 30_001 + GRACE)), true);
});

test('questions à vérifier : sorties de la page, copies et collages', () => {
  const quiet = { leaves: 1, away_ms: 4000, copies: 0, pastes: 0 };
  assert.equal(flagged(choice, null), false);
  assert.equal(flagged(choice, quiet), false);
  assert.equal(flagged(choice, { ...quiet, away_ms: 10_000 }), true);
  assert.equal(flagged(choice, { ...quiet, leaves: 3 }), true);
  assert.equal(flagged(choice, { ...quiet, pastes: 1 }), true);
  // Chercher dans le cours fait quitter la page, un collage reste signalé
  const lookup = { ...open, lookup: 'Le cours' };
  assert.equal(flagged(lookup, { ...quiet, leaves: 5, away_ms: 120_000 }), false);
  assert.equal(flagged(lookup, { ...quiet, copies: 1 }), true);
});

test('pièges : texte copié et réponses qui trahissent une IA', () => {
  const card = { ...text, accept: ['gradation du but', 'goal gradient'], trap: 'Variante', trapAnswers: ['dotation', 'endou'] };
  assert.deepEqual(validate({ title: 'T', questions: [card, { ...choice, trapAnswers: ['A', 'C'] }, { ...multiple, trapAnswers: ['B'] }] }), []);
  const errors = validate({ title: 'T', questions: [
    { ...card, trapAnswers: ['gradient'] }, { ...choice, trapAnswers: ['B'] }, { ...choice, id: 'q5', trapAnswers: ['Z'] }, { ...open, trap: '', trapAnswers: [] },
  ] });
  assert.equal(errors.length, 5);
  const said = (choice, correct = 0) => [{ choice, correct }];
  // Un texte piège compte sans copie
  assert.ok(trapped(card, said("L'effet de progrès endoué"), 0));
  assert.ok(trapped(card, said('effet de DOTATION'), 0));
  assert.ok(!trapped(card, said('gradation du but', 1), 0));
  // Une option piège compte seulement après une copie de la question
  const trapA = { ...choice, trapAnswers: ['A'] };
  assert.ok(!trapped(trapA, said('A'), 0));
  assert.ok(trapped(trapA, said('A'), 1));
  assert.ok(!trapped(trapA, said(SKIP), 1));
  assert.ok(trapped({ ...multiple, trapAnswers: ['B'] }, said('A,B'), 1));
  assert.equal(flagged(card, { leaves: 0, away_ms: 0, copies: 0, pastes: 0, traps: 1 }), true);
});
