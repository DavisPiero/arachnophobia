// The ammunition table: the only place to reload.
// Walk up to it, press interact, stand still while the gun is loaded: rifle rounds pushed into the tube one by one
// (~3 s), or two shells into the shotgun. Holding something else, the table loads the rifle (or the shotgun if that
// is all you have). Rifle rounds and shotgun shells are separate stocks. The rifle supplies visibly run down.
import { Config } from '../core/Config.js';
import { AMMO_TABLE } from '../world/Layout.js';
import { MAG } from './Weapon.js';

const A = Config.ammo, SG = Config.shotgun;

export class AmmoTable {
  constructor({ player, weapon, audio, events, tableVisual }) {
    this.player = player;
    this.weapon = weapon;
    this.audio = audio;
    this.events = events;
    this.supplies = tableVisual?.supplies || [];
    this.position = AMMO_TABLE.position.clone();
    this.position.y = 0.85;
    this.stocks = { rifle: A.startStock, shotgun: SG.startShells };
    this.maxShown = A.startStock + A.perWaveRestock; // fully stocked look
    this.reloading = false;
    this.t = 0;
    this.cues = [];
    this.updateSupplies();
    // rounds for a gun you do not have yet still pile up, so it arrives with a stock
    events.on('waveEnd', () => { this.stocks.rifle += A.perWaveRestock; this.stocks.shotgun += SG.perWaveShells; this.updateSupplies(); });
  }
  reset() { this.stocks = { rifle: A.startStock, shotgun: SG.startShells }; this.reloading = false; this.t = 0; this.updateSupplies(); }

  /** The gun a reload here would load. */
  get gun() {
    const w = this.weapon, has = (g) => !w.arsenal || w.arsenal.has(g);
    if (w.isGun(w.want) && has(w.want)) return w.want;
    if (has('rifle')) return 'rifle';
    return has('shotgun') ? 'shotgun' : null;
  }
  /** Rounds (or shells) on the table for the gun in question. */
  get stock() { return this.stocks[this.gun || 'rifle']; }
  unit(gun) { return gun === 'shotgun' ? 'shells' : 'rounds'; }

  inReach() {
    const p = this.player.position;
    // anywhere along the long table: distance to its centre line, not its middle
    const dx = Math.max(0, Math.abs(p.x - AMMO_TABLE.position.x) - AMMO_TABLE.size.x / 2 + 0.3);
    return Math.hypot(dx, p.z - AMMO_TABLE.position.z) < AMMO_TABLE.interactRadius;
  }

  /** What the interact prompt should say right now, or null if out of reach. */
  prompt() {
    if (!this.inReach() || this.player.dead) return null;
    const gun = this.gun;
    if (!gun) return { text: 'Nothing here you can use yet', can: false };
    if (this.reloading) return { text: 'Reloading…', can: false };
    const stock = this.stocks[gun], name = gun === 'shotgun' ? 'Shotgun' : 'Rifle';
    if (this.weapon.ammo[gun] >= MAG[gun]) return { text: `${name} loaded · ${stock} ${this.unit(gun)} on table`, can: false };
    if (stock <= 0) return { text: `No ${this.unit(gun)} left on the table`, can: false };
    return { text: `Load the ${name.toLowerCase()} · ${stock} ${this.unit(gun)} on table`, can: true };
  }

  tryStart() {
    const p = this.prompt();
    if (!p || !p.can) {
      if (p && this.gun && this.stocks[this.gun] <= 0) this.audio.play('ammoPickup', { position: this.position, volume: 0.35, rate: 1.3 });
      return false;
    }
    const gun = this.gun;
    this.loading = gun;
    this.reloading = true;
    this.weapon.forceGun(gun);   // holding something else: the gun comes straight up for the reload
    this.t = 0;
    this.player.locked = true;
    this.weapon.reloading = true;
    this.weapon.reloadT = 0;
    // sound cues across the reload (fractions of reloadTime), matched to the hand animation in ViewModel.js:
    // each round is pushed into the loading gate on the rifle's side, then one lever cycle chambers a round
    const rounds = Math.min(MAG[gun] - this.weapon.ammo[gun], this.stocks[gun]);
    this.weapon.reloadRounds = rounds;
    this.cues = [{ at: 0.02, name: 'ammoPickup', volume: 0.7 }];
    if (gun === 'shotgun') {
      // break open, shells in, snap shut
      this.cues.push({ at: 0.1, name: 'leverCycle', volume: 0.7, rate: 0.7 });
      for (let i = 0; i < rounds; i++) this.cues.push({ at: 0.35 + i * 0.22, name: 'roundInsert', volume: 0.85, rate: 0.75 });
      this.cues.push({ at: 0.9, name: 'leverCycle', volume: 1, rate: 0.6 });
      this.events.emit('reloadStart');
      return true;
    }
    const t0 = 0.12, slot = (0.84 - t0) / Math.max(1, rounds);
    for (let i = 0; i < rounds; i++) this.cues.push({ at: t0 + (i + 0.6) * slot, name: 'roundInsert', volume: 0.75 });
    this.cues.push({ at: 0.885, name: 'leverCycle', volume: 1 });
    this.events.emit('reloadStart');
    return true;
  }

  update(dt) {
    if (!this.reloading) return;
    if (this.player.dead) { this.finish(false); return; }
    this.t += dt / (this.loading === 'shotgun' ? SG.reloadTime : A.reloadTime);
    this.weapon.reloadT = Math.min(1, this.t);
    while (this.cues.length && this.cues[0].at <= this.t) {
      const c = this.cues.shift();
      this.audio.play(c.name, { position: this.position, volume: c.volume, rate: c.rate || 1, reverb: 0.2 });
    }
    if (this.t >= 1) this.finish(true);
  }

  finish(ok) {
    if (ok) {
      const gun = this.loading;
      const take = Math.min(MAG[gun] - this.weapon.ammo[gun], this.stocks[gun]);
      this.weapon.ammo[gun] += take;
      this.stocks[gun] -= take;
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
    const st = this.stocks.rifle;
    const shown = st <= 0 ? 0 : Math.max(1, Math.ceil((st / this.maxShown) * n));
    this.supplies.forEach((s, i) => { s.visible = i < shown; });
  }
}
