// The forest around the cabin: terrain, pines/spruces/dead trees (instanced), grass, ferns, rocks,
// fallen logs, the old shed, the creek, rain, low mist and distant treeline layers.
//
// Three window views (see Layout.js):
//   north: dense conifers from ~5 m, ferns, rocks, short sightlines
//   east:  open misty clearing of tall wet grass, dead tree line at x ~ 32, forest beyond
//   west:  slope down to the creek, fallen logs, leaning shed
// Spider ROUTES are kept clear of trunks, rocks and logs.
import * as THREE from 'three';
import { CABIN, WINDOWS, ROUTES, LANDMARKS, CREEK_X, terrainHeight, smooth } from './Layout.js';
import * as T from './Textures.js';
import { uvWorld } from './Cabin.js';

const LANE_CLEAR = 1.6;     // trunks/rocks/logs stay this far from a route polyline
const TERRAIN_EXTENT = 120;

// ------------------------------------------------------------------ shared helpers
export function creekCenter(z) {
  return CREEK_X + Math.sin(z * 0.07) * 0.8 + Math.sin(z * 0.19 + 1) * 0.3;
}
function creekCarve(x, z) {
  const d = Math.abs(x - creekCenter(z));
  return -0.5 * (1 - smooth(0.8, 2.4, d));
}

const routeSegs = [];
for (const side of Object.values(ROUTES)) for (const r of side) for (let i = 0; i < r.length - 1; i++) routeSegs.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]]);
function distToRoutes(x, z) {
  let best = 1e9;
  for (const [ax, az, bx, bz] of routeSegs) {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}
function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}
const logSegs = LANDMARKS.fallenLogs.map((l) => {
  const dx = Math.cos(l.rot) * l.len / 2, dz = Math.sin(l.rot) * l.len / 2;
  return [l.x - dx, l.z - dz, l.x + dx, l.z + dz];
});
function nearLogs(x, z) { return Math.min(...logSegs.map((s) => distToSegment(x, z, ...s))); }
const shedPos = LANDMARKS.shed.position;

// Wind sway for instanced/plain meshes. Offsets vertices in world space after the instance transform,
// scaled by height above the instance origin squared.
function windPatch(mat, strength, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWind = U.uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        vec3 org = instanceMatrix[3].xyz;
      #else
        vec3 org = vec3(0.0);
      #endif
      vec4 wp = modelMatrix * mvPosition;
      float hgt = max(mvPosition.y - org.y, 0.0);
      float ph = dot(wp.xz, vec2(0.05, 0.035)) + dot(org.xz, vec2(0.7, 0.3));
      float gust = 0.6 + 0.4 * sin(uTime * 0.23 + wp.x * 0.02);
      float sway = (sin(uTime * 0.9 + ph) * 0.7 + sin(uTime * 2.1 + ph * 1.9) * 0.3) * gust * uWind * ${strength.toFixed(5)} * hgt * hgt;
      mvPosition.x += sway;
      mvPosition.z += sway * 0.45;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
    // foliage cards use bent "up" normals; do not flip them on back faces (that turns half the cards black)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  };
  mat.customProgramCacheKey = () => 'wind' + strength;
  return mat;
}

// Point-light (lantern) shadows should not render the forest: skip instanced meshes during cube-face passes.
function skipPointShadow(mesh) {
  mesh.onBeforeShadow = function (r, o, cam, shadowCamera) {
    if (shadowCamera.isPerspectiveCamera) { this.userData.c = this.count; this.count = 0; }
  };
  mesh.onAfterShadow = function (r, o, cam, shadowCamera) {
    if (shadowCamera.isPerspectiveCamera) this.count = this.userData.c;
  };
}

function setNormals(geo, fn) {
  const p = geo.attributes.position, n = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), v); v.normalize(); n[i * 3] = v.x; n[i * 3 + 1] = v.y; n[i * 3 + 2] = v.z; }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

