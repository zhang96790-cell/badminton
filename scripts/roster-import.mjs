// npm run roster:import <file.csv> — turns a filled-in CSV into src/roster/roster.json, then checks it.
// Columns (header row required): id,name,country,rarity,style,handedness,power,speed,net,defence,stamina,
// career_strength,released_in,enabled,description. See docs/roster-guide.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { PLACEHOLDER, ROSTER_PATH, problems, readRoster, summary, writeSql } from './roster-lib.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run roster:import <file.csv>'); process.exit(1); }

/** A small CSV reader: commas, "quoted, fields", and "" for a quote inside quotes. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const head = rows.shift().map((h) => h.trim().toLowerCase());
const col = (r, name) => (r[head.indexOf(name)] ?? '').trim();
const need = ['id', 'name', 'country', 'rarity', 'style', 'handedness', 'power', 'speed', 'net', 'defence', 'stamina', 'released_in', 'enabled', 'description'];
const missing = need.filter((n) => !head.includes(n));
if (missing.length) { console.error(`The CSV is missing columns: ${missing.join(', ')}`); process.exit(1); }

const placeholder = readRoster().characters.find((c) => c.id === PLACEHOLDER);
const characters = [placeholder, ...rows.map((r) => ({
  id: col(r, 'id').toLowerCase(),
  name: col(r, 'name'),
  country: col(r, 'country').toUpperCase(),
  rarity: col(r, 'rarity').toLowerCase().replace(/\s+/g, '_'),
  style: col(r, 'style').toLowerCase(),
  handedness: col(r, 'handedness').toLowerCase(),
  stats: ['power', 'speed', 'net', 'defence', 'stamina'].map((k) => Number(col(r, k))),
  career_strength: Number(col(r, 'career_strength') || 0),
  released_in: col(r, 'released_in'),
  enabled: !/^(false|no|0)$/i.test(col(r, 'enabled')),
  description: col(r, 'description'),
})).filter((c) => c.id !== PLACEHOLDER)];

const roster = { data_version: 1, characters };
const bad = problems(roster);
if (bad.length) {
  console.error(`Not saved. The CSV has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n${bad.map((b) => `  • ${b}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(ROSTER_PATH, JSON.stringify(roster, null, 2) + '\n');
writeSql(roster);
const s = summary(roster);
console.log(`Saved src/roster/roster.json: ${s.total} players.`, s.byRarity);
console.log('Next: run supabase/roster.sql in Supabase, then deploy the room server (it reads the roster too).');
