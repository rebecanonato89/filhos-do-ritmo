'use strict';

const $ = (id) => document.getElementById(id);
const state = { me: null, children: [], view: 'sponsor', classFilter: '', current: null };
const POLL_MS = 15000;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro inesperado'), { status: res.status });
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

function show(id) {
  for (const s of ['loading', 'loginView', 'pendingView', 'sponsorView', 'adminView']) $(s).hidden = s !== id;
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// ---------- Padrinho ----------

function sizesLine(s) {
  const parts = [s.shirt && `Camisa ${s.shirt}`, s.pants && `Calça ${s.pants}`, s.shoe && `Tênis ${s.shoe}`].filter(Boolean);
  return parts.length ? h('p', { class: 'sizes' }, '👕 ', parts.join(' · ')) : null;
}

function card(c) {
  const photo = c.photo_url
    ? h('button', { type: 'button', class: 'photo', onclick: () => openImage(c, 'photo') }, h('img', { src: c.photo_url, alt: `Foto de ${c.name}`, loading: 'lazy' }))
    : h('div', { class: 'photo placeholder' }, '🎁');

  let footer;
  if (c.mine) {
    footer = h('div', { class: 'badge mine' }, c.delivered ? '✅ Sua criança · presente entregue' : '💛 Sua criança · entregar até 01/12');
  } else if (c.status === 'sponsored') {
    footer = h('div', { class: 'badge taken' }, 'Já apadrinhada');
  } else {
    footer = h('button', { type: 'button', class: 'btn', onclick: () => openSponsor(c) }, 'Apadrinhar');
  }

  return h(
    'article',
    { class: `card ${c.status}${c.mine ? ' is-mine' : ''}` },
    photo,
    h('div', { class: 'card-body' },
      h('h3', {}, c.name),
      h('p', { class: 'muted small' }, [c.age && `${c.age} anos`, c.class_name].filter(Boolean).join(' · ')),
      c.letter_photo_url ? h('button', { type: 'button', class: 'letter-btn', onclick: () => openImage(c, 'letter') }, '✉️ Ver cartinha') : null,
      c.letter ? h('p', { class: 'letter-text' }, `“${c.letter}”`) : null,
      c.gifts.length ? h('p', { class: 'label' }, '3 opções de presente') : null,
      h('ol', { class: 'gifts' }, c.gifts.map((g) => h('li', {}, g))),
      sizesLine(c.sizes),
      footer,
    ),
  );
}

function renderSponsor() {
  const mine = state.children.filter((c) => c.mine);
  $('mine').hidden = !mine.length;
  $('mineGrid').replaceChildren(...mine.map(card));

  const classes = [...new Set(state.children.map((c) => c.class_name))];
  $('classChips').replaceChildren(
    ...['', ...classes].map((cl) =>
      h('button', { type: 'button', class: `chip${state.classFilter === cl ? ' active' : ''}`, onclick: () => { state.classFilter = cl; renderSponsor(); } }, cl || 'Todas'),
    ),
  );

  const onlyAvailable = $('onlyAvailable').checked;
  const visible = state.children.filter((c) => (!state.classFilter || c.class_name === state.classFilter) && (!onlyAvailable || c.status === 'available'));
  const available = state.children.filter((c) => c.status === 'available').length;
  $('counter').textContent = state.children.length
    ? `${available} de ${state.children.length} crianças ainda esperando um padrinho`
    : 'As cartinhas ainda estão sendo cadastradas. Volte em breve!';

  const groups = new Map();
  for (const c of visible) {
    if (!groups.has(c.class_name)) groups.set(c.class_name, []);
    groups.get(c.class_name).push(c);
  }
  $('classes').replaceChildren(
    ...[...groups].map(([cl, list]) => h('section', { class: 'class-group' }, h('h2', {}, cl), h('div', { class: 'grid' }, list.map(card)))),
  );
}

function openImage(c, which) {
  const src = which === 'letter' ? c.letter_photo_url : c.photo_url;
  $('photoBig').src = src;
  $('photoBig').alt = which === 'letter' ? `Cartinha de ${c.name}` : `Foto de ${c.name}`;
  $('photoName').textContent = (which === 'letter' ? 'Cartinha de ' : '') + (c.age ? `${c.name}, ${c.age} anos` : c.name);
  $('photoSwitch').hidden = !(c.photo_url && c.letter_photo_url);
  $('photoSwitch').textContent = which === 'letter' ? '📷 Ver foto' : '✉️ Ver cartinha';
  $('photoSwitch').onclick = () => openImage(c, which === 'letter' ? 'photo' : 'letter');
  if (!$('photoDialog').open) $('photoDialog').showModal();
}

function openSponsor(c) {
  state.current = c;
  $('dlgChild').textContent = c.name;
  $('dlgGifts').replaceChildren(...c.gifts.map((g) => h('li', {}, g)));
  $('dlgName').value = state.me.sponsor?.name || state.me.name || '';
  $('dlgPhone').value = state.me.sponsor?.phone || '';
  $('dlgError').hidden = true;
  $('dlgSubmit').disabled = false;
  $('sponsorDialog').showModal();
}

async function submitSponsor(ev) {
  ev.preventDefault();
  const c = state.current;
  $('dlgSubmit').disabled = true;
  try {
    const body = { name: $('dlgName').value, phone: $('dlgPhone').value };
    await api(`/api/children/${c.id}/sponsor`, { method: 'POST', body });
    state.me.sponsor = body;
    $('sponsorDialog').close();
    toast(`Obrigado! ${c.name} agora é sua criança 💛`);
  } catch (err) {
    $('dlgError').textContent = err.message;
    $('dlgError').hidden = false;
    $('dlgSubmit').disabled = err.status === 409;
  }
  await refresh();
}

// ---------- Gestor ----------

function renderAdmin() {
  const all = state.children;
  const sponsored = all.filter((c) => c.status === 'sponsored');
  const delivered = sponsored.filter((c) => c.delivered);
  const stat = (n, label) => h('div', { class: 'stat' }, h('strong', {}, n), h('span', {}, label));
  $('stats').replaceChildren(
    stat(all.length, 'crianças'),
    stat(all.length - sponsored.length, 'disponíveis'),
    stat(sponsored.length, 'apadrinhadas'),
    stat(sponsored.length - delivered.length, 'entrega pendente'),
    stat(delivered.length, 'entregues'),
  );

  const classSel = $('adminClass');
  const classes = [...new Set(all.map((c) => c.class_name))];
  if (classSel.options.length - 1 !== classes.length) {
    const cur = classSel.value;
    classSel.replaceChildren(h('option', { value: '' }, 'Todas as turmas'), ...classes.map((cl) => h('option', { value: cl }, cl)));
    classSel.value = cur;
  }

  const f = $('adminFilter').value;
  const q = $('adminSearch').value.trim().toLowerCase();
  const rows = all.filter((c) => {
    if (classSel.value && c.class_name !== classSel.value) return false;
    if (f === 'available' && c.status !== 'available') return false;
    if (f === 'sponsored' && c.status !== 'sponsored') return false;
    if (f === 'pending' && !(c.status === 'sponsored' && !c.delivered)) return false;
    if (f === 'delivered' && !c.delivered) return false;
    return !q || `${c.name} ${c.sponsor_name || ''} ${c.sponsor_email || ''}`.toLowerCase().includes(q);
  });

  $('adminRows').replaceChildren(
    ...rows.map((c) =>
      h('tr', { class: c.status },
        h('td', {}, c.class_name),
        h('td', {}, c.name, c.age ? h('span', { class: 'muted small' }, ` (${c.age})`) : ''),
        h('td', { class: 'nowrap' },
          h('button', { type: 'button', class: `img-btn${c.photo_url ? ' has' : ''}`, title: 'Enviar foto da criança', onclick: () => pickOne(c, 'photo') }, '📷'),
          h('button', { type: 'button', class: `img-btn${c.letter_photo_url ? ' has' : ''}`, title: 'Enviar foto da cartinha', onclick: () => pickOne(c, 'letter') }, '✉️'),
        ),
        h('td', {}, c.sponsor_name ? [c.sponsor_name, h('br'), h('span', { class: 'muted small' }, c.sponsor_email)] : h('span', { class: 'muted' }, 'Disponível')),
        h('td', {}, c.sponsor_phone_digits
          ? h('a', { href: `https://wa.me/55${c.sponsor_phone_digits}`, target: '_blank', rel: 'noopener' }, c.sponsor_phone)
          : ''),
        h('td', {}, formatDate(c.sponsored_at)),
        h('td', {}, c.status === 'sponsored'
          ? h('input', { type: 'checkbox', checked: c.delivered, 'aria-label': `Entregue para ${c.name}`, onchange: (e) => setDelivered(c, e.target.checked) })
          : ''),
        h('td', {}, c.status === 'sponsored' ? h('button', { type: 'button', class: 'link danger', onclick: () => release(c) }, 'Liberar') : ''),
      ),
    ),
  );
}

async function setDelivered(c, delivered) {
  try {
    await api(`/api/admin/children/${c.id}/delivered`, { method: 'POST', body: { delivered } });
    toast(delivered ? `Presente de ${c.name} marcado como entregue` : `Entrega de ${c.name} desmarcada`);
  } catch (err) {
    toast(err.message);
  }
  await refresh();
}

async function release(c) {
  if (!confirm(`Liberar ${c.name}? O apadrinhamento de ${c.sponsor_name} será desfeito e a criança volta a ficar disponível.`)) return;
  try {
    await api(`/api/admin/children/${c.id}/release`, { method: 'POST', body: {} });
    toast(`${c.name} está disponível novamente`);
  } catch (err) {
    toast(err.message);
  }
  await refresh();
}

async function loadUsers() {
  const users = await api('/api/admin/users');
  const pending = users.filter((u) => !u.approved).length;
  $('pendingBadge').textContent = pending;
  $('pendingBadge').hidden = !pending;
  $('userRows').replaceChildren(
    ...users.map((u) =>
      h('tr', {},
        h('td', {}, u.google_name),
        h('td', {}, u.email),
        h('td', {}, formatDate(u.created_at)),
        h('td', {}, u.approved ? 'Liberado' : h('strong', { class: 'warn' }, 'Aguardando')),
        h('td', {}, h('button', { type: 'button', class: u.approved ? 'link danger' : 'btn btn-small', onclick: () => approve(u, !u.approved) }, u.approved ? 'Bloquear' : 'Liberar')),
      ),
    ),
  );
}

async function approve(u, approved) {
  try {
    await api('/api/admin/users/approval', { method: 'POST', body: { email: u.email, approved } });
    toast(approved ? `${u.email} liberado` : `${u.email} bloqueado`);
  } catch (err) {
    toast(err.message);
  }
  await loadUsers();
}

// ---------- Carga de dados (gestor) ----------

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
let watermarkImg;

function loadWatermark() {
  watermarkImg ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = '/watermark.png';
  });
  return watermarkImg;
}

