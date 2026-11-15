# State

**Where we are:** the survival plan (`SURVIVAL.md`) is down to four steps: S0 modes, S1 first day, S2 basin and
workbench, S3 the long game, S4 make it real. **S0 and S1 are done and merged.** Survival now starts in the morning:
open the door, walk the forest, pick up branches, ammo tins and yarrow, carry them home before dusk, hold the cabin
through a night of three waves, and wake to the next day. Waves mode is the old endless night, door boarded.

**Next:** play S1 by hand and tell me how it feels (day length, how much lies out there, the pack size, the spiders
chasing you outside). Then S2: the full crater with cliffs and places, and the workbench to spend what you gather.

**Still wanted from the horror rework:** D (warmth, lanterns going out, gunshots draw spiders; folds into S2–S3),
E (creatures, needs your references), F (weapons, sounds, a fire crackle).

**Open with you (survival; guesses stay guesses until you confirm, my recommendation in brackets):**
- S1 numbers: day 8 min, dusk 1, three waves a night, a pack of 6, 15 things out each morning. (Keep, tune by playing.)
- Waves breaks 15 s and a weapon every two waves? (yes)
- Outside: reload from a belt pouch and bandage anywhere, slowly? (yes, Survival only; planned for S3)
- No hunger or thirst at first? (yes)
- Death: lose the trip by day, replay from the morning at night? (yes; S3. Today dying still ends the run)
- Where is the lab (I put it far north) and how many sheds and den mouths (I guessed 3–4 sheds)?

**Open with you (older):**
- Clock position (move it with `dev/place.html`); bandages only at the medical table in Waves?
- Phones: lower the fists' guard? Faces: references for session E. Is the two-room cabin still wanted?

**Seen, not fixed (your call):** the flashlight is a blown-out white disc on anything close; a seam in the cabin
wall texture; `DECISIONS.md` is at 197 lines and will need its oldest phase archived soon.

**Tools:** `npm test`; `node tests/fistbot.mjs`; `node tests/brightness.mjs`; `dev/place.html`.
`?mode=waves` with `autostart=1` starts Waves. `?debug=1`: **T** skips to the end of the day/dusk/dawn, **G** weapons,
**N** ends the wave, **U** runner inside, **B** breaks planks.
