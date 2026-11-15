// Survival's day (SURVIVAL.md S1): day -> dusk -> night (the waves) -> dawn -> the next day.
// By day there are no spiders and the door opens; at dusk the light goes; when dusk ends the night's waves begin
// (WaveSystem.nextNight); the last wave of the night brings the dawn, and a short dawn leads into the next morning.
// Drives the daylight (Lighting.setDaylight) and the wall clock's hour. Numbers: Config.survival.
import { Config } from '../core/Config.js';

const S = Config.survival, WV = Config.waves;

export class DayCycle {
  constructor({ waves, lighting, events }) {
    this.waves = waves;
    this.lighting = lighting;
    this.events = events;
    this.active = false;   // only in Survival
    this.reset();
    events.on('dawn', ({ nights }) => { if (this.active && nights) this.begin('dawn'); });
  }

  reset() {
    this.day = 1;
    this.phase = 'day';
    this.t = 0;
    this.lightFrom = 1;    // the first morning starts in full light
  }

  /** Turn on for Survival (off: Waves, the old endless night). */
  setActive(on) {
    this.active = on;
    this.lighting.setDaylight(on ? this.light : 0);
  }

  begin(phase) {
    this.phase = phase;
    this.t = 0;
    if (phase === 'night') this.waves.nextNight();
    if (phase === 'day') { this.day++; this.lightFrom = this.light; }
    this.events.emit('dayPhase', { phase, day: this.day });
  }

  /** Seconds this part of the day lasts (night: until the last wave ends, so Infinity). */
  get length() { return { day: S.dayTime, dusk: S.duskTime, dawn: S.dawnTime, night: Infinity }[this.phase]; }
  get left() { return Math.max(0, this.length - this.t); }
  get isNight() { return this.phase === 'night'; }
  /** True while it is safe enough outside for spiders to stay away (day and dawn). */
  get daytime() { return this.phase === 'day' || this.phase === 'dawn'; }

  /** 0 = night .. 1 = full daylight. */
  get light() {
    const k = Math.min(1, this.t / (this.length || 1));
    switch (this.phase) {
      case 'day': return Math.min(1, this.lightFrom + (1 - this.lightFrom) * Math.min(1, this.t / 25));
      case 'dusk': return 1 - k * k;   // slow at first, then the dark comes quickly
      case 'dawn': return 0.55 * k;
      default: return 0;
    }
  }

  /** The hour on the wall clock (7 = 7 am ... 30 = 6 am the next morning). */
  get hours() {
    const C = S.clock, k = Math.min(1, this.t / (this.length || 1));
    if (this.phase === 'day') return C.dayStart + (C.duskStart - C.dayStart) * k;
    if (this.phase === 'dusk') return C.duskStart + (C.nightStart - C.duskStart) * k;
    if (this.phase === 'dawn') return 30 + (C.dayStart + 24 - 30) * k;
    const W = this.waves, n = W.rules.count;
    const planned = WV.firstDelay + n * WV.waveTime + (n - 1) * W.rules.breakTime;
    return C.nightStart + (30 - C.nightStart) * Math.min(0.995, (W.elapsed - W.nightStart) / planned);
  }

  /** Debug and tests: jump to the end of this part of the day. */
  skip() { if (this.phase !== 'night') this.t = this.length; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.t >= this.length) this.begin({ day: 'dusk', dusk: 'night', dawn: 'day' }[this.phase]);
    this.lighting.setDaylight(this.light);
  }
}
