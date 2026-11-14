// Shared by roster:check and roster:import. Reads the owner's sheet (.xlsx or .csv), never edits it.
import { readFileSync, writeFileSync } from 'node:fs';

export const ROSTER_PATH = new URL('../src/roster/roster.json', import.meta.url);
export const CONFIG_PATH = new URL('../src/roster/roster-config.json', import.meta.url);
export const SQL_PATH = new URL('../supabase/roster.sql', import.meta.url);
export const WARNINGS_PATH = new URL('../docs/roster-warnings.md', import.meta.url);

export const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
export const BUDGET = CONFIG.budgets[CONFIG.rankedBudgetMode] ?? CONFIG.budgets.sheet;
export const RARITIES = Object.keys(CONFIG.budgets.sheet);
export const STYLES = ['all-rounder', 'attacker', 'defender', 'net player', 'deceptive', 'fast retriever', 'defensive wall'];
export const STAT_KEYS = ['power', 'speed', 'net', 'defence', 'stamina'];
export const PLACEHOLDER = 'default_player';
/** Longest id: stats keys like char_losses_<id> must fit in 32 characters. */
export const MAX_ID = 20;

export const readRoster = () => JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));

/** "Lin Dan" → "lin_dan". Letters only (accents dropped), so it's safe in stats keys. */
export const slugOf = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Scale stats to add up to exactly `total`, each 10–35: proportional, then clamped, then the leftover
 * shared out by largest remainder (so the result is whole numbers with the exact total).
 */
export function fitToTotal(stats, total) {
  const sum = stats.reduce((a, b) => a + b, 0);
  let raw = stats.map((s) => (s * total) / sum);
  for (let pass = 0; pass < 5; pass++) {
    const fixed = raw.map((v) => v < 10 || v > 35);
    raw = raw.map((v) => Math.min(35, Math.max(10, v)));
    const left = total - raw.reduce((a, b) => a + b, 0);
    const free = raw.map((_, i) => !fixed[i] && raw[i] > 10 && raw[i] < 35);
    const freeSum = raw.reduce((a, v, i) => a + (free[i] ? v : 0), 0);
    if (Math.abs(left) < 1e-9 || !freeSum) break;
    raw = raw.map((v, i) => (free[i] ? v + (left * v) / freeSum : v));
  }
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; if (out[i] < 35) { out[i]++; left--; } }
  return out;
}

/** "[S] Name — effect" (em dash, en dash or hyphen). A bare "[S]" is an empty slot (null). */
export function parseAbility(text) {
  const t = String(text ?? '').trim();
  if (!t) return undefined;
  const m = t.match(/^\[(SS|S)\]\s*(.*)$/i);
  if (!m) return { tier: 'S', name: t.split(/\s+[—–-]\s+/)[0].trim(), text: t.split(/\s+[—–-]\s+/).slice(1).join(' — ').trim() };
  const rest = m[2].trim();
  if (!rest) return null;
  const [name, ...more] = rest.split(/\s+[—–-]\s+/);
  return { tier: m[1].toUpperCase(), name: name.trim(), text: more.join(' — ').trim() };
}

const truthy = (v) => (typeof v === 'boolean' ? v : !/^(false|no|0)$/i.test(String(v ?? '').trim()));

/** Read the first sheet of an .xlsx, or a .csv, as an array of objects keyed by lowercased header. */
export async function readSheet(file) {
  if (/\.xlsx$/i.test(file)) {
    let rows = [];
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && 'richText' in v ? v.richText.map((r) => r.text).join('') : v && typeof v === 'object' && 'result' in v ? v.result : v))));
    } catch {
      // Some tools save .xlsx files exceljs can't open (absolute paths inside the package): read it directly.
      const { readXlsxRows } = await import('./xlsx-read.mjs');
      rows = readXlsxRows(file);
    }
    const head = rows.shift().map((h) => String(h ?? '').trim().toLowerCase());
    return rows.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  const text = readFileSync(file, 'utf8');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const good = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const head = good.shift().map((h) => h.trim().toLowerCase());
  return good.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export const NEEDED = ['id', 'name', 'country', 'rarity', 'style', 'handedness', ...STAT_KEYS, 'ranked_stat_total', 'career_strength', 'released_in', 'enabled', 'description'];

