// Logs and the stove fire. Numbers: Config.logs and Config.fire.
//
// You have one stock of logs (start + perWave for each wave survived, user 2026-11-15: "just not enough"). Spend a log
// on either:
//  - the stove: stand by it and press USE; the fire gets burnPerLog more seconds (up to maxFuel). The fire burns down
//    all the time, shrinks over its last dimBelow seconds and goes out. It lights the room (Lighting.setFire).
//  - a window: stand at it (inside) and press USE to nail a fallen plank back on (boardTime seconds, you stand still).
//    Not while a spider is in the frame or at the planks right there.
// Warmth (spiders bolder when the fire is low, frost on the screen) comes in session D and will read `level`.
import { Config } from '../core/Config.js';
import { STOVE } from '../world/Layout.js';

const F = Config.fire, L = Config.logs;

export class Firewood {
  constructor({ player, weapon, windows, spiders, lighting, audio, events }) {
    Object.assign(this, { player, weapon, windows, spiders, lighting, audio, events });
    this.reset();
    events.on('waveEnd', () => { this.logs = Math.min(L.max, this.logs + L.perWave); });
  }

  reset() {
    this.logs = L.start;
    this.fuel = F.startFuel;
    this.job = null;        // { kind: 'feed' | 'board', t: 0..1, window }
    this.lighting.setFire(this.level);
  }

  /** 0 = out, 1 = a full fire. */
  get level() { return this.fuel <= 0 ? 0 : Math.min(1, 0.12 + 0.88 * this.fuel / F.dimBelow); }
  get busy() { return !!this.job; }
  get progress() { return this.job ? this.job.t : -1; }

  nearStove() {
    const p = this.player.position;
    return Math.hypot(p.x - STOVE.door.x, p.z - STOVE.door.z) < STOVE.interactRadius;
  }

  /** The window you are standing at, inside, or null. */
  atWindow() {
    const p = this.player.position;
    let best = null, bd = L.boardReach;
    for (const w of this.windows.windows) {
      const d = Math.hypot(p.x - w.center.x, p.z - w.center.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  /** Is a spider in this window's frame or at its planks? */
  blockedBy(w) {
    for (const s of this.spiders.spiders) {
      if (!s.alive || s.state === 'dying') continue;
      if (s.window === w && (s.state === 'enter' || s.state === 'leap')) return true;
      if (s.root.position.distanceTo(w.outside) < 1.1) return true;
    }
    return false;
  }

  logText(n = this.logs) { return `${n} log${n === 1 ? '' : 's'}`; }

  fireWord() {
    if (this.fuel <= 0) return 'The fire is out';
    if (this.fuel < F.dimBelow) return 'The fire is dying';
    return this.fuel > F.maxFuel - F.burnPerLog ? 'The fire is full' : 'The fire is burning';
  }

  /** The interact prompt here, or null. */
  prompt() {
    if (this.player.dead) return null;
    if (this.job) return { text: this.job.kind === 'feed' ? 'Feeding the fire…' : 'Nailing a plank…', can: false };
    if (this.nearStove()) {
      if (this.fuel > F.maxFuel - F.burnPerLog) return { text: `${this.fireWord()} · ${this.logText()}`, can: false };
      if (this.logs <= 0) return { text: `${this.fireWord()} · no logs`, can: false };
      return { text: `Put a log on the fire · ${this.logText()}`, can: true };
    }
    const w = this.atWindow();
    if (w) {
      if (!w.boards.some((b) => b.fallen)) return null;      // nothing to mend: no prompt at an intact window
      if (this.logs <= 0) return { text: 'A plank is missing · no logs', can: false };
      if (this.blockedBy(w)) return { text: 'Something is in the way', can: false };
      return { text: `Nail a plank back on · ${this.logText()}`, can: true };
    }
    return null;
  }

  tryStart() {
    const pr = this.prompt();
    if (!pr || !pr.can || this.weapon.reloading) return false;
    const kind = this.nearStove() ? 'feed' : 'board';
    this.job = { kind, t: 0, window: kind === 'board' ? this.atWindow() : null, hits: 0 };
    this.player.locked = true;
    if (kind === 'feed') this.audio.play('woodScrape', { position: STOVE.door, volume: 0.7, reverb: 0.2 });
    return true;
  }

  stop() { this.job = null; this.player.locked = false; }

  update(dt) {
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt);
    this.lighting.setFire(this.level);
    const j = this.job;
    if (!j) return;
    if (this.player.dead) { this.stop(); return; }
    j.t += dt / (j.kind === 'feed' ? F.feedTime : L.boardTime);
    if (j.kind === 'board') {
      // three hammer blows
      if (j.t > 0.3 + j.hits * 0.25 && j.hits < 3) {
        j.hits++;
        this.audio.play('boardHit', { position: j.window.center, volume: 0.9, rate: 1.25, reverb: 0.25 });
      }
      // a spider got into the frame meanwhile: the plank is not nailed and the log is kept
      if (this.blockedBy(j.window)) { this.stop(); return; }
    }
    if (j.t < 1) return;
    if (j.kind === 'feed') {
      this.fuel = Math.min(F.maxFuel, Math.max(this.fuel, 0) + F.burnPerLog);
      this.logs--;
      this.audio.play('boardHit', { position: STOVE.door, volume: 0.4, rate: 0.7, reverb: 0.2 });
      this.events.emit('fireFed', { fuel: this.fuel, logs: this.logs });
    } else if (this.windows.addBoard(j.window)) this.logs--;
    this.stop();
  }
}
