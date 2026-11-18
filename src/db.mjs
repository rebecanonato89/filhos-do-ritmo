import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS children (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name    TEXT NOT NULL,
      name          TEXT NOT NULL,
      photo         TEXT,
      gift_1        TEXT,
      gift_2        TEXT,
      gift_3        TEXT,
      shirt_size    TEXT,
      pants_size    TEXT,
      shoe_size     TEXT,
      letter        TEXT,
      age           TEXT,
      letter_photo  TEXT,
      sponsor_email TEXT,
      sponsor_name  TEXT,
      sponsor_phone TEXT,
      sponsored_at  TEXT,
      delivered     INTEGER NOT NULL DEFAULT 0,
      delivered_at  TEXT,
      UNIQUE (class_name, name)
    );

    CREATE TABLE IF NOT EXISTS users (
      email       TEXT PRIMARY KEY,
      google_name TEXT NOT NULL,
      approved    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      last_login  TEXT NOT NULL
    );

    -- Último nome/telefone informado pelo padrinho, para pré-preencher o próximo apadrinhamento.
    CREATE TABLE IF NOT EXISTS sponsors (
      email      TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Banco de produção criado antes da coluna da cartinha existir.
  const cols = db.prepare('PRAGMA table_info(children)').all().map((c) => c.name);
  if (!cols.includes('letter')) db.exec('ALTER TABLE children ADD COLUMN letter TEXT');
  if (!cols.includes('age')) db.exec('ALTER TABLE children ADD COLUMN age TEXT');
  if (!cols.includes('letter_photo')) db.exec('ALTER TABLE children ADD COLUMN letter_photo TEXT');
  // A cartinha real não tem texto livre; limpa o que os primeiros exemplos gravaram.
  db.exec('UPDATE children SET letter = NULL WHERE letter IS NOT NULL');
  return db;
}

const now = () => new Date().toISOString();

export function listChildren(db) {
  return db.prepare('SELECT * FROM children ORDER BY class_name COLLATE NOCASE, name COLLATE NOCASE').all();
}

export function getChild(db, id) {
  return db.prepare('SELECT * FROM children WHERE id = ?').get(id);
}

export function getSponsor(db, email) {
  return db.prepare('SELECT name, phone FROM sponsors WHERE email = ?').get(email);
}

/**
 * Reserva atômica: o UPDATE só afeta a linha se ninguém apadrinhou antes.
 * É isso (e não a tela) que impede duas pessoas de ficarem com a mesma criança.
 */
export function sponsorChild(db, id, { email, name, phone }) {
  const ts = now();
  const res = db
    .prepare(
      `UPDATE children
          SET sponsor_email = ?, sponsor_name = ?, sponsor_phone = ?, sponsored_at = ?
        WHERE id = ? AND sponsor_email IS NULL`,
    )
    .run(email, name, phone, ts, id);
  if (res.changes === 1) {
    db.prepare(
      `INSERT INTO sponsors (email, name, phone, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at`,
    ).run(email, name, phone, ts);
  }
  return res.changes === 1;
}

export function releaseChild(db, id) {
  return (
    db
      .prepare(
        `UPDATE children
            SET sponsor_email = NULL, sponsor_name = NULL, sponsor_phone = NULL,
                sponsored_at = NULL, delivered = 0, delivered_at = NULL
          WHERE id = ?`,
      )
      .run(id).changes === 1
  );
}

export function setDelivered(db, id, delivered) {
  return (
    db
      .prepare(
        `UPDATE children SET delivered = ?, delivered_at = ?
          WHERE id = ? AND sponsor_email IS NOT NULL`,
      )
      .run(delivered ? 1 : 0, delivered ? now() : null, id).changes === 1
  );
}

/** Upsert por (turma, nome). Nunca toca nos campos de apadrinhamento/entrega. */
export function upsertChild(db, c) {
  db.prepare(
    `INSERT INTO children (class_name, name, photo, gift_1, gift_2, gift_3, shirt_size, pants_size, shoe_size, letter, age, letter_photo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(class_name, name) DO UPDATE SET
       -- Planilha sem coluna de foto não apaga a imagem enviada pelo Painel.
       photo = COALESCE(excluded.photo, children.photo),
       letter_photo = COALESCE(excluded.letter_photo, children.letter_photo), gift_1 = excluded.gift_1, gift_2 = excluded.gift_2, gift_3 = excluded.gift_3,
       shirt_size = excluded.shirt_size, pants_size = excluded.pants_size, shoe_size = excluded.shoe_size,
       letter = excluded.letter, age = excluded.age`,
  ).run(
    ...['class_name', 'name', 'photo', 'gift_1', 'gift_2', 'gift_3', 'shirt_size', 'pants_size', 'shoe_size', 'letter', 'age', 'letter_photo'].map((k) => c[k] ?? null),
  );
}

export function recordLogin(db, { email, name }) {
  const ts = now();
  db.prepare(
    `INSERT INTO users (email, google_name, approved, created_at, last_login) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(email) DO UPDATE SET google_name = excluded.google_name, last_login = excluded.last_login`,
  ).run(email, name, ts, ts);
}

export function isApproved(db, email) {
  return db.prepare('SELECT approved FROM users WHERE email = ?').get(email)?.approved === 1;
}

export function listUsers(db) {
  return db.prepare('SELECT email, google_name, approved, created_at, last_login FROM users ORDER BY approved, created_at DESC').all();
}

export function setApproved(db, email, approved) {
  return db.prepare('UPDATE users SET approved = ? WHERE email = ?').run(approved ? 1 : 0, email).changes === 1;
}

/** Remove só as crianças de exemplo (fotos com prefixo demo-). */
export function deleteDemoChildren(db) {
  return db.prepare("DELETE FROM children WHERE photo LIKE 'demo-%' OR letter_photo LIKE 'demo-%'").run().changes;
}

export const EDITABLE = ['class_name', 'name', 'age', 'gift_1', 'gift_2', 'gift_3', 'shirt_size', 'pants_size', 'shoe_size'];

export function createChild(db, data) {
  const cols = EDITABLE.join(', ');
  const res = db.prepare(`INSERT INTO children (${cols}) VALUES (${EDITABLE.map(() => '?').join(', ')})`).run(...EDITABLE.map((k) => data[k] ?? null));
  return Number(res.lastInsertRowid);
}

/** Corrige os dados digitados da cartinha. Lança erro de UNIQUE se turma+nome já existir. */
export function updateChild(db, id, data) {
  const sets = EDITABLE.map((k) => `${k} = ?`).join(', ');
  return db.prepare(`UPDATE children SET ${sets} WHERE id = ?`).run(...EDITABLE.map((k) => data[k] ?? null), id).changes === 1;
}

/** Troca a imagem (kind = 'photo' | 'letter_photo') e devolve o arquivo anterior para ser apagado. */
export function setChildImage(db, id, kind, file) {
  if (!['photo', 'letter_photo'].includes(kind)) throw new Error('kind inválido');
  const before = db.prepare(`SELECT ${kind} AS f FROM children WHERE id = ?`).get(id);
  if (!before) return undefined;
  db.prepare(`UPDATE children SET ${kind} = ? WHERE id = ?`).run(file, id);
  return before.f;
}
