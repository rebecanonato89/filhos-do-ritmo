import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const entry = (o) => ({ foto_confianca: 'alta', idade: '8', pedido1: 'Bola', pedido2: null, pedido3: null, camisa: '8', calca: '8', tenis: '30', duvidas: [], obs: null, ...o });

function setup(turmas) {
  const root = mkdtempSync(join(tmpdir(), 'fdr-cart-'));
  for (const [turma, files, dados] of turmas) {
    mkdirSync(join(root, turma, 'cartinhas'), { recursive: true });
    mkdirSync(join(root, turma, 'fotos'), { recursive: true });
    for (const f of files.cartinhas) writeFileSync(join(root, turma, 'cartinhas', f), jpg);
    for (const f of files.fotos) writeFileSync(join(root, turma, 'fotos', f), jpg);
    writeFileSync(join(root, turma, 'dados.json'), JSON.stringify(dados));
  }
  return root;
}
const run = (root) => spawnSync(process.execPath, ['tools/montar-saida.mjs', root], { encoding: 'utf8' });

test('montador gera planilha importável, renomeia arquivos e tira [?]', () => {
  const root = setup([['Turma 1', { cartinhas: ['a.jpg'], fotos: ['x.jpg'] }, [entry({ cartinha: 'a.jpg', foto: 'x.jpg', nome: 'Davi Gonçalves', pedido1: 'Squishy [?]', duvidas: ['pedido1'] })]]]);
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const csv = readFileSync(join(root, '_saida', 'planilha.csv'), 'utf8');
  assert.match(csv, /^﻿Turma;Nome;Idade;Sexo;Pedido 1;Pedido 2;Pedido 3;Camisa;Calça;Tênis\r\n/);
  assert.match(csv, /Turma 1;Davi Gonçalves;8;;Squishy;;;8;8;30/);
  assert.deepEqual(readdirSync(join(root, '_saida', 'fotos')), ['Davi Gonçalves.jpg']);
  assert.deepEqual(readdirSync(join(root, '_saida', 'cartinhas')), ['Davi Gonçalves.jpg']);
  assert.match(readFileSync(join(root, '_saida', 'revisao.html'), 'utf8'), /1 com itens em laranja/);
});

test('montador bloqueia nome repetido, foto reutilizada e arquivo inexistente', () => {
  const root = setup([
    ['Turma 1', { cartinhas: ['a.jpg', 'b.jpg'], fotos: ['x.jpg'] }, [
      entry({ cartinha: 'a.jpg', foto: 'x.jpg', nome: 'Ana' }),
      entry({ cartinha: 'b.jpg', foto: 'x.jpg', nome: 'Bia' }),
    ]],
    ['Turma 2', { cartinhas: ['c.jpg'], fotos: [] }, [
      entry({ cartinha: 'c.jpg', foto: 'nao-existe.jpg', nome: 'ANA' }),
    ]],
  ]);
  const r = run(root);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /foto x\.jpg já usada por Ana/);
  assert.match(r.stdout, /nome "ANA" repetido/);
  assert.match(r.stdout, /foto nao-existe\.jpg não encontrada/);
});
