// Healing: bandages and the cot. Numbers: Config.heal.
// Bandages: you start with none and get one for every wave survived (at most bandage.max). They lie on the ammo table
// and you bandage up there (session C): H, the touch BANDAGE button or USE at the table wraps one over bandage.time
// seconds; the health comes back as it is wrapped.
// The cot: once per break between waves, stand by it and hold USE to lie down for bed.time seconds; you get up at full
// health. Not during a wave (the spiders do not wait), and only once per break.
import { Config } from '../core/Config.js';
import { BED } from '../world/Layout.js';

const H = Config.heal;

export class Healing {
  constructor({ player, weapon, waves, audio, events }) {
    this.player = player;
    this.weapon = weapon;
    this.waves = waves;
    this.audio = audio;
    this.events = events;
    this.reset();
    events.on('waveEnd', () => {
      this.bandages = Math.min(H.bandage.max, this.bandages + 1);
      this.bedUsed = false;
    });
  }

  reset() {
    this.bandages = 0;
    this.bandageT = -1;     // 0..1 while wrapping one
    this.bedT = -1;         // 0..1 while lying on the cot
    this.bedUsed = false;   // the cot has been used this break
    this.player.slow = 1;
  }

  get busy() { return this.bandageT >= 0 || this.bedT >= 0; }

  tryBandage() {
    const p = this.player;
    if (this.busy || p.dead || this.weapon.reloading) return 'busy';
    if (this.bandages <= 0) return 'none';
    if (p.health >= Config.player.maxHealth) return 'full';
    if (this.atTable && !this.atTable()) return 'table';
    this.bandages--;
    this.bandageT = 0;
    this.healed = 0;
    this.audio.play('ammoPickup', { volume: 0.5, rate: 0.6, exterior: false });
    return 'ok';
  }

  nearBed() {
    const p = this.player.position;
    return Math.hypot(p.x - BED.position.x, p.z - BED.position.z) < H.bed.radius;
  }

  /** The cot's interact prompt, or null when not standing by it. */
  bedPrompt() {
    if (!this.nearBed() || this.player.dead) return null;
    if (this.bedT >= 0) return { text: 'Resting…', can: false };
    if (!this.waves.inBreak) return { text: 'No time to rest while they are coming', can: false };
    if (this.bedUsed) return { text: 'You have rested this break', can: false };
    if (this.player.health >= Config.player.maxHealth) return { text: 'Rest · you are not hurt', can: false };
    return { text: 'Rest on the cot · heal fully', can: true };
  }

  tryBed() {
    const pr = this.bedPrompt();
    if (!pr || !pr.can || this.busy || this.weapon.reloading) return false;
    this.bedT = 0;
    this.bedUsed = true;
    this.player.locked = true;
    this.events.emit('restStart');
    this.audio.play('cabinCreak', { volume: 0.7, exterior: false });
    return true;
  }

  update(dt) {
    const p = this.player;
    if (this.bandageT >= 0) {
      if (p.dead) { this.bandageT = -1; p.slow = 1; return; }
      this.bandageT += dt / H.bandage.time;
      const target = H.bandage.amount * Math.min(1, this.bandageT);
      p.health = Math.min(Config.player.maxHealth, p.health + (target - this.healed));
      this.healed = target;
      p.slow = H.bandageMove;
      if (this.bandageT >= 1) { this.bandageT = -1; p.slow = 1; this.events.emit('healed', { from: 'bandage' }); }
    }
    if (this.bedT >= 0) {
      // a wave starting (or dying, somehow) gets you straight up
      if (p.dead || !this.waves.inBreak) { this.endBed(false); return; }
      this.bedT += dt / H.bed.time;
      if (this.bedT >= 1) this.endBed(true);
    }
  }

  endBed(ok) {
    if (ok) { this.player.health = Config.player.maxHealth; this.events.emit('healed', { from: 'bed' }); }
    this.bedT = -1;
    this.player.locked = false;
    this.events.emit('restEnd', { ok });
  }
}
