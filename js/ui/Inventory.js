// The inventory (I, or the inventory button on the touch pause screen): the game pauses. Two tabs (user, 2026-11-15):
// Weapons (five slots in key order) and Items (bandages). The picked one large on the right with a few words about it.
// Drag a weapon onto another slot to change the order; keys 1–5 follow the order (no key-binding screen).
import { icon } from './Icons.js';

const $ = (id) => document.getElementById(id);
const ABOUT = {
  fists: 'Bare knuckles. Enough for the small ones, if you are quick.',
  rifle: 'Lever-action. Load it at the ammo table, round by round.',
  axe: 'Heavy and slow. Splits a body in one swing if you land it.',
  shotgun: 'Two barrels, two shells. Close in, nothing gets up again.',
  flare: 'Throw one at a window. They will not come near it while it burns.',
  bandage: 'Kept on the metal medical table. Wrap one there to get your strength back.',
};

export class Inventory {
  constructor({ arsenal, weapon, isTouch }) {
    this.arsenal = arsenal; this.weapon = weapon; this.isTouch = isTouch;
    this.screen = $('screen-inventory');
    this.gridEl = $('inv-grid');
    this.detailEl = $('inv-detail');
    this.picked = null;
    this.tab = 'weapons';
    for (const t of ['weapons', 'items']) $('tab-' + t).addEventListener('click', () => { this.tab = t; this.picked = t === 'items' ? 'bandage' : this.weapon.want; this.draw(); });
    this.onClose = null;     // the game sets this (resumes play)
    this.supplies = null;    // the game sets this: () => ({ bandages })
    this.screen.addEventListener('pointerdown', (e) => e.stopPropagation());
    $('btn-inv-done').addEventListener('click', () => this.close());
    $('btn-inv-hold').addEventListener('click', () => { if (this.picked && this.weapon.select(this.picked)) this.close(); });
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'KeyI' || e.code === 'Escape') { e.preventDefault(); this.close(); }
    });
    // drag to reorder (pointer events, so it works with a finger too)
    this.drag = null;
    addEventListener('pointermove', (e) => {
      const d = this.drag; if (!d) return;
      if (!d.ghost && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
        d.ghost = d.el.cloneNode(true); d.ghost.classList.add('inv-ghost'); document.body.appendChild(d.ghost);
        d.el.classList.add('dragging');
      }
      if (d.ghost) d.ghost.style.transform = `translate(${e.clientX - 40}px, ${e.clientY - 40}px)`;
    });
    addEventListener('pointerup', (e) => {
      const d = this.drag; if (!d) return;
      this.drag = null;
      d.el.classList.remove('dragging');
      if (!d.ghost) return;
      d.ghost.remove();
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.inv-slot[data-n]');
      if (over && +over.dataset.n !== d.n) { this.arsenal.assign(d.name, +over.dataset.n); this.picked = d.name; this.draw(); }
    });
  }

  get open() { return !this.screen.classList.contains('hidden') && !this.screen.classList.contains('closing'); }

  show() {
    this.tab = 'weapons';
    this.picked = this.weapon.want && this.arsenal.has(this.weapon.want) ? this.weapon.want : null;
    this.draw();
    this.screen.classList.remove('hidden', 'closing');
  }
  close() {
    if (!this.open) return;
    this.screen.classList.add('closing');   // fades out (css), then hides
    setTimeout(() => { this.screen.classList.add('hidden'); this.screen.classList.remove('closing'); }, 180);
    this.onClose?.();
  }

  /** Put a weapon at position n (1–5); whatever was there takes its old place. */
  assign(n) { if (this.picked) { this.arsenal.assign(this.picked, n); this.draw(); } }

  draw() {
    const list = this.arsenal.list();
    for (const t of ['weapons', 'items']) $('tab-' + t).classList.toggle('on', this.tab === t);
    this.gridEl.innerHTML = '';
    this.gridEl.className = 'inv-' + this.tab;
    if (this.tab === 'weapons') {
      this.arsenal.slots.forEach((name, i) => {
        const w = list.find((x) => x.name === name);
        const el = document.createElement('button');
        el.className = 'inv-slot'; el.dataset.n = i + 1;
        if (!w) { el.disabled = true; this.gridEl.appendChild(el); return; }
        el.classList.toggle('locked', !w.unlocked);
        el.classList.toggle('picked', name === this.picked);
        el.innerHTML = `<span class="inv-key">${i + 1}</span>${icon(name)}${!w.unlocked ? '<span class="inv-note">locked</span>' : name === 'flare' ? `<span class="inv-note">×${this.arsenal.flares}</span>` : ''}`;
        el.addEventListener('pointerdown', (e) => {
          this.picked = name; this.draw();
          if (w.unlocked) this.drag = { name, n: i + 1, el: this.gridEl.children[i], x: e.clientX, y: e.clientY };
        });
        el.addEventListener('dblclick', () => { if (w.unlocked && this.weapon.select(name)) this.close(); });
        this.gridEl.appendChild(el);
      });
    } else {
      const n = this.supplies?.().bandages || 0;
      const b = document.createElement('button');
      b.className = 'inv-slot picked';
      b.innerHTML = `${icon('bandage')}<span class="inv-note">×${n}</span>`;
      this.gridEl.appendChild(b);
    }
    const p = this.picked, w = list.find((x) => x.name === p);
    const name = p === 'bandage' ? 'Bandages' : w?.label;
    this.detailEl.innerHTML = p ? `<div class="inv-big">${icon(p)}</div><div><h3>${name}</h3><p>${ABOUT[p] || ''}</p>`
      + (w && !w.unlocked ? `<p class="dim">Comes at wave ${w.wave}.</p>` : '') + '</div>' : '<p class="dim">Pick something.</p>';
    $('btn-inv-hold').classList.toggle('hidden', this.tab !== 'weapons');
    $('btn-inv-hold').disabled = !w || !w.unlocked;
    $('inv-tip').textContent = this.tab === 'weapons' ? 'Drag to reorder · keys 1–5 follow · double-click to hold' : 'Bandages are used at the medical table';
  }
}
