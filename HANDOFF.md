# Hand-off

*Session of 2026-11-07 (fifth). Replaces any earlier note.*

## Repo state
- `main` includes this session's work. It came from branch `m4-spiders`: merged, pushed, then deleted. The user
  signed off ahead of time ("when you're done merge and push automatically").
- `npm test` passed before the merge.

## Read first
1. `STATE.md`: the open questions, and ask them first.
2. `SPECIES.md`: the nine species; five of them are still guesses.
3. `SPEC.md`: new controls, 9 × 12 m cabin, burst deaths, squeeze. `DECISIONS.md`: the last 13 lines.
4. `blender/README.md`: the spiders family.

## What was built
- **Cabin** 9 × 12 m, 3 m ceiling. Windows, door, table, lamps, routes, terrain and furniture moved with the walls.
  Furniture is now in `Layout.js` `FURNITURE`.
- **Weapon switch** (`Weapon.js` `held`/`want`/`drawK`, `ViewModel.js` `AXE_IDLE`):
  - 1 rifle, 2 axe; the held axe rests up on the right and click swings it.
  - F is gone; stomp is on C.
  - Touch: the AXE button swaps and shows the other weapon's name.
- **Burst deaths** (`js/fx/Chunks.js`): two instanced meshes with a per-instance fade. Leg pieces come from the
  spider's bones at the moment of death.
- **Spider generator** (`blender/generators/spiders.py`, `assets/params/spiders.json`):
  - one skinned mesh per species on the game's 58 bones, with joints weighted smoothly;
  - CC0 scans with mottling, speckles, bands, belly and joints from a `reg` vertex attribute;
  - it writes `spider_<species>.glb` and a `.json` with the layout and rest frames.
  - `tools/assets.mjs` now supports a family with several outputs (`outputs` in the params file).
- **Loading** (`SpiderModel.js` `loadSpiderModels`): the game rebuilds the skeleton from the `.json` rest frames.
  `Assets.js` recovers a skinned mesh's real positions from its bind data, because meshopt compression puts the
  position offset there.
- **Rig** (`SpiderRig.js`):
  - feet land on the real ground (`ground` function from the AI);
  - the body lifts and tilts with its feet;
  - `gait: 'wave'` steps one leg at a time (the brute);
  - squeeze mode: each leg grips the window frame on the side of the wall it reaches for (`_grips`).
- **Window entry** (`SpiderPaths.js` `enterPath`, `SpiderAI.js`): segments flagged `squeeze` move at
  `Config.spiders.<type>.squeezeSpeed`.

## What went badly (be honest with the user about this)
- **Stance:** the first spider build stood like a harvestman (knees far above the body). The old code-made spiders
  had the same leg ratios. I flattened it in the params.
- **Sleeves:** the 10° forearm change barely shows when aiming. The sleeves are still big in the lower middle.
- **Too dark to judge:** the Blender preview lighting is dim, so the renders undersell the colours. The brute's plate
  reads bone-white in the game under the flashlight, but dark grey in the renders.

## Known weak spots
- **Hair:** there are no real hairs on the spiders, only a bump pattern. The runner reads smooth up close.
- **Sideways legs:** the climber's legs do not bend sideways like a real huntsman's; the rig only bends legs in the
  vertical plane.
- **Squeeze:** grips are fixed points beside the opening, and long legs can cross through the window hole. The body
  narrows by scaling, not by real deformation.
- **Climbers:** paused mid-window before; that is fixed (no random pauses while squeezing) but not re-checked.
- **Phones:** the spiders were not checked on the low tier (the `_lod1` meshes) in the real game, only in tests.
- **Spec:** the four species use the old behaviours; species behaviours are the next milestone 4 step.

## Testing rules (from the user)
- Keep tests cheap: `npm test` in the background, do not poll.
- Read at most one or two screenshots per change.
- The game is too dark to judge models: use the Blender renders (`blender/build/spider_*`) or `dev/spiders.html`.
