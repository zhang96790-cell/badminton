# Adding players (the roster)

The roster is `src/roster/roster.json`. You don't edit it by hand: fill in a spreadsheet, save it as CSV, and
import it. The game always keeps the placeholder **Club Player** (`default_player`, every stat 20), which everyone
owns.

## 1. Fill in the spreadsheet

One row per player, with this header row (column order doesn't matter):

```
id,name,country,rarity,style,handedness,power,speed,net,defence,stamina,career_strength,released_in,enabled,description
```

| Column | What to put |
|---|---|
| id | Lowercase letters and underscores only, unique: `kento_m`, `lin_dan`. No digits, spaces or hyphens (stats are saved under it). Never change an id once released. |
| name | As shown in the game. |
| country | 3-letter code: GBR, SGP, CHN, DEN, IND, JPN, MAS, INA, KOR, TPE… |
| rarity | common, rare, super_rare, epic, elite, mythic, legendary, champion |
| style | all-rounder, attacker, defender, net player, deceptive, fast retriever, defensive wall |
| handedness | right or left |
| power, speed, net, defence, stamina | Whole numbers, 10 to 35 each. |
| career_strength | Any number; not used until 3.0 (put 0). |
| released_in | The version it arrives in, e.g. 2.8. |
| enabled | true, or false to hide a player without deleting them. |
| description | A sentence or two. Put it in "quotes" if it contains commas. |

**The five stats must add up to exactly the rarity's total:**

| Rarity | Total |
|---|---|
| Common | 100 |
| Rare | 101 |
| Super Rare | 103 |
| Epic | 104 |
| Elite | 106 |
| Mythic | 107 |
| Legendary | 109 |
| Champion | 110 |

What the stats do (20 is today's player; each is capped so nobody strays far from today's game):

- **Power:** smash speed and clear depth (a high-Power clear never aims past 6.3 m, so it doesn’t sail long).
- **Speed:** footwork, and how soon you can swing again after a hit.
- **Net:** net-shot accuracy and the timing window on net shots.
- **Defence:** the timing window and depth accuracy on lifts and blocks.
- **Stamina:** nothing yet (kept for later).

## 2. Import it

```
npm run roster:import path/to/players.csv
```

It checks every row and saves nothing if anything is wrong, listing each problem. `npm run roster:check` re-checks
the roster at any time (it also runs on every build, so a broken roster can't be published).

## 3. Publish

1. Run `supabase/roster.sql` in Supabase → SQL Editor (it's rewritten by every import and check). Unlock picks and
   featured players are chosen from this list.
2. Deploy the room server (it reads the roster for ranked matches):
   `cd server && PATH="$HOME/.local/node22/bin:$PATH" npx wrangler deploy`
3. Push the game as usual. The roster is part of the version check, so anyone still on an old page is asked to
   refresh before playing online.

## Featured players

Each season, up to 3 players (Common to Elite) are free for everyone. Set them in Supabase without a redeploy:

```sql
insert into public.featured (season_id, character_id) values (1, 'kento_m'), (1, 'lin_dan'), (1, 'tai_t');
```
