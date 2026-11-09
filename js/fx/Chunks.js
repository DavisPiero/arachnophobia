// A killed spider bursts into gooey red chunks: torn wet meat, pale stringy gristle and broken bits of shell. Chunks fly, fall, bounce, slide down walls and settle,
// then fade out (Config.gore.chunkHold + chunkFade). Splats are left where they land.
//
// Three instanced meshes (meat, gristle, shell), so a burst costs no extra draw calls. Each instance has its own
// colour and its own fade (a per-instance attribute patched into the standard material).
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { CABIN, terrainHeight } from '../world/Layout.js';

const G = Config.gore;
const GOO = new THREE.Color(0x6e0a08);       // wet dark red
const GOO_LIGHT = new THREE.Color(0x9a1c12);
const GRISTLE = new THREE.Color(0xc89a8a);   // pale pink-grey connective tissue
const UP = new THREE.Vector3(0, 1, 0);

// cheap 3D value noise for shaping the lumps (once, at load)
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
function fbm(x, y, z, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }

/**
 * A torn piece of flesh: a high-res sphere pushed out by layered noise (big lobes, small wet bumps, torn ridges),
 * flattened, with vertex colours for marbling (pale fat streaks, dark clotted pits). kind 0 meat, 1 gristle, 2 shell.
 */
function lumpGeometry(kind, seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const o = seed * 17.3;
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k;
    if (kind === 2) {
      // shell: a curved, broken plate, thin with sharp edges
      const e = fbm(x * 2 + o, y * 2, z * 2 + o, 3);
      k = 1 + 0.25 * e;
      p.setXYZ(i, x * k, (y * 0.22 + 0.25 * (x * x + z * z)) * k, z * k * (0.8 + 0.2 * Math.sign(x + e)));
      const sh = 0.75 + 0.25 * fbm(x * 9 + o, y * 9, z * 9, 2);
      col[i * 3] = sh; col[i * 3 + 1] = sh; col[i * 3 + 2] = sh;
      continue;
    }
    const big = fbm(x * 1.3 + o, y * 1.3 - o, z * 1.3, 2);
    const small = fbm(x * 6 + o, y * 6, z * 6 - o, 3);
    const ridge = 1 - Math.abs(fbm(x * 3.1 - o, y * 3.1, z * 3.1 + o, 2)) * 2;   // torn, stringy ridges
    k = 1 + 0.38 * big + 0.09 * small + (kind === 1 ? 0.12 : 0.05) * ridge * ridge;
    const sy = kind === 1 ? 0.55 : 0.72;
    const sx = kind === 1 ? 1.35 : 1;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k);
    // marbling: fat streaks run through the meat, clots sit in the hollows
    const streak = Math.max(0, Math.sin((x * 3.7 + y * 1.3 + fbm(x * 2 + o, y * 2, z * 2, 2) * 2.5) * 3.1));
    const fat = Math.pow(streak, 6) * (kind === 1 ? 0.9 : 0.55);
    const pit = Math.max(0, -small) * 1.2 + Math.max(0, -big) * 0.4;
    const base = 1 - 0.55 * pit;
    col[i * 3] = Math.min(1.6, base + fat * 1.6);
    col[i * 3 + 1] = Math.min(1.6, base * 0.9 + fat * 2.2);
    col[i * 3 + 2] = Math.min(1.6, base * 0.9 + fat * 1.8);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function fadeMaterial(opts, physical) {
  const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new M(Object.assign({ transparent: true, depthWrite: true, vertexColors: true }, opts));
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
    // wet meat, stringy gristle and broken bits of shell: three instanced meshes, three draw calls for any number of bursts
    const det = low ? 2 : 4;
    const wet = { roughness: 0.18, metalness: 0, color: 0xffffff };
    const wetHi = Object.assign({ clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color(0x802020) }, wet);
    this.meat = mk(lumpGeometry(0, 1, det), fadeMaterial(low ? wet : wetHi, !low), 'gore-meat');
    this.gristle = mk(lumpGeometry(1, 2, det), fadeMaterial(low ? wet : wetHi, !low), 'gore-gristle');
    this.shell = mk(lumpGeometry(2, 3, low ? 1 : 3), fadeMaterial({ roughness: 0.4, metalness: 0, color: 0xffffff }), 'gore-shell');
    this.pools = [this.meat, this.gristle, this.shell];
  }

  clear() { for (const pl of this.pools) { pl.list.length = 0; pl.mesh.count = 0; } }

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
    // torn flesh, gristle and bits of shell from the body (no legs: the user wants only chunks)
    const n = Math.round((12 + 9 * sc) * this.scaleCount);
    const R = visual.radius || 0.1;
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const pool = roll < 0.6 ? this.meat : roll < 0.82 ? this.gristle : this.shell;
      const c = this._take(pool);
      rand3(c.p).multiplyScalar(R * 0.7).add(center);
      const sp = 1.5 + Math.random() * 2.5;
      rand3(c.v).multiplyScalar(sp).addScaledVector(outward, 1.2 + Math.random() * 1.5);
      c.v.y += 1.2 + Math.random() * 2.2;
      // a few big pieces, many small ones
      c.r = R * (0.08 + Math.pow(Math.random(), 2.2) * 0.34);
      c.s.set(c.r, c.r * (0.7 + Math.random() * 0.6), c.r * (0.8 + Math.random() * 0.5));
      rand3(c.w).multiplyScalar(14);
      c.q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      if (pool === this.shell) c.color.copy(skin).multiplyScalar(0.8 + Math.random() * 0.4);
      else if (pool === this.gristle) c.color.copy(GOO_LIGHT).lerp(GRISTLE, 0.3 + Math.random() * 0.5);
      else c.color.copy(GOO).lerp(GOO_LIGHT, Math.random() * 0.7);
    }
  }

  update(dt) {
    const life = G.chunkHold + G.chunkFade;
    for (const pool of this.pools) {
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
        if (pool !== this.shell) _s.y *= 0.55 + 0.45 * f;
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
