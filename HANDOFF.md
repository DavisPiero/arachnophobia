# Hand-off

*Session of 2026-11-15 (horror rework, session A). Replaces any earlier note.*

## Repo state
- Branch `claude/horror-a` merged into `main` and pushed (user pre-approved "merge and push when done").
- `npm test` passes (desktop + phone, 72 s). `node tests/brightness.mjs` passes with the new outside check.
- `node tests/fistbot.mjs`: survives waves 1–2, health 64 at the end (baseline before: 100). Windows now hold
  97–240 s against a bot that does not fight at the windows.
- `node tests/locomotion.mjs` fails its pop limit, as it did before this session (0.87% → ~1.0%; knees 0.37% → 0.30%).
- Not played by hand.

## Read first
1. `STATE.md` (open questions come first).
2. `SPEC.md` "Second iteration" 7 (sessions B–F).

## What was built
- `WindowSystem.js` rewritten: no glass, `WC.boards` planks outside (`BOARD_Z`), per-plank health, `stage` = planks
  gone (4 = breached), `gapAt()` for later grab-through. `windowDamaged` carries `before`.
- `SpiderCollision.js`: plank boxes per window (surface 'glass', solid while `blocked(id)`), attic/overhang solid
  (`underRoof`). `SpiderRig.js`: `_clips()` checks joints 1–4; fold tried in the same frame; `air` pose for leaps.
- `SpiderAI.js`: `startLeap/updateLeap` (state 'leap'), leap choice in `updateInside`, quick first attack, strike
  carries the body; `SpiderManager.updateLinger/windowJump` (`Config.linger`). `Behaviour.js`: `startAttack({inside})`,
  `crouchHold`, shorter stops near the player.
- `Weapon.js`: a plank in the ray blocks the shot when the spider is outside. `Melee.js`: no glass hits.
- `SpiderModel.js`: fill light per spider (`visual.fillK`, set each draw); `Config.render.spiderFillOutside`.
- `css/style.css`: `#hint` at the top.

## Known weak spots
- Spider legs reach through the gaps into the room, and some leg segments pass through planks (not checked by a test).
- The flashlight makes a hard bright disc on planks at arm's length.
- Waves run long (wave 1 took 243 s in the bot) because spiders sit at windows longer; boarding up (C) and the
  player punching through gaps should change this. Check after C.
- Shotgun and flare are still code-made.
