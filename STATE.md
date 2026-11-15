# State

**Where we are:** the game is turning into a survival game (user, 2026-11-15). The plan is `SURVIVAL.md`: days outside
in a crater, nights defending the cabin, steps S0–S7. **S0 is done and merged:** the menu offers **Survival** and
**Waves**. Waves never ends (15 s breaks). Survival is still the old 10-wave night until S1.

**Next:** S1, going outside: the door opens, you walk the existing forest, trees are solid, spiders chase you in the
open. The riskiest step (spiders only know fixed lanes to windows today). Then S2 day and night, S3 gathering.

**Still wanted from the horror rework:** D (warmth, lanterns going out, gunshots draw spiders; folds into S5–S6),
E (creatures, needs your references), F (weapons, sounds, a fire crackle).

**Open with you (survival, my recommendation in brackets; I assumed yes to start S0):**
- Waves breaks 15 s and a weapon every two waves? (yes)
- A thin slice on today's map (S1–S3) before the crater? (yes)
- Outside: reload from a belt pouch and bandage anywhere, slowly? (yes, Survival only)
- No hunger or thirst at first? (yes)
- Death: lose the trip by day, replay from the morning at night? (yes)
- Day about 8 min, dusk 1, night 6? (yes, to tune by playing)
- Where is the lab (I put it far north) and how many sheds and den mouths (I guessed 3–4 sheds)?

**Open with you (older):**
- Clock position (move it with `dev/place.html`); bandages only at the medical table in Waves?
- Logs: numbers are guesses (3 at the start, +3 a wave, 55 s a log); the stack does not shrink yet.
- Phones: lower the fists' guard? Faces: references for session E. Is the two-room cabin still wanted?

**Seen in the assessment, not fixed (your call):** the flashlight is a blown-out white disc on anything close; a seam
in the cabin wall texture.

**Tools:** `npm test`; `node tests/fistbot.mjs`; `node tests/brightness.mjs`; `dev/place.html`.
`?mode=waves` with `autostart=1` starts Waves. `?debug=1`: **G** weapons, **N** ends the wave, **U** runner inside,
**B** breaks planks.
