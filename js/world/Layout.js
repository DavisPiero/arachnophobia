// Shared layout of the world. Every system reads positions from here so the cabin,
// forest, spiders, windows and audio all agree. Units are metres, +Y is up.
//
// Cabin interior: x from -4.5 to 4.5, z from -6 to 6 (9 x 12 m, was 6 x 8 until milestone 4). Floor at y = 0.
// The cabin stands on short posts, so the ground outside is at about y = -0.4.
//
//            north window (z = -6)
//          +-----------[ ]-----------+
//          |                         |
//          |                        [ ]  east window (x = +4.5)
//  west    [ ]                       |
//  window  |                         |
//  (x=-4.5)|                         |
//          |   ammo table            |
//          +----------------[door]---+   south wall (z = +4), door boarded shut
import * as THREE from 'three';

export const CABIN = {
  halfX: 4.5,          // interior half-width (x)
  halfZ: 6,            // interior half-depth (z)
  wallHeight: 3.0,     // interior wall height; ceiling at y = 3.0 (was 2.6; user wanted it a little taller)
  wallThickness: 0.16,
  floorY: 0,
  groundY: -0.4,       // outside ground level right next to the cabin
  eaveOverhang: 0.35,  // roof overhang beyond the outer walls
  ridgeY: 4.9,         // roof ridge height (ridge runs along z); keeps the old roof slope
};

// Window openings. `normal` points OUTWARD (from the cabin into the forest).
// center is the middle of the opening, on the INNER face of the wall; the wall (CABIN.wallThickness)
// runs outward from there, so the outer face is at center + normal * wallThickness.
export const WINDOWS = [
  { id: 'north', label: 'North', center: new THREE.Vector3(0, 1.6, -CABIN.halfZ), normal: new THREE.Vector3(0, 0, -1), width: 1.32, height: 1.2 },
  { id: 'east',  label: 'East',  center: new THREE.Vector3(CABIN.halfX, 1.6, -1.8), normal: new THREE.Vector3(1, 0, 0), width: 1.32, height: 1.2 },
  { id: 'west',  label: 'West',  center: new THREE.Vector3(-CABIN.halfX, 1.6, 2.1), normal: new THREE.Vector3(-1, 0, 0), width: 1.32, height: 1.2 },
];

// The door is boarded shut and cannot be opened (decor + a source of noises).
export const DOOR = { center: new THREE.Vector3(2.55, 1.0, CABIN.halfZ), width: 0.95, height: 2.0 };

// Ammunition table: against the south wall, far from the north and east windows.
// position is the floor point under the table centre. Table top at y = 0.8.
export const AMMO_TABLE = {
  position: new THREE.Vector3(-1.65, 0, CABIN.halfZ - 0.55),
  size: { x: 1.5, z: 0.7, h: 0.8 },
  interactRadius: 1.35,
};

// Hanging lantern: the main interior light.
export const LANTERN = { position: new THREE.Vector3(0.3, 2.3, 0.6) };

// Second light: an oil lamp hanging from an iron bracket on the west wall, at the north end of the room
// (the far end from the table, which was the darkest corner). position = centre of the flame.
export const WALL_LAMP = { position: new THREE.Vector3(-CABIN.halfX + 0.34, 1.72, -3.75), wallNormal: new THREE.Vector3(1, 0, 0) };

// Furniture, placed against the walls. Corners are given as distances in from the inner wall faces,
// so the furniture follows the cabin if it is resized again.
export const FURNITURE = {
  cot:     { corner: 'nw', width: 0.8, length: 1.97 },                  // along the west wall, head at the north wall
  stove:   { corner: 'ne', inset: 0.55 },                               // pipe through the roof; firewood along the north wall
  shelves: { wall: 'east', z0: 2.4, z1: 3.9 },                          // south part of the east wall, jars and tins
  crates:  { corner: 'se' },
  rug:     { minX: -1.2, maxX: 1.2, minZ: -1.6, maxZ: 1.9 },            // under the lantern
  hooks:   { wall: 'west', z0: 3.3, z1: 4.1, y: 1.72 },                // coat hooks, rope and bag, south of the west window
};

// Ground height outside. Flat (CABIN.groundY) near the cabin, then each side has its own shape:
//  north: dense forest, ground rises gently away from the cabin
//  east:  open clearing, nearly flat, long sightline to a dead tree line at x ~ 32
//  west:  slope falling to a creek at x ~ -18, then rising again
//  south: forest, gentle rise (no window, only sounds come from here)
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const nearFade = smooth(8, 12.5, r); // 0 at the cabin, 1 from 12.5 m out
  let h = 0;
  // north rise
  if (z < -8) h += (-8 - z) * 0.07;
  // west slope to the creek, then back up
  if (x < -7.5) {
    const d = -7.5 - x; // metres beyond x = -7.5
    h -= Math.min(d, 10.5) * 0.25;
    if (d > 12.5) h += (d - 12.5) * 0.18;
  }
  // south gentle rise
  if (z > 9) h += (z - 9) * 0.05;
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
const WB = CABIN.halfX + 0.6, NB = CABIN.halfZ + 0.5; // route end: the ground at the foot of the outside wall
export const ROUTES = {
  north: [
    [[-14, -42], [-9, -30], [-6, -20], [-2.5, -13], [-0.6, -8.5], [0, -NB]],
    [[12, -40], [8, -28], [3.5, -18], [1.5, -10.5], [0.3, -NB]],
    [[-26, -18], [-15, -15], [-8, -10.5], [-1.5, -8], [-0.3, -NB]],
  ],
  east: [
    [[44, -2], [32, -1.8], [20, -1.8], [10, -1.8], [WB, -1.8]],
    [[40, -22], [28, -14], [16, -6.5], [8.5, -3], [WB, -2.2]],
    [[38, 16], [27, 9], [15, 3], [8, 0], [WB, -1.4]],
  ],
  west: [
    [[-30, 2], [-22, 2.5], [-16, 2.3], [-9, 2.1], [-WB, 2.1]],
    [[-26, 20], [-18, 14], [-12, 8.5], [-7.5, 3.6], [-WB, 2.5]],
    [[-24, -14], [-17, -9], [-11, -3], [-7.5, 0.6], [-WB, 1.7]],
  ],
};

// Where a few landmarks sit (the forest builder places them; spiders and eyes use them as cover).
export const LANDMARKS = {
  shed: { position: new THREE.Vector3(-12, 0, 9), rotationY: 0.5 },       // old shed, west zone
  deadTreeLineX: 32,                                                      // east zone
  fallenLogs: [ { x: -10.5, z: -3.5, rot: 0.3, len: 6 }, { x: -14, z: 5.5, rot: -0.6, len: 5 } ],
};

export function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
