// Builds the surface paths spiders walk along: ground routes from the forest, climbs up walls,
// across the roof, and down onto a window. A path is a list of nodes { p, n, s }:
//   p = position on the surface, n = surface normal (the spider's "up"), s = surface type.
import * as THREE from 'three';
import { CABIN, ROUTES, terrainHeight, roofHeight, roofNormal } from '../world/Layout.js';

const UP = new THREE.Vector3(0, 1, 0);
export const WALL_OUT = CABIN.wallThickness + 0.03; // just off the outer wall face (window centres are on the inner face)

export function terrainNormal(x, z) {
  const e = 0.4;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return new THREE.Vector3(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
}

export function groundNode(x, z) {
  return { p: new THREE.Vector3(x, terrainHeight(x, z), z), n: terrainNormal(x, z), s: 'ground' };
}

/**
 * A ground route toward a window, densified to ~1.2 m steps, with lateral jitter.
 * zigzag: amplitude in metres of the side-to-side weave (runners weave a lot).
 * fromT: start partway along the route (0..1) — used for spawning closer.
 */
export function groundRoute(windowId, routeIndex, { zigzag = 0.25, fromT = 0, toT = 1 } = {}) {
  const routes = ROUTES[windowId];
  const pts = routes[routeIndex % routes.length].map(([x, z]) => new THREE.Vector2(x, z));
  // total length
  const segLen = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); segLen.push(l); total += l; }
  const start = total * fromT, end = total * toT;
  const nodes = [];
  const phase = Math.random() * 10;
  const wave = 3 + Math.random() * 3;
  for (let d = start; d <= end + 1e-6; d += 1.2) {
    const { p, dir } = along(pts, segLen, d);
    const side = new THREE.Vector2(-dir.y, dir.x);
    // fade the weave out over the last 3 m so they arrive at the wall cleanly
    const fade = Math.min(1, (end - d) / 3);
    const off = (Math.sin(d / wave * Math.PI + phase) * zigzag + (Math.random() - 0.5) * zigzag * 0.4) * fade;
    nodes.push(groundNode(p.x + side.x * off, p.y + side.y * off));
  }
  return nodes;
}

function along(pts, segLen, d) {
  for (let i = 0; i < segLen.length; i++) {
    if (d <= segLen[i] || i === segLen.length - 1) {
      const t = Math.min(1, d / segLen[i]);
      const p = pts[i].clone().lerp(pts[i + 1], t);
      const dir = pts[i + 1].clone().sub(pts[i]).normalize();
      return { p, dir };
    }
    d -= segLen[i];
  }
}

/** Point on the outside wall face of a window's wall. u = metres along the wall (right of window seen from outside), y = height. */
export function wallPoint(win, u, y) {
  const n = win.normal;
  const tangent = new THREE.Vector3().crossVectors(UP, n); // along the wall
  return win.center.clone().addScaledVector(n, WALL_OUT).addScaledVector(tangent, u).setY(y);
}

/** From the end of a ground route (near the wall) up onto the wall to a slot on the window. */
export function climbToSlot(from, win, slot) {
  const n = win.normal.clone();
  const base = wallPoint(win, slot.u, CABIN.groundY + 0.05);
  base.y = Math.max(base.y, terrainHeight(base.x, base.z) + 0.02);
  return [
    { p: from.clone(), n: UP.clone(), s: 'ground' },
    { p: base.clone(), n: UP.clone(), s: 'ground' },
    { p: base.clone().setY(base.y + 0.15), n: n.clone(), s: 'wall' },
    { p: wallPoint(win, slot.u, slot.y - 0.35), n: n.clone(), s: 'wall' },
    { p: wallPoint(win, slot.u, slot.y), n: n.clone(), s: 'glass' },
  ];
}

/** Brute: walks to the base of the wall under the window and stands facing it. */
export function bruteSlot(from, win) {
  const p = win.center.clone().addScaledVector(win.normal, WALL_OUT + 0.85);
  p.y = terrainHeight(p.x, p.z);
  return [
    { p: from.clone(), n: UP.clone(), s: 'ground' },
    { p, n: terrainNormal(p.x, p.z), s: 'ground', face: win.normal.clone().negate() },
  ];
}

/**
 * Climber: climbs the wall to one side of the window, goes over the roof (east/west walls)
 * or up the gable (north wall), and comes down head-first onto the window.
 */
