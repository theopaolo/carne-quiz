import { balanced, makeTeams, places, prune, shuffle, teamName } from './equipes-draw.js';

// La régie (/prof/equipes) et l'écran des élèves (/prof/equipes/ecran) partagent le tirage de la classe,
// enregistré dans le navigateur. Chaque page relit le tirage quand l'autre l'enregistre.
const el = (id) => document.getElementById(`equipes-${id}`);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const STATUS = { now: 'À l’oral', next: 'Ensuite', done: 'Passée' };
const data = el('data');
if (data) {
  const s = session(JSON.parse(data.textContent));
  if (el('stage')) screen(s);
  else desk(s);
}

function error(message) {
  el('error').textContent = message;
  el('error').hidden = !message;
}

// Les équipes glissent vers leur nouvelle place quand le navigateur sait animer le changement.
// Une transition interrompue par la suivante, ou dans une page cachée, affiche directement le résultat.
function transition(render) {
  if (reduced.matches || document.hidden || !document.startViewTransition) render();
  else document.startViewTransition(render).ready.catch(() => {});
}

function session({ group, names }) {
  const key = `carnet:equipes:${group}`;
  const s = {
    names,
    onchange: () => {},
    present: () => names.filter((n) => !s.state.excluded.includes(n)),
    // Les équipes dans l'ordre de passage, ou dans l'ordre du tirage tant que l'ordre n'est pas tiré
    ordered: () => (s.state.order.length ? s.state.order : s.state.teams.map((_, i) => i)),
    // passage : rang de l'équipe à l'oral. -1 avant les oraux, order.length après le dernier.
    status(i) {
      const rank = s.state.order.indexOf(i);
      const { passage } = s.state;
      if (rank < 0 || passage < 0) return '';
      return rank < passage ? 'done' : rank === passage ? 'now' : rank === passage + 1 ? 'next' : '';
    },
    save() {
      try {
        localStorage.setItem(key, JSON.stringify(s.state));
        error('');
      } catch {
        error('Le tirage ne peut pas être enregistré. Gardez cette page ouverte pour le conserver.');
      }
    },
    drawTeams() {
      Object.assign(s.state, { teams: makeTeams(s.present(), s.state.plan), order: [], passage: -1, drawn: Date.now() });
      s.save();
    },
    drawOrder() {
      Object.assign(s.state, { order: shuffle(s.state.teams.map((_, i) => i)), passage: -1 });
      s.save();
    },
    // Place un élève dans l'équipe `to`, ou le note absent si `to` vaut -1
    move(name, to) {
      const target = s.state.teams[to];
      for (const team of s.state.teams) team.members = team.members.filter((n) => n !== name);
      if (target) target.members.push(name);
      else s.state.excluded.push(name);
      prune(s.state, s.present());
      s.save();
    },
    step(delta) {
      const passage = Math.min(Math.max(s.state.passage + delta, -1), s.state.order.length);
      if (!s.state.order.length || passage === s.state.passage) return false;
      s.state.passage = passage;
      s.save();
      return true;
    },
  };

  function load() {
    s.state = { plan: balanced(names.length, 3), excluded: [], teams: [], order: [], passage: -1 };
    let message = '';
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const value = JSON.parse(saved);
        value.passage ??= -1;
        // Une composition en cours de saisie peut être invalide : elle repart du réglage par défaut sans perdre le tirage
        if (!Array.isArray(value.plan) || !value.plan.length || !value.plan.every((r) => r
          && [r.count, r.size].every((n) => Number.isInteger(n) && n >= 0 && n <= 500))) value.plan = s.state.plan;
        if (!Array.isArray(value.excluded) || !value.excluded.every((n) => typeof n === 'string')
          || !Array.isArray(value.teams) || !value.teams.every((t) => t && typeof t.name === 'string'
            && t.name.length <= 60 && Array.isArray(t.members) && t.members.length && t.members.every((n) => typeof n === 'string'))
          || !Array.isArray(value.order) || (value.order.length && (value.order.length !== value.teams.length
            || new Set(value.order).size !== value.order.length || !value.order.every((i) => Number.isInteger(i) && i >= 0 && i < value.teams.length)))
          || !Number.isInteger(value.passage) || value.passage < -1 || value.passage > (value.order.length || -1)
        ) throw new Error('Enregistrement invalide');
        const members = value.teams.flatMap((t) => t.members);
        if (new Set(members).size !== members.length) throw new Error('Élève en double');
        s.state = value;
        s.state.excluded = s.state.excluded.filter((n) => names.includes(n));
      }
    } catch (err) {
      message = err.name === 'SecurityError'
        ? 'Le navigateur bloque l’enregistrement. Gardez cette page ouverte pour conserver le tirage.'
        : 'Le tirage enregistré est illisible. Vérifiez la composition et relancez le tirage.';
    }
    error(message);
  }

  load();
  addEventListener('storage', (event) => {
    if (event.key !== key) return;
    load();
    s.onchange();
  });
  return s;
}

