import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, upsertChild, listChildren, sponsorChild } from '../src/db.mjs';

const run = (dataDir, action) =>
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/demo.mjs', action], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: 'utf8',
  });

test('demo seed cria 10 com idade e clear remove só as de exemplo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fdr-demo-'));
  const db = openDb(join(dir, 'app.db'));
  upsertChild(db, { class_name: 'Turma 1', name: 'Real', photo: 'real.jpg', gift_1: 'Bola' });

  run(dir, 'seed');
  run(dir, 'seed'); // idempotente
  let all = listChildren(db);
  assert.equal(all.length, 11);
  assert.ok(all.filter((c) => c.photo?.startsWith('demo-')).every((c) => c.age && c.gift_1 && c.shoe_size));
  assert.equal(readdirSync(join(dir, 'photos')).filter((f) => f.startsWith('demo-')).length, 20);
  assert.ok(all.filter((c) => c.photo?.startsWith('demo-')).every((c) => c.letter_photo?.startsWith('demo-')));

  sponsorChild(db, all.find((c) => c.name === 'Davi').id, { email: 'a@b.com', name: 'Teste', phone: '35999999999' });
  run(dir, 'clear');
  all = listChildren(db);
  assert.deepEqual(all.map((c) => c.name), ['Real']);
  assert.equal(readdirSync(join(dir, 'photos')).length, 0);
});

test('banco antigo sem coluna letter é migrado ao abrir', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fdr-mig-')), 'app.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE children (id INTEGER PRIMARY KEY AUTOINCREMENT, class_name TEXT NOT NULL, name TEXT NOT NULL,
    photo TEXT, gift_1 TEXT, gift_2 TEXT, gift_3 TEXT, shirt_size TEXT, pants_size TEXT, shoe_size TEXT,
    sponsor_email TEXT, sponsor_name TEXT, sponsor_phone TEXT, sponsored_at TEXT, delivered INTEGER NOT NULL DEFAULT 0,
    delivered_at TEXT, UNIQUE (class_name, name));
    INSERT INTO children (class_name, name) VALUES ('T', 'Antiga');`);
  old.close();
  const db = openDb(file);
  upsertChild(db, { class_name: 'T', name: 'Antiga', letter: 'Oi' });
  assert.equal(listChildren(db)[0].letter, 'Oi');
});

test('banco antigo ganha a coluna age ao abrir', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fdr-age-')), 'app.db');
  openDb(file).close();
  const raw = new DatabaseSync(file);
  raw.exec('ALTER TABLE children DROP COLUMN age');
  raw.close();
  const db = openDb(file);
  upsertChild(db, { class_name: 'T', name: 'X', age: '8' });
  assert.equal(listChildren(db)[0].age, '8');
});
