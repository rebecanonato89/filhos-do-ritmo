import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertChild } from '../src/db.mjs';
import { createApp, normalizePhone } from '../src/app.mjs';

const ADMIN = 'gestora@gmail.com';
let server, base, db;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fdr-'));
  const photosDir = join(dir, 'photos');
  (await import('node:fs')).mkdirSync(photosDir);
  writeFileSync(join(photosDir, 'ana.jpg'), 'fake-jpeg');
  db = openDb(join(dir, 'app.db'));
  upsertChild(db, { class_name: 'Turma 1', name: 'Ana', photo: 'ana.jpg', gift_1: 'Boneca', gift_2: 'Livro', gift_3: 'Bola', shirt_size: '8', pants_size: '8', shoe_size: '30', letter: 'Querido padrinho', age: '8' });
  upsertChild(db, { class_name: 'Turma 2', name: 'Bruno', photo: null, gift_1: 'Carrinho', gift_2: null, gift_3: null, shirt_size: null, pants_size: null, shoe_size: null });

  const config = {
    baseUrl: 'http://localhost', // sobrescrito abaixo após saber a porta
    secureCookies: false,
    sessionSecret: 'x'.repeat(40),
    googleClientId: 'cid',
    googleClientSecret: 'secret',
    adminEmails: [ADMIN],
    requireApproval: true,
    photosDir,
  };
  // O "Google" de teste devolve o e-mail passado como code.
  const exchangeCode = async (code) => ({ email: code, name: code.split('@')[0] });
  server = createServer(createApp({ db, config, exchangeCode }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  config.baseUrl = base;
});

after(() => server.close());