/**
 * Aplica a marca d'água no navegador e devolve um JPEG novo. Redesenhar no canvas também
 * descarta o EXIF (GPS), e o arquivo original nunca sai do computador de quem envia.
 */
async function watermark(file, kind) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = kind === 'letter' ? 1600 : 1000; // cartinha precisa de resolução para ler a letra
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = hgt;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, hgt);
  const logo = await loadWatermark();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = Math.max(4, w / 150);
  if (kind === 'letter') {
    // Grade suave: protege a foto colada sem atrapalhar a leitura dos pedidos.
    const size = Math.min(w, hgt) / 3;
    ctx.globalAlpha = 0.16;
    for (let y = size * 0.2; y < hgt; y += size * 1.3) for (let x = size * 0.1; x < w; x += size * 1.3) ctx.drawImage(logo, x, y, size, size);
  } else {
    const size = Math.min(w, hgt) * 0.5;
    ctx.globalAlpha = 0.45;
    ctx.drawImage(logo, (w - size) / 2, (hgt - size) / 2, size, size);
  }
  return new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.85));
}

async function uploadImage(c, kind, file) {
  const blob = await watermark(file, kind);
  const res = await fetch(`/api/admin/children/${c.id}/image?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha no envio');
}

function pickOne(c, kind) {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.onchange = async () => {
    if (!input.files[0]) return;
    try {
      await uploadImage(c, kind, input.files[0]);
      toast(`${kind === 'letter' ? 'Cartinha' : 'Foto'} de ${c.name} enviada com marca d'água`);
    } catch (err) {
      toast(err.message);
    }
    await refresh();
  };
  input.click();
}

