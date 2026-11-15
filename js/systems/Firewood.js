// Logs and the stove fire. Numbers: Config.logs and Config.fire.
//
// The logs lie in the stack by the stove (start + perWave for each wave survived, user 2026-11-15: "just not enough").
// You do not keep them (user, 2026-11-15): USE at the stack picks one up and it floats in front of you; carry it to
//  - the stove: stand by it and press USE; the fire gets burnPerLog more seconds (up to maxFuel). The fire burns down
//    all the time, shrinks over its last dimBelow seconds and goes out. It lights the room (Lighting.setFire).
//  - a window: stand at it (inside) and press USE to nail a fallen plank back on (boardTime seconds, you stand still).
//    Not while a spider is in the frame or at the planks right there.
// Warmth (spiders bolder when the fire is low, frost on the screen) comes in session D and will read `level`.
import { Config } from '../core/Config.js';
import * as THREE from 'three';
import { STOVE, WOODPILE } from '../world/Layout.js';

const F = Config.fire, L = Config.logs;
const PILE_AT = WOODPILE.position.clone().setY(0.2);

export class Firewood {
  constructor({ player, weapon, windows, spiders, lighting, audio, events, camera }) {
    Object.assign(this, { player, weapon, windows, spiders, lighting, audio, events });
    // the log you carry: floats low in front of you (a placeholder until there are hands for it)
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 });
    const end = new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.9 });
    this.held = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.45, 8), [bark, end, end]);
    this.held.position.set(0.12, -0.32, -0.55);
    this.held.rotation.set(0.15, 0, Math.PI / 2 - 0.25);
    this.held.visible = false;
    camera?.add(this.held);
    this.reset();
    events.on('waveEnd', () => { this.logs = Math.min(L.max, this.logs + (this.perWave ?? L.perWave)); });   // perWave: set per game mode
  }

  reset() {
    this.logs = L.start;     // in the stack
    this.carrying = false;
    this.fuel = F.startFuel;
    this.job = null;        // { kind: 'feed' | 'board', t: 0..1, window }
    this.lighting.setFire(this.level);
  }

  /** 0 = out, 1 = a full fire. */
  get level() { return this.fuel <= 0 ? 0 : Math.min(1, 0.12 + 0.88 * this.fuel / F.dimBelow); }
  get busy() { return !!this.job; }

  nearPile() {
    const p = this.player.position;
    return Math.hypot(p.x - WOODPILE.position.x, p.z - WOODPILE.position.z) < WOODPILE.interactRadius;
  }
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
    if (this.carrying) {
      if (this.nearStove()) return { title: 'Stove', target: 'stove', at: STOVE.door, r: 0.4, ...(this.fuel > F.maxFuel - F.burnPerLog ? { text: this.fireWord(), can: false } : { text: 'Put the log on the fire', can: true }) };
      const w = this.atWindow();
      if (w && w.boards.some((b) => b.fallen)) return this.blockedBy(w) ? { title: 'Window', target: 'window', at: w.center, r: 0.65, text: 'Something is in the way', can: false } : { title: 'Window', target: 'window', at: w.center, r: 0.65, text: 'Nail it over the window', can: true };
      return null;
    }
    if (this.nearPile()) return { title: 'Wood', target: 'woodpile', at: PILE_AT, r: 0.45, ...(this.logs > 0 ? { text: `Take a log · ${this.logText()} left`, can: true } : { text: 'No logs left', can: false }) };
    if (this.nearStove()) return { title: 'Stove', target: 'stove', at: STOVE.door, r: 0.4, text: this.fireWord(), can: false };
    return null;
  }

  tryStart() {
    const pr = this.prompt();
    if (!pr || !pr.can || this.weapon.reloading) return false;
    if (!this.carrying) {   // at the stack: pick one up
      this.logs--; this.carrying = true;
      this.audio.play('woodScrape', { position: WOODPILE.position, volume: 0.6, reverb: 0.2 });
      return true;
    }
    const kind = this.nearStove() ? 'feed' : 'board';
    this.job = { kind, t: 0, window: kind === 'board' ? this.atWindow() : null, hits: 0 };
    this.player.locked = true;
    if (kind === 'feed') this.audio.play('woodScrape', { position: STOVE.door, volume: 0.7, reverb: 0.2 });
    return true;
  }

  stop() { this.job = null; this.player.locked = false; }

  update(dt) {
    this.held.visible = this.carrying && !this.player.dead;
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
      this.carrying = false;
      this.audio.play('boardHit', { position: STOVE.door, volume: 0.4, rate: 0.7, reverb: 0.2 });
      this.events.emit('fireFed', { fuel: this.fuel, logs: this.logs });
    } else if (this.windows.addBoard(j.window)) this.carrying = false;
    this.stop();
  }
}
