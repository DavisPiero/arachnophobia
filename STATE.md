# State

**Where we are:** milestone 5 (the playtest notes of 2026-11-10), session 1 of 6 merged into main and live (2026-11-10). Plan for all six sessions: `SPEC.md` "Second iteration" 5.

Session 1 (with the old session 3 folded in):
- **Phone darkness:** hands and gun colours lifted ×3.4, a faint fill light on spiders, brighter exposure on
  phones. Measured by `node tests/brightness.mjs` (gun 4.7 → 15, spider 19 → 23).
- **Pause works on touch** (the invisible touch zones were on top of it), big, top-left; no mute button on touch.
- **Room:** chair gone, a hurricane lantern on the ammo table, glass no longer reflects the flashlight, beam ~45 m,
  desktop fog darker with distance.
- **Text and feedback:** NO AMMO, "Wave N survived", four one-time hints, hits flood red from their side, health bar
  with a damage trail, heartbeat at low health, weapon bounce, new kill sound. Grinner stares, then charges.
- **Front end:** boot gate → loading log → terminal main menu (CRT, notebook, webs) with your track; settings with
  four tabs (key rebinding included) on the menu and the pause screen.

Session 1b (UI notes, 2026-11-10):
- **Main menu is a 3D lab** built in code (`js/ui/MenuScene.js`): bench, notes, photographs, old monitors, a glass panel with a
  spider nailed behind it; depth of field and a slow drift. The menu (and settings opened from it) is warped onto the left
  monitor. Picking begin plays a short loading log. In-game screens stay terminal (notebook style tried, reverted).
- Music starts at the first key with an 8 s fade; cracks fewer and fainter; roof spiders hidden from inside; tests run
  desktop and phone in parallel at lower resolution.

**Next:** session 2: 10 timed waves to dawn, wall clock, fists and weapon unlocks, inventory on I, bandages, bed heal.

**Open with you:**
- **Harder now?** In 3 bot runs of 150 s the bot took damage on this build (one death) and none on the old one. Likely the
  Grinner's charge. Tell me if early waves feel too hard.
- **Phone darkness on your iPad:** I could not reproduce "black only on phones" (the phone tier measured the same as
  desktop); I made everything brighter. Does the iPad look right now?
- **Still unanswered:** spider sizes (large ×1.45, a big Sac ~4 m across); squeeze speed (~5 s for a big one);
  sleeves when aiming; phone double-tap.

**Tools:**
- `npm test` quick check; `node tests/brightness.mjs`; `node tests/locomotion.mjs` (slow, background).
- `index.html?mute=1&autostart=1` skips the gate, loading and music; `?menu=1` goes straight to the 3D menu.
