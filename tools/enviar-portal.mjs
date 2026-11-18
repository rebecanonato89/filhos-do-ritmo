// Envia a saída revisada das cartinhas para o portal, a partir do seu computador.
//
//   node tools/enviar-portal.mjs cartinhas/_saida            → SIMULAÇÃO (não envia nada)
//   node tools/enviar-portal.mjs cartinhas/_saida --enviar   → envia de verdade
//
// Precisa da chave de automação: arquivo .env.portal na raiz do repositório (fica fora do Git) com
//   FDR_TOKEN=<mesmo valor do secret ADMIN_API_TOKEN>
//   FDR_URL=https://filhosdoritmo.rebecanonato89.dev   (opcional)
//
// A marca d'água, a remoção do GPS (EXIF) e a redução das imagens acontecem AQUI, antes do envio:
// o arquivo original nunca sai do computador. Mesmo padrão do Painel: logo central na foto,
// grade suave na cartinha.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) || 'cartinhas/_saida';
const send = args.includes('--enviar');

function loadEnv() {
  const env = { ...process.env };
  const file = join(root, '.env.portal');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const BASE = (env.FDR_URL || 'https://filhosdoritmo.rebecanonato89.dev').replace(/\/$/, '');
const TOKEN = env.FDR_TOKEN;
if (!TOKEN) {
  console.error('Falta FDR_TOKEN. Crie o arquivo .env.portal na raiz do repositório com FDR_TOKEN=<valor do secret ADMIN_API_TOKEN>.');
  process.exit(1);
}
if (!existsSync(outDir)) {
  console.error(`Pasta não encontrada: ${outDir}. Rode antes: node tools/montar-saida.mjs cartinhas`);
  process.exit(1);
}

const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const auth = { authorization: `Bearer ${TOKEN}` };

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`.trim());
  return data;
}

const watermarkPng = readFileSync(join(root, 'public', 'watermark.png'));

async function logo(size, alpha) {
  return sharp(watermarkPng).resize(size, size).ensureAlpha().linear([1, 1, 1, alpha], [0, 0, 0, 0]).png().toBuffer();
}

/** Mesmo resultado do Painel: gira pela orientação, reduz, aplica a logo e grava JPEG sem metadados. */
async function watermark(file, kind) {
  const max = kind === 'letter' ? 1600 : 1000;
  const base = sharp(file).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await base.toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const layers = [];
  if (kind === 'letter') {
    const size = Math.round(Math.min(w, h) / 3);
    const tile = await logo(size, 0.16);
    for (let y = Math.round(size * 0.2); y < h; y += Math.round(size * 1.3)) {
      for (let x = Math.round(size * 0.1); x < w; x += Math.round(size * 1.3)) {
        if (x + size <= w && y + size <= h) layers.push({ input: tile, left: x, top: y });
      }
    }
  } else {
    const size = Math.round(Math.min(w, h) * 0.5);
    layers.push({ input: await logo(size, 0.45), left: Math.round((w - size) / 2), top: Math.round((h - size) / 2) });
  }
  return sharp(data).composite(layers).jpeg({ quality: 85 }).toBuffer(); // sem withMetadata → EXIF/GPS descartados
}

function listImages(dir) {
  const p = join(outDir, dir);
  return existsSync(p) ? readdirSync(p).filter((f) => IMG.test(f)).map((f) => join(p, f)) : [];
}

function plan(children, files, kind) {
  const byName = new Map();
  for (const c of children) {
    const k = norm(c.name);
    byName.set(k, byName.has(k) ? null : c);
  }
  return files.map((f) => {
    const c = byName.get(norm(basename(f, extname(f))));
    const has = c && (kind === 'letter' ? c.letter_photo_url : c.photo_url);
    return { file: f, child: c, kind, problem: c === undefined ? 'nenhuma criança com esse nome' : c === null ? 'nome repetido em mais de uma turma (use o ✏️ no Painel)' : null, replaces: !!has };
  });
}

const csvPath = join(outDir, 'planilha.csv');
const csv = existsSync(csvPath) ? readFileSync(csvPath, 'utf8') : null;
const csvRows = csv ? csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).length - 1 : 0;

console.log(`Portal: ${BASE}`);
console.log(`Modo: ${send ? 'ENVIO DE VERDADE' : 'simulação (nada é enviado; use --enviar para enviar)'}\n`);

let children;
try {
  children = await api('/api/children');
} catch (err) {
  const hint = /^401/.test(err.message)
    ? 'Chave recusada: confira se FDR_TOKEN no .env.portal é igual ao secret ADMIN_API_TOKEN e se o deploy já rodou depois de criar o secret.'
    : `Não foi possível falar com o portal (${err.message}). Confira a internet e o endereço ${BASE}.`;
  console.error(`❌ ${hint}`);
  process.exit(1);
}
console.log(`No portal hoje: ${children.length} crianças.`);
console.log(`Planilha: ${csv ? `${csvRows} linhas` : 'não encontrada (só imagens serão enviadas)'}`);

if (send && csv) {
  const r = await api('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: csv });
  console.log(`✅ Planilha importada: ${r.count} crianças.`);
  children = await api('/api/children');
} else if (csv) {
  // Na simulação, considera também as crianças que a planilha vai criar, só para casar nomes.
  const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0].split(';').map(norm);
  const iName = header.indexOf('nome');
  if (iName >= 0) {
    const known = new Set(children.map((c) => norm(c.name)));
    for (const line of csv.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
      const name = (line.split(';')[iName] || '').replace(/^"|"$/g, '').trim();
      if (name && !known.has(norm(name))) children.push({ name, photo_url: null, letter_photo_url: null, simulated: true });
    }
  }
}

const jobs = [...plan(children, listImages('fotos'), 'photo'), ...plan(children, listImages('cartinhas'), 'letter')];
const ok = jobs.filter((j) => !j.problem);
const bad = jobs.filter((j) => j.problem);
console.log(`Imagens: ${ok.length} prontas para envio (${ok.filter((j) => j.replaces).length} substituem imagem existente), ${bad.length} com problema.`);
for (const j of bad) console.log(`  ⚠️ ${basename(j.file)}: ${j.problem}`);

if (!send) {
  console.log('\nSimulação concluída. Confira os números acima e rode de novo com --enviar.');
  process.exit(bad.length ? 2 : 0);
}

let sent = 0;
for (const j of ok) {
  const label = `${j.kind === 'letter' ? '✉️' : '📷'} ${basename(j.file)} → ${j.child.name}`;
  try {
    const body = await watermark(j.file, j.kind);
    await api(`/api/admin/children/${j.child.id}/image?kind=${j.kind === 'letter' ? 'letter' : 'photo'}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body,
    });
    sent++;
    console.log(`✅ ${label}`);
  } catch (err) {
    console.log(`❌ ${label}: ${err.message}`);
  }
}
console.log(`\n${sent} de ${ok.length} imagens enviadas.${bad.length ? ` ${bad.length} arquivos não casaram com nenhuma criança (veja acima).` : ''}`);
process.exitCode = sent === ok.length && !bad.length ? 0 : 2;
