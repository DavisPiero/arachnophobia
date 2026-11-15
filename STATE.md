# State

**Where we are:** the horror rework (SPEC "Second iteration" 7). Session A done. **Sessions B and C are merged
(your call) and started** on branch `claude/horror-bc` (2026-11-15, not merged yet): planks moved off the middle of the
window, a softer window jump, the stove fire lights the room and burns down, logs each wave for the fire or the planks.

**Next in B+C:** the inventory in the in-game style with pictures, less text on screen, the clock bigger and moved
(time left when you look at it); the placement tool; the ammo table along the wall with bandages on it.
Then D (warmth reads the fire, lanterns, gunshots draw spiders), E (creatures, needs your references), F (weapons, sounds).

**Built or not:**
- Built: planks and gaps, window jump, leaps, darker night, stronger beam, stove fire light, logs, nailing planks back.
- Not built yet: B's UI, placement tool, table along the wall, healing at the table, warmth (D), lanterns going out (D),
  gunshots drawing spiders (D), new creatures (E), pistol and new weapon order (F), new sounds incl. a fire crackle (F).

**Open with you:**
- **Log numbers (guesses):** 3 at the start, +3 a wave; a log burns 55 s; a plank costs one log and 2.4 s of nailing.
  Should logs be carried one at a time from the stack (more walking, more tension) instead of a count?
- **Phones:** spider on the floor 2 m ahead sits behind the fists and buttons. Lower the fists' guard on phones?
  (Recommendation: yes.) Which phone or tablet was it?
- **"Targeting lights":** lanterns that spiders go for and put out, which you relight? (my guess)
- **Hand-sculpted faces:** send the references before session E.
- **Cabin:** is the two-room cabin still wanted, with the long table along a wall?
- **Older guesses to confirm:** plank health 80 × 4; window jump after 3.5–6 s at a window; leap ranges; speeds;
  flare counts, fist damage 14, shotgun 9 pellets.

**Tools:**
- `npm test`; `node tests/fistbot.mjs`; `node tests/brightness.mjs`; `node tests/locomotion.mjs` (over its pop limit
  since before A).
- `?debug=1`: **G** every weapon, **N** ends the wave, **U** a runner inside, **B** tears planks off every window.
