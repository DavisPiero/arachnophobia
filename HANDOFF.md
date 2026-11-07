# Hand-off

*Session of 2026-11-07 (second). Replaces any earlier note.*

## Repo state
- `main` is the only branch: milestone 2 signed off, merged, pushed and live. The branch was deleted.
- `npm test` passed on the branch after the last code change.

## Read first
1. `CLAUDE.md` (hard rules changed: assets now come from Blender, with code fallbacks)
2. `STATE.md`, `SPEC.md` (roadmap for milestones 2–6), `DECISIONS.md`
3. `blender/README.md` (how the pipeline works, budgets, hand-editing)

## What was built
- Blender pipeline: `npm run assets` → background Blender → bake → WebP/meshopt → `assets/models/*.glb`. First family: rocks
  (8 variants, 650/180 tris, one shared atlas, 271 KB). `js/core/Assets.js` loads them; Forest swaps them in over the old rocks.
- Lighting: second lamp (west wall, north end), brighter lantern, near-black night fog, windows much less dark from afar.
- Flashlight (T / LIGHT), sprint (Shift / joystick past the edge), aim down sights (right mouse / AIM), runners 1.4x bigger,
  phone zoom guard (`js/input/NoZoom.js`).

## What comes next
- Milestone 3: hands/arms + lever-action rifle + axe as Blender generators with armature animations; axe on F (F currently also
  means "interact": move that to E only), stomp on V, combat feedback.

## Open questions for the user
1. Is the night too dark now, or right? Is the second lamp in the right place?
2. Flashlight on T and unlimited sprint: OK?
3. Does double-tap still zoom on a real phone?
4. Are the Blender rocks the right style before we make weapons and spiders this way?

## Testing rules (from the user)
Keep tests cheap: `npm test` in the background, do not poll, read at most one or two screenshots per change.
