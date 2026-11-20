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
    // CSSOM em vez do atributo style: a CSP (style-src 'self') bloqueia estilos inline.
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Cor fixa por turma (ordem alfabética), para diferenciar chips, títulos, cards e linhas do Painel.
// Tons pastel (infantis) com a "tinta" escura do mesmo tom para o texto ficar legível.
const CLASS_COLORS = [
  ['#bfe0fb', '#1f6fb2'], // azul-céu
  ['#f9c6d8', '#b03a6b'], // rosa-bebê
  ['#c4efd9', '#1f7a4d'], // verde-menta
  ['#ddd0fb', '#6b46c1'], // lilás
  ['#fdd8b5', '#b8590f'], // pêssego
  ['#fbefa8', '#866a00'], // amarelo-limão
  ['#bdeef0', '#12808a'], // água
  ['#fcc9c1', '#b5402e'], // coral
  ['#cfd8fb', '#3f51b5'], // lavanda
  ['#def5b8', '#557a12'], // lima
];
function classColor(name) {
  const all = [...new Set(state.children.map((c) => c.class_name))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const [bg, ink] = CLASS_COLORS[Math.max(0, all.indexOf(name)) % CLASS_COLORS.length];
  return { '--tc': bg, '--tci': ink };
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

// Card no formato da cartinha impressa do Natal Solidário.
function field(value, cls = '') {
  return h('span', { class: `lc-field hand ${cls}` }, value || ' ');
}

// Texto para o padrinho guardar/compartilhar (lista de compras, família). Sem foto: ela fica só no portal.
function childSummary(c) {
  const lines = [
    `🎁 Natal Solidário Filhos do Ritmo`,
    `Criança: ${c.name}${c.age ? `, ${c.age} anos` : ''} (${c.class_name})`,
    `Pedidos (escolha 1 ou mais): ${c.gifts.map((g, i) => `${i + 1}) ${g}`).join(' · ')}`,
  ];
  const sz = [c.sizes.shirt && `Camiseta ${c.sizes.shirt}`, c.sizes.pants && `Calça ${c.sizes.pants}`, c.sizes.shoe && `Tênis ${c.sizes.shoe}`].filter(Boolean);
  if (sz.length) lines.push(`Tamanhos: ${sz.join(' · ')}`);
  lines.push('📦 Entregar até 01/12 · identifique o presente com o nome e a turma da criança.');
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Dados copiados 📋');
  } catch {
    toast('Não foi possível copiar neste navegador');
  }
}

