# State

**Where we are:** milestone 4 has started. Merged into main (branch `m4-spiders`):
- **Cabin:** 9 × 12 m, 3 m ceiling. Furniture follows the walls (`Layout.js` `FURNITURE`).
- **Weapons:** 1 rifle, 2 axe (click swings it); stomp on C. Touch: the AXE/RIFLE button swaps.
- **Deaths:** a killed spider bursts into red chunks (flesh, shell, pieces of its legs) that fade after ~6 s.
- **Spiders from Blender:** runner, brute, climber, stalker. Each is a smooth skinned mesh driven by the game's leg
  code (`blender/generators/spiders.py`, `assets/params/spiders.json`, `SPECIES.md`).
- **Locomotion:** feet land on the real ground; the body tilts with its feet; the brute moves one leg at a time.
- **Windows:** spiders grip the frame and squeeze through a breached window; a brute is stuck there ~5 s.

GitHub Pages serves main.

**Next (rest of milestone 4):**
- The user's notes on the four species, then the other five (`SPECIES.md`, all guesses so far).
- Species behaviours.
- Spiders on the inside ceiling.

**Open with you:**
- **The five planned species** in `SPECIES.md`: names, looks and behaviours are guesses. Keep, change or cut?
- **Look at the spiders:** renders are in `blender/build/spider_*_{preview,side,face}.png`. In the game:
  `?debug=1`, keys 1–4 spawn. Are the brute's skull plate and the stalker's eyes what you pictured?
- **Squeeze speed:** a brute takes ~5 s to get through a window. Too long, too short?
- **Aiming:** the forearms are 10° lower, but the sleeves still fill the lower middle when aiming. Lower again?
- **The bigger room:** one lantern lights it, slightly brighter. Too dark at the far ends?
- **Old guesses, never answered:**
  - Is the night bright enough (the east clearing especially)?
  - Does double-tap still zoom on a real phone?

**Tools:**
- `npm run assets spiders` rebuilds the spiders (`SPIDERS=brute` for one; `ASSET_FAST=1` for a quick look).
- `dev/spiders.html?type=brute` shows one walking.
- `npm run assets` rebuilds everything (~20 min). `node tools/fetch-textures.mjs` once per machine.
- `node tools/poses.mjs` screenshots every pose (new: `axehold`).
- `npm test` is the quick check (~3 min).
