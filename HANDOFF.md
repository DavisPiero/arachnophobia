# Hand-off

*Session of 2026-11-09. Replaces any earlier note.*

## Repo state
- `main` includes this session's work, from branch `m4-spider-overhaul` (merged, pushed, deleted). The user signed off
  ahead of time ("when you are done merge and push automatically"), then said to skip the all-sizes score run.
- `npm test` passed (desktop + phone). `node tests/locomotion.mjs` was last run on medium only (see below).

## Read first
1. `STATE.md`: the open questions; ask them first.
2. `SPECIES.md`: species vs models, the five designs, how a model is made and how it moves.
3. `DECISIONS.md`: the last 11 lines.

## What was built
- **Quick fixes:** chunks are meat, gristle and shell only (no legs), higher-res and marbled (`Chunks.js`); windows
  1.32 × 1.2 m, centre 1.60 m (`Layout.js`); cracks redrawn as branching light-blue lines (`WindowSystem.js`);
  first-person legs and the stomp boot removed (files deleted; stomp still kills).
- **Locomotion** (`js/spiders/`): `LegIK.js`, `Gait.js`, `BodyDynamics.js`, `SpiderCollision.js`, `SpiderRig.js`
  rewritten on top of them. Squeeze: grips on the frame, body drops and rolls, only a soft abdomen squashes.
- **Models** (`blender/generators/spiders.py`, `assets/params/spiders.json` `models`): Knot, Sac, Flayed, Grinner,
  Weeper. New: abdomen shapes, growths, hairs, fleshy folds, lopsided legs, human mouths with teeth, black human eyes
  with lids, two face bones (60 bones total), translucency read by the game. 12–27k triangles, 2.6–3.4 MB each.
- **Species and sizes:** `Config.spiders.<species>.model`; new species `weeper`; `Config.sizes` + `SIZES`; waves pick sizes.
- **Behaviour** (`Behaviour.js`): personalities, reacting to being looked at, light and distance; four-beat attacks
  (lunge, flurry, slam, feint). Hits shove the player (`Player.damage`).
- **Tests:** `tests/locomotion.mjs` scores pops, reach errors and clipping; smoke test updated for 5 models, no boot.

## What went badly (tell the user plainly)
- **The models are not yet as horrifying as asked.** Silhouettes differ and the faces read, but the legs are still
  smooth tubes, the smiles are small at game distance, and the bodies render dark. The script reached its limit
  on faces; hand-sculpted faces would do better.
- **Squeeze still pops:** about 0.45% of joint-frames, mostly while squeezing (grips too close to the hip). The test
  limit is set just above that as a guard, not as a goal.
- **First bake was 40–70k triangles** (hairs counted per leg); fixed, rebaked.
- **Not done:** climbing inside walls and the ceiling (collision supports it, no routes yet); tear streaks on the
  Weeper; a face on the Flayed's back.

## Known weak spots
- The locomotion score was not run for small and large after the final bake (user said skip).
- Behaviour was tested by fast-forwarding 90 s headless (attacks, breaches, damage), not played by hand.
- Phones: low tier loads the `_low` files; not checked on a real phone.

## Testing rules (from the user)
- Keep tests cheap: `npm test` in the background. Read one or two screenshots per change.
- The game is too dark to judge models: use `blender/build/spider_*` renders or `dev/spiders.html?type=…&size=…`.
