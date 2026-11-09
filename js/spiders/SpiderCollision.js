// What a spider can stand on and bump into: the terrain, the cabin's walls (with real holes where the windows are),
// the floor, the ceiling, the roof and the furniture. All of it is simple shapes built from Layout.js (boxes, planes,
// a height field), so a foot probe is a handful of ray tests: cheap enough for every foot of every spider on a phone.
//
//   probe(from, dir, maxDist)  -> { p, n, s, d } the first surface along the ray, or null
//   footProbe(target, up, reach) -> the surface under (or beside) a foot target, searched along the spider's -up
//   pushOutSphere(c, r)          -> moves a point out of walls, furniture, floor and ceiling (body collision)
//   pointInside(p, pad)          -> is this point inside solid geometry (used to fold knees away from walls)
import * as THREE from 'three';
import { CABIN, WINDOWS, DOOR, terrainHeight, roofHeight, roofNormal } from '../world/Layout.js';

const HX = CABIN.halfX, HZ = CABIN.halfZ, T = CABIN.wallThickness, H = CABIN.wallHeight;
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _o = new THREE.Vector3();

function box(minX, minY, minZ, maxX, maxY, maxZ, s) { return { min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ), s }; }

/** A wall slab with rectangular holes cut out, as a list of boxes. axis 'x': wall runs along x (north/south walls). */
function wallWithHoles(axis, fixed0, fixed1, from, to, holes) {
  const out = [];
  // holes: [{ a0, a1, y0, y1 }] along the wall
  const hs = holes.slice().sort((a, b) => a.a0 - b.a0);
  let a = from;
  const mk = (a0, a1, y0, y1) => {
    if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
    out.push(axis === 'x' ? box(a0, y0, fixed0, a1, y1, fixed1, 'wall') : box(fixed0, y0, a0, fixed1, y1, a1, 'wall'));
  };
  for (const h of hs) {
    mk(a, h.a0, CABIN.groundY, H + 0.2);           // full-height piece before the hole
    mk(h.a0, h.a1, CABIN.groundY, h.y0);            // under the hole (sill)
    mk(h.a0, h.a1, h.y1, H + 0.2);                  // over the hole (lintel)
    a = h.a1;
  }
  mk(a, to, CABIN.groundY, H + 0.2);
  return out;
}

export class SpiderCollision {
  constructor(colliders = []) {
    const holes = { north: [], south: [], east: [], west: [] };
    for (const w of WINDOWS) {
      const y0 = w.center.y - w.height / 2, y1 = w.center.y + w.height / 2;
      if (w.id === 'north') holes.north.push({ a0: w.center.x - w.width / 2, a1: w.center.x + w.width / 2, y0, y1 });
      else if (w.id === 'east') holes.east.push({ a0: w.center.z - w.width / 2, a1: w.center.z + w.width / 2, y0, y1 });
      else holes.west.push({ a0: w.center.z - w.width / 2, a1: w.center.z + w.width / 2, y0, y1 });
    }
    // the door is boarded shut: solid
    const E = T;   // walls run from the inner face outward by their thickness; corners overlap so there is no gap
    this.walls = [
      ...wallWithHoles('x', -HZ - E, -HZ, -HX - E, HX + E, holes.north),
      ...wallWithHoles('x', HZ, HZ + E, -HX - E, HX + E, holes.south),
      ...wallWithHoles('z', HX, HX + E, -HZ - E, HZ + E, holes.east),
      ...wallWithHoles('z', -HX - E, -HX, -HZ - E, HZ + E, holes.west),
    ];
    // furniture: the cabin gives floor footprints; tops are about table height unless given
    this.furniture = colliders.map((c) => box(c.minX, 0, c.minZ, c.maxX, c.maxY ?? 0.78, c.maxZ, 'furniture'));
    this.boxes = [...this.walls, ...this.furniture];
    this.door = DOOR;
  }

  static inside(x, z) { return Math.abs(x) < HX && Math.abs(z) < HZ; }

  /** Ground height under (x, z): the cabin floor inside, the terrain outside. */
  ground(x, z) { return SpiderCollision.inside(x, z) ? CABIN.floorY : terrainHeight(x, z); }

  /**
   * First surface hit along a ray. Returns { p, n, s, d } (point, outward normal, surface type, distance) or null.
   * s: 'ground' | 'floor' | 'ceiling' | 'wall' | 'roof' | 'furniture'
   */
  probe(from, dir, maxDist, out = {}) {
    let best = maxDist, hit = null;
    // boxes (walls with their window holes, furniture)
    for (const b of this.boxes) {
      const t = rayBox(from, dir, b, best, _n);
      if (t !== null && t < best) {
        best = t; hit = out;
        out.n = (out.n || new THREE.Vector3()).copy(_n);
        out.s = b.s;
        // a wall's inside face is still 'wall'; its outer face too
      }
    }
    // floor and ceiling (inside the cabin only)
    for (const [y, ny, s] of [[CABIN.floorY, 1, 'floor'], [H, -1, 'ceiling']]) {
      if (Math.abs(dir.y) < 1e-6) continue;
      const t = (y - from.y) / dir.y;
      if (t <= 0 || t >= best || dir.y * ny > 0) continue;
      const x = from.x + dir.x * t, z = from.z + dir.z * t;
      if (!SpiderCollision.inside(x, z)) continue;
      best = t; hit = out; out.n = (out.n || new THREE.Vector3()).set(0, ny, 0); out.s = s;
    }
    // roof (outside, from above): march the ray against the roof height
    const endY = from.y + dir.y * best;
    const tr = Math.max(from.y, endY) < H + 0.1 ? null : marchHeight(from, dir, best, (x, z) => (onRoof(x, z) ? roofHeight(x) : -Infinity));
    if (tr !== null && tr < best) {
      best = tr; hit = out;
      const x = from.x + dir.x * tr;
      out.n = (out.n || new THREE.Vector3()).copy(roofNormal(x)); out.s = 'roof';
    }
    // terrain (outside the cabin)
    const endX = from.x + dir.x * best, endZ = from.z + dir.z * best;
    const bothIn = SpiderCollision.inside(from.x, from.z) && SpiderCollision.inside(endX, endZ);
    const tt = bothIn ? null : marchHeight(from, dir, best, (x, z) => (SpiderCollision.inside(x, z) ? -Infinity : terrainHeight(x, z)));
    if (tt !== null && tt < best) {
      best = tt; hit = out;
      const x = from.x + dir.x * tt, z = from.z + dir.z * tt, e = 0.3;
      out.n = (out.n || new THREE.Vector3()).set(terrainHeight(x - e, z) - terrainHeight(x + e, z), 2 * e, terrainHeight(x, z - e) - terrainHeight(x, z + e)).normalize();
      out.s = 'ground';
    }
    if (!hit) return null;
    out.p = (out.p || new THREE.Vector3()).copy(from).addScaledVector(dir, best);
    out.d = best;
    return out;
  }

