// Monta a saída das cartinhas transcritas pelo skill /transcrever-cartinhas.
//   node tools/montar-saida.mjs <pasta>   (padrão: ./cartinhas)
// Lê <pasta>/<Turma>/dados.json e gera em <pasta>/_saida:
//   planilha.csv · fotos/<Nome>.jpg · cartinhas/<Nome>.jpg · revisao.html
// Só copia arquivos localmente; nada é enviado para lugar nenhum.
import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] || 'cartinhas';
if (!existsSync(root)) {
  console.error(`Pasta não encontrada: ${root}`);
  process.exit(1);
}
const out = join(root, '_saida');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fotos'), { recursive: true });
mkdirSync(join(out, 'cartinhas'), { recursive: true });

const FIELDS = ['nome', 'idade', 'pedido1', 'pedido2', 'pedido3', 'camisa', 'calca', 'tenis'];
const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v) => (v == null ? '' : String(v).replace(/\s*\[\?\]\s*/g, ' ').replace(/\s+/g, ' ').trim());
const safeFile = (name) => clean(name).replace(/[\\/:*?"<>|]/g, '').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const csvCell = (v) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const problems = [];
const warnings = [];
const rows = [];
const seenNames = new Map();

const turmas = readdirSync(root).filter((d) => !d.startsWith('_') && !d.startsWith('.') && statSync(join(root, d)).isDirectory());
for (const turma of turmas) {
  const dir = join(root, turma);
  const file = join(dir, 'dados.json');
  if (!existsSync(file)) {
    warnings.push(`${turma}: ainda sem dados.json (não transcrita)`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${turma}: dados.json inválido (${err.message})`);
    continue;
  }
  const lettersOnDisk = existsSync(join(dir, 'cartinhas')) ? readdirSync(join(dir, 'cartinhas')).filter((f) => IMG.test(f)) : [];
  const photosOnDisk = existsSync(join(dir, 'fotos')) ? readdirSync(join(dir, 'fotos')).filter((f) => IMG.test(f)) : [];
  const usedLetters = new Set();
  const usedPhotos = new Map();

  for (const [i, c] of data.entries()) {
    const where = `${turma} #${i + 1} (${c.cartinha ?? 'sem arquivo'})`;
    const name = safeFile(c.nome);
    if (!name) { problems.push(`${where}: sem nome`); continue; }
    if (!c.cartinha || !existsSync(join(dir, 'cartinhas', c.cartinha))) problems.push(`${where}: arquivo da cartinha não encontrado`);
    else usedLetters.add(c.cartinha);
    if (c.foto) {
      if (!existsSync(join(dir, 'fotos', c.foto))) problems.push(`${where}: foto ${c.foto} não encontrada`);
      else if (usedPhotos.has(c.foto)) problems.push(`${where}: foto ${c.foto} já usada por ${usedPhotos.get(c.foto)}`);
      else usedPhotos.set(c.foto, name);
    } else warnings.push(`${where}: sem foto da criança`);
    for (const f of [c.cartinha, c.foto]) if (f && /\.(heic|heif)$/i.test(f)) warnings.push(`${where}: ${f} é HEIC; envie pelo tools/enviar-portal.mjs (o Painel no navegador não lê HEIC).`);

    const key = norm(name);
    if (seenNames.has(key)) problems.push(`${where}: nome "${name}" repetido (também em ${seenNames.get(key)}). O envio em lote casa pelo nome; diferencie (ex.: sobrenome) ou envie pelos ícones 📷/✉️ no Painel.`);
    else seenNames.set(key, turma);

    const doubts = new Set([...(c.duvidas || []), ...FIELDS.filter((f) => /\[\?\]/.test(c[f] ?? ''))]);
    if (c.foto_confianca && c.foto_confianca !== 'alta') doubts.add('foto');
    if (c.cartinha && existsSync(join(dir, 'cartinhas', c.cartinha))) copyFileSync(join(dir, 'cartinhas', c.cartinha), join(out, 'cartinhas', name + extname(c.cartinha).toLowerCase()));
    if (c.foto && existsSync(join(dir, 'fotos', c.foto))) copyFileSync(join(dir, 'fotos', c.foto), join(out, 'fotos', name + extname(c.foto).toLowerCase()));
    rows.push({ turma, name, c, doubts, letterFile: c.cartinha ? name + extname(c.cartinha).toLowerCase() : null, photoFile: c.foto ? name + extname(c.foto).toLowerCase() : null });
  }
  for (const f of lettersOnDisk) if (!usedLetters.has(f)) warnings.push(`${turma}: cartinha ${f} não transcrita`);
  for (const f of photosOnDisk) if (!usedPhotos.has(f)) warnings.push(`${turma}: foto ${f} sem cartinha correspondente`);
}

// Planilha no formato que o Painel importa (UTF-8 com BOM; marcações [?] removidas).
const header = ['Turma', 'Nome', 'Idade', 'Pedido 1', 'Pedido 2', 'Pedido 3', 'Camisa', 'Calça', 'Tênis'];
const lines = rows.map(({ turma, name, c }) => [turma, name, c.idade, c.pedido1, c.pedido2, c.pedido3, c.camisa, c.calca, c.tenis].map((v) => csvCell(clean(v))).join(';'));
writeFileSync(join(out, 'planilha.csv'), '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n');

// Página de revisão: cartinha e foto lado a lado, dúvidas em destaque.
const label = { nome: 'Nome', idade: 'Idade', pedido1: 'Pedido 1', pedido2: 'Pedido 2', pedido3: 'Pedido 3', camisa: 'Camisa', calca: 'Calça', tenis: 'Tênis' };
const cards = rows.map(({ turma, c, doubts, letterFile, photoFile }) => `
  <article class="${doubts.size ? 'doubt' : ''}">
    <div class="imgs">
      ${letterFile ? `<a href="cartinhas/${encodeURIComponent(letterFile)}" target="_blank"><img src="cartinhas/${encodeURIComponent(letterFile)}" alt="cartinha"></a>` : '<div class="miss">sem cartinha</div>'}
      ${photoFile ? `<a href="fotos/${encodeURIComponent(photoFile)}" target="_blank"><img src="fotos/${encodeURIComponent(photoFile)}" alt="foto"></a>` : '<div class="miss">sem foto</div>'}
    </div>
    <table>
      <tr><th>Turma</th><td>${esc(turma)}</td></tr>
      ${Object.entries(label).map(([k, l]) => `<tr class="${doubts.has(k) ? 'q' : ''}"><th>${l}</th><td>${esc(c[k]) || '<span class="empty">—</span>'}</td></tr>`).join('')}
      <tr class="${doubts.has('foto') ? 'q' : ''}"><th>Foto</th><td>${esc(c.foto) || '—'} · confiança ${esc(c.foto_confianca || '?')}</td></tr>
      ${c.obs ? `<tr><th>Obs.</th><td>${esc(c.obs)}</td></tr>` : ''}
      <tr><th>Arquivo</th><td class="small">${esc(c.cartinha)}</td></tr>
    </table>
  </article>`).join('');
const nDoubt = rows.filter((r) => r.doubts.size).length;
writeFileSync(join(out, 'revisao.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisão das cartinhas</title><style>
body{font-family:system-ui,sans-serif;margin:16px;background:#faf7f3;color:#1d1d1f}
h1{margin:0 0 4px}.sum{margin:0 0 16px;color:#555}
.filter{margin-bottom:16px}
article{display:grid;align-items:start;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px;background:#fff;border:1px solid #e6e2dd;border-radius:12px;padding:12px;margin-bottom:12px}
article.doubt{border:2px solid #e8711a}
.imgs{display:grid;grid-template-columns:2fr 1fr;gap:8px;align-items:start}.imgs img{width:100%;border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:15px}th{text-align:left;color:#666;font-weight:600;padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top}td{padding:4px 0}
tr.q td,tr.q th{background:#fff1e5;color:#b3261e}.empty{color:#aaa}.small{font-size:12px;color:#888}.miss{padding:30px;background:#eee;border-radius:8px;text-align:center;color:#888}
@media(max-width:700px){article{grid-template-columns:1fr}}
</style></head><body>
<h1>Revisão das cartinhas</h1>
<p class="sum">${rows.length} cartinhas · <strong>${nDoubt} com itens em laranja para conferir</strong> · Corrija no <code>dados.json</code> da turma e rode o montador de novo.</p>
<label class="filter"><input type="checkbox" onchange="document.querySelectorAll('article:not(.doubt)').forEach(a=>a.hidden=this.checked)"> Mostrar só as que têm dúvida</label>
${cards}
</body></html>`);

console.log(`\n${rows.length} cartinhas em ${turmas.length} turma(s) → ${out}`);
console.log(`  ${nDoubt} com dúvidas para revisar (destacadas em revisao.html)`);
if (warnings.length) console.log(`\nAvisos (${warnings.length}):\n  - ${warnings.join('\n  - ')}`);
if (problems.length) {
  console.log(`\nPROBLEMAS (${problems.length}) — resolva antes de subir no portal:\n  - ${problems.join('\n  - ')}`);
  process.exitCode = 2;
} else console.log('\nSem problemas bloqueantes. Revise revisao.html e depois suba no Painel.');
