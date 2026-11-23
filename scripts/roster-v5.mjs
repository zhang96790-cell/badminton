// v5 roster: the five new stats (Power, Speed, Net, Reach, Accuracy) and the owner's top-tier players.
//   node scripts/roster-v5.mjs build    — make data/roster-v5.csv from today's roster (converted) + the new players
//   node scripts/roster-v5.mjs tune     — data/roster-v5.csv: v5 stat totals per rarity (each player keeps
//                                          their balance), signature counts per rarity, Ultra signatures
//   node scripts/roster-v5.mjs import   — data/roster-v5.csv → src/roster/roster-v5.json (checked)
// The v4 roster (src/roster/roster.json) is never touched: v5 is only used in the v5 test area until launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { BUDGET, CONFIG, PLACEHOLDER, fitToTotal, parseAbility, problems, readRoster, readSheet, slugOf } from './roster-lib.mjs';

const CSV = 'data/roster-v5.csv';
const OUT = new URL('../src/roster/roster-v5.json', import.meta.url);
const COLS = ['id', 'name', 'country', 'rarity', 'style', 'handedness', 'power', 'speed', 'net', 'reach', 'accuracy', 'ranked_stat_total', 'career_strength', 'released_in', 'enabled', 'signature', 'description', 'skill', 'gameplay_effect'];
const ABILITIES = JSON.parse(readFileSync(new URL('../data/signatures.json', import.meta.url), 'utf8')).abilities;
const byId = new Map(ABILITIES.map((a) => [a.id, a]));

/** 5.0 stat totals per rarity (owner: the top should be about 200, so they hold up against hard CPUs). Stats 10–50. */
export const V5_BUDGET = { common: 100, rare: 110, super_rare: 120, epic: 132, elite: 146, mythic: 162, legendary: 180, champion: 210 };
export const V5_MAX = 50;
/** Signature counts per rarity: none / S / SS / Ultra (owner's table for the first four; the top tiers all have one). */
const SIG_TARGET = {
  common: [149, 57, 20, 0], rare: [69, 31, 13, 0], super_rare: [32, 17, 8, 0], epic: [19, 13, 7, 0],
  elite: [0, 14, 6, 0], mythic: [0, 0, 11, 4], legendary: [0, 0, 5, 5], champion: [0, 0, 0, 6],
};
/** Abilities that suit a style: [S choices, SS choices]. */
const BY_STYLE = {
  attacker: [['quickfire_smash', 'early_pressure', 'late_drive'], ['thunder_rebound', 'silent_crossfire']],
  'all-rounder': [['backcourt_clear', 'counterstrike', 'steady_lift'], ['tempest_clear', 'ghostline_drive']],
  defender: [['iron_formation', 'unbreakable_guard', 'counterstrike'], ['falcon_counter']],
  'defensive wall': [['steady_lift', 'last_stand', 'iron_formation'], ['falcon_counter']],
  'net player': [['silk_touch', 'feather_touch', 'net_thread', 'net_dominance'], ['vortex_net_trap', 'halo_tumble']],
  deceptive: [['false_opening', 'phantom_rhythm', 'crosscourt_flick', 'angle_slice'], ['phantom_drop', 'mirage_switch', 'phantom_cascade']],
  'fast retriever': [['relentless_pursuit', 'burst_return'], ['tempest_clear', 'falcon_counter']],
};
/** The Ultra that grows out of a player's current signature (same idea, much stronger, narrower). */
const ULTRA_OF = { smash: 'sky_hammer', shotSpeed: 'lightning_counter', nextAttack: 'killer_instinct', oppMove: 'killer_instinct', move: 'second_wind', swingWait: 'second_wind',
  netAim: 'silk_web', netTiming: 'silk_web', deceive: 'phantom_veil', aim: 'precision_strike', oppSmash: 'iron_curtain', oppNextSmash: 'iron_curtain', defenceDepth: 'iron_curtain', energyUse: 'second_wind', restedHalf: 'second_wind' };
