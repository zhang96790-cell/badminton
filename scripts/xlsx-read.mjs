// A small .xlsx reader (first sheet, values only) for files exceljs can't open, e.g. ones saved by online
// tools that use absolute paths inside the package. Plain Node: zip via zlib, XML via a few patterns.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name.replace(/^\//, ''), () => (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
const texts = (xml) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescape(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Rows of the first sheet as arrays of strings / booleans / numbers-as-strings. */
export function readXlsxRows(path) {
  const files = unzip(readFileSync(path));
  const get = (n) => { const f = files.get(n); if (!f) throw new Error(`missing ${n} in the xlsx`); return f(); };
  const shared = files.has('xl/sharedStrings.xml') ? [...get('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1])) : [];
  const wb = get('xl/workbook.xml');
  const firstRid = wb.match(/<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = get('xl/_rels/workbook.xml.rels');
  let target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${firstRid}"`))?.match(/Target="([^"]+)"/)?.[1] ?? 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = get(target);
  const rows = [];
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      const val = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? texts(body) : type === 'b' ? v === '1' : v !== undefined ? unescape(v) : null;
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(row);
  }
  return rows;
}
