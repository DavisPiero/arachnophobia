# ARACHNOPHOBIA — project rules

First-person horror in the browser: a wooden cabin at night, three windows, mutant spiders outside.
Read `SPEC.md` (what makes it good, what is not in yet), `STATE.md` (where we are) and `HANDOFF.md` (last session's note) before starting work.

## Hard rules

- **No build step.** Plain HTML/CSS/JS ES modules. Three.js comes from jsDelivr, pinned to `three@0.170.0`
  through the import map in `index.html` (and in each `dev/*.html` page). Bump the version in all of them at once.
- **Relative paths only** (`./js/...`), so the game runs from GitHub Pages under `/arachnophobia/`.
- **Everything is made in code** for now: textures (canvas), models (geometry), sounds (Web Audio synthesis).
  Real recordings or Blender models can replace pieces later; keep each behind the same function names.
- **Shared positions live in `js/world/Layout.js`.** Never hard-code cabin, window, table or route positions elsewhere.
- **Tuning numbers live in `js/core/Config.js`.** Ammo, damage, speeds, wave sizes.
- **Mobile is first-class.** Every feature must work with touch controls and on the `low` quality tier.
- **Mute when testing.** Use `?mute=1`. Never leave a server or browser running. Screenshots go to `shots/` (git-ignored) via `node tools/shot.mjs`.
- **Reference images stay private.** `reference/` is git-ignored; some images are other people's work.

## Commands

- `npm start` — local server at http://localhost:8173
- `npm test` — headless smoke test (desktop + phone viewport), fails on console errors
- `node tools/shot.mjs "index.html?mute=1&autostart=1" shots/x.png [--mobile] [--wait=ms] [--eval=js]`

URL switches: `mute=1`, `autostart=1` (skip the start screen), `quality=low|high`, `debug=1` (stats + free keys).

## Layout of the code

```
js/core     Game state machine, config, quality tier, event bus
js/world    Layout (shared positions), cabin, forest, procedural textures, lighting
js/spiders  Spider models and leg rig, types, AI, waves
js/player   Movement/camera/health, weapon, ammo table
js/systems  Window visibility + damage, red eyes
js/audio    Audio engine (3D positional), synthesised sound bank, spider voices, ambience director
js/input    Keyboard/mouse and touch controls behind one Input interface
js/fx       Post-processing (grain, chromatic aberration, vignette)
js/ui       HUD and menus
dev/        Stand-alone viewers: spiders, world, sound board
```

## Out of scope for now (but wanted later — do not treat as rejected)

Barricade repair, more weapons, sprint/crouch, flashlight, score/saves, story, recorded audio, Blender models,
spiders on the inside ceiling. See SPEC.md "Later".