/** Sheet rows → roster characters (normalised). Returns { characters, emptySlots }. */
export function normalise(rows) {
  const emptySlots = [];
  const characters = rows.map((r) => {
    const s = (k) => String(r[k] ?? '').trim();
    const name = s('name');
    const base = STAT_KEYS.map((k) => Number(s(k)));
    const rarity = s('rarity').toLowerCase().replace(/\s+/g, '_');
    const sheetTotal = Number(s('ranked_stat_total'));
    const rankedTotal = CONFIG.rankedBudgetMode === 'sheet' ? sheetTotal : BUDGET[rarity];
    const abilities = [];
    const sig = parseAbility(r.signature);
    if (sig === null) emptySlots.push(name);
    if (sig) abilities.push({ id: slugOf(sig.name), tier: sig.tier, name: sig.name, text: sig.text, slot: 'signature' });
    if (s('skill')) abilities.push({ id: slugOf(s('skill')), tier: 'S', name: s('skill'), text: s('gameplay_effect'), slot: 'skill' });
    return {
      id: slugOf(name), sheet_id: s('id'), name,
      country: s('country').toUpperCase(), rarity, style: s('style').toLowerCase(), handedness: s('handedness').toLowerCase(),
      stats: base.every(Number.isFinite) && rankedTotal ? (CONFIG.rankedBudgetMode === 'sheet' ? base : fitToTotal(base, rankedTotal)) : base,
      base_stats: base, ranked_stat_total: sheetTotal,
      career_strength: Number(s('career_strength')) || CONFIG.careerStrength[rarity] || 100,
      released_in: s('released_in'), enabled: truthy(r.enabled), description: s('description'), abilities,
      ...(sig === null ? { empty_slot: true } : {}),
    };
  });
  return { characters, emptySlots };
}

/** Errors (the roster can't be used) as plain sentences. */
export function problems(roster) {
  const out = [];
  const list = roster.characters;
  if (!Array.isArray(list)) return ['"characters" must be a list'];
  const ids = new Map(), names = new Map();
  if (!list.some((c) => c.id === PLACEHOLDER)) out.push(`The placeholder "${PLACEHOLDER}" must stay in the roster.`);
  list.forEach((c, i) => {
    const who = c.name ? `"${c.name}"${c.sheet_id ? ` (sheet id ${c.sheet_id})` : ''}` : `row ${i + 2}`;
    if (!c.name) out.push(`${who}: missing name`);
    if (!c.id) out.push(`${who}: its name makes an empty id`);
    else if (c.id.length > MAX_ID) out.push(`${who}: its id "${c.id}" is longer than ${MAX_ID} letters (stats are saved under it); shorten the name`);
    if (ids.has(c.id)) out.push(`${who}: id "${c.id}" is the same as ${ids.get(c.id)} (two names make the same id)`);
    ids.set(c.id, who);
    if (c.name && names.has(c.name)) out.push(`${who}: name used twice`);
    names.set(c.name, who);
    if (!RARITIES.includes(c.rarity)) out.push(`${who}: rarity "${c.rarity}" isn't one of ${RARITIES.join(', ')}`);
    if (!STYLES.includes(c.style)) out.push(`${who}: style "${c.style}" isn't one of ${STYLES.join(', ')}`);
    if (c.handedness !== 'right' && c.handedness !== 'left') out.push(`${who}: handedness must be right or left`);
    if (!/^[A-Z]{3}$/.test(c.country ?? '')) out.push(`${who}: country must be a 3-letter code like GBR`);
    for (const [label, st] of [['stats', c.base_stats ?? c.stats], ['ranked stats', c.stats]]) {
      if (!Array.isArray(st) || st.length !== 5 || st.some((v) => !Number.isInteger(v))) out.push(`${who}: ${label} must be 5 whole numbers (Power, Speed, Net, Defence, Stamina)`);
      else if (st.some((v) => v < 10 || v > 35)) out.push(`${who}: every stat must be between 10 and 35`);
    }
    if (c.id !== PLACEHOLDER && Array.isArray(c.base_stats) && c.ranked_stat_total !== undefined) {
      const total = c.base_stats.reduce((a, b) => a + b, 0);
      if (total !== c.ranked_stat_total) out.push(`${who}: stats add up to ${total}, but ranked_stat_total says ${c.ranked_stat_total}`);
    }
    if (c.id !== PLACEHOLDER && Array.isArray(c.stats) && RARITIES.includes(c.rarity) && CONFIG.rankedBudgetMode !== 'sheet') {
      const t = c.stats.reduce((a, b) => a + b, 0);
      if (t !== BUDGET[c.rarity]) out.push(`${who}: ranked stats add up to ${t}, not the ${BUDGET[c.rarity]} a ${c.rarity} needs`);
    }
    if (!/^\d+(\.\d+)*$/.test(String(c.released_in ?? ''))) out.push(`${who}: released_in must be a version like 3.0`);
    if (typeof c.enabled !== 'boolean') out.push(`${who}: enabled must be true or false`);
    if ((c.abilities?.length ?? 0) > 2) out.push(`${who}: at most 2 abilities (signature + skill)`);
  });
  return out;
}

