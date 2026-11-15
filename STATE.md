# State

**Where we are:** the horror rework (SPEC "Second iteration" 7, sessions A–F). **Session A is done** (2026-11-15):
planks instead of glass, leaps, the window jump, quicker and closer attacks, faster spiders, a darker night and a
stronger beam measured by a test, legs kept out of the roof, hints moved off the floor on phones.

**Next:** session B (UI): the inventory in the in-game style with pictures of the weapons and bandages, less text on
screen, the clock bigger and moved, time left when you look at it. Then C (cabin, long table, boarding up),
D (warmth, lights, gunshots draw spiders), E (creatures, needs your references), F (weapons, sounds).

**Built or not (so nothing reads as done when it is not):**
- Built: planks and gaps, window jump, leaps, darker night, stronger beam.
- Not built yet: boarding up (C), healing at the table (C), warmth and lights (D), gunshots drawing spiders (D),
  new creatures and two species per size (E), pistol and the new weapon order (F), new sounds (F).

**Open with you:**
- **Phones:** a spider on the floor 2 m ahead sits right behind your fists and the Stomp/Use buttons. I moved the
  hints to the top. Shall I lower and narrow the fists' guard on phones, or add a gentle look-assist towards spiders
  inside on touch? (Recommendation: lower the guard.) Which phone or tablet was it?
- **"Targeting lights":** lanterns that spiders go for and put out, which you relight? (my guess)
- **Hand-sculpted faces:** I sculpt them in Blender from your references; send the references before session E.
- **Cabin:** is the two-room cabin still wanted, with the long table along a wall?
- **Guesses to confirm:** plank health 80 × 4; the window jump after 3.5–6 s at a window, 14 damage; leap ranges and
  damage; the new speeds (see DECISIONS.md, 2026-11-15). Older: flare counts, fist damage 14, shotgun 9 pellets.

**Tools:**
- `npm test` quick check (now also the window jump and a leap); `node tests/fistbot.mjs`; `node tests/brightness.mjs`
  (now also the night outside, dark and in the beam); `node tests/locomotion.mjs` (was already over its pop limit).
- `?debug=1`: **G** unlocks every weapon, **N** ends the current wave, **U** puts a runner inside in front of you,
  **B** tears planks off every window.
