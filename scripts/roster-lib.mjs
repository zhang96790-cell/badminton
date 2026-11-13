// Shared by roster:check and roster:import. Plain Node, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

export const ROSTER_PATH = new URL('../src/roster/roster.json', import.meta.url);
export const SQL_PATH = new URL('../supabase/roster.sql', import.meta.url);

// Keep in step with shared/characters.ts.
export const BUDGET = { common: 100, rare: 101, super_rare: 103, epic: 104, elite: 106, mythic: 107, legendary: 109, champion: 110 };
export const STYLES = ['all-rounder', 'attacker', 'defender', 'net player', 'deceptive', 'fast retriever', 'defensive wall'];
export const PLACEHOLDER = 'default_player';
const FIELDS = ['id', 'name', 'country', 'rarity', 'style', 'handedness', 'stats', 'career_strength', 'released_in', 'enabled', 'description'];

export const readRoster = () => JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));

/** Every problem with a roster, as plain sentences (empty if it's fine). */
export function problems(roster) {
  const out = [];
  if (roster.data_version !== 1) out.push('data_version must be 1');
  const list = roster.characters;
  if (!Array.isArray(list)) return ['"characters" must be a list'];
  const seen = new Set();
  if (!list.some((c) => c.id === PLACEHOLDER)) out.push(`The placeholder "${PLACEHOLDER}" must stay in the roster.`);
  list.forEach((c, i) => {
    const who = c.id ? `"${c.id}"` : `row ${i + 1}`;
    for (const f of FIELDS) if (c[f] === undefined || c[f] === '') out.push(`${who}: missing ${f}`);
    if (typeof c.id === 'string' && !/^[a-z_]+$/.test(c.id)) out.push(`${who}: ids may only use lowercase letters and underscores (no digits, spaces or hyphens)`);
    if (typeof c.id === 'string' && c.id.length > 20) out.push(`${who}: ids can be at most 20 letters (stats are saved under them)`);
    if (seen.has(c.id)) out.push(`${who}: id used twice`);
    seen.add(c.id);
    if (!(c.rarity in BUDGET)) out.push(`${who}: rarity "${c.rarity}" isn't one of ${Object.keys(BUDGET).join(', ')}`);
    if (!STYLES.includes(c.style)) out.push(`${who}: style "${c.style}" isn't one of ${STYLES.join(', ')}`);
    if (c.handedness !== 'right' && c.handedness !== 'left') out.push(`${who}: handedness must be right or left`);
    if (typeof c.country !== 'string' || !/^[A-Z]{3}$/.test(c.country)) out.push(`${who}: country must be a 3-letter code like GBR`);
    if (!Array.isArray(c.stats) || c.stats.length !== 5 || c.stats.some((s) => !Number.isInteger(s))) out.push(`${who}: stats must be 5 whole numbers (Power, Speed, Net, Defence, Stamina)`);
    else {
      if (c.stats.some((s) => s < 10 || s > 35)) out.push(`${who}: every stat must be between 10 and 35`);
      const total = c.stats.reduce((a, b) => a + b, 0);
      if (c.id !== PLACEHOLDER && c.rarity in BUDGET && total !== BUDGET[c.rarity]) out.push(`${who}: stats add up to ${total}, but a ${c.rarity} player must add up to exactly ${BUDGET[c.rarity]}`);
    }
    if (typeof c.enabled !== 'boolean') out.push(`${who}: enabled must be true or false`);
  });
  return out;
}

export function summary(roster) {
  const count = (key) => roster.characters.reduce((m, c) => ((m[c[key]] = (m[c[key]] ?? 0) + 1), m), {});
  return { total: roster.characters.length, byRarity: count('rarity'), byStyle: count('style'), byCountry: count('country') };
}

/** The characters table for Supabase (unlock picks and featured players are chosen there). */
export function writeSql(roster) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const rows = roster.characters.map((c) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.rarity)}, ${c.enabled})`).join(',\n');
  writeFileSync(SQL_PATH, `-- Skyline Smash: the roster, for unlock picks and featured players. Written by npm run roster:check.
-- Run it in Supabase → SQL Editor after changing src/roster/roster.json (after characters.sql). Safe to run again.
insert into public.characters (id, name, rarity, enabled) values
${rows}
on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, enabled = excluded.enabled;
update public.characters set enabled = false where id not in (${roster.characters.map((c) => q(c.id)).join(', ')});
`);
}
