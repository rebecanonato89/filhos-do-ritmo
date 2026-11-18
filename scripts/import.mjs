// Uso: npm run import -- planilha.csv
// Colunas (cabeçalho, ordem livre, ; ou ,): turma, nome, foto, pedido1, pedido2, pedido3, camisa, calca, sapato, cartinha
// Reexecutar é seguro: atualiza por (turma, nome) e nunca mexe em padrinho/entrega.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertChild } from '../src/db.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import -- planilha.csv');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || './data';
const photosDir = join(dataDir, 'photos');

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const key = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  class_name: ['turma'], name: ['nome', 'nomedacrianca', 'crianca'], photo: ['foto', 'arquivofoto'],
  gift_1: ['pedido1', 'presente1', 'opcao1'], gift_2: ['pedido2', 'presente2', 'opcao2'], gift_3: ['pedido3', 'presente3', 'opcao3'],
  shirt_size: ['camisa', 'tamcamisa', 'tamanhocamisa'], pants_size: ['calca', 'tamcalca', 'tamanhocalca'],
  shoe_size: ['sapato', 'tamsapato', 'tamanhosapato', 'calcado'],
  letter: ['cartinha', 'texto', 'textodacartinha', 'mensagem'],
};

const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'));
const idx = {};
header.forEach((h, i) => {
  for (const [field, names] of Object.entries(ALIASES)) if (names.includes(key(h))) idx[field] = i;
});
for (const required of ['class_name', 'name']) {
  if (idx[required] === undefined) { console.error(`Coluna obrigatória ausente: ${required}. Cabeçalho lido: ${header.join(' | ')}`); process.exit(1); }
}

const db = openDb(join(dataDir, 'app.db'));
let ok = 0;
const missingPhotos = [];
db.exec('BEGIN');
for (const r of rows) {
  const get = (f) => (idx[f] === undefined ? null : (r[idx[f]] || '').trim() || null);
  const child = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, get(f)]));
  if (!child.class_name || !child.name) continue;
  if (child.photo && !existsSync(join(photosDir, child.photo))) {
    missingPhotos.push(`${child.name} -> ${child.photo}`);
    child.photo = null; // sem foto o card mostra um placeholder em vez de imagem quebrada
  }
  upsertChild(db, child);
  ok++;
}
db.exec('COMMIT');
console.log(`${ok} crianças importadas/atualizadas.`);
if (missingPhotos.length) console.warn(`Fotos não encontradas em ${photosDir}:\n  ${missingPhotos.join('\n  ')}`);
