// Spider models, built entirely in code.
//
// Each spider is ONE skinned mesh (body, abdomen, mouth parts, 8 legs and hair all merged, every vertex
// rigidly bound to one bone) plus one eye mesh and one glow-point cloud. That keeps a spider at
// ~3 draw calls (+1 shadow) regardless of leg count. Geometry and the template material are built once
// per type and detail level and shared by every instance; each instance gets a cheap material clone so
// it can have its own tint and fade without new shaders.
//
// Space convention: `root` origin is on the surface under the body centre, +Y = surface normal,
// +Z = forward. Inside root sits `space` (scaled per instance); all rig maths happen in `space`.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SpiderRig, BONE, BONE_COUNT } from './SpiderRig.js';
import { getChitinTextures, getGlowTexture } from './SpiderTextures.js';
import { Config } from '../core/Config.js';
import { loadModel, assetsEnabled } from '../core/Assets.js';

// SPECIES (how it behaves, Config.spiders) and MODELS (what it looks like, assets/models/spider_<model>.glb) are separate:
// a species names its model in Config.spiders.<species>.model, so a model can be reused or swapped.
export const SPIDER_TYPES = ['runner', 'brute', 'climber', 'stalker', 'weeper'];
export const MODELS = ['knot', 'sac', 'flayed', 'grinner', 'weeper'];
const modelOf = (type) => Config.spiders[type]?.model || type;

// Three sizes of every model. One mesh per model; a size changes the scale and how heavy the body moves (mass),
// and the AI scales health, speed and damage (Config.sizes).
export const SIZES = { small: { scale: 0.62, mass: 0.55 }, medium: { scale: 1, mass: 1 }, large: { scale: 1.45, mass: 1.9 } };

const D2R = Math.PI / 180;
const SEG = ['coxa', 'femur', 'patella', 'tibia', 'metatarsus', 'tarsus'];

// ---------------------------------------------------------------- type definitions (metres)
const DEFS = {
  runner: {
    restR: 0.5, bodyH: 0.09, legFactor: 1.42, legR: 0.0085,
    pairAngles: [30, 66, 108, 146], pairLen: [1.0, 0.9, 0.82, 1.0], pairRest: [0.98, 0.9, 0.84, 1.0],
    segFrac: [0.05, 0.29, 0.08, 0.24, 0.23, 0.11], alpha: 1.05, coxaElev: 0.35,
    ceph: { rx: 0.045, ry: 0.03, rz: 0.055, head: 0.9 },
    abd: { len: 0.12, r: 0.042, sx: 0.95, sy: 0.85, ribs: 0, ribDepth: 0, tilt: 0.12, y: 0.004 },
    chel: { len: 0.026, r: 0.011 }, palp: { len: 0.05, r: 0.0045 },
    leg: { knob: 0.22, ribs: 0, ribDepth: 0, keel: 0.2, edge: 0.06, spurs: 0, hook: 0.25 },
    color: [0.06, 0.038, 0.024], joint: [1.9, 1.4, 1.1], hair: { count: 520, len: 0.012, w: 0.0011 },
    mat: { roughness: 1.15, clearcoat: 0.35, clearcoatRoughness: 0.32, sheen: 0, normalScale: 0.9 },
    eyeR: 0.004, eyeExtra: 0, glow: 0.035,
    strideK: 0.055, stepMin: 0.045, stepMax: 0.16, arc: 0.16, lowPoly: true,
  },
  brute: {
    restR: 1.55, bodyH: 0.52, legFactor: 1.5, legR: 0.062,
    pairAngles: [34, 70, 110, 148], pairLen: [1.0, 0.92, 0.84, 0.98], pairRest: [0.95, 0.92, 0.86, 0.98],
    segFrac: [0.06, 0.3, 0.09, 0.24, 0.21, 0.1], alpha: 1.25, coxaElev: 0.3,
    ceph: { rx: 0.27, ry: 0.19, rz: 0.31, head: 1.0 },
    abd: { len: 0.82, r: 0.38, sx: 1.05, sy: 0.92, ribs: 6, ribDepth: 0.035, tilt: 0.2, y: 0.03 },
    chel: { len: 0.2, r: 0.085 }, palp: { len: 0.34, r: 0.04 },
    leg: { knob: 0.28, ribs: 0, ribDepth: 0, keel: 0.12, spurs: 0, hook: 0.2 },
    color: [0.042, 0.036, 0.031], joint: [1.7, 1.45, 1.25], hair: { count: 4200, len: 0.11, w: 0.0036 },
    mat: { roughness: 1.3, clearcoat: 0.12, clearcoatRoughness: 0.5, sheen: 0.8, sheenColor: [0.22, 0.2, 0.19], sheenRoughness: 0.55, normalScale: 1.0 },
    eyeR: 0.014, eyeExtra: 0, glow: 0.12,
    strideK: 0.07, stepMin: 0.22, stepMax: 0.5, arc: 0.12,
  },
  climber: {
    restR: 0.93, bodyH: 0.3, legFactor: 1.78, legR: 0.021,
    pairAngles: [28, 64, 110, 152], pairLen: [1.0, 0.86, 0.78, 0.94], pairRest: [1.0, 0.88, 0.8, 0.96],
    segFrac: [0.045, 0.3, 0.06, 0.24, 0.24, 0.115], alpha: 1.2, coxaElev: 0.45,
    ceph: { rx: 0.115, ry: 0.085, rz: 0.15, head: 1.25 },
    abd: { len: 0.38, r: 0.115, sx: 0.88, sy: 0.95, ribs: 10, ribDepth: 0.09, tilt: 0.3, y: 0.015 },
    chel: { len: 0.08, r: 0.028 }, palp: { len: 0.16, r: 0.012 },
    leg: { knob: 0.42, ribs: 20, ribDepth: 0.2, keel: 0.4, edge: 0.12, spurs: 2, hook: 0.55 },
    color: [0.1, 0.092, 0.082], joint: [1.6, 1.5, 1.4], hair: { count: 260, len: 0.018, w: 0.0016 },
    mat: { roughness: 0.95, clearcoat: 0.55, clearcoatRoughness: 0.28, sheen: 0, normalScale: 1.25 },
    eyeR: 0.007, eyeExtra: 10, glow: 0.06,
    strideK: 0.06, stepMin: 0.1, stepMax: 0.32, arc: 0.18,
  },
  stalker: {
    restR: 1.11, bodyH: 0.17, legFactor: 1.5, legR: 0.026,
    pairAngles: [34, 72, 112, 150], pairLen: [1.0, 0.9, 0.82, 0.96], pairRest: [1.0, 0.95, 0.88, 0.98],
    segFrac: [0.05, 0.3, 0.07, 0.24, 0.23, 0.11], alpha: 1.05, coxaElev: 0.25,
    ceph: { rx: 0.13, ry: 0.075, rz: 0.15, head: 1.1 },
    abd: { len: 0.36, r: 0.16, sx: 1.18, sy: 0.7, ribs: 5, ribDepth: 0.04, tilt: 0.05, y: 0.0 },
    chel: { len: 0.085, r: 0.035 }, palp: { len: 0.15, r: 0.013 },
    leg: { knob: 0.3, ribs: 0, ribDepth: 0, keel: 0.25, edge: 0.07, spurs: 1, hook: 0.35 },
    color: [0.022, 0.02, 0.022], joint: [1.25, 1.15, 1.1], hair: { count: 1100, len: 0.03, w: 0.0026 },
    mat: { roughness: 1.6, clearcoat: 0.0, clearcoatRoughness: 0.6, sheen: 0.45, sheenColor: [0.1, 0.1, 0.11], sheenRoughness: 0.7, normalScale: 0.8 },
    eyeR: 0.011, eyeExtra: 6, glow: 0.11,
    strideK: 0.06, stepMin: 0.14, stepMax: 0.4, arc: 0.12,
  },
};

