# ARACHNOPHOBIA — spec

## What makes it good

You are alone in a cabin at night. You can only watch one window at a time, and the moment you do,
you are not watching the other two. Your ammo is on a table across the room, and every trip there is a gamble.
The fear comes from **not knowing**: sounds that move around the cabin, eyes in the dark that may or may not be attached
to anything, silence that lasts too long. Everything should be genuinely horrifying (user's call, 2026-11-09): the
creatures themselves, how they move, sudden lunges, freezes and faces. Not cheap: no loud stings over nothing.

The core loop: **listen → pick a window → look and shoot → run low → cross the room to reload → listen again.**

## Pillars

1. **Darkness outside.** The night itself gets darker with distance; outside you see eyes, and the rest only in
   the flashlight beam (`node tests/brightness.mjs` measures a spider 7 m out, dark and lit, on phone and desktop).
   You still only see one window at a time, through the gaps between its planks.
2. **Sound tells you where to go.** 3D positional sound for every spider; you hear them before you see them.
3. **Reloading is a commitment.** Only at the table, takes ~3 s, cannot move or shoot, spiders keep coming.
4. **Spiders that are mistakes.** Spider bodies grown wrong: swollen sacs, lopsided bodies, growths, soft fleshy legs,
   and often human faces (smiles with human teeth, black human eyes; no noses). Some are gaunt: thin, stretched skin
   over long limbs, sunken (user's call, 2026-11-10). Still flesh: no exposed bone, nothing mechanical. Each has its own silhouette and its own unsettling way of moving
   (see `SPECIES.md`). Legs plant, step and grip; they squeeze in through a broken window, folding their legs in.
5. **Works on a phone.** Landscape touch controls are as good as mouse and keyboard. Phones must not render darker
   than desktop (checked by `node tests/brightness.mjs`).
6. **Warmth** *(milestone 5, not built yet)*: the stove is your second health. Light keeps them out.

## The world

- Cabin interior 9 × 12 m, 3 m to the ceiling (see `js/world/Layout.js`). Warm hanging lantern, an oil lamp on the west wall,
  a hurricane lantern standing on the ammo table (the same look marks points of interest).
  Boarded door on the south wall.
- Three windows, each facing a different landscape:
  - **North**: dense pines close to the wall. Short sightlines; spiders appear late.
  - **East**: misty clearing, long sightline to a dead tree line. You see things coming from far away.
  - **West**: slope down to a creek, fallen logs, an old shed used as cover.
- Night, rain, wind, distant thunder. Cold blue moonlight and fog outside. On desktop the fog is denser, so the forest
  darkens sooner with distance; phones keep the lighter fog (they were already too dark).

## Spiders

Five species, each wearing its own model (the Knot, the Sac, the Flayed, the Grinner, the Weeper), each in three sizes
(small, medium, large). Details and personalities in `SPECIES.md`. Small ones die to a stomp.

Attacks have four beats: a wind-up you cannot time (rearing, trembling, the mouth opening), the strike (lunge, a flurry
of rakes, a slam with the whole weight, or a feint that never comes), the impact (damage, the view knocked, the player
shoved) and a recovery. Spiders react to the player: some freeze when looked at, the Grinner stops dead and stares when you look at it or
light it, then charges; the Weeper rises into view under a window when you come close. (The Grinner moving only while
unseen was removed, user's call 2026-11-10.) Inside they circle in rather than run straight at you.

## Windows

Windows are 1.32 × 1.2 m holes, sill at 1.0 m, **no glass** (user's call, 2026-11-15). Four planks are nailed across
the outside, with gaps of about 13 cm between them: you see, shoot and punch through the gaps; a plank stops a bullet,
and nothing the player does damages a window. Spiders stand on the planks and tear at the one nearest their claws; a
hurt plank hangs loose, a dead one falls into the yard. When all four are gone the window is **breached** and spiders
climb inside. They grip the frame and pull themselves through. Stand at one window too long while spiders are out
and one springs at the planks in your face and rakes you through the gaps (through an open window it leaps in).
Coming (session C): nailing planks back on. Later: big spiders reaching through a gap to grab you and pull you out.
You have health; at zero it is game over (restart at wave 1).

## Weapon and ammo

Lever-action rifle, 8 rounds in the tube, hitscan, one lever cycle (0.5 s) between shots. Ammo stock on the table:
40 rounds at start, ~16 added after each wave survived. Reload only at the table: ~3 s, rounds pushed into the loading
gate one by one, cannot move or shoot, cannot be cancelled. Supplies on the table visibly run down.

Weapon switch: **1** the rifle, **2** the axe (~0.45 s to swap). The axe is held in the right hand and swung with the
fire button (no ammo, ~0.7 s swing): it hits a spider within reach in front of you, inside or at the window you stand at
(through the gaps between the planks). Reloading at the table brings the rifle back up. The held axe is
the start of chopping firewood later. Stomp: kills small spiders on the floor in front of you, shoves bigger ones back.

Hits show on the spider: dark red spray and splats that fade after a few seconds (so they never block a window), a jolt (body hit) or a kicked leg (leg hit),
brutes stagger every quarter of their health, a different crunch on the killing hit. A killed spider bursts into gooey
chunks (torn marbled meat, pale gristle, bits of shell; no legs) that fall, slide down walls and fade after a few seconds.
No hit marker.

## Controls

- Desktop: WASD move, Shift sprint, mouse look, click fire (or swing the axe), right mouse aim down sights, 1 rifle,
  2 axe, C stomp, E interact, Q flashlight, M mute, Esc or P pause. Every key can be rebound in Settings → Controls.
- Touch (landscape): left joystick (push past the edge to sprint), drag on the right half to look, Fire (fires or swings),
  Aim, Axe/Rifle (swaps, and names what you would switch to), Stomp, Light and Use buttons. A big pause button top-left;
  no mute button on touch devices (volume is in Settings → Audio).
  Browser zoom gestures are blocked. Portrait shows "rotate your phone".

## Sound

All synthesised for now. Positional (HRTF) for spiders and events. Indoor echo on gunshots. An ambience director varies
wind/rain/creaks with danger, plays noises behind the player, distant sounds that creep closer, and uses silence on purpose.
Volume sliders: master, effects, ambience, music. Mute with M, the desktop button, Settings → Audio, or `?mute=1`.

Music only on the loading screen and main menu: the user's track (`assets/audio/menu-track.m4a`), fading in from 1:18,
jumping to the good part (1:26) as the loading screen ends, looping 1:26 to the end while the menu is open, fading out
when the night begins. Kills: the body bursting, a choked dying screech, chunks pattering down.

## First-person body

Gloved hands (full fingers, hard knuckle guard, dark olive-black) and dark jacket sleeves. The trigger hand hangs off
the stock wrist: thumb on the right side, fingers wrapped onto the left, wrist bent (reference/m4-rifle-hold.png). The
support hand is under the barrel: thumb up the left side, fingers up the right. No legs or boots are drawn (user's call,
2026-11-09): looking down or stomping shows nothing below the hands.

## Flashlight

Toggled with Q or the Light button. A warm, narrow, strong beam from the hand; it falls off slowly, so it lights a
spider at 15 m; no battery. It is the way to see outside. A watcher caught in the beam slips away.

## Screens and text

One old-terminal look for every screen (user: "make it Unix"): a boot gate (the first tap starts sound), a black
loading screen with a boot log typing itself out (a containment breach, things in the walls), a main menu on an old
CRT on a lab bench with a scientist's notebook and webs, and pause, game-over and settings in the same terminal style.
Settings has four tabs: Gameplay (look speed, invert, hints), Graphics (quality, film effects, brightness), Audio
(volumes, mute), Controls (rebind keys; the touch layout on phones). No controls list on the main menu.

In play: big wave titles ("Wave 3 survived · fresh rounds are on the ammo table"), short red notices under the
crosshair ("NO AMMO · reload at the ammo table"), and first-time hints that show once per browser (can be turned off).
Hits show as red flooding in from the side they came from, a shaking health bar with a red trail of what you lost,
and a heartbeat at low health. Weapons bounce on a spring when switched, fired and swung.

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
5. Notes from the milestone 4 playtest (2026-11-10), in six sessions:
   1. Bugs and quick wins, front end: phone darkness, pause button, chair gone, table lantern, glass, beam, fog,
      text and hints, hit feedback, health bar, bounce, kill sounds, Grinner; loading screen, music, terminal menu,
      settings. *(done)*
   2. Waves and weapons: 10 timed waves (1:30 each, 30 s to recover) to dawn, a wall clock, fists, a new weapon every
      two waves (fists, rifle at 3, axe at 5, shotgun at 7, flares at 9), inventory on I (pauses; remap weapons to 1–5),
      bandages (one per wave survived, up to 3, used with H), bed heal once per break, difficulty.
      *(done 2026-11-14. The shotgun and the flare are code-made for now; a Blender generator for them is still to do.)*
   3. *(merged into 1)*
   4. Cabin: a placement tool, a bigger cabin (~10 × 13 m) in two rooms with a door you can barricade, the table and
      the bed in different rooms, benches, decorations, better materials, a log tray by the stove.
   5. Warmth: the stove lights the room and needs logs carried from the tray; lanterns go out and must be relit;
      low warmth makes spiders bolder and frosts the screen (no damage at first); window repair costs time and a log;
      ceiling spiders that snuff lights (rarer on easy).
   6. Spiders: new human-faced and gaunt models (pick from rendered variants first), retreat when hurt, resistances,
      an egg-layer outside, webs on windows you hit to clear, window jump scares (a real spider, at most once a wave).
   *(Sessions 4–6 are folded into the horror rework below, 2026-11-15.)*
6. Environment from Blender: trees, foliage, cabin props, walls, floors, ceilings.
7. Horror rework (playtest notes and brief, 2026-11-15), in six sessions:
   - A. Horror and combat basics: no glass, planks with gaps, leg clipping, attacks timed to the animation and
     sooner, leaps, the window jump, faster spiders, darker night, stronger beam, phone visibility. *(done 2026-11-15)*
   - B+C (merged by the user, 2026-11-15). *(started: planks moved off the middle, window jump softer, the stove fire
     lights the room and burns down, logs each wave for the fire or for nailing planks back on)*
     Still to do: inventory in the in-game style with pictures of the weapons and bandages, less text on screen, the
     clock bigger and moved with its time left shown when you look at it; placement tool, the ammo table run along the
     wall (bandages lie on it, heal there).
   - D. Warmth (only draws spiders when low) and lights; gunshots draw nearby spiders.
   - E. Creatures: two species per size (small, medium, large), human-spider fusion, faces sculpted from the
     user's references, behaviours per species (reactions to being shot, ambush, retreat). Replaces the fat Sac.
   - F. Weapons and sound: fists → axe → pistol → rifle → shotgun (+ flares), Blender models, a new sound batch.

The long-term goal is a semi-open-world survival horror; behaviours and assets should carry over to it.

## Later (wanted, not scheduled)

Crouch, score and saves, story/intro, recorded audio, a day/night survival cycle. (Barricade repair and more weapons
moved into milestone 5.)

## Not building

Music during play, cheap stings (a loud noise over nothing), pixelated/retro filters in the game view (the terminal
menus are the one exception).
