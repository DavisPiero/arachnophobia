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
- Spiders no longer freeze when looked at (the Grinner charges instead of stopping to stare); the menu track restarts
  from 0:00 with a fade when it ends; new settings: field of view, crosshair, HUD opacity, show fps.

**Main menu overhaul (2026-11-11, in progress on branch `claude/menu-overhaul`, not merged):** your brief — better
models/materials, composition, ambient animation, lighting/post, a cinematic begin→gameplay transition, and the
menu music. Built so far:
- Wall spider is now the real Grinner model (code fallback kept); menu CRT bigger/closer as the focal point,
  secondary monitors and papers pushed back; shadows, contact shadows, subtle bloom, warmer/cooler light split;
  live waveform monitors, a second spider that scuttles the back wall irregularly, a swaying note.
- Begin now dissolves the menu text, fades to black (not a hard cut), and fades up into the cabin instead of
  popping. Boot log extended into a run of failures, retimed against the music's build-up into the "kick"
  (`Config.loading.minSeconds` 7 → 9.7s); a real blinking cursor on `login:`.
- Music: installed ffmpeg (one-time, your OK) and rebuilt the loop itself (`js/audio/Music.js`) to crossfade the
  next pass under the current one near the end, instead of restarting from silence.

**Not done / needs your steer:**
- Phase A's other half — new Blender-made CRT/desk/notes models with real CC0 materials (the biggest, riskiest
  piece of the brief, not started) — vs. the swap already done being enough for now.
- "Remake the track with the drums continuing through most of the song": not deliverable as asked (no stems, no
  reliable way to isolate drums from the finished mix); the loop crossfade above is the realistic version of
  "more loopable." The boot-log beat-timing is a best guess from an automated scan, not confirmed by ear.
- None of this has been tested by ear (menu music still won't decode in the headless test browser) or played
  by hand yet.

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
