# Decisions

One line each, with the reason. Newest at the bottom.

- 2026-11-07 — No build step; Three.js 0.170.0 from jsDelivr via import map. Simplest thing that runs on GitHub Pages and is easy to update.
- 2026-11-07 — All assets made in code for milestone 1 (textures, spider models, sounds). No assets exist yet; swap for recordings/Blender later if they don't convince.
- 2026-11-07 — Window darkness is a glass overlay whose darkness depends on player distance and angle; red eyes draw on top so they show through. Cheap on mobile, no pop-in.
- 2026-11-07 — Windows already have boards nailed across; boards are the last damage stage before a breach. No repair yet.
- 2026-11-07 — After a breach, spiders come inside and attack; player health, game over at zero. Spec did not say.
- 2026-11-07 — No flashlight. It would undo the dark-window mechanic. Stalkers flee from muzzle flashes and lightning instead.
- 2026-11-07 — Reload cannot be cancelled once started (~3 s). That is the tension the spec asks for.
- 2026-11-07 — Ammo: 8 per magazine, 40 on the table at start, +16 per wave survived. Guess; all in Config.js.
- 2026-11-07 — Climbers use the outside walls and roof only in milestone 1. Inside ceiling is for later.
- 2026-11-07 — Reference images git-ignored; rights unknown for some of them.
- 2026-11-07 — Repo public (needed for free GitHub Pages). Pages serves main; work happens on branches and is merged on sign-off.
- 2026-11-07 — Bullets pass through window glass without breaking it; window boards stop bullets. Guess: shooting out your own glass felt punishing.
- 2026-11-07 — Window centres in Layout.js are on the inner wall face (wall runs outward). Glass sits mid-wall, boards 0.11 m inside.
- 2026-11-07 — A stalker that is seen or lit vanishes and reappears at another window; after two vanishes it attacks like the others.
- 2026-11-07 — Before each wave the ambience goes deliberately quiet for ~14 s.
- 2026-11-07 — Closed windows muffle outside sounds, but a little leaks through unfiltered so spiders stay audible over wind and rain.
- 2026-11-07 — Up to 3 spiders attack a window at once (a brute takes the main spot); extras wait at the wall.
