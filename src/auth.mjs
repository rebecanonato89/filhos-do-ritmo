import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'fdr_session';
const STATE_COOKIE = 'fdr_state';
const SESSION_TTL_S = 60 * 60 * 24 * 30;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, secure }) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function createSessionCookie(user, config) {
  const payload = b64u(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }));
  return cookie(SESSION_COOKIE, `${payload}.${sign(payload, config.sessionSecret)}`, {
    maxAge: SESSION_TTL_S,
    secure: config.secureCookies,
  });
}

export function clearSessionCookie(config) {
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies });
}

export function readSession(req, config) {
  const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, config.sessionSecret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.email || data.exp < Date.now() / 1000) return null;
    return { email: data.email, name: data.name };
  } catch {
    return null;
  }
}

export function startGoogleLogin(config) {
  const state = randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return {
    location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    setCookie: cookie(STATE_COOKIE, state, { maxAge: 600, secure: config.secureCookies }),
  };
}

export function readStateCookie(req) {
  return parseCookies(req.headers.cookie)[STATE_COOKIE];
}

export function clearStateCookie(config) {
  return cookie(STATE_COOKIE, '', { maxAge: 0, secure: config.secureCookies });
}

/**
 * Troca o code pelo id_token. O token chega direto do endpoint do Google via TLS
 * (fluxo server-side), então validar aud/iss/exp basta — dispensa checar a assinatura JWKS
 * (OpenID Connect Core §3.1.3.7, item 6).
 */
export async function exchangeGoogleCode(code, config) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${config.baseUrl}/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const { id_token: idToken } = await res.json();
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
  if (claims.aud !== config.googleClientId) throw new Error('invalid aud');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('invalid iss');
  if (claims.exp < Date.now() / 1000) throw new Error('expired id_token');
  if (!claims.email || claims.email_verified !== true) throw new Error('email not verified');
  return { email: claims.email.toLowerCase(), name: claims.name || claims.email };
}