// ------------------------------------------------------------------ tree geometry
// A conifer: trunk (+ dead stubs) and drooping branch cards in whorls.
function coniferGeometry(o) {
  const R = T.rng(o.seed);
  // trunk
  const trunk = new THREE.CylinderGeometry(o.rTop, o.rBase, o.H, 8, 6, true);
  trunk.translate(0, o.H / 2, 0);
  {
    const p = trunk.attributes.position, uv = trunk.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const flare = 1 + 0.35 * Math.max(0, 1 - y / 0.8) ** 2;
      p.setX(i, p.getX(i) * flare + Math.sin(y * 0.9 + o.seed) * 0.04);
      p.setZ(i, p.getZ(i) * flare + Math.cos(y * 0.7 + o.seed) * 0.04);
      uv.setY(i, uv.getY(i) * o.H / 2.4);
    }
  }
  const trunkParts = [trunk];
  // dead branch stubs below the crown
  const y0 = o.H * o.crown;
  for (let k = 0; k < o.stubs; k++) {
    const y = 1.5 + R() * Math.max(0.5, y0 - 1.5), a = R() * Math.PI * 2, len = 0.4 + R() * 0.9;
    const g = new THREE.CylinderGeometry(0.008, 0.03, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(-Math.PI / 2 + 0.25 + R() * 0.4);
    g.rotateY(a);
    g.translate(0, y, 0);
    trunkParts.push(g);
  }
  const trunkGeo = mergeSimple(trunkParts);

  // foliage cards
  const pos = [], nor = [], uvs = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const card = (base, dir, len, width, droop, lift, roll, segs) => {
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    side.applyAxisAngle(dir, roll);
    const start = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, d = t * len;
      const c = base.clone().addScaledVector(dir, d);
      c.y += lift * d - droop * d * d / Math.max(len, 0.5);
      const w = width * (0.45 + 0.55 * Math.min(1, t * 1.6)) * (1 - 0.35 * t);
      for (const sgn of [-1, 1]) {
        const v = c.clone().addScaledVector(side, sgn * w / 2);
        pos.push(v.x, v.y, v.z);
        const nn = dir.clone().multiplyScalar(0.45).add(up).addScaledVector(side, sgn * 0.25).normalize();
        nor.push(nn.x, nn.y, nn.z);
        uvs.push(t * 0.97, sgn < 0 ? 0 : 1);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const top = o.H * 0.985;
  for (let y = y0; y < top - 0.3; y += o.step * (0.8 + R() * 0.4)) {
    const t = (y - y0) / (top - y0);
    const n = o.perWhorl + (R() < 0.5 ? 1 : 0);
    const a0 = R() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const len = (o.maxLen * Math.pow(1 - t, o.shape) + 0.35) * (0.75 + R() * 0.5);
      const rTrunk = o.rBase + (o.rTop - o.rBase) * (y / o.H);
      const base = new THREE.Vector3(dir.x * rTrunk * 0.5, y, dir.z * rTrunk * 0.5);
      card(base, dir, len, o.width * (0.6 + 0.6 * Math.min(1, len / o.maxLen)), o.droop * (0.6 + R() * 0.8), o.lift, (R() - 0.5) * 1.1, len > 1.2 ? 3 : 2);
    }
  }
  // leader at the top: two crossed upright cards
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2 + R();
    const dir = new THREE.Vector3(0.12 * Math.cos(a), 1, 0.12 * Math.sin(a)).normalize();
    const base = new THREE.Vector3(0, top - 1.1, 0);
    const start = pos.length / 3;
    const side = new THREE.Vector3(Math.cos(a + Math.PI / 2), 0, Math.sin(a + Math.PI / 2));
    for (let s = 0; s <= 2; s++) {
      const t = s / 2, c = base.clone().addScaledVector(dir, t * 1.5);
      const w = 0.7 * (1 - t * 0.8);
      for (const sgn of [-1, 1]) { const v = c.clone().addScaledVector(side, sgn * w / 2); pos.push(v.x, v.y, v.z); nor.push(0, 1, 0); uvs.push(t, sgn < 0 ? 0 : 1); }
    }
    for (let s = 0; s < 2; s++) { const a2 = start + s * 2; idx.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2); }
  }
  const fol = new THREE.BufferGeometry();
  fol.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fol.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  fol.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  fol.setIndex(idx);
  return { trunk: trunkGeo, foliage: fol };
}

// Bare dead tree: trunk with upward branches and twigs, all bark.
function deadTreeGeometry(seed, H, broken) {
  const R = T.rng(seed);
  const parts = [];
  const trunkH = broken ? H * 0.6 : H;
  const trunk = new THREE.CylinderGeometry(broken ? 0.12 : 0.03, 0.26, trunkH, 7, 5, !broken);
  trunk.translate(0, trunkH / 2, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.5 + seed) * 0.12); p.setZ(i, p.getZ(i) + Math.cos(y * 0.4 + seed) * 0.1); }
  const uv = trunk.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * trunkH / 2.4);
  parts.push(trunk);
  const branch = (base, dir, len, r, depth) => {
    const g = new THREE.CylinderGeometry(r * 0.25, r, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q); g.translate(base.x, base.y, base.z);
    parts.push(g);
    if (depth < 2) {
      const n = depth === 0 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const t = 0.35 + R() * 0.55;
        const b2 = base.clone().addScaledVector(dir, len * t);
        const d2 = dir.clone().add(new THREE.Vector3((R() - 0.5) * 1.4, R() * 0.6, (R() - 0.5) * 1.4)).normalize();
        branch(b2, d2, len * (0.35 + R() * 0.3), r * 0.5, depth + 1);
      }
    }
  };
  const nb = broken ? 4 : 8;
  for (let k = 0; k < nb; k++) {
    const y = trunkH * (0.35 + 0.6 * (k / nb)) , a = R() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.5 + R() * 0.9, Math.sin(a)).normalize();
    branch(new THREE.Vector3(Math.sin(y * 0.5 + seed) * 0.12, y, Math.cos(y * 0.4 + seed) * 0.1), dir, (H * 0.25) * (1 - y / trunkH * 0.6) * (0.6 + R() * 0.6), 0.07 * (1 - y / trunkH * 0.5), 0);
  }
  return mergeSimple(parts);
}

function mergeSimple(list) {
  // merge indexed geometries with position/normal/uv
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = vo + i; io += g.attributes.position.count; }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function crossedCards(w, h, n, yaw0 = 0) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY(yaw0 + (k / n) * Math.PI);
    parts.push(g);
  }
  const m = mergeSimple(parts);
  setNormals(m, (x, y, z, v) => v.set(x * 0.3, 1, z * 0.3));
  return m;
}

