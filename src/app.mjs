import { readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { childrenFromCsv } from './csv.mjs';
import { createReadStream } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db_ from './db.mjs';
import * as auth from './auth.mjs';
import { DELIVERY } from './delivery.mjs';
import { buildXlsx, S as XS } from './xlsx.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/privacidade': ['privacidade.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/logo.jpg': ['logo.jpg', 'image/jpeg'],
  '/icon.png': ['icon.png', 'image/png'],
  '/watermark.png': ['watermark.png', 'image/png'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/pix-qr.png': ['pix-qr.png', 'image/png'],
  '/og.jpg': ['og.jpg', 'image/jpeg'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
};

const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function redirect(res, location, setCookie = []) {
  send(res, 302, '', { Location: location, 'Set-Cookie': setCookie, 'Cache-Control': 'no-store' });
}

// Exigir um Content-Type que <form> não consegue enviar impede POST cross-site (CSRF), somado ao SameSite=Lax.
async function readBody(req, type, limit) {
  if (!(req.headers['content-type'] || '').startsWith(type)) throw new HttpError(415, 'Content-Type inválido');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Arquivo grande demais');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, 'application/json', 10_000);
  try {
    return JSON.parse(buf.toString() || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  return /^\d{10,11}$/.test(local) ? local : null;
}

function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  return name.length >= 3 && name.length <= 120 ? name : null;
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula ao abrir no Excel
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatPhone(p) {
  if (!p) return '';
  return p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
}

function childView(c, user, isAdmin) {
  const base = {
    id: c.id,
    class_name: c.class_name,
    name: c.name,
    photo_url: c.photo ? `/photos/${encodeURIComponent(c.photo)}` : null,
    letter_photo_url: c.letter_photo ? `/photos/${encodeURIComponent(c.letter_photo)}` : null,
    gifts: [c.gift_1, c.gift_2, c.gift_3].filter(Boolean),
    sizes: { shirt: c.shirt_size, pants: c.pants_size, shoe: c.shoe_size },
    age: c.age || null,
    gender: c.gender || null,
    status: c.sponsor_email ? 'sponsored' : 'available',
    mine: c.sponsor_email === user.email,
  };
  if (base.mine || isAdmin) base.delivered = c.delivered === 1;
  if (isAdmin) {
    Object.assign(base, {
      sponsor_name: c.sponsor_name,
      sponsor_email: c.sponsor_email,
      sponsor_phone: formatPhone(c.sponsor_phone),
      sponsor_phone_digits: c.sponsor_phone,
      sponsored_at: c.sponsored_at,
      delivered_at: c.delivered_at,
    });
  }
  return base;
}

let assetVersionPromise;
function assetVersion() {
  assetVersionPromise ??= Promise.all(['app.js', 'styles.css'].map((f) => readFile(join(PUBLIC_DIR, f)))).then((bufs) => {
    const hash = createHash('sha256');
    for (const b of bufs) hash.update(b);
    return hash.digest('hex').slice(0, 10);
  });
  return assetVersionPromise;
}

export function createApp({ db, config, exchangeCode = auth.exchangeGoogleCode }) {
  const isAdmin = (user) => user.api === true || config.adminEmails.includes(user.email);

  // Chave para automação (Claude Code local enviando as cartinhas). Desligada se ausente/curta.
  const apiToken = config.apiToken && config.apiToken.length >= 32 ? Buffer.from(config.apiToken) : null;
  function readApiToken(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!apiToken || !m) return null;
    const given = Buffer.from(m[1]);
    if (given.length !== apiToken.length || !timingSafeEqual(given, apiToken)) return null;
    return { email: 'automacao@filhosdoritmo', name: 'Envio automático', api: true };
  }
  const canSee = (user) => isAdmin(user) || !config.requireApproval || db_.isApproved(db, user.email);

  // "Online agora": última chamada de cada e-mail, só em memória (zera no deploy, sem gravar
  // nada novo no banco). Navegadores abertos consultam a cada 15 s enquanto a aba está visível.
  const ONLINE_MS = 60_000;
  const lastSeen = new Map();
  const touch = (user) => { if (user?.email && !user.api) lastSeen.set(user.email, Date.now()); };

  function requireUser(req) {
    const user = readApiToken(req) || auth.readSession(req, config);
    if (!user) throw new HttpError(401, 'Faça login');
    touch(user);
    return user;
  }

  function requireViewer(req) {
    const user = requireUser(req);
    if (!canSee(user)) throw new HttpError(403, 'Acesso aguardando aprovação');
    return user;
  }

  function requireAdmin(req) {
    const user = requireUser(req);
    if (!isAdmin(user)) throw new HttpError(403, 'Apenas gestores');
    return user;
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (origin && origin !== config.baseUrl) throw new HttpError(403, 'Origem inválida');
  }

  async function route(req, res) {
    const url = new URL(req.url, config.baseUrl);
    const path = url.pathname;
    const method = req.method;
    if (method === 'POST' || method === 'DELETE') checkOrigin(req);

    if (method === 'GET' && STATIC[path]) {
      const [file, type] = STATIC[path];
      let body = await readFile(join(PUBLIC_DIR, file));
      if (type.startsWith('text/html')) {
        // Versão no endereço do CSS/JS: após cada deploy o navegador busca os arquivos novos
        // em vez de misturar HTML novo com CSS/JS antigos do cache.
        const v = await assetVersion();
        body = body.toString().replace('/styles.css"', `/styles.css?v=${v}"`).replace('/app.js"', `/app.js?v=${v}"`);
        return send(res, 200, body, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      }
      const versioned = url.searchParams.has('v') && (path === '/app.js' || path === '/styles.css');
      return send(res, 200, body, { 'Content-Type': type, 'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300' });
    }

    if (method === 'GET' && path === '/health') return json(res, 200, { ok: true });

    // ---- Autenticação ----
    if (method === 'GET' && path === '/auth/google') {
      if (!config.googleClientId) throw new HttpError(503, 'Login Google não configurado');
      const { location, setCookie } = auth.startGoogleLogin(config);
      return redirect(res, location, [setCookie]);
    }

    if (method === 'GET' && path === '/auth/google/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const expected = auth.readStateCookie(req);
      if (!code || !state || !expected || state !== expected) return redirect(res, '/?erro=login', [auth.clearStateCookie(config)]);
      let user;
      try {
        user = await exchangeCode(code, config);
      } catch (err) {
        console.error('login failed', err.message);
        return redirect(res, '/?erro=login', [auth.clearStateCookie(config)]);
      }
      db_.recordLogin(db, user);
      return redirect(res, '/', [auth.clearStateCookie(config), auth.createSessionCookie(user, config)]);
    }

    if (method === 'POST' && path === '/auth/logout') {
      res.setHeader('Set-Cookie', auth.clearSessionCookie(config));
      return json(res, 200, { ok: true });
    }

    // ---- Padrinho ----
    if (method === 'GET' && path === '/api/delivery') {
      requireViewer(req);
      return json(res, 200, DELIVERY);
    }

    if (method === 'GET' && path === '/api/me') {
      const user = auth.readSession(req, config);
      if (!user) return json(res, 200, { authenticated: false });
      touch(user);
      return json(res, 200, {
        authenticated: true,
        email: user.email,
        name: user.name,
        is_admin: isAdmin(user),
        approved: canSee(user),
        sponsor: db_.getSponsor(db, user.email) || null,
      });
    }

    if (method === 'GET' && path === '/api/children') {
      const user = requireViewer(req);
      const admin = isAdmin(user);
      return json(res, 200, db_.listChildren(db).map((c) => childView(c, user, admin)));
    }

    let m;
    if (method === 'POST' && (m = path.match(/^\/api\/children\/(\d+)\/sponsor$/))) {
      const user = requireViewer(req);
      const body = await readJson(req);
      const name = cleanName(body.name);
      const phone = normalizePhone(body.phone);
      if (!name) throw new HttpError(400, 'Informe o nome completo (mínimo 3 letras)');
      if (!phone) throw new HttpError(400, 'Informe um WhatsApp válido com DDD');
      const id = Number(m[1]);
      if (!db_.getChild(db, id)) throw new HttpError(404, 'Criança não encontrada');
      if (!db_.sponsorChild(db, id, { email: user.email, name, phone })) {
        throw new HttpError(409, 'Essa criança acabou de ser apadrinhada por outra pessoa');
      }
      return json(res, 200, childView(db_.getChild(db, id), user, isAdmin(user)));
    }

    if (method === 'GET' && (m = path.match(/^\/photos\/([^/]+)$/))) {
      requireViewer(req);
      const file = basename(decodeURIComponent(m[1]));
      const type = PHOTO_TYPES[extname(file).toLowerCase()];
      if (!type) throw new HttpError(404, 'Não encontrado');
      const full = join(config.photosDir, file);
      try {
        await stat(full);
      } catch {
        throw new HttpError(404, 'Não encontrado');
      }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      return createReadStream(full).pipe(res);
    }

    // ---- Gestor ----
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/children\/(\d+)\/delivered$/))) {
      requireAdmin(req);
      const body = await readJson(req);
      if (!db_.setDelivered(db, Number(m[1]), body.delivered === true)) throw new HttpError(409, 'Criança sem padrinho');
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && (m = path.match(/^\/api\/admin\/children\/(\d+)\/release$/))) {
      const admin = requireAdmin(req);
      const id = Number(m[1]);
      const before = db_.getChild(db, id);
      if (!before) throw new HttpError(404, 'Criança não encontrada');
      db_.releaseChild(db, id);
      console.log(`release child=${id} by=${admin.email} previous_sponsor=${before.sponsor_email}`);
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && (m = path.match(/^\/api\/admin\/children(?:\/(\d+))?$/))) {
      const admin = requireAdmin(req);
      const id = m[1] ? Number(m[1]) : null;
      if (id && !db_.getChild(db, id)) throw new HttpError(404, 'Criança não encontrada');
      const body = await readJson(req);
      const data = {};
      for (const k of db_.EDITABLE) {
        const v = String(body[k] ?? '').replace(/\s+/g, ' ').trim();
        if (v.length > 120) throw new HttpError(400, 'Texto grande demais');
        data[k] = v || null;
      }
      if (!data.class_name || !data.name) throw new HttpError(400, 'Turma e nome são obrigatórios');
      let savedId = id;
      try {
        if (id) db_.updateChild(db, id, data);
        else savedId = db_.createChild(db, data);
      } catch (err) {
        if (/UNIQUE/.test(err.message)) throw new HttpError(409, 'Já existe uma criança com esse nome nessa turma');
        throw err;
      }
      console.log(`${id ? 'edit' : 'create'} child=${savedId} by=${admin.email}`);
      return json(res, 200, childView(db_.getChild(db, savedId), admin, true));
    }

    if (method === 'POST' && path === '/api/admin/import') {
      const admin = requireAdmin(req);
      const text = (await readBody(req, 'text/csv', 2_000_000)).toString('utf8');
      let children;
      try {
        children = childrenFromCsv(text);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      if (!children.length) throw new HttpError(400, 'Nenhuma criança encontrada na planilha');
      db.exec('BEGIN');
      try {
        // Imagens chegam pelo upload do Painel; a planilha não aponta para arquivos.
        for (const c of children) db_.upsertChild(db, { ...c, photo: null, letter_photo: null });
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      console.log(`import rows=${children.length} by=${admin.email}`);
      return json(res, 200, { count: children.length });
    }

    if (method === 'POST' && (m = path.match(/^\/api\/admin\/children\/(\d+)\/image$/))) {
      requireAdmin(req);
      const kind = url.searchParams.get('kind') === 'letter' ? 'letter_photo' : 'photo';
      const id = Number(m[1]);
      if (!db_.getChild(db, id)) throw new HttpError(404, 'Criança não encontrada');
      const img = await readBody(req, 'image/jpeg', 4_000_000);
      // O navegador já aplicou marca d'água e removeu EXIF; aqui só garantimos que é JPEG.
      if (img.length < 4 || img[0] !== 0xff || img[1] !== 0xd8 || img[2] !== 0xff) throw new HttpError(400, 'Imagem inválida');
      const file = `${kind === 'photo' ? 'child' : 'letter'}-${id}-${randomBytes(6).toString('hex')}.jpg`;
      await writeFile(join(config.photosDir, file), img);
      const old = db_.setChildImage(db, id, kind, file);
      if (old) await unlink(join(config.photosDir, basename(old))).catch(() => {});
      return json(res, 200, { url: `/photos/${file}` });
    }

    if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/children\/(\d+)\/image$/))) {
      requireAdmin(req);
      const kind = url.searchParams.get('kind') === 'letter' ? 'letter_photo' : 'photo';
      const id = Number(m[1]);
      if (!db_.getChild(db, id)) throw new HttpError(404, 'Criança não encontrada');
      const old = db_.setChildImage(db, id, kind, null);
      if (old) await unlink(join(config.photosDir, basename(old))).catch(() => {});
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && path === '/api/admin/users') {
      requireAdmin(req);
      const now = Date.now();
      return json(res, 200, db_.listUsers(db).map((u) => ({ ...u, approved: u.approved === 1, is_admin: isAdmin(u), online: now - (lastSeen.get(u.email) || 0) < ONLINE_MS })));
    }

    if (method === 'POST' && path === '/api/admin/users/approval') {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      const email = String(body.email || '').toLowerCase();
      if (!db_.setApproved(db, email, body.approved === true)) throw new HttpError(404, 'Usuário não encontrado');
      console.log(`approval email=${email} approved=${body.approved === true} by=${admin.email}`);
      return json(res, 200, { ok: true });
    }

    if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/users\/([^/]+)$/))) {
      const admin = requireAdmin(req);
      const email = decodeURIComponent(m[1]).toLowerCase();
      if (!db_.deleteUser(db, email)) throw new HttpError(404, 'Usuário não encontrado');
      console.log(`delete user email=${email} by=${admin.email}`);
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && path === '/api/admin/export.xlsx') {
      requireAdmin(req);
      // Gerada na hora a partir do banco: sempre reflete o estado atual (e nunca vai para cache).
      const tz = { timeZone: 'America/Sao_Paulo' };
      const now = new Date();
      const stamp = now.toLocaleString('pt-BR', { ...tz, dateStyle: 'short', timeStyle: 'short' });
      const fileStamp = now.toLocaleString('sv-SE', tz).slice(0, 16).replace(' ', '_').replace(':', 'h');
      const kids = db_.listChildren(db);
      const taken = kids.filter((c) => c.sponsor_email);
      const columns = [
        ['Turma', 16], ['Criança', 32], ['Idade', 7], ['Pedido 1', 28], ['Pedido 2', 28], ['Pedido 3', 28],
        ['Camiseta', 10], ['Calça', 8], ['Tênis', 8], ['Situação', 13], ['Padrinho', 30], ['Telefone', 17],
        ['E-mail', 34], ['Apadrinhado em', 17],
      ].map(([name, width]) => ({ name, width }));
      const rows = kids.map((c) => {
        const status = !c.sponsor_email ? 'Disponível' : c.delivered ? 'Entregue' : 'Apadrinhada';
        const st = !c.sponsor_email ? XS.free : c.delivered ? XS.done : XS.taken;
        return {
          cells: [c.class_name, c.name, c.age, c.gift_1, c.gift_2, c.gift_3, c.shirt_size, c.pants_size, c.shoe_size, status,
            c.sponsor_name, formatPhone(c.sponsor_phone), c.sponsor_email,
            c.sponsored_at ? new Date(c.sponsored_at).toLocaleString('pt-BR', { ...tz, dateStyle: 'short', timeStyle: 'short' }) : ''],
          styles: Object.assign([], { 9: st }),
        };
      });
      const file = buildXlsx({
        sheetName: 'Apadrinhamentos',
        title: 'Filhos do Ritmo · Natal Solidário — Apadrinhamentos',
        subtitle: `Gerado em ${stamp} · ${kids.length} crianças · ${taken.length} apadrinhadas · ${taken.filter((c) => c.delivered).length} entregues · ${kids.length - taken.length} disponíveis`,
        columns, rows,
      });
      return send(res, 200, file, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="filhos-do-ritmo-apadrinhamentos_${fileStamp}.xlsx"`,
        'Cache-Control': 'no-store',
      });
    }

    if (method === 'GET' && path === '/api/admin/export.csv') {
      requireAdmin(req);
      const header = ['Turma', 'Criança', 'Idade', 'Sexo', 'Pedido 1', 'Pedido 2', 'Pedido 3', 'Camisa', 'Calça', 'Tênis', 'Status', 'Padrinho', 'E-mail', 'WhatsApp', 'Apadrinhado em', 'Entregue'];
      const rows = db_.listChildren(db).map((c) => [
        c.class_name, c.name, c.age, c.gender === 'F' ? 'Menina' : c.gender === 'M' ? 'Menino' : '', c.gift_1, c.gift_2, c.gift_3, c.shirt_size, c.pants_size, c.shoe_size,
        c.sponsor_email ? 'Apadrinhada' : 'Disponível', c.sponsor_name, c.sponsor_email, formatPhone(c.sponsor_phone),
        c.sponsored_at ? new Date(c.sponsored_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
        c.sponsor_email ? (c.delivered ? 'Sim' : 'Não') : '',
      ]);
      const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
      return send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="filhos-do-ritmo-apadrinhamentos.csv"',
        'Cache-Control': 'no-store',
      });
    }

    throw new HttpError(404, 'Não encontrado');
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'Erro interno' });
    }
  };
}
