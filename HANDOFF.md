# Hand-off

*Session of 2026-11-15 (survival plan condensed, S1 first day). Replaces any earlier note.*

## Repo state
- `claude/survival-first-day` merged into `main` and pushed (user: "when you are done merge and push"); branch deleted.
- `npm test` passes on desktop and phone, with four new Survival checks (door, walking out, unpacking, Waves keeps
  the door boarded). `node tests/fistbot.mjs 1` survives wave 1 in Waves mode.
- Checked headless: day, dusk, night and dawn screenshots; the door; a tree stopping you; picking up and unpacking;
  a runner hunting you outside and going back to its lane when you go in. Not played by hand.

## Read first
1. `STATE.md` (open questions come first).
2. `SURVIVAL.md` (four steps now; S2 is next).

## What was built
- `js/survival/Survival.js`: Survival's rules beside `Game.js` (door, outside, prompts, unpacking, the clock text).
- `js/survival/DayCycle.js`: day → dusk → night (the waves) → dawn → next day; drives `Lighting.setDaylight`.
- `js/survival/Pickups.js`: branches, ammo tins, yarrow; a pack; scattered fresh each morning.
- `js/world/Obstacles.js`: trunks, rocks, logs, shed as circles/capsules in a grid; filled by `Forest.js`.
- `Cabin.js`: the door leaf hangs on a pivot; its boards are a separate group (shown only in Waves).
- `Player.js`: `canLeave`, ground height outside, the doorstep, the 58 m leash, `footForest` steps.
- `SpiderAI.js`: a `hunt` state for spiders on the ground when you are outside at night.
- `WaveSystem.js`: `lastWave` and `nextNight()`; `waveEnd` now says `nightOver`; `last` means the run is over.

## Known weak spots
- Spiders already inside when you go out stay inside; none come in through an open door.
- The door leaf is solid only when fully open or shut; while it swings you can pass through it.
- Same night ambience by day (wind, rain); no birds or day sounds yet.
- The stove burns down during the day; you relight it at dusk (maybe right, maybe not).
- Placeholder pickup meshes; the cabin outside was fine at a glance but not looked at closely.
- `Game.js` is still over 600 lines; Survival's rules now live in `js/survival/`.
- The user does not want balance bots or difficulty tuning proposed.