// ---------------------------------------------------------------- small helpers
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// cheap smooth pseudo-noise on 3D positions (only used at build time)
const bumpy = (x, y, z) => Math.sin(x * 7.1 + y * 3.3) * Math.sin(z * 6.7 + x * 2.1) * Math.sin(y * 5.3 + z * 4.4)
  + 0.5 * Math.sin(x * 15.3 - z * 9.1) * Math.sin(y * 13.7 + x * 5.9);

/**
 * Grid surface: nRings x sides. point(t, theta, out) writes a position; colorFn(t, theta) -> scalar shade.
 * Orientation is fixed automatically (signed volume), seams and poles get welded normals.
 */
function gridGeo(nRings, sides, point, shade, uvScale = [1, 1]) {
  const pos = [], uv = [], col = [], idx = [];
  const p = [0, 0, 0];
  for (let i = 0; i < nRings; i++) {
    const t = i / (nRings - 1);
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      point(t, th, p, i);
      pos.push(p[0], p[1], p[2]);
      uv.push((j / sides) * uvScale[0], t * uvScale[1]);
      const s = shade ? shade(t, th) : 1;
      col.push(s, s, s);
    }
  }
  const W = sides + 1;
  for (let i = 0; i < nRings - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * W + j, b = a + W;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // fix winding by signed volume
  let vol = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld normals: seam columns and collapsed rings
  const n = g.attributes.normal;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  for (let i = 0; i < nRings; i++) {
    const a = i * W, b = i * W + sides;
    tmp.fromBufferAttribute(n, a).add(tmp2.fromBufferAttribute(n, b)).normalize();
    n.setXYZ(a, tmp.x, tmp.y, tmp.z); n.setXYZ(b, tmp.x, tmp.y, tmp.z);
    // collapsed ring?
    const x0 = pos[a * 3], y0 = pos[a * 3 + 1], z0 = pos[a * 3 + 2];
    const mid = a + (sides >> 1);
    const d = Math.hypot(pos[mid * 3] - x0, pos[mid * 3 + 1] - y0, pos[mid * 3 + 2] - z0);
    if (d < 1e-6) {
      tmp.set(0, 0, 0);
      for (let j = 0; j <= sides; j++) tmp.add(tmp2.fromBufferAttribute(n, a + j));
      // pole normal = direction away from the neighbouring ring centre
      const nb = i === 0 ? W : (i - 1) * W;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < sides; j++) { cx += pos[(nb + j) * 3]; cy += pos[(nb + j) * 3 + 1]; cz += pos[(nb + j) * 3 + 2]; }
      tmp.set(x0 - cx / sides, y0 - cy / sides, z0 - cz / sides);
      if (tmp.lengthSq() < 1e-14) tmp.set(1, 0, 0);
      tmp.normalize();
      for (let j = 0; j <= sides; j++) n.setXYZ(a + j, tmp.x, tmp.y, tmp.z);
    }
  }
  return g;
}

function tintGeo(g, rgb) {
  const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * rgb[0], c.getY(i) * rgb[1], c.getZ(i) * rgb[2]);
  return g;
}

