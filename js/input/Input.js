// One input state that the game reads, fed by keyboard/mouse and by touch controls.
// Gameplay never talks to the DOM directly — it reads this object every frame.
import { KeyboardMouse } from './KeyboardMouse.js';
import { TouchControls } from './TouchControls.js';
import { isTouch } from '../core/Quality.js';

export class Input {
  constructor(canvas, ui) {
    this.moveX = 0;           // -1 left .. 1 right
    this.moveY = 0;           // -1 back .. 1 forward
    this.lookDX = 0;          // accumulated radians this frame (yaw)
    this.lookDY = 0;          // (pitch)
    this.fireHeld = false;
    this._pressed = new Set(); // one-frame actions: 'fire', 'interact', 'pause', 'mute', 'start'
    this.enabled = false;
    this.isTouch = isTouch;
    this.keyboard = new KeyboardMouse(this, canvas);
    this.touch = new TouchControls(this, ui);
    if (isTouch) document.body.classList.add('touch');
  }
  press(action) { this._pressed.add(action); }
  consume(action) {
    if (this._pressed.has(action)) { this._pressed.delete(action); return true; }
    return false;
  }
  addLook(dx, dy) { if (this.enabled) { this.lookDX += dx; this.lookDY += dy; } }
  // Called once per frame after the game has read the look delta.
  endFrame() {
    this.lookDX = 0; this.lookDY = 0;
    this._pressed.clear();
  }
  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.moveX = 0; this.moveY = 0; this.fireHeld = false; }
    this.keyboard.setEnabled(v);
    this.touch.setEnabled(v);
  }
  // Read the combined movement vector (keyboard + joystick), clamped to length 1.
  getMove() {
    let x = this.keyboard.moveX + this.touch.moveX;
    let y = this.keyboard.moveY + this.touch.moveY;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x: this.enabled ? x : 0, y: this.enabled ? y : 0 };
  }
}
