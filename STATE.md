# State

**Where we are:** the horror rework (SPEC "Second iteration" 7). A done. **B+C (merged, your call) done**
(2026-11-15, merged into main): planks off the middle, softer window jump, harder board hits, stove fire light, logs for
the fire or the planks, scroll-wheel weapons, a slight lens bulge, the new inventory (slots, drag to reorder), less text, a bigger
clock you can read, the long table with bandages on it, and a placement tool.

**Next:** D (warmth reads the fire, lanterns that go out, gunshots draw spiders), E (creatures, needs your references),
F (weapons, sounds, a fire crackle).

**Built or not:**
- Built: everything above, plus session A.
- Not built yet: warmth (D), lanterns going out (D), gunshots drawing spiders (D), new creatures (E), pistol and new
  weapon order (F), new sounds (F). Inventory pictures are drawings, not renders of the models.

**Open with you:**
- **Clock:** where should it hang? It is on the south wall, just left of the table's middle (my guess). Move it with
  `dev/place.html` (run `npm start`, open http://localhost:8173/dev/place.html, drag, Save).
- **Bandages only at the metal medical table.** H elsewhere says so. Keep it, or let H work anywhere again?
- **Logs:** you carry one at a time from the stack (floats in front of you for now; hands later?). Numbers still guesses: 3 at the start, +3 a wave, 55 s a log. The stack does not shrink yet.
- **Phones:** lower the fists' guard so a spider 2 m ahead is not hidden? (Recommendation: yes.) Which device?
- **"Targeting lights":** lanterns that spiders go for and put out, which you relight? (my guess, for D)
- **Faces:** send the references before session E. **Cabin:** is the two-room cabin still wanted?

**Tools:**
- `npm test`; `node tests/fistbot.mjs`; `node tests/brightness.mjs`; `node tests/locomotion.mjs` (over its pop limit
  since before A). `dev/place.html` placement tool.
- `?debug=1`: **G** every weapon, **N** ends the wave, **U** a runner inside, **B** tears planks off every window.
