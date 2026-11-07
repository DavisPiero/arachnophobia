# State

**Where we are:** milestone 1 (playable prototype) signed off and live at https://davispiero.github.io/arachnophobia/ (main).

**Next:** play it on desktop and on a phone, then a tuning pass from your notes: sound levels, spider look, difficulty,
the rifle model. Then put it in front of one person who has never seen it and ask where they first got stuck.

**Open with you:**
- Guesses to confirm: ammo numbers (8 / 40 / +16), 3 s reload, bullets passing through glass, spiders coming inside after a breach,
  stalkers fleeing light, no flashlight. All in DECISIONS.md.
- Nobody has listened to the sounds yet; levels were set by measurement.
- Phone performance is untested on a real device.

**Tools:** `dev/spiders.html` (spider viewer), `dev/world.html` (world views), `dev/sounds.html` (sound board), `?debug=1` in the game.
`npm test` is the quick check (~1.5 min, one line); `node tests/soak.mjs` runs a bot through the waves.
