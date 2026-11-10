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
- 2026-11-07 — Spider hitboxes enlarged (1.7 × 2.4 × 1.4 of the body) so shots aimed at the creature, not just its tiny body, count.
- 2026-11-07 — `npm test` runs at low quality in small viewports and prints failures only (~1.5 min). Full/visual runs only on request; they burnt time and tokens.
- 2026-11-07 — Milestone 1 guesses confirmed by the user: ammo 8/40/+16, 3 s reload, bullets through glass, spiders inside after a breach, vanishing watcher.
- 2026-11-07 — Flashlight added (user's call), toggled with T / a touch button. Windows stay darker from afar; the beam shows the near room and scares off watchers.
- 2026-11-07 — "Everything made in code" rule removed. Assets come from Blender generator scripts or hand-made .blend files; code-made versions stay as fallbacks.
- 2026-11-07 — Jump scares only when the player dies (user's call). Everything else builds dread, not jolts.
- 2026-11-07 — Second iteration split into milestones: 2 pipeline+fixes+feel, 3 hands/weapons/combat, 4 nine species+locomotion, 5 horror, 6 environment assets.
- 2026-11-07 — Nine species now; the system takes a tenth as one data entry. Runner→Crawler, Brute, Climber kept, old stalker behaviour→Watcher, new Stalker is the long-legged ambusher.
- 2026-11-07 — Weapon becomes a lever-action rifle (wood stock and forend) in milestone 3; 8-round tube fits the magazine size.
- 2026-11-07 — Exported .glb files are committed (GitHub Pages serves them). No Git LFS. Budget: each file under ~2 MB, whole game under ~25 MB.
- 2026-11-07 — Species details go in SPECIES.md, not the spec, so the spec stays short.
- 2026-11-07 — Pipeline: Python generators run in background Blender, bake high→low (colour, normals, roughness, AO), then gltf-transform (WebP + meshopt). Params JSON shared by Blender and game.
- 2026-11-07 — A hand-made blender/source/<name>.glb wins over the generator, so the user's own art always replaces the scripted pass.
- 2026-11-07 — Variants of one family share a texture atlas and are drawn as one instanced mesh each: few draw calls on phones.
- 2026-11-07 — Second light is a wall lamp on the west wall at the north end (not by the door as planned): that end was the darkest, the door end already has the table candle. Guess.
- 2026-11-07 — Night fog is near-black instead of blue-grey, so the forest gets darker with distance. Window darkness from afar 0.965 → 0.58.
- 2026-11-07 — Flashlight on T (F is taken by the axe in milestone 3). Guess. No battery: not asked for.
- 2026-11-07 — Sprint is unlimited (no stamina): not asked for, and the cabin is small. Revisit for the open world.
- 2026-11-07 — Aim down sights: field of view x0.74, spread x0.25, look x0.8, walk x0.6; can't fire while sprinting. Touch: AIM is a toggle, sprint = joystick past its edge.
- 2026-11-07 — Smallest spiders (runner) scaled 1.4x through Config.spiders.runner.scale, which is now actually used.
- 2026-11-07 — Mobile zoom: CSS touch-action on every layer plus a script that cancels double-tap, pinch and Safari gesture events, and snaps back if the page zoomed anyway.
- 2026-11-07 — Milestone 2 signed off by the user, merged and live. Note from play: rock textures look low quality and blurry; fix with milestone 3.
- 2026-11-07 — Rocks: one packed 2048 atlas (fewer, bigger UV islands, same texel density), normal map at WebP 96, plus a tiling grain texture in the game. Fixes the blurry rocks.
- 2026-11-07 — Night brighter: moon 0.5→0.7, sky fill 0.6→0.85, fog 0.046→0.034 and a touch less black. Numbers now in Config.night.
- 2026-11-07 — Window darkening removed (user's call). Windows are always clear; `closeness` still tells a watcher it was seen. Spec pillar 1 rewritten.
- 2026-11-07 — Flashlight on Q (user's call), F is the axe, V the stomp, E is interact only.
- 2026-11-07 — Lever cycle 0.5 s between shots (user's call); damage 34→40 so a runner still dies in one shot and a brute in five.
- 2026-11-07 — Gloved hands (user's call): leather work gloves, dark waxed-canvas sleeves.
- 2026-11-07 — Hands are rigid posed meshes (fist, forend support, cartridge pinch, axe fist) animated in code, not armature animations. Gloves hide fingers, and code poses are easier to tune. Guess.
- 2026-11-07 — Axe reaches a spider through a cracked or broken window; swinging at intact glass only cracks your own glass (recommendation accepted).
- 2026-11-07 — Stomp kills runners (the small ones) on the floor; anything bigger is shoved back 0.5 m (recommendation accepted).
- 2026-11-07 — No hit marker: hit feedback is on the spider (jolt, leg kick, spray, splats, kill crunch, death thrash) (recommendation accepted).
- 2026-11-07 — Ichor is a pale sickly yellow-green so it reads at night. Guess: the spec says "blood".
- 2026-11-07 — Splats stay until the next wave starts; splats on glass go when the glass shatters. Guess.
- 2026-11-07 — The boot is drawn in the world (on the real floor), with a matte material: glossy trousers seen from above read as white cloth.
- 2026-11-07 — Hit direction pushes the view away from the attacker (yaw, roll) on top of the random shake.
- 2026-11-07 — Milestone 3 signed off by the user and merged to main. Notes on the gloves, gun and axe to come next session.
- 2026-11-07 — Viewmodel art redo (user's notes: everything low-poly and low-res). Generators layer CC0 photo-scanned textures from ambientCG (user approved); only baked results are committed.
- 2026-11-07 — Budgets raised: rifle ~12k tris and hands ~7k per arm with 4096 atlases, axe and legs 2048; phones load `<name>_low.glb` with half-size textures. Files up to ~5 MB each.
- 2026-11-07 — Gloves: full fingers, hard knuckle guard, dark olive-black (user's choice from two references). Knuckle pads on the fingers dropped: they floated off fingers pressed onto the stock.
- 2026-11-07 — Hands are one skeleton bent into poses in Blender (still rigid posed meshes in the game). Fingers wrap the real held shape and are pressed out of it; `blender/tools/clipcheck.py` checks nothing passes through.
- 2026-11-07 — Trigger hand per the user's photo: hangs off the stock wrist, thumb on the right side, fingers wrapped onto the left, wrist bent ~60°. Support hand: palm under the barrel, thumb up the left, fingers up the right (user's call).
- 2026-11-07 — Rifle hip position moved from ViewModel.js into rifle.json `view`, so the game and the Blender check render read one number. Values unchanged.
- 2026-11-07 — Legs visible when looking down (user approved): cargo trousers, boots, belt and the bottom of the jacket, standing 0.24 m behind the eye; legs swing when walking; the right leg hides while the stomp boot is out.
- 2026-11-07 — Splats are dark red and fade after 3 s + 2 s (user's call): they blocked the windows. Replaces "ichor yellow-green, stays for the wave".
- 2026-11-07 — Rifle reworked after the side-gate reference: round barrel, closed big-loop lever, checkered walnut, rubber butt pad, buckhorn rear sight, brass bead. Axe after the forest-axe reference: bearded bit, hooked handle swell. No maker's marks.
- 2026-11-07 — Milestone 4 started. Order: quick fixes first (cabin, weapon switch, stomp key, burst deaths), then spider models and locomotion.
- 2026-11-07 — Cabin 9 × 12 m (1.5×, user's call) and 3.0 m to the ceiling (user: "a little bit taller"). Windows stay 1.1 × 1.0 m, so the squeeze matters. Furniture positions now live in Layout.js `FURNITURE`.
- 2026-11-07 — Lantern 11.5 → 15 for the bigger room; no new lights. Guess.
- 2026-11-07 — Weapon switch: 1 rifle, 2 axe, 0.45 s swap; click swings the held axe; the F quick-swing is gone (user agreed). Reloading switches back to the rifle. Touch: the AXE button swaps and names the other weapon.
- 2026-11-07 — Stomp moved from V to C (user's call).
- 2026-11-07 — Killed spiders burst into chunks instead of thrashing (user's call): wet red lumps, bits of shell, pieces of their own legs; they fall, bounce, stick to and slide down walls, then fade (4 s + 2 s). Two instanced meshes, so no extra draw calls.
- 2026-11-07 — Trigger and support forearms angled 10° further down (user: yes). Sleeves are still large when aiming.
- 2026-11-07 — Spider look is a mix (user agreed): runner and climber dark with red eyes, brute pale-legged with a skull-like plate and quills, stalker pale with two huge black eyes. Traits borrowed from the references, no creature copied.
- 2026-11-07 — Spiders are one smooth skinned mesh per species from Blender; the game rebuilds the skeleton from the generator's rest pose (.json), and the existing leg code drives it. Mesh compression's position offset is recovered from the bind data on load.
- 2026-11-07 — Spider stance flattened (shorter legs relative to foot distance): the first build stood like a harvestman with knees far above the body.
- 2026-11-07 — Brute gait: one leg at a time (wave); the rest alternate sets of four. Feet land on the real terrain; the body lifts and tilts with its feet.
- 2026-11-07 — Window entry: every leg grips the frame on the side of the wall it reaches for, re-gripping one at a time, the body narrows as it passes the wall. Squeeze speeds: runner 1.4, climber 0.7, stalker 0.55, brute 0.45 m/s (a brute takes about 5 s). Guess.
- 2026-11-07 — Five more species written up in SPECIES.md as guesses (stilt, swarmling, weaver, burrower, mother); not built.
- 2026-11-09 — Death chunks: no leg pieces (user's call); torn marbled meat, pale gristle and shell bits, high-res (three instanced meshes).
- 2026-11-09 — Windows 1.2× (1.32 × 1.2 m) and raised 15 cm (centre 1.60 m, sill 1.0 m) (user's call; height a guess the user agreed to).
- 2026-11-09 — Cracked glass redrawn: branching (fractal) radial cracks with web rings, thin light-blue lines, mostly clear (user: too hard to see out).
- 2026-11-09 — First-person legs and stomp boot removed (user's call: lighter, not wanted). Stomp still kills; small spiders of any species die to it.
- 2026-11-09 — Horror everywhere, not only at death (user's call): "the only jump scare is your death" is gone from the spec. No cheap stings.
- 2026-11-09 — Species and models are separate (user's call): a species names its model. Five of each for now: runner/Knot, brute/Sac, climber/Flayed, stalker/Grinner, weeper/Weeper. Replaces the nine-species plan; the old four models are gone.
- 2026-11-09 — Faces: human smiles with teeth and black human eyes, no noses (user's call). Made by the generator, not hand-sculpted.
- 2026-11-09 — Three sizes per model from one mesh (scale + body weight + health/speed/damage), not three meshes.
- 2026-11-09 — Locomotion rebuilt in modules: LegIK (soft reach, knee splay, no flips), Gait (neighbour rules, demand-driven feet in the air), BodyDynamics (springs), SpiderCollision (analytic shapes from Layout.js). Causes of the old twitching: ankle snap at full reach, leg plane flips, last-frame stretch feedback, urgent steps breaking the gait.
- 2026-11-09 — Squeeze: legs grip the frame, the body drops and rolls to fit; nothing shrinks except a soft abdomen (the Sac).
- 2026-11-09 — Behaviour layer (Behaviour.js): per-species personality, reacts to being looked at, light and distance; attacks in four beats with lunge, flurry, slam and feint, never the same twice in a row. Hits shove the player.
- 2026-11-10 — Playtest notes triaged into six sessions (SPEC "Second iteration" 5); the user accepted every recommendation and merged session 3 (front end) into session 1.
- 2026-11-10 — Spider look rewritten (user): more human faces, some gaunt; still flesh, no exposed bone. Pillar 4 rewritten. New models wait for session 6, with a pick-from-variants round before baking.
- 2026-11-10 — Grinner: "only moves while unseen" removed (user: not a good feature). Now it stops and stares when looked at or lit, then charges. Its tree-line watching stays. Guess: that part was not the complaint.
- 2026-11-10 — Overturned chair removed; the candle on the ammo table is now a standing hurricane lantern like the wall lamp (user's call).
- 2026-11-10 — Window glass is unlit (MeshBasic, 12% tint): no flashlight glare (user's call). Flashlight range 26 → 48 m, intensity 42 → 70.
- 2026-11-10 — Desktop fog 0.034 → 0.052 (darker with distance); phones keep 0.034 (user: phones are already too dark).
- 2026-11-10 — Pause button top-left, 58 px on touch, above the touch zones (they covered it: the cause of "the pause button doesn't work"). No mute button on touch devices.
- 2026-11-10 — One terminal look for every screen (boot gate, loading log, CRT main menu on a lab bench with a notebook and webs, pause, game over, settings). Fonts: VT323, Reenie Beanie (Google Fonts).
- 2026-11-10 — A boot gate ("press any key") comes first: browsers only allow sound after a gesture, and the music must play during loading.
- 2026-11-10 — Menu music: the user's track, starts at 1:18 fading in over 6 s, jumps to 1:26 when the loading screen ends (at least 7 s), loops 1:26 to the end on the menu, fades out when play starts. Re-encoded to AAC 128 kbps (1.9 MB). Own volume slider.
- 2026-11-10 — Settings (saved per browser): Gameplay (look speed, invert, hints), Graphics (quality auto/low/high on reload, film effects, brightness), Audio (4 volumes, mute), Controls (every key rebindable; touch shows its layout).
- 2026-11-10 — Text: "Silence" → "Wave N survived · fresh rounds are on the ammo table"; NO AMMO notice on an empty click; four one-time hints (start, windows, first crack, first empty).
- 2026-11-10 — Hits: red floods in from the hit's side, a brief darkening, a shaking health bar with a red trail, a heartbeat below 35 health.
- 2026-11-10 — Bounce: an under-damped spring on the held weapon, kicked by switching, every shot, and the axe's start, impact and recovery.
- 2026-11-10 — Kill sound rebuilt in three layers: burst (thump, shell, wet blast), a choked dying screech, chunks pattering for a second.
- 2026-11-11 — Main menu overhaul started (user's brief). The wall spider is now the real Grinner model from the game
  (code-made fallback kept), not a hand-coded shape: fits the notes ("the big one smiled, teeth like ours").
- 2026-11-11 — Menu composition reworked: the menu CRT is bigger/closer and the clear focal point; secondary monitors
  and papers pushed back and scaled down so they read as background.
- 2026-11-11 — Menu gets shadows, cheap contact-shadow discs, and a subtle bloom pass (off on the `low` tier); warm
  lamp vs. cool back light pushed further apart for contrast.
- 2026-11-11 — A second, small spider now scuttles irregularly across the back wall in the menu (the nailed one
  stays dead; only twitches). Waveform monitors redraw live instead of a static texture.
- 2026-11-11 — Begin → gameplay transition: the menu CRT text dissolves, the loading screen's own cut-to-black now
  fades (was instant), and a new `#enter-fade` overlay fades the game up from black instead of popping to it.
- 2026-11-11 — Installed ffmpeg (Homebrew, one-time dev tool, user approved) to work on the menu music. Rather than
  re-encoding the user's track, the loop itself was rebuilt in `js/audio/Music.js`: the next pass now starts and
  crossfades under the current one a few seconds before it ends, instead of fading from silence after a hard stop.
  Chose not to attempt "remake with continuing drums": no stems, and isolating drums from a finished stereo mix
  isn't something I can do reliably — flagged to the user as the one piece of their brief not really deliverable.
- 2026-11-11 — BOOT_LOG's failure run retimed against a crude onset scan of the track's build-up into the kick
  (scratchpad analysis, not confirmed by ear — no AAC decoder in the headless test browser, per the existing note
  above); `loading.minSeconds` raised 7 → 9.7s to fit the retimed log and land the menu reveal near the kick.
