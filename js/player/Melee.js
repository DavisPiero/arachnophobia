// Melee: the axe (2 to hold it, left click / FIRE to swing) and the stomp (C / STOMP).
//
// Axe: held in the right hand; a swing chops across the view (~0.7 s, no ammo). It hits the nearest spider within reach
// in front of you: inside the cabin, or at a window you are standing at. Through intact glass it only cracks the glass
// (your own window takes the damage); once the glass is cracked or gone the axe reaches the spider.
// Stomp: you look down and stamp. Small spiders on the floor in front of you die; bigger ones are shoved back.
// All numbers: Config.melee.
import * as THREE from 'three';
import { Config } from '../core/Config.js';

const M = Config.melee;

export class Melee {
  constructor({ player, weapon, camera, audio, events, windows, spiders }) {
    this.player = player;
    this.weapon = weapon;
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.windows = windows;
    this.spiders = spiders;
    this.ray = new THREE.Raycaster();
    this.reset();
  }

  reset() {
    this.axeT = -1; this.stompT = -1; this.hitDone = false;
    this.weapon.axeT = -1; this.weapon.stompT = -1; this.weapon.busy = false;
    this.player.dip = 0;
  }

  get busy() { return this.axeT >= 0 || this.stompT >= 0; }

  canStart() { return !this.busy && !this.weapon.reloading && !this.player.dead; }

  tryAxe() {
    if (!this.canStart() || !this.weapon.ready('axe')) return false;
    this.axeT = 0; this.hitDone = false;
    this.audio.play('axeSwing', { volume: 0.9, delay: 0.14 });
    return true;
  }

  tryStomp() {
    if (!this.canStart()) return false;
    this.stompT = 0; this.hitDone = false;
    return true;
  }

  update(dt) {
    if (this.axeT >= 0) {
      this.axeT += dt / M.axe.time;
      if (!this.hitDone && this.axeT * M.axe.time >= M.axe.hitAt) { this.hitDone = true; this.axeHit(); }
      if (this.axeT >= 1) this.axeT = -1;
    }
    if (this.stompT >= 0) {
      this.stompT += dt / M.stomp.time;
      if (!this.hitDone && this.stompT * M.stomp.time >= M.stomp.hitAt) { this.hitDone = true; this.stompHit(); }
      if (this.stompT >= 1) this.stompT = -1;
    }
    this.weapon.axeT = this.axeT; this.weapon.stompT = this.stompT;
    this.weapon.busy = this.busy;
    this.poseBoot();
  }

  // ------------------------------------------------------------------ axe
  axeHit() {
    const eye = this.camera.getWorldPosition(_eye);
    const fwd = this.camera.getWorldDirection(_fwd);
    const A = M.axe;
    // nearest spider in reach and in front
    let best = null, bestD = Infinity;
    for (const s of this.spiders.spiders) {
      if (!s.alive || s.state === 'vanish' || s.state === 'hidden') continue;
      const c = s.visual.hitbox.getWorldPosition(_c);
      const to = _to.subVectors(c, eye);
      const d = to.length() - s.visual.radius * 0.5;
      if (d > A.reach) continue;
      if (to.normalize().dot(fwd) < Math.cos(A.cone)) continue;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      const c = best.visual.hitbox.getWorldPosition(_c);
      const win = this.windowBetween(eye, c);
      if (win === 'wall') best = null;
      else if (win && win.stage === 0) { this.hitGlass(win, c); return; }
    }
    if (best) {
      const c = best.visual.hitbox.getWorldPosition(_c);
      const dir = _to.subVectors(c, eye).normalize();
      best.takeHit(A.damage, c, dir, { by: 'axe' });
      this.player.shake = Math.max(this.player.shake, 0.35);
      this.events.emit('axeHit', { spider: best });
      return;
    }
    // nothing alive in reach: did we hit glass or wood?
    const glass = this.glassInFront(eye, fwd, A.reach);
    if (glass && glass.win.stage === 0) { this.hitGlass(glass.win, glass.point); return; }
    this.ray.set(eye, fwd); this.ray.far = A.reach;
    const wood = this.ray.intersectObjects(this.weapon.worldMeshes, false)[0];
    if (wood) {
      this.audio.play('bulletImpactWood', { position: wood.point, volume: 0.6, rate: 0.7, exterior: false });
      this.player.shake = Math.max(this.player.shake, 0.25);
    }
  }