async function login(email) {
  const start = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await fetch(`${base}/auth/google/callback?code=${encodeURIComponent(email)}&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: stateCookie },
  });
  const session = cb.headers.getSetCookie().find((c) => c.startsWith('fdr_session='));
  assert.ok(session, 'deve criar sessão');
  return session.split(';')[0];
}

const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
const post = (path, cookie, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });

let admin, alice, bob;

test('sem login não vê crianças nem fotos', async () => {
  assert.equal((await get('/api/children')).status, 401);
  assert.equal((await get('/photos/ana.jpg')).status, 401);
  assert.equal((await (await get('/api/me')).json()).authenticated, false);
});

test('callback com state errado não cria sessão', async () => {
  const res = await fetch(`${base}/auth/google/callback?code=x@gmail.com&state=forjado`, { redirect: 'manual', headers: { cookie: 'fdr_state=outro' } });
  assert.equal(res.headers.get('location'), '/?erro=login');
  assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('fdr_session=') && !c.startsWith('fdr_session=;')));
});

test('cookie adulterado é rejeitado', async () => {
  const fake = Buffer.from(JSON.stringify({ email: ADMIN, exp: 9e9 })).toString('base64url');
  assert.equal((await get('/api/children', `fdr_session=${fake}.assinaturafalsa`)).status, 401);
});

test('login sem aprovação fica bloqueado até o gestor liberar', async () => {
  admin = await login(ADMIN);
  alice = await login('alice@gmail.com');
  bob = await login('bob@gmail.com');

  const me = await (await get('/api/me', alice)).json();
  assert.equal(me.approved, false);
  assert.equal((await get('/api/children', alice)).status, 403);
  assert.equal((await get('/photos/ana.jpg', alice)).status, 403);

  assert.equal((await post('/api/admin/users/approval', alice, { email: 'alice@gmail.com', approved: true })).status, 403, 'padrinho não se autoaprova');
  assert.equal((await post('/api/admin/users/approval', admin, { email: 'alice@gmail.com', approved: true })).status, 200);
  assert.equal((await post('/api/admin/users/approval', admin, { email: 'bob@gmail.com', approved: true })).status, 200);
  assert.equal((await get('/api/children', alice)).status, 200);
  assert.equal((await get('/photos/ana.jpg', alice)).status, 200);
});

test('path traversal em fotos não escapa da pasta', async () => {
  assert.equal((await get('/photos/..%2F..%2Fapp.db', alice)).status, 404);
});

test('apadrinhar: valida dados, bloqueia segundo padrinho e esconde dados de terceiros', async () => {
  const ana = (await (await get('/api/children', alice)).json()).find((c) => c.name === 'Ana');
  assert.ok(!('letter' in ana), 'cartinha não tem texto livre')
  assert.equal(ana.age, '8');

  assert.equal((await post(`/api/children/${ana.id}/sponsor`, alice, { name: 'Al', phone: '35999999999' })).status, 400);
  assert.equal((await post(`/api/children/${ana.id}/sponsor`, alice, { name: 'Alice Souza', phone: '123' })).status, 400);

  const ok = await post(`/api/children/${ana.id}/sponsor`, alice, { name: 'Alice Souza', phone: '+55 (35) 99999-1234' });
  assert.equal(ok.status, 200);

  const dup = await post(`/api/children/${ana.id}/sponsor`, bob, { name: 'Bob Lima', phone: '35988887777' });
  assert.equal(dup.status, 409);

  const bobView = (await (await get('/api/children', bob)).json()).find((c) => c.id === ana.id);
  assert.equal(bobView.status, 'sponsored');
  assert.equal(bobView.mine, false);
  for (const k of ['sponsor_name', 'sponsor_email', 'sponsor_phone', 'delivered']) assert.ok(!(k in bobView), `bob não pode ver ${k}`);

  const aliceView = (await (await get('/api/children', alice)).json()).find((c) => c.id === ana.id);
  assert.equal(aliceView.mine, true);
  assert.equal(aliceView.delivered, false);

  const adminView = (await (await get('/api/children', admin)).json()).find((c) => c.id === ana.id);
  assert.equal(adminView.sponsor_name, 'Alice Souza');
  assert.equal(adminView.sponsor_phone, '(35) 99999-1234');
});

test('corrida: 20 padrinhos ao mesmo tempo, só 1 fica com a criança', async () => {
  const bruno = (await (await get('/api/children', admin)).json()).find((c) => c.name === 'Bruno');
  const users = [];
  for (let i = 0; i < 20; i++) {
    const c = await login(`p${i}@gmail.com`);
    await post('/api/admin/users/approval', admin, { email: `p${i}@gmail.com`, approved: true });
    users.push(c);
  }
  const results = await Promise.all(users.map((c, i) => post(`/api/children/${bruno.id}/sponsor`, c, { name: `Padrinho ${i}`, phone: '35911112222' })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 19);
});

test('gestor: entrega, liberação e exportação; padrinho não acessa', async () => {
  const ana = (await (await get('/api/children', admin)).json()).find((c) => c.name === 'Ana');
  assert.equal((await post(`/api/admin/children/${ana.id}/delivered`, alice, { delivered: true })).status, 403);
  assert.equal((await post(`/api/admin/children/${ana.id}/delivered`, admin, { delivered: true })).status, 200);
  assert.equal((await (await get('/api/children', alice)).json()).find((c) => c.id === ana.id).delivered, true);

  assert.equal((await get('/api/admin/export.csv', alice)).status, 403);
  const csv = await (await get('/api/admin/export.csv', admin)).text();
  assert.match(csv, /Turma;Criança;Idade;.*;Tênis;/);
  assert.match(csv, /Turma 1;Ana;8;Boneca/);
  assert.match(csv, /Alice Souza;alice@gmail.com;\(35\) 99999-1234;.*;Sim/);

  assert.equal((await post(`/api/admin/children/${ana.id}/release`, admin, {})).status, 200);
  const after = (await (await get('/api/children', alice)).json()).find((c) => c.id === ana.id);
  assert.equal(after.status, 'available');
  assert.equal(after.mine, false);
});

test('bloquear acesso tem efeito imediato', async () => {
  await post('/api/admin/users/approval', admin, { email: 'bob@gmail.com', approved: false });
  assert.equal((await get('/api/children', bob)).status, 403);
});

test('CSRF: exige JSON e mesma origem', async () => {
  const form = await fetch(`${base}/api/children/1/sponsor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: alice },
    body: 'name=X&phone=1',
  });
  assert.equal(form.status, 415);
  assert.equal((await post('/api/children/1/sponsor', alice, { name: 'Alice', phone: '35999999999' }, { origin: 'https://evil.example' })).status, 403);
});

test('respostas levam noindex', async () => {
  assert.match((await get('/')).headers.get('x-robots-tag'), /noindex/);
});

