// Touch controls for phones and tablets (landscape).
// Left side: a floating joystick appears where the thumb lands.
// Right side: drag to look/aim. Fire button also aims while held (drag from it).
// Each finger is tracked by its pointerId, so the controls never steal each other's touches.
import { Config } from '../core/Config.js';

export class TouchControls {
  constructor(input, ui) {
    this.input = input;
    this.moveX = 0; this.moveY = 0;
    this.sprint = false;      // joystick pushed to the edge (and mostly forward)
    this.aim = false;         // AIM toggle
    this.enabled = false;
    this.stickId = null; this.stickOrigin = { x: 0, y: 0 };
    this.lookIds = new Map(); // pointerId -> last {x, y}
    this.radius = 56;

    this.zoneMove = ui.querySelector('#zone-move');
    this.zoneLook = ui.querySelector('#zone-look');
    this.stick = ui.querySelector('#stick');
    this.knob = ui.querySelector('#stick-knob');
    this.btnFire = ui.querySelector('#btn-fire');
    this.btnInteract = ui.querySelector('#btn-interact');
    this.btnTorch = ui.querySelector('#btn-torch');
    this.btnAim = ui.querySelector('#btn-aim');

    const opts = { passive: false };
    // --- joystick ---
    this.zoneMove.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      this.zoneMove.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stick.classList.add('active');
      this.setKnob(0, 0);
    }, opts);
    this.zoneMove.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > this.radius) { dx *= this.radius / l; dy *= this.radius / l; }
      this.setKnob(dx, dy);
      // small dead zone, then a gentle curve so slow walking is easy
      const nx = dx / this.radius, ny = dy / this.radius;
      const m = Math.hypot(nx, ny);
      const k = m < 0.12 ? 0 : Math.min(1, (m - 0.12) / 0.88) / (m || 1);
      this.moveX = nx * k;
      this.moveY = -ny * k;
      // past the ring's edge counts as sprint: the thumb has to reach for it
      this.sprint = Math.hypot(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y) > this.radius * 1.15 && this.moveY > 0.6;
      this.stick.classList.toggle('sprint', this.sprint);
    }, opts);
    const endStick = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.moveX = 0; this.moveY = 0; this.sprint = false;
      this.stick.classList.remove('active', 'sprint');
    };
    this.zoneMove.addEventListener('pointerup', endStick);
    this.zoneMove.addEventListener('pointercancel', endStick);

    // --- look zone ---
    const lookDown = (el, isFire) => (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (isFire) { input.fireHeld = true; input.press('fire'); el.classList.add('down'); }
    };
    const lookMove = (e) => {
      const last = this.lookIds.get(e.pointerId);
      if (!last) return;
      e.preventDefault();
      const s = Config.player.lookSensitivityTouch;
      input.addLook(-(e.clientX - last.x) * s, -(e.clientY - last.y) * s);
      last.x = e.clientX; last.y = e.clientY;
    };
    const lookUp = (el, isFire) => (e) => {
      if (!this.lookIds.has(e.pointerId)) return;
      this.lookIds.delete(e.pointerId);
      if (isFire) { input.fireHeld = false; el.classList.remove('down'); }
    };
    for (const [el, isFire] of [[this.zoneLook, false], [this.btnFire, true]]) {
      el.addEventListener('pointerdown', lookDown(el, isFire), opts);
      el.addEventListener('pointermove', lookMove, opts);
      el.addEventListener('pointerup', lookUp(el, isFire));
      el.addEventListener('pointercancel', lookUp(el, isFire));
    }

    // --- interact ---
    this.btnInteract.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      input.press('interact');
      this.btnInteract.classList.add('down');
    }, opts);
    const upI = () => this.btnInteract.classList.remove('down');
    this.btnInteract.addEventListener('pointerup', upI);
    this.btnInteract.addEventListener('pointercancel', upI);

    // --- flashlight and aim toggles ---
    const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { if (!this.enabled) return; e.preventDefault(); e.stopPropagation(); fn(); }, opts);
    tap(this.btnTorch, () => input.press('torch'));
    tap(this.btnAim, () => { this.aim = !this.aim; this.btnAim.classList.toggle('on', this.aim); });

    // stop the page from scrolling / zooming / long-press menus
    ui.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    ui.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  setTorchOn(v) { this.btnTorch.classList.toggle('on', v); }
  setKnob(dx, dy) { this.knob.style.transform = `translate(${dx}px, ${dy}px)`; }
  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      this.stickId = null; this.moveX = 0; this.moveY = 0; this.sprint = false; this.lookIds.clear();
      this.aim = false; this.btnAim?.classList.remove('on');
      this.stick.classList.remove('active');
      this.btnFire.classList.remove('down');
    }
  }
  // Highlight the interact button when something is in reach (the ammo table).
  setInteractAvailable(v, label) {
    this.btnInteract.classList.toggle('available', v);
    if (label) this.btnInteract.textContent = label;
  }
}
