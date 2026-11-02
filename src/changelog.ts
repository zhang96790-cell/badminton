/**
 * Shown in the "What's new" pop-up. Newest first. Also mirrored in CHANGELOG.md.
 * Versioning: bump the middle number (1.4) for a batch of new features; use a patch number
 * (1.3.2) for small changes and fixes, grouping them rather than bumping for each one.
 */
export const CHANGELOG: { version: string; title: string; date: string; changes: string[] }[] = [
  {
    version: '2.1.9',
    title: 'Welcome card fix',
    date: '2 Nov 2026',
    changes: [
      'Fixed: the welcome card no longer pops up on every reload. Logged-in players never see it; newcomers see it once, and logged-out players get the short sign-up reminder at most once a day.',
    ],
  },
  {
    version: '2.1.8',
    title: 'Fewer net tumbles',
    date: '2 Nov 2026',
    changes: [
      'Far fewer tumbling net shots: a net shot only tumbles now if it’s perfectly timed and skims the tape by under 3 cm (it used to be any timing within 12 cm). Before, about half of all net shots tumbled; now it’s about 1 in 10.',
    ],
  },
  {
    version: '2.1.7',
    title: 'Welcome for newcomers',
    date: '2 Nov 2026',
    changes: [
      'Welcome card for newcomers: after picking your controls, a big Take the 1-minute tour button, plus Sign up, Log in or Play as a guest. The Take the tour link also shows a New? Start here badge until you’ve taken it.',
      'Coming back while logged out: a short Save your progress card suggests signing up (with Don’t show this again). Logged-in players never see it.',
    ],
  },
  {
    version: '2.1.6',
    title: 'Challenges and replays online',
    date: '2 Nov 2026',
    changes: [
      'Hawk-Eye challenges online: line judges can miss close calls again, and whoever a close call goes against can press H to challenge. Both players watch the review, and an overturned call fixes the score on both screens (2 failed challenges per game). Ranked results wait for any challenge before they’re saved.',
      'Replays online: press R between points to watch the last rally. If the other player serves while you’re watching, the replay ends so you don’t miss it.',
      'A moment to get ready: after each point online, the server has to wait a couple of seconds before serving. A countdown shows for both players.',
    ],
  },
  {
    version: '2.1.5',
    title: 'No more net mashing',
    date: '2 Nov 2026',
    changes: [
      'Swings are a commitment: after a miss you can’t swing again for almost half a second (a quarter of a second after a hit), so mashing the key leaves you stuck recovering when the shuttle arrives. Time your swing instead.',
      'Lifts beat net-campers: lifts played near the net climb steeper, out of jump reach of a player standing at the net, and still land deep.',
      'No more smashing a shuttle that’s already behind your head: you can only scramble it back as a weaker, less accurate clear. Move back and get under it to attack.',
      'Touching the net is a fault, carefully: only a hard shot hit from right on top of the net can do it (the closer you are, the likelier). Gentle net shots never count.',
      'Tight net shots tumble: a net shot that skims the tape spins over it and is very hard to net back or hit hard, so you’ll usually have to lift it.',
      'The back court pays off: drops land shorter and skim the tape, perfectly timed clears go deeper and straighter, and hitting from deep in your own back court costs you power and accuracy. Perfectly timed smashes from the back are only slightly stronger.',
    ],
  },
  {
    version: '2.1.4',
    title: 'Updated tour',
    date: '2 Nov 2026',
    changes: [
      'Take the tour is up to date: new stops for your controls, Court 4 (quick match and private rooms), the Social screen with your stats, and the help links at the bottom. It opens Social to show you around and tidies up when it ends.',
    ],
  },
  {
    version: '2.1.3',
    title: 'Choose your controls',
    date: '2 Nov 2026',
    changes: [
      'Pick your controls first: the first time you open the game, a How do you want to play? screen lets you choose Keyboard + mouse, Keys + trackpad or Keyboard only, with the keys for each.',
      'A Controls button at the top of the start screen shows how you’re playing and lets you switch any time.',
    ],
  },
  {
    version: '2.1.2',
    title: 'Social and career stats',
    date: '2 Nov 2026',
    changes: [
      'Social: a big new screen (the Social button at the top of the start screen, or your name once you’re logged in) with your stats, friends, the leaderboard, your ranked matches and your account.',
      'Career stats from every finished match against the CPU or online: fastest smash, longest rally, best and current win streak, matches, wins and win rate, games, points, winners, aces, smashes, jump and perfect jump smashes, net kills, errors, perfect-timing rate, Hawk-Eye challenges, time on court and more.',
      'Stats are saved to your account when you’re logged in (so they follow you), or on this computer when you’re not.',
      'Tidier start screen: the keyboard shortcuts line is gone, How to play and Take the tour are on the left, and What’s new is on the right.',
    ],
  },
  {
    version: '2.1.1',
    title: 'Leaderboard link',
    date: '2 Nov 2026',
    changes: [
      'Leaderboard link at the bottom of the start screen: see the top 50 ranked players without logging in (your row is highlighted when you are).',
    ],
  },
  {
    version: '2.1',
    title: 'Quick match, ranking and friends',
    date: '2 Nov 2026',
    changes: [
      'Quick match (Court 4): one press finds an opponent online near your rating. The range widens the longer you wait, and you can cancel any time. Ranked matches are 1 game to 21, start by themselves, and you need to be logged in to play them.',
      'Ranking: everyone starts at 1000. Beating someone stronger earns more, and forfeits and drop-outs count as losses. Tiers: Bronze, Silver, Gold, Platinum and Champion. The end screen shows your rating change, and Enter finds your next match.',
      'Player hub (click your name at the top when logged in): your rating, tier and record, your last 20 ranked matches, Friends and the top-50 Leaderboard.',
      'Friends: add someone by username, accept or decline requests, see who’s online, and Invite them into a private room. They get a pop-up with a Join button.',
      'Less lag weirdness online: the shuttle no longer touches the floor before the other player’s hit arrives. It plays a touch slower on their side, hovers near the floor if it has to, and glides onto the real path instead of jumping.',
      'Clearer connection info: the lobby shows each player’s connection, the readout in the match says whose connection is causing lag, and game servers are now kept in Asia.',
      'Results are saved by the game server (not players’ computers), so a ranked win can’t be faked from the browser. Private rooms stay unranked.',
    ],
  },
  {
    version: '2.0.2',
    title: 'Shorter changelog',
    date: '2 Nov 2026',
    changes: [
      'What’s new has a Short / Full switch. Short shows one line per update, Full shows every change. It remembers your choice.',
    ],
  },
  {
    version: '2.0.1',
    title: 'Skyline Smash',
    date: '2 Nov 2026',
    changes: [
      'The game is now called Skyline Smash. Your settings, account and keys carry over, and badmintongames.site still brings you here.',
    ],
  },
  {
    version: '2.0',
    title: 'Play online',
    date: '2 Nov 2026',
    changes: [
      'Play online: Court 4 on the start screen. Create room gives you a 5-character code and an invite link to send a friend; they press Join (or open the link) and the host presses Start match.',
      'Each player sees themselves on the near side. Your own movement and hits are instant on your screen, and the shuttle flies identically on both screens, so fast smashes stay smooth even with some lag.',
      'The host picks 1 game or best of 3, to 15 or 21. Rematch: both press Enter at the end.',
      'Quick chat with keys 1–6 (Good shot!, Nice rally, Unlucky, Ready?, GG, Thanks!) shows over your player on both screens. There’s no free typing.',
      'The connection readout at the top shows the delay between you and turns amber or red if it gets laggy.',
      'Dropped connection: it reconnects on its own and play waits. If someone doesn’t come back within a minute, the other player wins. Esc pauses between points (Q while paused forfeits).',
      'Rooms are private (only people with the code can join), usernames with offensive words aren’t allowed, and online line calls are always correct (there are no challenges online yet).',
    ],
  },
  {
    version: '1.7.1',
    title: 'Tour and easier usernames',
    date: '2 Nov 2026',
    changes: [
      'Take the tour: a new button at the bottom of the start screen walks you through your match, the match card, tutorial, practice, Assists & controls, your keys, your account and more, one thing at a time. Use Next or Enter to go forward, Back or ← to go back, and Esc to leave.',
      'Easier usernames: spaces become underscores automatically (“Barry Zhang” becomes “barry_zhang”), and the box shows what your username will be, or why it won’t work, as you type.',
    ],
  },
  {
    version: '1.7',
    title: 'Player accounts',
    date: '2 Nov 2026',
    changes: [
      'Player accounts: press Log in at the top right of the start screen and pick a username and passcode. Use Sign up the first time and Log in after that.',
      'You stay logged in on that browser. Your settings and key binds are saved to your account and load on any computer you log in on.',
      'Change passcode and Log out are in the same dialog. There’s no email, so a forgotten passcode can’t be reset.',
      'Playing without an account works exactly as before, and the account code only loads when you use it, so the game starts just as fast.',
    ],
  },
  {
    version: '1.6.4',
    title: 'Serves, jump smashes and challenges',
    date: '2 Nov 2026',
    changes: [
      'Better serve animation: the server holds the shuttle out with their free hand, racket drawn back (forehand in singles, backhand in doubles), then swings through and follows up and forward.',
      'Perfect jump smash: hit at the very top of your jump with the swing timed inside a tight window for extra pace (about 380 km/h instead of 340) and a PERFECT JUMP callout. Players only.',
      'The CPU challenges again: it challenges calls that look wrong, and sometimes gambles on tight ones, especially on big points. Easy is reckless, Expert is picky and usually right.',
      'Line judges miss more close calls (within about 12 cm of the line), so challenges are worth making.',
      'Assists now start off except the landing marker: timing light, swing assist, auto-switch and umpire voice are off by default (reset once for everyone; turn them back on in Assists & controls). The tutorial still shows the timing light.',
    ],
  },
  {
    version: '1.6.3',
    title: 'Change your keys',
    date: '2 Nov 2026',
    changes: [
      'Change any key under Assists & controls → Controls → Your keys: click an action, then press the new key. Taking a key another action uses swaps the two, and Reset to defaults puts everything back.',
      'Keys that would clash are refused with a reason: the game’s own keys (H, R, F, M, G, V, Q, Enter, Esc, 1–9), and movement keys for aiming.',
      'The shot table, on-screen hints, serve prompt and tutorial all show your keys. Two players on one keyboard keep the standard keys.',
    ],
  },
  {
    version: '1.6.2',
    title: 'Physics page first',
    date: '2 Nov 2026',
    changes: [
      'badmintongames.site now opens on the Air Physics Revision page. The game is at badmintongames.site/play, or use Badminton simulator in the ☰ menu.',
    ],
  },
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
