// The cabin: plank interior, weathered exterior skin, pitched shingle roof, posts and steps,
// three open window holes (frames and sills only; the lead adds glass and boards), boarded door,
// furniture and the ammo table with its supplies.
//
// Static geometry is built in world coordinates, given world-scale UVs (uvWorld) and merged per material,
// so the whole cabin is a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CABIN, WINDOWS, DOOR, AMMO_TABLE, LANTERN, FURNITURE, terrainHeight, roofHeight } from './Layout.js';
import * as T from './Textures.js';
import { interiorMaterial, limitShadow, CANDLE_COLOR, buildLanternModel } from './Lighting.js';

const HX = CABIN.halfX, HZ = CABIN.halfZ, WH = CABIN.wallHeight, WT = CABIN.wallThickness;
const LINING = 0.03;        // interior board lining thickness (inside face of every wall)
const SKIN_BOTTOM = -0.25;  // exterior skin goes a little below the floor
const EAVE_Y = WH + 0.2;    // exterior side walls meet the roof here
const ROOF_T = 0.12;        // roof slab thickness
const OPEN_MARGIN = 0.025;  // the wall hole is this much bigger than the window; jamb liners fill it

// ------------------------------------------------------------------ geometry helpers
// World-scale planar UVs. tile = metres per texture repeat [u, v]. grain picks which world axis runs along U
// ('h' = horizontal along the face, 'y' = vertical, 'z' = along z on up-facing faces).
export function uvWorld(geo, tile, grain = 'h', off = [0, 0], flipV = false) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let a, b;
    if (ax >= ay && ax >= az) { if (grain === 'y') { a = y; b = z; } else { a = z; b = y; } }
    else if (ay >= az) { if (grain === 'z') { a = z; b = x; } else { a = x; b = z; } }
    else { if (grain === 'y') { a = y; b = x; } else { a = x; b = y; } }
    if (flipV) b = -b;
    uv[i * 2] = (a + off[0]) / tile[0];
    uv[i * 2 + 1] = (b + off[1]) / tile[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function prep(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.clearGroups();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

class Builder {
  constructor(materials) { this.M = materials; this.buckets = new Map(); this.rand = T.rng(77); }
  put(key, geo) {
    if (!this.M[key]) throw new Error('no material ' + key);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(prep(geo));
    return geo;
  }
  // Box by size + centre (world), optional rotation (Euler) and extra matrix. Gets world UVs.
  box(key, sx, sy, sz, x, y, z, o = {}) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (o.rx || o.ry || o.rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)));
    g.translate(x, y, z);
    if (o.m) g.applyMatrix4(o.m);
    const tile = this.M[key].userData.tile || [1, 1];
    const off = o.off || (o.seamless ? [0, 0] : [this.rand() * 5, this.rand() * 5]);
    uvWorld(g, tile, o.grain || 'h', off, o.flipV);
    return this.put(key, g);
  }
  // Box by min/max corners.
  boxMM(key, x0, x1, y0, y1, z0, z1, o = {}) {
    return this.box(key, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o);
  }
  geo(key, g, o = {}) {
    if (o.m) g.applyMatrix4(o.m);
    if (o.uv !== false) uvWorld(g, this.M[key].userData.tile || [1, 1], o.grain || 'h', o.off || [this.rand() * 5, this.rand() * 5]);
    return this.put(key, g);
  }
  build(group, shadows) {
    for (const [key, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.M[key]);
      mesh.name = 'cabin-' + key;
      const sh = this.M[key].userData.shadow || (this.M[key].userData.interior ? 'point' : 'dir');
      mesh.castShadow = shadows && sh !== 'none';
      if (mesh.castShadow) limitShadow(mesh, sh);
      mesh.receiveShadow = shadows;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
  }
}

function std(t, extra = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({
    map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0,
  }, extra));
  m.normalScale.set(1, 1);
  m.userData.tile = t.tile;
  return m;
}

function makeMaterials() {
  const env = T.nightEnv();
  const M = {
    wallIn: interiorMaterial(std(T.woodWall())),
    floor: interiorMaterial(std(T.woodFloor())),
    ceiling: interiorMaterial(std(T.woodCeiling())),
    beam: interiorMaterial(std(T.woodBeam())),
    furn: interiorMaterial(std(T.woodFurniture())),
    iron: interiorMaterial(std(T.iron(), { metalness: 0.7 })),
    blanket: interiorMaterial(std(T.blanket(), { side: THREE.DoubleSide })),
    mattress: interiorMaterial(std(T.mattress())),
    rug: interiorMaterial(std(T.rug())),
    bark: interiorMaterial(std(T.bark())),
    endGrain: interiorMaterial(std(T.endGrain())),
    jar: interiorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.0 })),
    tin: interiorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 })),
    rope: interiorMaterial(std(T.rag(), { color: 0x7a5a3a })),
    wallOut: std(T.woodExterior(), { envMap: env, envMapIntensity: 0.6 }),
    trimOut: std(T.woodTrimExterior(), { envMap: env, envMapIntensity: 0.6 }),
    roof: std(T.roofShingles(), { envMap: env, envMapIntensity: 0.8 }),
    stone: std(T.rock(), { envMap: env, envMapIntensity: 0.5 }),
    ironOut: std(T.iron(), { metalness: 0.7, envMap: env, envMapIntensity: 0.6 }),
  };
  M.rope.userData.tile = [0.3, 0.3];
  for (const k of ['rug', 'jar', 'tin', 'rope', 'endGrain']) M[k].userData.shadow = 'none';
  M.jar.userData.tile = M.tin.userData.tile = [1, 1];
  M.rug.userData.tile = [FURNITURE.rug.maxX - FURNITURE.rug.minX, FURNITURE.rug.maxZ - FURNITURE.rug.minZ];
  return M;
}

