# State

**Where we are:** milestone 5 (the playtest notes of 2026-11-10). Sessions 1, 1b, the main menu overhaul and
**session 2 (waves and weapons)** are merged into `main` and pushed. Plan for all six sessions: `SPEC.md` "Second
iteration" 5.

**Session 2 (2026-11-14), what is in:**
- **10 timed waves to dawn** (1:30 of spiders, then 30 s), a wall clock 10 pm → 6 am, a "Dawn." win screen.
- **Bandages** (one per wave survived, max 3, H) and **the cot** (full heal once per break). **Difficulty** easy/normal/hard.
- **Weapons unlock as the night goes on:** fists from the start, rifle for wave 3, axe 5, shotgun 7, flares 9. Each
  arrives in the break before its wave, named on the "survived" banner.
- **Fists** punch left/right (hold to keep punching). **Shotgun**: two shells, a spread; shells have their own box on
  the ammo table. **Flares**: throw at the window you look at; while it burns (30 s) spiders keep away from it.
- **Inventory on I** (touch: pause → inventory): pauses, lists weapons (locked ones greyed), remaps keys 1–5.

**Merged 2026-11-15:** new fists (real closed-fist model, straight wrist, jab) and a CRT
glitch power-on for the menu monitor instead of the bounce.

**Next:** session 3 of the plan is merged into 1, so **session 4: the cabin** (placement tool, bigger cabin in two rooms,
door, benches, log tray). Read `SPEC.md` 5.4 first.

**Open with you:**
- **Windows are all broken by wave 3.** With fists only, spiders have to get in before you can fight them, so the bot
  ends wave 2 with every window breached, and nothing repairs them until session 5 (repair costs time and a log).
  The rifle then never gets to "shoot them at the glass". Options: bring window repair forward, or let windows mend
  between waves for now. Your call.
- **Guesses to confirm:** weapons unlock in the break *before* their wave; fist damage 14 (a medium climber takes 5);
  shotgun 9 pellets × 16; flares 2 on unlock, +1 a wave; a flare lands on the ground outside the window (it does not
  break the glass); spiders driven off by a flare fade into the dark rather than walking away.
- From before: a wave never ends while spiders live; bandage heals 35; cot 4 s; easy/hard = 0.7× / 1.3× spiders.
- **Still unanswered:** phone darkness on your iPad; spider sizes; squeeze speed; sleeves when aiming; phone double-tap.

**Tools:**
- `npm test` quick check; `node tests/fistbot.mjs` (fists-only waves 1–2, ~1 min); `node tests/brightness.mjs`.
- `?debug=1`: **G** unlocks every weapon, **N** ends the current wave, **U** puts a runner inside in front of you.