function skinGeo(g, bone) {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

// keep only the attributes every part shares, make sure it is indexed
function clean(g) {
  if (!g.index) {
    const n = g.attributes.position.count, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    g.setIndex(idx);
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

// ---------------------------------------------------------------- parts
/** Leg (or palp) segment along +X from 0 to L in bone space. Y = dorsal side. */
function segmentGeo(o, detail) {
  const { L, r0, r1, sides, tip = false, knob = 0, ribs = 0, ribDepth = 0, keel = 0, hook = 0, uvR, edge = 0 } = o;
  const segs = Math.max(3, Math.round((detail ? 6 : 3) + (detail ? ribs * 2.6 : 0)));
  // ring stations: start cap, body rings, end cap
  const st = [];
  st.push({ x: -r0 * 0.75, r: 0.0, t: 0 });
  st.push({ x: -r0 * 0.45, r: r0 * 0.85, t: 0 });
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let r = r0 + (r1 - r0) * t;
    if (tip) r = (r0 + (Math.max(r1, r0 * 0.02) - r0) * Math.pow(t, 0.7)) * (1 - Math.pow(t, 3) * 0.95);
    r *= 1 + knob * Math.exp(-((t / 0.09) ** 2)) + knob * 0.75 * Math.exp(-(((1 - t) / 0.08) ** 2));
    if (!tip) r *= (1 + 0.12 * Math.sin(Math.PI * Math.pow(t, 0.8))) * (1 - 0.14 * Math.exp(-(((t - 0.13) / 0.05) ** 2)));
    if (ribs && detail) r *= 1 + ribDepth * Math.pow(0.5 + 0.5 * Math.cos(t * ribs * Math.PI * 2), 5) * smooth(0.05, 0.15, t) * smooth(0.98, 0.85, t);
    st.push({ x: t * L, r, t });
  }
  if (!tip) {
    st.push({ x: L + r1 * 0.35, r: r1 * 0.75, t: 1 });
    st.push({ x: L + r1 * 0.6, r: 0, t: 1 });
  } else {
    st.push({ x: L * 1.01, r: 0, t: 1 });
  }
  const g = gridGeo(st.length, sides, (u, th, out, i) => {
    const s = st[i];
    const ky = 1 + keel * Math.pow(Math.max(0, Math.cos(th)), 5);
    const ke = 1 + edge * Math.pow(Math.abs(Math.cos(th * 3)), 6); // angular, faceted cross-section
    const yoff = -hook * L * Math.pow(Math.max(0, s.t), 3) * (tip ? 1 : 0.15);
    out[0] = s.x;
    out[1] = yoff + s.r * ke * Math.cos(th) * ky * (Math.cos(th) < 0 ? 0.9 : 1);
    out[2] = s.r * ke * Math.sin(th) * 0.84;
  }, (u, th) => {
    // lighter joint membranes, darker distal, slightly lighter belly
    const i = Math.min(st.length - 1, Math.round(u * (st.length - 1)));
    const t = st[i].t;
    return 1 + 0.9 * Math.exp(-((t / 0.06) ** 2)) * (i > 1 ? 1 : 0.6) + (Math.cos(th) < -0.3 ? 0.12 : 0) - 0.15 * t;
  }, [1, L / (uvR || r0 * 6)]);
  return g;
}

function spurGeo(L, r, detail) {
  const g = new THREE.ConeGeometry(r, L, detail ? 4 : 3, 1);
  g.translate(0, L / 2, 0);
  return clean(g);
}

/** Cephalothorax surface point for a unit direction (body-bone space, +Z forward). */
function makeCephShape(def) {
  const c = def.ceph;
  return (nx, ny, nz, out) => {
    let x = nx * c.rx, y = ny * c.ry, z = nz * c.rz;
    // pear outline from above: narrower head in front
    x *= 1 - 0.22 * smooth(0.1, 1, nz);
    if (ny > 0) {
      // head (ocular area) rises at the front, thorax slopes back
      y *= 0.72 + 0.42 * c.head * smooth(-0.4, 0.75, nz) * (1 - 0.35 * smooth(0.75, 1, nz));
      // radial furrows from the fovea
      const phi = Math.atan2(nx, nz + 0.3);
      const fur = Math.pow(0.5 + 0.5 * Math.cos(phi * 8), 6);
      y -= c.ry * 0.07 * fur * smooth(0.2, 0.7, ny) * smooth(0.05, 0.3, Math.hypot(nx, nz + 0.3));
      // fovea pit and a midline groove
      y -= c.ry * 0.16 * Math.exp(-((nx * nx + (nz + 0.3) ** 2) / 0.015));
      y -= c.ry * 0.05 * Math.exp(-(nx * nx) / 0.004) * smooth(0, 0.6, -nz + 0.2);
    } else {
      y *= 0.55; // flat sternum
    }
    // overhanging carapace rim
    const rim = 1 + 0.06 * Math.exp(-((ny / 0.12) ** 2));
    x *= rim; z *= rim;
    const b = 1 + 0.035 * bumpy(nx * 1.3, ny * 1.3, nz * 1.3);
    out[0] = x * b; out[1] = y * b; out[2] = z * b;
    return out;
  };
}

function cephGeo(def, detail, shape) {
  const rings = detail ? (def.lowPoly ? 16 : 22) : 11, sides = detail ? (def.lowPoly ? 20 : 30) : 14;
  return gridGeo(rings, sides, (t, th, out) => {
    const pol = t * Math.PI;                // 0 = back pole, PI = front pole
    const nz = -Math.cos(pol), rr = Math.sin(pol);
    const nx = rr * Math.sin(th), ny = rr * Math.cos(th);
    shape(nx, ny, nz, out);
  }, (t, th) => {
    const ny = Math.sin(t * Math.PI) * Math.cos(th);
    return ny < -0.2 ? 1.25 : 1 + 0.1 * Math.sin(th * 8);
  }, [4, 3]);
}

function abdomenGeo(def, detail) {
  const a = def.abd;
  const rings = detail ? (def.lowPoly ? 22 : 34) : 13, sides = detail ? (def.lowPoly ? 20 : 30) : 14;
  return gridGeo(rings, sides, (s, th, out) => {
    let r = a.r * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.78)), 0.55);
    r = Math.max(r, a.r * 0.22 * (1 - smooth(0, 0.08, s))) * (s === 0 || s === 1 ? 0 : 1);
    if (a.ribs && detail) r *= 1 - a.ribDepth * Math.pow(0.5 + 0.5 * Math.cos((s * a.ribs + 0.5) * Math.PI * 2), 6) * smooth(0.08, 0.2, s) * smooth(0.95, 0.8, s);
    if (a.ribs && !detail) r *= 1 - a.ribDepth * 0.3;
    const cy = Math.cos(th), sx = Math.sin(th);
    // dorsal paired humps (folium plates) + bumps
    const hump = 0.07 * Math.exp(-(((Math.abs(th - Math.PI) - Math.PI + 0.55) / 0.3) ** 2))
      * (0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.cos(s * (a.ribs || 5) * Math.PI * 2), 2)) * smooth(0.15, 0.4, s) * smooth(0.95, 0.6, s);
    const b = 1 + hump + 0.03 * bumpy(sx * 2, cy * 2, s * 4);
    out[0] = sx * r * a.sx * b;
    out[1] = cy * r * a.sy * b * (cy < 0 ? 0.82 : 1) + a.r * 0.18 * Math.sin(Math.PI * s);
    out[2] = -s * a.len;
  }, (s, th) => {
    const cy = Math.cos(th);
    // dark dorsal chevrons, paler underside
    const chev = Math.pow(0.5 + 0.5 * Math.cos(s * 8 * Math.PI * 2 + Math.abs(Math.sin(th)) * 6), 4);
    return (cy < -0.3 ? 1.3 : 1) * (1 - 0.25 * chev * smooth(0.3, 0.9, cy)) * (1 + 0.15 * smooth(0.6, 1, Math.abs(Math.sin(th))));
  }, [6, 4]);
}