export function climberRoute(win, from) {
  const n = win.normal.clone();
  const side = Math.random() < 0.5 ? -1 : 1;
  const nodes = [];
  if (win.id === 'north') {
    const u = side * 1.9;
    const base = wallPoint(win, u, CABIN.groundY + 0.05);
    nodes.push({ p: from.clone(), n: UP.clone(), s: 'ground' });
    nodes.push({ p: base.clone(), n: UP.clone(), s: 'ground' });
    nodes.push({ p: base.clone().setY(base.y + 0.15), n: n.clone(), s: 'wall' });
    nodes.push({ p: wallPoint(win, u, 2.5), n: n.clone(), s: 'wall' });
    nodes.push({ p: wallPoint(win, side * 0.6, 3.25), n: n.clone(), s: 'wall' });
    nodes.push({ p: wallPoint(win, 0, 3.1), n: n.clone(), s: 'wall' });
    nodes.push({ p: wallPoint(win, 0, win.center.y + win.height / 2 + 0.2), n: n.clone(), s: 'wall' });
  } else {
    const sx = Math.sign(win.normal.x);
    const zW = win.center.z;
    let zC = zW + side * 2.2;
    if (Math.abs(zC) > CABIN.halfZ - 0.5) zC = zW - side * 2.2;
    const outerX = sx * (CABIN.halfX + WALL_OUT);
    const eaveX = sx * (CABIN.halfX + CABIN.wallThickness + CABIN.eaveOverhang + 0.02);
    const roofX = sx * (CABIN.halfX - 0.4);
    const rn = roofNormal(roofX);
    const edgeN = n.clone().add(UP).normalize();
    const base = new THREE.Vector3(outerX, Math.max(CABIN.groundY + 0.05, terrainHeight(outerX, zC) + 0.02), zC);
    nodes.push({ p: from.clone(), n: UP.clone(), s: 'ground' });
    nodes.push({ p: base.clone(), n: UP.clone(), s: 'ground' });
    nodes.push({ p: base.clone().setY(base.y + 0.15), n: n.clone(), s: 'wall' });
    nodes.push({ p: new THREE.Vector3(outerX, CABIN.wallHeight - 0.05, zC), n: n.clone(), s: 'wall' });
    nodes.push({ p: new THREE.Vector3(eaveX, roofHeight(eaveX) + 0.02, zC), n: edgeN.clone(), s: 'roof' });
    nodes.push({ p: new THREE.Vector3(roofX, roofHeight(roofX), zC), n: rn.clone(), s: 'roof' });
    // wander along the roof toward the window, pausing above it
    const mid = (zC + zW) / 2 + (Math.random() - 0.5);
    nodes.push({ p: new THREE.Vector3(sx * 1.6, roofHeight(sx * 1.6), mid), n: roofNormal(sx * 1.6), s: 'roof' });
    nodes.push({ p: new THREE.Vector3(roofX, roofHeight(roofX), zW), n: rn.clone(), s: 'roof', pause: 1.5 + Math.random() * 3 });
    nodes.push({ p: new THREE.Vector3(eaveX, roofHeight(eaveX) + 0.02, zW), n: edgeN.clone(), s: 'roof' });
    nodes.push({ p: new THREE.Vector3(outerX, CABIN.wallHeight - 0.05, zW), n: n.clone(), s: 'wall' });
    nodes.push({ p: new THREE.Vector3(outerX, win.center.y + win.height / 2 + 0.2, zW), n: n.clone(), s: 'wall' });
  }
  return nodes;
}

/** Through a broken window into the room, ending on the floor. */
export function enterPath(from, fromN, win) {
  const n = win.normal;
  const sill = win.center.y - win.height / 2;
  return [
    { p: from.clone(), n: fromN.clone(), s: 'glass' },
    { p: win.center.clone().addScaledVector(n, WALL_OUT + 0.05).setY(sill + 0.05), n: UP.clone(), s: 'wall' },
    { p: win.center.clone().addScaledVector(n, -0.35).setY(sill + 0.02), n: UP.clone(), s: 'floor' },
    { p: win.center.clone().addScaledVector(n, -1.1).setY(0), n: UP.clone(), s: 'floor' },
  ];
}

export function pathLength(nodes) {
  let l = 0;
  for (let i = 0; i < nodes.length - 1; i++) l += nodes[i].p.distanceTo(nodes[i + 1].p);
  return l;
}
