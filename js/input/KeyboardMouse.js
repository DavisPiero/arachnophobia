// Desktop controls: WASD / arrows move, mouse looks (pointer lock), click fires,
// E interacts, T flashlight, Shift sprint, right mouse aims, M mutes, Esc pauses (the browser releases pointer lock, which we treat as pause).
import { Config } from '../core/Config.js';

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
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') input.press('interact');
      if (e.code === 'KeyM') input.press('mute');
      if (e.code === 'KeyT') input.press('torch');
      if (e.code === 'KeyP') input.press('pause');
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
      const s = Config.player.lookSensitivityMouse;
      // ignore absurd spikes some browsers send when locking
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      input.addLook(-e.movementX * s, -e.movementY * s);
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
    const k = this.keys;
    this.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.moveY = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }
}
