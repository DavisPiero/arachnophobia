# Hand-off

*Session of 2026-11-15 (assessment, survival plan, S0 modes). Replaces any earlier note.*

## Repo state
- `claude/assessment-fixes` merged into `main` and pushed (user: "when done, merge and push"); branch deleted.
- `npm test` passes, including two new mode checks and "all three menu entries fit on the monitor".
- Checked headless: the menu shows survival / waves / settings; clicking waves reaches play in Waves mode.
  Not played by hand.

## Read first
1. `STATE.md` (open questions come first; seven are about survival).
2. `SURVIVAL.md` (the plan; S1 is next).

## What was built
- `Config.modes` (`survival`: 10 waves, 30 s breaks; `waves`: endless, 15 s breaks). `Config.waves.count` and
  `breakTime` are gone; `clockWaves` sets how fast the wall clock turns.
- `WaveSystem.setMode(id)`, `.rules`, `.endless`. `Game.mode`, `Game.setMode(id)`; the menu buttons carry
  `data-mode`; `?mode=` works with `autostart=1`.
- Menu: `#btn-start` is now "survival", new `#btn-waves`.
- Fixes: the bandage hint names the medical table; `tests/fistbot.mjs` bandages (at the medical table).

## Known weak spots
- Survival and Waves differ only in wave count and break length so far.
- Waves past wave 10 only grows the spider count (capped by how many may be alive at once); nothing else escalates.
- `Game.js` is over 600 lines and was not split; do it when Survival gets its own rules (S1–S2).
- The user does not want balance bots or difficulty tuning proposed.
- Earlier ones still stand: wood stack does not shrink, no fire sound, hard flashlight disc, wall texture seam,
  code-made shotgun and flare.
