# State

**Where we are:** second iteration, milestone 2 (Blender pipeline, lighting and darkness fixes, flashlight, sprint, aim down
sights, phone zoom fix) built on branch `m2-pipeline-and-feel`, pushed, **not merged**. Main is still milestone 1 and is what's live.

**Next:** you play the branch and sign off milestone 2. Then milestone 3: hands and arms, a lever-action rifle and an axe from
Blender, the axe on F, the stomp on V, recoil, sway, shake, muzzle flash, blood, combat sounds. Full roadmap in SPEC.md.

**Open with you:**
- Guesses to confirm: wall lamp on the west wall at the north end; flashlight on T; unlimited sprint; how dark the night is now.
- Does double-tap still zoom on your phone? Fixed in a headless phone test, not yet on a real device.
- Rocks are the only Blender asset so far. Look at them in `dev/assets.html?model=rocks` and say if the style is right
  before the pipeline makes weapons and spiders.

**Tools:** `npm run assets` (Blender → game), `dev/assets.html` (model viewer), `dev/spiders.html`, `dev/world.html`,
`dev/sounds.html`, `?debug=1` and `?assets=0` in the game. `npm test` is the quick check (~2 min).
