# ARACHNOPHOBIA — spec

## What makes it good

You are alone in a cabin at night. You can only see outside by walking up to a window, and the moment you do,
you are not watching the other two. Your ammo is on a table across the room, and every trip there is a gamble.
The fear comes from **not knowing**: sounds that move around the cabin, eyes in the dark that may or may not be attached
to anything, silence that lasts too long. It should feel unsettling, not jumpy. The only jump scare is your death.

The core loop: **listen → pick a window → look and shoot → run low → cross the room to reload → listen again.**

## Pillars

1. **Darkness you have to approach.** Windows are dim from across the room and reveal the outside smoothly as you near them.
   Outside, the night gets darker with distance. A flashlight helps but shows only what it points at.
2. **Sound tells you where to go.** 3D positional sound for every spider; you hear them before you see them.
3. **Reloading is a commitment.** Only at the table, takes ~3 s, cannot move or shoot, spiders keep coming.
4. **Spiders that look and move like real creatures.** Dark, segmented, long jointed legs, tiny red eyes, legs that plant and step.
5. **Works on a phone.** Landscape touch controls are as good as mouse and keyboard.

## The world

- Cabin interior 6 × 8 m (see `js/world/Layout.js`). Warm hanging lantern, an oil lamp on the west wall, a candle on the ammo table.
  Boarded door on the south wall.
- Three windows, each facing a different landscape:
  - **North**: dense pines close to the wall. Short sightlines; spiders appear late.
  - **East**: misty clearing, long sightline to a dead tree line. You see things coming from far away.
  - **West**: slope down to a creek, fallen logs, an old shed used as cover.
- Night, rain, wind, distant thunder. Cold blue moonlight and fog outside.

## Spiders

| Type | Look | Behaviour | Sound |
|---|---|---|---|
| Runner | small (~1 m leg span), thin | very fast, zig-zags, darts across walls and glass | quick high clicks, skittering |
| Brute | huge (~3 m), bulky, bristly | slow, many hits, heavy window damage | low breathing, heavy thuds |
| Climber | gaunt, very long legs | climbs walls and roof, drops onto a window from above | footsteps on the roof, scraping |
| Stalker | dark, mostly eyes | watches from the dark; vanishes when you come close or light hits it | almost silent, slow breathing |

## Windows

Stages: intact → cracked → shattered → boards splintering → **breached**. After a breach, spiders climb inside and attack you.
You have health; at zero it is game over (restart at wave 1).

## Weapon and ammo

Rifle, 8-round magazine, hitscan. Ammo stock on the table: 40 rounds at start, ~16 added after each wave survived.
Reload only at the table: ~3 s, cannot move or shoot, cannot be cancelled. Supplies on the table visibly run down.

## Controls

- Desktop: WASD move, Shift sprint, mouse look, click fire, right mouse aim down sights, E interact, T flashlight, M mute, Esc pause.
- Touch (landscape): left joystick (push past the edge to sprint), drag on the right half to look, Fire, Aim, Light and Use buttons.
  Browser zoom gestures are blocked. Portrait shows "rotate your phone".

## Sound

All synthesised for now. Positional (HRTF) for spiders and events. Indoor echo on gunshots. An ambience director varies
wind/rain/creaks with danger, plays noises behind the player, distant sounds that creep closer, and uses silence on purpose.
Volume sliders: master, effects, ambience. Mute with M, the on-screen button, or `?mute=1`.

## Flashlight

Toggled with T or the Light button. A warm, narrow beam from the hand; no battery. A watcher caught in the beam slips away.

## Assets

Models come from Blender generator scripts with adjustable variation (see `blender/README.md`), or from hand-made files.
Every loaded model has a code-made fallback.

## Second iteration (milestones 2–6)

2. Blender pipeline, lighting and darkness fixes, flashlight, sprint, aim down sights, phone zoom fix. *(this one)*
3. First-person hands and arms, lever-action rifle and axe from Blender, axe on F, stomp on V, recoil, sway, directional
   shake, muzzle flash, blood by hit location, new combat sounds.
4. Nine spider species (details will live in `SPECIES.md`), Blender spider generator, locomotion upgrade, species behaviours,
   climbing in through the window frame instead of clipping, spiders on the inside ceiling.
5. Horror: attack sequences, a different death per species (the jump scare), watchers in windows and tree lines,
   tapping on walls and roof, silhouettes, sudden silence, webs and cocoons spreading through the cabin.
6. Environment from Blender: trees, foliage, cabin props, walls, floors, ceilings.

The long-term goal is a semi-open-world survival horror; behaviours and assets should carry over to it.

## Later (wanted, not scheduled)

Barricade repair, more weapons, crouch, score and saves, story/intro, recorded audio, more menus.

## Not building

Constant music, jump scares outside of death, pixelated/retro filters.