// Régie du formateur : présences, composition, équipes nommées et déroulé des oraux
function desk(s) {
  const presets = [...el('presets').querySelectorAll('button')];
  const announce = (text) => { el('result').textContent = text; };

  for (const name of s.names) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    label.append(input, document.createTextNode(name));
    el('presence').append(label);
  }

  function renderPresence() {
    for (const input of el('presence').querySelectorAll('input')) input.checked = !s.state.excluded.includes(input.value);
  }

  function renderPlan() {
    el('plan').replaceChildren(...s.state.plan.map((row, i) => {
      const line = document.createElement('div');
      line.className = 'equipes-plan-row';
      line.innerHTML = `<input class="input" type="number" inputmode="numeric" min="1" max="500" required data-key="count" aria-label="Nombre d’équipes, ligne ${i + 1}">
        <span></span><input class="input" type="number" inputmode="numeric" min="1" max="500" required data-key="size" aria-label="Élèves par équipe, ligne ${i + 1}">
        <button class="btn btn-quiet" type="button" aria-label="Supprimer la ligne ${i + 1}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>`;
      const words = line.querySelector('span');
      const say = () => { words.textContent = row.count > 1 ? 'équipes de' : 'équipe de'; };
      for (const input of line.querySelectorAll('input')) {
        input.value = row[input.dataset.key];
        input.addEventListener('input', () => {
          row[input.dataset.key] = Number(input.value);
          say();
          s.save();
          update();
        });
      }
      say();
      const remove = line.querySelector('button');
      remove.disabled = s.state.plan.length === 1;
      remove.addEventListener('click', () => {
        s.state.plan.splice(i, 1);
        s.save();
        renderPlan();
        update();
        el('add').focus();
      });
      return line;
    }));
  }

  function update() {
    const active = s.present();
    const total = places(s.state.plan);
    const valid = active.length > 0 && total === active.length;
    const drawn = s.state.teams.length > 0;
    const gap = total - active.length;
    el('present-count').textContent = `(${active.length}/${s.names.length} présents)`;
    el('capacity').textContent = !s.names.length ? 'Ajoutez la liste de classe dans « Liste et présences ».'
      : !active.length ? 'Cochez au moins un élève présent.'
      : !Number.isFinite(total) ? 'Indiquez un nombre entier positif dans chaque champ.'
      : valid ? `${plural(s.state.plan.reduce((sum, r) => sum + r.count, 0), 'équipe')}, ${total} places pour ${active.length} présents. Prêt à tirer.`
      : `${total} places pour ${active.length} présents. ${gap < 0 ? 'Ajoutez' : 'Retirez'} ${plural(Math.abs(gap), 'place')}, ou choisissez une taille d’équipe.`;
    el('capacity').className = valid ? 'equipes-ready' : 'help';
    el('draw').disabled = !valid;
    el('draw').textContent = drawn ? 'Refaire les équipes' : 'Tirer les équipes';
    el('draw').classList.toggle('btn-primary', !drawn);
    const plan = JSON.stringify(s.state.plan);
    for (const button of presets) {
      button.setAttribute('aria-pressed', String(active.length > 0 && plan === JSON.stringify(balanced(active.length, Number(button.dataset.size)))));
    }
    const sizes = s.state.plan.flatMap((r) => Array.from({ length: Math.max(0, Math.min(500, r.count)) }, () => r.size)).sort((a, b) => a - b);
    const drawnSizes = s.state.teams.map((t) => t.members.length).sort((a, b) => a - b);
    el('stale').hidden = !drawn || JSON.stringify(sizes) === JSON.stringify(drawnSizes);
  }

  function renderPassage() {
    const { teams, order, passage } = s.state;
    el('passage').hidden = !teams.length;
    el('passage-status').textContent = !order.length ? 'Tirez l’ordre de passage quand les équipes sont prêtes.'
      : passage < 0 ? `Ordre tiré, ${plural(order.length, 'passage')}. Les oraux n’ont pas commencé.`
      : passage < order.length ? `Passage ${passage + 1} sur ${order.length} : ${teams[order[passage]].name}`
      : 'Tous les oraux sont passés.';
    el('prev').hidden = passage < 0;
    el('next').hidden = !order.length || passage >= order.length;
    el('next').textContent = passage < 0 ? 'Commencer les oraux' : passage === order.length - 1 ? 'Terminer les oraux' : 'Équipe suivante';
    el('order-draw').textContent = order.length ? 'Tirer un nouvel ordre' : 'Tirer l’ordre de passage';
    el('order-draw').className = `btn ${order.length ? 'btn-quiet' : 'btn-primary'}`;
  }

  // Le nom de l'élève ouvre la liste des autres équipes. `team` vaut -1 pour un présent sans équipe.
  function member(name, team) {
    const li = document.createElement('li');
    const select = document.createElement('select');
    select.className = 'equipes-member';
    select.id = `equipes-member-${s.names.indexOf(name)}`;
    select.setAttribute('aria-label', team < 0 ? 'Choisir une équipe' : 'Changer d’équipe');
    const group = document.createElement('optgroup');
    group.label = team < 0 ? 'Placer dans' : 'Déplacer vers';
    for (const i of s.ordered()) if (i !== team) group.append(new Option(s.state.teams[i].name, i));
    select.append(new Option(name, '', true, true), group, new Option('Absent', -1));
    select.options[0].disabled = true;
    select.addEventListener('change', () => {
      const target = s.state.teams[select.value];
      s.move(name, Number(select.value));
      renderPresence();
      renderPlan();
      renderTeams();
      announce(target ? `${name} rejoint ${target.name}.` : `${name} retiré des présents.`);
    });
    li.append(select);
    return li;
  }

  function renderTeams() {
    const focused = el('list').contains(document.activeElement) ? document.activeElement.id : '';
    const drawn = s.state.teams.length > 0;
    el('empty').hidden = drawn;
    el('fun').hidden = el('names-help').hidden = !drawn;
    const placed = s.state.teams.flatMap((t) => t.members);
    const unplaced = drawn ? s.present().filter((n) => !placed.includes(n)) : [];
    el('list').replaceChildren(...s.ordered().map((i) => {
      const team = s.state.teams[i];
      const rank = s.state.order.indexOf(i);
      const status = s.status(i);
      const card = document.createElement('div');
      card.className = 'equipes-team';
      card.dataset.status = status;
      card.style.viewTransitionName = `equipes-team-${i}`;
      // Rang, nom et état sur une ligne. Seule l'équipe à l'oral montre son état, les autres le donnent aux lecteurs d'écran.
      const head = document.createElement('div');
      head.className = 'equipes-team-head';
      if (rank >= 0) {
        const number = document.createElement('span');
        number.className = 'equipes-rank';
        number.innerHTML = `<span class="sr-only">Passage </span>${rank + 1}`;
        head.append(number);
      }
      const label = document.createElement('label');
      label.className = 'sr-only';
      label.htmlFor = `equipes-name-${i}`;
      label.textContent = `Nom de l’équipe de ${team.members.join(', ')}`;
      const input = document.createElement('input');
      input.className = 'equipes-name';
      input.id = label.htmlFor;
      input.maxLength = 60;
      input.value = team.name;
      input.addEventListener('input', () => {
        team.name = input.value.trim() || teamName(i);
        s.save();
        renderPassage();
      });
      input.addEventListener('blur', () => { input.value = team.name; });
      const list = document.createElement('ul');
      list.append(...team.members.map((name) => member(name, i)));
      head.append(label, input);
      if (status) {
        const badge = document.createElement('span');
        badge.className = status === 'now' ? 'badge badge-pending' : 'sr-only';
        badge.textContent = STATUS[status];
        head.append(badge);
      }
      card.append(head, list);
      return card;
    }));
    if (unplaced.length) {
      const card = document.createElement('div');
      card.className = 'equipes-team equipes-unplaced';
      const title = document.createElement('h3');
      title.textContent = 'Sans équipe';
      const list = document.createElement('ul');
      list.append(...unplaced.map((name) => member(name, -1)));
      card.append(title, list);
      el('list').prepend(card);
    }
    // Un élève noté absent quitte la liste : le focus revient au titre
    if (focused) (document.getElementById(focused) ?? el('title')).focus();
    renderPassage();
    update();
  }

  el('add').addEventListener('click', () => {
    s.state.plan.push({ count: 1, size: 2 });
    s.save();
    renderPlan();
    update();
    el('plan').lastElementChild.querySelector('input').focus();
  });
  for (const button of presets) {
    button.addEventListener('click', () => {
      s.state.plan = balanced(s.present().length, Number(button.dataset.size));
      s.save();
      renderPlan();
      update();
    });
  }
  el('presence').addEventListener('change', () => {
    s.state.excluded = [...el('presence').querySelectorAll('input:not(:checked)')].map((input) => input.value);
    prune(s.state, s.present());
    s.save();
    renderPlan();
    renderTeams();
  });
  el('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (el('draw').disabled) return;
    if (s.state.teams.length && !confirm('Refaire les équipes ? Les équipes, leurs noms et l’ordre de passage seront remplacés.')) return;
    s.drawTeams();
    renderTeams();
    announce(`${s.state.teams.length} équipes tirées pour ${s.present().length} élèves.`);
    el('title').focus();
  });
  el('fun').addEventListener('click', () => {
    const suggestions = shuffle(['🦊 Les Renards malins', '🐙 Les Poulpes créatifs', '🦄 Les Licornes pixel', '🐼 Les Pandas zen',
      '🦉 Les Hiboux curieux', '🦦 Les Loutres futées', '🐝 Les Abeilles agiles', '🦩 Les Flamants flamboyants',
      '🐢 Les Tortues turbo', '🦝 Les Ratons codeurs', '🐧 Les Pingouins pilotes', '🐸 Les Grenouilles graphiques']);
    s.state.teams.forEach((team, i) => { team.name = suggestions[i % suggestions.length] + (i >= suggestions.length ? ` ${Math.floor(i / suggestions.length) + 1}` : ''); });
    s.save();
    renderTeams();
    announce('Noms avec emojis attribués. Vous pouvez les modifier.');
  });
  el('order-draw').addEventListener('click', () => {
    const { order, passage } = s.state;
    if (passage >= 0 && passage < order.length && !confirm('Tirer un nouvel ordre ? Les oraux reprendront au début.')) return;
    s.drawOrder();
    transition(renderTeams);
    announce(`Ordre tiré : ${s.state.order.map((i, n) => `${n + 1}, ${s.state.teams[i].name}`).join('. ')}.`);
  });
  for (const [id, delta] of [['next', 1], ['prev', -1]]) {
    el(id).addEventListener('click', () => {
      if (!s.step(delta)) return;
      transition(() => {
        renderTeams();
        announce(el('passage-status').textContent);
        if (el(id).hidden) el('passage-status').focus();
      });
    });
  }
  el('open').addEventListener('click', (event) => {
    if (window.open(el('open').href, el('open').target, 'popup,width=1280,height=720')) event.preventDefault();
  });
  s.onchange = () => {
    renderPresence();
    renderPlan();
    transition(renderTeams);
  };
  if (s.state.teams.length) {
    prune(s.state, s.present());
    s.save();
  }
  renderPresence();
  renderPlan();
  renderTeams();
}

