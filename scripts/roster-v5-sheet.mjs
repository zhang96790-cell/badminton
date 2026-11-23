// 5.0: the roster sheet (S, SS, SSS and Ultra slots) → src/roster/roster-v5.json.
//   node scripts/roster-v5-sheet.mjs            — reads data/roster-v5-sheet.json (the sheet's rows)
// Keeps each player's id, sheet id, description, release and career strength; takes stats, style, hand and
// signatures from the sheet. Strongest signature first (Ultra, SSS, SS, S). Checked before saving.
import { readFileSync, writeFileSync } from 'node:fs';
import { PLACEHOLDER, problems, slugOf } from './roster-lib.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const sheet = read('data/roster-v5-sheet.json').rows;
const old = read('src/roster/roster-v5.json');
const sigs = read('data/signatures.json').abilities;
const byName = new Map(sigs.map((a) => [a.name.toLowerCase(), a]));
const RAR = { Common: 'common', Rare: 'rare', 'Super Rare': 'super_rare', Epic: 'epic', Elite: 'elite', Mythic: 'mythic', Legendary: 'legendary', Champion: 'champion' };
const SLOTS = [['U', 'U'], ['SSS', 'SSS'], ['SS', 'SS'], ['S', 'S']];
const missing = [];
const chars = sheet.map((r) => {
  const prev = old.characters.find((c) => c.id === r.id);
  if (!prev) throw new Error(`No player with id ${r.id}`);
  const abilities = [];
  for (const [col, tier] of SLOTS) {
    const name = r[col];
    if (!name) continue;
    const a = byName.get(String(name).toLowerCase());
    if (!a) { missing.push(`${r.name}: ${col} "${name}"`); continue; }
    abilities.push({ id: a.id ?? slugOf(a.name), tier, name: a.name, text: a.text, slot: abilities.length ? 'skill' : 'signature' });
  }
  const stats = r.stats.map(Number);
  return { ...prev, rarity: RAR[r.rarity], style: r.style, handedness: r.hand, stats, base_stats: stats, ranked_stat_total: stats.reduce((a, b) => a + b, 0), abilities };
});
if (missing.length) { console.error(`Signatures not in data/signatures.json:\n  ${missing.join('\n  ')}`); process.exit(1); }
const placeholder = old.characters.find((c) => c.id === PLACEHOLDER);
const roster = { data_version: old.data_version, characters: [placeholder, ...chars] };
const bad = problems(roster, 50, 4);
if (bad.length) { console.error(`Not saved:\n${bad.map((b) => `  • ${b}`).join('\n')}`); process.exit(1); }
writeFileSync(new URL('../src/roster/roster-v5.json', import.meta.url), JSON.stringify(roster) + '\n');
const count = {};
for (const c of chars) { const k = c.abilities.map((a) => a.tier).reverse().join('+') || 'none'; (count[c.rarity] ??= {})[k] = ((count[c.rarity] ?? {})[k] ?? 0) + 1; }
console.log(`Saved src/roster/roster-v5.json: ${chars.length + 1} players.`, JSON.stringify(count));
