// npm run roster:check — validates src/roster/roster.json (errors fail the build), writes the warnings
// list and supabase/roster.sql.
import { problems, readRoster, summary, warnings, writeSql, writeWarnings } from './roster-lib.mjs';

let roster;
try { roster = readRoster(); } catch (e) { console.error(`Roster: can't read src/roster/roster.json (${e.message})`); process.exit(1); }
const bad = problems(roster);
if (bad.length) {
  console.error(`Roster has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n${bad.map((b) => `  • ${b}`).join('\n')}`);
  process.exit(1);
}
writeSql(roster);
const w = warnings(roster, roster.characters.filter((c) => c.empty_slot).map((c) => c.name));
writeWarnings(w);
const s = summary(roster);
console.log(`Roster OK: ${s.total} players`, s.byRarity, `· warnings: ${w.clash.length} clashes, ${w.emptySlots.length} empty slots, ${w.extremes.length} extremes`);
