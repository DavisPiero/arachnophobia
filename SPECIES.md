# Spider species

Nine species, from the spec (milestone 4). **Built** means it has a Blender model and runs in the game; the rest are
written up so the generator and the rig leave room for them. Names and behaviours of the planned five are **guesses**
until the user confirms them.

The look is a mix (user's call): some dark with tiny red eyes, some pale and gaunt with big dark eyes, after the
references in `reference/m4-spider-*.jpg` (private). We borrow traits from them, never copy a creature.

Shape, colour and leg numbers live in `assets/params/spiders.json`; game numbers (health, speed, damage) in
`js/core/Config.js` → `spiders`.

| # | Species | Size (leg span) | Look | Behaviour | Gait | State |
|---|---|---|---|---|---|---|
| 1 | **Runner** | ~1.3 m | dark brown, hairy, low and flat; eight tiny red eyes (a wolf spider grown wrong) | very fast, zig-zags, darts over walls and glass | fast alternating tetrapod | **built** |
| 2 | **Brute** | ~3 m | heavy; a bony, skull-like plate over the face; a crest of long quills on the back; pale bony legs ending in hooks (from `m4-spider-skullface`) | slow, many hits, heavy window damage; squeezes in through a breached window | slow wave gait: one leg at a time | **built** |
| 3 | **Climber** | ~2.6 m | dark, flat huntsman body, very long thin banded legs that bend sideways (from `m4-spider-ceiling`) | climbs walls and roof, drops onto a window from above; later walks on the inside ceiling | long reaching steps | **built** |
| 4 | **Stalker** | ~2.2 m | pale and mottled, two huge black front eyes, broad hairy fangs, long speckled legs (from `m4-spider-ogreface`, a real net-casting spider) | watches from the dark; slips away from light | slow, deliberate | **built** |
| 5 | Stilt *(guess)* | ~4 m, body 2.5 m up | pale, gaunt, wrinkled hide hanging off the body, a sagging face under the carapace, legs like bent poles (from `m4-spider-pale`) | walks slowly upright past the windows; you see its legs before its body | very slow, high-stepping | planned |
| 6 | Swarmling *(guess)* | ~0.3 m | tiny, black, glossy | comes in groups of 6–10; through gaps in the boards; the stomp's main target | skittering | planned |
| 7 | Weaver *(guess)* | ~1.8 m | grey, round abdomen, spinnerets | spins webs over a window (blocks the view) and cocoons inside (milestone 5) | careful | planned |
| 8 | Burrower *(guess)* | ~1.6 m | earth-coloured, thick front legs | digs under the cabin and comes up through the floorboards | crawling, body low | planned |
| 9 | Mother *(guess)* | ~3.5 m | swollen abdomen covered in clinging young | rare; shot, the young scatter as swarmlings | heavy, slow | planned |

## How a species is made

- `blender/generators/spiders.py` builds every species from `assets/params/spiders.json`:
  - one smooth mesh, skinned to the same 58 bones the game's leg code drives (body, abdomen, fangs, palps, 8 legs × 6);
  - joints are weighted smoothly, so legs bend instead of being stiff tubes;
  - scanned CC0 materials, re-tinted per species, baked into its own textures.
- It writes `assets/models/spider_<species>.glb` and `assets/models/spider_<species>.json`:
  - the `.json` holds the leg layout and the rest pose the mesh was built in, so the game drives the bones exactly
    where Blender put them.
- Each build also renders the species studio-lit (the game is too dark to judge a model):
  `blender/build/spider_<species>_preview.png` (three-quarter), `_side.png` and `_face.png` (close on the face).
- `dev/spiders.html?type=<species>` shows it walking in the game engine.
- Without the files (or with `?assets=0`) the game uses its old code-made spiders.
