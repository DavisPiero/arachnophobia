// Every screen outside play: boot gate -> loading (a boot log typing itself out) -> main menu (an old terminal on a
// lab bench), plus pause, game over and the four-tab settings. One terminal look throughout (user: "make it Unix").
import { Config } from '../core/Config.js';
import { Settings, setSetting, ACTIONS, bindKey, resetKeys, keyLabel } from '../core/Settings.js';
import { Quality, isTouch } from '../core/Quality.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The boot log: [delay before the line in ms, text, class]. Real loading steps are slotted in as they happen.
const BOOT_LOG = [
  [300, 'ARACHNE field kernel 2.6.13 #1 Fri Oct 31 03:12:44'],
  [140, 'memory: 640K ok'],
  [120, 'hda: ST-251 40MB, 820 cyl'],
  [380, 'mounting /dev/specimen0 ........ ok'],
  [160, 'mounting /dev/specimen1 ........ ok'],
  [160, 'mounting /dev/specimen4 ........ ok'],
  [700, 'mounting /dev/specimen7 ........ FAILED', 'bad'],
  [200, 'containment: enclosure 7 seal pressure 0.00 kPa', 'warn'],
  [240, 'containment: enclosure 7 is empty', 'warn'],
  [500, 'net: field station link up (cabin, 3 windows)'],
  [260, 'checking window glass ........ 3 intact'],
  [300, 'checking ammunition ........ 40 rounds on the table'],
  [600, 'sensor 2: movement under the floor', 'warn'],
  [900, 'sensor 2: movement under the floor', 'warn'],
  [300, 'they are already inside the walls', 'bad'],
  [700, 'do not let the fire go out'],
];

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
    this.log = $('boot-log');
    this.onOptions = null;      // game sets this: called when a graphics option changes
    this.settingsFrom = null;   // the screen to go back to
    this.startBtn.disabled = true;

    // stop clicks on menus from reaching the game
    for (const s of [this.boot, this.loadingScreen, this.start, this.pause, this.over, this.settings]) s.addEventListener('pointerdown', (e) => e.stopPropagation());

    $('btn-settings-menu').addEventListener('click', () => this.openSettings(this.start));
    $('btn-settings-pause').addEventListener('click', () => this.openSettings(this.pause));
    $('btn-settings-back').addEventListener('click', () => this.closeSettings());
    this.wireSettings();
    this.wireKeyboardNav();
    this.drawWebs();
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

  /** The loading screen: types the boot log while `loaded` (a promise) finishes, for at least Config.loading.minSeconds. */
  async runLoading(loaded) {
    this.boot.classList.add('hidden');
    this.loadingScreen.classList.remove('hidden');
    const t0 = performance.now();
    this.logT0 = t0;
    let done = false;
    loaded.then(() => { done = true; });
    const progress = $('boot-progress');
    const bar = () => {
      const k = done ? 1 : Math.min(0.95, (performance.now() - t0) / 1000 / (Config.loading.minSeconds + 2));
      const n = Math.round(k * 24);
      progress.textContent = `[${'#'.repeat(n)}${'.'.repeat(24 - n)}] ${done ? 'ready' : 'loading'}`;
    };
    const total = BOOT_LOG.reduce((s, l) => s + l[0], 0);
    const scale = Math.min(1, (Config.loading.minSeconds * 1000 - 600) / total);
    for (const [ms, text, cls] of BOOT_LOG) {
      await wait(ms * scale);
      this.logLine(text, cls);
      bar();
      if (cls === 'bad') this.glitch();
    }
    while (!done || performance.now() - t0 < Config.loading.minSeconds * 1000) { bar(); await wait(120); }
    bar();
    this.logLine('login: _');
    await wait(450);
    // a hard cut to black, then the menu
    this.glitch(); await wait(120);
    this.loadingScreen.classList.add('cut');
    await wait(380);
  }

  logLine(text, cls = '') {
    const t = ((performance.now() - (this.logT0 || 0)) / 1000).toFixed(6).padStart(11, ' ');
    const line = document.createElement('span');
    if (cls) line.className = cls;
    line.textContent = `[${t}] ${text}\n`;
    this.log.appendChild(line);
    // keep the newest lines on screen
    while (this.log.scrollHeight > this.log.clientHeight + 4 && this.log.firstChild) this.log.removeChild(this.log.firstChild);
  }

  glitch() {
    this.loadingScreen.classList.add('glitch');
    setTimeout(() => this.loadingScreen.classList.remove('glitch'), 90 + Math.random() * 80);
  }

  /** Progress from the real loader: the progress bar shows it; the log tells its own story. */
  setLoading() {}

  ready() { this.startBtn.disabled = false; this.loading.textContent = ''; }

  showMain() {
    this.loadingScreen.classList.add('hidden');
    this.start.classList.remove('hidden');
    requestAnimationFrame(() => this.start.classList.add('in'));
    this.select(this.start, 0);
  }

  // ---------------------------------------------------------------- the other screens

  showStart(v) { this.start.classList.toggle('hidden', !v); }
  showPause(v) {
    this.pause.classList.toggle('hidden', !v);
    if (!v) this.settings.classList.add('hidden');
    else this.select(this.pause, 0);
  }
  showOver(v, stats) {
    if (stats) $('over-stats').textContent = `You held out until wave ${stats.wave}. Spiders killed: ${stats.kills}.`;
    this.over.classList.toggle('hidden', !v);
    if (v) this.select(this.over, 0);
  }

  openSettings(from) {
    this.settingsFrom = from;
    from.classList.add('hidden');
    this.refreshSettings();
    this.settings.classList.remove('hidden');
  }
  closeSettings() {
    this.stopListening();
    this.settings.classList.add('hidden');
    if (this.settingsFrom) { this.settingsFrom.classList.remove('hidden'); this.select(this.settingsFrom, 0); }
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
    $('set-quality').value = Settings.quality;
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
    for (const s of [this.settings, this.pause, this.over, this.start]) if (!s.classList.contains('hidden')) return s;
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

  // ---------------------------------------------------------------- webs in the corners of the lab

  drawWebs() {
    const lab = this.start.querySelector('.lab');
    const corners = [['left', 'top', 1, 1], ['right', 'top', -1, 1], ['right', 'bottom', -1, -1]];
    corners.forEach(([h, v, sx, sy], k) => {
      const size = [300, 230, 200][k];
      lab.insertAdjacentHTML('beforeend', webSVG(size, k * 7 + 3, sx, sy, `${h}:0;${v}:0`));
    });
  }
}

