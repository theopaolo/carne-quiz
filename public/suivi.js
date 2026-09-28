// Page du formateur : résultats en direct, notes sans rechargement, copie du lien et import de quiz.
// Les URL sont absolues : une page ouverte avec le mot de passe dans l'adresse refuse un fetch relatif.
const here = () => location.origin + location.pathname + location.search;
let busy = false;

// Remplace le bloc des résultats par celui d'une page fraîche, en gardant le focus clavier
async function refresh(response) {
  const html = await (response || (await fetch(here()))).text();
  const next = new DOMParser().parseFromString(html, 'text/html').getElementById('live');
  const live = document.getElementById('live');
  if (!next || !live) return;
  const focused = document.activeElement?.id;
  live.replaceWith(next);
  if (focused) document.getElementById(focused)?.focus();
}

setInterval(async () => {
  if (!document.getElementById('live') || document.hidden || busy) return;
  busy = true;
  try {
    await refresh();
  } catch {
    // Réseau coupé : la prochaine mise à jour réessaie, l'heure affichée montre le retard
  } finally {
    busy = false;
  }
}, 5000);

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) return e.preventDefault();
  if (!form.hasAttribute('data-inline')) return;
  // Les notes partent sans recharger la page. Sans JavaScript, le formulaire marche aussi.
  e.preventDefault();
  busy = true;
  try {
    const res = await fetch(location.origin + form.getAttribute('action'), {
      method: 'POST',
      body: new URLSearchParams(new FormData(form, e.submitter)),
    });
    if (res.ok) await refresh(res);
  } finally {
    busy = false;
  }
});

document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-copy]');
  if (!button) return;
  const input = document.getElementById(button.dataset.copy);
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = 'Lien copié';
  } catch {
    button.textContent = 'Lien sélectionné, copiez-le';
  }
  setTimeout(() => (button.textContent = 'Copier le lien'), 2500);
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

document.getElementById('import-file')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const out = document.getElementById('import-result');
  if (!file) return;
  out.innerHTML = `<p>Import de ${esc(file.name)}…</p>`;
  const res = await fetch(`${location.origin}/prof/import?nom=${encodeURIComponent(file.name)}`, { method: 'POST', body: await file.text() });
  const data = await res.json().catch(() => ({}));
  e.target.value = '';
  if (res.ok) return location.assign(`/prof?importe=${encodeURIComponent(data.id)}`);
  const errors = data.errors || [data.error || `erreur ${res.status}`];
  out.innerHTML = `<p class="alert">${esc(file.name)} n'est pas importé. À corriger dans le fichier :</p>
    <ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
});
