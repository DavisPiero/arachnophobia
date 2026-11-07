// Ichor: the spray when a spider is hit, and the splats it leaves on the ground, walls, floor and window glass.
// Spray droplets are one instanced mesh (one draw call). Splats are a fixed pool of decals that fade after a few seconds
// (Config.gore.splatHold + splatFade), so they never block a window for long. Dark red (user's call).
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { CABIN, terrainHeight } from '../world/Layout.js';

const G = Config.gore;
const DROP_COLOR = 0x7a0d0a;
const SPLAT_COLOR = 0x640a08;

export class Gore {
  constructor({ scene, events, windows }) {
    this.scene = scene;
    this.windows = windows;
    // --- droplets
    const n = G.droplets;
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 4), new THREE.MeshBasicMaterial({ color: DROP_COLOR }), n);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.drops.name = 'gore-drops';
    this.d = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0, life: 0 }));
    this.live = 0;
    scene.add(this.drops);
    // --- splats
    const mat = new THREE.MeshBasicMaterial({
      color: SPLAT_COLOR, map: makeSplatTexture(), transparent: true, opacity: 0.92, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.splats = [];
    this.splatIdx = 0;
    this.splatGroup = new THREE.Group();
    this.splatGroup.name = 'gore-splats';
    for (let i = 0; i < G.splats; i++) {
      const m = new THREE.Mesh(geo, mat.clone());   // own material: each splat fades on its own
      m.visible = false;
      m.renderOrder = 2;
      this.splatGroup.add(m);
      this.splats.push({ mesh: m, window: null, age: 0 });
    }
    scene.add(this.splatGroup);
    events.on('waveStart', () => this.clear());
  }

  clear() {
    for (const s of this.splats) { s.mesh.visible = false; s.window = null; }
    this.live = 0; this.drops.count = 0;
  }

  /** Spray from a hit. dir: the bullet's direction (most ichor carries on through), amount ~0.3 (leg) .. 1 (body) .. 2 (kill). */
  spray(point, dir, amount = 1) {
    const count = Math.round(6 + amount * 14);
    for (let i = 0; i < count; i++) {
      if (this.live >= this.d.length) break;
      const d = this.d[this.live++];
      d.p.copy(point);
      const through = Math.random() < 0.7;
      const sp = 1.2 + Math.random() * (2 + amount * 1.5);
      d.v.copy(dir).multiplyScalar(through ? sp : -sp * 0.5);
      d.v.x += (Math.random() - 0.5) * 2.4; d.v.y += Math.random() * 2.2 + 0.4; d.v.z += (Math.random() - 0.5) * 2.4;
      d.s = 0.005 + Math.random() * 0.012 * (0.6 + amount * 0.3);
      d.life = 1.6;
    }
  }

  /** A splat decal on a surface. normal: the surface's outward normal. glassOf: the window whose glass it is on. */
  splat(position, normal, size = 0.4, glassOf = null) {
    const s = this.splats[this.splatIdx++ % this.splats.length];
    const m = s.mesh;
    m.position.copy(position).addScaledVector(normal, 0.006);
    m.lookAt(_t.copy(m.position).add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    const k = size * (0.8 + Math.random() * 0.4);
    m.scale.set(k, k * (0.75 + Math.random() * 0.5), 1);
    m.visible = true;
    m.material.opacity = 0.92;
    s.window = glassOf;
    s.age = 0;
  }

  /** Splat on a window's glass, seen from inside the room. Skipped if the glass is already gone. */
  splatGlass(window, point, size = 0.35) {
    if (!window || window.stage >= 2 || !window.glass) return;
    window.glass.getWorldPosition(_g);
    const n = window.normal;                     // points out of the cabin
    // project the point onto the glass, then a hair towards the room
    const depth = _q.copy(point).sub(_g).dot(n);
    const p = _p.copy(point).addScaledVector(n, -depth - 0.004);
    this.splat(p, _q.copy(n).negate(), size, window);
  }

  update(dt) {
    // droplets fly, fall and land
    const D = this.d;
    let i = 0;
    while (i < this.live) {
      const d = D[i];
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      const inside = Math.abs(d.p.x) < CABIN.halfX && Math.abs(d.p.z) < CABIN.halfZ;
      const ground = inside ? 0 : terrainHeight(d.p.x, d.p.z);
      if (d.p.y <= ground || d.life <= 0) {
        if (d.p.y <= ground && Math.random() < 0.12) this.splat(_t.set(d.p.x, ground, d.p.z), UP, 0.06 + Math.random() * 0.08);
        // swap-remove
        const last = D[--this.live];
        D[i] = last; D[this.live] = d;
        continue;
      }
      _m.makeScale(d.s, d.s, d.s).setPosition(d.p);
      this.drops.setMatrixAt(i, _m);
      i++;
    }
    this.drops.count = this.live;
    this.drops.instanceMatrix.needsUpdate = true;
    // splats fade after a few seconds; splats on glass go at once when the glass breaks
    for (const s of this.splats) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const f = 1 - (s.age - G.splatHold) / G.splatFade;
      if (f <= 0 || (s.window && s.window.stage >= 2)) { s.mesh.visible = false; s.window = null; continue; }
      s.mesh.material.opacity = 0.92 * Math.min(1, f);
    }
  }
}

function makeSplatTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  // a dense middle, lumpy edges, flung droplets and a few streaks
  g.globalAlpha = 0.95; blob(64, 64, 26);
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = 14 + Math.random() * 16; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 6 + Math.random() * 10); }
  g.globalAlpha = 0.8;
  for (let i = 0; i < 22; i++) { const a = Math.random() * 6.28, r = 34 + Math.random() * 26; blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5 + Math.random() * 3.5); }
  g.globalAlpha = 0.7; g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * 6.28; g.lineWidth = 2 + Math.random() * 3;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20); g.lineTo(64 + Math.cos(a) * (40 + Math.random() * 20), 64 + Math.sin(a) * (40 + Math.random() * 20)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);
const _t = new THREE.Vector3(), _g = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _m = new THREE.Matrix4();
