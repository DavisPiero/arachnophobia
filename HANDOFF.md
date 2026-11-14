# Hand-off

*Session of 2026-11-14 (second half of session 2). Replaces any earlier note.*

## Repo state
- Session 2 signed off (pre-approved by the user): `claude/waves-weapons` merged into `main`, pushed, branch deleted.
- `npm test` passes with the new checks (fists at start, rifle locked, punch, unlock after wave 2, shotgun fire and
  reload, flare at a window, inventory remap). `node tests/fistbot.mjs` survives waves 1–2 on normal (lowest health 59).
  Not played by hand.

## Read first
1. `STATE.md`: the open question about broken windows comes first.
2. `SPEC.md` "Second iteration" 5.4 (next session: the cabin).

## What was built
- `js/player/Arsenal.js` (new): unlocks by wave, the 1–5 slot map (saved in Settings), flare count.
- `js/player/Flares.js` (new): throw at the aimed window, one pre-made light per window (no shader recompiles),
  `flareLit`/`flareOut` events. `SpiderAI`: `flee()`; flared windows are skipped by `WaveSystem.pickWindow`.
- `js/ui/Inventory.js` (new) + `#screen-inventory` in `index.html`.
- `Weapon.js`: `held` is fists/rifle/axe/shotgun/flare; `ammo` per gun (`mag` is now a read-only getter); shotgun pellets.
- `Melee.js`: `tryPunch()`, shares `axeHit(params, by)`. `AmmoTable.js`: loads the held gun; `stocks.rifle/shotgun`.
- `ViewModel.js`: code-made shotgun (rifle space, same grips), flare in hand, punch and throw keyframes. Fists:
  see the 2026-11-15 note below.
- Settings keys: `slot1`–`slot5`, `inventory` replace `rifle`/`axe`. Debug keys: U (was I), G.

## Known weak spots
- Shotgun and flare are code-made, not from Blender yet (CLAUDE.md wants a generator; still to do).
- Sounds reused: shotgun = slowed gunshot + stomp thump; flare strike = wood scrape; flare hiss = sped-up rain loop.
- Flare light has no shadows, so a little red shows on the inside of the wall around that window.
- Spiders driven off by a flare fade out (the stalker's vanish) instead of walking away.

## 2026-11-15 (fists and menu glitch, signed off and merged)
- Fists remade: `hands.json` pose `fist` + `arm_fist_r` in `hands.glb`; `ViewModel.poseFist` aims the knuckles along
  `fistShoulder` -> fist (straight wrist); `FIST_IDLE` / `PUNCH_KEYS` give position + palm direction only.
- Menu: `Menu.crtGlitch(el)` + `.crt-glitch` in `style.css` replace the CRT bounce (which knocked the panel off the
  monitor). Plays on power-on and on menu <-> settings.
- Tests: every headless script has a time limit (`tools/watchdog.mjs`); the smoke test steps the game clock itself
  (79 s, and machine load no longer breaks it).
