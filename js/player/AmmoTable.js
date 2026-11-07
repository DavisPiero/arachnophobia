// The ammunition table: the only place to reload.
// Walk up to it, press interact, stand still for ~3 seconds while rounds are pushed into the rifle's tube one by one.
// Supplies on the table visibly run down as the stock is used.
import { Config } from '../core/Config.js';
import { AMMO_TABLE } from '../world/Layout.js';

const A = Config.ammo;
const MAG = Config.weapon.magSize;

export class AmmoTable {
  constructor({ player, weapon, audio, events, tableVisual }) {
    this.player = player;
    this.weapon = weapon;
    this.audio = audio;
    this.events = events;
    this.supplies = tableVisual?.supplies || [];
    this.position = AMMO_TABLE.position.clone();
    this.position.y = 0.85;
    this.stock = A.startStock;
    this.maxShown = A.startStock + A.perWaveRestock; // fully stocked look
    this.reloading = false;
    this.t = 0;
    this.cues = [];
    this.updateSupplies();
    events.on('waveEnd', () => this.restock(A.perWaveRestock));
  }
  reset() { this.stock = A.startStock; this.reloading = false; this.t = 0; this.updateSupplies(); }

  restock(n) {
    this.stock += n;
    this.updateSupplies();
  }

  inReach() {
    const p = this.player.position;
    return Math.hypot(p.x - AMMO_TABLE.position.x, p.z - AMMO_TABLE.position.z) < AMMO_TABLE.interactRadius + 0.35;
  }

  /** What the interact prompt should say right now, or null if out of reach. */
  prompt() {
    if (!this.inReach() || this.player.dead) return null;
    if (this.reloading) return { text: 'Reloading…', can: false };
    if (this.weapon.mag >= MAG) return { text: `Magazine full · ${this.stock} rounds on table`, can: false };
    if (this.stock <= 0) return { text: 'The table is empty', can: false };
    return { text: `Reload · ${this.stock} rounds on table`, can: true };
  }

  tryStart() {
    const p = this.prompt();
    if (!p || !p.can) {
      if (p && this.stock <= 0) this.audio.play('ammoPickup', { position: this.position, volume: 0.35, rate: 1.3 });
      return false;
    }
    this.reloading = true;
    this.t = 0;
    this.player.locked = true;
    this.weapon.reloading = true;
    this.weapon.reloadT = 0;
    // sound cues across the reload (fractions of reloadTime), matched to the hand animation in ViewModel.js:
    // each round is pushed into the loading gate on the rifle's side, then one lever cycle chambers a round
    const rounds = Math.min(MAG - this.weapon.mag, this.stock);
    this.weapon.reloadRounds = rounds;
    this.cues = [{ at: 0.02, name: 'ammoPickup', volume: 0.7 }];
    const t0 = 0.12, slot = (0.84 - t0) / Math.max(1, rounds);
    for (let i = 0; i < rounds; i++) this.cues.push({ at: t0 + (i + 0.6) * slot, name: 'roundInsert', volume: 0.75 });
    this.cues.push({ at: 0.885, name: 'leverCycle', volume: 1 });
    this.events.emit('reloadStart');
    return true;
  }

  update(dt) {
    if (!this.reloading) return;
    if (this.player.dead) { this.finish(false); return; }
    this.t += dt / A.reloadTime;
    this.weapon.reloadT = Math.min(1, this.t);
    while (this.cues.length && this.cues[0].at <= this.t) {
      const c = this.cues.shift();
      this.audio.play(c.name, { position: this.position, volume: c.volume, reverb: 0.2 });
    }
    if (this.t >= 1) this.finish(true);
  }

  finish(ok) {
    if (ok) {
      const take = Math.min(MAG - this.weapon.mag, this.stock);
      this.weapon.mag += take;
      this.stock -= take;
      this.updateSupplies();
    }
    this.reloading = false;
    this.player.locked = false;
    this.weapon.reloading = false;
    this.weapon.reloadT = 0;
    this.events.emit('reloadEnd');
  }

  updateSupplies() {
    const n = this.supplies.length;
    if (!n) return;
    const shown = this.stock <= 0 ? 0 : Math.max(1, Math.ceil((this.stock / this.maxShown) * n));
    this.supplies.forEach((s, i) => { s.visible = i < shown; });
  }
}
