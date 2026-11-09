# Spiders: species and models

A **model** is a body (a Blender-made mesh, `assets/models/spider_<model>.glb`). A **species** is how a spider behaves
in the game (`js/core/Config.js` → `spiders`, `js/spiders/Behaviour.js`). Each species names the model it wears
(`Config.spiders.<species>.model`), so later a species can get a second model, or two species can share one.

For now there are five species, each with its own model, each in three sizes (small, medium, large).

Art direction (user, 2026-11-09): realistic biological horror. Recognisably spiders, believable anatomy, grown in
completely wrong directions. Soft, fleshy, folded; never bony, skeletal, mechanical or angular. Now and then a human
feature grown in: an unnatural smile with human teeth, black human eyes. **No noses.**

| Species (id) | Model | Role in the game | What is wrong with it | How it moves and behaves |
|---|---|---|---|---|
| runner | **Knot** | fast, many | lopsided: the right legs overgrown, the left stunted; a lumpy, tumorous abdomen swollen on one side; blisters; raw pink patches worn through dark skin; dense hair; tiny red eyes | bursts and dead stops; fits of trembling; goes still when you look, or darts aside; rakes and lunges |
| brute | **Sac** | slow, heavy window damage | a huge swollen abdomen that sags like a full bladder, pale see-through skin with dark veins; thick soft legs with folds at every joint; four black human eyes; a wide human smile with small teeth | drags itself slowly, then lurches two strides without warning; its smile opens as it gets close; slams with its whole weight |
| climber | **Flayed** | climbs walls and the roof, drops onto windows | flat and wide like flayed hide, raw red-grey and wet; very long legs with a soft swelling in the middle of each; long sparse hairs | skitters fast, then freezes splayed flat; repositions suddenly; claws in flurries |
| stalker | **Grinner** | watches from the dark, comes when you look away | pale, damp, sagging; a too-wide, off-centre lipless smile full of human teeth; three uneven black human eyes; no nose | moves only while you are not looking at it; when you look it is perfectly still, its head tilts and its smile slowly widens; slips away from light |
| weeper | **Weeper** | ambusher at the windows | a hunched body under a raised head; two big black human eyes under heavy drooping lids that blink, slowly; a small smile | creeps low, hides under the sill; when you come close it rises slowly into view and stares; sinks away when you turn; fakes attacks |

Sizes (`js/spiders/SpiderModel.js` `SIZES`, `Config.sizes`): small ×0.62 (light, twitchy; dies to a stomp), medium,
large ×1.45 (heavy, slow, more health and damage). One mesh per model; size changes scale and how heavy the body moves.

Later (wanted, not scheduled): more species reusing these models, a second model per species, swarms of small ones,
a web-spinner, one that comes up through the floor, a mother whose young scatter.

## How a model is made

- `blender/generators/spiders.py` builds every model from `assets/params/spiders.json` (`models`):
  - one smooth mesh on 60 bones: body, abdomen, fangs, palps, 8 legs × 6, plus a mouth (jaw) and the eyelids;
  - abdomen shapes (`abdShape`: sac, lumpy, flat, hunch), growths, real hairs (thin spikes), fleshy folds at joints
    (`folds`, `swell`), lopsided legs (`sideLen`), a human mouth (`mouth`), human eyes (`humanEyes`);
  - scanned CC0 materials with mottling, raw patches, veins; baked into its own textures.
- It writes `assets/models/spider_<model>.glb` and `.json` (leg layout, rest pose, face bones, translucency).
- Each build renders `blender/build/spider_<model>_{preview,side,face}.png` (the game is too dark to judge a model).
- `dev/spiders.html?type=<species>` shows one walking. Without the files (or `?assets=0`) the old code-made spiders
  stand in.

## How it moves (milestone 4, part 2)

- `LegIK.js` stable leg solver (smooth at full stretch, knees splay up and out, never flips).
- `Gait.js` which foot steps when: neighbours never lift together, as many feet up as the speed needs.
- `BodyDynamics.js` the body as a weight on springs: sags, lags, leans, wobbles (soft abdomens jiggle).
- `SpiderCollision.js` feet land on real surfaces (terrain, walls, window frame, roof, floor, furniture); knees fold
  away from walls; the body is pushed out of geometry.
- `tests/locomotion.mjs` scores it (pops, reach errors, clipping) for every model and size.
