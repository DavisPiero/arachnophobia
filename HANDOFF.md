# Hand-off

*Session of 2026-11-15 (horror rework, B+C merged and done). Replaces any earlier note.*

## Repo state
- `claude/horror-bc` merged into `main` and pushed (user: "merge and push when done"); branch deleted.
- `npm test` passes (73 s). `node tests/fistbot.mjs 2` survives both waves, health 72 then 38 (planks break 1.6x faster now).
- Logs, nailing, bandaging at the table, the clock reading and the inventory checked headless. Not played by hand.

## Read first
1. `STATE.md` (open questions come first).
2. `SPEC.md` "Second iteration" 7, B+C.

## What was built
- `Config.windows.boardSpots` replaces `boards`: plank heights from -1 (bottom) to 1 (top); now two low, two high.
  `WindowSystem.addBoard(w)` nails the lowest fallen plank back on and emits `windowRepaired`.
- `Config.linger.damage` 14 → 6.
- `js/systems/Firewood.js` (new): log stock, stove fuel, `prompt()` / `tryStart()` / `update()`, jobs 'feed' and 'board'.
  Wired in `Game.js` after the table and the cot in the USE order. HUD shows "· N logs" in the health label.
- `Layout.STOVE` (door position, reach). `Lighting.js`: stove PointLight (always present, intensity 0 when out, so the
  shader light count never changes), door slits and a halo; `setFire(level)`. Exposed through `World.js`.
- `Config.fire`, `Config.logs`.

- Session B/C second half: scroll wheel (`KeyboardMouse.js`, action 'swapBack'), `Config.windows.spiderDamage`, lens
  in `PostFX.js` (`Config.render.lens`), `js/ui/Icons.js` + new `Inventory.js` cards, HUD supply pictures,
  `Game.clockReading()` + `#clock-read`, long table (`placement.js` → `Layout.AMMO_TABLE`, middle legs, bandage rolls),
  `Game.tablePrompt()` (bandage at the table), `Healing.atTable`, `dev/place.html` + POST `/save-placement` in serve.mjs.

## Known weak spots
- The wood stack by the stove does not shrink with your log count.
- No fire sound yet (crackle wanted with F's sound batch, or sooner).
- Planks nailed back on a breached window: a spider already squeezing in is checked, but not tested under load.
- Earlier ones still stand: legs through the gaps, hard flashlight disc on planks, long waves, code-made shotgun/flare.
