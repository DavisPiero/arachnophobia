# Hand-off

*Session of 2026-11-07 (fourth). Replaces any earlier note.*

## Repo state
- `main` includes this session's work. It came from branch `m3b-viewmodel-art`: merged, pushed, then deleted.
- `npm test` passed before the merge (desktop + phone, 174 s).

## Read first
1. `CLAUDE.md`:
   - the asset rule now allows CC0 scanned textures;
   - new commands and check tools.
2. `STATE.md`, `SPEC.md` (new "First-person body" section; splats now fade), `DECISIONS.md` (the last 9 lines).
3. `blender/README.md` (new budgets, materials, check tools), `blender/textures.md` (texture sources and licences).

## What was built
- **Materials** (`blender/lib/materials.py`):
  - CC0 scans from ambientCG, projected along each part, re-tinted from the params;
  - bump detail: checkering, stitching, ribs;
  - worn edges and dirt.
- **Rifle** (`rifle.py`), after the side-gate reference:
  - receiver from a profile, with boolean cuts (ejection port, loading gate);
  - round barrel, closed big-loop lever, checkered walnut, rubber butt pad, sights, screws.
- **Axe** (`axe.py`): forest-axe head with a bright ground edge; S-curved hickory handle.
- **Hands** (`hands.py`):
  - one hand skeleton, bent per pose;
  - fingers wrap the real held shape and are pressed out of it;
  - fused glove with panels and seams, hard knuckle guard;
  - separate jacket sleeves.
  - The trigger hand follows `reference/m4-rifle-hold.png`; the support hand follows the user's description.
- **Legs** (`legs.py`, `js/player/Legs.js`):
  - cargo trousers, lace-up boots, belt, the bottom of the jacket;
  - the body stands 0.24 m behind the eye and the legs swing when walking.
  - The stomp boot now comes from `legs.glb`.
- **Pipeline:** phones load `<name>_low.glb` (half-size textures), handled in `Assets.js` and `tools/assets.mjs`. The
  rifle's hip position now lives in `rifle.json` `view` (values unchanged).
- **Splats:** dark red, fading after 3 s + 2 s (`Config.gore.splatHold`, `splatFade`).

## What went badly (be honest with the user about this)
- **The hand poses took many rounds**, and the user was rightly frustrated. Two causes:
  - I reasoned the grips from geometry instead of copying the reference photos;
  - for a while I changed the gun position when the user had said the arms were wrong.
- **For any future pose work:** get a reference photo, match it, check it from the side with
  `blender/tools/viewmodel.py` (`VM_EYE`), and run `clipcheck.py` before showing the user.

## Known weak spots
- **Aiming:** the sleeves come up large in the lower middle of the screen.
- **Legs:** the cargo pockets are plain bevelled boxes, and the legs only swing at the hip (no knee bend).
- **Loading hand:** the pinch pose was not checked in the reload against the rifle.
- **Spent cases:** the cartridge model is new, but the ejection was not re-checked.
- **Screenshots:** `node tools/shot.mjs` at high quality times out headless (also with `assets=0`, so not the new
  models): the free-running loop is too slow in software WebGL. Use `&quality=low` with it, or `tools/poses.mjs`, which
  steps the game frame by frame.

## What comes next
Milestone 4 (see `STATE.md`). Ask the user first about the open questions in `STATE.md`.

## Testing rules (from the user)
- Keep tests cheap: `npm test` in the background, do not poll.
- Read at most one or two screenshots per change.
- The game is too dark to judge models: use `blender/tools/viewmodel.py` for that.
