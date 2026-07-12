// ZAFA — "Te superaron" email. Cloudflare Pages Function (/outbid).
// Called by a Supabase trigger (via pg_net) when a bidder loses the lead on a piece.
// Required env: RESEND_API_KEY, NOTIFY_SECRET   (FROM_EMAIL optional)

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Only Supabase (which knows the shared secret) may call this
  const secret = request.headers.get('x-notify-secret') || '';
  if (!env.NOTIFY_SECRET || secret !== env.NOTIFY_SECRET) return new Response('unauthorized', { status: 401 });
  if (!env.RESEND_API_KEY) return new Response('not configured', { status: 500 });

  let b;
  try { b = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  const { email, piece_name, amount, piece_id } = b;
  if (!email) return new Response('no email', { status: 400 });

  const from = env.FROM_EMAIL || 'notificaciones@zafa.cr';
  const monto = '₡' + Number(amount || 0).toLocaleString('es-CR');
  const link = 'https://zafa.cr/#pieza/' + encodeURIComponent(piece_id || '');
  const html = `<div style="background:#0d0d0d;padding:40px;font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
    <div style="font-size:28px;letter-spacing:8px;color:#c9a84c;margin-bottom:8px;font-weight:bold;">ZAFA</div>
    <div style="color:#5a5248;font-size:12px;letter-spacing:3px;margin-bottom:28px;">LATINOAMÉRICA · VINTAGE Y2K</div>
    <div style="color:#c4522a;font-size:18px;font-weight:700;margin-bottom:8px;">Te superaron ⚡</div>
    <div style="color:#f0e8d8;font-size:14px;line-height:1.6;margin-bottom:6px;">Alguien pujó más alto por <strong>${(piece_name||'una pieza')}</strong>.</div>
    <div style="color:#5a5248;font-size:13px;margin-bottom:22px;">La oferta va en <strong style="color:#c9a84c;">${monto}</strong>. Todavía podés recuperarla — pero cuando cierra, se acaba.</div>
    <a href="${link}" style="display:inline-block;background:#c9a84c;color:#0d0d0d;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:3px;font-size:14px;letter-spacing:1px;">RECUPERAR MI PIEZA →</a>
    <div style="margin-top:28px;border-top:1px solid #2a2520;padding-top:18px;color:#3a3530;font-size:11px;">Recibís esto porque estás pujando en ZAFA. © 2025 ZAFA · CR</div>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `ZAFA <${from}>`, to: email, subject: `⚡ Te superaron en ${piece_name || 'ZAFA'}`, html }),
    });
  } catch (e) { /* best effort */ }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