// ------------------------------------------------------------------ build
export function buildForest(scene, quality, lighting) {
  const group = new THREE.Group();
  group.name = 'forest';
  const high = quality.tier === 'high';
  const env = T.nightEnv();
  const U = { uTime: { value: 0 }, uWind: { value: 1 } };
  const R = T.rng(4242);

  // ---------------------------------------------------------------- terrain
  {
    const N = high ? 200 : 120;
    const geo = new THREE.PlaneGeometry(2, 2, N, N);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const warp = (u) => TERRAIN_EXTENT * (0.22 * u + 0.78 * u * u * u);
    for (let i = 0; i < p.count; i++) {
      const x = warp(p.getX(i)), z = warp(p.getZ(i));
      let y = terrainHeight(x, z) + creekCarve(x, z);
      p.setXYZ(i, x, y, z);
      // colour variation: clearing slightly greener, creek banks darker/wetter, under the cabin dark
      const n = 0.85 + 0.3 * (Math.sin(x * 0.37 + z * 0.11) * 0.5 + Math.sin(x * 0.13 - z * 0.29 + 2) * 0.5);
      let r = n, g = n, b = n;
      const clearing = smooth(4, 8, x) * (1 - smooth(30, 36, x)) * (1 - smooth(16, 24, Math.abs(z)));
      r *= 1 - 0.12 * clearing; g *= 1 + 0.05 * clearing; b *= 1 - 0.15 * clearing;
      const wet = 1 - smooth(1.5, 4.5, Math.abs(x - creekCenter(z)));
      r *= 1 - 0.35 * wet; g *= 1 - 0.32 * wet; b *= 1 - 0.28 * wet;
      const under = (1 - smooth(CABIN.halfX, CABIN.halfX + 0.6, Math.abs(x))) * (1 - smooth(CABIN.halfZ, CABIN.halfZ + 0.6, Math.abs(z)));
      r *= 1 - 0.6 * under; g *= 1 - 0.6 * under; b *= 1 - 0.6 * under;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ft = T.forestFloor();
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / ft.tile[0], p.getZ(i) / ft.tile[1]);
    const mat = new THREE.MeshStandardMaterial({ map: ft.map, normalMap: ft.normalMap, roughnessMap: ft.roughnessMap, roughness: 1, vertexColors: true, envMap: env, envMapIntensity: 0.9 });
    mat.normalScale.set(1.2, 1.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = quality.shadows;
    group.add(mesh);
  }

  // ---------------------------------------------------------------- tree placement
  const cell = 2, grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const tooClose = (x, z, r) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const l = grid.get(`${cx + i},${cz + j}`);
      if (l) for (const q of l) if (Math.hypot(q[0] - x, q[1] - z) < Math.max(r, q[2])) return true;
    }
    return false;
  };
  const occupy = (x, z, r) => { const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z, r]); };

  const inClearing = (x, z) => x > 4.5 && x < 30.5 && Math.abs(z) < 19 + 4 * Math.sin(x * 0.21 + 1);
  const forestDensity = (x, z) => {
    if (Math.abs(x) < 6.5 && z > -8.6 && z < 9.5) return 0;                 // cabin yard
    if (inClearing(x, z)) return 0;
    if (x > 29 && x < 35.5 && Math.abs(z) < 30) return 0;                    // dead tree line itself
    if (Math.abs(x - creekCenter(z)) < 2.6) return 0;
    if (Math.hypot(x - shedPos.x, z - shedPos.z) < 4.2) return 0;
    if (nearLogs(x, z) < 1.6) return 0;
    if (z < -8.6 && x > -25 && x < 25) return 1.0;                           // north: dense
    if (x < -6.5) return 0.42;                                                // west slope: thinner
    if (x > 35) return 0.85;
    return 0.8;
  };

  const variants = {
    pine: { list: [], geo: coniferGeometry({ seed: 3, H: 17, rBase: 0.24, rTop: 0.03, crown: 0.42, step: 0.62, perWhorl: 5, maxLen: 3.0, width: 1.25, droop: 0.35, lift: 0.08, shape: 0.9, stubs: 10 }) },
    spruce: { list: [], geo: coniferGeometry({ seed: 7, H: 14, rBase: 0.22, rTop: 0.03, crown: 0.07, step: 0.5, perWhorl: 6, maxLen: 2.6, width: 1.15, droop: 0.65, lift: 0.0, shape: 1.0, stubs: 3 }) },
    fir: { list: [], geo: coniferGeometry({ seed: 11, H: 12, rBase: 0.19, rTop: 0.03, crown: 0.22, step: 0.55, perWhorl: 5, maxLen: 2.2, width: 1.1, droop: 0.5, lift: 0.04, shape: 0.95, stubs: 6 }) },
  };
  const farList = [], deadList = [], snagList = [];
  const NEAR = high ? 40 : 30;
  const target = quality.treeCount;
  let placed = 0, tries = 0;
  const mat4 = (x, z, s, ry, tilt = 0.03, sink = 0.15) => {
    const y = terrainHeight(x, z) + creekCarve(x, z) - sink * s;
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * tilt, ry, (R() - 0.5) * tilt)), new THREE.Vector3(s, s, s));
  };

  // dead tree line in the east, plus a few strays
  for (let z = -30; z <= 30; z += 2.4 + R() * 2.2) {
    const x = LANDMARKS.deadTreeLineX + (R() - 0.5) * 3.5;
    if (distToRoutes(x, z) < LANE_CLEAR + 0.4) continue;
    (R() < 0.3 ? snagList : deadList).push(mat4(x, z, 0.8 + R() * 0.5, R() * 6, 0.12, 0.1));
    occupy(x, z, 1.5); placed++;
  }
  for (const [x, z] of [[14, -14], [21, 11], [9, 15], [-10, -4.5], [-23, 8], [-8, 13], [26, -19]]) {
    if (distToRoutes(x, z) < LANE_CLEAR) continue;
    (R() < 0.5 ? snagList : deadList).push(mat4(x, z, 0.7 + R() * 0.4, R() * 6, 0.15, 0.1));
    occupy(x, z, 1.5); placed++;
  }
  // young firs close in the north (eye-level foliage seen from the north window) and at forest edges
  const youngList = [];
  for (let k = 0; k < (high ? 70 : 40) && tries < 20000; tries++) {
    const x = (R() - 0.5) * 40, z = -7.5 - R() * 20;
    const d = forestDensity(x, z);
    if (z > -8.2 || d === 0 || distToRoutes(x, z) < LANE_CLEAR + 0.7 || tooClose(x, z, 1.4)) continue;
    youngList.push(mat4(x, z, 0.18 + R() * 0.25, R() * 6, 0.06, 0.0));
    occupy(x, z, 0.8); k++; placed++;
  }
  tries = 0;
  while (placed < target && tries < target * 60) {
    tries++;
    const a = R() * Math.PI * 2, r = 7 + Math.pow(R(), 0.75) * 68;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = forestDensity(x, z);
    if (d === 0 || R() > d) continue;
    const lane = distToRoutes(x, z);
    if (lane < LANE_CLEAR + (r < NEAR ? 0.6 : 0)) continue;
    const minD = r < 20 ? 2.0 : 2.6;
    if (tooClose(x, z, minD)) continue;
    occupy(x, z, minD);
    placed++;
    const s = 0.75 + R() * 0.55;
    const m = mat4(x, z, s, R() * 6);
    if (r > NEAR) { farList.push(m); continue; }
    const pick = R();
    const north = z < -8;
    if (north) (pick < 0.5 ? variants.spruce : pick < 0.8 ? variants.fir : variants.pine).list.push(m);
    else (pick < 0.45 ? variants.pine : pick < 0.75 ? variants.fir : variants.spruce).list.push(m);
  }
  // young firs use the spruce geometry, scaled down
  for (const m of youngList) variants.spruce.list.push(m);

  // ---------------------------------------------------------------- tree meshes
  const barkT = T.bark(false), deadT = T.bark(true), needles = T.needleBranch();
  const barkMat = new THREE.MeshStandardMaterial({ map: barkT.map, normalMap: barkT.normalMap, roughnessMap: barkT.roughnessMap, roughness: 1, envMap: env, envMapIntensity: 0.3 });
  const deadMat = new THREE.MeshStandardMaterial({ map: deadT.map, normalMap: deadT.normalMap, roughnessMap: deadT.roughnessMap, roughness: 1, envMap: env, envMapIntensity: 0.3 });
  const needleMat = windPatch(new THREE.MeshStandardMaterial({ map: needles, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7,
    color: new THREE.Color(0.75, 0.85, 0.8), envMap: env, envMapIntensity: 0.25 }), 0.0003, U);
  const needleDepth = new THREE.MeshDepthMaterial({ map: needles, alphaTest: 0.42, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const trunkWind = windPatch(barkMat.clone(), 0.0003, U);
  const mkInst = (geo, mat, list, name, cast, depthMat) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = name;
    im.castShadow = cast;
    im.receiveShadow = !!quality.moonShadows && mat !== needleMat;
    if (depthMat) im.customDepthMaterial = depthMat;
    skipPointShadow(im);
    group.add(im);
    return im;
  };
  const cast = !!quality.moonShadows;
  for (const [name, v] of Object.entries(variants)) {
    mkInst(v.geo.trunk, trunkWind, v.list, 'trunk-' + name, cast);
    mkInst(v.geo.foliage, needleMat, v.list, 'foliage-' + name, cast, needleDepth);
  }
  // dead trees
  mkInst(deadTreeGeometry(21, 12, false), deadMat, deadList, 'dead', cast);
  mkInst(deadTreeGeometry(33, 10, true), deadMat, snagList, 'snag', cast);
  // distant impostors: two crossed cards each
  {
    const mat = new THREE.MeshStandardMaterial({ map: T.pineSilhouette(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0x9aa59a });
    mkInst(crossedCards(7, 17, 2), mat, farList, 'farTrees', false);
  }

  // ---------------------------------------------------------------- grass (east clearing + yard + west slope)
  {
    const geo = crossedCards(0.8, 1.0, 3);
    const mat = windPatch(new THREE.MeshStandardMaterial({ map: T.grassBlades(), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.6,
      color: new THREE.Color(0.62, 0.66, 0.5), envMap: env, envMapIntensity: 0.15 }), 0.09, U);
    const list = [];
    const n = quality.grassCount;
    let t = 0;
    while (list.length < n && t < n * 20) {
      t++;
      let x, z;
      const pick = R();
      if (pick < 0.72) { x = 3.4 + R() * 30; z = (R() - 0.5) * 48; if (!inClearing(x, z) && x < 30) continue; }
      else if (pick < 0.88) { const a = R() * Math.PI * 2, r = 3.8 + R() * 7; x = Math.cos(a) * r; z = Math.sin(a) * r * 1.2; if (x < -2) continue; }
      else { x = -9 - R() * 17; z = (R() - 0.5) * 36; }
      if (Math.abs(x) < CABIN.halfX + 0.4 && Math.abs(z) < CABIN.halfZ + 0.4) continue;
      if (Math.abs(x - creekCenter(z)) < 1.7) continue;
      if (nearLogs(x, z) < 0.4) continue;
      const s = (0.7 + R() * 0.6) * (inClearing(x, z) ? 1.15 : x < -6 ? 0.6 : 0.55);
      const y = terrainHeight(x, z) + creekCarve(x, z) - 0.05;
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.25, R() * 6, (R() - 0.5) * 0.25)), new THREE.Vector3(s, s * (0.8 + R() * 0.5), s)));
    }
    const im = mkInst(geo, mat, list, 'grass', false);
    if (im) im.receiveShadow = !!quality.moonShadows;
  }

  // ---------------------------------------------------------------- ferns (north forest floor, edges)
  {
    const parts = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + k * 0.3, len = 0.7 + (k % 3) * 0.15;
      const g = new THREE.PlaneGeometry(1, 0.32, 3, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + 0.5, w = p.getY(i);
        p.setXYZ(i, u * len, 0.35 * Math.sin(u * 2.2) * len - u * u * 0.25, w);
      }
      g.rotateY(a);
      parts.push(g);
    }
    const geo = mergeSimple(parts);
    setNormals(geo, (x, y, z, v) => v.set(x * 0.3, 1, z * 0.3));
    const mat = windPatch(new THREE.MeshStandardMaterial({ map: T.fernFrond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, color: new THREE.Color(0.7, 0.78, 0.66) }), 0.08, U);
    const list = [];
    const n = Math.round(quality.treeCount * (high ? 0.8 : 0.6));
    let t = 0;
    while (list.length < n && t < n * 30) {
      t++;
      const a = R() * Math.PI * 2, r = 5.5 + Math.pow(R(), 0.8) * 32;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (inClearing(x, z) && R() < 0.9) continue;
      if (Math.abs(x) < CABIN.halfX + 0.5 && Math.abs(z) < CABIN.halfZ + 0.5) continue;
      if (Math.abs(x - creekCenter(z)) < 1.4) continue;
      const north = z < -7;
      if (!north && R() < 0.55) continue;
      const s = 0.6 + R() * 0.8;
      const y = terrainHeight(x, z) + creekCarve(x, z) - 0.03;
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R() * 6, 0)), new THREE.Vector3(s, s, s)));
    }
    mkInst(geo, mat, list, 'ferns', false);
  }

  // ---------------------------------------------------------------- rocks
  // Built-in rocks first (always works); useRocks() swaps in the Blender rock family when it has loaded.
  let rockData = null;
  {
    const geo = new THREE.IcosahedronGeometry(1, high ? 2 : 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + 0.22 * Math.sin(x * 2.1 + z * 1.3) + 0.12 * Math.sin(y * 4.3 + x * 3.1) + 0.06 * Math.sin(z * 7.7 - y * 5.3);
      p.setXYZ(i, x * d, Math.max(y * d * 0.62, -0.3), z * d);
    }
    geo.computeVertexNormals();
    uvWorld(geo, [1.5, 1.5], 'h');
    const rt = T.rock();
    const mat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughnessMap: rt.roughnessMap, roughness: 1, envMap: env, envMapIntensity: 0.7 });
    const list = [];
    const tryRock = (x, z, s) => {
      if (distToRoutes(x, z) < LANE_CLEAR + s * 0.8) return false;
      if (Math.abs(x) < CABIN.halfX + 1.2 && Math.abs(z) < CABIN.halfZ + 1.2) return false;
      if (Math.abs(x - creekCenter(z)) < 1.2) return false;
      if (Math.hypot(x - shedPos.x, z - shedPos.z) < 3) return false;
      const y = terrainHeight(x, z) + creekCarve(x, z) - s * 0.2;
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.4, R() * 6, (R() - 0.5) * 0.4)), new THREE.Vector3(s * (0.8 + R() * 0.5), s, s * (0.8 + R() * 0.5))));
      return true;
    };
    for (let k = 0, t = 0; k < (high ? 70 : 40) && t < 2000; t++) { const x = (R() - 0.5) * 50, z = -7 - R() * 30; if (tryRock(x, z, 0.25 + Math.pow(R(), 2) * 1.3)) k++; }
    for (let k = 0, t = 0; k < (high ? 30 : 18) && t < 2000; t++) { const z = (R() - 0.5) * 60; const x = creekCenter(z) + (R() < 0.5 ? -1 : 1) * (1.5 + R() * 1.5); if (tryRock(x, z, 0.2 + R() * 0.6)) k++; }
    for (let k = 0, t = 0; k < (high ? 30 : 16) && t < 2000; t++) { const a = R() * 6.28, r = 8 + R() * 40; if (tryRock(Math.cos(a) * r, Math.sin(a) * r, 0.2 + Math.pow(R(), 2) * 1.0)) k++; }
    for (let k = 0, t = 0; k < 8 && t < 400; t++) { const x = 6 + R() * 22, z = (R() - 0.5) * 30; if (tryRock(x, z, 0.3 + R() * 0.5)) k++; }
    const im = mkInst(geo, mat, list, 'rocks', cast);
    if (im) im.receiveShadow = quality.shadows;
    rockData = { list, im, cast };
  }

  // ---------------------------------------------------------------- fallen logs
  {
    const barkParts = [], endParts = [];
    for (const l of LANDMARKS.fallenLogs) {
      const r = 0.32 + (l.len > 5.5 ? 0.06 : 0);
      const g = new THREE.CylinderGeometry(r * 0.85, r, l.len, 12, 4, true);
      const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setX(i, pp.getX(i) * (1 + 0.06 * Math.sin(y * 2 + i))); }
      g.computeVertexNormals();
      const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 1.5, uvA.getY(i) * l.len / 2.4);
      const ends = [new THREE.CircleGeometry(r * 0.85, 12).rotateX(-Math.PI / 2).translate(0, l.len / 2, 0), new THREE.CircleGeometry(r, 12).rotateX(Math.PI / 2).translate(0, -l.len / 2, 0)];
      // a couple of broken branch stubs
      const stubs = [];
      for (let k = 0; k < 3; k++) {
        const s = new THREE.CylinderGeometry(0.02, 0.06, 0.6, 5, 1, true);
        s.translate(0, 0.3 + r * 0.8, 0); s.rotateZ((k - 1) * 0.5); s.rotateY(k * 2.1); s.translate(0, (k - 1) * l.len * 0.3, 0);
        stubs.push(s);
      }
      const dx = Math.cos(l.rot) * l.len / 2, dz = Math.sin(l.rot) * l.len / 2;
      const h0 = terrainHeight(l.x - dx, l.z - dz) + creekCarve(l.x - dx, l.z - dz), h1 = terrainHeight(l.x + dx, l.z + dz) + creekCarve(l.x + dx, l.z + dz);
      const dirV = new THREE.Vector3(dx * 2, h1 - h0, dz * 2).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirV);
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot * 3);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(l.x, (h0 + h1) / 2 + r * 0.6, l.z), q.multiply(roll), new THREE.Vector3(1, 1, 1));
      for (const gg of [g, ...stubs]) { gg.applyMatrix4(m); barkParts.push(gg); }
      for (const e of ends) { e.applyMatrix4(m); endParts.push(e); }
    }
    const mat = new THREE.MeshStandardMaterial({ map: deadT.map, normalMap: deadT.normalMap, roughnessMap: deadT.roughnessMap, roughness: 1, color: 0x8a7f72, envMap: env, envMapIntensity: 0.4 });
    const et = T.endGrain();
    const endMat = new THREE.MeshStandardMaterial({ map: et.map, normalMap: et.normalMap, roughness: 0.9, color: 0x9a8a78 });
    const lm = new THREE.Mesh(mergeSimple(barkParts), mat); lm.castShadow = cast; lm.receiveShadow = quality.shadows; lm.name = 'logs';
    const le = new THREE.Mesh(mergeSimple(endParts), endMat); le.name = 'logEnds';
    group.add(lm, le);
  }

  // ---------------------------------------------------------------- the old shed (west)
  group.add(buildShed(quality, env));

  // ---------------------------------------------------------------- creek
  let water;
  {
    const L = 140, segs = high ? 140 : 70;
    const geo = new THREE.PlaneGeometry(3.4, L, 2, segs);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const cx = creekCenter(z);
      p.setXYZ(i, cx + x, terrainHeight(cx, z) + creekCarve(cx, z) + 0.32, z);
    }
    geo.computeVertexNormals();
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * L / 3);
    const n = T.waterNormal(); n.wrapS = n.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0e12, roughness: 0.04, metalness: 0.2, normalMap: n, normalScale: new THREE.Vector2(0.25, 0.25), envMap: env, envMapIntensity: 4.0 });
    water = new THREE.Mesh(geo, mat);
    water.name = 'creek';
    water.receiveShadow = !!quality.moonShadows;
    group.add(water);
  }

  // ---------------------------------------------------------------- distant treeline layers
  const treelineMats = [];
  {
    const layers = [[66, 0.75, 1, 22]];
    for (const [rad, k, seed, h] of layers) {
      const geo = new THREE.CylinderGeometry(rad, rad, h, 48, 1, true);
      geo.translate(0, h / 2 - 6, 0);
      const t = T.treeline(seed); t.repeat.set(7, 1);
      const fc = new THREE.Color().setRGB(0.028 * k, 0.036 * k, 0.048 * k, THREE.LinearSRGBColorSpace);
      const mat = new THREE.MeshBasicMaterial({ color: fc, map: t, alphaTest: 0.5, side: THREE.BackSide, fog: false });
      mat.userData.k = k;
      treelineMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.name = 'treeline-' + rad;
      m.renderOrder = -5;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- mist
  const mists = [];
  {
    const tex = T.fogPuff();
    const spots = [];
    for (let k = 0; k < 6; k++) spots.push([15 + k * 3.5 + R() * 2, (R() - 0.5) * 22, 12 + R() * 6]);   // clearing
    for (let k = 0; k < 4; k++) spots.push([creekCenter(-12 + k * 8), -12 + k * 8 + R() * 3, 12 + R() * 6]); // creek
    for (let k = 0; k < 2; k++) spots.push([(R() - 0.5) * 16, -17 - R() * 8, 10]);                          // north
    for (const [x, z, w] of spots) {
      // sprites always face the camera, so a wide one near the cabin would swing through the room
      if (Math.hypot(x, z) - w / 2 - 3 < CABIN.halfZ + 2) continue;
      const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(0.2, 0.23, 0.28), transparent: true, opacity: 0.1 + R() * 0.06, depthWrite: false, fog: true });
      const s = new THREE.Sprite(mat);
      s.scale.set(w, w * 0.28, 1);
      const y = terrainHeight(x, z) + creekCarve(x, z) + w * 0.06;
      s.position.set(x, y, z);
      s.userData = { x, z, y, ph: R() * 6, base: mat.opacity };
      s.renderOrder = 2;
      group.add(s);
      mists.push(s);
    }
  }

  // ---------------------------------------------------------------- rain
  const rain = buildRain(quality);
  group.add(rain.mesh);

  function update(dt, time, flash = 0) {
    U.uTime.value = time;
    U.uWind.value = 1 + 0.4 * Math.sin(time * 0.11);
    if (water) { water.material.normalMap.offset.y = -time * 0.05; water.material.normalMap.offset.x = Math.sin(time * 0.2) * 0.02; }
    for (const s of mists) {
      const u = s.userData;
      s.position.x = u.x + Math.sin(time * 0.03 + u.ph) * 1.5;
      s.position.z = u.z + Math.cos(time * 0.025 + u.ph) * 1.0;
      s.material.opacity = u.base * (1 + 0.15 * Math.sin(time * 0.1 + u.ph)) * (1 + flash * 2.5);
    }
    rain.update(time, flash);
    // the distant layer is unfogged; keep it a shade darker than the fog, including during lightning
    if (scene.fog) for (const m of treelineMats) m.color.copy(scene.fog.color).multiplyScalar(m.userData.k);
  }

  // Replace the built-in rocks with the Blender rock family (assets/models/rocks.glb). Returns true if used.
  function useRocks(models, params = {}) {
    if (!models || !rockData) return false;
    const suffix = high ? '' : '_lod1';
    const variants = [];
    for (let i = 0; models.has(`rock_${i}`); i++) variants.push(models.get(`rock_${i}${suffix}`) || models.get(`rock_${i}`));
    if (!variants.length) return false;
    const src = variants[0].material;
    const mat = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap,
      roughness: 1, metalness: 0, envMap: env, envMapIntensity: 0.7 });
    mat.normalScale.copy(src.normalScale); // the loader knows the file's normal-map convention
    addRockDetail(mat, params.game || {});
    if (rockData.im) { group.remove(rockData.im); rockData.im.geometry.dispose(); rockData.im.material.dispose(); }
    const jitter = params.game?.tintJitter ?? 0.12;
    const buckets = variants.map(() => []);
    rockData.list.forEach((m, i) => buckets[i % variants.length].push(m));
    const c = new THREE.Color();
    const meshes = [];
    variants.forEach((v, k) => {
      const im = mkInst(v.geometry, mat, buckets[k], `rocks-${k}`, rockData.cast);
      if (!im) return;
      im.receiveShadow = quality.shadows;
      for (let i = 0; i < buckets[k].length; i++) {
        const t = 1 + (R() - 0.5) * 2 * jitter;
        im.setColorAt(i, c.setRGB(t, t * (1 + (R() - 0.5) * 0.04), t * (1 + (R() - 0.5) * 0.05)));
      }
      im.instanceColor.needsUpdate = true;
      meshes.push(im);
    });
    rockData = { ...rockData, im: null, meshes };
    return true;
  }

  return { group, update, rain: rain.mesh, useRocks };
}