function card(c) {
  const photo = c.photo_url
    ? h('button', { type: 'button', class: 'polaroid-img', onclick: () => openImage(c, 'photo'), 'aria-label': `Ampliar foto de ${c.name}`, 'data-tip': 'Ampliar foto' },
        h('img', { src: c.photo_url, alt: `Foto de ${c.name}`, loading: 'lazy' }))
    : h('div', { class: 'polaroid-img empty' }, '🎁');

  let footer;
  if (c.mine) {
    footer = h('div', {},
      h('div', { class: 'badge mine' }, c.delivered ? '✅ Sua criança · presente entregue' : '💛 Sua criança · entregar até 01/12'),
      h('div', { class: 'share-row' },
        h('a', { class: 'btn btn-small btn-whats', href: `https://wa.me/?text=${encodeURIComponent(childSummary(c))}`, target: '_blank', rel: 'noopener', 'data-tip': 'Enviar os dados para você ou sua família' }, '📲 WhatsApp'),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => copyText(childSummary(c)), 'data-tip': 'Copiar os dados da cartinha' }, '📋 Copiar dados'),
      ));
  } else if (c.status === 'sponsored') {
    footer = h('div', { class: 'badge taken' }, 'Já apadrinhada');
  } else {
    footer = h('button', { type: 'button', class: 'btn', onclick: () => openSponsor(c) }, '🎁 Apadrinhar');
  }

  const sizes = [['Camiseta', c.sizes.shirt], ['Calça', c.sizes.pants], ['Tênis', c.sizes.shoe]];

  return h(
    'article',
    { class: `card letter-card ${c.status}${c.mine ? ' is-mine' : ''}`, vars: classColor(c.class_name) },
    h('div', { class: 'lc-head' },
      h('span', { class: 'lc-class', vars: classColor(c.class_name) }, c.class_name),
      h('span', { class: 'lc-dear' }, 'Querido Papai Noel...'),
      state.me.is_admin ? h('button', { type: 'button', class: 'pencil', onclick: () => openEdit(c), 'data-tip': 'Editar cartinha', 'aria-label': `Editar ${c.name}` }, '✏️') : null,
      c.letter_photo_url
        ? h('button', { type: 'button', class: 'envelope', onclick: () => openImage(c, 'letter'), 'data-tip': 'Ver a cartinha original', 'aria-label': `Ver a cartinha de ${c.name}` }, h('span', { 'aria-hidden': 'true' }, '✉️'), h('span', { class: 'env-label' }, ' Cartinha'))
        : null,
    ),
    // Foto grande no topo (largura do card); nome e idade logo abaixo.
    h('figure', { class: 'polaroid polaroid-big' }, photo, h('figcaption', {}, 'Minha foto')),
    h('div', { class: 'lc-id lc-id-below' },
      h('span', { class: 'lc-label' }, 'Meu nome é:'),
      field(c.name, 'lc-name'),
      h('span', { class: 'lc-label' }, 'Eu tenho ', field(c.age, 'lc-age'), ' anos.',
        c.gender ? h('span', { class: `gender-tag g-${c.gender}` }, c.gender === 'F' ? '👧 Menina' : '👦 Menino') : null),
    ),
    h('p', { class: 'lc-q' }, 'Neste Natal, eu gostaria de ganhar:'),
    h('ol', { class: 'lc-wishes' }, c.gifts.map((g) => h('li', {}, field(g)))),
    sizes.some(([, v]) => v)
      ? h('div', { class: 'lc-sizes' },
          h('p', { class: 'lc-sizes-title' }, 'Meus tamanhos'),
          h('div', { class: 'lc-sizes-row three' }, sizes.map(([label, v]) =>
            h('span', { class: 'lc-size' }, `${label} `, field(v, 'lc-box')))))
      : null,
    h('div', { class: 'lc-footer' }, footer),
  );
}

