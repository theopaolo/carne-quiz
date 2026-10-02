export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function places(plan) {
  if (!Array.isArray(plan) || !plan.length || !plan.every((row) => row
    && [row.count, row.size].every((n) => Number.isInteger(n) && n > 0 && n <= 500))) return NaN;
  return plan.reduce((total, row) => total + row.count * row.size, 0);
}

export const teamName = (i) => `Groupe ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`;

// Équipes d'au plus `size` élèves, de tailles égales à une près : 22 par 3 donne 6 équipes de 3 et 2 de 2.
export function balanced(students, size) {
  if (!students) return [{ count: 1, size }];
  const count = Math.ceil(students / size);
  const small = Math.floor(students / count);
  const big = students - count * small;
  return [{ count: big, size: small + 1 }, { count: count - big, size: small }].filter((row) => row.count);
}

// Après le tirage, les équipes suivent les présents : un absent quitte son équipe, une équipe vide quitte
// l'ordre de passage et l'équipe à l'oral le reste. La composition reprend les tailles des équipes.
export function prune(state, present) {
  for (let i = state.teams.length - 1; i >= 0; i--) {
    const team = state.teams[i];
    team.members = team.members.filter((n) => present.includes(n));
    if (team.members.length) continue;
    state.teams.splice(i, 1);
    const rank = state.order.indexOf(i);
    if (rank >= 0) state.order.splice(rank, 1);
    if (rank >= 0 && rank < state.passage) state.passage--;
    state.order = state.order.map((j) => (j > i ? j - 1 : j));
  }
  if (!state.order.length) state.passage = -1;
  const sizes = state.teams.map((t) => t.members.length);
  if (sizes.length) state.plan = [...new Set(sizes)].sort((a, b) => b - a).map((size) => ({ count: sizes.filter((n) => n === size).length, size }));
  return state;
}

export function makeTeams(names, plan, random = Math.random) {
  if (!names.length || new Set(names).size !== names.length || places(plan) !== names.length) {
    throw new Error('Le nombre de places doit correspondre au nombre d’élèves présents.');
  }
  const students = shuffle(names, random);
  const teams = [];
  let offset = 0;
  for (const { count, size } of plan) {
    for (let i = 0; i < count; i++) {
      const id = teams.length;
      teams.push({ name: teamName(id), members: students.slice(offset, offset + size) });
      offset += size;
    }
  }
  return teams;
}