test('normalizePhone', () => {
  assert.equal(normalizePhone('(35) 9 9999-1234'), '35999991234');
  assert.equal(normalizePhone('+55 35 3333-4444'), '3533334444');
  assert.equal(normalizePhone('9999-1234'), null);
});

test('gestor importa planilha CSV pelo Painel sem apagar apadrinhamento nem foto', async () => {
  const csv = 'Turma;Nome;Idade;Pedido 1;Pedido 2;Pedido 3;Camisa;Calça;Tênis\nTurma 1;Ana;9;Boneca nova;Livro;Bola;10;10;31\nTurma 3;Carlos;7;Pipa;;;6;6;27\n';
  const send = (cookie, body, type = 'text/csv') => fetch(`${base}/api/admin/import`, { method: 'POST', headers: { 'Content-Type': type, cookie }, body });
  assert.equal((await send(alice, csv)).status, 403);
  assert.equal((await send(admin, 'Nome;Idade\nX;1\n')).status, 400, 'sem coluna Turma');
  const before = (await (await get('/api/children', admin)).json()).find((c) => c.name === 'Ana');
  const r = await send(admin, csv);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).count, 2);
  const list = await (await get('/api/children', admin)).json();
  const ana = list.find((c) => c.name === 'Ana');
  assert.equal(ana.age, '9');
  assert.deepEqual(ana.gifts, ['Boneca nova', 'Livro', 'Bola']);
  assert.equal(ana.photo_url, before.photo_url, 'foto preservada');
  assert.equal(ana.sponsor_name, before.sponsor_name, 'apadrinhamento preservado');
  assert.ok(list.find((c) => c.name === 'Carlos'));
});

test('upload de imagem: só gestor, só JPEG, troca apaga o arquivo anterior', async () => {
  const carlos = (await (await get('/api/children', admin)).json()).find((c) => c.name === 'Carlos');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const up = (cookie, body, kind = 'photo', type = 'image/jpeg') =>
    fetch(`${base}/api/admin/children/${carlos.id}/image?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': type, cookie }, body });

  assert.equal((await up(alice, jpeg)).status, 403);
  assert.equal((await up(admin, Buffer.from('<svg/>'), 'photo', 'image/jpeg')).status, 400);
  assert.equal((await up(admin, jpeg, 'photo', 'image/svg+xml')).status, 415);

  const first = await (await up(admin, jpeg)).json();
  assert.equal((await get(first.url, admin)).status, 200);
  const second = await (await up(admin, jpeg)).json();
  assert.notEqual(first.url, second.url);
  assert.equal((await get(first.url, admin)).status, 404, 'arquivo antigo removido');

  const letter = await (await up(admin, jpeg, 'letter')).json();
  const view = (await (await get('/api/children', alice)).json()).find((c) => c.id === carlos.id);
  assert.equal(view.photo_url, second.url);
  assert.equal(view.letter_photo_url, letter.url);
});

test('gestor edita os dados da cartinha; padrinho não pode; nome duplicado na turma é recusado', async () => {
  const list = await (await get('/api/children', admin)).json();
  const carlos = list.find((c) => c.name === 'Carlos');
  const ana = list.find((c) => c.name === 'Ana');
  const body = { class_name: 'Turma 3', name: 'Carlos Eduardo', age: '8', gift_1: 'Pipa', gift_2: 'Bola', gift_3: '', shirt_size: '8', pants_size: '8', shoe_size: '28' };
  assert.equal((await post(`/api/children/${carlos.id}`, alice, body)).status, 404, 'rota de padrinho não existe');
  assert.equal((await post(`/api/admin/children/${carlos.id}`, alice, body)).status, 403);
  assert.equal((await post(`/api/admin/children/${carlos.id}`, admin, { ...body, name: '' })).status, 400);
  const r = await post(`/api/admin/children/${carlos.id}`, admin, body);
  assert.equal(r.status, 200);
  const updated = await r.json();
  assert.equal(updated.name, 'Carlos Eduardo');
  assert.deepEqual(updated.gifts, ['Pipa', 'Bola']);
  assert.ok(updated.photo_url, 'imagem preservada');
  assert.equal((await post(`/api/admin/children/${carlos.id}`, admin, { ...body, class_name: ana.class_name, name: ana.name })).status, 409);
});