// Close-up sharpness for the baked rocks: a small tiling grain (normal + brightness) on top of the atlas.
// The atlas packs every rock's islands at the same scale, so one repeat count gives one grain size everywhere.
function addRockDetail(mat, g) {
  const detail = T.rockDetail();
  const repeat = g.detailRepeat ?? 48, strength = g.detailStrength ?? 0.6, grain = g.detailGrain ?? 0.35;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uDetailK = { value: new THREE.Vector3(repeat, strength, grain) };
    sh.fragmentShader = 'uniform sampler2D uDetail;\nuniform vec3 uDetailK;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 rockDet = texture2D(uDetail, vMapUv * uDetailK.x).xyz;
        diffuseColor.rgb *= 1.0 + (rockDet.z - 0.5) * 2.0 * uDetailK.z;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps
        .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n  mapN.xy += (rockDet.xy * 2.0 - 1.0) * uDetailK.y;'));
  };
  mat.customProgramCacheKey = () => 'rockDetail';
}

// ------------------------------------------------------------------ shed
function buildShed(quality, env) {
  const g = new THREE.Group();
  g.name = 'shed';
  const R = T.rng(909);
  const wt = T.woodExterior(), rt = T.roofShingles();
  const wallMat = new THREE.MeshStandardMaterial({ map: wt.map, normalMap: wt.normalMap, roughnessMap: wt.roughnessMap, roughness: 1, envMap: env, envMapIntensity: 0.5, color: 0xb0aaa0 });
  const roofMat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughnessMap: rt.roughnessMap, roughness: 1, envMap: env, envMapIntensity: 0.7 });
  const walls = [], roof = [];
  const W = 2.6, D = 2.1, Hf = 2.2, Hb = 1.75;
  const hAt = (z) => Hf + (Hb - Hf) * ((z + D / 2) / D);
  const board = (x, z, w, h, along, depth = 0.03) => {
    const geo = along === 'x' ? new THREE.BoxGeometry(w, h, depth) : new THREE.BoxGeometry(depth, h, w);
    geo.translate(x, h / 2, z);
    walls.push(geo);
  };
  // front (z = -D/2, faces the cabin side once rotated) and back: boards along x
  for (const zs of [-1, 1]) {
    for (let x = -W / 2 + 0.1; x < W / 2; x += 0.2) {
      const z = zs * D / 2;
      const door = zs < 0 && x > -0.35 && x < 0.55;
      if (door) continue;
      if (R() < 0.08) continue; // missing board
      board(x, z, 0.18, hAt(z) - (R() < 0.15 ? R() * 0.6 : 0), 'x');
    }
  }
  for (const xs of [-1, 1]) {
    for (let z = -D / 2 + 0.1; z < D / 2; z += 0.2) {
      if (R() < 0.08) continue;
      board(xs * W / 2, z, 0.18, hAt(z) - 0.02, 'z');
    }
  }
  // frame + hanging door
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) { const b = new THREE.BoxGeometry(0.1, hAt(z), 0.1); b.translate(x, hAt(z) / 2, z); walls.push(b); }
  { const b = new THREE.BoxGeometry(W, 0.1, 0.08); b.translate(0, Hf - 0.05, -D / 2 - 0.02); walls.push(b); }
  { const b = new THREE.BoxGeometry(0.85, 1.75, 0.04); b.translate(0.42, 0.88, 0); b.rotateY(-1.1); b.rotateZ(0.06); b.translate(-0.37, 0.05, -D / 2 - 0.03); walls.push(b); }
  // roof: two sagging planes with a hole
  {
    const len = Math.hypot(D + 0.5, Hf - Hb);
    const geo = new THREE.PlaneGeometry(W + 0.5, len, 8, 6);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -0.12 * (1 - (2 * x / (W + 0.5)) ** 2) * (1 - (2 * y / len) ** 2)); }
    geo.rotateX(-Math.PI / 2 + Math.atan2(Hf - Hb, D + 0.5));
    geo.translate(0, (Hf + Hb) / 2 + 0.03, 0);
    // remove a few triangles for a hole
    const idx = Array.from(geo.index.array), keep = [];
    for (let t = 0; t < idx.length; t += 3) { if (t / 3 >= 52 && t / 3 < 58) continue; keep.push(idx[t], idx[t + 1], idx[t + 2]); }
    geo.setIndex(keep);
    roof.push(geo);
    const under = geo.clone(); under.translate(0, -0.03, 0);
    // flip the underside
    const ui = under.index.array; for (let t = 0; t < ui.length; t += 3) { const tmp = ui[t]; ui[t] = ui[t + 1]; ui[t + 1] = tmp; }
    under.computeVertexNormals();
    roof.push(under);
  }
  const wallsGeo = mergeSimple(walls), roofGeo = mergeSimple(roof);
  wallsGeo.computeVertexNormals();
  uvWorld(wallsGeo, wt.tile, 'y');
  roofGeo.computeVertexNormals();
  uvWorld(roofGeo, rt.tile, 'h');
  const wm = new THREE.Mesh(wallsGeo, wallMat), rm = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial().copy(roofMat));
  rm.material.side = THREE.DoubleSide;
  for (const m of [wm, rm]) { m.castShadow = !!quality.moonShadows; m.receiveShadow = !!quality.shadows; g.add(m); }
  const P = LANDMARKS.shed.position;
  g.position.set(P.x, terrainHeight(P.x, P.z) - 0.1, P.z);
  g.rotation.set(0.03, LANDMARKS.shed.rotationY, 0.07); // leaning
  return g;
}