function logLine(text, cls = '') {
  $('uploadLog').hidden = false;
  $('uploadLog').append(h('li', { class: cls }, text));
}

async function importCsv(file) {
  $('uploadLog').replaceChildren();
  const buf = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em português
  }
  try {
    const r = await fetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: text });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    logLine(`✅ Planilha importada: ${data.count} crianças.`, 'ok');
  } catch (err) {
    logLine(`❌ ${err.message}`, 'fail');
  }
  await refresh();
}

async function bulkUpload(files, kind) {
  $('uploadLog').replaceChildren();
  const byName = new Map();
  for (const c of state.children) {
    const k = norm(c.name);
    byName.set(k, byName.has(k) ? null : c); // null = nome repetido, não dá para casar com segurança
  }
  let ok = 0;
  for (const file of files) {
    const k = norm(file.name.replace(/\.[^.]+$/, ''));
    const c = byName.get(k);
    if (c === undefined) { logLine(`⚠️ ${file.name}: nenhuma criança com esse nome`, 'fail'); continue; }
    if (c === null) { logLine(`⚠️ ${file.name}: nome repetido em mais de uma turma — envie pelo ícone na linha`, 'fail'); continue; }
    try {
      await uploadImage(c, kind, file);
      ok++;
      logLine(`✅ ${file.name} → ${c.name}`, 'ok');
    } catch (err) {
      logLine(`❌ ${file.name}: ${err.message}`, 'fail');
    }
  }
  logLine(`${ok} de ${files.length} enviadas.`);
  await refresh();
}