// ------------------------------------------------------------------ walls
// A wall is described in its own frame: t = along the wall, y = up, n = outward depth from the inner face.
const WALLS = {
  north: { axis: 'z', sign: -1, half: HZ, along: HX },
  south: { axis: 'z', sign: 1, half: HZ, along: HX },
  east: { axis: 'x', sign: 1, half: HX, along: HZ },
  west: { axis: 'x', sign: -1, half: HX, along: HZ },
};
function wallBox(b, key, w, t0, t1, y0, y1, n0, n1, o = {}) {
  const a = w.sign * (w.half + n0), c = w.sign * (w.half + n1);
  if (w.axis === 'z') return b.boxMM(key, t0, t1, y0, y1, a, c, o);
  return b.boxMM(key, a, c, y0, y1, t0, t1, o);
}
// Rectangle minus holes (holes must not overlap along t).
function wallPanel(b, key, w, t0, t1, y0, y1, n0, n1, holes, o) {
  const hs = holes.slice().sort((p, q) => p.t0 - q.t0);
  let t = t0;
  for (const h of hs) {
    if (h.t0 > t) wallBox(b, key, w, t, h.t0, y0, y1, n0, n1, o);
    if (h.y0 > y0) wallBox(b, key, w, h.t0, h.t1, y0, h.y0, n0, n1, o);
    if (h.y1 < y1) wallBox(b, key, w, h.t0, h.t1, h.y1, y1, n0, n1, o);
    t = h.t1;
  }
  if (t < t1) wallBox(b, key, w, t, t1, y0, y1, n0, n1, o);
}

function windowHole(win) {
  const w = WALLS[win.id];
  const tc = w.axis === 'z' ? win.center.x : win.center.z;
  return { t0: tc - win.width / 2 - OPEN_MARGIN, t1: tc + win.width / 2 + OPEN_MARGIN, y0: win.center.y - win.height / 2 - OPEN_MARGIN, y1: win.center.y + win.height / 2 + OPEN_MARGIN, tc };
}

