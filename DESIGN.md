# Skyline Smash: design

## World
The start screen is the tournament's **Order of Play board**: the notice that tells players which court
they're on and when. Your match is listed on Court 1 and you walk on. Settings live on the umpire's
**match card**, a cool-white drawer that slides in from the right. The live arena keeps rendering behind
the board, so the game itself is always in view.

Rejected on purpose: the floating dark card with a stack of equal option buttons and a gradient title.

## Tokens (src/menu.css `:root`)
| Token | Value | Use |
|---|---|---|
| `--board` / `--board-deep` / `--board-lit` | #0f2d70 / #0a2157 / #16398a | Arena-board blue surfaces; lit = the live row |
| `--rule` | translucent white | Row dividers |
| `--ink` / `--ink-2` / `--ink-3` | #f3f6fc / #b8c8ec / #8ea6d8 | Text on the board, descending emphasis |
| `--amber` / `--amber-hi` / `--amber-ink` | #ffb51f / #ffc54d / #1d1300 | Scoreboard amber: court 1 numeral, opponent name, Walk on button, Order of play label |
| `--live` | #43d982 | "Next on court" status dot, beginner tip |
| `--card` / `--card-ink` / `--card-ink-2` | #f4f7fc / #0c2259 / #3c5590 | Match card paper and navy ink |

Amber is the only warm colour and marks what to do next. Don't spread it to secondary controls.

## Type
- **Big Shoulders Display** (700/800, `--display`): stadium caps for the wordmark, court numerals, match lines, buttons.
- **Barlow Semi Condensed** (500/600/700, `--text`): everything else. Small caps-style labels use uppercase with letter-spacing.
- Self-hosted via @fontsource. Import paths have no `.css` extension (the package's export map adds it).

## Layout
- Desktop: a board centred over the arena. Header (shuttle mark and wordmark on the left, Order of play and date on the right),
  column heads, three court rows (`84px 188px 1fr auto`), keyboard-notice slot, then a footer with shortcuts and links.
- ≤760px: rows restack (numeral on the left; event, match and actions below), the footer stacks, and the View/Fullscreen
  bar hides while the menu is open.
- Two side drawers share the `.matchcard` style, `min(470px, 100%)` wide, and only one is open at a time. Esc closes it.
  - **Match card** (Edit match card on Court 1): match settings only (event, opponent, CPU style, partner style, format, accuracy). No tabs. Rows that don't apply (partner style in singles, 2 players in doubles) dim to 40% and can't be clicked.
  - **Assists & controls** slides in from the **left**. It opens from a vertical cool-white pull tab (`.kit-tab`) on the left screen edge,
    and How to play opens its Controls tab. The tab rides on the drawer's edge while open and its chevron flips. On phones the tab
    sits low on the edge and hides while the full-width drawer is open. Tabs inside: Assists, and Controls (control mode above the shot table).

## Account
- A pill in the board header (above Order of play): grey dot and "Log in", or a green live dot and the username.
- The dialog is a white **player accreditation pass** (lanyard slot at the top, navy rule under the title), same paper and ink as the match card.

## Motion
- Rows flip in like a split-flap board (clip-path, staggered). Text that changes (opponent, format, event) flips via `flip()` in main.ts.
- The match card slides in over 0.42s with an ease-out.
- `prefers-reduced-motion` turns all of it off.

## Copy rules
- Talk like a tournament: "Walk on", "Next on court", "Edit match card", "Warm-up".
- No invented sponsors, players or events presented as real.