// Écran des élèves : toutes les équipes, puis pendant les oraux l'équipe à l'oral et la file de passage.
// Le clavier ou une télécommande de présentation fait avancer les oraux depuis cet écran seul.
function screen(s) {
  let shown = null;
  let refit = () => {};

  // Garde le nombre de colonnes qui donne le plus grand texte. Une équipe occupe environ 13 em de large
  // et `lines` lignes de 1,2 em de haut, comme dans le calcul de la taille du texte en CSS.
  function fit(board, count, lines) {
    refit = () => {
      const { clientWidth: width, clientHeight: height } = el('stage');
      let best = 1;
      let size = 0;
      for (let cols = 1; cols <= count; cols++) {
        const fits = Math.min(height / Math.ceil(count / cols) / (lines * 1.2), width / cols / 13);
        if (fits > size) [best, size] = [cols, fits];
      }
      board.style.setProperty('--cols', best);
      board.style.setProperty('--rows', Math.ceil(count / best));
    };
    refit();
  }

  function item(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function board(reveal) {
    const { teams, order } = s.state;
    const list = item('ul', `equipes-board${reveal ? ' is-revealing' : ''}`);
    let step = 0;
    list.append(...s.ordered().map((i, rank) => {
      const team = teams[i];
      const li = item('li');
      li.style.viewTransitionName = `equipes-team-${i}`;
      const card = item('div', 'equipes-card');
      const name = item('strong', '', team.name);
      if (order.length) name.prepend(item('span', 'equipes-rank', rank + 1));
      name.style.setProperty('--i', step++);
      const members = item('ul');
      for (const member of team.members) {
        const node = item('li', '', member);
        node.style.setProperty('--i', step++);
        members.append(node);
      }
      card.append(name, members);
      li.append(card);
      return li;
    }));
    const lines = Math.max(...teams.map((t) => t.members.length))
      + (teams.some((t) => t.name.length > 14) ? 2.3 : 1.15) + 0.8;
    list.style.setProperty('--lines', lines);
    el('stage').replaceChildren(list);
    fit(list, teams.length, lines);
    el('result').textContent = s.ordered().map((i, rank) => `${order.length ? `${rank + 1}, ` : ''}${teams[i].name} : ${teams[i].members.join(', ')}`).join('. ');
  }

  function spotlight() {
    const { teams, order, passage } = s.state;
    const team = teams[order[passage]];
    const next = teams[order[passage + 1]];
    const now = item('section', 'equipes-now');
    now.style.viewTransitionName = 'equipes-now';
    const members = item('ul', 'equipes-now-members');
    members.style.setProperty('--members', team.members.length);
    members.append(...team.members.map((m) => item('li', '', m)));
    const then = item('p', 'equipes-label', next ? 'Ensuite : ' : 'Dernier passage');
    if (next) then.append(item('strong', '', next.name));
    const inner = item('div');
    inner.append(item('p', 'equipes-now-name', team.name), members, then);
    now.append(inner);
    const queue = item('ol', 'equipes-queue');
    queue.style.setProperty('--count', order.length);
    queue.append(...order.map((i, rank) => {
      const li = item('li');
      li.dataset.status = s.status(i);
      li.style.viewTransitionName = `equipes-team-${i}`;
      li.append(item('span', 'equipes-rank', rank + 1), item('span', 'equipes-queue-name', teams[i].name));
      if (li.dataset.status === 'next') li.append(item('em', '', STATUS.next));
      return li;
    }));
    const side = item('div', 'equipes-side');
    side.append(queue);
    const wrap = item('div', 'equipes-spotlight');
    wrap.append(now, side);
    el('stage').replaceChildren(wrap);
    el('result').textContent = `À l’oral : ${team.name}, ${team.members.join(', ')}.${next ? ` Ensuite : ${next.name}.` : ''}`;
  }

  function render() {
    const { teams, order, passage } = s.state;
    const live = passage >= 0 && passage < order.length;
    const reveal = shown !== null && s.state.drawn !== shown && !reduced.matches;
    shown = s.state.drawn;
    el('status').textContent = !teams.length ? '' : !order.length ? plural(teams.length, 'équipe')
      : live ? `À l’oral, passage ${passage + 1} sur ${order.length}` : passage < 0 ? 'Ordre de passage' : 'Oraux terminés';
    if (!teams.length) {
      el('stage').replaceChildren(item('p', 'equipes-wait', 'Les équipes ne sont pas encore tirées.'));
      el('result').textContent = 'Les équipes ne sont pas encore tirées.';
    } else if (live) spotlight();
    else board(reveal);
  }

  // Un nouveau tirage d'équipes s'affiche nom par nom, un élève déplacé ou un changement d'ordre glisse
  s.onchange = () => (s.state.drawn !== shown ? render() : transition(render));
  addEventListener('resize', () => refit());
  addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const key = event.key.toLowerCase();
    const forward = [' ', 'enter', 'arrowright', 'arrowdown', 'pagedown'].includes(key);
    const back = ['arrowleft', 'arrowup', 'pageup'].includes(key);
    if (forward || back) {
      if ([' ', 'enter'].includes(key) && event.target.closest('button')) return;
      event.preventDefault();
    }
    if (key === 'f') return fullscreen();
    if (!s.state.teams.length) return;
    if (forward && !s.state.order.length) s.drawOrder();
    else if (!(forward || back) || !s.step(forward ? 1 : -1)) return;
    transition(render);
  });
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      error('Le plein écran est indisponible. Agrandissez la fenêtre sur le projecteur.');
    }
  }
  el('fullscreen').hidden = !document.fullscreenEnabled;
  // Le bouton rend le focus : Espace et la télécommande continuent de faire avancer les oraux
  el('fullscreen').addEventListener('click', () => {
    el('fullscreen').blur();
    fullscreen();
  });
  render();
}
