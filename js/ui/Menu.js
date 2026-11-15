// Every screen outside play: boot gate -> loading (a boot log typing itself out) -> main menu (HTML warped onto a
// monitor in the 3D lab, js/ui/MenuScene.js), plus pause, game over and the four-tab settings.
// One terminal look throughout (user: notebook style tried in game, then switched back to terminal).
import { Config } from '../core/Config.js';
import { Settings, setSetting, ACTIONS, bindKey, resetKeys, keyLabel } from '../core/Settings.js';
import { Quality, isTouch } from '../core/Quality.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The boot (user, 2026-11-15: shorter, centred, no scrolling log): garbled letters decode into ARACHNOPHOBIA
// (tap to start), then UPDATING, CALIBRATING, INITIATING each decode in the middle over a thin bar, then the menu.
const BOOT_STEPS = ['UPDATING', 'CALIBRATING', 'INITIATING'];
const GARBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$/<>';

/** Garbled characters settle left to right into `text` over `ms`. */
function decode(el, text, ms = 700) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const fixed = Math.floor(k * text.length);
      let out = text.slice(0, fixed);
      for (let i = fixed; i < text.length; i++) out += text[i] === ' ' ? ' ' : GARBLE[(Math.random() * GARBLE.length) | 0];
      el.textContent = out;
      if (k < 1) requestAnimationFrame(tick); else resolve();
    };
    tick();
  });
}

export class Menu {
  constructor(audio, keyboard) {
    this.audio = audio;
    this.keyboard = keyboard;
    this.boot = $('screen-boot');
    this.loadingScreen = $('screen-loading');
    this.start = $('screen-start');
    this.pause = $('screen-pause');
    this.over = $('screen-over');
    this.settings = $('screen-settings');
    this.startBtn = $('btn-start');
    this.loading = $('loading-text');
    this.onOptions = null;      // game sets this: called when a graphics option changes
    this.settingsFrom = null;   // the screen to go back to
    this.startBtn.disabled = true;
    decode($('boot-text'), 'ARACHNOPHOBIA', 1000).then(() => $('boot-tap').classList.add('show'));

    // stop clicks on menus from reaching the game
    for (const s of [this.boot, this.loadingScreen, this.start, this.pause, this.over, this.settings]) s.addEventListener('pointerdown', (e) => e.stopPropagation());

    $('btn-settings-menu').addEventListener('click', () => this.openSettings(this.start));
    $('btn-settings-pause').addEventListener('click', () => this.openSettings(this.pause));
    $('btn-settings-back').addEventListener('click', () => this.closeSettings());
    this.wireSettings();
    this.wireKeyboardNav();
  }

  // ---------------------------------------------------------------- boot and loading

  /** Resolves on the first click, tap or key (the gesture that may start sound). */
  waitForWake() {
    return new Promise((resolve) => {
      const go = (e) => {
        if (e.type === 'keydown' && (e.repeat || e.metaKey || e.ctrlKey)) return;
        removeEventListener('keydown', go, true); this.boot.removeEventListener('click', go);
        resolve();
      };
      addEventListener('keydown', go, true);
      this.boot.addEventListener('click', go);
    });
  }

  /** The loading screen: the steps decode in turn over a thin bar while `loaded` finishes (at least minSeconds). */
  async runLoading(loaded, steps = BOOT_STEPS, minSeconds = Config.loading.minSeconds) {
    this.boot.classList.add('hidden');
    this.loadingScreen.classList.remove('hidden', 'cut');
    const t0 = performance.now();
    let done = false;
    loaded.then(() => { done = true; });
    const stepEl = $('boot-step'), fill = $('boot-fill');
    const per = minSeconds * 1000 / steps.length;
    for (let i = 0; i < steps.length; i++) {
      fill.style.transform = `scaleX(${(i + 1) / steps.length})`;
      await decode(stepEl, steps[i], Math.min(500, per * 0.5));
      await wait(per * 0.5);
    }
    while (!done) await wait(100);
    this.loadingScreen.classList.add('cut');
    await wait(450);
  }

