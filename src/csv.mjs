// Leitura da planilha (CSV ; ou ,) usada pela importação do Painel e pelo script de linha de comando.
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

export const key = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  class_name: ['turma'], name: ['nome', 'nomedacrianca', 'crianca'], photo: ['foto', 'arquivofoto', 'fotodacrianca'],
  letter_photo: ['fotodacartinha', 'imagemdacartinha'],
  gift_1: ['pedido1', 'presente1', 'opcao1'], gift_2: ['pedido2', 'presente2', 'opcao2'], gift_3: ['pedido3', 'presente3', 'opcao3'],
  shirt_size: ['camisa', 'tamcamisa', 'tamanhocamisa'], pants_size: ['calca', 'tamcalca', 'tamanhocalca'],
  shoe_size: ['sapato', 'tamsapato', 'tamanhosapato', 'calcado', 'tenis', 'tamtenis', 'tamanhotenis'],
  age: ['idade', 'anos'],
  letter: ['cartinha', 'texto', 'textodacartinha', 'mensagem'],
};


/** Converte o texto CSV em crianças. Lança Error com mensagem legível se faltar coluna obrigatória. */
export function childrenFromCsv(text) {
  const [header = [], ...rows] = parseCsv(text);
  const idx = {};
  header.forEach((h, i) => {
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(key(h))) idx[field] = i;
  });
  for (const [field, label] of [['class_name', 'Turma'], ['name', 'Nome']]) {
    if (idx[field] === undefined) throw new Error(`Coluna obrigatória ausente: ${label}. Cabeçalho lido: ${header.join(' | ')}`);
  }
  return rows
    .map((r) => Object.fromEntries(Object.keys(ALIASES).map((f) => [f, idx[f] === undefined ? null : (r[idx[f]] || '').trim() || null])))
    .filter((c) => c.class_name && c.name);
}