// Nomes longos não quebram linha: primeiro abrevia os nomes do meio ("Helena Louise Ferreira
// Barusco" -> "Helena L. Ferreira Barusco" -> ...), mantendo o primeiro e o último nome por
// inteiro; se ainda não couber, reduz a fonte até caber.
function fitName(el) {
  const full = el.dataset.full ?? (el.dataset.full = el.textContent);
  const words = full.split(' ');
  el.style.fontSize = '';
  el.textContent = full;
  if (el.scrollWidth <= el.clientWidth + 1) return;
  for (let i = 1; i < words.length - 1 && el.scrollWidth > el.clientWidth + 1; i++) {
    if (words[i].length <= 2) continue;
    words[i] = words[i][0] + '.';
    el.textContent = words.join(' ');
  }
  if (el.scrollWidth <= el.clientWidth + 1) return;
  // Reduz a partir do tamanho que já está valendo neste breakpoint (não um valor fixo).
  const baseSize = parseFloat(getComputedStyle(el).fontSize);
  const minSize = baseSize * 0.72;
  let size = baseSize;
  while (el.scrollWidth > el.clientWidth + 1 && size > minSize) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

function fitAllNames() {
  document.querySelectorAll('.lc-name').forEach(fitName);
}

function renderSponsor() {
  const mine = state.children.filter((c) => c.mine).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const onlyMine = state.view === 'mine';
  // 'Minhas' só aparece na aba Minhas: a tela Cartinhas mostra a lista inteira para apadrinhar mais.
  $('mineLayout').hidden = !onlyMine;
  $('mine').hidden = !(onlyMine && mine.length);
  $('mineGrid').replaceChildren(...mine.map(card));
  $('mineEmpty').hidden = !(onlyMine && !mine.length);
  for (const id of ['sponsorToolbar', 'counter', 'classes']) $(id).hidden = onlyMine;
  document.querySelectorAll('[data-badge=mine]').forEach((b) => { b.textContent = mine.length; b.hidden = !mine.length; });
  if (onlyMine) { fitAllNames(); return; }

  const classes = [...new Set(state.children.map((c) => c.class_name))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('classChips').replaceChildren(
    ...['', ...classes].map((cl) =>
      h('button', { type: 'button', class: `chip${cl ? ' chip-class' : ''}${state.classFilter === cl ? ' active' : ''}`, vars: cl ? classColor(cl) : null, onclick: () => { state.classFilter = cl; renderSponsor(); } }, cl || 'Todas'),
    ),
  );

  const onlyAvailable = $('onlyAvailable').checked;
  const [ageMin, ageMax] = ($('ageFilter').value || '0-999').split('-').map(Number);
  const visible = state.children.filter((c) => {
    if (state.classFilter && c.class_name !== state.classFilter) return false;
    if (onlyAvailable && c.status !== 'available') return false;
    if ($('ageFilter').value) {
      const age = parseInt(c.age, 10);
      if (!(age >= ageMin && age <= ageMax)) return false;
    }
    return true;
  });
  const available = state.children.filter((c) => c.status === 'available').length;
  $('counter').textContent = state.children.length
    ? `${available} de ${state.children.length} crianças ainda esperando um padrinho`
    : 'As cartinhas ainda estão sendo cadastradas. Volte em breve!';

  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const groups = new Map();
  for (const c of visible) {
    if (!groups.has(c.class_name)) groups.set(c.class_name, []);
    groups.get(c.class_name).push(c);
  }
  for (const list of groups.values()) list.sort(byName);
  $('classes').replaceChildren(
    ...classes.filter((cl) => groups.has(cl)).map((cl) => {
      const list = groups.get(cl);
      return h('section', { class: 'class-group', vars: classColor(cl) },
        h('h2', { class: 'class-band' }, h('span', {}, cl),
          h('span', { class: 'class-count' }, `${list.length} ${list.length === 1 ? 'criança' : 'crianças'} · ${list.filter((c) => c.status === 'available').length} disponíveis`)),
        h('div', { class: 'grid' }, list.map(card)));
    }),
  );
  fitAllNames();
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
    $('sponsoredName').textContent = c.name;
    $('sponsoredDialog').showModal();
    document.querySelectorAll('[data-view=mine]').forEach((b) => b.classList.add('pulse'));
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
  $('kidsCount').textContent = all.length;
  const sponsored = all.filter((c) => c.status === 'sponsored');
  const delivered = sponsored.filter((c) => c.delivered);
  const stat = (icon, n, label, kind) => h('div', { class: `stat stat-${kind}` }, h('span', { class: 'stat-ico', 'aria-hidden': 'true' }, icon), h('div', {}, h('strong', {}, n), h('span', {}, label)));
  $('stats').replaceChildren(
    stat('👧', all.length, 'crianças', 'total'),
    stat('🎁', all.length - sponsored.length, 'disponíveis', 'free'),
    stat('💛', sponsored.length, 'apadrinhadas', 'taken'),
    stat('⏳', sponsored.length - delivered.length, 'entrega pendente', 'pending'),
    stat('✅', delivered.length, 'entregues', 'done'),
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
        h('td', { 'data-label': 'Turma' }, h('span', { class: 'class-pill', vars: classColor(c.class_name) }, c.class_name)),
        h('td', { 'data-label': 'Criança', class: 'cell-title' },
          h('button', { type: 'button', class: 'pencil pencil-sm', onclick: () => openEdit(c), 'data-tip': 'Editar cartinha', 'aria-label': `Editar ${c.name}` }, '✏️'),
          c.name, c.age ? h('span', { class: 'muted small' }, ` (${c.age}${c.gender ? `, ${c.gender === 'F' ? 'menina' : 'menino'}` : ''})`) : ''),
        h('td', { class: 'nowrap', 'data-label': 'Imagens' },
          h('button', { type: 'button', class: `img-btn${c.photo_url ? ' has' : ''}`, 'data-tip': c.photo_url ? 'Trocar foto da criança' : 'Adicionar foto da criança', 'aria-label': c.photo_url ? 'Trocar foto da criança' : 'Adicionar foto da criança', onclick: () => pickOne(c, 'photo') }, '📷', h('span', {}, c.photo_url ? '✓' : '+')),
          h('button', { type: 'button', class: `img-btn${c.letter_photo_url ? ' has' : ''}`, 'data-tip': c.letter_photo_url ? 'Trocar cartinha' : 'Adicionar cartinha', 'aria-label': c.letter_photo_url ? 'Trocar cartinha' : 'Adicionar cartinha', onclick: () => pickOne(c, 'letter') }, '✉️', h('span', {}, c.letter_photo_url ? '✓' : '+')),
        ),
        h('td', { 'data-label': 'Padrinho' }, c.sponsor_name ? [h('span', { class: `status-pill ${c.delivered ? 'done' : 'taken'}` }, c.delivered ? 'Entregue' : 'Apadrinhada'), h('br'), h('strong', {}, c.sponsor_name), h('br'), h('span', { class: 'muted small' }, c.sponsor_email)] : h('span', { class: 'status-pill free' }, 'Disponível')),
        h('td', { 'data-label': 'WhatsApp', class: c.sponsor_phone_digits ? '' : 'empty-cell' }, c.sponsor_phone_digits
          ? h('a', { href: `https://wa.me/55${c.sponsor_phone_digits}`, target: '_blank', rel: 'noopener' }, c.sponsor_phone)
          : ''),
        h('td', { 'data-label': 'Apadrinhado em', class: c.sponsored_at ? '' : 'empty-cell' }, formatDate(c.sponsored_at)),
        h('td', { 'data-label': 'Entregue', class: c.status === 'sponsored' ? '' : 'empty-cell' }, c.status === 'sponsored'
          ? h('input', { type: 'checkbox', checked: c.delivered, 'aria-label': `Entregue para ${c.name}`, title: 'Marcar presente como entregue', onchange: (e) => setDelivered(c, e.target.checked) })
          : ''),
        h('td', { class: c.status === 'sponsored' ? 'cell-actions' : 'empty-cell' }, c.status === 'sponsored' ? h('button', { type: 'button', class: 'link danger', onclick: () => release(c) }, 'Liberar') : ''),
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
  state.users = await api('/api/admin/users');
  renderUsers();
}

// Cruza logins com apadrinhamentos no navegador: os dados de padrinho já chegam ao gestor em /api/children.
function renderUsers() {
  const users = state.users || [];
  const byEmail = new Map();
  for (const c of state.children) {
    if (!c.sponsor_email) continue;
    if (!byEmail.has(c.sponsor_email)) byEmail.set(c.sponsor_email, []);
    byEmail.get(c.sponsor_email).push(c);
  }
  const kidsOf = (u) => (byEmail.get(u.email) || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const sponsors = users.filter((u) => !u.is_admin);
  const pending = sponsors.filter((u) => !u.approved);
  const approved = sponsors.filter((u) => u.approved);
  const withKids = sponsors.filter((u) => kidsOf(u).length);
  const idle = approved.filter((u) => !kidsOf(u).length);
  document.querySelectorAll('[data-badge=pending]').forEach((b) => { b.textContent = pending.length; b.hidden = !pending.length; });
  notifyNewPending(pending);
  // A gestora não percebeu o contador pequeno: aviso grande enquanto houver gente esperando.
  const onUsers = state.view === 'admin' && !$('panelUsers').hidden;
  $('adminAlert').hidden = !pending.length || onUsers;
  $('adminAlert').textContent = `🔔 ${pending.length} ${pending.length === 1 ? 'pessoa aguardando' : 'pessoas aguardando'} liberação · Ver e liberar →`;

  const stat = (icon, n, label, kind, filter) => h('button', { type: 'button', class: `stat stat-${kind} stat-btn${$('userFilter').value === filter ? ' active' : ''}`, 'data-tip': 'Filtrar a lista', onclick: () => { $('userFilter').value = filter; renderUsers(); } }, h('span', { class: 'stat-ico', 'aria-hidden': 'true' }, icon), h('div', {}, h('strong', {}, n), h('span', {}, label)));
  $('userStats').replaceChildren(
    stat('👥', sponsors.length, 'já entraram no portal', 'total', 'all'),
    stat('⏳', pending.length, 'aguardando liberação', 'pending', 'pending'),
    stat('💛', withKids.length, 'já apadrinharam', 'taken', 'sponsored'),
    stat('👀', idle.length, 'liberados sem apadrinhar', 'free', 'idle'),
  );

  const f = $('userFilter').value;
  const q = $('userSearch').value.trim().toLowerCase();
  const visible = users.filter((u) => {
    const kids = kidsOf(u);
    if (f === 'admins') { if (!u.is_admin) return false; }
    else if (u.is_admin && f !== 'all') return false;
    if (f === 'pending' && u.approved) return false;
    if (f === 'sponsored' && !kids.length) return false;
    if (f === 'idle' && (!u.approved || kids.length)) return false;
    return !q || `${u.google_name} ${u.email} ${kids.map((c) => `${c.name} ${c.class_name}`).join(' ')}`.toLowerCase().includes(q);
  });

  $('userRows').replaceChildren(
    ...visible.map((u) => {
      const kids = kidsOf(u);
      const phone = kids.find((c) => c.sponsor_phone_digits);
      return h('tr', {},
        h('td', { 'data-label': 'Nome', class: 'cell-title' }, u.google_name, u.is_admin ? [' ', h('span', { class: 'status-pill admin' }, 'Gestor')] : null),
        h('td', { 'data-label': 'E-mail' }, u.email, phone ? [h('br'), h('a', { class: 'small', href: `https://wa.me/55${phone.sponsor_phone_digits}`, target: '_blank', rel: 'noopener' }, `📲 ${phone.sponsor_phone}`)] : null),
        h('td', { 'data-label': 'Acessos', class: 'small' }, `1º: ${formatDate(u.created_at)}`, h('br'), h('span', { class: 'muted' }, `Último: ${formatDate(u.last_login)}`)),
        h('td', { 'data-label': 'Situação' }, u.approved ? 'Liberado' : h('strong', { class: 'warn' }, 'Aguardando')),
        h('td', { 'data-label': 'Apadrinhou', class: kids.length ? '' : 'empty-cell' },
          kids.length
            ? h('div', { class: 'kid-chips' }, ...kids.map((c) => h('span', { class: 'kid-chip', vars: classColor(c.class_name), title: c.delivered ? 'Presente entregue' : 'Entrega pendente' }, `${c.delivered ? '✅' : '🎁'} ${c.name}`, h('small', {}, c.class_name))))
            : (u.is_admin ? '' : h('span', { class: 'muted small' }, 'Nenhuma criança'))),
        h('td', { class: 'cell-actions' }, u.is_admin ? null : h('button', { type: 'button', class: u.approved ? 'link danger' : 'btn btn-small', onclick: () => approve(u, !u.approved) }, u.approved ? 'Bloquear' : 'Liberar')),
      );
    }),
  );
  if (!visible.length) $('userRows').replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'muted center' }, 'Ninguém nesse filtro.')));
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

function fetchWatermark() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('marca d\'água indisponível'));
    img.src = '/watermark.png';
  });
}