function chelGeo(def, detail, side) {
  const c = def.chel;
  const sides = detail ? 14 : 7, rings = detail ? 14 : 7;
  const g = gridGeo(rings, sides, (t, th, out) => {
    const r = c.r * (0.55 + 0.65 * Math.sin(Math.PI * Math.pow(t, 0.55))) * (1 - 0.4 * t) * (t === 0 || t === 1 ? 0 : 1);
    // bulge toward the front (+Y here becomes +Z after the rotations), flatter at the back
    const cy = Math.cos(th);
    out[0] = t * c.len; out[1] = cy * r * (cy > 0 ? 1.15 : 0.85); out[2] = Math.sin(th) * r * 0.82;
  }, (t) => 0.75 + 0.35 * t, [1, 2]);
  // +X -> -Y (hang down), tilt the bottom forward
  g.rotateZ(-Math.PI / 2);
  g.rotateX(-0.35);
  // fang: hooked spike curving inward
  const f = segmentGeo({ L: c.len * 0.85, r0: c.r * 0.36, r1: 0, sides: detail ? 6 : 4, tip: true, hook: 0.9, uvR: c.r }, detail);
  tintGeo(f, [0.55, 0.32, 0.28]);
  const X = new THREE.Vector3(-side * 0.35, -1, 0.25).normalize();
  const Y = new THREE.Vector3(side, 0, 0); Y.addScaledVector(X, -Y.dot(X)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(0, -c.len * 0.88, c.len * 0.3);
  f.applyMatrix4(m);
  return mergeGeometries([clean(g), clean(f)]);
}

/** Hairs: thin 3-sided spikes scattered over a part, combed toward `comb` (part-local). */
function hairGeo(src, count, len, w, comb, seed, baseRGB) {
  if (count <= 0) return null;
  const r = rng(seed);
  const P = src.attributes.position, I = src.index.array;
  const tris = I.length / 3;
  const areas = new Float32Array(tris); let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(P, I[i * 3]); b.fromBufferAttribute(P, I[i * 3 + 1]); c.fromBufferAttribute(P, I[i * 3 + 2]);
    total += e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() * 0.5;
    areas[i] = total;
  }
  const pos = [], nor = [], col = [], idx = [];
  const p = new THREE.Vector3(), d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), tip = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const x = r() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < x) lo = mid + 1; else hi = mid; }
    a.fromBufferAttribute(P, I[lo * 3]); b.fromBufferAttribute(P, I[lo * 3 + 1]); c.fromBufferAttribute(P, I[lo * 3 + 2]);
    let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    p.copy(a).addScaledVector(e1.subVectors(b, a), u).addScaledVector(e2.subVectors(c, a), v);
    n.crossVectors(e1, e2).normalize();
    if (!isFinite(n.x)) continue;
    d.copy(n).addScaledVector(comb, 0.9 + r() * 0.6);
    d.x += (r() - 0.5) * 0.5; d.y += (r() - 0.5) * 0.5; d.z += (r() - 0.5) * 0.5;
    d.normalize();
    const L = len * (0.45 + r() * 0.9);
    tip.copy(p).addScaledVector(d, L);
    t1.set(0, 1, 0); if (Math.abs(d.y) > 0.9) t1.set(1, 0, 0);
    t1.cross(d).normalize(); t2.crossVectors(d, t1);
    const base = pos.length / 3;
    for (let j = 0; j < 3; j++) {
      const ang = (j / 3) * Math.PI * 2;
      pos.push(p.x + (t1.x * Math.cos(ang) + t2.x * Math.sin(ang)) * w, p.y + (t1.y * Math.cos(ang) + t2.y * Math.sin(ang)) * w, p.z + (t1.z * Math.cos(ang) + t2.z * Math.sin(ang)) * w);
      nor.push(n.x, n.y, n.z);
      col.push(1, 1, 1);
    }
    pos.push(tip.x, tip.y, tip.z);
    const nn = n.clone().addScaledVector(d, 0.6).normalize();
    nor.push(nn.x, nn.y, nn.z);
    const tipShade = 1.1 + r() * 0.6; // frosted tips catch the moonlight
    col.push(tipShade, tipShade * 0.95, tipShade * 0.9);
    idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3, base + 2, base, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  if (baseRGB) tintGeo(g, baseRGB);
  return g;
}

