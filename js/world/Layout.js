// Shared layout of the world. Every system reads positions from here so the cabin,
// forest, spiders, windows and audio all agree. Units are metres, +Y is up.
//
// Cabin interior: x from -3 to 3, z from -4 to 4. Floor at y = 0.
// The cabin stands on short posts, so the ground outside is at about y = -0.4.
//
//            north window (z = -4)
//          +-----------[ ]-----------+
//          |                         |
//  west    [ ]                       |
//  window  |                        [ ]  east window (x = +3)
//  (x=-3)  |                         |
//          |   ammo table            |
//          +----------------[door]---+   south wall (z = +4), door boarded shut
import * as THREE from 'three';

export const CABIN = {
  halfX: 3,            // interior half-width (x)
  halfZ: 4,            // interior half-depth (z)
  wallHeight: 2.6,     // interior wall height; ceiling at y = 2.6
  wallThickness: 0.16,
  floorY: 0,
  groundY: -0.4,       // outside ground level right next to the cabin
  eaveOverhang: 0.35,  // roof overhang beyond the outer walls
  ridgeY: 4.0,         // roof ridge height (ridge runs along z)
};

// Window openings. `normal` points OUTWARD (from the cabin into the forest).
// center is the middle of the opening, on the INNER face of the wall; the wall (CABIN.wallThickness)
// runs outward from there, so the outer face is at center + normal * wallThickness.
export const WINDOWS = [
  { id: 'north', label: 'North', center: new THREE.Vector3(0, 1.45, -CABIN.halfZ), normal: new THREE.Vector3(0, 0, -1), width: 1.1, height: 1.0 },
  { id: 'east',  label: 'East',  center: new THREE.Vector3(CABIN.halfX, 1.45, -1.2), normal: new THREE.Vector3(1, 0, 0), width: 1.1, height: 1.0 },
  { id: 'west',  label: 'West',  center: new THREE.Vector3(-CABIN.halfX, 1.45, 1.4), normal: new THREE.Vector3(-1, 0, 0), width: 1.1, height: 1.0 },
];

// The door is boarded shut and cannot be opened (decor + a source of noises).
export const DOOR = { center: new THREE.Vector3(1.7, 1.0, CABIN.halfZ), width: 0.95, height: 2.0 };

// Ammunition table: against the south wall, far from the north and east windows.
// position is the floor point under the table centre. Table top at y = 0.8.
export const AMMO_TABLE = {
  position: new THREE.Vector3(-1.1, 0, 3.45),
  size: { x: 1.5, z: 0.7, h: 0.8 },
  interactRadius: 1.35,
};

// Hanging lantern: the main interior light.
export const LANTERN = { position: new THREE.Vector3(0.2, 2.05, 0.4) };

// Ground height outside. Flat (CABIN.groundY) near the cabin, then each side has its own shape:
//  north: dense forest, ground rises gently away from the cabin
//  east:  open clearing, nearly flat, long sightline to a dead tree line at x ~ 32
//  west:  slope falling to a creek at x ~ -18, then rising again
//  south: forest, gentle rise (no window, only sounds come from here)
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const nearFade = smooth(5, 9, r); // 0 at the cabin, 1 from 9 m out
  let h = 0;
  // north rise
  if (z < -6) h += (-6 - z) * 0.07;
  // west slope to the creek, then back up
  if (x < -6) {
    const d = -6 - x; // metres beyond x = -6
    h -= Math.min(d, 12) * 0.25;
    if (d > 14) h += (d - 14) * 0.18;
  }
  // south gentle rise
  if (z > 7) h += (z - 7) * 0.05;
  // small rolling noise
  h += (Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.27 - 0.4) * 0.35 + Math.sin(x * 0.83 + z * 0.61) * 0.12);
  return CABIN.groundY + h * nearFade;
}

// The creek runs north-south along x = CREEK_X in the west zone.
export const CREEK_X = -18;

// Roof surface height at a given x (ridge along z). Used by climbers walking on the roof.
export function roofHeight(x) {
  const outer = CABIN.halfX + CABIN.wallThickness + CABIN.eaveOverhang;
  const eaveY = CABIN.wallHeight + 0.2;
  const t = 1 - Math.min(1, Math.abs(x) / outer);
  return eaveY + t * (CABIN.ridgeY - eaveY);
}
export function roofNormal(x) {
  const outer = CABIN.halfX + CABIN.wallThickness + CABIN.eaveOverhang;
  const slope = (CABIN.ridgeY - (CABIN.wallHeight + 0.2)) / outer;
  return new THREE.Vector3(Math.sign(x || 1) * slope, 1, 0).normalize();
}

// Spider approach routes, one set per window. Each route is a list of ground points
// (x, z) from far away to the base of the outside wall under that window.
// The forest must keep these lanes clear of trees and rocks (about 1.2 m either side).
export const ROUTES = {
  north: [
    [[-14, -42], [-9, -30], [-6, -20], [-2.5, -12], [-0.6, -6], [0, -4.5]],
    [[12, -40], [8, -28], [3.5, -17], [1.5, -9], [0.3, -4.5]],
    [[-26, -18], [-15, -14], [-7, -9], [-1.5, -5.5], [-0.3, -4.5]],
  ],
  east: [
    [[44, -2], [32, -1.5], [20, -1.4], [10, -1.2], [3.6, -1.2]],
    [[40, -22], [28, -14], [16, -6], [8, -2.5], [3.6, -1.6]],
    [[38, 16], [27, 9], [15, 3], [7, 0], [3.6, -0.8]],
  ],
  west: [
    [[-30, 2], [-22, 2.5], [-16, 2], [-9, 1.6], [-3.6, 1.4]],
    [[-26, 20], [-18, 14], [-12, 8], [-6, 3], [-3.6, 1.8]],
    [[-24, -14], [-17, -9], [-11, -3], [-6, 0.5], [-3.6, 1.0]],
  ],
};

// Where a few landmarks sit (the forest builder places them; spiders and eyes use them as cover).
export const LANDMARKS = {
  shed: { position: new THREE.Vector3(-12, 0, 9), rotationY: 0.5 },       // old shed, west zone
  deadTreeLineX: 32,                                                      // east zone
  fallenLogs: [ { x: -9, z: -3, rot: 0.3, len: 6 }, { x: -14, z: 5.5, rot: -0.6, len: 5 } ],
};

export function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
