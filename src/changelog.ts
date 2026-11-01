/** Shown on the menu under "What's new". Newest first. Also mirrored in CHANGELOG.md. */
export const CHANGELOG: { version: string; date: string; changes: string[] }[] = [
  {
    version: '1.7',
    date: '2 Nov 2026',
    changes: [
      'New control mode, Keys + trackpad aim: hit with J/K/L/E and aim with the cursor.',
      'Keyboard aiming has its own keys: hold U (left) or O (right) as you hit. Movement keys no longer aim.',
      'With no aim key held, keyboard shots go to the open side, away from your opponent.',
      'Aimed shots land a little further inside the sideline, so fewer go out.',
      'Fixed: tapping K is a full smash again; holding K adds extra power on top.',
      'If you hold a shot too long, the game swings for you (a late hit) instead of letting the shuttle go past.',
      'What\u2019s new opens in its own pop-up.',
    ],
  },
  {
    version: '1.6',
    date: '2 Nov 2026',
    changes: [
      'Keyboard: hold K to hit harder. E is an instant net kill.',
      'Menu shows a table of every shot with its mouse and keyboard input.',
      'Landing marker is less precise, so it no longer gives away close line calls.',
      'This "What’s new" list.',
    ],
  },
  {
    version: '1.5',
    date: '2 Nov 2026',
    changes: [
      'New Close camera (default): the court fills more of the screen. Switch back to Broadcast with the button at the bottom-right.',
      'Fullscreen button (or press F).',
    ],
  },
  {
    version: '1.4',
    date: '2 Nov 2026',
    changes: [
      'Interactive tutorial: 14 short lessons with a coach feeding you shuttles.',
      'Practice drills: smash, clear & drop, net play, drives, defence and mixed.',
      'Now online at badmintongames.site.',
    ],
  },
  {
    version: '1.3',
    date: '1 Nov 2026',
    changes: [
      'Shot label on court names what you’ll actually hit (CLEAR vs LIFT, DROP vs NET SHOT, and so on).',
      'Timing light beside your player: yellow = wait, green = swing, red = late.',
      'Held lobs always reach the back of the court.',
      'Timing is more forgiving, power shots are more accurate, and jumps no longer drift.',
    ],
  },
  {
    version: '1.2',
    date: '1 Nov 2026',
    changes: [
      'New mouse controls: left click = drive (tap) or smash (hold), right click = drop (tap) or lob (hold).',
    ],
  },
  {
    version: '1.1',
    date: '1 Nov 2026',
    changes: [
      'Smarter CPU that learns your weaknesses, four personalities and an Expert level.',
      'Umpire with voice calls, service judge and line judges.',
      'Hawk-Eye challenges, a 25-second shot clock, replays and an end-of-match stats screen.',
      'New arena with crowd, plus footwork: split-step, lunge and scissor kick.',
      'Longer and harder shots are less accurate. Drops can no longer float into the net.',
    ],
  },
  {
    version: '1.0',
    date: '1 Nov 2026',
    changes: [
      'First version: singles against the CPU or a friend, real shuttle physics, mouse or keyboard controls.',
      '15- or 21-point games, 1 game or best of 3, and a landing marker.',
    ],
  },
];
