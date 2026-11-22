// v5 roster: the five new stats (Power, Speed, Net, Reach, Accuracy) and the owner's top-tier players.
//   node scripts/roster-v5.mjs build    — make data/roster-v5.csv from today's roster (converted) + the new players
//   node scripts/roster-v5.mjs import   — data/roster-v5.csv → src/roster/roster-v5.json (checked)
// The v4 roster (src/roster/roster.json) is never touched: v5 is only used in the v5 test area until launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { BUDGET, CONFIG, PLACEHOLDER, fitToTotal, parseAbility, problems, readRoster, readSheet, slugOf } from './roster-lib.mjs';

const CSV = 'data/roster-v5.csv';
const OUT = new URL('../src/roster/roster-v5.json', import.meta.url);
const COLS = ['id', 'name', 'country', 'rarity', 'style', 'handedness', 'power', 'speed', 'net', 'reach', 'accuracy', 'ranked_stat_total', 'career_strength', 'released_in', 'enabled', 'signature', 'description', 'skill', 'gameplay_effect'];
const ABILITIES = JSON.parse(readFileSync(new URL('../data/signatures.json', import.meta.url), 'utf8')).abilities;
const byId = new Map(ABILITIES.map((a) => [a.id, a]));

/** Old stats (Power, Speed, Net, Defence, Stamina) → new (Power, Speed, Net, Reach, Accuracy), same total. */
const STYLE_ACC = { 'net player': 3, deceptive: 2, 'defensive wall': 2, 'all-rounder': 1, defender: 1, 'fast retriever': 0, attacker: -2 };
export function convert([p, s, n, d, st], style) {
  const acc = Math.round((n + d) / 2 + (STYLE_ACC[style] ?? 0));
  return fitToTotal([p, s, n, d, Math.min(35, Math.max(10, acc))], p + s + n + d + st);
}

// ── The owner's new players (5.0). Strengths as given; country codes as in the game. ──
const NEW = {
  champion: [
    ['Lin Dan', 'CHN', 'Smash, Speed, Drop', 'left'], ['Viktor Axelsen', 'DEN', 'Smash, Reach, Defence, Speed-', 'right'],
    ['Lee Chong Wei', 'MAS', 'Speed, Smash', 'right'], ['Chen Long', 'CHN', 'Defence, Smash', 'right'],
    ['Taufik Hidayat', 'INA', 'Smash, Backhand', 'right'], ['Kento Momota', 'JPN', 'Net, Defence, Drop', 'left'],
  ],
  legendary: [
    ['Poul-Erik Høyer Larsen', 'DEN', 'Net, Defence, Backhand', 'right'], ['Chen Jin', 'CHN', 'Smash, Defence', 'right'],
    ['Peter Gade', 'DEN', 'Speed, Net, Drop', 'right'], ['Hendrawan', 'INA', 'Smash, Defence', 'right'],
    ['Ji Xinpeng', 'CHN', 'Net, Drop', 'right'], ['Rudy Hartono', 'INA', 'Smash, Stamina', 'right'],
    ['Allan Budikusuma', 'INA', 'Smash, Power', 'right'], ['Ardy Wiranata', 'INA', 'Net, Drop', 'right'],
    ['Rashid Sidek', 'MAS', 'Net, Backhand', 'right'], ['Sony Dwi Kuncoro', 'INA', 'Smash, Speed', 'right'],
  ],
  mythic: [
    ['Sun Jun', 'CHN', 'Net, Drop', 'right'], ['Xia Xuanze', 'CHN', 'Defence, Speed', 'right'], ['Dong Jiong', 'CHN', 'Smash, Speed', 'right'],
    ['Lee Hyun-il', 'KOR', 'Speed, Defence', 'right'], ['Shon Seung-mo', 'KOR', 'Smash, Defence', 'left'], ['Bao Chunlai', 'CHN', 'Smash, Power', 'left'],
    ['Wong Choong Hann', 'MAS', 'Smash, Net', 'right'], ['Pullela Gopichand', 'IND', 'Net, Drop', 'right'], ['Boonsak Ponsana', 'THA', 'Defence, Stamina', 'right'],
    ['Kenneth Jonassen', 'DEN', 'Reach, Defence', 'right'], ['Chen Hong', 'CHN', 'Smash, Backhand', 'right'], ['Peter Rasmussen', 'DEN', 'Net, Drop', 'right'],
    ['Muhammad Hafiz Hashim', 'MAS', 'Smash, Speed', 'right'], ['Joko Suprianto', 'INA', 'Net, Speed', 'right'], ['Heryanto Arbi', 'INA', 'Smash, Power', 'right'],
  ],
  elite: [
    ['Simon Santoso', 'INA', 'Net, Drop', 'right'], ['Tommy Sugiarto', 'INA', 'Smash, Power', 'right'], ['Du Pengyu', 'CHN', 'Defence, Stamina', 'right'],
    ['Sho Sasaki', 'JPN', 'Net, Defence', 'right'], ['Kenichi Tago', 'JPN', 'Defence, Drop', 'right'], ['Marc Zwiebler', 'GER', 'Net, Backhand', 'right'],
    ['Hans-Kristian Vittinghus', 'DEN', 'Reach, Smash', 'right'], ['Wang Zhengming', 'CHN', 'Smash, Reach', 'right'], ['Nguyen Tien Minh', 'VIE', 'Speed, Defence', 'right'],
    ['Parupalli Kashyap', 'IND', 'Net, Drop', 'right'], ['Wei Nan', 'CHN', 'Speed, Defence', 'right'], ['Chen Yuekun', 'CHN', 'Smash, Power', 'right'],
    ['Rajiv Ouseph', 'ENG', 'Smash, Reach', 'left'], ['Roslin Hashim', 'MAS', 'Speed, Net', 'right'], ['Lee Dong-keun', 'KOR', 'Defence, Stamina', 'right'],
    ['Ronald Susilo', 'SGP', 'Defence, Drop', 'right'], ['Kazushi Yamada', 'JPN', 'Net, Speed', 'right'], ['Tanongsak Saensomboonsuk', 'THA', 'Smash, Speed', 'right'],
    ['Dionysius Hayom Rumbaka', 'INA', 'Smash, Power', 'right'], ['Przemysław Wacha', 'POL', 'Net, Backhand', 'right'],
  ],
};
/** Which stat each strength raises (0 Power, 1 Speed, 2 Net, 3 Reach, 4 Accuracy), and how much of it. */
const MAP = { smash: [[0, 1], [4, 0.25]], power: [[0, 1]], speed: [[1, 1]], net: [[2, 1], [4, 0.3]], drop: [[2, 0.6], [4, 0.7]],
  defence: [[3, 1], [4, 0.3]], reach: [[3, 1]], backhand: [[4, 0.8], [2, 0.3]], stamina: [[3, 0.6], [1, 0.4]] };
