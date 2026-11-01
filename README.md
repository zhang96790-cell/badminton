# Badminton

Singles badminton in the browser. TV-broadcast 3/4 view, real shuttle aerodynamics, BWF-style rally scoring
(1 game or best of 3; 15-point or 21-point).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173 (or the port Vite prints).

## Changelog

See [CHANGELOG.md](CHANGELOG.md). When you ship an update, add an entry at the top of `src/changelog.ts` (shown in the
menu) and mirror it in `CHANGELOG.md`.

## Publishing

`netlify.toml` tells Netlify to run `npm run build` and serve `dist/`. Connect the GitHub repo once in Netlify
and every push to `main` redeploys automatically.

## Features

- Interactive tutorial (14 steps, adapts to keyboard+mouse or keyboard-only) and Practice drills against a feeder.

- CPU at four levels (Easy to Expert) with four personalities: All-rounder, Attacker, Defender, Net player.
  It plays tactically and learns where you struggle over a match.
- Officials: an umpire with voice score calls, a service judge, and line judges who signal in or out
  (and occasionally miscall very close shuttles).
- Hawk-Eye challenges (H): two unsuccessful challenges per game.
- A 25-second shot clock between rallies: warning first, then a fault.
- Replays (R), automatic for great points, with a side camera (V).
- End-of-match scoreboard with stats and shot heatmaps.

## Tuning

Every number lives in [`src/config.ts`](src/config.ts):

- `PHYSICS.terminalVelocity` sets shuttle drag (lower means more drag and a steeper drop). `PHYSICS.gameSpeed` is the overall time scale.
- `PLAYER` covers movement, reach, lunge and split-step.
- `SWING` sets the timing window.
- `SHOTS.aim` controls accuracy, which gets worse with distance and power. `SHOTS.softMaxAngle` caps how high drops can float.
- `AI` holds per-difficulty settings and `STYLES` the CPU personalities.
- `OFFICIALS` covers line-judge error rate, challenges and the shot clock. `REPLAY` covers replay behaviour.
- `RULES` holds the scoring formats. `KEYS` / `UI_KEYS` hold the key bindings.

## Code map

| File | What it does |
|---|---|
| `shuttle.ts` | Flight integration (gravity + quadratic drag, RK4), cork-first orientation, path prediction |
| `solver.ts` | Inverse ballistics: finds the angle and speed that land a shot on a target |
| `shots.ts` | Turns intent + contact (height, timing, hand, stretch) into a launch, applies aim error, names the shot |
| `player.ts` | Movement, footwork (split-step, lunge), jumping, swing timing and contact |
| `controllers.ts` | Keyboard-only and keyboard+mouse control schemes |
| `ai.ts` | CPU opponent: movement, tactics, personalities, learning, challenges |
| `rules.ts` | Scoring, service court, game point / match point |
| `officials.ts` | Umpire, service judge, line judges and their calls |
| `game.ts` | Rally state machine, line calls, challenges, shot clock, replays, stats |
| `hawkeye.ts` | The Hawk-Eye review sequence |
| `replay.ts` / `stats.ts` | Rally recording/playback, match statistics |
| `render.ts` / `hud.ts` / `camera.ts` | Arena, players and officials; HUD and end screen; cameras |
| `voice.ts` / `audio.ts` | Umpire voice (browser text-to-speech); synthesized sounds and crowd |
