# Hand-off

*Session of 2026-11-07 (third). Replaces any earlier note.*

## Repo state
- Work is on `m3-hands-and-combat` (pushed to origin, not merged). `main` is still milestone 2 and is what Pages serves.
- `npm test` passes (desktop + phone), including new checks for the lever, axe, stomp, kill splats and the AXE/STOMP buttons.
- Sign-off = merge the branch into main, push, delete the branch (see the global working agreement).

## What was built
1. **Fixes:**
   - **Rocks:** one packed 2048 atlas, a better normal map, plus a tiling stone grain in the game.
   - **Night:** brighter (numbers in `Config.night`).
   - **Windows:** the darkening is removed.
   - **Flashlight:** now on Q.
2. **Blender generators** (`blender/generators/rifle.py`, `hands.py`, `axe.py`) with shared helpers in `blender/lib/common.py`:
   lofts, metaball hands, procedural walnut, blued steel, leather and canvas, one baked atlas per family with metalness.
   Every pivot and grip lives in `assets/params/*.json`, which the game reads too.
3. **First-person view** (`js/player/ViewModel.js`):
   - Poses: hip, aimed and sprint.
   - The lever cycle: the hand rides the lever, the hammer cocks, a spent case flies out.
   - The reload: the rifle turns gate-up and the left hand feeds the rounds in one by one.
   - The axe swing: keyframes, with the arm turned towards the shoulder.
   - Fallback models in code.
4. **Weapon** (`Weapon.js`):
   - 0.5 s lever, damage 40.
   - Sideways recoil, a fire press buffered near the end of the cycle, a stronger room flash.
5. **Melee** (`js/player/Melee.js`): the axe on F and the stomp on V, with window and glass rules, and touch buttons.
6. **Feedback** (`js/fx/Gore.js`, `SpiderAI.js`, `SpiderRig.js`):
   - Body or leg hit zones.
   - Knockback, a body jolt and a leg kick.
   - Brutes stagger.
   - Spray and splats, including on the glass.
   - A death thrash before the curl, and a kill crunch.
   - Hits push the view away from the attacker.
7. **Sounds:** leverCycle, caseTink, roundInsert, axeSwing, axeChop, stomp, stompSquish, spiderKill, and a heavier gunshot.

## Read first
`CLAUDE.md`, `STATE.md`, `SPEC.md`, `DECISIONS.md` (14 new lines), `blender/README.md` (new families and budgets).

## Known weak spots
- **Stomp:** from the eye you mostly see the trouser leg; the boot's toe hides behind the shin.
- **Reload:** the pose is dark at the table and the feeding hand is hard to read.
- **Aimed:** the right sleeve still takes a fair share of the lower right.
- **Hands:** made of metaballs, so they read as gloves rather than detailed hands. Good enough with gloves, but the user may
  want to sculpt them: export to `blender/source/hands.glb`, keeping the mesh names.

## Open questions for the user
See STATE.md "Open with you".