// Guarda só o sucesso: uma falha passageira (ex.: servidor reiniciando num deploy) não pode
// travar todos os envios seguintes. Sem marca d'água a foto NÃO é enviada.
async function loadWatermark() {
  if (watermarkImg) return watermarkImg;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      watermarkImg = await fetchWatermark();
      return watermarkImg;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error('Não foi possível carregar a marca d\'água; a foto não foi enviada. Aguarde um minuto e tente de novo.');
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
    // Mantém a identificação visível sem cobrir o rosto da criança.
    const size = Math.min(w, hgt) * 0.34;
    ctx.globalAlpha = 0.28;
    ctx.drawImage(logo, (w - size) / 2, (hgt - size) / 2, size, size);
  }
  return new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.85));
}

async function uploadImage(c, kind, file) {
  const blob = await watermark(file, kind);
  const res = await fetch(`/api/admin/children/${c.id}/image?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha no envio');
}

const EDIT_FIELDS = [
  ['class_name', 'Turma'], ['name', 'Nome'], ['age', 'Idade'], ['gender', 'Menina ou menino'],
  ['gift_1', 'Pedido 1'], ['gift_2', 'Pedido 2'], ['gift_3', 'Pedido 3'],
  ['shirt_size', 'Camiseta'], ['pants_size', 'Calça'], ['shoe_size', 'Tênis'],
];

function openEdit(c) {
  // c = null → nova criança; as imagens entram depois de salvar (precisam de um id).
  state.editing = c;
  const values = c ? {
    class_name: c.class_name, name: c.name, age: c.age, gender: c.gender,
    gift_1: c.gifts[0], gift_2: c.gifts[1], gift_3: c.gifts[2],
    shirt_size: c.sizes.shirt, pants_size: c.sizes.pants, shoe_size: c.sizes.shoe,
  } : { class_name: $('adminClass')?.value || '' };
  $('editTitle').textContent = c ? `Editar ${c.name}` : 'Nova criança';
  $('editImages').hidden = !c;
  $('editNewHint').hidden = !!c;
  $('editFields').replaceChildren(...EDIT_FIELDS.map(([k, label]) => {
    if (k === 'gender') {
      const sel = h('select', { name: 'gender' }, h('option', { value: '' }, '—'), h('option', { value: 'F' }, '👧 Menina'), h('option', { value: 'M' }, '👦 Menino'));
      sel.value = values.gender || '';
      return h('label', { class: 'short wide2' }, label, sel);
    }
    return h('label', { class: k.endsWith('size') || k === 'age' ? 'short' : '' }, label,
      h('input', { name: k, value: values[k] || '', maxlength: '120', required: k === 'class_name' || k === 'name' }));
  }));
  $('editPhoto').onclick = () => pickOne(c, 'photo');
  $('editLetter').onclick = () => pickOne(c, 'letter');
  $('editError').hidden = true;
  $('editDialog').showModal();
}

async function submitEdit(ev) {
  ev.preventDefault();
  const body = Object.fromEntries(new FormData($('editForm')));
  try {
    const saved = await api(state.editing ? `/api/admin/children/${state.editing.id}` : '/api/admin/children', { method: 'POST', body });
    const isNew = !state.editing;
    $('editDialog').close();
    toast(isNew ? `${saved.name} cadastrada — agora adicione a foto e a cartinha` : 'Cartinha atualizada');
    if (isNew) {
      await refresh();
      return openEdit(state.children.find((c) => c.id === saved.id) || saved);
    }
  } catch (err) {
    $('editError').textContent = err.message;
    $('editError').hidden = false;
  }
  await refresh();
}

// Mostra a imagem atual e permite trocar: arquivo do PC/celular ou câmera (no celular).
function pickOne(c, kind) {
  state.imgTarget = { c, kind };
  const url = kind === 'letter' ? c.letter_photo_url : c.photo_url;
  const what = kind === 'letter' ? 'Cartinha' : 'Foto';
  $('imgTitle').textContent = `${kind === 'letter' ? '✉️' : '📷'} ${what} de ${c.name}`;
  $('imgCurrent').replaceChildren(url
    ? h('img', { src: url, alt: `${what} atual de ${c.name}` })
    : h('div', { class: 'img-empty' }, kind === 'letter' ? '✉️' : '📷', h('p', {}, `Ainda sem ${what.toLowerCase()}`)));
  $('imgError').hidden = true;
  $('imgDialog').showModal();
}

async function onImagePicked(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file || !state.imgTarget) return;
  const { c, kind } = state.imgTarget;
  $('imgCurrent').classList.add('busy');
  try {
    await uploadImage(c, kind, file);
    toast(`${kind === 'letter' ? 'Cartinha' : 'Foto'} de ${c.name} enviada com marca d'água`);
    await refresh();
    const fresh = state.children.find((x) => x.id === c.id) || c;
    pickOne(fresh, kind); // mostra a nova imagem para conferir
  } catch (err) {
    $('imgError').textContent = err.message;
    $('imgError').hidden = false;
  } finally {
    $('imgCurrent').classList.remove('busy');
  }
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

// ---------- Aviso ao gestor no computador ----------

const BASE_TITLE = document.title;
const canNotify = () => 'Notification' in window && matchMedia('(pointer: fine)').matches; // celular exige service worker

// Notificação do sistema quando chega alguém novo esperando liberação (a aba pode estar em segundo plano).
function notifyNewPending(pending) {
  document.title = pending.length ? `(${pending.length}) ${BASE_TITLE}` : BASE_TITLE;
  const emails = new Set(pending.map((u) => u.email));
  const fresh = state.knownPending ? pending.filter((u) => !state.knownPending.has(u.email)) : [];
  state.knownPending = emails;
  updateNotifyButton();
  if (!fresh.length || !canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Filhos do Ritmo · acesso para liberar', {
      body: fresh.length === 1 ? `${fresh[0].google_name} está aguardando liberação` : `${fresh.length} pessoas estão aguardando liberação`,
      icon: '/icon-192.png',
      tag: 'fdr-pending',
    });
    n.onclick = () => { window.focus(); goToPendingUsers(); n.close(); };
  } catch { /* navegador sem suporte: fica o título da aba e a faixa amarela */ }
}

