// npm run roster:check — validates src/roster/roster.json, prints counts, writes supabase/roster.sql.
import { problems, readRoster, summary, writeSql } from './roster-lib.mjs';

let roster;
try { roster = readRoster(); } catch (e) { console.error(`Roster: can't read src/roster/roster.json (${e.message})`); process.exit(1); }
const bad = problems(roster);
if (bad.length) {
  console.error(`Roster has ${bad.length} problem${bad.length > 1 ? 's' : ''}:\n${bad.map((b) => `  • ${b}`).join('\n')}`);
  process.exit(1);
}
writeSql(roster);
const s = summary(roster);
console.log(`Roster OK: ${s.total} player${s.total === 1 ? '' : 's'}`);
console.log('  by rarity:', s.byRarity);
console.log('  by style:', s.byStyle);
console.log('  by country:', s.byCountry);
