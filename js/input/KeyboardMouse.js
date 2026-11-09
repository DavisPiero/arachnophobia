// Desktop controls: WASD / arrows move, mouse looks (pointer lock), click fires,
// keys come from Settings.keys (defaults: E use, 1 rifle, 2 axe, C stomp, Q flashlight, Shift sprint, M mute, P pause); right mouse aims, Esc pauses (the browser releases pointer lock, which we treat as pause).
import { Config } from '../core/Config.js';
import { Settings } from '../core/Settings.js';

export class KeyboardMouse {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.keys = new Set();
    this.moveX = 0; this.moveY = 0;
    this.enabled = false;
    this.locked = false;
    this.onLockChange = null; // game sets this: (locked) => {}

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.capture) { e.preventDefault(); this.capture(e.code); return; } // Settings → Controls is listening for a key
      this.keys.add(e.code);
      const K = Settings.keys;
      for (const a of ['interact', 'rifle', 'axe', 'stomp', 'mute', 'torch', 'pause']) if (e.code === K[a]) input.press(a);
      if (e.code === 'Numpad1') input.press('rifle');
      if (e.code === 'Numpad2') input.press('axe');
      if (e.code === 'Enter' || e.code === 'Space') input.press('start');
      this.update();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.update(); });
    addEventListener('blur', () => { this.keys.clear(); this.update(); input.fireHeld = false; input.aimHeld = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (input.isTouch && e.pointerType === 'touch') return;
      if (e.button === 2) { if (this.enabled) input.aimHeld = true; return; }
      if (e.button !== 0) return;
      if (this.enabled && !this.locked && canvas.requestPointerLock) {
        this.requestLock();
        return; // the click that grabs the mouse does not fire
      }
      if (this.enabled) { input.fireHeld = true; input.press('fire'); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) input.fireHeld = false; if (e.button === 2) input.aimHeld = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = Config.player.lookSensitivityMouse * Settings.look;
      // ignore absurd spikes some browsers send when locking
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      input.addLook(-e.movementX * s, -e.movementY * s * (Settings.invertY ? -1 : 1));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  requestLock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (_) {} });
    } catch (_) { /* not available (e.g. headless) */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  setEnabled(v) { this.enabled = v; if (!v) { this.keys.clear(); this.update(); } }
  update() {
    const k = this.keys, K = Settings.keys;
    this.moveX = (k.has(K.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(K.left) || k.has('ArrowLeft') ? 1 : 0);
    this.moveY = (k.has(K.forward) || k.has('ArrowUp') ? 1 : 0) - (k.has(K.back) || k.has('ArrowDown') ? 1 : 0);
    // Shift works from either side when sprint is on a Shift key
    this.sprint = k.has(K.sprint) || (K.sprint.startsWith('Shift') && (k.has('ShiftLeft') || k.has('ShiftRight')));
  }
}
