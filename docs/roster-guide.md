# Adding players (the roster)

The roster is `src/roster/roster.json`. You don't edit it by hand: keep your spreadsheet, and import it. The game always
keeps the placeholder **Club Player** (`default_player`, every stat 20), which everyone owns.

## 1. The spreadsheet

The importer reads the **first sheet only** of an `.xlsx` (or a `.csv`) with these columns (order doesn't matter;
other columns and sheets are ignored):

```
id,name,country,rarity,style,handedness,power,speed,net,defence,stamina,ranked_stat_total,career_strength,released_in,enabled,signature,description,skill,gameplay_effect
```

| Column | What to put |
|---|---|
| id | Your own row number. Kept for reference only: the game's id is made from the **name** (`Lin Dan` → `lin_dan`, letters and underscores, at most 20 letters). Two names that make the same id stop the import. Never rename a released player (their stats are saved under it). |
| name | As shown in the game. |
| country | 3-letter code (GBR, MAS, INA, DEN…). Add new codes to `data/country_regions.json` (name and travel region). |
| rarity | Common, Rare, Super Rare, Epic, Elite, Mythic, Legendary, Champion. |
| style | all-rounder, attacker, defender, net player, deceptive, fast retriever, defensive wall |
| handedness | right or left |
| power, speed, net, defence, stamina | Whole numbers, 10 to 35 each. These are the **career** stats (and, in "sheet" mode, the ranked ones too). |
| ranked_stat_total | The five stats must add up to this. |
| career_strength | Common 100, Rare 130, Super Rare 160, Epic 190, Elite 225, Mythic 260, Legendary 300, Champion 380. |
| released_in | The version the player arrives in, e.g. 3.1. Players for a later version stay hidden until then. |
| enabled | TRUE or FALSE (hide a player without deleting them). |
| signature | `[S] Name — what it does` or `[SS] Name — …` (em dash, en dash or hyphen). A bare `[S]` is an empty slot. |
| skill, gameplay_effect | An optional second ability: its name and plain-language effect. At most 2 abilities per player. |
| description | A sentence or two. |

The numbers each ability uses live in `data/signatures.json` (see `docs/signatures-review.md`). A new ability name in
the sheet needs a row there too, or it shows on the card but does nothing.

## 2. Two stat sets

- **Career** uses your sheet's stats, scaled by career strength (a Rare is about 12% stronger than a Common, an Epic
  about 36%), with wider limits (±18%, smash −5% to +10%).
- **Ranked and friend matches** use the "ranked stats". `src/roster/roster-config.json` decides them:
  `"rankedBudgetMode": "sheet"` (your choice) uses the sheet's stats as they are; `"cap10"` squeezes everyone to totals
  of 100–110. Change that one line and re-import to switch.

## 3. Import

```
npm run roster:import data/Skyline_Smash_Roster_Updated.xlsx
```

It checks every row and saves nothing if anything is wrong, listing each problem (duplicate names or ids, a bad
rarity, style or country, a stat outside 10–35, stats that don't add up to ranked_stat_total). Warnings don't stop it:
they're written to `docs/roster-warnings.md` (style/stat clashes, empty ability slots, stats at 10 or 35).
`npm run roster:check` re-checks the roster at any time and runs on every build. Your sheet is never changed.

## 4. Publish

1. Run `supabase/roster.sql` in Supabase → SQL Editor (every import rewrites it). Picks, recruiting and the daily
   challenge choose from this list.
2. **Redeploy the room server** (it reads the roster too, and the roster is part of the online version check):
   `cd server && PATH="$HOME/.local/node22/bin:$PATH" npx wrangler deploy`
3. Push the game as usual.

When a new version comes out (e.g. 3.1 releases the Super Rares), also update `app_version` in Supabase so the server
offers the newly released players: `update public.game_config set value = '3.1' where key = 'app_version';`

## Featured players

Each season, up to 3 players (Common to Elite) are free for everyone:

```sql
insert into public.featured (season_id, character_id) values (1, 'some_player');
```