// ------------------------------------------------------------------ build
export function buildCabin(quality) {
  const group = new THREE.Group();
  group.name = 'cabin';
  const M = makeMaterials();
  const b = new Builder(M);
  const shadows = !!quality.shadows;

  // ---------------- holes
  const holes = { north: [], south: [], east: [], west: [] };
  for (const win of WINDOWS) holes[win.id].push(windowHole(win));
  const doorHole = { t0: DOOR.center.x - DOOR.width / 2 - OPEN_MARGIN, t1: DOOR.center.x + DOOR.width / 2 + OPEN_MARGIN, y0: -1, y1: DOOR.height + OPEN_MARGIN };
  holes.south.push(doorHole);

  // ---------------- walls: interior lining + exterior skin
  for (const id of Object.keys(WALLS)) {
    const w = WALLS[id];
    wallPanel(b, 'wallIn', w, -w.along, w.along, 0, WH, 0, LINING, holes[id], { seamless: true });
    const outerAlong = w.along + WT;
    wallPanel(b, 'wallOut', w, -outerAlong, outerAlong, SKIN_BOTTOM, EAVE_Y, LINING, WT, holes[id].map((h) => ({ ...h, y0: Math.max(h.y0, SKIN_BOTTOM) })), { seamless: true, grain: 'y' });
  }
  // gables (north and south), following the roof underside
  for (const id of ['north', 'south']) {
    const w = WALLS[id];
    const ox = HX + WT;
    const shape = new THREE.Shape();
    const under = (x) => roofHeight(x) - ROOF_T / Math.cos(Math.atan((CABIN.ridgeY - EAVE_Y) / (HX + WT + CABIN.eaveOverhang)));
    shape.moveTo(-ox, EAVE_Y - 0.01);
    shape.lineTo(ox, EAVE_Y - 0.01);
    shape.lineTo(ox, under(ox));
    shape.lineTo(0, under(0));
    shape.lineTo(-ox, under(-ox));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: WT - LINING, bevelEnabled: false });
    const zStart = w.sign > 0 ? HZ + LINING : -(HZ + WT);
    g.translate(0, 0, zStart);
    b.geo('wallOut', g, { grain: 'y', off: [0, 0] });
  }
  // exterior corner boards
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (HX + WT), z = sz * (HZ + WT);
    b.boxMM('trimOut', x - 0.02 * sx, x + 0.03 * sx, SKIN_BOTTOM, EAVE_Y, z - 0.13 * sz, z + 0.03 * sz, { grain: 'y' });
    b.boxMM('trimOut', x - 0.13 * sx, x + 0.03 * sx, SKIN_BOTTOM, EAVE_Y, z - 0.02 * sz, z + 0.03 * sz, { grain: 'y' });
  }
  // sill beam / skirting along the bottom outside, and the underside
  for (const id of Object.keys(WALLS)) {
    const w = WALLS[id];
    wallBox(b, 'trimOut', w, -(w.along + WT + 0.03), w.along + WT + 0.03, SKIN_BOTTOM - 0.02, SKIN_BOTTOM + 0.18, WT, WT + 0.035, { grain: 'h' });
  }
  b.boxMM('trimOut', -HX - WT, HX + WT, SKIN_BOTTOM, SKIN_BOTTOM + 0.05, -HZ - WT, HZ + WT, {});

  // ---------------- floor, ceiling, beams, posts
  b.boxMM('floor', -HX, HX, -0.08, 0, -HZ, HZ, { grain: 'z', seamless: true });
  b.boxMM('ceiling', -HX, HX, WH, WH + 0.04, -HZ, HZ, { grain: 'x', seamless: true });
  const beamZ = [];
  for (let z = LANTERN.position.z - 3 * 1.6; z < HZ; z += 1.6) if (z > -HZ + 0.2 && z < HZ - 0.2) beamZ.push(z);
  for (const z of beamZ) b.box('beam', 2 * HX, 0.18, 0.12, 0, WH - 0.09, z, { grain: 'x' });
  for (const sx of [-1, 1]) b.boxMM('beam', sx * (HX - 0.1), sx * HX, WH - 0.15, WH, -HZ, HZ, { grain: 'z' }); // wall plates
  for (const sx of [-1, 1]) b.boxMM('beam', -HX, HX, WH - 0.15, WH, sx * (HZ - 0.1), sx * HZ, { grain: 'x' });
  // corner posts and studs under beam ends (skipping window openings)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.boxMM('beam', sx * (HX - 0.13), sx * HX, 0, WH, sz * (HZ - 0.13), sz * HZ, { grain: 'y' });
  for (const id of ['east', 'west']) {
    const w = WALLS[id];
    for (const z of beamZ) {
      const blocked = holes[id].some((h) => z + 0.2 > h.t0 - 0.12 && z - 0.2 < h.t1 + 0.12);
      if (blocked) continue;
      b.boxMM('beam', w.sign * (HX - 0.11), w.sign * HX, 0, WH - 0.15, z - 0.06, z + 0.06, { grain: 'y' });
    }
  }
  // baseboards
  for (const id of Object.keys(WALLS)) {
    const w = WALLS[id];
    const hs = id === 'south' ? [doorHole] : [];
    wallPanel(b, 'beam', w, -w.along, w.along, 0, 0.1, -0.02, 0, hs, { grain: 'h' });
  }

  // ---------------- roof
  const outer = HX + WT + CABIN.eaveOverhang;
  const rise = CABIN.ridgeY - EAVE_Y;
  const theta = Math.atan2(rise, outer);
  const slopeLen = Math.hypot(outer, rise) + 0.04;
  const roofZ = HZ + WT + CABIN.eaveOverhang;
  for (const s of [-1, 1]) {
    const mx = s * outer / 2, my = (CABIN.ridgeY + EAVE_Y) / 2;
    const cx = mx - s * Math.sin(theta) * ROOF_T / 2, cy = my - Math.cos(theta) * ROOF_T / 2;
    b.box('roof', slopeLen, ROOF_T, roofZ * 2, cx, cy, 0, { rz: -s * theta, grain: 'z', flipV: s > 0, off: [0, s > 0 ? 0.3 : 0.7] });
    // fascia at the eave and barge boards along the gables
    const ex = s * (outer + 0.01), ey = EAVE_Y - ROOF_T * 0.6;
    b.box('trimOut', 0.04, 0.2, roofZ * 2 + 0.06, ex, ey, 0, { rz: -s * theta * 0.0, grain: 'z' });
    for (const sz of [-1, 1]) b.box('trimOut', slopeLen, 0.2, 0.04, cx + s * Math.sin(theta) * 0.02, cy - 0.04, sz * (roofZ + 0.02), { rz: -s * theta, grain: 'x' });
  }
  // ridge cap
  for (const s of [-1, 1]) b.box('trimOut', 0.2, 0.035, roofZ * 2 + 0.06, s * 0.085, CABIN.ridgeY + 0.012 - 0.03, 0, { rz: -s * theta, grain: 'z' });

  // ---------------- foundation posts and steps
  for (const x of [-HX, 0, HX]) for (const z of [-HZ, -HZ / 3, HZ / 3, HZ]) {
    const gx = x * (HX + WT - 0.15) / HX, gz = z * (HZ + WT - 0.15) / HZ;
    const gy = terrainHeight(gx, gz) - 0.15;
    b.boxMM('stone', gx - 0.17, gx + 0.17, gy, SKIN_BOTTOM, gz - 0.17, gz + 0.17, {});
  }
  {
    const x0 = DOOR.center.x - 0.65, x1 = DOOR.center.x + 0.65, z0 = HZ + WT;
    const g1 = terrainHeight(DOOR.center.x, z0 + 0.9);
    b.boxMM('trimOut', x0, x1, -0.17, -0.12, z0, z0 + 0.36, { grain: 'x' });
    b.boxMM('trimOut', x0, x1, (g1 - 0.12 + -0.17) / 2 - 0.03, (g1 - 0.12 + -0.17) / 2 + 0.02, z0 + 0.36, z0 + 0.7, { grain: 'x' });
    for (const x of [x0 + 0.05, x1 - 0.05]) b.boxMM('trimOut', x - 0.03, x + 0.03, g1 - 0.2, -0.12, z0, z0 + 0.72, { grain: 'z' });
  }

  // ---------------- windows: jamb liners, casings, sills (each its own object so the lead can tint it)
  const windowFrames = {};
  const frameMatIn = M.furn, frameMatOut = M.trimOut;
  for (const win of WINDOWS) {
    const w = WALLS[win.id];
    const h = windowHole(win);
    const hw = win.width / 2, hh = win.height / 2, tc = h.tc, yc = win.center.y;
    const fb = new Builder({ fin: frameMatIn, fout: frameMatOut });
    const W = (key, t0, t1, y0, y1, n0, n1, o) => wallBox(fb, key, w, t0, t1, y0, y1, n0, n1, o);
    // jamb liners inside the hole (through the whole wall thickness)
    W('fin', tc - hw - OPEN_MARGIN, tc - hw, yc - hh - OPEN_MARGIN, yc + hh + OPEN_MARGIN, -0.005, WT + 0.005, { grain: 'y' });
    W('fin', tc + hw, tc + hw + OPEN_MARGIN, yc - hh - OPEN_MARGIN, yc + hh + OPEN_MARGIN, -0.005, WT + 0.005, { grain: 'y' });
    W('fin', tc - hw, tc + hw, yc + hh, yc + hh + OPEN_MARGIN, -0.005, WT + 0.005, {});
    W('fin', tc - hw, tc + hw, yc - hh - OPEN_MARGIN, yc - hh, -0.005, WT + 0.005, {});
    // interior casing
    const cw = 0.09;
    W('fin', tc - hw - OPEN_MARGIN - cw, tc - hw - OPEN_MARGIN, yc - hh - 0.04, yc + hh + OPEN_MARGIN, -0.022, 0, { grain: 'y' });
    W('fin', tc + hw + OPEN_MARGIN, tc + hw + OPEN_MARGIN + cw, yc - hh - 0.04, yc + hh + OPEN_MARGIN, -0.022, 0, { grain: 'y' });
    W('fin', tc - hw - OPEN_MARGIN - cw - 0.03, tc + hw + OPEN_MARGIN + cw + 0.03, yc + hh + OPEN_MARGIN, yc + hh + OPEN_MARGIN + 0.12, -0.026, 0, {});
    // stool (inner sill) and apron
    W('fin', tc - hw - 0.14, tc + hw + 0.14, yc - hh - 0.04, yc - hh, -0.08, 0, {});
    W('fin', tc - hw - OPEN_MARGIN - cw, tc + hw + OPEN_MARGIN + cw, yc - hh - 0.15, yc - hh - 0.04, -0.02, 0, {});
    // exterior casing + sloped sill
    W('fout', tc - hw - OPEN_MARGIN - 0.1, tc - hw - OPEN_MARGIN, yc - hh - 0.02, yc + hh + OPEN_MARGIN, WT, WT + 0.025, { grain: 'y' });
    W('fout', tc + hw + OPEN_MARGIN, tc + hw + OPEN_MARGIN + 0.1, yc - hh - 0.02, yc + hh + OPEN_MARGIN, WT, WT + 0.025, { grain: 'y' });
    W('fout', tc - hw - 0.15, tc + hw + 0.15, yc + hh + OPEN_MARGIN, yc + hh + OPEN_MARGIN + 0.12, WT, WT + 0.03, {});
    W('fout', tc - hw - 0.16, tc + hw + 0.16, yc - hh - 0.06, yc - hh - OPEN_MARGIN + 0.005, WT - 0.03, WT + 0.08, {});
    const fg = new THREE.Group();
    fg.name = 'windowFrame-' + win.id;
    // own material instances so tinting one window does not tint the others
    fb.M = { fin: cloneMat(frameMatIn), fout: cloneMat(frameMatOut) };
    fb.build(fg, shadows);
    group.add(fg);
    windowFrames[win.id] = fg;
  }

  // ---------------- boarded door
  {
    const w = WALLS.south;
    const x0 = DOOR.center.x - DOOR.width / 2, x1 = DOOR.center.x + DOOR.width / 2, top = DOOR.height;
    const W = (key, t0, t1, y0, y1, n0, n1, o) => wallBox(b, key, w, t0, t1, y0, y1, n0, n1, o);
    // jambs + head
    W('beam', x0 - OPEN_MARGIN, x0, 0, top + OPEN_MARGIN, -0.005, WT + 0.005, { grain: 'y' });
    W('beam', x1, x1 + OPEN_MARGIN, 0, top + OPEN_MARGIN, -0.005, WT + 0.005, { grain: 'y' });
    W('beam', x0, x1, top, top + OPEN_MARGIN, -0.005, WT + 0.005, {});
    // door leaf: vertical boards (inside face) + outside face
    const nb = 5;
    for (let i = 0; i < nb; i++) {
      const a = x0 + (i / nb) * (x1 - x0), c = x0 + ((i + 1) / nb) * (x1 - x0) - 0.006;
      W('furn', a, c, 0.005, top - 0.005, 0.05, 0.09, { grain: 'y' });
    }
    W('wallOut', x0, x1, 0.005, top - 0.005, 0.09, 0.12, { grain: 'y' });
    // ledges and brace on the door leaf (inside)
    W('furn', x0 + 0.04, x1 - 0.04, 0.3, 0.42, 0.03, 0.05, {});
    W('furn', x0 + 0.04, x1 - 0.04, 1.55, 1.67, 0.03, 0.05, {});
    // casing
    W('beam', x0 - OPEN_MARGIN - 0.09, x0 - OPEN_MARGIN, 0, top + OPEN_MARGIN, -0.022, 0, { grain: 'y' });
    W('beam', x1 + OPEN_MARGIN, x1 + OPEN_MARGIN + 0.09, 0, top + OPEN_MARGIN, -0.022, 0, { grain: 'y' });
    W('beam', x0 - OPEN_MARGIN - 0.12, x1 + OPEN_MARGIN + 0.12, top + OPEN_MARGIN, top + OPEN_MARGIN + 0.12, -0.026, 0, {});
    // planks nailed across (inside), slightly crooked, with nail heads
    const boardsIn = [[0.45, 0.04], [1.05, -0.06], [1.62, 0.03], [0.85, 0.5]];
    for (const [y, rot] of boardsIn) {
      const len = rot > 0.3 ? 1.55 : 1.4;
      const g = new THREE.BoxGeometry(len, 0.14, 0.035);
      g.rotateZ(rot);
      g.translate(DOOR.center.x, y + 0.2 * (rot > 0.3 ? 1 : 0), HZ - 0.045);
      b.geo('furn', g, {});
      for (const s of [-1, 1]) {
        const nx = DOOR.center.x + s * Math.cos(rot) * (len / 2 - 0.12), ny = y + 0.2 * (rot > 0.3 ? 1 : 0) + s * Math.sin(rot) * (len / 2 - 0.12);
        for (const dy of [-0.035, 0.035]) b.box('iron', 0.014, 0.014, 0.01, nx, ny + dy, HZ - 0.066, {});
      }
    }
    // planks across outside (an X and a bar)
    for (const [y, rot] of [[1.0, 0.95], [1.0, -0.95], [1.4, 0.05]]) {
      const g = new THREE.BoxGeometry(rot === 0.05 ? 1.35 : 2.0, 0.14, 0.03);
      g.rotateZ(rot);
      g.translate(DOOR.center.x, y, HZ + WT + 0.04);
      b.geo('trimOut', g, {});
    }
  }

  // ---------------- furniture
  const colliders = [
    { minX: -HX - 0.6, maxX: -HX, minZ: -HZ - 0.6, maxZ: HZ + 0.6 },
    { minX: HX, maxX: HX + 0.6, minZ: -HZ - 0.6, maxZ: HZ + 0.6 },
    { minX: -HX - 0.6, maxX: HX + 0.6, minZ: -HZ - 0.6, maxZ: -HZ },
    { minX: -HX - 0.6, maxX: HX + 0.6, minZ: HZ, maxZ: HZ + 0.6 },
  ];

  // cot in the north-west corner
  {
    const C = FURNITURE.cot, x0 = -HX + 0.05, x1 = x0 + C.width, z0 = -HZ + 0.08, z1 = z0 + C.length, top = 0.4;
    for (const x of [x0 + 0.03, x1 - 0.03]) for (const z of [z0 + 0.03, z1 - 0.03]) b.box('furn', 0.06, top, 0.06, x, top / 2, z, { grain: 'y' });
    for (const x of [x0 + 0.03, x1 - 0.03]) b.boxMM('furn', x - 0.03, x + 0.03, top - 0.14, top, z0, z1, { grain: 'z' });
    for (const z of [z0 + 0.03, z1 - 0.03]) b.boxMM('furn', x0, x1, top - 0.14, top, z - 0.03, z + 0.03, {});
    b.boxMM('furn', x0 + 0.03, x1 - 0.03, 0.62, 0.7, z0, z0 + 0.05, {}); // headboard rail
    for (const x of [x0 + 0.03, x1 - 0.03]) b.box('furn', 0.06, 0.3, 0.06, x, 0.55, z0 + 0.03, { grain: 'y' });
    const mt = 0.12;
    const mg = new THREE.BoxGeometry(x1 - x0 - 0.06, mt, z1 - z0 - 0.08, 4, 1, 8);
    lumpy(mg, 0.012, 3);
    mg.translate((x0 + x1) / 2, top + mt / 2, (z0 + z1) / 2);
    b.geo('mattress', mg, {});
    // pillow
    const pg = new THREE.SphereGeometry(1, 14, 8); pg.scale(0.26, 0.06, 0.16); lumpy(pg, 0.01, 7);
    pg.translate((x0 + x1) / 2, top + mt + 0.04, z0 + 0.25);
    b.geo('mattress', pg, {});
    // blanket draped over the foot two thirds
    const bw = 0.95, bl = 1.45, half = (x1 - x0 - 0.06) / 2, cx = (x0 + x1) / 2, bz1 = z1 + 0.06;
    const bg = new THREE.PlaneGeometry(bw, bl, 24, 30);
    bg.rotateX(-Math.PI / 2);
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      const surf = top + mt + 0.012;
      const wr = 0.012 * Math.sin(x * 23 + z * 7) + 0.01 * Math.sin(z * 17 - x * 5);
      let y = surf + wr;
      const ax = Math.abs(x);
      if (ax > half) { const d = ax - half; x = Math.sign(x) * (half + 0.015 + d * 0.08); y = surf - d * 1.05 + wr * 0.5; }
      const zz = bz1 - bl / 2 + z; // world z of this vertex (plane centred on bz1 - bl/2)
      if (zz > z1 - 0.02) { const d = zz - (z1 - 0.02); y = Math.min(y, surf - d * 4); p.setZ(i, z - d * 0.9); }
      if (z < -bl / 2 + 0.12) y += 0.02 * (1 - (z + bl / 2) / 0.12) + 0.01; // folded-back top edge
      p.setX(i, x); p.setY(i, y);
    }
    bg.computeVertexNormals();
    bg.translate(cx, 0, bz1 - bl / 2);
    b.geo('blanket', bg, {});
    colliders.push({ minX: x0 - 0.02, maxX: x1 + 0.02, minZ: z0, maxZ: z1 + 0.06 });
  }

  // wood stove in the north-east corner, pipe through the roof
  {
    const cx = HX - FURNITURE.stove.inset, cz = -HZ + FURNITURE.stove.inset, sx = 0.5, sz = 0.62, legH = 0.14, bodyH = 0.5;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) b.box('iron', 0.05, legH, 0.05, cx + dx * (sx / 2 - 0.05), legH / 2, cz + dz * (sz / 2 - 0.06), {});
    b.box('iron', sx, bodyH, sz, cx, legH + bodyH / 2, cz, {});
    b.box('iron', sx + 0.06, 0.03, sz + 0.06, cx, legH + bodyH + 0.015, cz, {});
    b.box('iron', sx + 0.02, 0.025, sz + 0.02, cx, legH + 0.012, cz, {});
    // door on the west face, handle, ash lip
    b.box('iron', 0.02, 0.28, 0.32, cx - sx / 2 - 0.01, legH + 0.26, cz, {});
    b.box('iron', 0.04, 0.02, 0.07, cx - sx / 2 - 0.035, legH + 0.32, cz + 0.12, {});
    b.box('iron', 0.08, 0.02, sz * 0.8, cx - sx / 2 - 0.04, legH + 0.02, cz, {});
    const pipeTop = WH + 0.04;
    const pg = new THREE.CylinderGeometry(0.065, 0.065, pipeTop - (legH + bodyH + 0.03), 16, 1, true);
    pg.translate(cx, (pipeTop + legH + bodyH + 0.03) / 2, cz + 0.1);
    b.geo('iron', pg, {});
    b.geo('iron', new THREE.CylinderGeometry(0.075, 0.075, 0.05, 16).translate(cx, legH + bodyH + 0.05, cz + 0.1), {});
    b.geo('iron', new THREE.CylinderGeometry(0.16, 0.16, 0.01, 16).translate(cx, WH - 0.005, cz + 0.1), {});
    // outside: through the roof
    const ry = roofHeight(cx);
    b.geo('ironOut', new THREE.CylinderGeometry(0.075, 0.075, 0.9, 16, 1, true).translate(cx, ry + 0.35, cz + 0.1), {});
    b.geo('ironOut', new THREE.ConeGeometry(0.16, 0.12, 16, 1, true).translate(cx, ry + 0.86, cz + 0.1), {});
    b.geo('ironOut', new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16).translate(cx, ry + 0.02, cz + 0.1), {});
    // firewood stack beside it, along the north wall
    const R = T.rng(5);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5 - row; k++) {
      const r = 0.055 + R() * 0.02, len = 0.42 + R() * 0.08;
      const x = cx - 0.62 - (row * 0.06) + k * 0.13 - 0.25, y = r + row * 0.11, z = -HZ + 0.3 + (R() - 0.5) * 0.04;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, R() * 6, 0)), new THREE.Vector3(1, 1, 1));
      b.geo('bark', new THREE.CylinderGeometry(r, r * 1.05, len, 7, 1, true), { m, grain: 'y' });
      for (const s of [-1, 1]) {
        const c = new THREE.CircleGeometry(r, 7).rotateX(s * -Math.PI / 2).translate(0, s * len / 2, 0);
        c.applyMatrix4(m);
        b.geo('endGrain', c, { uv: false });
      }
    }
    colliders.push({ minX: cx - 1.0, maxX: HX, minZ: -HZ, maxZ: cz + sz / 2 + 0.05 });
  }

  // shelves on the east wall (south part) with jars and tins
  {
    const { z0, z1 } = FURNITURE.shelves, depth = 0.28, x1 = HX - 0.005, x0 = HX - depth;
    for (const y of [0.95, 1.35, 1.75]) {
      b.boxMM('furn', x0, x1, y - 0.03, y, z0, z1, { grain: 'z' });
      for (const z of [z0 + 0.12, z1 - 0.12]) {
        const g = new THREE.BoxGeometry(0.035, 0.18, 0.035); g.rotateZ(-0.7); g.translate(HX - 0.09, y - 0.1, z);
        b.geo('furn', g, {});
      }
    }
    const R = T.rng(11);
    const jarCols = [0x2c3a24, 0x4a2c14, 0x3a3a2a, 0x5a4020, 0x223030];
    const tinCols = [0x5a2a20, 0x2a3a4a, 0x6a5a3a, 0x3a3a38, 0x7a6040];
    for (const y of [0.95, 1.35, 1.75]) {
      let z = z0 + 0.08;
      while (z < z1 - 0.1) {
        const t = R();
        if (t < 0.45) {
          const r = 0.04 + R() * 0.02, h = 0.12 + R() * 0.08;
          const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r, h * 0.82), new THREE.Vector2(r * 0.7, h * 0.9), new THREE.Vector2(r * 0.7, h), new THREE.Vector2(0, h)];
          const g = new THREE.LatheGeometry(pts, 12); g.translate(x0 + 0.12 + R() * 0.06, y, z + r);
          b.geo('jar', colorize(g, jarCols[Math.floor(R() * jarCols.length)]), {});
          z += r * 2 + 0.03;
        } else if (t < 0.85) {
          const r = 0.035 + R() * 0.02, h = 0.08 + R() * 0.07;
          const g = new THREE.CylinderGeometry(r, r, h, 14); g.translate(x0 + 0.1 + R() * 0.08, y + h / 2, z + r);
          b.geo('tin', colorize(g, tinCols[Math.floor(R() * tinCols.length)]), {});
          z += r * 2 + 0.03;
        } else {
          z += 0.12;
        }
      }
    }
    colliders.push({ minX: x0, maxX: HX, minZ: z0, maxZ: z1 });
  }

  // crates in the south-east corner
  {
    const crate = (x, y, z, s, ry) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
      b.box('furn', s, s * 0.8, s, 0, s * 0.4, 0, { m });
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) b.box('beam', 0.04, s * 0.8 + 0.01, 0.04, dx * (s / 2 - 0.01), s * 0.4, dz * (s / 2 - 0.01), { m, grain: 'y' });
    };
    crate(HX - 0.33, 0, HZ - 0.33, 0.56, 0.08);
    crate(HX - 0.35, 0.448, HZ - 0.32, 0.46, -0.2);
    crate(HX - 0.95, 0, HZ - 0.3, 0.44, 0.35);
    colliders.push({ minX: HX - 1.25, maxX: HX, minZ: HZ - 0.65, maxZ: HZ });
  }

  // rug
  const RUG = FURNITURE.rug;
  b.boxMM('rug', RUG.minX, RUG.maxX, 0.0, 0.012, RUG.minZ, RUG.maxZ, { off: [-RUG.minX, -RUG.minZ], seamless: true });

  // coat hooks with a coiled rope and a canvas bag (west wall, south of the window)
  {
    const { z0, z1, y } = FURNITURE.hooks;
    b.boxMM('beam', -HX, -HX + 0.025, y - 0.05, y + 0.05, z0, z1, { grain: 'z' });
    for (const z of [z0 + 0.15, (z0 + z1) / 2, z1 - 0.15]) {
      const g = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 6); g.rotateZ(Math.PI / 2 - 0.4); g.translate(-HX + 0.06, y + 0.015, z);
      b.geo('iron', g, {});
    }
    const coil = new THREE.TorusGeometry(0.13, 0.022, 8, 24); coil.scale(1, 1.25, 1); coil.rotateY(Math.PI / 2); lumpy(coil, 0.006, 3);
    coil.translate(-HX + 0.06, y - 0.15, z0 + 0.15);
    b.geo('rope', coil, {});
    const bag = new THREE.SphereGeometry(1, 12, 10); bag.scale(0.06, 0.2, 0.14); lumpy(bag, 0.01, 9); bag.translate(-HX + 0.08, y - 0.17, z1 - 0.15);
    b.geo('rope', bag, {});
  }

  // ---------------- ammo table (own group) with supplies and a lantern
  const ammoTable = buildAmmoTable(M, shadows);
  group.add(ammoTable.group);
  colliders.push({
    minX: AMMO_TABLE.position.x - AMMO_TABLE.size.x / 2 - 0.03, maxX: AMMO_TABLE.position.x + AMMO_TABLE.size.x / 2 + 0.03,
    minZ: AMMO_TABLE.position.z - AMMO_TABLE.size.z / 2 - 0.03, maxZ: HZ,
  });

  b.build(group, shadows);

  function floorTypeAt(x, z) {
    return x >= RUG.minX && x <= RUG.maxX && z >= RUG.minZ && z <= RUG.maxZ ? 'rug' : 'wood';
  }

  return { group, colliders, floorTypeAt, ammoTable: { group: ammoTable.group, supplies: ammoTable.supplies }, windowFrames, candle: ammoTable.candle };
}

