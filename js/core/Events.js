// Minimal event bus shared by all systems.
//
// Events in use (name -> payload):
//   'lightning'      { strength 0..1 }          Director fires it; Lighting flashes; Stalkers flee
//   'muzzleFlash'    { position }               Weapon fires it; Stalkers near the flash flee
//   'shot'           { origin, direction, hitPoint|null, hitSpider|null }
//   'windowDamaged'  { id, stage, health }      stage: 0 intact, 1 cracked, 2 shattered, 3 boards splintering, 4 breached
//   'windowBreached' { id }
//   'spiderSpawned'  { spider }
//   'spiderKilled'   { spider }
//   'playerHurt'     { amount, health }
//   'waveStart'      { wave }
//   'waveEnd'        { wave }
//   'reloadStart' / 'reloadEnd'
//   'gameOver'       { wave, kills }
export class Events {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name).delete(fn);
  }
  emit(name, data) {
    const set = this.handlers.get(name);
    if (set) for (const fn of [...set]) fn(data);
  }
}

export const events = new Events();
