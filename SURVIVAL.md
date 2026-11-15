# Survival plan

*Draft of 2026-11-15, with the user's notes of the same day. S0 is built; nothing else is. Everything marked (guess)
is mine until you confirm it.*

## The idea in one paragraph

By day you leave the cabin and walk a misty crater: you forage, search places, chop wood and carry it home before
dark. By night the spiders come and you defend what you built. Each day you are a little better equipped and each
night is a little worse. The fear changes shape: at night it is "which window", by day it is "how far from home am I,
and how long until dusk".

**The loop:** wake → decide where to go → walk out → search and gather → watch the light → get home → spend what you
found (planks, traps, fire, ammo) → night siege → dawn.

## Two game modes

- **Survival** (new): days and nights, the crater, gathering, upgrades, saved at each dawn.
- **Waves** (what the game is now): the cabin only, and it **never ends**. No dawn after wave 10; waves keep growing,
  a weapon still arrives every two waves, and the death screen shows the wave you reached. Breaks cut from 30 s to
  15 s so you are always in action (guess).

Both modes share the cabin, spiders, weapons, windows, sound and HUD. Only the rules around them differ.

## What makes it good (and what I took from other games)

1. **The day is a clock, not a rest.** A trip only counts if you get home with time to use what you found. The wall
   clock becomes a pocket watch; the light and the sound tell you the same thing.
2. **Night is the exam for the day.** Whatever you nailed, lit and loaded is what you have. (Darkwood: explore by
   day, hold the hideout at night; the generator must have fuel or the lights die. Our stove and lanterns do this.)
3. **Nights grow with what you have.** More days survived means more and bigger spiders, and every fifth night is a
   **brood night**, much worse, that you can see coming and prepare for. (7 Days to Die: a horde every 7th day, scaled
   to progress.)
4. **Noise and light have a price.** Gunshots by day pull things toward you; a cold dark cabin at night makes them
   bolder. This is session D's warmth and "gunshots draw spiders", folded in.
5. **Dying outside costs the trip, not the run.** You wake in the cabin at dusk without what you carried.
   (Darkwood takes half your pack.) Dying at night returns you to that morning.
6. **No meters for their own sake.** No hunger or thirst in the first version (guess). The clock and the night are
   the pressure. Food can come later as a bonus, not a chore.
7. **Daylight is nearly safe, and that is the point** (user, 2026-11-15). By day there are far fewer spiders: they
   appear very sparsely and only around **dens**, the mouths of the underground tunnel system. Keep away from a den
   and the day is quiet; go near or into one and it is not. Fog in the basin still keeps sightlines short.
8. **Weapons are found, not handed out** (user, 2026-11-15). In Survival you unlock a weapon by finding its chest in
   an abandoned shed, a tunnel or a place like them. (Waves keeps "a new weapon every two waves".)

## The crater

A basin about 280 m across (guess), ringed by cliffs you cannot climb, so the map has an edge that looks natural. The
cabin sits a little off-centre. Walking rim to rim takes about 90 s at a run. The three window views stay as they
are (north pines, east clearing, west creek) and simply continue outward.

