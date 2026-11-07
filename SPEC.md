# ARACHNOPHOBIA — spec

## What makes it good

You are alone in a cabin at night. You can only watch one window at a time, and the moment you do,
you are not watching the other two. Your ammo is on a table across the room, and every trip there is a gamble.
The fear comes from **not knowing**: sounds that move around the cabin, eyes in the dark that may or may not be attached
to anything, silence that lasts too long. It should feel unsettling, not jumpy. The only jump scare is your death.

The core loop: **listen → pick a window → look and shoot → run low → cross the room to reload → listen again.**

## Pillars

1. **Darkness outside, not in the glass.** The windows are always clear; the night itself gets darker with distance.
   You still only see one window at a time. A flashlight helps but shows only what it points at.
2. **Sound tells you where to go.** 3D positional sound for every spider; you hear them before you see them.
3. **Reloading is a commitment.** Only at the table, takes ~3 s, cannot move or shoot, spiders keep coming.
4. **Spiders that look and move like real creatures.** A mix: some dark with tiny red eyes, some pale and gaunt with
   big dark eyes (see `SPECIES.md`). Segmented, long jointed legs that plant, step and grip; big ones squeeze in through
   a broken window, gripping the frame.
5. **Works on a phone.** Landscape touch controls are as good as mouse and keyboard.

## The world

- Cabin interior 9 × 12 m, 3 m to the ceiling (see `js/world/Layout.js`). Warm hanging lantern, an oil lamp on the west wall, a candle on the ammo table.
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
They grip the window frame and pull themselves through; a big one is stuck in the frame for a few seconds.
You have health; at zero it is game over (restart at wave 1).

## Weapon and ammo

Lever-action rifle, 8 rounds in the tube, hitscan, one lever cycle (0.5 s) between shots. Ammo stock on the table:
40 rounds at start, ~16 added after each wave survived. Reload only at the table: ~3 s, rounds pushed into the loading
gate one by one, cannot move or shoot, cannot be cancelled. Supplies on the table visibly run down.

Weapon switch: **1** the rifle, **2** the axe (~0.45 s to swap). The axe is held in the right hand and swung with the
fire button (no ammo, ~0.7 s swing): it hits a spider within reach in front of you, inside or at the window you stand at.
Through intact glass it only cracks your own glass. Reloading at the table brings the rifle back up. The held axe is
the start of chopping firewood later. Stomp: kills small spiders on the floor in front of you, shoves bigger ones back.

Hits show on the spider: dark red spray and splats that fade after a few seconds (so they never block a window), a jolt (body hit) or a kicked leg (leg hit),
brutes stagger every quarter of their health, a different crunch on the killing hit. A killed spider bursts into gooey
red chunks (flesh, bits of shell, pieces of its own legs) that fall, slide down walls and fade after a few seconds.
No hit marker.

## Controls

- Desktop: WASD move, Shift sprint, mouse look, click fire (or swing the axe), right mouse aim down sights, 1 rifle,
  2 axe, C stomp, E interact, Q flashlight, M mute, Esc pause.
- Touch (landscape): left joystick (push past the edge to sprint), drag on the right half to look, Fire (fires or swings),
  Aim, Axe/Rifle (swaps, and names what you would switch to), Stomp, Light and Use buttons.
  Browser zoom gestures are blocked. Portrait shows "rotate your phone".

## Sound

All synthesised for now. Positional (HRTF) for spiders and events. Indoor echo on gunshots. An ambience director varies
wind/rain/creaks with danger, plays noises behind the player, distant sounds that creep closer, and uses silence on purpose.
Volume sliders: master, effects, ambience. Mute with M, the on-screen button, or `?mute=1`.

## First-person body

Gloved hands (full fingers, hard knuckle guard, dark olive-black) and dark jacket sleeves. The trigger hand hangs off
the stock wrist: thumb on the right side, fingers wrapped onto the left, wrist bent (reference/m4-rifle-hold.png). The
support hand is under the barrel: thumb up the left side, fingers up the right. Looking down shows the belly, muddy
cargo trousers and lace-up boots; the legs swing when walking.

## Flashlight

Toggled with Q or the Light button. A warm, narrow beam from the hand; no battery. A watcher caught in the beam slips away.

## Assets

Models come from Blender generator scripts with adjustable variation (see `blender/README.md`), or from hand-made files.
Every loaded model has a code-made fallback.

## Second iteration (milestones 2–6)

2. Blender pipeline, lighting and darkness fixes, flashlight, sprint, aim down sights, phone zoom fix. *(done)*
3. First-person hands and arms, lever-action rifle and axe from Blender, axe on F, stomp on V, recoil, sway, directional
   shake, muzzle flash, blood by hit location, new combat sounds. *(done)*
4. *(started: weapon switch, bigger cabin, burst deaths, four species from Blender, squeezing through windows)*
   Nine spider species (details will live in `SPECIES.md`), Blender spider generator, locomotion upgrade, species behaviours,
   climbing in through the window frame instead of clipping, spiders on the inside ceiling.
5. Horror: attack sequences, a different death per species (the jump scare), watchers in windows and tree lines,
   tapping on walls and roof, silhouettes, sudden silence, webs and cocoons spreading through the cabin.
6. Environment from Blender: trees, foliage, cabin props, walls, floors, ceilings.

The long-term goal is a semi-open-world survival horror; behaviours and assets should carry over to it.

## Later (wanted, not scheduled)

Barricade repair, more weapons, crouch, score and saves, story/intro, recorded audio, more menus.

## Not building

Constant music, jump scares outside of death, pixelated/retro filters.