/** An ability that fits a strength: [signature (SS), skill (S)]. */
const ABIL = { smash: ['thunder_rebound', 'quickfire_smash'], power: ['tempest_clear', 'quickfire_smash'], speed: ['relentless_pursuit', 'burst_return'],
  net: ['vortex_net_trap', 'silk_touch'], drop: ['phantom_drop', 'razor_drop'], defence: ['falcon_counter', 'iron_formation'],
  reach: ['falcon_counter', 'unbreakable_guard'], backhand: ['mirage_switch', 'crosscourt_flick'], stamina: ['steady_lift', 'steady_lift'] };
function styleOf(str) {
  const [a, b] = str;
  if (a === 'smash' && (b === 'defence' || b === 'reach')) return 'all-rounder';
  if (a === 'smash' || a === 'power') return 'attacker';
  if (a === 'net' && b === 'drop') return 'net player';
  if (a === 'net') return b === 'backhand' || b === 'speed' ? 'deceptive' : 'net player';
  if (a === 'defence' || a === 'reach') return b === 'stamina' ? 'defensive wall' : 'defender';
  if (a === 'speed') return b === 'smash' ? 'all-rounder' : 'fast retriever';
  return 'all-rounder';
}
const describe = (style, str) => `${{ attacker: 'An attacking player', 'all-rounder': 'A complete player', defender: 'A solid defender', 'defensive wall': 'A wall in defence', 'net player': 'A net specialist', deceptive: 'A deceptive shot-maker', 'fast retriever': 'A lightning-fast retriever' }[style]} known for ${str.map((s) => s.replace(/-$/, '')).filter((s) => s !== 'speed-').slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
const sig = (id, tier) => { const a = byId.get(id); return a ? `[${tier}] ${a.name} — ${a.text}` : ''; };

function newPlayer([name, country, strengths, hand], rarity) {
  const raw = strengths.split(',').map((x) => x.trim().toLowerCase());
  const minus = raw.filter((x) => x.endsWith('-')).map((x) => x.slice(0, -1));
  const str = raw.filter((x) => !x.endsWith('-'));
  const v = [18, 18, 18, 18, 18];
  str.forEach((k, i) => (MAP[k] ?? []).forEach(([idx, w]) => { v[idx] += w * (12 - i * 3); }));
  minus.forEach((k) => (MAP[k] ?? []).forEach(([idx]) => { v[idx] -= 6; }));
  const total = BUDGET[rarity];
  const stats = fitToTotal(v.map((x) => Math.max(10, x)), total);
  const style = styleOf(str);
  const top = rarity === 'champion' || rarity === 'legendary';
  return {
    id: '', name, country, rarity, style, handedness: hand, power: stats[0], speed: stats[1], net: stats[2], reach: stats[3], accuracy: stats[4],
    ranked_stat_total: total, career_strength: CONFIG.careerStrength[rarity], released_in: '5.0', enabled: 'TRUE',
    signature: sig(ABIL[str[0]]?.[rarity === 'elite' ? 1 : 0], rarity === 'elite' ? 'S' : 'SS'),
    description: describe(style, raw),
    skill: top && str[1] ? byId.get(ABIL[str[1]]?.[1])?.name ?? '' : '', gameplay_effect: top && str[1] ? byId.get(ABIL[str[1]]?.[1])?.text ?? '' : '',
  };
}

/** An id from the name (letters and underscores); long names keep their last words and initials (20 letters at most). */
function idOf(name) {
  const words = slugOf(name.replace(/ł/g, 'l').replace(/[øØ]/g, 'o')).split('_').filter(Boolean);
  let id = words.join('_');
  for (let keep = 2; id.length > 20 && keep >= 1; keep--) id = `${words.slice(0, -keep).map((w) => w[0]).join('')}_${words.slice(-keep).join('_')}`;
  return id.slice(0, 20);
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

if (process.argv[2] === 'build') {
  const old = readRoster().characters.filter((c) => c.id !== PLACEHOLDER);
  const rows = old.map((c, i) => {
    const [p, s, n, r, a] = convert(c.base_stats ?? c.stats, c.style);
    const sg = c.abilities.find((x) => x.slot === 'signature'), sk = c.abilities.find((x) => x.slot === 'skill');
    return { id: c.sheet_id || i + 1, name: c.name, country: c.country, rarity: c.rarity, style: c.style, handedness: c.handedness, power: p, speed: s, net: n, reach: r, accuracy: a,
      ranked_stat_total: p + s + n + r + a, career_strength: c.career_strength, released_in: c.released_in, enabled: c.enabled ? 'TRUE' : 'FALSE',
      signature: sg ? `[${sg.tier}] ${sg.name} — ${sg.text}` : '[S]', description: c.description, skill: sk?.name ?? '', gameplay_effect: sk?.text ?? '' };
  });
  let n = rows.length;
  for (const [rarity, list] of Object.entries(NEW)) for (const p of list) rows.push({ ...newPlayer(p, rarity), id: ++n });
  writeFileSync(CSV, [COLS.join(','), ...rows.map((r) => COLS.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n');
  console.log(`Wrote ${CSV}: ${rows.length} players (${old.length} converted, ${rows.length - old.length} new).`);
} else if (process.argv[2] === 'import') {
  const rows = await readSheet(CSV);
  const characters = rows.map((r) => {
    const s = (k) => String(r[k] ?? '').trim();
    const base = ['power', 'speed', 'net', 'reach', 'accuracy'].map((k) => Number(s(k)));
    const rarity = s('rarity').toLowerCase().replace(/\s+/g, '_');
    const abilities = [];
    const sg = parseAbility(r.signature);
    if (sg) abilities.push({ id: slugOf(sg.name), tier: sg.tier, name: sg.name, text: sg.text, slot: 'signature' });
    if (s('skill')) abilities.push({ id: slugOf(s('skill')), tier: 'S', name: s('skill'), text: s('gameplay_effect'), slot: 'skill' });
    return { id: idOf(s('name')), sheet_id: s('id'), name: s('name'), country: s('country').toUpperCase(), rarity, style: s('style').toLowerCase(), handedness: s('handedness').toLowerCase(),
      stats: base, base_stats: base, ranked_stat_total: Number(s('ranked_stat_total')), career_strength: Number(s('career_strength')) || CONFIG.careerStrength[rarity] || 100,
      released_in: s('released_in'), enabled: /^(true|yes|1)$/i.test(s('enabled')), description: s('description'), abilities };
  });
  const placeholder = readRoster().characters.find((c) => c.id === PLACEHOLDER);
  const roster = { data_version: 5, characters: [placeholder, ...characters] };
  const bad = problems(roster);
  if (bad.length) { console.error(`Not saved:\n${bad.map((b) => `  • ${b}`).join('\n')}`); process.exit(1); }
  writeFileSync(OUT, JSON.stringify(roster) + '\n');
  const count = characters.reduce((m, c) => ((m[c.rarity] = (m[c.rarity] ?? 0) + 1), m), {});
  console.log(`Saved src/roster/roster-v5.json: ${characters.length + 1} players.`, count);
} else console.log('Use: node scripts/roster-v5.mjs build | import');
