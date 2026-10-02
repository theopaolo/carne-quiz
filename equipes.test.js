import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanced, makeTeams, places, prune, shuffle } from './public/equipes-draw.js';

test('équipes : répartition équilibrée par taille maximale', () => {
  assert.deepEqual(balanced(22, 3), [{ count: 6, size: 3 }, { count: 2, size: 2 }]);
  assert.deepEqual(balanced(22, 4), [{ count: 4, size: 4 }, { count: 2, size: 3 }]);
  assert.deepEqual(balanced(20, 4), [{ count: 5, size: 4 }]);
  assert.deepEqual(balanced(5, 4), [{ count: 1, size: 3 }, { count: 1, size: 2 }]);
  assert.deepEqual(balanced(2, 3), [{ count: 1, size: 2 }]);
  assert.deepEqual(balanced(0, 3), [{ count: 1, size: 3 }]);
  for (let n = 1; n <= 40; n++) for (let size = 2; size <= 5; size++) assert.equal(places(balanced(n, size)), n);
});

test('équipes : tailles choisies, chaque présent une fois et ordre indépendant', () => {
  const names = Array.from({ length: 22 }, (_, i) => `Élève ${i + 1}`);
  const plan = [{ count: 6, size: 3 }, { count: 2, size: 2 }];
  const teams = makeTeams(names, plan, () => 0);
  assert.equal(places(plan), 22);
  assert.deepEqual(teams.map((t) => t.members.length), [3, 3, 3, 3, 3, 3, 2, 2]);
  assert.deepEqual(teams.map((t) => t.name), 'ABCDEFGH'.split('').map((letter) => `Groupe ${letter}`));
  assert.deepEqual(teams.flatMap((t) => t.members).sort(), [...names].sort());
  assert.notDeepEqual(teams.flatMap((t) => t.members), names);
  const before = structuredClone(teams);
  const order = shuffle(teams.map((_, i) => i), () => 0);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(teams, before);
  assert.equal(names.length, 22);
  const present = names.slice(1);
  assert.equal(makeTeams(present, [{ count: 7, size: 3 }]).flatMap((t) => t.members).includes(names[0]), false);
  assert.throws(() => makeTeams(names, [{ count: 7, size: 3 }]));
  for (const invalid of [[], null, [null], [{ count: 0, size: 3 }], [{ count: 1.5, size: 3 }], [{ count: 1, size: -1 }]]) {
    assert.ok(Number.isNaN(places(invalid)));
    assert.throws(() => makeTeams(names, invalid));
  }
  assert.throws(() => makeTeams(['Ada', 'Ada'], [{ count: 1, size: 2 }]));
  assert.deepEqual(makeTeams(['Ada'], [{ count: 1, size: 1 }])[0].members, ['Ada']);
});

test('équipes : après le tirage, les équipes suivent les présents', () => {
  const state = { plan: [{ count: 3, size: 2 }], excluded: [], order: [2, 0, 1], passage: 1, teams: [
    { name: 'A', members: ['Ada', 'Bob'] }, { name: 'B', members: ['Cy'] }, { name: 'C', members: ['Dan', 'Eve'] }] };
  prune(state, ['Ada', 'Bob', 'Dan', 'Eve']);
  assert.deepEqual(state.teams.map((t) => t.name), ['A', 'C']);
  assert.deepEqual(state.order, [1, 0]);
  assert.equal(state.teams[state.order[state.passage]].name, 'A');
  assert.deepEqual(state.plan, [{ count: 2, size: 2 }]);
  prune(state, ['Ada', 'Bob', 'Dan']);
  assert.deepEqual(state.plan, [{ count: 1, size: 2 }, { count: 1, size: 1 }]);
  prune(state, ['Ada', 'Bob']);
  assert.deepEqual(state.order, [0]);
  assert.equal(state.passage, 0);
  prune(state, []);
  assert.deepEqual([state.teams, state.order, state.passage], [[], [], -1]);
});