  hitGlass(win, point) {
    this.windows.damage(win.id, M.axe.windowDamage, point);
    this.audio.play('glassCrack', { position: win.center, volume: 0.8 });
    this.player.shake = Math.max(this.player.shake, 0.3);
    this.events.emit('axeHit', { window: win });
  }

  /** The window the line eye -> p passes through, 'wall' if it leaves the cabin through a wall, or null if it stays inside. */
  windowBetween(eye, p) {
    let crossesOut = false;
    for (const w of this.windows.windows) {
      const n = w.normal;
      const a = _a.subVectors(eye, w.center).dot(n), b = _b.subVectors(p, w.center).dot(n);
      if (a < 0 && b > 0) {
        crossesOut = true;
        const t = a / (a - b);
        const hit = _h.copy(eye).lerp(p, t);
        if (this.inWindow(w, hit, 0.15)) return w;
      }
    }
    return crossesOut ? 'wall' : null;
  }

  glassInFront(eye, fwd, reach) {
    for (const w of this.windows.windows) {
      const denom = fwd.dot(w.normal);
      if (denom <= 0.05) continue;
      const t = _a.subVectors(w.center, eye).dot(w.normal) / denom;
      if (t < 0 || t > reach) continue;
      const hit = _h.copy(eye).addScaledVector(fwd, t);
      if (this.inWindow(w, hit, 0)) return { win: w, point: hit.clone() };
    }
    return null;
  }

  inWindow(w, p, margin) {
    const side = _s.set(-w.normal.z, 0, w.normal.x);
    const d = _a.subVectors(p, w.center);
    return Math.abs(d.dot(side)) <= w.width / 2 + margin && Math.abs(d.y) <= w.height / 2 + margin;
  }

  // ------------------------------------------------------------------ stomp
  stompHit() {
    const S = M.stomp;
    const p = this.player.position;
    const fwd = this.player.forward(_fwd);
    const foot = _h.copy(p).addScaledVector(fwd, 0.45);
    this.audio.play('stomp', { position: foot, volume: 1, exterior: false });
    this.player.shake = Math.max(this.player.shake, 0.4);
    for (const s of this.spiders.spiders) {
      if (!s.alive || s.surface !== 'floor') continue;
      const sp = s.root.position;
      const to = _to.set(sp.x - p.x, 0, sp.z - p.z);
      const d = to.length() - s.visual.radius * 0.4;
      if (d > S.reach) continue;
      if (to.normalize().dot(fwd) < Math.cos(S.cone)) continue;
      if (S.kills.includes(s.type) || S.killsSize.includes(s.size)) {
        s.takeHit(9999, _c.copy(sp).setY(0.05), _b.set(0, -1, 0).addScaledVector(fwd, 0.3).normalize(), { by: 'stomp' });
      } else {
        // too big to crush: shove it back and make it reel
        s.root.position.addScaledVector(to, S.push);
        s.collide?.();
        s.flinch = 0.5;
        s.visual.rig.jolt?.(0.8);
        this.audio.play('bulletImpactFlesh', { position: sp, volume: 0.5, rate: 0.8, exterior: false });
      }
      this.events.emit('stompHit', { spider: s });
    }
  }

  /** The head dips to look at the stomp. No boot or legs are drawn (user's call: lighter, nothing to see below). */
  poseBoot() {
    const t = this.stompT;
    if (t < 0) { this.player.dip *= 0.8; return; }
    const ramp = (x, a, b) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    this.player.dip = 0.75 * ramp(t, 0, 0.3) * (1 - ramp(t, 0.65, 1));
  }
}

const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _c = new THREE.Vector3(), _to = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _h = new THREE.Vector3(), _s = new THREE.Vector3();