  glitch() {
    this.loadingScreen.classList.add('glitch');
    setTimeout(() => this.loadingScreen.classList.remove('glitch'), 90 + Math.random() * 80);
  }

  /** Picking begin: the menu CRT dissolves, then the loading screen again (short), then into the cabin. */
  async runEnter() {
    const menuScreen = $('menu-screen');
    menuScreen.classList.add('dissolving');
    await wait(420);
    this.start.classList.add('hidden');
    menuScreen.classList.remove('dissolving');
    await this.runLoading(Promise.resolve(), ['INITIATING'], 0.9);
    this.loadingScreen.classList.add('hidden');
  }

  /** Progress from the real loader: the progress bar shows it; the log tells its own story. */
  setLoading() {}

  ready() { this.startBtn.disabled = false; this.loading.textContent = ''; }

  showMain() {
    this.loadingScreen.classList.add('hidden');
    this.start.classList.remove('hidden');
    requestAnimationFrame(() => { this.start.classList.add('in'); this.crtGlitch($('menu-screen')); });
    this.select(this.start, 0);
  }

  /** The menu monitor glitching as it powers on or changes screen (css .crt-glitch). Only on the 3D menu. */
  crtGlitch(el) {
    if (!el || !document.body.classList.contains('title')) return;
    el.classList.remove('crt-glitch');
    void el.offsetWidth;                       // restart the animation
    el.classList.add('crt-glitch');
    clearTimeout(el.glitchTimer);
    el.glitchTimer = setTimeout(() => el.classList.remove('crt-glitch'), 700);
  }

  // ---------------------------------------------------------------- the other screens

  showStart(v) { this.start.classList.toggle('hidden', !v); }
  showPause(v) {
    this.pause.classList.toggle('hidden', !v);
    if (!v) this.settings.classList.add('hidden');
    else this.select(this.pause, 0);
  }
  showOver(v, stats) {
    if (stats) {
      $('over-title').textContent = stats.dawn ? 'Dawn.' : 'They got in.';
      $('over-stats').textContent = stats.dawn
        ? `The sun is up and they are gone. You survived all ${stats.wave} waves. Spiders killed: ${stats.kills}.`
        : `You held out until wave ${stats.wave}. Spiders killed: ${stats.kills}.`;
    }
    this.over.classList.toggle('hidden', !v);
    if (v) this.select(this.over, 0);
  }

  openSettings(from) {
    this.settingsFrom = from;
    from.classList.add('hidden');
    this.refreshSettings();
    this.settings.classList.remove('hidden');
    this.crtGlitch(this.settings.querySelector('.term-panel'));
  }
  closeSettings() {
    this.stopListening();
    this.settings.classList.add('hidden');
    if (this.settingsFrom) { this.settingsFrom.classList.remove('hidden'); this.select(this.settingsFrom, 0); }
    if (this.settingsFrom === this.start) this.crtGlitch($('menu-screen'));
  }

  // ---------------------------------------------------------------- settings

