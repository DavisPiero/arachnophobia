// The night: a quiet start, then Config.waves.count timed waves of spiders with growing size and variety.
// Each wave sends spiders for waveTime seconds; once that time is up and the last of them is dead, a break of
// breakTime starts. Surviving the last wave brings the dawn ('dawn' event). Surviving a wave restocks the ammo table.
import { Config } from '../core/Config.js';
import { Settings } from '../core/Settings.js';
import { WINDOWS } from '../world/Layout.js';

const WV = Config.waves;

export class WaveSystem {
  constructor({ spiders, events, quality, player }) {
    this.spiders = spiders;
    this.events = events;
    this.quality = quality;
    this.player = player;
    this.reset();
  }
  reset() {
    this.wave = 0;
    this.phase = 'calm';          // 'calm' (before a wave), 'wave', 'dawn' (the night is over)
    this.timer = WV.firstDelay;
    this.waveT = 0;               // seconds into the current wave
    this.elapsed = 0;             // seconds into the night (drives the wall clock)
    this.queue = [];
    this.spawnTimer = 0;
    this.kills = 0;
    this.spawnedThisWave = [];
  }
  get betweenWaves() { return this.phase === 'calm'; }
  /** True from the start of a break until the next wave (the first quiet before wave 1 does not count). */
  get inBreak() { return this.phase === 'calm' && this.wave > 0; }

  /** The night's progress as a time of day in hours (22 = 10 pm ... 30 = 6 am), for the wall clock.
   *  Planned length: first delay + every wave and break; the clock never passes dawn before the last wave ends. */
  get clockHours() {
    const total = WV.firstDelay + WV.count * WV.waveTime + (WV.count - 1) * WV.breakTime;
    const span = (WV.clockDawn + 24 - WV.clockStart);
    const k = this.phase === 'dawn' ? 1 : Math.min(0.995, this.elapsed / total);
    return WV.clockStart + span * k;
  }

  /** List of spider types for a wave. */
  composition(n) {
    const diff = Config.difficulty[Settings.difficulty] || Config.difficulty.normal;
    const count = Math.max(3, Math.round((WV.base + WV.perWave * (n - 1)) * diff.count));
    const list = [];
    // guaranteed flavour
    list.push('stalker');
    if (n >= 1) list.push('climber');
    // no brutes while you only have your fists (the rifle comes at wave 3)
    if (n >= 3) list.push('brute');
    if (n >= 5) list.push('brute');
    if (n >= 2) list.push('weeper');
    while (list.length < count) {
      const r = Math.random();
      if (n >= 3 && r < 0.12) list.push('brute');
      else if (n >= 2 && r < 0.27) list.push('stalker');
      else if (n >= 2 && r < 0.36) list.push('weeper');
      else if (r < 0.48) list.push('climber');
      else list.push('runner');
    }
    // shuffle, but keep the stalker early so it is watching before the rest arrive
    for (let i = list.length - 1; i > 1; i--) { const j = 1 + Math.floor(Math.random() * i); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }

  pickWindow() {
    // prefer windows the player is not standing at, and spread the load
    const eye = this.player.position;
    const weights = WINDOWS.map((w) => {
      const d = Math.hypot(eye.x - w.center.x, eye.z - w.center.z);
      const busy = this.spiders.spiders.filter((s) => s.alive && s.window && s.window.id === w.id).length;
      const flare = this.spiders.flared?.has(w.id) ? 0.05 : 1;   // a burning flare keeps them away
      return flare * Math.max(0.15, Math.min(1.5, d / 3)) / (1 + busy * 0.6);
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < WINDOWS.length; i++) { r -= weights[i]; if (r <= 0) return WINDOWS[i].id; }
    return WINDOWS[0].id;
  }

  update(dt) {
    if (this.phase === 'dawn') return;
    this.elapsed += dt;
    if (this.phase === 'calm') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.wave++;
        this.phase = 'wave';
        this.waveT = 0;
        this.queue = this.composition(this.wave);
        this.spawnTimer = 0.5;
        this.spawnedThisWave = [];
        this.events.emit('waveStart', { wave: this.wave, last: this.wave === WV.count });
      }
      return;
    }
    this.waveT += dt;
    const timeUp = this.waveT >= WV.waveTime;
    // spawning: spread the queue over the wave's time (the last ones arrive with ~15 s to spare)
    if (this.queue.length && !timeUp) {
      this.spawnTimer -= dt;
      const alive = this.spiders.aliveCount;
      if (this.spawnTimer <= 0 && alive < this.quality.maxSpiders) {
        const type = this.queue.shift();
        const s = this.spiders.spawn(type, this.pickWindow());
        this.spawnedThisWave.push(s);
        const gap = WV.spawnGap;
        const left = Math.max(1, WV.waveTime - 15 - this.waveT);
        const fit = this.queue.length ? left / this.queue.length : gap[1];
        const g = gap[0] + Math.random() * (gap[1] - gap[0]);
        this.spawnTimer = Math.min(g * Math.max(0.45, 1 - (this.wave - 1) * 0.08), fit);
      }
    } else if (timeUp && this.spawnedThisWave.every((s) => !s?.alive)) {
      // time is up and the last of them is dead: survived
      this.queue = [];
      this.events.emit('waveEnd', { wave: this.wave, last: this.wave >= WV.count });
      if (this.wave >= WV.count) { this.phase = 'dawn'; this.events.emit('dawn', { wave: this.wave }); return; }
      this.phase = 'calm';
      this.timer = WV.breakTime;
    }
  }
}