/** Warnings (worth a look, but the roster still works). */
export function warnings(roster, emptySlots = []) {
  const w = { clash: [], extremes: [], emptySlots, totals: [] };
  for (const c of roster.characters) {
    if (c.id === PLACEHOLDER) continue;
    const [p, sp, n, d] = c.base_stats ?? c.stats;
    const clash = (c.style === 'attacker' && p <= 18) ? `attacker with Power ${p}`
      : ((c.style === 'defender' || c.style === 'defensive wall') && d <= 15) ? `${c.style} with Defence ${d}`
      : (c.style === 'net player' && n <= 18) ? `net player with Net ${n}`
      : (c.style === 'fast retriever' && sp <= 18) ? `fast retriever with Speed ${sp}` : null;
    if (clash) w.clash.push(`${c.name} (${c.rarity.replace('_', ' ')}): ${clash}`);
    const st = c.base_stats ?? c.stats;
    if (st.some((v) => v === 10 || v === 35)) w.extremes.push(`${c.name}: ${st.join('/')}`);
    const expected = CONFIG.budgets.sheet[c.rarity];
    if (c.ranked_stat_total !== undefined && expected && c.ranked_stat_total !== expected) w.totals.push(`${c.name}: total ${c.ranked_stat_total}, a ${c.rarity} is usually ${expected}`);
  }
  return w;
}

export function writeWarnings(w) {
  const sec = (title, why, list) => `## ${title} (${list.length})\n\n${why}\n\n${list.length ? list.map((x) => `- ${x}`).join('\n') : '- None'}\n`;
  writeFileSync(WARNINGS_PATH, `# Roster warnings

Written by \`npm run roster:check\` / \`roster:import\`. None of these stop the roster working; they're worth a look.

${sec('Style and stats don’t match', 'A player whose style doesn’t suit their stats (e.g. an attacker with low Power). The CPU plays them by style, so they may feel odd.', w.clash)}
${sec('Empty ability slots', 'The signature column says [S] or [SS] with no ability name, so these players have no ability.', w.emptySlots)}
${sec('A stat at the limit (10 or 35)', 'Allowed, just extreme.', w.extremes)}
${sec('Unusual stat total', 'The total isn’t the usual one for the rarity.', w.totals)}`);
}

export function summary(roster) {
  const count = (key) => roster.characters.reduce((m, c) => ((m[c[key]] = (m[c[key]] ?? 0) + 1), m), {});
  return { total: roster.characters.length, byRarity: count('rarity'), byStyle: count('style'), released: count('released_in') };
}

/** The characters table for Supabase (unlock picks, featured players, recruiting). */
export function writeSql(roster) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const rows = roster.characters.map((c) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.rarity)}, ${c.enabled}, ${q(c.country)}, ${q(c.released_in)}, ${Number(c.career_strength) || 100})`).join(',\n');
  writeFileSync(SQL_PATH, `-- Skyline Smash: the roster, for unlock picks, featured players and career recruiting. Written by npm run roster:check.
-- Run it in Supabase → SQL Editor after changing the roster (after 2.7-ranks.sql and career.sql). Safe to run again.
alter table public.characters add column if not exists country text, add column if not exists released_in text, add column if not exists career_strength int;
insert into public.characters (id, name, rarity, enabled, country, released_in, career_strength) values
${rows}
on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, enabled = excluded.enabled,
  country = excluded.country, released_in = excluded.released_in, career_strength = excluded.career_strength;
update public.characters set enabled = false where id not in (${roster.characters.map((c) => q(c.id)).join(', ')});
`);
}
