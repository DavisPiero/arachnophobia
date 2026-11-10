# Hand-off

*Session of 2026-11-10. Replaces any earlier note.*

## Repo state
- Branch `m5-session1-fixes-frontend`, not merged. `main` is unchanged (milestone 4).
- The user's music track is committed as `assets/audio/menu-track.m4a` (re-encoded AAC 128 kbps, 1.9 MB). It will be
  public on GitHub Pages once merged.

## Read first
1. `STATE.md`: the open questions; ask them first.
2. `SPEC.md` "Second iteration" 5: the six-session plan the user accepted (every recommendation, session 3 folded into 1).
3. `DECISIONS.md`: the last 15 lines.

## What was built (session 1)
- **Darkness:** `Config.render` (exposure per tier, `viewAlbedo` lift for the baked hand/gun colours, view lights,
  `spiderFill`). The cause was not the phone tier: the baked hand and gun colours average ~3% reflectance and read as
  black in lantern light on every tier. `tests/brightness.mjs` measures both tiers.
- **Pause on touch:** `#hud` now sits above `#touch-ui` (z 3 over 2); the touch zones were swallowing taps.
- **Front end:** `js/ui/Menu.js` (gate, boot log, terminal menus, settings, webs), `js/audio/Music.js`,
  `js/core/Settings.js` (saved settings, key bindings read by `KeyboardMouse`), new markup in `index.html`, styles
  in `css/style.css` (screens section).
- **In play:** `HUD.notice` / `HUD.hint`, `PostFX` directional hurt and brightness/effects options, `ViewModel.bump`
  spring, `spiderKill` recipe, Grinner `stareCharge` in `Behaviour.js`, standing lantern from `buildLanternModel`.

## What went badly (tell the user plainly)
- My first brightness test measured the sky colour behind the gun and showed no change; fixed. The numbers in STATE
  are from the corrected test.
- I could not reproduce "black only on phones". If the iPad still shows black models after this, it is a device
  problem I need the iPad to find (a texture or shader failing on that GPU).
- The menu music cannot be checked headless (the test browser has no AAC decoder). Real Chrome and Safari decode it.

## Known weak spots
- The music timing (1:18 start, jump to 1:26) is set from your description, not by listening.
- Weapon bounce strengths were set by numbers (recoil ~2.5°), not by feel.
- The Grinner's stare-then-charge was not tested by hand.
- The left sleeve is still the darkest thing on screen (it is dark canvas by your earlier choice).

## Testing rules (from the user)
- Keep tests cheap: `npm test` in the background. One or two screenshots per change.
- `node tests/locomotion.mjs` takes very long for all sizes; run it in the background.
