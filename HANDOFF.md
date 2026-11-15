# Hand-off

*Session of 2026-11-15 (horror rework, B+C merged, first part). Replaces any earlier note.*

## Repo state
- Branch `claude/horror-bc`, committed, **not merged** (waits for sign-off).
- `npm test` passes (desktop + phone, 96 s). `node tests/fistbot.mjs 2` runs to the end with no console errors.
- Feeding, nailing, the fire going out and the no-logs prompt checked by stepping the real game headless. Not played by hand.

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

## Known weak spots
- The wood stack by the stove does not shrink with your log count.
- No fire sound yet (crackle wanted with F's sound batch, or sooner).
- Planks nailed back on a breached window: a spider already squeezing in is checked, but not tested under load.
- Earlier ones still stand: legs through the gaps, hard flashlight disc on planks, long waves, code-made shotgun/flare.
