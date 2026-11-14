// Flares (unlocked at wave 9): hold one (its weapon key), look at a window, left click / FIRE to throw it.
// It lands burning on the ground outside that window for Config.flares.burn seconds, lighting the wall red;
// while it burns, spiders keep away from that window (SpiderAI: they back off into the dark and try another).
// Each window has its own light, created up front and only dimmed, so lighting a flare never recompiles shaders.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight } from '../world/Layout.js';
import { FLARE_RELEASE } from './ViewModel.js';

const F = Config.flares;

export class Flares {
  constructor({ scene, camera, windows, weapon, arsenal, audio, events, player }) {
    this.camera = camera; this.windows = windows; this.weapon = weapon; this.arsenal = arsenal;
    this.audio = audio; this.events = events; this.player = player;
    this.throwT = -1; this.target = null;
    const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5a3a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const stickGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8).rotateZ(Math.PI / 2);
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x8a1d15, roughness: 0.7, emissive: 0x401008 });
    this.burning = windows.windows.map((w) => {
      const pos = w.outside.clone().addScaledVector(w.normal, 1.0);
      pos.y = terrainHeight(pos.x, pos.z) + 0.04;
      const group = new THREE.Group();
      group.position.copy(pos);
      group.rotation.y = Math.random() * Math.PI;
      group.add(new THREE.Mesh(stickGeo, stickMat));
      const sprite = new THREE.Sprite(glow.clone());
      sprite.position.set(0.12, 0.08, 0); sprite.scale.setScalar(0.9);
      group.add(sprite);
      group.visible = false;
      const light = new THREE.PointLight(0xff3b22, 0, 9, 2);   // no shadows: kept short so it barely shows inside
      light.position.copy(pos).setY(pos.y + 0.35);
      scene.add(group, light);
      return { win: w, group, sprite, light, t: 0 };
    });
  }

  reset() {
    this.throwT = -1; this.target = null; this.weapon.throwT = -1;
    for (const b of this.burning) this.douse(b, false);
  }

  /** The window you are looking at, within throwing range, or null. */
  aimedWindow() {
    const eye = this.camera.getWorldPosition(_e), fwd = this.camera.getWorldDirection(_f);
    let best = null, bestDot = 0.8;
    for (const w of this.windows.windows) {
      const to = _t.subVectors(w.center, eye);
      const d = to.length();
      if (d > F.range) continue;
      const dot = to.normalize().dot(fwd);
      if (dot > bestDot && fwd.dot(w.normal) > 0.2) { bestDot = dot; best = w; }
    }
    return best;
  }

  /** Left click with the flare in hand. Returns a reason it could not be thrown, or null. */
  tryThrow() {
    if (this.throwT >= 0 || this.weapon.busy || this.weapon.reloading || this.player.dead || !this.weapon.ready('flare')) return 'busy';
    if (this.arsenal.flares <= 0) return 'none';
    const w = this.aimedWindow();
    if (!w) return 'aim';
    const b = this.burning.find((x) => x.win === w);
    if (b.t > 0) return 'lit';
    this.arsenal.flares--;
    this.throwT = 0; this.target = b;
    this.audio.play('woodScrape', { volume: 0.5, rate: 2.2 });   // the striker
    this.audio.play('axeSwing', { volume: 0.5, rate: 1.3, delay: 0.2 });
    return null;
  }

  update(dt) {
    if (this.throwT >= 0) {
      const before = this.throwT;
      this.throwT += dt / F.throwTime;
      if (before < FLARE_RELEASE && this.throwT >= FLARE_RELEASE && this.target) this.light(this.target);
      if (this.throwT >= 1) { this.throwT = -1; this.target = null; }
    }
    this.weapon.throwT = this.throwT;
    this.weapon.busy = this.weapon.busy || this.throwT >= 0;
    const now = performance.now() / 1000;
    for (const b of this.burning) {
      if (b.t <= 0) continue;
      b.t -= dt;
      // a hot, restless flicker; it sputters in the last few seconds
      const end = Math.min(1, b.t / 3);
      const flick = 0.75 + 0.15 * Math.sin(now * 23 + b.win.center.x) + 0.1 * Math.sin(now * 41.7) + (Math.random() - 0.5) * 0.15;
      const sputter = end < 1 && Math.random() < (1 - end) * 0.3 ? 0.25 : 1;
      b.light.intensity = 26 * flick * sputter * (0.3 + 0.7 * end);
      b.sprite.material.opacity = Math.min(1, 0.9 * flick * sputter);
      b.sprite.scale.setScalar(0.75 + 0.25 * flick);
      if (b.t <= 0) this.douse(b, true);
    }
  }

  light(b) {
    b.t = F.burn;
    b.group.visible = true;
    this.audio.play('glassTap', { position: b.win.center, volume: 0.5, rate: 0.7 });
    b.hiss?.stop(0.1);
    b.hiss = this.audio.loop('rain', { position: b.group.position, volume: 0.4, rate: 1.7, exterior: true });   // the hiss
    this.events.emit('flareLit', { window: b.win.id });
  }

  douse(b, emit) {
    const was = b.t > 0 || b.group.visible;
    b.t = 0; b.group.visible = false; b.light.intensity = 0;
    b.hiss?.stop(1.2); b.hiss = null;
    if (emit && was) this.events.emit('flareOut', { window: b.win.id });
  }

  /** Seconds left on the flare at a window (0 = none). */
  burningAt(id) { return this.burning.find((b) => b.win.id === id)?.t || 0; }
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,220,1)'); grd.addColorStop(0.2, 'rgba(255,120,80,0.8)'); grd.addColorStop(0.6, 'rgba(200,30,10,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
