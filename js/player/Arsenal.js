// What you own: which weapons are unlocked, which number key holds which, and how many flares you carry.
// Weapons unlock in the break before their wave (Config.arsenal.unlock), so you can try them before it starts.
// The slot map (1–5) is yours to change in the inventory (I) and is saved in this browser.
import { Config } from '../core/Config.js';
import { Settings, setSetting } from '../core/Settings.js';

const AR = Config.arsenal, FL = Config.flares;

export class Arsenal {
  constructor({ events }) {
    this.events = events;
    this.reset();
    // surviving wave n opens everything due at wave n+1
    events.on('waveEnd', ({ wave, last }) => {
      if (last) return;
      this.unlockUpTo(wave + 1, true);
      if (this.has('flare') && !this.justGot?.includes('flare')) this.flares = Math.min(FL.max, this.flares + FL.perWave);
    });
  }

  reset() {
    this.unlocked = new Set();
    this.flares = 0;
    this.justGot = [];
    this.unlockUpTo(1, false);
  }

  has(name) { return this.unlocked.has(name); }

  unlockUpTo(wave, announce) {
    this.justGot = [];
    for (const name of AR.order) {
      if (AR.unlock[name] <= wave && !this.unlocked.has(name)) {
        this.unlocked.add(name);
        this.justGot.push(name);
        if (name === 'flare') this.flares = FL.onUnlock;
        if (announce) this.events.emit('weaponUnlocked', { name, slot: this.slotOf(name) });
      }
    }
  }

  /** The 1–5 slot map, always five entries (a weapon appears at most once). */
  get slots() {
    const s = Array.isArray(Settings.slots) && Settings.slots.length === 5 ? Settings.slots : AR.slots;
    return s.map((n) => (AR.order.includes(n) ? n : null));
  }
  slotOf(name) { const i = this.slots.indexOf(name); return i < 0 ? null : i + 1; }
  /** What key n (1–5) selects, if it holds something unlocked. */
  atSlot(n) { const w = this.slots[n - 1]; return w && this.has(w) ? w : null; }
  /** Put a weapon on key n; whatever was there moves to the weapon's old key. */
  assign(name, n) {
    const s = this.slots.slice();
    const old = s.indexOf(name);
    if (old >= 0) s[old] = s[n - 1];
    s[n - 1] = name;
    setSetting('slots', s);
  }
  resetSlots() { setSetting('slots', AR.slots.slice()); }

  /** Unlocked weapons in inventory order, then the next one still locked (shown greyed with its wave). */
  list() { return AR.order.map((name) => ({ name, label: AR.names[name], unlocked: this.has(name), wave: AR.unlock[name], slot: this.slotOf(name) })); }

  /** The weapon after `current` in slot order (touch: the weapon button cycles). */
  next(current, step = 1) {
    const owned = this.slots.filter((w) => w && this.has(w));
    for (const w of AR.order) if (this.has(w) && !owned.includes(w)) owned.push(w);
    if (!owned.length) return current;
    const i = owned.indexOf(current);
    return owned[(Math.max(0, i) + step + owned.length) % owned.length];
  }
}
