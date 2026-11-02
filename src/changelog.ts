/**
 * Shown in the "What's new" pop-up. Newest first. Also mirrored in CHANGELOG.md.
 * Versioning: bump the middle number (1.4) for a batch of new features; use a patch number
 * (1.3.2) for small changes and fixes, grouping them rather than bumping for each one.
 */
export const CHANGELOG: { version: string; title: string; date: string; changes: string[] }[] = [
  {
    version: '1.6.1',
    title: 'Physics revision page',
    date: '2 Nov 2026',
    changes: [
      'New Air Physics Revision page at /physics: a working projectile simulator (shuttlecock, tennis ball or no air) using the game’s drag model, key ideas, equations and a quick quiz.',
      'Its menu (☰) has a Badminton simulator button that opens the game at /play. The physics page loads none of the game, so the game starts fresh and runs on its own.',
    ],
  },
  {
    version: '1.6',
    title: 'Doubles',
    date: '2 Nov 2026',
    changes: [
      'Doubles: you and a CPU partner against a CPU pair. Pick it under Event on the match card. Your partner plays at the opponents’ level.',
      'Real doubles rules: the side alleys are in, and the service box is short and wide (the back line is out on the serve). You serve from the right on an even score and the left on odd, partners swap courts only when they win a point on their own serve, and only the receiver may return the serve.',
      'Your partner plays like a doubles player: side by side when defending, front and back when attacking. They call “Mine!” or “Yours!” for shuttles down the middle and cover the gap when you get pulled out of position.',
      'The CPU pair works together too, aiming at the gap between you and at whoever is out of position.',
      'Partner styles on the match card: All-rounder, Back-court smasher, Steady defender or Net player.',
      'Serving is mostly low in doubles. Receivers stand close and rush loose serves, so the flick serve matters. In mouse mode, tap right-click for a flick and hold it for a high serve.',
      'Auto-switch (in Assists & controls): you take over whichever of your pair is better placed for the next shot. It’s off by default.',
      'A white ring and YOU tag show which player is yours, the scoreboard shows both pairs, and the bottom line says who serves from which court.',
      'The end-of-match screen adds each player’s shots, winners, errors, smashes and fastest smash.',
      'Two new tutorial lessons, Doubles serve and Doubles positions, and three new practice drills on keys 7–9: Doubles defence (2 on 1), Drive exchange and Return of serve.',
    ],
  },
  {
    version: '1.5.2',
    title: 'Slide-out side panel',
    date: '2 Nov 2026',
    changes: [
      'Assists & controls is now a tab on the left edge of the start screen. Click it to slide the panel out, and click it again (or press Esc) to put it away.',
    ],
  },
  {
    version: '1.5.1',
    title: 'Assists & controls panel',
    date: '2 Nov 2026',
    changes: [
      'The match card now only has match settings: opponent, CPU style, format and accuracy.',
      'Assists and controls have their own panel. Open it with Assists & controls (or How to play) at the bottom of the start screen. The control mode picker is on its Controls tab, above the shot table.',
    ],
  },
  {
    version: '1.5',
    title: 'New start screen',
    date: '2 Nov 2026',
    changes: [
      'The start screen is now a tournament Order of Play board: your match is on Court 1, so press Walk on (or Enter) to play.',
      'Tutorial is on Court 2 and Practice on Court 3.',
      'Opponent, CPU style, controls, scoring, assists and voice are on the match card. Open it with Edit match card.',
      'How to play opens the full shot table on the match card.',
    ],
  },
  {
    version: '1.4.3',
    title: 'Jump smash recovery',
    date: '2 Nov 2026',
    changes: [
      'After landing a jump smash you get a quick burst of speed (and no landing slowdown) to recover to the middle.',
    ],
  },
  {
    version: '1.4.2',
    title: 'Why it hit the net',
    date: '2 Nov 2026',
    changes: [
      'When a shot goes into the net, the message says why, e.g. "Smash mistimed (late), hit too low" or "Net shot backhand, stretched".',
    ],
  },
  {
    version: '1.4.1',
    title: 'CPU challenges can be wrong',
    date: '2 Nov 2026',
    changes: [
      'The CPU judges line calls by eye now, so its Hawk-Eye challenges are sometimes wrong. Easy challenges recklessly; Expert is picky and usually right.',
    ],
  },
  {
    version: '1.4',
    title: 'Easier to play',
    date: '2 Nov 2026',
    changes: [
      'New Beginner CPU: slower, softer and safer. It’s the default for new players.',
      'Wider timing window: the green "Perfect" moment lasts longer, and mistimed hits lose less power and accuracy.',
      'You can reach shuttles about 20 cm further from your body.',
      'Swing assist (on by default): if you don’t swing at a slower shuttle (lift, drop or clear), your player gets it back with a high shot. Smashes still need a real swing. Turn it off on the menu.',
    ],
  },
  {
    version: '1.3.2',
    title: 'Landing marker is back',
    date: '2 Nov 2026',
    changes: [
      'The landing marker is back to the original small ring with a centre dot, just slightly less exact (a few centimetres off).',
    ],
  },
  {
    version: '1.3.1',
    title: 'Clearer landing marker',
    date: '2 Nov 2026',
    changes: [
      'The landing marker is a bright solid ring with a dark outline that gently pulses. It’s still deliberately a little off, so it won’t settle close line calls.',
    ],
  },
  {
    version: '1.3',
    title: 'Controls update',
    date: '2 Nov 2026',
    changes: [
      'New control mode, Keys + trackpad aim: hit with J/K/L/E and aim with the cursor.',
      'Keyboard: tap K for a full smash, hold K for extra power. E is an instant net kill.',
      'Keyboard aiming has its own keys: hold U (left) or O (right) as you hit. Movement keys no longer aim.',
      'With no aim key held, keyboard shots go to the open side, away from your opponent.',
      'Aimed shots land a little further inside the sideline, so fewer go out.',
      'If you hold a shot too long, the game swings for you (a late hit) instead of letting the shuttle go past.',
    ],
  },
  {
    version: '1.2',
    title: 'Launch update',
    date: '2 Nov 2026',
    changes: [
      'Interactive tutorial: 14 short lessons with a coach feeding you shuttles.',
      'Practice drills: smash, clear & drop, net play, drives, defence and mixed.',
      'New Close camera (default): the court fills more of the screen. Switch back to Broadcast with the button at the bottom-right.',
      'Fullscreen button (or press F).',
      'Menu shows a table of every shot with its mouse and keyboard input.',
      'Landing marker is less precise, so it no longer gives away close line calls.',
      'What’s new pop-up (this list).',
      'Now online at badmintongames.site.',
    ],
  },
  {
    version: '1.1',
    title: 'The big update',
    date: '1 Nov 2026',
    changes: [
      'Smarter CPU that learns your weaknesses, four personalities and an Expert level.',
      'Umpire with voice calls, service judge and line judges.',
      'Hawk-Eye challenges, a 25-second shot clock, replays and an end-of-match stats screen.',
      'New arena with crowd, plus footwork: split-step, lunge and scissor kick.',
      'New mouse controls: left click = drive (tap) or smash (hold), right click = drop (tap) or lob (hold).',
      'Shot label on court names what you’ll actually hit (CLEAR vs LIFT, DROP vs NET SHOT, and so on).',
      'Timing light beside your player: yellow = wait, green = swing, red = late.',
      'Longer and harder shots are less accurate; drops can no longer float into the net; held lobs always reach the back.',
      'Timing is more forgiving and jumps no longer drift.',
    ],
  },
  {
    version: '1.0',
    title: 'First version',
    date: '1 Nov 2026',
    changes: [
      'Singles against the CPU or a friend, with real shuttle physics and mouse or keyboard controls.',
      '15- or 21-point games, 1 game or best of 3, and a landing marker.',
    ],
  },
];
