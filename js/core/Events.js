// Minimal event bus shared by all systems.
//
// Events in use (name -> payload):
//   'lightning'      { strength 0..1 }          Director fires it; Lighting flashes; Stalkers flee
//   'muzzleFlash'    { position }               Weapon fires it; Stalkers near the flash flee
//   'shot'           { origin, direction, hitPoint|null, hitSpider|null }
//   'windowDamaged'  { id, stage, health, before }  a board fell off; stage = boards gone (4 = breached)
//   'windowBreached' { id }
//   'spiderSpawned'  { spider }
//   'spiderKilled'   { spider, point, by }      by: 'bullet' | 'axe' | 'fists' | 'stomp'
//   'axeHit'         { spider, by } | { window } Melee: the axe or a fist connected
//   'weaponUnlocked' { name, slot }             Arsenal: a new weapon is yours (in the break before its wave)
//   'flareLit' / 'flareOut' { window }          Flares: a flare burns at a window; spiders keep away from it
//   'stompHit'       { spider }
//   'playerHurt'     { amount, health }
//   'waveStart'      { wave, last }
//   'waveEnd'        { wave, last }             last: the final wave of the night
//   'dawn'           { wave }                   the last wave survived; Game shows the dawn screen
//   'restStart' / 'restEnd' { ok }              lying on the cot (Healing)
//   'reloadStart' / 'reloadEnd'
//   'dryFire'                                  the trigger clicked on an empty tube
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