function cloneMat(m) {
  const c = m.clone();
  c.userData = { ...m.userData };
  if (m.userData.interior) interiorMaterial(c);
  return c;
}

// Displace vertices along their normals with a little smooth noise.
function lumpy(geo, amount, seed) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = amount * (Math.sin(x * 31 + seed) * Math.cos(z * 27 - seed) + Math.sin(y * 41 + x * 13 + seed * 2) * 0.6);
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ ammo table
function buildAmmoTable(M, shadows) {
  const group = new THREE.Group();
  group.name = 'ammoTable';
  const P = AMMO_TABLE.position, S = AMMO_TABLE.size, top = S.h;
  const b = new Builder({ furn: M.furn, iron: M.iron });
  const x0 = P.x - S.x / 2, x1 = P.x + S.x / 2, z0 = P.z - S.z / 2, z1 = P.z + S.z / 2;
  // top made of 4 boards
  for (let i = 0; i < 4; i++) {
    const a = z0 + (i / 4) * S.z, c = z0 + ((i + 1) / 4) * S.z - 0.004;
    b.boxMM('furn', x0, x1, top - 0.045, top, a, c, {});
  }
  for (const x of [x0 + 0.08, x1 - 0.08]) for (const z of [z0 + 0.07, z1 - 0.07]) b.box('furn', 0.075, top - 0.045, 0.075, x, (top - 0.045) / 2, z, { grain: 'y' });
  b.boxMM('furn', x0 + 0.1, x1 - 0.1, top - 0.16, top - 0.045, z0 + 0.05, z0 + 0.075, {});
  b.boxMM('furn', x0 + 0.1, x1 - 0.1, top - 0.16, top - 0.045, z1 - 0.075, z1 - 0.05, {});
  for (const x of [x0 + 0.05, x1 - 0.075]) b.boxMM('furn', x, x + 0.025, top - 0.16, top - 0.045, z0 + 0.1, z1 - 0.1, { grain: 'z' });
  b.boxMM('furn', x0 + 0.1, x1 - 0.1, 0.16, 0.22, P.z - 0.03, P.z + 0.03, {}); // low stretcher
  for (const x of [x0 + 0.08, x1 - 0.08]) b.boxMM('furn', x - 0.025, x + 0.025, 0.16, 0.22, z0 + 0.1, z1 - 0.1, { grain: 'z' });
  b.build(group, shadows);

  // materials for small items
  const brass = interiorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.32 }));
  const blued = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.85, roughness: 0.4 }));
  const card = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.ammoBoxLabel(), roughness: 0.9 }));
  const cardPlain = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x4a4e34, roughness: 0.92 }));
  const ragM = interiorMaterial(new THREE.MeshStandardMaterial({ map: T.rag().map, roughness: 0.95 }));
  const canM = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x2f3a2a, metalness: 0.5, roughness: 0.55 }));
  const crateM = M.furn;

  const cartridge = cartridgeGeometry();
  // small items receive the lantern's shadows but do not cast (saves 6 cube-face draws each)
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = false; m.receiveShadow = shadows; return m; };
  const place = (o, x, z, ry = 0, y = 0) => { o.position.set(x, top + y, z); o.rotation.y = ry; group.add(o); return o; };
  const roundsLying = (n, seed, spread = 0.07) => {
    const R = T.rng(seed), list = [];
    for (let i = 0; i < n; i++) {
      const g = cartridge.clone();
      g.rotateZ(Math.PI / 2); g.translate(0, 0.0072, 0); g.rotateY(R() * Math.PI * 2);
      g.translate((R() - 0.5) * spread * 2, 0, (R() - 0.5) * spread);
      list.push(g);
    }
    return mesh(mergeGeometries(list), brass);
  };
  const ammoBox = (stand) => {
    const g = new THREE.BoxGeometry(0.16, 0.06, 0.1);
    const m = mesh(g, card);
    if (stand) { m.rotation.x = Math.PI / 2; m.position.y = 0.05; } else m.position.y = 0.03;
    const o = new THREE.Group(); o.add(m); return o;
  };

  const supplies = [];
  // 0 rag
  {
    const g = new THREE.IcosahedronGeometry(0.1, 3); g.scale(1.1, 0.22, 0.8); lumpy(g, 0.012, 4);
    supplies.push(place(mesh(g, ragM), x1 - 0.2, z1 - 0.16, 0.4, 0.018));
  }
  // 1 oil can
  {
    const pts = [[0, 0], [0.045, 0], [0.047, 0.004], [0.047, 0.07], [0.03, 0.095], [0.012, 0.1], [0.008, 0.13], [0, 0.13]].map((p) => new THREE.Vector2(p[0], p[1]));
    const body = new THREE.LatheGeometry(pts, 18);
    const spout = new THREE.CylinderGeometry(0.003, 0.007, 0.11, 8); spout.rotateZ(-1.0); spout.translate(0.045, 0.13, 0);
    const g = mergeGeometries([body.toNonIndexed(), spout.toNonIndexed()]);
    supplies.push(place(mesh(g, canM), x1 - 0.22, z0 + 0.17, 0.8));
  }
  // 2 wooden ammo crate with lid ajar
  {
    const cb = new Builder({ furn: crateM });
    cb.box('furn', 0.36, 0.17, 0.24, 0, 0.085, 0, {});
    cb.box('furn', 0.37, 0.025, 0.25, 0.02, 0.19, -0.03, { rx: -0.25 });
    const o = new THREE.Group(); cb.build(o, shadows);
    supplies.push(place(o, x0 + 0.42, z1 - 0.15, -0.06));
  }
  // 3, 4 standing ammo boxes, 5 a flat one
  supplies.push(place(ammoBox(true), P.x - 0.02, z1 - 0.1, 0.05));
  supplies.push(place(ammoBox(true), P.x + 0.13, z1 - 0.11, -0.12));
  supplies.push(place(ammoBox(false), P.x + 0.05, P.z - 0.02, 0.35));
  // 6 loose rounds
  supplies.push(place(roundsLying(6, 3), P.x - 0.2, z0 + 0.14, 0));
  // 7, 8 magazines lying flat (one with a round on top)
  const magazine = () => {
    const o = new THREE.Group();
    const body = mesh(new THREE.BoxGeometry(0.105, 0.022, 0.07), blued); body.position.y = 0.011; o.add(body);
    const lip = mesh(new THREE.BoxGeometry(0.02, 0.024, 0.05), blued); lip.position.set(0.055, 0.012, 0.0); o.add(lip);
    const r = cartridge.clone(); r.rotateZ(-Math.PI / 2); r.translate(-0.02, 0.026, 0.0);
    const rm = mesh(r, brass); rm.position.y = 0.0; o.add(rm);
    return o;
  };
  supplies.push(place(magazine(), P.x + 0.3, z0 + 0.12, 0.4));
  supplies.push(place(magazine(), P.x + 0.22, z0 + 0.24, -0.3));
  // 9 open ammo box with rounds standing in it
  {
    const o = new THREE.Group();
    const base = mesh(new THREE.BoxGeometry(0.16, 0.045, 0.1), cardPlain); base.position.y = 0.0225; o.add(base);
    const lid = mesh(new THREE.BoxGeometry(0.16, 0.004, 0.1), card); lid.position.set(0, 0.05, 0.075); lid.rotation.x = -1.2; o.add(lid);
    const list = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { if ((i * 3 + j) % 7 === 3) continue; const g = cartridge.clone(); g.translate(-0.06 + i * 0.03, 0.004, -0.03 + j * 0.03); list.push(g); }
    o.add(mesh(mergeGeometries(list), brass));
    supplies.push(place(o, x0 + 0.38, z0 + 0.18, 0.15));
  }

  // a hurricane lantern standing on the table (like the wall lamp, so points of interest share one look)
  const candle = {};
  {
    const cx = x0 + 0.14, cz = z1 - 0.14;
    const model = buildLanternModel({ standing: true });
    model.scale.setScalar(0.85);
    model.position.set(cx, top + 0.13 * 0.85, cz);
    group.add(model);
    const light = new THREE.PointLight(CANDLE_COLOR, 1.1, 4.5, 2);
    light.position.set(cx, top + 0.13 * 0.85, cz);
    group.add(light);
    candle.light = light; candle.sprite = model.userData.glow; candle.model = model;
  }

  return { group, supplies, candle };
}

// A rifle cartridge standing upright, base at y = 0 (vertex colours: brass case, copper bullet).
function cartridgeGeometry() {
  const s = 1.2; // slightly larger than life so it reads on a phone
  const prof = [[0, 0], [0.006, 0], [0.006, 0.0015], [0.0052, 0.002], [0.0058, 0.003], [0.0059, 0.048], [0.0046, 0.053], [0.0046, 0.063], [0.0043, 0.063], [0.0043, 0.07], [0.0028, 0.079], [0.0008, 0.083], [0, 0.083]];
  const g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0] * s, p[1] * s)), 10).toNonIndexed();
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const brass = new THREE.Color(0.85, 0.62, 0.3), copper = new THREE.Color(0.75, 0.38, 0.22);
  for (let i = 0; i < p.count; i++) { const c = p.getY(i) > 0.0632 * s ? copper : brass; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
