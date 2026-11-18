// Uso: npm run import -- planilha.csv   (o Painel também importa: Painel → Carregar dados)
// Colunas (cabeçalho, ordem livre, ; ou ,): turma, nome, idade, pedido 1..3, camisa, calça, tênis
// e opcionalmente foto / foto da cartinha (nome do arquivo já presente em /data/photos).
// Reexecutar é seguro: atualiza por (turma, nome) e nunca mexe em padrinho/entrega.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertChild } from '../src/db.mjs';
import { childrenFromCsv } from '../src/csv.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import -- planilha.csv');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || './data';
const photosDir = join(dataDir, 'photos');

let children;
try {
  children = childrenFromCsv(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const db = openDb(join(dataDir, 'app.db'));
const missing = [];
db.exec('BEGIN');
for (const child of children) {
  for (const k of ['photo', 'letter_photo']) {
    if (child[k] && !existsSync(join(photosDir, child[k]))) {
      missing.push(`${child.name} -> ${child[k]}`);
      child[k] = null; // mantém a imagem atual em vez de apontar para arquivo inexistente
    }
  }
  upsertChild(db, child);
}
db.exec('COMMIT');
console.log(`${children.length} crianças importadas/atualizadas.`);
if (missing.length) console.warn(`Imagens não encontradas em ${photosDir}:\n  ${missing.join('\n  ')}`);