// ---------------------------------------------------------------- layout (shared per type)
function makeLayout(def) {
  const c = def.ceph, a = def.abd;
  const gap = c.rz * 0.15;
  const bodyZ0 = (a.len + gap) * 0.5 - c.rz * 0.15; // ceph centre z so the whole body is roughly centred on the origin
  const legs = [];
  for (const side of [1, -1]) for (let pair = 0; pair < 4; pair++) {
    const ang = def.pairAngles[pair] * D2R;
    const dir = new THREE.Vector3(side * Math.sin(ang), 0, Math.cos(ang));
    const aAtt = ang * 0.75 + (Math.PI / 2) * 0.25;
    const attach = new THREE.Vector3(side * Math.sin(aAtt) * c.rx * 0.8, -c.ry * 0.12, Math.cos(aAtt) * c.rz * 0.62);
    const L = def.restR * def.legFactor * def.pairLen[pair];
    const lens = def.segFrac.map((f) => f * L);
    const R = def.restR * def.pairRest[pair];
    const rest = new THREE.Vector3(0, 0, bodyZ0).addScaledVector(dir, R);
    legs.push({ side, pair, group: (pair + (side > 0 ? 0 : 1)) % 2, dir, attach, lens, rest, R });
  }
  let span = 0;
  for (const l1 of legs) for (const l2 of legs) span = Math.max(span, l1.rest.distanceTo(l2.rest));
  const palps = [1, -1].map((side) => ({
    side, attach: new THREE.Vector3(side * c.rx * 0.3, -c.ry * 0.3, c.rz * 0.8),
    lens: [0.42, 0.33, 0.25].map((f) => f * def.palp.len),
  }));
  const chel = [1, -1].map((side) => ({ side, attach: new THREE.Vector3(side * c.rx * 0.21, -c.ry * 0.08, c.rz * 0.84) }));
  const abdAttach = new THREE.Vector3(0, a.y, -c.rz * 0.95);
  return { bodyZ0, legs, palps, chel, abdAttach, legSpan: span };
}


// ---------------------------------------------------------------- Blender models (milestone 4)
// blender/generators/spiders.py writes assets/models/spider_<type>.glb (one smooth skinned mesh, 58 joints named
// b00..b57 in BONE order) and spider_<type>.json: the rig numbers, the leg layout and the rest frame of every bone the
// mesh was built around. The game rebuilds the skeleton from those frames, so SpiderRig drives the Blender mesh with
// the same maths as the code-made one. Missing files: the code-made spiders below are used.
const glb = {};   // type -> { def, lay, rest, mesh: {geometry, material, joints}, lod, glow }
const v3a = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Load every species' model before the first spider is made. Safe to call more than once. */
export async function loadSpiderModels(quality) {
  if (!assetsEnabled) return [];
  const base = new URL('../../assets/models/', import.meta.url);
  const loaded = await Promise.all(MODELS.map(async (type) => {
    if (glb[type]) return type;
    try {
      const [side, model] = await Promise.all([
        fetch(new URL(`spider_${type}.json`, base)).then((r) => (r.ok ? r.json() : null)),
        loadModel(`spider_${type}`, quality),
      ]);
      const mesh = model?.get(`spider_${type}`);
      if (!side || !mesh || !mesh.joints) return null;
      const L = side.layout;
      const lay = {
        bodyZ0: L.bodyZ0, legSpan: L.legSpan, abdAttach: v3a(L.abdAttach),
        legs: L.legs.map((l) => ({ ...l, dir: v3a(l.dir), attach: v3a(l.attach), rest: v3a(l.rest) })),
        palps: L.palps.map((p) => ({ ...p, attach: v3a(p.attach) })),
        chel: L.chel.map((c) => ({ ...c, attach: v3a(c.attach) })),
        mouth: L.mouth ? { ...L.mouth, attach: v3a(L.mouth.attach) } : null,
        lids: L.lids ? { ...L.lids, attach: v3a(L.lids.attach) } : null,
      };
      glb[type] = { side, lay, rest: side.rest.map((m) => new THREE.Matrix4().fromArray(m)),
        mesh: remapJoints(mesh), lod: model.get(`spider_${type}_lod1`) ? remapJoints(model.get(`spider_${type}_lod1`)) : null };
      return type;
    } catch (err) {
      console.warn(`[assets] spider_${type} not loaded, using the built-in model`, err?.message || err);
      return null;
    }
  }));
  return loaded.filter(Boolean);
}

/** The glTF's joints are in its own order; rewrite skinIndex so index i is our bone i (joint name 'b07' -> 7). */
function remapJoints(m) {
  const map = m.joints.map((n) => parseInt(String(n).replace(/\D/g, ''), 10));
  const si = m.geometry.attributes.skinIndex;
  if (!m.remapped && si) {
    for (let i = 0; i < si.array.length; i++) si.array[i] = map[si.array[i]] ?? 0;
    si.needsUpdate = true;
    m.remapped = true;
  }
  return m;
}

