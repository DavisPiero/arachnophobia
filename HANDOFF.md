# Hand-off

*Session of 2026-11-07 (second). Replaces any earlier note.*

## Repo state
- `main` is the only branch, clean, pushed. Milestone 2 is signed off and live at https://davispiero.github.io/arachnophobia/.
- `npm test` passed locally and against the live site after the last code change.

## Read first
1. `CLAUDE.md` (hard rules changed: assets come from Blender generators or hand-made files, with code fallbacks)
2. `STATE.md`, `SPEC.md` (roadmap for milestones 2–6), `DECISIONS.md`
3. `blender/README.md` (how the pipeline works, budgets, hand-editing)

## What was built last session
- Blender pipeline: `npm run assets` → background Blender → bake high→low → WebP/meshopt → `assets/models/*.glb`.
  First family: rocks (8 variants, 650/180 tris, one shared atlas). `js/core/Assets.js` loads them; Forest swaps them in.
- Second lamp (west wall, north end), brighter lantern, near-black night fog, windows much less dark from afar.
- Flashlight (T / LIGHT), sprint (Shift / joystick past the edge), aim down sights (right mouse / AIM), runners 1.4x bigger,
  phone zoom guard (`js/input/NoZoom.js`). Model viewer at `dev/assets.html`.

## What comes next
1. **Rock textures are blurry (user's note).** Likely causes: 8 variants share one atlas that is shrunk to 1024 px in the game
   (about 300 px per rock), Smart UV Project cuts each rock into many small islands, and WebP compression softens the normal map.
   Likely fix: a larger atlas (2048) with fewer, bigger UV islands, higher-quality normal maps, and a tiling detail texture
   blended on top for close-up sharpness. Check close up in `dev/assets.html?model=rocks` and in the game.
2. **Milestone 3:** hands and arms plus a lever-action rifle and an axe as Blender generators with armature animations.
   Axe on F (F currently also means "interact": move interact to E only), stomp on V, recoil, sway, directional shake,
   muzzle flash with light, blood by hit location, new combat sounds. Give the weapon a higher texture budget than rocks:
   it is always on screen.

## Open questions for the user
1. Is the night too dark now, especially the east clearing where spiders should be visible from far away?
2. Is the second lamp in the right place (west wall, north end)?
3. Flashlight on T and unlimited sprint: OK?
4. Does double-tap still zoom on a real phone?

## Testing rules (from the user)
Keep tests cheap: `npm test` in the background, do not poll, read at most one or two screenshots per change.
