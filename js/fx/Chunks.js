// A killed spider bursts into gooey red chunks: wet lumps of flesh, bits of shell and pieces of its own legs,
// taken from where its legs were at the moment it died. Chunks fly, fall, bounce, slide down walls and settle,
// then fade out (Config.gore.chunkHold + chunkFade). Splats are left where they land.
//
// Two instanced meshes (lumps and leg pieces), so a burst costs no extra draw calls. Each instance has its own
// colour and its own fade (a per-instance attribute patched into the standard material).
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { CABIN, terrainHeight } from '../world/Layout.js';
import { BONE } from '../spiders/SpiderRig.js';

const G = Config.gore;
const GOO = new THREE.Color(0x6e0a08);       // wet dark red
const GOO_LIGHT = new THREE.Color(0x9a1c12);
const UP = new THREE.Vector3(0, 1, 0);

/** Lumpy, slightly flattened blob: a chunk of flesh. */
function lumpGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.28 * Math.sin(x * 5.1 + z * 2.3) * Math.cos(y * 4.3 - x) + 0.12 * Math.sin(z * 9 + y * 7);
    p.setXYZ(i, x * k, y * k * 0.72, z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A leg segment: tapered tube with a knobbed joint at one end, length 1 along +Y from the origin. */
function legPieceGeometry() {
  const pts = [];
  const prof = [[0, 0], [0.9, 0.0], [1.25, 0.06], [1.1, 0.14], [0.95, 0.3], [0.85, 0.7], [0.8, 0.96], [0.6, 1], [0, 1]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 7);
}

function fadeMaterial(opts) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ transparent: true, depthWrite: true }, opts));
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vFade;');
  };
  return m;
}

export class Chunks {
  constructor({ scene, gore, quality }) {
    this.gore = gore;
    const low = quality?.tier === 'low';
    this.max = low ? G.chunksLow : G.chunks;
    this.scaleCount = low ? 0.55 : 1;
    this.items = [];
    const mk = (geo, mat, name) => {
      const m = new THREE.InstancedMesh(geo, mat, this.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, GOO);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFade', fade);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.name = name;
      scene.add(m);
      return { mesh: m, fade, list: [] };
    };
    // the lumps are wet and glossy; the leg pieces are shell (their colour comes from the spider)
    this.lumps = mk(lumpGeometry(), fadeMaterial({ roughness: 0.22, metalness: 0, color: 0xffffff }), 'gore-lumps');
    this.legs = mk(legPieceGeometry(), fadeMaterial({ roughness: 0.55, metalness: 0, color: 0xffffff }), 'gore-legs');
  }

  clear() { this.lumps.list.length = 0; this.legs.list.length = 0; this.lumps.mesh.count = 0; this.legs.mesh.count = 0; }

