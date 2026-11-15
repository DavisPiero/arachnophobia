// Every tuning number in one place. Change freely; nothing else hard-codes these.
export const Config = {
  player: {
    eyeHeight: 1.65,
    radius: 0.3,
    walkSpeed: 2.6,          // m/s
    accel: 14,               // how fast you reach walk speed
    maxHealth: 100,
    lookSensitivityMouse: 0.0022,   // radians per pixel
    lookSensitivityTouch: 0.0055,
    pitchLimit: 1.45,        // radians up/down
    stepInterval: 0.52,      // seconds between footsteps at full speed
    headBob: 0.028,          // metres
    sprintMultiplier: 1.75,  // Shift: speed x this (forward only, not while aiming or reloading)
    sprintBob: 1.5,          // head bob x this while sprinting
    sprintStepVolume: 1.35,  // footsteps louder when running
    aimMoveMultiplier: 0.6,  // walking speed while aiming down sights
  },
  flashlight: {
    intensity: 110,          // candela-ish; was 70 with decay 2 (user: stronger, more useful)
    range: 60,               // metres; beyond this it lights nothing
    angle: 0.3,              // radians, half-angle of the cone (was 0.34: a tighter, brighter beam)
    penumbra: 0.6,           // soft edge
    decay: 1.2,              // was 2: a real 1/d² beam was gone by 7 m; this one still lights a spider at 15 m
    color: 0xffe2b8,         // old incandescent bulb
    scareRange: 22,          // a watcher caught in the beam closer than this slips away
  },
  weapon: {
    magSize: 8,              // rounds in the lever-action's tube magazine
    damage: 40,              // runner 30hp, climber 60, stalker 70, brute 190 (5 shots)
    fireInterval: 0.5,       // seconds between shots: one lever cycle (user's call)
    leverAt: 0.08,           // seconds after the shot when the hand starts working the lever
    range: 80,
    recoilPitch: 0.055,      // radians kick per shot
    recoilYaw: 0.012,        // random sideways kick per shot (radians, +/-)
    recoilRecover: 6,        // how fast it settles
    spread: 0.004,           // radians of random spread
    aimFov: 0.74,            // aiming down sights: field of view x this (a gentle zoom)
    aimSpread: 0.25,         // spread x this while aimed
    aimSpeed: 11,            // how fast the rifle comes up to the eye (1/s)
    aimLookScale: 0.8,       // mouse/touch look sensitivity x this while aimed
    fireBuffer: 0.15,        // a fire press this close to the end of the lever cycle fires as soon as it ends
    muzzleLight: 60,         // peak brightness of the room light from a shot
    switchTime: 0.45,        // seconds to swap rifle <-> axe (1 / 2): half lowering, half raising
  },
  // What you can hold, in the order the inventory lists them. A weapon unlocks once you reach its wave (it is ready in
  // the break before that wave starts). slots: the default 1–5 keys (the inventory on I remaps them).
  arsenal: {
    order: ['fists', 'rifle', 'axe', 'shotgun', 'flare'],
    unlock: { fists: 1, rifle: 3, axe: 5, shotgun: 7, flare: 9 },
    slots: ['fists', 'rifle', 'axe', 'shotgun', 'flare'],
    names: { fists: 'Fists', rifle: 'Lever-action rifle', axe: 'Axe', shotgun: 'Shotgun', flare: 'Flares' },
  },
  // Double-barrelled shotgun: two shells, a spread of pellets. Reloaded at the table from its own box of shells.
  shotgun: {
    magSize: 2, pellets: 9, damage: 16, spread: 0.075, aimSpread: 0.7, range: 30, falloff: [8, 30],
    fireInterval: 0.32, recoilPitch: 0.12, recoilYaw: 0.03, startShells: 12, perWaveShells: 6, reloadTime: 2.2,
  },
  // Flares: thrown at the window you are looking at; while one burns, spiders keep away from that window.
  flares: { onUnlock: 2, perWave: 1, max: 3, burn: 30, range: 7, throwTime: 0.6 },
  // Fists (held with 1, left click punches), axe (swung with left click) and stomp (C). Reach is measured from the eye to the spider's body.
  melee: {
    // reach is from the eye to the spider's body: spiders are low, so even one at your feet is ~1.3 m away
    fists: { damage: 14, reach: 1.75, cone: 0.85, time: 0.42, hitAt: 0.15, knockback: 0.25 },
    axe: { damage: 45, reach: 1.75, cone: 0.62, time: 0.72, hitAt: 0.33, knockback: 0.35 },
    stomp: { reach: 1.15, cone: 0.9, time: 0.55, hitAt: 0.24, push: 0.5, kills: ['runner'], killsSize: ['small'] },
  },
  // Hit and kill feedback on the spiders.
  gore: {
    knockback: 0.18,         // metres a body hit pushes a spider on the ground (x its size factor)
    staggerEvery: 0.25,      // brutes stagger each time they lose this fraction of their health
    staggerTime: 0.7,        // seconds a stagger stops a brute
    chunks: 160,             // a killed spider bursts into chunks: most alive at once (oldest go first)
    chunksLow: 90,           // the same on phones (and fewer per burst)
    chunkHold: 4,            // seconds a chunk stays fully visible once it has landed
    chunkFade: 2,            // seconds it then takes to fade away
    splats: 60,              // blood splats kept in the world at once (oldest reused first)
    splatHold: 3,            // seconds a splat stays fully visible
    splatFade: 2,            // seconds it then takes to fade away (so splats never block a window for long)
    droplets: 240,           // spray droplets alive at once
  },
  ammo: {
    startStock: 40,          // rounds on the table at the start (not counting the loaded magazine)
    perWaveRestock: 16,      // rounds added to the table after each wave survived
    reloadTime: 3.0,         // seconds standing at the table, cannot move or shoot
  },
  windows: {
    // no glass: planks nailed across the outside are the barrier (user's call 2026-11-15). Was one 100-point window.
    // where each plank sits: -1 = bottom of the opening, 1 = top. Two low, two high, a wide gap at eye level
    // (user, 2026-11-15: move the boards away from the centre so you can see out). Was four evenly spaced.
    boardSpots: [-1, -0.55, 0.55, 1],   // planks per window = how many spots; shoot through the gaps
    boardHealth: 80,         // each plank; all four gone = breached (320 in all, 3.2x the old window)
    // how close the player is to a window (distance from the eye to the window centre, adjusted for angle).
    // Only used to tell a watcher it has been seen; windows no longer darken from afar.
    clearDistance: 0.9,      // closeness 1 at or nearer than this
    darkDistance: 5.0,       // closeness 0 at or beyond this
  },
  // Outside at night. Was moon 0.5, hemi 0.6, fog 0.046 near-black: too dark (user, after milestone 2).
  // brightness floors (tests/brightness.mjs): the hands, gun and spiders must never read as black shapes
  render: {
    exposure: 1.15,          // tone mapping exposure, desktop
    exposureLow: 1.32,       // phones: dimmer screens, often lower brightness settings
    viewAlbedo: 3.4,         // hands and gun: multiplies the baked colour textures (they average ~3% reflectance)
    viewAmbient: 1.4,        // hands and gun: soft warm fill (was 0.32)
    viewKeyMin: 1.3,         // hands and gun: the warm key light never drops below this (was 0.5)
    spiderFill: 0.1,         // spiders: a faint light of their own (inside the cabin)
    spiderFillOutside: 0.12, // x spiderFill outside: in the dark you see the eyes, and the rest only in the beam
  },
  // menu music (js/audio/Music.js): seconds into assets/audio/menu-track.m4a
  music: {
    url: './assets/audio/menu-track.m4a',
    leadIn: 76,       // starts here, well before the good part, fading in slowly (user: fade in, never cut in)
    fadeIn: 8,
    kick: 86,         // the good part (1:26): the loading screen ends on it
    kickFade: 3,      // slow crossfade if the loading screen ends before the good part
    fadeOut: 2.5,     // when the game starts
    loopCrossfade: 4, // user: "more loopable" — the end overlaps into the start instead of restarting from silence
  },
  // the loading screen stays at least this long: long enough for the retimed BOOT_LOG failure run (js/ui/Menu.js)
  // to play out in full and for the music to have built up to the kick by the time the screen reveals the menu
  loading: { minSeconds: 9.7 },
  night: {
    moon: 0.38,              // cold moonlight (0.7 until 2026-11-15: the yard was too readable, user: make it darker)
    hemi: 0.45,              // sky fill from above (was 0.85)
    fogDensity: 0.07,        // one fog for every tier now (was 0.034 phones / 0.052 desktop); brightness.mjs checks the result
    fogDensityHigh: 0.07,
    fogColor: [0.011, 0.014, 0.019],  // linear RGB; near-black so the forest still darkens with distance
  },
  // squeezeSpeed: m/s while hauling itself through a breached window frame (big ones get stuck for a while)
  spiders: {
    // model: which body it wears (assets/models/spider_<model>.glb, see SPECIES.md)
    runner:  { model: 'knot', health: 30,  speed: 5.5, climbSpeed: 3.5, windowDamage: 4,  attackInterval: 0.5, playerDamage: 7,  scale: 1.4, squeezeSpeed: 2.8,
      leap: { range: 5, chance: 0.8, damage: 1.6, crouch: 0.25 } },  // 1.4: smallest spiders were too small to read
    brute:   { model: 'sac', health: 190, speed: 2.0, climbSpeed: 1.1, windowDamage: 22, attackInterval: 1.4, playerDamage: 28, scale: 1.0, squeezeSpeed: 0.9 },
    climber: { model: 'flayed', health: 60,  speed: 3.0, climbSpeed: 2.6, windowDamage: 8,  attackInterval: 0.7, playerDamage: 12, scale: 1.0, squeezeSpeed: 1.4,
      leap: { range: 6, chance: 0.6, damage: 1.3, crouch: 0.35 } },
    stalker: { model: 'grinner', health: 70,  speed: 2.0, climbSpeed: 1.5, windowDamage: 10, attackInterval: 0.8, playerDamage: 16, scale: 1.0, squeezeSpeed: 1.1,
      leap: { range: 6.5, chance: 0.45, damage: 1.2, crouch: 0.5 } },
    weeper:  { model: 'weeper', health: 55, speed: 2.2, climbSpeed: 1.3, windowDamage: 9, attackInterval: 0.8, playerDamage: 14, scale: 1.0, squeezeSpeed: 1.2 },
  },
  // Standing at one window too long while spiders are out: one springs at you (SpiderManager.updateLinger)
  linger: {
    time: [3.5, 6],          // seconds at the same window (closeness above `closeness`) before it happens
    closeness: 0.6,
    cooldown: [16, 28],      // seconds before it can happen again
    damage: 6,               // claws through the gaps (was 14: too much for a scare, user 2026-11-15) (or the leap, through a breached window)
    boardDamage: 12,         // the slam into the planks
    reach: 1.7,              // the player is hurt if this close to the window (m, horizontally)
    types: ['runner', 'climber', 'weeper'],
  },
  // three sizes of every spider (js/spiders/SpiderModel.js SIZES sets scale and body weight)
  sizes: {
    small:  { health: 0.45, speed: 1.2,  squeeze: 1.6, damage: 0.5 },   // small ones die to a stomp
    medium: { health: 1,    speed: 1,    squeeze: 1,   damage: 1 },
    large:  { health: 1.9,  speed: 0.95, squeeze: 0.6, damage: 1.7 },   // speed was 0.8: the big ones were too slow (user)
  },
  // The night: 10 timed waves, then dawn. A wave sends spiders for waveTime seconds; the break starts once the
  // time is up and the last of them is dead, and lasts breakTime. The wall clock runs from clockStart to dawn.
  waves: {
    count: 10,               // survive this many and the sun comes up
    firstDelay: 18,          // seconds of quiet before wave 1
    waveTime: 90,            // 1:30 of spiders arriving
    breakTime: 30,           // 30 s to recover between waves
    // spiders per wave = base + perWave * (wave-1); type mix unlocks over waves
    base: 4,
    perWave: 2,
    spawnGap: [2.5, 7],      // seconds between spawns within a wave (random range); squeezed to fit waveTime
    stalkerWatchTime: [10, 22],
    clockStart: 22,          // 10 pm on the wall clock at the start of the night
    clockDawn: 6,            // 6 am: the last wave survived
  },
  // Healing. Bandages: one per wave survived, carry at most `max`, used with H. The cot: once per break, hold USE.
  heal: {
    bandage: { max: 3, amount: 35, time: 1.6 },   // health back, seconds it takes (you can still walk, slowly)
    bed: { time: 4, radius: 1.3 },                 // seconds lying down; how close to the cot you must stand
    bandageMove: 0.5,                              // walk speed x this while bandaging
  },
  // The stove fire (js/systems/Firewood.js): it burns down and you feed it logs. Light only for now; warmth is session D.
  fire: {
    light: 9,                // stove light intensity at a full fire (the hanging lantern is 15)
    range: 10,
    burnPerLog: 55,          // seconds one log keeps it going
    maxFuel: 220,            // it holds about four logs
    startFuel: 110,          // two logs' worth at the start of the night
    dimBelow: 50,            // over its last 50 s of fuel the fire shrinks to embers, then goes out
    feedTime: 1.2,           // seconds to put a log in (you stand still)
  },
  // Logs: one stock, spent on the fire or on nailing a plank back over a window. Never quite enough for both
  // (user, 2026-11-15). A full fire for a wave and its break takes ~2.2 logs; each plank costs one.
  logs: {
    start: 3,
    perWave: 3,              // added for each wave survived
    max: 12,
    boardTime: 2.4,          // seconds to nail one plank back on (you stand still)
    boardReach: 1.6,         // how close to the window centre you must stand (m, on the floor)
  },
  // Settings → Gameplay → difficulty. Multiplies spiders per wave and the damage they do.
  difficulty: {
    easy:   { count: 0.7, playerDamage: 0.6, windowDamage: 0.7 },
    normal: { count: 1,   playerDamage: 1,   windowDamage: 1 },
    hard:   { count: 1.3, playerDamage: 1.35, windowDamage: 1.25 },
  },
  eyes: {
    maxPairs: 6,
    interval: [3, 9],        // seconds between new phantom eye pairs
    life: [2, 9],            // how long a pair stays
    distance: [5, 38],
  },
};