Places to find, each with one thing it is best for (all guesses, and they tie to the boot screen's containment breach):

| Place | Where | What it gives | Danger |
|---|---|---|---|
| Old shed | west, close (exists) | tools, nails, the first weapon chest (guess) | low |
| Creek and fallen trees | west | wood, herbs for bandages | low |
| Dead tree line | east | dry wood, fast | open ground, you are seen |
| Wrecked convoy truck | south road | ammo, fuel, cloth | medium |
| Ranger watchtower | north-east rise | a view of the basin; marks places on your map | climbers |
| **The lab** (user) | far north (guess) | a big facility ringed by chain-link fence: medical supplies, notes, late upgrades, a weapon chest | high; find the gap in the fence |
| Abandoned sheds | scattered, 3–4 (guess) | each may hold a weapon chest | low to medium |
| Dens and the tunnels (user) | several mouths around the basin, joined underground | scrap, weapon chests deep inside | the only place spiders are by day; dark even at noon |
| The breach | far west, under the cliff | where they come from; the end goal later | very high |

## What you carry and what you make

Five things to gather, no more (guess): **wood, scrap** (nails, metal), **cloth and herbs** (bandages), **fuel**
(lamp oil), **ammo**. A backpack with limited room, so every trip is a choice. A stash in the cabin.

A **workbench** in the cabin turns them into:

- **Windows:** plank → double plank → iron bars. The door becomes a real door you bar at dusk.
- **Traps and warnings:** nail boards under a window, tin-can tripwires that tell you which side they are on.
- **Light:** lanterns on posts outside (spiders avoid them and put them out), a longer-burning stove.
- **You:** bigger backpack, sharper axe, a longer rifle tube, a belt pouch for loose rounds.

**Two existing rules need a survival version** (your call, see the questions): reloading only at the table, and
bandaging only at the medical table. Recommendation: outside you reload from a small belt pouch, slowly and standing
still, and bandage anywhere, slowly. The table stays the only place with the big stock.

## How we get there: eight steps, each one playable

Order matters: first a thin slice of the whole loop on the map we already have, then make the map big.

| Step | What you can do when it is done | Main files |
|---|---|---|
| **S0 Modes** *(done 2026-11-15)* | Menu offers Survival and Waves. Waves runs forever. Survival is the same night for now. | `Config.modes`, `WaveSystem.js`, `Game.js`, `Menu.js`. `Game.js` is not split yet: that waits until Survival has rules of its own (S1–S2) |
| **S1 Outside** | Open the door and walk the existing forest. Trees and rocks are solid. Spiders chase you on open ground. | `Player.js`, `Layout.js`, `Forest.js`, `Cabin.js` (door, outside walls), `SpiderAI.js`, `SpiderPaths.js` |
| **S2 Day and night** | The sun comes up and goes down: sky, fog, light, sound. A pocket watch. A dusk warning. | `Lighting.js`, new `js/survival/DayCycle.js`, `Director.js`, `brightness.mjs` gets a day check |
| **S3 Gather** | Pick things up, search containers, chop fallen trees, fill a backpack, stash it at home. | new `js/survival/Items.js`, `Pickups.js`, `Inventory.js` (Items tab exists), `Firewood.js`, `AmmoTable.js` |
| **S4 The basin** | The full crater with cliffs, the places above as simple block shapes, a hand-drawn map. | new `js/world/Basin.js`, `Forest.js` in chunks, `Layout.js`, `dev/place.html` learns to place landmarks |
| **S5 Workbench** | Spend what you found: window tiers, door, traps, lanterns, pack and weapon upgrades. | new `js/survival/Crafting.js`, recipes in a data file, `WindowSystem.js`, `Cabin.js` |
| **S6 The long game** | Nights scale by day, brood nights, dens and tunnels with their few daytime spiders, weapon chests, death rules, save at dawn. | `WaveSystem.js`, `SpiderAI.js`, new `js/survival/Save.js` |
| **S7 Make it real** | Blender models for the places, new sounds, notes to find, first stranger playtest. | `blender/`, `SoundBank.js` |

After **S3** there is a complete small game: go out, bring wood and ammo home, survive the night. That is the first
build to put in front of someone who has never seen it.

Sessions D (warmth, lights), E (creatures) and F (weapons, sound) from the horror rework are not dropped: D folds
into S5 and S6; E and F can run alongside whenever your references are ready.

## What is hard (said plainly)

- **Spiders in the open.** Today every spider follows a fixed lane to a window. Outside they must steer around trees
  toward a moving player. Their legs already work on rough ground; the thinking is the new part. This is the biggest
  risk and it is in S1 on purpose, so we find out early.
- **The cabin from outside.** It has only ever been seen from within. Roof, walls and posts will need work up close.
- **Phones.** A big forest is expensive. Plan: build it in tiles so only nearby ones draw, and let the basin's fog set
  how far you see (shorter on phones). Three.js does not hide off-screen instanced trees by itself, so tiles are needed.
- **The tunnels.** An underground system is a second, indoor map. First version: short dead-end dens; joined tunnels later.
- **`Game.js` is over 600 lines.** S0 only added a mode switch; it must be split when Survival gets its own rules.
- **Scope.** This is several times the size of the horror rework. Each step should be signed off before the next.

## Not in this plan

Hunger and thirst, other survivors or traders, vehicles, building anywhere but the cabin, multiplayer, music in play.

## Questions for you (my recommendation first)

1. **Waves mode breaks:** 15 s, and keep "a weapon every two waves"? (Yes to both.)
2. **Start with a thin slice on today's map (S0–S3) before building the crater?** (Yes.)
3. **Reload and bandage outside,** slowly, from what you carry? (Yes, survival only; Waves keeps the tables.)
4. **No hunger or thirst** in the first version? (Yes.)
5. **Death:** lose the trip by day, replay from the morning at night? (Yes.)
6. **Day length:** about 8 minutes of day, 1 of dusk, 6 of night? (Yes, as a first guess to tune by playing.)
7. **The story spine:** the breach under the west cliff as the place you eventually close? (Yes, but not before S7.)
