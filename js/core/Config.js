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
    intensity: 70,           // candela-ish (three.js physical units)
    range: 48,               // metres; beyond this it lights nothing (user: the beam should reach further)
    angle: 0.34,             // radians, half-angle of the cone
    penumbra: 0.6,           // soft edge
    decay: 2,
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
  // Axe (held with 2, swung with left click) and stomp (C). Reach is measured from the eye to the spider's body.
  melee: {
    axe: { damage: 45, reach: 1.75, cone: 0.62, time: 0.72, hitAt: 0.33, windowDamage: 9, knockback: 0.35 },
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
    maxHealth: 100,
    // health thresholds for each stage (fraction of max). Below the last -> breached.
    stages: [0.75, 0.5, 0.25],  // >=0.75 intact, >=0.5 cracked, >=0.25 shattered, >0 boards splintering, 0 breached
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
    spiderFill: 0.1,         // spiders: a faint light of their own
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
    moon: 0.7,               // cold moonlight
    hemi: 0.85,              // sky fill from above
    fogDensity: 0.034,       // lower = see further (east clearing readable to ~25 m); phones / low tier
    fogDensityHigh: 0.052,   // desktop: the forest swallows things sooner, darker with distance (user's call; not on phones)
    fogColor: [0.011, 0.014, 0.019],  // linear RGB; near-black so the forest still darkens with distance
  },
  // squeezeSpeed: m/s while hauling itself through a breached window frame (big ones get stuck for a while)
  spiders: {
    // model: which body it wears (assets/models/spider_<model>.glb, see SPECIES.md)
    runner:  { model: 'knot', health: 30,  speed: 5.5, climbSpeed: 3.5, windowDamage: 4,  attackInterval: 0.7, playerDamage: 6,  scale: 1.4, squeezeSpeed: 1.4 },  // 1.4: smallest spiders were too small to read
    brute:   { model: 'sac', health: 190, speed: 1.2, climbSpeed: 0.8, windowDamage: 22, attackInterval: 2.0, playerDamage: 28, scale: 1.0, squeezeSpeed: 0.45 },
    climber: { model: 'flayed', health: 60,  speed: 2.4, climbSpeed: 2.2, windowDamage: 8,  attackInterval: 1.0, playerDamage: 12, scale: 1.0, squeezeSpeed: 0.7 },
    stalker: { model: 'grinner', health: 70,  speed: 1.4, climbSpeed: 1.2, windowDamage: 10, attackInterval: 1.2, playerDamage: 16, scale: 1.0, squeezeSpeed: 0.55 },
    weeper:  { model: 'weeper', health: 55, speed: 1.6, climbSpeed: 1.0, windowDamage: 9, attackInterval: 1.1, playerDamage: 14, scale: 1.0, squeezeSpeed: 0.6 },
  },
  // three sizes of every spider (js/spiders/SpiderModel.js SIZES sets scale and body weight)
  sizes: {
    small:  { health: 0.45, speed: 1.2,  squeeze: 1.6, damage: 0.5 },   // small ones die to a stomp
    medium: { health: 1,    speed: 1,    squeeze: 1,   damage: 1 },
    large:  { health: 1.9,  speed: 0.8,  squeeze: 0.6, damage: 1.7 },
  },
  waves: {
    firstDelay: 18,          // seconds of quiet before wave 1
    breakTime: 22,           // quiet between waves
    // spiders per wave = base + perWave * (wave-1); type mix unlocks over waves
    base: 4,
    perWave: 2,
    spawnGap: [2.5, 7],      // seconds between spawns within a wave (random range)
    stalkerWatchTime: [10, 22],
  },
  eyes: {
    maxPairs: 6,
    interval: [3, 9],        // seconds between new phantom eye pairs
    life: [2, 9],            // how long a pair stays
    distance: [5, 38],
  },
};