function updateNotifyButton() {
  const btn = $('notifyBtn');
  if (!canNotify() || Notification.permission === 'granted') { btn.hidden = true; return; }
  btn.hidden = false;
  btn.disabled = Notification.permission === 'denied';
  btn.textContent = Notification.permission === 'denied'
    ? '🔕 Avisos bloqueados neste navegador: libere em Configurações do site → Notificações'
    : '🔔 Avisar neste computador quando alguém pedir acesso';
}

// ---------- Entrega (só para liberados) ----------

const fmtPhone = (d) => `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
const WHATS_HELLO = 'Olá! Sou padrinho/madrinha do Natal Solidário Filhos do Ritmo e quero combinar a entrega do presente.';

async function loadDelivery() {
  try {
    const d = await api('/api/delivery');
    $('deliveryInfo').replaceChildren(
      h('p', {}, 'Até ', h('strong', {}, d.deadline), ', no ', h('strong', {}, d.place), ':', h('br'), d.address, '.'),
      h('p', {}, h('strong', {}, 'Antes de levar, combine a entrega'), ' com um dos responsáveis:'),
      h('div', { class: 'note-contacts' }, ...d.contacts.map((c) =>
        h('a', { class: 'btn btn-small btn-whats', href: `https://wa.me/55${c.phone}?text=${encodeURIComponent(WHATS_HELLO)}`, target: '_blank', rel: 'noopener' }, `📲 ${c.name.split(' ')[0]}`, h('small', {}, fmtPhone(c.phone))))),
    );
    $('sponsoredDelivery').replaceChildren('📦 Entregue o presente ', h('strong', {}, `até ${d.deadline}`), ' no ', h('strong', {}, d.place), ` (${d.address}), combinando antes com a organização.`);
  } catch {
    $('deliveryInfo').replaceChildren(h('p', {}, 'Fale com a organização para combinar a entrega.'));
  }
}

