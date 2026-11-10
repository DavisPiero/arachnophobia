// Heads-up display: ammo, health, interact prompt, reload ring, wave messages, short notices ("NO AMMO") and
// first-time hints (each shown once per browser, and only while Settings → Gameplay → hints is on).
import { Config } from '../core/Config.js';
import { Settings, keyLabel } from '../core/Settings.js';

const $ = (id) => document.getElementById(id);
const HINTS_KEY = 'arachnophobia.hints.v1';

export class HUD {
  constructor(isTouch) {
    this.isTouch = isTouch;
    this.root = $('hud');
    this.mag = $('ammo-mag'); this.stock = $('ammo-stock'); this.ammo = $('ammo');
    this.health = $('health'); this.healthFill = $('health-fill'); this.healthTrail = $('health-trail');
    this.prompt = $('prompt');
    this.ring = $('reload-ring'); this.ringBar = this.ring.querySelector('.bar');
    this.message = $('message');
    this.noticeEl = $('notice');
    this.hintEl = $('hint');
    this.muteBtn = $('btn-mute');
    this.msgTimer = 0; this.noticeTimer = 0; this.hintTimer = 0;
    this.hintQueue = [];
    try { this.seen = new Set(JSON.parse(localStorage.getItem(HINTS_KEY) || '[]')); } catch (e) { this.seen = new Set(); }
    this._last = {};
  }
  setAim(v) { this.set('aim', v, (on) => { $('crosshair').style.opacity = on ? '0' : ''; }); }
  show(v) { this.root.classList.toggle('hidden', !v); }

  set(key, value, fn) { if (this._last[key] !== value) { this._last[key] = value; fn(value); } }

  /** The key (desktop) or button (touch) for an action, as a little key cap. */
  key(action, touchName) { return `<span class="key">${this.isTouch ? touchName : keyLabel(Settings.keys[action])}</span>`; }

  update(dt, { mag, stock, health, prompt, reloadT, reloading, muted, held }) {
    this.set('held', held, (v) => { this.ammo.classList.toggle('dim', v === 'axe'); });
    this.set('mag', mag, (v) => { this.mag.textContent = v; this.ammo.classList.toggle('empty', v === 0); });
    this.set('stock', stock, (v) => { this.stock.textContent = v; });
    const prev = this._last.health;
    this.set('health', Math.round(health), (v) => {
      const w = `calc(${(v / Config.player.maxHealth) * 100}% - 2px)`;
      this.healthFill.style.width = w;
      this.healthTrail.style.width = w;   // the trail follows after a delay (CSS), showing what was lost
      this.health.classList.toggle('low', v < 35);
      if (prev !== undefined && v < prev) {
        this.health.classList.remove('hit'); void this.health.offsetWidth; this.health.classList.add('hit');
      }
    });
    const ptext = prompt ? prompt.text : '';
    this.set('prompt', ptext + (prompt?.can ? '1' : '0'), () => {
      if (!prompt) { this.prompt.classList.remove('show'); return; }
      this.prompt.innerHTML = prompt.can ? `${this.key('interact', 'USE')}${ptext}` : ptext;
      this.prompt.classList.add('show');
    });
    this.ring.classList.toggle('show', reloading);
    if (reloading) this.ringBar.style.strokeDashoffset = String(100.5 * (1 - reloadT));
    this.set('muted', muted, (v) => { this.muteBtn.textContent = v ? '🔇' : '🔊'; });
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message.classList.remove('show'); }
    if (this.noticeTimer > 0) { this.noticeTimer -= dt; if (this.noticeTimer <= 0) this.noticeEl.classList.remove('show'); }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) { this.hintEl.classList.remove('show'); this.hintGap = 0.8; }
    } else if (this.hintQueue.length && (this.hintGap = (this.hintGap || 0) - dt) <= 0) {
      const [html, secs] = this.hintQueue.shift();
      this.hintEl.innerHTML = html; this.hintEl.classList.add('show'); this.hintTimer = secs;
    }
  }

  /** Big centred title (waves, a window breaking). */
  flash(title, sub = '', seconds = 3.5) {
    this.message.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.message.classList.add('show');
    this.msgTimer = seconds;
  }

  /** Short warning under the crosshair, e.g. NO AMMO. */
  notice(title, sub = '', seconds = 1.6) {
    this.noticeEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.noticeEl.classList.add('show');
    this.noticeTimer = seconds;
  }

  /** A first-time hint: shown once ever per id, queued so two never overlap. */
  hint(id, html, seconds = 5) {
    if (!Settings.hints || this.seen.has(id)) return;
    this.seen.add(id);
    try { localStorage.setItem(HINTS_KEY, JSON.stringify([...this.seen])); } catch (e) { /* private mode */ }
    this.hintQueue.push([html, seconds]);
  }
}