const ULTRA_STYLE = { attacker: 'killer_instinct', 'all-rounder': 'precision_strike', defender: 'iron_curtain', 'defensive wall': 'iron_curtain',
  'net player': 'silk_web', deceptive: 'phantom_veil', 'fast retriever': 'second_wind' };
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const tierOf = (cell) => { const m = String(cell ?? '').match(/^\[(SS|S|U|ULTRA)\]\s*\S/i); return m ? (m[1].toUpperCase().startsWith('U') ? 'U' : m[1].toUpperCase()) : 'none'; };
const idOfSig = (cell) => { const n = String(cell ?? '').replace(/^\[[^\]]*\]\s*/, '').split(/\s+[—–-]\s+/)[0].trim(); return ABILITIES.find((a) => a.name === n)?.id; };

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
  const total = V5_BUDGET[rarity];
  const stats = fitToTotal(v.map((x) => Math.max(10, x)), total, V5_MAX);
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
} else if (process.argv[2] === 'tune') {
  const rows = await readSheet(CSV);
  const S = ['power', 'speed', 'net', 'reach', 'accuracy'];
  // 1. Totals: scale each player's own stats to their rarity's v5 total (their balance stays the same).
  for (const r of rows) {
    const rarity = String(r.rarity).toLowerCase().replace(/\s+/g, '_'), total = V5_BUDGET[rarity];
    if (!total) continue;
    const fit = fitToTotal(S.map((k) => Number(r[k])), total, V5_MAX);
    S.forEach((k, i) => { r[k] = fit[i]; });
    r.ranked_stat_total = total;
  }
  // 2. Signatures: top up / upgrade to the target counts per rarity (picked the same way every run).
  const moved = [];
  for (const [rarity, [, wantS, wantSS, wantU]] of Object.entries(SIG_TARGET)) {
    const list = rows.filter((r) => String(r.rarity).toLowerCase().replace(/\s+/g, '_') === rarity).sort((a, b) => hash(String(a.name)) - hash(String(b.name)));
    const count = (tier) => list.filter((r) => tierOf(r.signature) === tier).length;
    const give = (r, tier, id) => { const a = byId.get(id); r.signature = `[${tier}] ${a.name} — ${a.text}`; moved.push(`${r.name} (${rarity}): ${tier} ${a.name}`); };
    // Ultras first, made from the strongest current signatures.
    const usedU = new Set(list.filter((x) => tierOf(x.signature) === 'U').map((x) => idOfSig(x.signature)));
    for (const r of list.filter((x) => tierOf(x.signature) === 'SS')) {
      if (count('U') >= wantU) break;
      // Their signature's idea first, then their skill's, then their style's; a different one from the rest of the tier where possible.
      const skill = ABILITIES.find((a) => a.name === String(r.skill ?? '').trim());
      const options = [ULTRA_OF[byId.get(idOfSig(r.signature))?.effect], ULTRA_OF[skill?.effect], ULTRA_STYLE[r.style], ...Object.values(ULTRA_STYLE)].filter(Boolean);
      const u = options.find((x) => !usedU.has(x)) ?? options[0];
      usedU.add(u);
      give(r, 'U', u);
    }
    // S → SS where the rarity needs more SS than it has.
    for (const r of list.filter((x) => tierOf(x.signature) === 'S')) {
      if (count('SS') >= wantSS) break;
      give(r, 'SS', BY_STYLE[r.style]?.[1][hash(String(r.name)) % BY_STYLE[r.style][1].length] ?? 'phantom_drop');
    }
    // No signature → S, then → SS, until the counts match.
    for (const r of list.filter((x) => tierOf(x.signature) === 'none')) {
      const tier = count('SS') < wantSS ? 'SS' : count('S') < wantS ? 'S' : null;
      if (!tier) break;
      const pool = BY_STYLE[r.style]?.[tier === 'S' ? 0 : 1] ?? ['counterstrike'];
      give(r, tier, pool[hash(String(r.name)) % pool.length]);
    }
  }
  writeFileSync(CSV, [COLS.join(','), ...rows.map((r) => COLS.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n');
  console.log(`Tuned ${CSV}: v5 totals ${JSON.stringify(V5_BUDGET)}; ${moved.length} signature changes:\n  ${moved.join('\n  ')}`);
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
  const bad = problems(roster, V5_MAX);
  if (bad.length) { console.error(`Not saved:\n${bad.map((b) => `  • ${b}`).join('\n')}`); process.exit(1); }
  writeFileSync(OUT, JSON.stringify(roster) + '\n');
  const count = characters.reduce((m, c) => ((m[c.rarity] = (m[c.rarity] ?? 0) + 1), m), {});
  console.log(`Saved src/roster/roster-v5.json: ${characters.length + 1} players.`, count);
} else console.log('Use: node scripts/roster-v5.mjs build | tune | import');