// ---------- Orientação ----------

// Uma vez por padrinho neste aparelho: quem entra rápido nem chega a abrir a aba Minhas.
function showWelcomeOnce() {
  if (state.me.is_admin) return;
  const key = `fdr_welcome_v1:${state.me.email}`;
  try { if (localStorage.getItem(key)) return; } catch { /* sem storage: mostra sempre */ }
  $('welcomeRules').replaceChildren($('giftRules').cloneNode(true));
  $('welcomeRules').firstChild.removeAttribute('id');
  $('welcomeDialog').showModal();
  try { localStorage.setItem(key, '1'); } catch { /* ignora */ }
}

function goToPendingUsers() {
  setView('admin');
  document.querySelector('.seg[data-panel=users]').click();
  $('userFilter').value = 'pending';
  renderUsers();
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

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab[data-view], .bottomnav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo({ top: 0 });
  if (view === 'mine') document.querySelectorAll('[data-view=mine]').forEach((b) => b.classList.remove('pulse'));
  render();
  refresh();
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
  $('bottomNav').hidden = false;
  document.body.classList.add('signed-in');
  clearInterval(state.timer);
  $('bottomNav').hidden = !state.me.approved; // pendente: nada a navegar ainda
  if (!state.me.approved) {
    $('pendingEmail').textContent = state.me.email;
    $('pendingWhats').href = `https://wa.me/5535920038185?text=${encodeURIComponent(`Olá! Acabei de entrar no portal do Natal Solidário Filhos do Ritmo e gostaria de ser liberado(a) para apadrinhar. Meu e-mail de acesso: ${state.me.email}`)}`;
    show('pendingView');
    // Abre sozinho assim que o gestor liberar, sem o padrinho precisar recarregar.
    state.timer = setInterval(async () => {
      const me = await api('/api/me').catch(() => null);
      if (me?.approved) boot();
    }, POLL_MS);
    return;
  }
  document.querySelectorAll('[data-admin]').forEach((el) => (el.hidden = !state.me.is_admin));
  $('topNotice').hidden = false;
  await refresh();
  loadDelivery();
  showWelcomeOnce();
  state.timer = setInterval(() => {
    if (document.visibilityState !== 'visible') {
      if (state.me.is_admin) loadUsers().catch(() => {});
      return;
    }
    if (!$('sponsorDialog').open && !$('editDialog').open && !$('uploadDialog').open && !$('imgDialog').open) refresh();
  }, POLL_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('Copiado! Cole no app do seu banco 💛');
    } catch {
      toast('Não foi possível copiar; use a chave 43.174.372/0001-47');
    }
  }));
  // Altura real do topo (varia com o aviso) para os filtros grudarem logo abaixo dele.
  new ResizeObserver(([e]) => document.documentElement.style.setProperty('--topbar-h', `${e.target.offsetHeight}px`)).observe($('topbar'));
  // Reencaixa os nomes (abrevia/reduz fonte) quando a largura do card muda com a tela.
  let fitNamesTimer;
  window.addEventListener('resize', () => { clearTimeout(fitNamesTimer); fitNamesTimer = setTimeout(fitAllNames, 150); });
  $('sponsorForm').addEventListener('submit', submitSponsor);
  $('welcomeOk').addEventListener('click', () => $('welcomeDialog').close());
  $('sponsoredMore').addEventListener('click', () => $('sponsoredDialog').close());
  $('sponsoredGo').addEventListener('click', () => { $('sponsoredDialog').close(); setView('mine'); });
  $('adminAlert').addEventListener('click', goToPendingUsers);
  $('notifyBtn').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* ignora */ }
    updateNotifyButton();
    if (Notification.permission === 'granted') toast('Pronto! Você será avisada quando alguém pedir acesso, com esta aba aberta.');
  });
  $('dlgCancel').addEventListener('click', () => $('sponsorDialog').close());
  $('photoClose').addEventListener('click', () => $('photoDialog').close());
  $('editForm').addEventListener('submit', submitEdit);
  $('newChildBtn').addEventListener('click', () => openEdit(null));
  $('uploadBtn').addEventListener('click', () => $('uploadDialog').showModal());
  $('imgFile').addEventListener('change', onImagePicked);
  $('imgCamera').addEventListener('change', onImagePicked);
  $('imgClose').addEventListener('click', () => $('imgDialog').close());
  $('uploadClose').addEventListener('click', () => $('uploadDialog').close());
  document.querySelectorAll('.seg[data-panel]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg[data-panel]').forEach((x) => x.classList.toggle('active', x === b));
    $('panelKids').hidden = b.dataset.panel !== 'kids';
    $('panelUsers').hidden = b.dataset.panel !== 'users';
    if (state.users) renderUsers(); // atualiza o aviso de pendentes
  }));
  $('editCancel').addEventListener('click', () => $('editDialog').close());
  $('csvInput').addEventListener('change', (e) => e.target.files[0] && importCsv(e.target.files[0]).finally(() => (e.target.value = '')));
  for (const [id, kind] of [['photoInput', 'photo'], ['letterInput', 'letter']]) {
    $(id).addEventListener('change', (e) => bulkUpload([...e.target.files], kind).finally(() => (e.target.value = '')));
  }
  for (const id of ['onlyAvailable', 'ageFilter']) $(id).addEventListener('change', renderSponsor);
  for (const id of ['adminFilter', 'adminClass']) $(id).addEventListener('change', renderAdmin);
  $('adminSearch').addEventListener('input', renderAdmin);
  $('userFilter').addEventListener('change', renderUsers);
  $('userSearch').addEventListener('input', renderUsers);
  $('recheckBtn').addEventListener('click', () => location.reload());
  document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    location.href = '/';
  }));
  // Mesma navegação no topo (computador) e na barra inferior (celular).
  document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && state.me?.approved && refresh());
  boot().catch(() => show('loginView'));
});
