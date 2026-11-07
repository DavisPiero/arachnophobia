# State

**Where we are:** the gloves, gun and axe notes are done and merged into main (branch `m3b-viewmodel-art`):
- **New models:** the rifle, axe, hands and sleeves are rebuilt with CC0 photo-scanned materials.
- **New body:** legs, boots and the bottom of the jacket now show when you look down.
- **Grips:** both hands follow the user's photos.
- **Splats:** red, and they fade after about 5 s.

GitHub Pages serves main.

**Next:** milestone 4: nine spider species (`SPECIES.md` does not exist yet; writing it is the first job), the Blender
spider generator, locomotion, and spiders climbing in through the window frame. The spider references are in
`reference/m4-spider-*.jpg`. They are mostly pale, gaunt and big-eyed, unlike the spec's "dark, tiny red eyes"; the user
agreed the spec should change to a mix.

**Open with you:**
- **Aiming:** both sleeves come up large in the lower middle of the screen. Make the forearms angle further down?
- **Check by eye in the real game:**
  - the hands, rifle, axe and legs under the lantern;
  - the look-down view (`?debug=1`, look at your feet);
  - the stomp.
- **Old guesses, never answered:**
  - Is the night bright enough (the east clearing especially)?
  - Does double-tap still zoom on a real phone?
  - Is the second lamp in the right place (west wall, north end)?

**Tools:**
- `npm run assets` rebuilds the models (about 18 min at full size). `ASSET_FAST=1` gives a quick small bake for shapes.
- `node tools/fetch-textures.mjs` fetches the CC0 texture sets (needed once per machine).
- Blender checks:
  - `blender/tools/viewmodel.py`: a studio-lit first-person render;
  - `blender/tools/clipcheck.py`: does any hand pass through the rifle?
- `node tools/poses.mjs` screenshots every pose; there's a new `down` pose.
- `npm test` is the quick check (~3 min).