function buildGlbAssets(type, detail) {
  const G = glb[modelOf(type)];
  const key = type + ':glb:' + detail;
  if (assetCache.has(key)) return assetCache.get(key);
  const def = { ...(DEFS[type] || DEFS.stalker), ...G.side.def };
  const lay = G.lay;
  const src = (!detail && G.lod) ? G.lod : G.mesh;
  const material = src.material.clone();
  material.envMapIntensity = 0.5;
  // subsurface, faked: thin flesh lets light through, so lit skin glows warm at the edges and where light is behind it
  const sss = G.side.look?.sss || 0;
  if (sss > 0) {
    const col = new THREE.Color(...(G.side.look.sssColor || [0.8, 0.25, 0.15]));
    material.onBeforeCompile = (sh) => {
      sh.uniforms.uSss = { value: sss }; sh.uniforms.uSssColor = { value: col };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSss;\nuniform vec3 uSssColor;')
        .replace('#include <opaque_fragment>', `
          { float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
            vec3 lit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
            outgoingLight += uSssColor * uSss * (lit * 0.55 + lit * rim * 1.6); }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'spider-sss';
  }
  // the red eye glow (glowing species): points in body-bone space from the generator
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(G.side.glow.flat(), 3));
  const front = lay.bodyZ0 + def.ceph.rz * 1.05, back = lay.bodyZ0 - def.ceph.rz * 0.95 - def.abd.len;
  const hit = {
    center: new THREE.Vector3(0, def.bodyH + def.abd.r * 0.1, (front + back) / 2),
    radii: new THREE.Vector3(Math.max(def.ceph.rx, def.abd.r * def.abd.sx) * 1.15, Math.max(def.ceph.ry, def.abd.r * def.abd.sy) * 1.25, (front - back) / 2 * 1.05),
  };
  const boneInverses = G.rest.map((m) => m.clone().invert());
  const glowColor = G.side.eyes?.color;
  const out = { def, lay, geometry: src.geometry, eyeGeometry: null, glowGeometry, material, hit, boneInverses, glowColor,
    fromBlender: true, legR: G.side.legR, skin: G.side.color,
    tris: (src.geometry.index ? src.geometry.index.count : src.geometry.attributes.position.count) / 3, eyeTris: 0 };
  assetCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- shared assets cache
const assetCache = new Map();

function buildAssets(type, detail) {
  if (glb[modelOf(type)]) return buildGlbAssets(type, detail);
  const key = type + ':' + detail;
  if (assetCache.has(key)) return assetCache.get(key);
  const def = DEFS[type] || DEFS.stalker;
  const lay = makeLayout(def);
  const parts = [];
  const base = def.color;
  const H = def.hair, hairOn = detail === 1 && H.count > 0;
  const hairParts = [];
  const hr = rng(type.length * 977 + 13);

  // body
  const shape = makeCephShape(def);
  const ceph = tintGeo(cephGeo(def, detail, shape), base);
  parts.push(skinGeo(clean(ceph), BONE.BODY));
  const abd = tintGeo(abdomenGeo(def, detail), base);
  parts.push(skinGeo(clean(abd), BONE.ABD));
  if (hairOn) {
    hairParts.push(skinGeo(hairGeo(ceph, H.count * 0.1, H.len * 0.8, H.w, new THREE.Vector3(0, 0.2, -1), 1, base), BONE.BODY));
    hairParts.push(skinGeo(hairGeo(abd, H.count * 0.28, H.len, H.w, new THREE.Vector3(0, -0.1, -0.7), 2, base), BONE.ABD));
  }
  // chelicerae
  for (let s = 0; s < 2; s++) {
    const g = tintGeo(chelGeo(def, detail, s === 0 ? 1 : -1), base);
    parts.push(skinGeo(clean(g), BONE.CHEL + s));
    if (hairOn) hairParts.push(skinGeo(hairGeo(g, H.count * 0.03, H.len * 0.6, H.w, new THREE.Vector3(0, -1, 0.3), 3 + s, base), BONE.CHEL + s));
  }
  // palps
  const legSides = detail ? (def.lowPoly ? 6 : def.leg.keel > 0.3 ? 7 : 8) : 5;
  for (let s = 0; s < 2; s++) for (let k = 0; k < 3; k++) {
    const L = lay.palps[s].lens[k];
    const r0 = def.palp.r * (1.1 - k * 0.15), r1 = def.palp.r * (k === 2 ? 1.05 : 0.9 - k * 0.1);
    const g = tintGeo(segmentGeo({ L, r0, r1, sides: detail ? 6 : 4, knob: 0.2, keel: 0.1 }, detail), base);
    parts.push(skinGeo(clean(g), BONE.PALP + s * 3 + k));
    if (hairOn) hairParts.push(skinGeo(hairGeo(g, H.count * 0.008, H.len * 0.6, H.w * 0.8, new THREE.Vector3(1, 0, 0), 5 + s * 3 + k, base), BONE.PALP + s * 3 + k));
  }
  // legs: one geometry set per pair, shared left/right (bone space is mirror-symmetric)
  const segRad = [[1.25, 1.2], [1.18, 0.95], [1.0, 0.92], [0.92, 0.72], [0.6, 0.48], [0.45, 0.0]];
  const pairGeos = [];
  for (let pair = 0; pair < 4; pair++) {
    const lens = lay.legs[pair].lens;
    const lg = def.leg, R0 = def.legR * (1 - pair * 0.04);
    const segGeos = [];
    for (let k = 0; k < 6; k++) {
      const tip = k === 5;
      const ribs = lg.ribs && (k === 1 || k === 3 || k === 4) ? Math.round(lg.ribs * lens[k]) : 0;
      let g = segmentGeo({ L: lens[k], r0: R0 * segRad[k][0], r1: R0 * segRad[k][1], sides: tip ? Math.max(4, legSides - 2) : legSides, tip,
        knob: k === 0 ? 0.1 : lg.knob, ribs, ribDepth: lg.ribDepth, keel: lg.keel, edge: detail ? lg.edge || 0 : 0, hook: tip ? lg.hook : 0, uvR: R0 * 5 }, detail);
      g = clean(g);
      const extra = [g];
      if (detail && lg.spurs && (k === 1 || k === 3 || k === 4)) {
        for (let sp = 0; sp < lg.spurs; sp++) {
          const sg = spurGeo(R0 * (k === 1 ? 2.4 : 1.8), R0 * 0.32, detail);
          const ang = sp === 0 ? 0.55 : -0.7;
          sg.rotateZ(-0.9); sg.rotateX(ang);
          sg.translate(lens[k] * (0.9 - sp * 0.06), R0 * segRad[k][1] * 0.5, 0);
          extra.push(tintGeo(sg, [0.8, 0.8, 0.8]));
        }
      }
      if (!detail && lg.spurs && k === 4) {
        const sg = spurGeo(R0 * 1.6, R0 * 0.3, 0); sg.rotateZ(-0.9); sg.translate(lens[k] * 0.92, R0 * 0.25, 0); extra.push(sg);
      }
      segGeos.push(tintGeo(extra.length > 1 ? mergeGeometries(extra) : g, base));
    }
    pairGeos.push(segGeos);
  }
  lay.legs.forEach((leg, li) => {
    for (let k = 0; k < 6; k++) {
      const bone = BONE.LEG + li * 6 + k;
      parts.push(skinGeo(pairGeos[leg.pair][k].clone(), bone));
      if (hairOn && k >= 1 && k <= 4) {
        const share = [0, 0.2, 0.05, 0.16, 0.1][k] * 0.62 / 8 * (1 - leg.pair * 0.05);
        const hg = hairGeo(pairGeos[leg.pair][k], Math.round(H.count * share), H.len * (k === 4 ? 0.55 : 0.75), H.w, new THREE.Vector3(1.2, 0, 0), 100 + li * 7 + k, base);
        if (hg) hairParts.push(skinGeo(hg, bone));
      }
    }
  });
  const all = parts.concat(hairParts.filter(Boolean)).map((g) => {
    // make every attribute set identical
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const geometry = mergeGeometries(all);
  geometry.computeBoundingSphere();

  // eyes (body-bone space)
  const eyeDirs = [
    [0.13, 0.36, 0.92, 1.0], [0.3, 0.26, 0.9, 0.72], [0.17, 0.58, 0.8, 0.7], [0.36, 0.5, 0.78, 0.62],
  ];
  const er = rng(type.length * 31 + 7);
  for (let i = 0; i < def.eyeExtra; i++) eyeDirs.push([0.04 + er() * 0.42, 0.12 + er() * 0.55, 0.75 + er() * 0.25, 0.28 + er() * 0.25]);
  const eyeParts = [], glowPts = [];
  const tmp = [0, 0, 0];
  for (const [x, y, z, s] of eyeDirs) for (const side of [1, -1]) {
    const v = new THREE.Vector3(x * side, y, z).normalize();
    shape(v.x, v.y, v.z, tmp);
    const p = new THREE.Vector3(tmp[0], tmp[1], tmp[2]).addScaledVector(v, def.eyeR * s * 0.35);
    const g = clean(new THREE.SphereGeometry(def.eyeR * s, detail && s > 0.5 ? 9 : 5, detail && s > 0.5 ? 6 : 4));
    // glowing core where the eye faces out, dark glassy rim; secondary eyes dimmer
    const N = g.attributes.normal, C = g.attributes.color;
    const main = s >= 0.95 ? 1 : s >= 0.7 ? 0.6 : 0.4;
    for (let k = 0; k < C.count; k++) {
      const f = Math.max(0, N.getX(k) * v.x + N.getY(k) * v.y + N.getZ(k) * v.z);
      const c = main * (0.12 + 0.88 * Math.pow(f, 2.5));
      C.setXYZ(k, c, c, c);
    }
    g.translate(p.x, p.y, p.z);
    eyeParts.push(g);
    if (s >= 0.72) glowPts.push(p.x + v.x * def.eyeR, p.y + v.y * def.eyeR, p.z + v.z * def.eyeR);
  }
  const eyeGeometry = mergeGeometries(eyeParts);
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));

  // template material
  const tex = getChitinTextures(detail);
  const m = def.mat;
  const params = {
    color: 0xffffff, vertexColors: true, map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
    roughness: m.roughness, metalness: 0, normalScale: new THREE.Vector2(m.normalScale, -m.normalScale),
  };
  let material;
  if (detail) {
    material = new THREE.MeshPhysicalMaterial({
      ...params, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness,
      sheen: m.sheen || 0, sheenRoughness: m.sheenRoughness || 0.5,
      sheenColor: new THREE.Color().fromArray(m.sheenColor || [0, 0, 0]),
    });
  } else {
    material = new THREE.MeshStandardMaterial(params);
  }
  // hitbox ellipsoid (root space, unscaled): covers ceph + abdomen
  const front = lay.bodyZ0 + def.ceph.rz * 1.05, back = lay.bodyZ0 - def.ceph.rz * 0.95 - def.abd.len;
  const hit = {
    center: new THREE.Vector3(0, def.bodyH + def.abd.r * 0.1, (front + back) / 2),
    radii: new THREE.Vector3(Math.max(def.ceph.rx, def.abd.r * def.abd.sx) * 1.15, Math.max(def.ceph.ry, def.abd.r * def.abd.sy) * 1.25, (front - back) / 2 * 1.05),
  };
  const out = { def, lay, geometry, eyeGeometry, glowGeometry, material, hit,
    tris: geometry.index.count / 3, eyeTris: eyeGeometry.index.count / 3 };
  assetCache.set(key, out);
  return out;
}

const hitGeo = new THREE.SphereGeometry(1, 10, 8);
const hitMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });

/**
 * Build one spider. quality: Quality object (uses quality.spiderDetail 0|1).
 * Optional third argument { seed } for deterministic per-instance variation.
 */
export function createSpiderVisual(type, quality, opts = {}) {
  if (!Config.spiders[type]) type = 'runner';
  const detail = quality && quality.spiderDetail ? 1 : 0;
  const A = buildAssets(type, detail);
  const def = A.def;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const r = rng(seed);

  const root = new THREE.Group();
  root.name = 'spider-' + type;
  const space = new THREE.Group();
  const sz = SIZES[opts.size] || SIZES.medium;
  const scale = (Config.spiders[type]?.scale ?? 1) * sz.scale * (1 + (r() - 0.5) * 0.12);
  space.scale.setScalar(scale);
  root.add(space);

  // per-instance material clone (same shader program; own tint and opacity)
  const material = A.material.clone();
  const tint = 1 + (r() - 0.5) * 0.25;
  material.color.setRGB(tint * (1 + (r() - 0.5) * 0.12), tint * (1 + (r() - 0.5) * 0.08), tint * (1 + (r() - 0.5) * 0.12));

  const bones = [];
  // 58 body and leg bones, plus the face bones (mouth, lids) when the Blender model has them
  const nBones = A.boneInverses ? A.boneInverses.length : BONE_COUNT;
  for (let i = 0; i < nBones; i++) { const b = new THREE.Bone(); space.add(b); bones.push(b); }
  // code-made geometry is stored in each bone's own space (identity inverses); a Blender mesh is in its rest pose
  const skeleton = new THREE.Skeleton(bones, A.boneInverses ? A.boneInverses.map((m) => m.clone()) : bones.map(() => new THREE.Matrix4()));
  const mesh = new THREE.SkinnedMesh(A.geometry, material);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, def.bodyH, 0), def.restR * 1.7 + def.bodyH);
  space.add(mesh);

  // eyes: per-instance materials so glow can be dimmed per spider
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1008, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const eyeMesh = A.eyeGeometry ? new THREE.Mesh(A.eyeGeometry, eyeMat) : new THREE.Group();   // Blender eyes are in the mesh
  eyeMesh.renderOrder = 20;
  const glowMat = new THREE.PointsMaterial({
    map: getGlowTexture(), color: 0xff1a0a, size: def.glow, sizeAttenuation: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const glow = new THREE.Points(A.glowGeometry, glowMat);
  glow.renderOrder = 21;
  glow.frustumCulled = false;
  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  eyes.add(eyeMesh, glow);
  bones[BONE.BODY].add(eyes);

  const hitbox = new THREE.Mesh(hitGeo, hitMat);
  hitbox.visible = false;
  hitbox.position.copy(A.hit.center).multiplyScalar(scale);
  hitbox.scale.copy(A.hit.radii).multiplyScalar(scale);
  hitbox.name = 'spider-hitbox';
  root.add(hitbox);

  const rig = new SpiderRig({ space, bones, def, layout: A.lay, seed, collision: opts.collision || null, mass: (def.mass ?? 1) * sz.mass });

  let glowV = 1, opac = 1;
  const applyEyes = () => {
    const g = glowV;
    eyeMat.color.setRGB(0.07 + 0.93 * g * 1.4, 0.008 + 0.05 * g, 0.006 + 0.03 * g);
    eyeMat.opacity = opac;
    glowMat.opacity = g * opac;
    glow.visible = g * opac > 0.01;
  };
  applyEyes();

  const visual = {
    type, root, rig, hitbox, eyes, mesh, space,
    eyeMaterials: [eyeMat, glowMat],
    material,
    radius: Math.max(def.ceph.rx, def.abd.r, (def.abd.len + def.ceph.rz * 2) / 2) * scale,
    legSpan: A.lay.legSpan * scale,
    scale,
    bones,                                   // for the death burst: leg pieces come from where the legs were
    legRadius: (A.legR ?? def.legR) * scale,
    skinColor: new THREE.Color(...(A.skin || def.color)).multiply(material.color).multiplyScalar(A.fromBlender ? 1 : 1.3),
    fromBlender: !!A.fromBlender,
    setEyeGlow(v) { glowV = Math.max(0, Math.min(1, v)); applyEyes(); },
    setOpacity(v) {
      opac = Math.max(0, Math.min(1, v));
      const tr = opac < 0.999;
      if (material.transparent !== tr) { material.transparent = tr; material.needsUpdate = true; }
      material.opacity = opac;
      mesh.visible = opac > 0.004;
      mesh.castShadow = opac > 0.5;
      applyEyes();
    },
    dispose() {
      material.dispose(); eyeMat.dispose(); glowMat.dispose(); skeleton.dispose();
      root.removeFromParent();
    },
  };
  return visual;
}

/** Debug / stats: triangle counts of the shared geometry for a type + detail. */
export function spiderStats(type, detail) {
  const A = buildAssets(type, detail ? 1 : 0);
  return { tris: A.tris, eyeTris: A.eyeTris, verts: A.geometry.attributes.position.count, bones: BONE_COUNT, legSpan: A.lay.legSpan };
}

export { DEFS as SPIDER_DEFS };
