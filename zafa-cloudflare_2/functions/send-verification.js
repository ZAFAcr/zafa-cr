// ZAFA — Verification email — Cloudflare Pages Function

const RESEND_API_KEY = 're_UcNx8snS_Bfc13A7gkT9dckVzHStU9R5L';
const FROM_EMAIL = 'notificaciones@zafa.cr';
const SECRET = 'zafa_secret_2025_cr';

async function signCode(code, email, expires) {
  const data = `${code}:${email}:${expires}:${SECRET}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('').substring(0,16);
}

async function verifyToken(token, email) {
  try {
    const [code, expires, sig] = token.split('.');
    if (Date.now() > parseInt(expires)) return {valid:false, reason:'expired'};
    const expected = await signCode(code, email, expires);
    if (sig !== expected) return {valid:false, reason:'invalid'};
    return {valid:true, code};
  } catch(e) { return {valid:false, reason:'malformed'}; }
}

const rateLimitStore = new Map();
function checkRateLimit(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  const attempts = (rateLimitStore.get(key)||[]).filter(t=>now-t<60000);
  if (attempts.length >= 3) return false;
  rateLimitStore.set(key, [...attempts, now]);
  return true;
}

function corsHeaders(origin) {
  const allowed = ['https://zafa.cr','https://www.zafa.cr','https://zafa-c2n.pages.dev'];
  const o = (allowed.includes(origin)||origin.endsWith('.pages.dev')) ? origin : 'https://zafa.cr';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function json(data, status=200, origin='') {
  return new Response(JSON.stringify(data), {status, headers: corsHeaders(origin)});
}

// Single export handles ALL methods
export async function onRequest(context) {
  const {request} = context;
  const origin = request.headers.get('Origin') || '';

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {status:204, headers: corsHeaders(origin)});
  }

  if (request.method !== 'POST') {
    return json({error:'Method not allowed'}, 405, origin);
  }

  let body;
  try { body = await request.json(); }
  catch(e) { return json({error:'Invalid JSON'}, 400, origin); }

  const {action, email, token, code} = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    return json({error:'Email inválido'}, 400, origin);
  }

  // SEND
  if (action === 'send') {
    if (!checkRateLimit(email)) {
      return json({error:'Demasiados intentos. Esperá un minuto.'}, 429, origin);
    }
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000;
    const sig = await signCode(verifyCode, email, expires.toString());
    const signedToken = `${verifyCode}.${expires}.${sig}`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify({
          from: `ZAFA <${FROM_EMAIL}>`,
          to: email,
          subject: `Tu código ZAFA: ${verifyCode}`,
          html: `<div style="background:#0d0d0d;padding:40px;font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
            <div style="font-size:28px;letter-spacing:8px;color:#c9a84c;margin-bottom:8px;font-weight:bold;">ZAFA</div>
            <div style="color:#5a5248;font-size:12px;letter-spacing:3px;margin-bottom:32px;">LATINOAMÉRICA · VINTAGE Y2K</div>
            <div style="color:#f0e8d8;font-size:16px;font-weight:500;margin-bottom:8px;">Tu código de verificación</div>
            <div style="color:#5a5248;font-size:13px;margin-bottom:28px;">Ingresá este código en el sitio para completar tu registro.</div>
            <div style="background:#161410;border:1px solid #2a2520;padding:28px;text-align:center;margin-bottom:24px;border-radius:2px;">
              <div style="font-family:monospace;font-size:48px;font-weight:700;letter-spacing:14px;color:#c9a84c;">${verifyCode}</div>
            </div>
            <div style="background:#1a1410;border:1px solid rgba(196,82,42,.3);padding:12px 16px;border-radius:2px;margin-bottom:20px;">
              <div style="color:#c4522a;font-size:12px;font-family:monospace;letter-spacing:1px;">⏳ Este código expira en 10 minutos</div>
            </div>
            <div style="color:#5a5248;font-size:12px;line-height:1.7;">Si no solicitaste este código, ignorá este email. Tu cuenta no fue creada.</div>
            <div style="margin-top:32px;border-top:1px solid #2a2520;padding-top:20px;color:#3a3530;font-size:11px;font-family:monospace;letter-spacing:2px;">© 2025 ZAFA · CR</div>
          </div>`
        })
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('Resend error:', err);
        return json({error:'Error enviando email'}, 500, origin);
      }
      return json({success:true, token:signedToken}, 200, origin);
    } catch(e) {
      console.error('Fetch error:', e);
      return json({error:'Error del servidor'}, 500, origin);
    }
  }

  // VERIFY
  if (action === 'verify') {
    if (!token || !code) return json({error:'Datos incompletos'}, 400, origin);
    const result = await verifyToken(token, email);
    if (!result.valid) {
      const msg = result.reason === 'expired' ? 'El código expiró — solicitá uno nuevo' : 'Código incorrecto';
      return json({error:msg}, 400, origin);
    }
    if (result.code !== code) return json({error:'Código incorrecto — verificá tu email'}, 400, origin);
    return json({success:true, verified:true}, 200, origin);
  }

  return json({error:'Acción no válida'}, 400, origin);
}
