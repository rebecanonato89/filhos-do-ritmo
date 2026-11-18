import { createServer } from 'node:http';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.mjs';
import { createApp } from './app.mjs';

const env = process.env;
const baseUrl = (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const dataDir = env.DATA_DIR || './data';

const config = {
  baseUrl,
  secureCookies: baseUrl.startsWith('https://'),
  sessionSecret: env.SESSION_SECRET || '',
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  requireApproval: env.REQUIRE_APPROVAL !== 'false',
  apiToken: env.ADMIN_API_TOKEN || '',
  photosDir: join(dataDir, 'photos'),
};

if (config.sessionSecret.length < 32) {
  console.error('SESSION_SECRET precisa ter pelo menos 32 caracteres');
  process.exit(1);
}
if (!config.adminEmails.length) console.warn('ADMIN_EMAILS vazio: ninguém terá acesso de gestor');
if (!config.googleClientId) console.warn('GOOGLE_CLIENT_ID vazio: login desativado');

mkdirSync(config.photosDir, { recursive: true });
const db = openDb(join(dataDir, 'app.db'));
const port = Number(env.PORT || 3000);

// Cópia do banco a cada 6h dentro do volume (mantém as 12 últimas = 3 dias).
// Não substitui o CSV exportado pelo gestor, que é a cópia fora da VPS.
const backupDir = join(dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });
function backup() {
  try {
    const file = join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file}'`);
    const old = readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort().slice(0, -12);
    for (const f of old) rmSync(join(backupDir, f));
  } catch (err) {
    console.error('backup failed', err.message);
  }
}
backup();
setInterval(backup, 6 * 60 * 60 * 1000).unref();

createServer(createApp({ db, config })).listen(port, () => {
  console.log(`filhos-do-ritmo on :${port} admins=${config.adminEmails.join(',')} approval=${config.requireApproval}`);
});
