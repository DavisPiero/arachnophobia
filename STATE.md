# State

**Where we are:** milestone 3 (gloved hands, lever-action rifle, axe, stomp, combat feedback), plus the session's fixes
(sharper rocks, a lighter night, no window darkening, flashlight on Q), is signed off, merged into main and pushed.
GitHub Pages serves main, so it should be live at https://davispiero.github.io/arachnophobia/.

**Next:** your notes on the gloves, the gun and the axe (you said they come next session), then milestone 4: nine spider
species (`SPECIES.md`), the Blender spider generator, locomotion, and spiders climbing in through the window frame.

**Open with you:**
- Guesses to confirm:
  - The ichor is pale yellow-green so it shows at night.
  - Splats stay until the next wave.
  - The hands are posed meshes, not animated skeletons.
  - The boot's toe mostly hides behind the shin.
- Look and feel:
  - Are the hands, sleeves and rifle the right darkness under the lantern?
  - Is the aimed rifle too big in the view?
  - Does the reload read?
- Is the night bright enough now (the east clearing especially)?
- Does double-tap still zoom on your real phone? (Since milestone 2, only checked headless.)

**Tools:**
- `npm run assets` rebuilds the Blender models: rocks, rifle, hands, axe.
- `node tools/poses.mjs` screenshots every first-person pose.
- Viewers: `dev/assets.html?model=rifle|hands|axe|rocks`, `dev/sounds.html` (new "Melee" group), `dev/world.html`.
- `?debug=1`: I spawns a runner inside, in front of you (try the stomp and the axe), K kills all, 1–4 spawn.
- `npm test` is the quick check (~2 min).
