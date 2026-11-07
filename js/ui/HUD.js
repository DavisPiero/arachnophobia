// Heads-up display: ammo, health, interact prompt, reload ring, wave messages.
import { Config } from '../core/Config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(isTouch) {
    this.isTouch = isTouch;
    this.root = $('hud');
    this.mag = $('ammo-mag'); this.stock = $('ammo-stock'); this.ammo = $('ammo');
    this.health = $('health'); this.healthFill = $('health-fill');
    this.prompt = $('prompt');
    this.ring = $('reload-ring'); this.ringBar = this.ring.querySelector('.bar');
    this.message = $('message');
    this.muteBtn = $('btn-mute');
    this.msgTimer = 0;
    this._last = {};
  }
  show(v) { this.root.classList.toggle('hidden', !v); }

  set(key, value, fn) { if (this._last[key] !== value) { this._last[key] = value; fn(value); } }

  update(dt, { mag, stock, health, prompt, reloadT, reloading, muted }) {
    this.set('mag', mag, (v) => { this.mag.textContent = v; this.ammo.classList.toggle('empty', v === 0); });
    this.set('stock', stock, (v) => { this.stock.textContent = v; });
    this.set('health', Math.round(health), (v) => {
      this.healthFill.style.width = `${(v / Config.player.maxHealth) * 100}%`;
      this.health.classList.toggle('low', v < 35);
    });
    const ptext = prompt ? prompt.text : '';
    this.set('prompt', ptext + (prompt?.can ? '1' : '0'), () => {
      if (!prompt) { this.prompt.classList.remove('show'); return; }
      const key = this.isTouch ? 'USE' : 'E';
      this.prompt.innerHTML = prompt.can ? `<span class="key">${key}</span>${ptext}` : ptext;
      this.prompt.classList.add('show');
    });
    this.ring.classList.toggle('show', reloading);
    if (reloading) this.ringBar.style.strokeDashoffset = String(100.5 * (1 - reloadT));
    this.set('muted', muted, (v) => { this.muteBtn.textContent = v ? '🔇' : '🔊'; });
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message.classList.remove('show'); }
  }

  flash(title, sub = '', seconds = 3.5) {
    this.message.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.message.classList.add('show');
    this.msgTimer = seconds;
  }
}
