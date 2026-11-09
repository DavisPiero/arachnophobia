// Survival waves: a quiet start, then waves of spiders with growing size and variety,
// with quiet breaks in between. Surviving a wave restocks the ammo table.
import { Config } from '../core/Config.js';
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
    this.phase = 'calm';          // 'calm' (before a wave), 'wave'
    this.timer = WV.firstDelay;
    this.queue = [];
    this.spawnTimer = 0;
    this.kills = 0;
    this.spawnedThisWave = [];
  }
  get betweenWaves() { return this.phase === 'calm'; }

  /** List of spider types for a wave. */
  composition(n) {
    const count = WV.base + WV.perWave * (n - 1);
    const list = [];
    // guaranteed flavour
    list.push('stalker');
    if (n >= 1) list.push('climber');
    if (n >= 2) list.push('brute');
    if (n >= 4) list.push('brute');
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
      return Math.max(0.15, Math.min(1.5, d / 3)) / (1 + busy * 0.6);
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < WINDOWS.length; i++) { r -= weights[i]; if (r <= 0) return WINDOWS[i].id; }
    return WINDOWS[0].id;
  }

  update(dt) {
    if (this.phase === 'calm') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.wave++;
        this.phase = 'wave';
        this.queue = this.composition(this.wave);
        this.spawnTimer = 0.5;
        this.spawnedThisWave = [];
        this.events.emit('waveStart', { wave: this.wave });
      }
      return;
    }
    // spawning
    if (this.queue.length) {
      this.spawnTimer -= dt;
      const alive = this.spiders.aliveCount;
      if (this.spawnTimer <= 0 && alive < this.quality.maxSpiders) {
        const type = this.queue.shift();
        const s = this.spiders.spawn(type, this.pickWindow());
        this.spawnedThisWave.push(s);
        const gap = WV.spawnGap;
        // waves get denser
        const tighten = Math.max(0.45, 1 - (this.wave - 1) * 0.08);
        this.spawnTimer = (gap[0] + Math.random() * (gap[1] - gap[0])) * tighten;
      }
    } else if (this.spawnedThisWave.every((s) => !s.alive)) {
      // wave cleared
      this.phase = 'calm';
      this.timer = WV.breakTime;
      this.events.emit('waveEnd', { wave: this.wave });
    }
  }
}
