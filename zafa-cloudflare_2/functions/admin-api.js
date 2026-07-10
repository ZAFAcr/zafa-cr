// ZAFA — Admin API (privileged). Cloudflare Pages Function.
// Auth: the admin panel sends a secret token in the X-Admin-Token header,
// which is compared against the ADMIN_TOKEN environment variable (never in client code).
// Required env (Pages → Settings → Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN

function j(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return j({ error: 'Method not allowed' }, 405);

  const SUPA_URL = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_TOKEN = env.ADMIN_TOKEN;
  if (!SUPA_URL || !KEY || !ADMIN_TOKEN) return j({ error: 'Servidor sin configurar (faltan variables de entorno)' }, 500);

  // Auth: the admin panel sends the secret token in this header
  const provided = request.headers.get('X-Admin-Token') || '';
  if (provided !== ADMIN_TOKEN) return j({ error: 'No autorizado' }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return j({ error: 'JSON inválido' }, 400); }
  const { action } = body;

  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const rest = (path, init = {}) => fetch(`${SUPA_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

  try {
    if (action === 'load') {
      const [pcs, cfg, bids] = await Promise.all([
        rest('pieces?select=*&order=created_at.asc'),
        rest('site_config?id=eq.current&select=*'),
        rest('bids?select=*&order=amount.desc'),
      ]);
      return j({
        pieces: await pcs.json(),
        config: (await cfg.json())[0] || null,
        bids: await bids.json(),
      });
    }
    if (action === 'savePiece') {
      const r = await rest('pieces', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body.row) });
      if (!r.ok) return j({ error: 'Error guardando pieza: ' + (await r.text()) }, 500);
      return j({ ok: true });
    }
    if (action === 'deletePiece') {
      const r = await rest(`pieces?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return j({ error: 'Error eliminando: ' + (await r.text()) }, 500);
      return j({ ok: true });
    }
    if (action === 'saveConfig') {
      const r = await rest('site_config', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body.row) });
      if (!r.ok) return j({ error: 'Error guardando config: ' + (await r.text()) }, 500);
      return j({ ok: true });
    }
    return j({ error: 'Acción no válida' }, 400);
  } catch (e) {
    return j({ error: 'Error del servidor: ' + e.message }, 500);
  }
}