// ---------- Ciclo ----------

function render() {
  if (state.view === 'admin' && state.me.is_admin) {
    show('adminView');
    renderAdmin();
  } else {
    show('sponsorView');
    renderSponsor();
  }
}

async function refresh() {
  try {
    state.children = await api('/api/children');
    render();
    if (state.me.is_admin) await loadUsers();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return boot();
  }
}

async function boot() {
  if (new URLSearchParams(location.search).has('erro')) {
    $('loginError').hidden = false;
    history.replaceState(null, '', '/');
  }
  state.me = await api('/api/me');
  if (!state.me.authenticated) return show('loginView');
  $('topbar').hidden = false;
  clearInterval(state.timer);
  if (!state.me.approved) {
    $('pendingEmail').textContent = state.me.email;
    show('pendingView');
    // Abre sozinho assim que o gestor liberar, sem o padrinho precisar recarregar.
    state.timer = setInterval(async () => {
      const me = await api('/api/me').catch(() => null);
      if (me?.approved) boot();
    }, POLL_MS);
    return;
  }
  $('adminNav').hidden = !state.me.is_admin;
  await refresh();
  state.timer = setInterval(() => document.visibilityState === 'visible' && !$('sponsorDialog').open && refresh(), POLL_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  $('sponsorForm').addEventListener('submit', submitSponsor);
  $('dlgCancel').addEventListener('click', () => $('sponsorDialog').close());
  $('photoClose').addEventListener('click', () => $('photoDialog').close());
  $('csvInput').addEventListener('change', (e) => e.target.files[0] && importCsv(e.target.files[0]).finally(() => (e.target.value = '')));
  for (const [id, kind] of [['photoInput', 'photo'], ['letterInput', 'letter']]) {
    $(id).addEventListener('change', (e) => bulkUpload([...e.target.files], kind).finally(() => (e.target.value = '')));
  }
  $('onlyAvailable').addEventListener('change', renderSponsor);
  for (const id of ['adminFilter', 'adminClass']) $(id).addEventListener('change', renderAdmin);
  $('adminSearch').addEventListener('input', renderAdmin);
  $('recheckBtn').addEventListener('click', () => location.reload());
  $('logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    location.href = '/';
  });
  for (const btn of document.querySelectorAll('#adminNav .tab')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      document.querySelectorAll('#adminNav .tab').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
    });
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && state.me?.approved && refresh());
  boot().catch(() => show('loginView'));
});