  _take(pool) {
    if (pool.list.length >= this.max) pool.list.shift(); // the oldest goes first
    const c = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1),
      color: new THREE.Color(), age: 0, settled: false, splatted: false, r: 0.05, wall: null };
    pool.list.push(c);
    return c;
  }

  /**
   * Burst a dead spider. visual: its SpiderModel visual (bones, legRadius, skinColor, radius).
   * center: world position of the body. dir: the killing blow's direction (chunks carry on along it). size: ~1 runner .. 3 brute.
   */
  burst(visual, center, dir, size = 1) {
    const sc = Math.max(0.6, size);
    const outward = dir ? _d.copy(dir).normalize() : _d.set(0, 0, 0);
    const skin = visual.skinColor || GOO;
    // flesh lumps and shell bits from the body
    const n = Math.round((10 + 8 * sc) * this.scaleCount);
    const R = visual.radius || 0.1;
    for (let i = 0; i < n; i++) {
      const c = this._take(this.lumps);
      rand3(c.p).multiplyScalar(R * 0.7).add(center);
      const sp = 1.5 + Math.random() * 2.5;
      rand3(c.v).multiplyScalar(sp).addScaledVector(outward, 1.2 + Math.random() * 1.5);
      c.v.y += 1.2 + Math.random() * 2.2;
      c.r = R * (0.14 + Math.random() * 0.22);
      c.s.set(c.r, c.r * (0.7 + Math.random() * 0.6), c.r * (0.8 + Math.random() * 0.5));
      rand3(c.w).multiplyScalar(14);
      c.q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const shell = Math.random() < 0.3;
      if (shell) c.color.copy(skin); else c.color.copy(GOO).lerp(GOO_LIGHT, Math.random() * 0.6);
    }
    // pieces of its legs, from the bones as they were
    const bones = visual.bones;
    if (bones) {
      const legR = visual.legRadius || 0.01;
      for (let leg = 0; leg < 8; leg++) {
        // each leg breaks into its two long pieces (femur and tibia+metatarsus), on low only the femur
        const pieces = this.scaleCount < 1 ? [[1, 2]] : [[1, 2], [3, 5]];
        for (const [a, b] of pieces) {
          const A = bones[BONE.LEG + leg * 6 + a], B = bones[BONE.LEG + leg * 6 + b];
          if (!A || !B) continue;
          A.getWorldPosition(_a); B.getWorldPosition(_b);
          const len = _a.distanceTo(_b);
          if (len < 1e-4) continue;
          const c = this._take(this.legs);
          c.p.copy(_a);
          c.q.setFromUnitVectors(UP, _c.subVectors(_b, _a).normalize());
          c.s.set(legR * (a === 1 ? 1.15 : 0.9), len, legR * (a === 1 ? 1.15 : 0.9));
          c.r = legR * 1.2;
          // thrown away from the body
          _c.subVectors(_a, center).setY(0).normalize();
          c.v.copy(_c).multiplyScalar(1.5 + Math.random() * 2.5).addScaledVector(outward, 0.8);
          c.v.y += 1.5 + Math.random() * 2;
          rand3(c.w).multiplyScalar(10);
          c.color.copy(skin);
        }
      }
    }
  }

  update(dt) {
    const life = G.chunkHold + G.chunkFade;
    for (const pool of [this.lumps, this.legs]) {
      const L = pool.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const c = L[i];
        c.age += dt;
        if (c.age >= life) { L.splice(i, 1); continue; }
        if (!c.settled) this.step(c, dt);
      }
      const m = pool.mesh;
      m.count = L.length;
      for (let i = 0; i < L.length; i++) {
        const c = L[i];
        // fading: goes see-through, sags and sinks a little (melting into the floor)
        const f = Math.min(1, Math.max(0, 1 - (c.age - G.chunkHold) / G.chunkFade));
        _s.copy(c.s);
        if (pool === this.lumps) _s.y *= 0.55 + 0.45 * f;
        _m.compose(c.p, c.q, _s);
        m.setMatrixAt(i, _m);
        m.setColorAt(i, c.color);
        pool.fade.array[i] = f;
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      pool.fade.needsUpdate = true;
    }
  }

  step(c, dt) {
    if (c.wall) {
      // stuck on a wall: slides slowly down it
      c.v.set(0, -0.25, 0);
    } else c.v.y -= 9.8 * dt;
    c.p.addScaledVector(c.v, dt);
    // spin
    const wl = c.w.length();
    if (wl > 1e-3) { _q.setFromAxisAngle(_a.copy(c.w).divideScalar(wl), wl * dt); c.q.premultiply(_q); }
    const p = c.p;
    const inside = Math.abs(p.x) < CABIN.halfX && Math.abs(p.z) < CABIN.halfZ;
    // walls: inside they are the room's walls; outside a chunk bounces off the cabin's outer walls
    if (inside && p.y > 0.05) {
      const hx = CABIN.halfX - c.r, hz = CABIN.halfZ - c.r;
      let n = null;
      if (p.x > hx) { p.x = hx; n = _n.set(-1, 0, 0); } else if (p.x < -hx) { p.x = -hx; n = _n.set(1, 0, 0); }
      if (p.z > hz) { p.z = hz; n = _n.set(0, 0, -1); } else if (p.z < -hz) { p.z = -hz; n = _n.set(0, 0, 1); }
      if (p.y > CABIN.wallHeight - c.r) { p.y = CABIN.wallHeight - c.r; c.v.y = -Math.abs(c.v.y) * 0.3; }
      if (n) this.hitWall(c, n);
    }
    const ground = inside ? 0 : terrainHeight(p.x, p.z);
    const rest = ground + c.r * 0.45;
    if (p.y <= rest) {
      p.y = rest;
      if (c.wall) c.wall = null;
      if (!c.splatted) { c.splatted = true; if (Math.random() < 0.5) this.gore.splat(_a.set(p.x, ground, p.z), UP, 0.08 + c.r * 2.5); }
      if (c.v.y < -1.2) {
        // bounce, losing most of it (they are soft)
        c.v.y = -c.v.y * 0.22; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5);
      } else {
        c.v.set(0, 0, 0); c.w.set(0, 0, 0); c.settled = true;
      }
    }
  }

  hitWall(c, n) {
    if (Math.random() < 0.55) {
      // splat and stick, then slide down
      c.wall = n.clone();
      c.w.set(0, 0, 0);
      if (!c.splatted) { c.splatted = true; this.gore.splat(_a.copy(c.p).addScaledVector(n, -c.r * 0.6), n, 0.1 + c.r * 2.5); }
    } else {
      const vn = c.v.dot(n);
      if (vn < 0) c.v.addScaledVector(n, -vn * 1.3);
      c.v.multiplyScalar(0.5);
    }
  }
}

function rand3(v) {
  // random point in the unit sphere
  do { v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (v.lengthSq() > 1);
  return v;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