  /**
   * Where a foot lands near `target`: search along -up from a little above the surface the spider walks on; if
   * nothing is there (a ledge, the edge of the roof, the window hole), try towards the body, then sideways round a
   * corner (the foot wraps onto the next face). Returns { p, n, s } or null.
   */
  footProbe(target, up, reach, body, out = {}) {
    _o.copy(target).addScaledVector(up, reach * 0.6);
    _p.copy(up).negate();
    if (this.probe(_o, _p, reach * 1.6, out)) return out;
    // over an edge: reach back towards the body and down round the corner
    if (body) {
      _p.subVectors(body, target).normalize();
      _o.copy(target).addScaledVector(up, -reach * 0.5);
      if (this.probe(_o, _p, reach * 1.2, out)) return out;
    }
    return null;
  }

  /** Push a sphere (centre c, radius r) out of walls, furniture, the floor and the ceiling. Returns true if moved. */
  pushOutSphere(c, r) {
    let moved = false;
    for (const b of this.boxes) {
      const qx = Math.max(b.min.x, Math.min(c.x, b.max.x)), qy = Math.max(b.min.y, Math.min(c.y, b.max.y)), qz = Math.max(b.min.z, Math.min(c.z, b.max.z));
      const dx = c.x - qx, dy = c.y - qy, dz = c.z - qz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        c.x += dx * k; c.y += dy * k; c.z += dz * k;
      } else {
        // centre inside the box: out through the nearest face
        const ex = [c.x - b.min.x, b.max.x - c.x, c.y - b.min.y, b.max.y - c.y, c.z - b.min.z, b.max.z - c.z];
        let m = 0; for (let i = 1; i < 6; i++) if (ex[i] < ex[m]) m = i;
        if (m === 0) c.x = b.min.x - r; else if (m === 1) c.x = b.max.x + r;
        else if (m === 2) c.y = b.min.y - r; else if (m === 3) c.y = b.max.y + r;
        else if (m === 4) c.z = b.min.z - r; else c.z = b.max.z + r;
      }
      moved = true;
    }
    if (SpiderCollision.inside(c.x, c.z)) {
      if (c.y < CABIN.floorY + r * 0.5) { c.y = CABIN.floorY + r * 0.5; moved = true; }
      if (c.y > H - r * 0.5) { c.y = H - r * 0.5; moved = true; }
    }
    return moved;
  }

  /** Is a point inside a wall or a piece of furniture (with padding)? */
  pointInside(p, pad = 0) {
    for (const b of this.boxes) {
      if (p.x > b.min.x - pad && p.x < b.max.x + pad && p.y > b.min.y - pad && p.y < b.max.y + pad && p.z > b.min.z - pad && p.z < b.max.z + pad) return b;
    }
    return null;
  }
}

function onRoof(x, z) {
  const outer = HX + T + CABIN.eaveOverhang;
  return Math.abs(x) <= outer && Math.abs(z) <= HZ + T + 0.3;
}

/** Ray against a height field h(x, z): coarse march, then bisect. Returns distance or null. */
function marchHeight(from, dir, maxDist, h) {
  const steps = Math.min(24, Math.max(4, Math.ceil(maxDist / 0.15)));
  let prevT = 0, prevAbove = from.y - h(from.x, from.z) > 0;
  if (!prevAbove) return null;
  for (let i = 1; i <= steps; i++) {
    const t = (maxDist * i) / steps;
    const x = from.x + dir.x * t, y = from.y + dir.y * t, z = from.z + dir.z * t;
    const above = y - h(x, z) > 0;
    if (!above) {
      let a = prevT, b = t;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) / 2;
        if (from.y + dir.y * m - h(from.x + dir.x * m, from.z + dir.z * m) > 0) a = m; else b = m;
      }
      return (a + b) / 2;
    }
    prevT = t;
  }
  return null;
}

/** Slab test. Returns distance along the ray and writes the hit face normal, or null. */
function rayBox(o, d, b, maxT, nOut) {
  let t0 = 0, t1 = maxT, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z, mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
    if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return null; continue; }
    let ta = (mn - oa) / da, tb = (mx - oa) / da, s = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; axis = a; sign = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (axis < 0) return null;   // started inside the box
  nOut.set(0, 0, 0).setComponent(axis, sign);
  return t0;
}
