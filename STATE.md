# State

**Where we are:** milestone 4, spider overhaul merged into main (2026-11-09):
- **Five species, five models, three sizes:** runner/Knot, brute/Sac, climber/Flayed, stalker/Grinner, weeper/Weeper
  (`SPECIES.md`). Species and models are separate (`Config.spiders.<species>.model`).
- **Locomotion rebuilt:** `LegIK`, `Gait`, `BodyDynamics`, `SpiderCollision`. Feet land on real surfaces; knees fold
  away from walls; the body sags and leans. Scored by `node tests/locomotion.mjs`.
- **Behaviour:** per-species personalities (`Behaviour.js`); attacks in four beats (wind-up, lunge/flurry/slam/feint,
  impact with a shove, recovery).
- **Quick fixes:** chunks without legs, windows 1.2× and higher, light-blue branching cracks, no first-person legs.

GitHub Pages serves main.

**Next:**
- The user's notes on the five models and how they move (the faces especially).
- Squeeze pops (see Known weak spots in `HANDOFF.md`), inside-wall and ceiling routes, milestone 5 horror.

**Open with you:**
- **The faces:** smiles and black eyes are made by script. Good enough, or do you want to sculpt the Grinner's and
  Weeper's faces by hand in `blender/source/`?
- **Sizes:** small 0.62×, large 1.45×. A large Sac is about 4 m across. Right?
- **Squeeze speed** (unchanged from before: ~5 s for a big one). Too long, too short?
- **Old, never answered:** sleeves when aiming; dark far ends of the room; is the night bright enough; phone double-tap.

**Tools:**
- `npm run assets spiders` rebuilds the models (`SPIDERS=sac` for one; `ASSET_FAST=1` for a quick look).
- `dev/spiders.html?type=stalker&size=large` shows one walking. In the game `?debug=1`, keys 1–5 spawn.
- `node tests/locomotion.mjs` scores the walking; `npm test` is the quick check.
