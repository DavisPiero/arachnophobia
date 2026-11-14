// The inventory (I, or the inventory button on the touch pause screen): the game pauses and lists your weapons.
// Pick one (click, or arrows + Enter), then a number (key 1–5 or the number buttons) to put it on that key.
// Locked weapons are listed greyed with the wave they come at. Picking "hold it" takes the weapon in hand.
import { Settings, keyLabel } from '../core/Settings.js';

const $ = (id) => document.getElementById(id);

export class Inventory {
  constructor({ arsenal, weapon, keyboard, isTouch }) {
    this.arsenal = arsenal; this.weapon = weapon; this.keyboard = keyboard; this.isTouch = isTouch;
    this.screen = $('screen-inventory');
    this.listEl = $('inv-list');
    this.slotsEl = $('inv-slots');
    this.helpEl = $('inv-help');
    this.picked = null;
    this.onClose = null;     // the game sets this (resumes play)
    this.screen.addEventListener('pointerdown', (e) => e.stopPropagation());
    $('btn-inv-done').addEventListener('click', () => this.close());
    $('btn-inv-hold').addEventListener('click', () => { if (this.picked && this.weapon.select(this.picked)) this.close(); });
    addEventListener('keydown', (e) => {
      if (!this.open || this.keyboard.capture) return;
      const n = slotKey(e.code);
      if (n) { e.preventDefault(); this.assign(n); return; }
      if (e.code === Settings.keys.inventory || e.code === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  get open() { return !this.screen.classList.contains('hidden'); }

  show() {
    this.picked = this.weapon.want && this.arsenal.has(this.weapon.want) ? this.weapon.want : null;
    this.draw();
    this.screen.classList.remove('hidden');
  }
  close() {
    if (!this.open) return;
    this.screen.classList.add('hidden');
    this.onClose?.();
  }

  assign(n) {
    if (!this.picked) { this.help('Pick a weapon first.'); return; }
    this.arsenal.assign(this.picked, n);
    this.draw();
    this.help(`${this.arsenal.list().find((w) => w.name === this.picked).label} is on ${this.key(n)} now.`);
  }

  key(n) { return this.isTouch ? `slot ${n}` : `key ${keyLabel(Settings.keys['slot' + n])}`; }
  help(text) { this.helpEl.textContent = text; }

  draw() {
    this.listEl.innerHTML = '';
    for (const w of this.arsenal.list()) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = `${w.slot ? `[${w.slot}]` : '[ ]'} ${w.label}`;
      b.disabled = !w.unlocked;
      if (w.name === this.picked) b.classList.add('picked');
      b.addEventListener('click', () => { this.picked = w.name; this.draw(); this.help(`Now press ${this.isTouch ? 'a number' : '1–5'} to put it on that key, or hold it.`); });
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = !w.unlocked ? `comes at wave ${w.wave}` : w.name === 'flare' ? `${this.arsenal.flares} left` : w.name === this.weapon.want ? 'in hand' : '';
      li.append(b, desc);
      this.listEl.appendChild(li);
    }
    this.slotsEl.innerHTML = '';
    const slots = this.arsenal.slots;
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button');
      const w = slots[n - 1];
      b.innerHTML = `<b>${n}</b><span>${w ? this.arsenal.list().find((x) => x.name === w).label.split(' ').pop() : '—'}</span>`;
      b.classList.toggle('locked', !!w && !this.arsenal.has(w));
      b.addEventListener('click', () => this.assign(n));
      this.slotsEl.appendChild(b);
    }
    $('btn-inv-hold').disabled = !this.picked;
    if (!this.picked) this.help('Pick a weapon, then a number to put it on that key.');
  }
}

function slotKey(code) {
  for (let n = 1; n <= 5; n++) if (code === Settings.keys['slot' + n] || code === 'Numpad' + n) return n;
  return 0;
}
