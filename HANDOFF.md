# Hand-off

*Session of 2026-11-07. Replaces any earlier note.*

## Repo state
- `main` is the only branch, clean, pushed. Milestone 1 is signed off and live at https://davispiero.github.io/arachnophobia/.
- The quick test (`npm test`) passed locally and against the live site after the last code change.

## Read first
1. `CLAUDE.md` (hard rules, commands, code layout)
2. `STATE.md` (where we are)
3. `SPEC.md` (what makes it good; "Later" list = wanted later, not rejected)
4. `DECISIONS.md` (every guess made so far)

## What comes next
- The user plays it on desktop and on a phone and brings notes. Expect a tuning pass on: sound levels and the weakest sounds
  (spider scream/pain, brute breathing, glass scratch, rain), spider looks (plain head, stick-like palps, hair too spiky),
  the rifle model, darkness of the ground outside the north/west windows, difficulty and ammo numbers.
- Then: first outside tester, and ask where they first got stuck.

## Open questions for the user
1. Are the ammo numbers right (8 per magazine, 40 at start, +16 per wave) and the 3 s reload?
2. Should bullets pass through glass without breaking it (current), or should shooting break your own window?
3. Spiders come inside after a breach and attack you — keep?
4. Stalkers vanish when you get close or a flash lights them, then attack after two vanishes — keep?
5. No flashlight — confirm.
6. How do the sounds sound? Nobody has listened yet.
7. How does it run and control on your phone? Untested on a real device.

## Testing rules (from the user)
Keep tests cheap: `npm test` in the background, do not poll, read at most one or two screenshots per change,
use `--full` / `--shots` / `tests/soak.mjs` only when actually needed.
