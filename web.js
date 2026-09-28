// Petits outils HTTP partagés par l'API des élèves et les pages du formateur
export const httpError = (status, message) => Object.assign(new Error(message), { status });

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function readBody(req, limit = 10_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw httpError(413, 'Requête trop grande');
  }
  return body;
}

export async function readJson(req, limit) {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body) || {};
  } catch {
    throw httpError(400, 'JSON invalide');
  }
}

export const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
