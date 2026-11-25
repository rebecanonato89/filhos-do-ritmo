// Gera um .xlsx simples (uma aba) sem dependências: XML do Office Open + zip montado à mão.
// Suporta título, cabeçalho destacado com filtro, larguras de coluna, cabeçalho congelado
// e um estilo por célula. Tudo é texto (telefones e tamanhos não viram número).
import { deflateRawSync, crc32 } from 'node:zlib';

const esc = (v) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // caracteres que o XML não aceita
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// Índices de estilo (cellXfs em STYLES)
export const S = { normal: 1, title: 2, header: 3, subtitle: 4, free: 5, taken: 6, done: 7 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFC45A0C"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8711A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E5"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF6EE"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFDDDDDD"/></left><right style="thin"><color rgb="FFDDDDDD"/></right><top style="thin"><color rgb="FFDDDDDD"/></top><bottom style="thin"><color rgb="FFDDDDDD"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf borderId="1" applyBorder="1" numFmtId="0" fontId="0" fillId="0" xfId="0"><alignment vertical="center"/></xf>
<xf fontId="1" applyFont="1" numFmtId="0" fillId="0" borderId="0" xfId="0"/>
<xf fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" numFmtId="0" xfId="0"><alignment vertical="center"/></xf>
<xf fontId="3" applyFont="1" numFmtId="0" fillId="0" borderId="0" xfId="0"/>
<xf fillId="3" borderId="1" applyFill="1" applyBorder="1" numFmtId="0" fontId="0" xfId="0"><alignment vertical="center"/></xf>
<xf fillId="4" borderId="1" applyFill="1" applyBorder="1" numFmtId="0" fontId="0" xfId="0"><alignment vertical="center"/></xf>
<xf fillId="5" borderId="1" applyFill="1" applyBorder="1" numFmtId="0" fontId="0" xfId="0"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * @param {{ sheetName: string, title: string, subtitle: string, columns: {name: string, width: number}[],
 *           rows: {cells: string[], styles?: number[]}[] }} spec
 */
export function buildXlsx({ sheetName, title, subtitle, columns, rows }) {
  const last = colName(columns.length - 1);
  const headerRow = 3;
  const cell = (r, c, v, s) => `<c r="${colName(c)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const xmlRows = [
    `<row r="1" ht="22" customHeight="1">${cell(1, 0, title, S.title)}</row>`,
    `<row r="2">${cell(2, 0, subtitle, S.subtitle)}</row>`,
    `<row r="${headerRow}" ht="20" customHeight="1">${columns.map((col, i) => cell(headerRow, i, col.name, S.header)).join('')}</row>`,
    ...rows.map((row, k) => {
      const r = headerRow + 1 + k;
      return `<row r="${r}">${row.cells.map((v, i) => cell(r, i, v, row.styles?.[i] ?? S.normal)).join('')}</row>`;
    }),
  ];
  const lastRow = headerRow + Math.max(rows.length, 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${columns.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${xmlRows.join('')}</sheetData>
<autoFilter ref="A${headerRow}:${last}${lastRow}"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${esc(sheetName).slice(0, 31)}'!$A$${headerRow}:$${last}$${lastRow}</definedName></definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': STYLES,
  };
  return zip(files);
}

// Zip mínimo (deflate), suficiente para o Excel/LibreOffice/Google Planilhas.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}
