# Signature abilities: for review before release

30 abilities. **Sheet** = the numbers come from your roster sheet (used exactly). **New** = the sheet had flavour text
only, so I chose numbers on the same scale (S up to 12%, SS up to 15% of one thing, with a cooldown). Please approve or
change any of these: they live in `data/signatures.json`.

Where abilities apply: career matches and the daily challenge. Off in ranked and friendly (`signaturesInRanked = false`).
None of them change net-fault rules or the net-kill/net-spin thresholds; net abilities only change accuracy or the
timing window. Smash boosts and cuts stay inside the career smash limits (−5% to +10%).

| Ability | Tier | Fires on | Changes | Size | Lasts | Cooldown | Numbers | In plain words |
|---|---|---|---|---|---|---|---|---|
| Counterstrike | S | perfectDefence | shotSpeed | 5% | that shot | 4 s | sheet | A perfectly timed defensive shot goes 5% faster. |
| Relentless Pursuit | S | retrieve | move | 8% | 3 s | 8 s | sheet | After a successful retrieval, 8% faster movement for 3 seconds. |
| Iron Formation | S | block | oppSmash | 10% | 2 s | 8 s | sheet | After a successful block, the opponent’s smashes are 10% slower for 2 seconds (never below the game’s smash floor). |
| Last Stand | S | lowEnergy | energyUse | 12% | that shot | none | sheet | Below 20 energy, matches use 12% less energy. |
| False Opening | S | deceptive | deceive | 7% | that shot | 3 s | sheet | Drops, net shots and flicks have a 7% better chance of wrong-footing the opponent. |
| Silk Touch | S | net | netAim | 12% | that shot | none | sheet | Net shots are 12% more precise. |
| Net Dominance | S | netWin | nextAttack | 10% | that shot | 10 s | sheet | After winning a point at the net, the next attacking shot is 10% faster (smashes stay within the game’s limit). |
| Phantom Rhythm | S | alternate | deceive | 9% | that shot | 4 s | sheet | Changing shot type from your last shot gives a 9% chance of wrong-footing the opponent. |
| Early Pressure | S | early | shotSpeed | 8% | that shot | 5 s | sheet | Attacking shots taken early (within 0.6 s of the opponent’s shot) are 8% faster. |
| Unbreakable Guard | S | block | oppNextSmash | 10% | that shot | 8 s | sheet | After a successful block, the opponent’s next smash is 10% slower (never below the game’s smash floor). |
| Crosscourt Flick | S | crosscourtLift | deceive | 10% | that shot | 5 s | new | A crosscourt lift or flick has a 10% chance of wrong-footing the opponent. |
| Late Drive | S | drive | shotSpeed | 8% | that shot | 6 s | new | Drives are 8% faster. |
| Falcon Counter | SS | counterSmash | shotSpeed | 12% | that shot | 8 s | new | Returning a smash with a drive or push makes it 12% faster. |
| Backcourt Clear | S | clear | aim | 10% | that shot | none | new | Clears are 10% more accurate. |
| Angle Slice | S | drop | aim | 10% | that shot | none | new | Drops land 10% closer to where you aim. |
| Feather Touch | S | net | netAim | 10% | that shot | none | new | Net shots are 10% more precise. |
| Net Thread | S | net | netTiming | 10% | that shot | none | new | A 10% wider perfect-timing window on net shots (net rules and tumbling are unchanged). |
| Phantom Drop | SS | drop | deceive | 15% | that shot | 5 s | new | Drops have a 15% chance of wrong-footing the opponent. |
| Thunder Rebound | SS | smash | smash | 8% | that shot | 6 s | new | Smashes are up to 8% faster (within the game’s smash limit). |
| Silent Crossfire | SS | crosscourtAttack | deceive | 12% | that shot | 5 s | new | A crosscourt smash or drive has a 12% chance of wrong-footing the opponent. |
| Steady Lift | S | lift | defenceDepth | 12% | that shot | none | new | Lifts are 12% more accurate in depth. |
| Quickfire Smash | S | smash | smash | 6% | that shot | 6 s | new | Smashes are up to 6% faster (within the game’s smash limit). |
| Tempest Clear | SS | clear | oppMove | 12% | 1.2 s | 8 s | new | After a clear, the opponent moves 12% slower for 1.2 seconds. |
| Vortex Net Trap | SS | net | netAim | 15% | that shot | none | new | Net shots are 15% more precise (net rules and tumbling are unchanged). |
| Mirage Switch | SS | crosscourt | deceive | 12% | that shot | 5 s | new | Any crosscourt shot has a 12% chance of wrong-footing the opponent. |
| Burst Return | S | retrieve | swingWait | 10% | 2 s | 8 s | new | After a successful retrieval, 10% quicker recovery between swings for 2 seconds. |
| Razor Drop | S | drop | aim | 12% | that shot | none | new | Drops are 12% more accurate. |
| Ghostline Drive | SS | drive | aim | 15% | that shot | none | new | Drives are 15% more accurate. |
| Phantom Cascade | SS | crosscourtDrop | deceive | 15% | that shot | 5 s | new | A crosscourt drop has a 15% chance of wrong-footing the opponent. |
| Halo Tumble | SS | net | netTiming | 15% | that shot | none | new | A 15% wider perfect-timing window on net shots (net rules and tumbling are unchanged). |

Triggers in plain words: perfectDefence = a perfectly timed lift/block/defensive clear; retrieve = returning a smash
or a shot you had to lunge for; block = returning a smash with a block or lift; lowEnergy = starting a match below 20
energy; deceptive = a drop, net shot or flick; netWin = winning a point with a net shot or net kill; alternate = a
different shot type from your last one; early = an attacking shot within 0.6 s of the opponent's; crosscourt… = the
shot crosses the court.

Simulation results: see docs/3.0-notes.md (simulation 5).
