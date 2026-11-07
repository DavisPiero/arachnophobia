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

Loads the game headless at desktop and phone sizes and fails on any console error. Screenshots land in `shots/`.

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
| Mute | M | speaker button |
| Pause / volume | Esc | pause button |

## Project layout

See `CLAUDE.md`.
