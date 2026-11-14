// npm run roster:import <file.xlsx|file.csv> — the owner's roster sheet → src/roster/roster.json, checked.
// Uses the first sheet only; see docs/roster-guide.md for the columns. Never edits the sheet.
import { writeFileSync } from 'node:fs';
import { NEEDED, PLACEHOLDER, ROSTER_PATH, normalise, problems, readRoster, readSheet, summary, warnings, writeSql, writeWarnings } from './roster-lib.mjs';

const file = process.argv[2] ?? 'data/Skyline_Smash_Roster_Updated.xlsx';
const t0 = performance.now();
const rows = await readSheet(file);
const missing = NEEDED.filter((n) => !(n in (rows[0] ?? {})));
if (missing.length) { console.error(`The sheet is missing columns: ${missing.join(', ')}`); process.exit(1); }
const { characters, emptySlots } = normalise(rows);
const placeholder = readRoster().characters.find((c) => c.id === PLACEHOLDER);
const roster = { data_version: 2, characters: [placeholder, ...characters.filter((c) => c.id !== PLACEHOLDER)] };
const bad = problems(roster);
if (bad.length) {
  console.error(`Not saved. The sheet has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n${bad.map((b) => `  • ${b}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(ROSTER_PATH, JSON.stringify(roster) + '\n');
writeSql(roster);
const w = warnings(roster, emptySlots);
writeWarnings(w);
const s = summary(roster);
console.log(`Saved src/roster/roster.json: ${s.total} players in ${Math.round(performance.now() - t0)} ms.`, s.byRarity, s.released);
console.log(`Warnings (docs/roster-warnings.md): ${w.clash.length} style/stat clashes, ${w.emptySlots.length} empty ability slots, ${w.extremes.length} with a stat at 10 or 35, ${w.totals.length} unusual totals.`);
console.log('Next: run supabase/roster.sql in Supabase, then redeploy the room server (it checks the roster too).');
