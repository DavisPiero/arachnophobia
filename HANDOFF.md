# Hand-off

*Session of 2026-11-07 (third). Replaces any earlier note.*

## Repo state
- `main` is the only branch: clean, pushed, and it includes milestone 3 (signed off).
- `npm test` passed on main after the merge (desktop + phone, 147 s).

## Read first
1. `CLAUDE.md` (a new tool, `tools/poses.mjs`, and the `assets=0` switch)
2. `STATE.md`, `SPEC.md` (pillar 1 rewritten: windows are always clear; weapon section rewritten), `DECISIONS.md`
3. `blender/README.md` (new rifle, hands and axe families; shared GAME-space coordinates; budgets)

## What was built last session
1. **Fixes:**
   - **Rocks:** one packed 2048 atlas, a better normal map, plus a tiling stone grain in the game.
   - **Night:** brighter (numbers in `Config.night`).
   - **Windows:** the darkening is removed.
   - **Flashlight:** now on Q.
2. **Blender generators:** `blender/generators/rifle.py`, `hands.py` (metaball gloves, sleeves, boot) and `axe.py`.
   Pivots, grips and colours live in `assets/params/rifle|hands|axe.json`, which the game reads too.
3. **First-person view** (`js/player/ViewModel.js`):
   - The lever cycle and the spent case.
   - The round-by-round reload.
   - The axe swing (keyframes) and the boot for the stomp.
   - Code-made fallbacks.
4. **Melee** (`js/player/Melee.js`): the axe on F and the stomp on V. **Feedback** (`js/fx/Gore.js`, `SpiderAI.js`, `SpiderRig.js`):
   - Hit zones, knockback, a body jolt and a leg kick.
   - Brutes stagger.
   - Spray and splats.
   - A death thrash and a kill crunch.
5. **Eight new sounds**, a heavier gunshot, and AXE and STOMP touch buttons.

## What comes next
1. **The user's notes on the gloves, the gun and the axe.** Ask for them first.
   - Most look changes are parameter edits in `assets/params/*.json`, then `npm run assets <name>`.
   - Check every change with `node tools/poses.mjs`.
   - Pose positions (hip, aimed, reload, axe keyframes) are numbers in `ViewModel.js`.
   - If the user starts nudging positions by hand over several rounds, offer a way to place them themselves and save the
     result to data (global working agreement).
2. **Milestone 4:**
   - Nine species, written up in `SPECIES.md`.
   - A Blender spider generator.
   - Locomotion.
   - Spiders climbing in through the window frame, and spiders on the inside ceiling.

## Known weak spots (from my own review)
- **Stomp:** you mostly see the trouser leg; the boot's toe hides behind the shin.
- **Reload:** the pose is dark at the table and the feeding hand is hard to read.
- **Aimed:** the right sleeve takes a fair share of the lower right.
- **Hands:** metaballs, so they read as gloves rather than detailed hands.

## Open questions for the user
1. Notes on the gloves, the gun and the axe (promised for this session).
2. Guesses to confirm:
   - The ichor is pale yellow-green.
   - Splats stay until the next wave.
   - The hands are posed shapes, not skeletons.
3. Is the night bright enough now (the east clearing especially)?
4. Does double-tap still zoom on a real phone? (Only checked headless.)
5. Is the second lamp in the right place (west wall, north end)? Never answered.

## Testing rules (from the user)
Keep tests cheap: `npm test` in the background, do not poll, read at most one or two screenshots per change.
`tools/poses.mjs` is the cheap way to see every first-person pose in one run.
