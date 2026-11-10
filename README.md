# ARACHNOPHOBIA

First-person horror in the browser. You are trapped in a wooden cabin at night. Mutant spiders are outside.
Three windows, one ammo table, not enough bullets.

**Play:** https://davispiero.github.io/arachnophobia/

## Run it locally

Needs Node.js 18+.

```bash
npm install        # only needed for the headless tests
npm start          # http://localhost:8173
```

Add `?mute=1` to the URL for silence, `?quality=low` to try the phone settings on a desktop.

## Test

```bash
npm test
```

Loads the game headless at desktop and phone sizes, checks shooting, reloading, window visibility, touch controls
and breaches, and fails on any console error. Takes about 1.5 minutes and prints one line. Flags: `--full` (high-quality desktop, slow), `--shots` (save screenshots to `shots/`), `--verbose`.

```bash
node tests/soak.mjs 150
```

A simple bot plays for 150 seconds of game time (phone settings) and reports waves, kills, misses and errors.

```bash
node tests/brightness.mjs [--shots]
```

Measures how bright the hands and gun, a spider and the room render on the desktop and phone tiers, and fails if
the phone tier is much darker or anything drops toward black.

```bash
node tests/locomotion.mjs [--only=runner] [--size=large]
```

Scores spider walking (pops, reach errors, clipping) for every model and size. Slow: run it in the background.

## Deploy

GitHub Pages serves the `main` branch from the repository root. There is no build step: push to `main` and the site
updates within a minute or two. All paths are relative, so it works under `/arachnophobia/`.

## Controls

| | Desktop | Touch (landscape) |
|---|---|---|
| Move | WASD | left joystick |
| Look / aim | mouse | drag on the right half |
| Fire | left click | Fire button |
| Reload at the table | E | Interact button |
| Rifle / axe | 1 / 2 | Axe button |
| Stomp | C | Stomp button |
| Flashlight | Q | Light button |
| Mute | M (or the speaker button) | Settings → Audio |
| Pause / settings | Esc or P | pause button (top left) |

Every desktop key can be rebound in Settings → Controls. Without `?autostart=1` the game opens on a boot gate
(the first key or tap starts the sound), then the loading screen and the main menu with music.

## Developer pages

Open these from the local server:

- `dev/spiders.html` — every spider type walking, attacking, dying (`?type=brute&mode=attack`)
- `dev/world.html` — the cabin and the three window views (`?view=east&quality=low`)
- `dev/sounds.html` — a sound board for every synthesised sound, plus the ambience director
- `index.html?debug=1` — frame rate, draw calls, and keys: 1–4 spawn spiders, K kill all, B damage windows, L lightning

## Project layout

See `CLAUDE.md`.
