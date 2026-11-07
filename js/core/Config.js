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
    intensity: 42,           // candela-ish (three.js physical units)
    range: 26,               // metres; beyond this it lights nothing
    angle: 0.34,             // radians, half-angle of the cone
    penumbra: 0.6,           // soft edge
    decay: 2,
    color: 0xffe2b8,         // old incandescent bulb
    scareRange: 22,          // a watcher caught in the beam closer than this slips away
  },
  weapon: {
    magSize: 8,
    damage: 34,              // runner 30hp, climber 60, stalker 70, brute 190
    fireInterval: 0.32,      // seconds between shots (semi-auto)
    range: 80,
    recoilPitch: 0.035,      // radians kick per shot
    recoilRecover: 7,        // how fast it settles
    spread: 0.004,           // radians of random spread
    aimFov: 0.74,            // aiming down sights: field of view x this (a gentle zoom)
    aimSpread: 0.25,         // spread x this while aimed
    aimSpeed: 11,            // how fast the rifle comes up to the eye (1/s)
    aimLookScale: 0.8,       // mouse/touch look sensitivity x this while aimed
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
    // window visibility (distance from the player's eye to the window centre)
    clearDistance: 0.9,      // fully see-through at or closer than this
    darkDistance: 5.0,       // almost black at or beyond this
    farOpacity: 0.58,        // darkness of the glass from across the room (was 0.965; the night itself now gives the depth)
  },
  spiders: {
    runner:  { health: 30,  speed: 5.5, climbSpeed: 3.5, windowDamage: 4,  attackInterval: 0.7, playerDamage: 6,  scale: 1.4 },  // 1.4: smallest spiders were too small to read
    brute:   { health: 190, speed: 1.2, climbSpeed: 0.8, windowDamage: 22, attackInterval: 2.0, playerDamage: 28, scale: 1.0 },
    climber: { health: 60,  speed: 2.4, climbSpeed: 2.2, windowDamage: 8,  attackInterval: 1.0, playerDamage: 12, scale: 1.0 },
    stalker: { health: 70,  speed: 1.4, climbSpeed: 1.2, windowDamage: 10, attackInterval: 1.2, playerDamage: 16, scale: 1.0 },
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