  wireSettings() {
    const tabs = this.settings.querySelectorAll('.tabs button');
    for (const b of tabs) b.addEventListener('click', () => {
      for (const x of tabs) x.classList.toggle('on', x === b);
      for (const t of this.settings.querySelectorAll('.tab')) t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab);
      this.stopListening();
    });
    const range = (id, key, after) => $(id).addEventListener('input', (e) => { setSetting(key, Number(e.target.value)); after?.(); });
    const check = (id, key, after) => $(id).addEventListener('change', (e) => { setSetting(key, e.target.checked); after?.(); });
    const opts = () => this.onOptions?.();
    range('set-look', 'look');
    check('set-invert', 'invertY');
    check('set-hints', 'hints');
    check('set-effects', 'effects', opts);
    range('set-brightness', 'brightness', opts);
    range('set-fov', 'fov');
    range('set-hud', 'hudOpacity');
    check('set-crosshair', 'crosshair');
    check('set-fps', 'showFps');
    $('set-difficulty').addEventListener('change', (e) => setSetting('difficulty', e.target.value));
    $('set-quality').addEventListener('change', (e) => { setSetting('quality', e.target.value); this.refreshQualityNote(); });
    for (const bus of ['master', 'sfx', 'ambience', 'music']) {
      $(`vol-${bus}`).addEventListener('input', (e) => this.audio.setVolume(bus, Number(e.target.value)));
    }
    $('chk-mute').addEventListener('change', (e) => this.audio.setMuted(e.target.checked));
    $('btn-keys-reset').addEventListener('click', () => { resetKeys(); this.drawKeys(); });
  }

  refreshSettings() {
    $('set-look').value = Settings.look;
    $('set-invert').checked = Settings.invertY;
    $('set-hints').checked = Settings.hints;
    $('set-effects').checked = Settings.effects;
    $('set-brightness').value = Settings.brightness;
    $('set-fov').value = Settings.fov;
    $('set-hud').value = Settings.hudOpacity;
    $('set-crosshair').checked = Settings.crosshair;
    $('set-fps').checked = Settings.showFps;
    $('set-quality').value = Settings.quality;
    $('set-difficulty').value = Settings.difficulty;
    for (const bus of ['master', 'sfx', 'ambience', 'music']) $(`vol-${bus}`).value = this.audio.getVolume(bus);
    $('chk-mute').checked = this.audio.muted;
    this.refreshQualityNote();
    this.drawKeys();
  }

  refreshQualityNote() {
    const want = Settings.quality === 'auto' ? (isTouch ? 'low' : 'high') : Settings.quality;
    $('quality-note').innerHTML = want === Quality.tier ? `running: ${Quality.tier}` :
      `running: ${Quality.tier} · <button class="small-btn" id="btn-reload">reload to apply</button>`;
    $('btn-reload')?.addEventListener('click', () => location.reload());
  }

  drawKeys() {
    const box = $('keybinds');
    box.innerHTML = '';
    for (const [action, label] of ACTIONS) {
      const name = document.createElement('span'); name.textContent = label;
      const btn = document.createElement('button'); btn.textContent = keyLabel(Settings.keys[action]);
      btn.addEventListener('click', () => this.listenFor(action, btn));
      box.append(name, btn);
    }
  }

  listenFor(action, btn) {
    this.stopListening();
    btn.classList.add('listening'); btn.textContent = 'press a key…';
    this.listening = btn;
    this.keyboard.capture = (code) => {
      this.keyboard.capture = null;
      if (code !== 'Escape') bindKey(action, code);
      this.listening = null;
      this.drawKeys();
    };
  }
  stopListening() { if (this.listening) { this.keyboard.capture = null; this.listening = null; this.drawKeys(); } }

  // ---------------------------------------------------------------- keyboard: arrows move the selection, Enter picks

  visibleMenu() {
    for (const s of [this.settings, $('screen-inventory'), this.pause, this.over, this.start]) if (!s.classList.contains('hidden')) return s;
    return null;
  }
  select(screen, i) {
    const items = [...screen.querySelectorAll('.term-menu button')].filter((b) => !b.disabled);
    for (const b of screen.querySelectorAll('.term-menu button')) b.classList.remove('sel');
    if (!items.length) return;
    this.selIndex = (i + items.length) % items.length;
    items[this.selIndex].classList.add('sel');
  }
  wireKeyboardNav() {
    addEventListener('keydown', (e) => {
      if (this.keyboard.capture) return;
      const screen = this.visibleMenu();
      if (!screen || screen === this.settings) return;
      const items = [...screen.querySelectorAll('.term-menu button')].filter((b) => !b.disabled);
      if (!items.length) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.select(screen, (this.selIndex ?? -1) + 1); e.preventDefault(); }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.select(screen, (this.selIndex ?? 1) - 1); e.preventDefault(); }
      if (e.code === 'Enter') { items[this.selIndex ?? 0]?.click(); e.preventDefault(); }
    });
    for (const b of document.querySelectorAll('.term-menu button')) {
      b.addEventListener('pointerenter', () => {
        const screen = b.closest('.screen');
        const items = [...screen.querySelectorAll('.term-menu button')].filter((x) => !x.disabled);
        this.select(screen, items.indexOf(b));
      });
    }
  }
}