// A corner web: spokes out from the corner, a sagging spiral between them, a few broken strands.
function webSVG(size, seed, sx, sy, pos) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const spokes = 7;
  const angles = [];
  for (let i = 0; i < spokes; i++) angles.push((i / (spokes - 1)) * (Math.PI / 2) + (rnd() - 0.5) * 0.12);
  const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  let d = '';
  for (const a of angles) { const [x, y] = P(a, size * (0.9 + rnd() * 0.15)); d += `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`; }
  for (let r = 18; r < size * 0.95; r += 12 + rnd() * 10) {
    if (rnd() < 0.12) continue; // a broken ring
    for (let i = 0; i < spokes - 1; i++) {
      const a0 = angles[i], a1 = angles[i + 1];
      const r0 = r * (0.97 + rnd() * 0.06), r1 = r * (0.97 + rnd() * 0.06);
      const [x0, y0] = P(a0, r0), [x1, y1] = P(a1, r1);
      const [mx, my] = P((a0 + a1) / 2, r * 0.9); // sags toward the corner
      d += `M${x0.toFixed(1)} ${y0.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
  }
  const t = `scale(${sx},${sy})`;
  return `<svg class="web" width="${size}" height="${size}" viewBox="${sx < 0 ? -size : 0} ${sy < 0 ? -size : 0} ${size} ${size}" style="${pos}" aria-hidden="true">
    <path d="${d}" transform="${t}" fill="none" stroke="rgba(200,210,200,0.55)" stroke-width="0.7"/></svg>`;
}