// ------------------------------------------------------------------ rain
// Line streaks animated in the vertex shader. Volume around the cabin, nothing under the roof.
function buildRain(quality) {
  const n = quality.rainDrops;
  const R = T.rng(55);
  const pos = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2), seed = new Float32Array(n * 2);
  const ex = CABIN.halfX + CABIN.wallThickness + CABIN.eaveOverhang + 0.15, ez = CABIN.halfZ + CABIN.wallThickness + CABIN.eaveOverhang + 0.15;
  let k = 0;
  while (k < n) {
    // denser close to the walls (where the windows are), thinner far out
    const a = R() * Math.PI * 2, r = 3 + Math.pow(R(), 1.6) * 16;
    const x = Math.cos(a) * r * 1.0, z = Math.sin(a) * r * 1.15;
    if (Math.abs(x) < ex && Math.abs(z) < ez) continue;
    const y = R() * 9, s = R();
    for (let e = 0; e < 2; e++) { const i = k * 2 + e; pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; end[i] = e; seed[i] = s; }
    k++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 30);
  const wins = WINDOWS.map((w) => w.center.clone().addScaledVector(w.normal, 0.5));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlash: { value: 0 }, uWin: { value: wins }, uWind: { value: new THREE.Vector2(0.35, 0.15) },
    }]),
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform vec2 uWind;
      attribute float aEnd;
      attribute float aSeed;
      varying float vEnd;
      varying vec3 vWorld;
      varying float vDist;
      #include <fog_pars_vertex>
      void main() {
        float speed = 7.5 + aSeed * 2.5;
        float y = mod(position.y - uTime * speed, 9.0) - 2.0;
        vec3 p = vec3(position.x, y, position.z);
        p.xz += uWind * (y + 2.0) * 0.15;
        float len = 0.32 + aSeed * 0.2;
        p.y += aEnd * len;
        p.xz += aEnd * len * uWind * 0.15;
        vEnd = aEnd;
        vWorld = p;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        vDist = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uFlash;
      uniform vec3 uWin[3];
      varying float vEnd;
      varying vec3 vWorld;
      varying float vDist;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float warm = 0.0;
        for (int i = 0; i < 3; i++) warm += smoothstep(2.6, 0.2, distance(vWorld, uWin[i]));
        vec3 c = vec3(0.32, 0.36, 0.42) + vec3(0.9, 0.55, 0.25) * warm * 0.45 + vec3(1.0) * uFlash * 1.2;
        float a = (0.16 + 0.12 * warm + 0.4 * uFlash) * smoothstep(0.25, 1.2, vDist) * (0.4 + 0.6 * vEnd);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.name = 'rain';
  mesh.renderOrder = 3;
  return {
    mesh,
    update(time, flash) { mat.uniforms.uTime.value = time; mat.uniforms.uFlash.value = Math.min(1, flash); },
  };
}
