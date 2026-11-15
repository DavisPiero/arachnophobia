// The three windows: open holes with planks nailed across the OUTSIDE of the wall (no glass, user's call 2026-11-15).
//
// The boards are the barrier. Each board has its own health; spiders tear at the board nearest their claws, a hurt
// board hangs loose, a dead one falls off into the yard. You shoot (or punch) through the gaps between the boards;
// a bullet that meets a board stops there and does not hurt it (the player never damages a window).
// When every board is gone the window is breached and spiders climb in.
//
// `stage` is how many boards are gone (0 .. boards.length); breached when stage >= BREACHED (4).
// `addBoard(win)` nails a fallen plank back on (a log, js/systems/Firewood.js). Room for later: a big spider can reach through a gap
// (`gapAt(win, y)` tells where the gaps are) to grab the player.
//
// Visibility: `closeness` (1 = standing at the window looking out) still drives the watcher, which slips away.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { WINDOWS, CABIN, terrainHeight } from '../world/Layout.js';
import { interiorMaterial } from '../world/Lighting.js';

const WC = Config.windows;
export const BREACHED = 4;
// WINDOWS[i].center sits on the INNER face of the wall; the wall runs outward from there.
const BOARD_Z = CABIN.wallThickness + 0.02;   // planks nailed across the outer face of the wall
const BOARD_H = 0.15;   // plank height; where they sit is Config.windows.boardSpots

export class WindowSystem {
  constructor({ scene, audio, events, camera }) {
    this.scene = scene;
    this.audio = audio;
    this.events = events;
    this.camera = camera;
    this.flash = 0;
    this.boardMat = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x5b4532, roughness: 0.85, map: makeBoardTexture() }));
    this.windows = WINDOWS.map((def) => this.buildWindow(def));
    this.byId = Object.fromEntries(this.windows.map((w) => [w.id, w]));
    this.baseFog = null;
    events.on('lightning', ({ strength }) => { this.flash = Math.max(this.flash, 0.6 + strength * 0.4); });
    events.on('muzzleFlash', () => { this.flash = Math.max(this.flash, 0.18); });
  }

  buildWindow(def) {
    const group = new THREE.Group();
    const n = def.normal.clone();
    const yaw = Math.atan2(n.x, n.z); // plane faces +z by default; rotate so +z = outward
    group.position.copy(def.center);
    group.rotation.y = yaw;
    this.scene.add(group);
    const w = def.width, h = def.height;
    const spots = WC.boardSpots;
    const count = spots.length;
    const boards = [];
    for (let i = 0; i < count; i++) {
      const y = spots[i] * (h / 2 - BOARD_H / 2);
      const len = w + 0.3 + (i % 2) * 0.06;
      const rot = [0.035, -0.025, 0.02, -0.04, 0.03][i % 5];
      const pivot = new THREE.Group(); // pivot at the left nail so a loose board swings
      pivot.position.set(-len / 2 + 0.06, y, BOARD_Z);
      pivot.rotation.z = rot;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, BOARD_H, 0.035), this.boardMat);
      mesh.position.x = len / 2 - 0.06;
      mesh.castShadow = true; mesh.receiveShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      const board = { pivot, mesh, y, homePos: pivot.position.clone(), baseRot: rot, health: WC.boardHealth, loose: 0, fallen: false, fallV: new THREE.Vector3(), wobble: 0, onShot: null };
      board.onShot = () => { board.wobble = Math.max(board.wobble, 0.6); };
      mesh.userData.board = board;
      boards.push(board);
    }
    return {
      id: def.id, label: def.label, def, group, boards,
      health: WC.boardHealth * count, maxHealth: WC.boardHealth * count, stage: 0, closeness: 0,
      center: def.center.clone(), normal: n, width: def.width, height: def.height,
      // world-space point just off the boards, used by spiders
      outside: def.center.clone().addScaledVector(n, CABIN.wallThickness + 0.02),
    };
  }

  /** Meshes that stop bullets (boards still attached). */
  boardMeshes() {
    const out = [];
    for (const w of this.windows) for (const b of w.boards) if (!b.fallen) out.push(b.mesh);
    return out;
  }

  reset() {
    for (const w of this.windows) {
      for (const b of w.boards) {
        b.fallen = false; b.loose = 0; b.wobble = 0; b.health = WC.boardHealth;
        if (b.pivot.parent !== w.group) { b.pivot.parent?.remove(b.pivot); w.group.add(b.pivot); }
        b.pivot.position.copy(b.homePos);
        b.pivot.rotation.set(0, 0, b.baseRot);
      }
      this.recount(w);
    }
    this.updateOpenness();
  }

  recount(w) {
    w.health = w.boards.reduce((a, b) => a + (b.fallen ? 0 : b.health), 0);
    w.stage = Math.min(BREACHED, w.boards.filter((b) => b.fallen).length * BREACHED / w.boards.length);
  }

  /** A spider tears at the window. `point` is where (world space), optional: the board nearest it takes the hit. */
  damage(id, amount, point) {
    const w = this.byId[id];
    if (!w || w.stage >= BREACHED) return;
    const standing = w.boards.filter((b) => !b.fallen);
    let board = standing[0];
    if (point) {
      const ly = w.group.worldToLocal(_a.copy(point)).y;
      let bd = Infinity;
      for (const b of standing) { const d = Math.abs(b.y - ly); if (d < bd) { bd = d; board = b; } }
    }
    board.health -= amount;
    board.wobble = Math.min(1.5, board.wobble + amount / 12);
    this.audio.play('boardHit', { position: w.outside, volume: 0.6 + amount / 30, reverb: 0.2 });
    if (!board.loose && board.health < WC.boardHealth * 0.4) {
      board.loose = 1;
      this.audio.play('boardBreak', { position: w.outside, volume: 0.6, reverb: 0.2 });
    }
    if (board.health <= 0) {
      this.dropBoard(w, board);
      const before = w.stage;
      this.recount(w);
      this.events.emit('windowDamaged', { id: w.id, stage: w.stage, health: w.health, before });
      if (w.stage >= BREACHED) this.events.emit('windowBreached', { id: w.id });
      this.updateOpenness();
    } else this.recount(w);
  }

  /** Nail one plank back on (the lowest gone). Returns false if none is missing. */
  addBoard(w) {
    const b = w.boards.find((x) => x.fallen);
    if (!b) return false;
    const wasBreached = w.stage >= BREACHED;
    b.pivot.parent?.remove(b.pivot);
    w.group.add(b.pivot);
    b.pivot.position.copy(b.homePos);
    b.pivot.rotation.set(0, 0, b.baseRot);
    b.fallen = false; b.loose = 0; b.health = WC.boardHealth; b.wobble = 1;
    this.recount(w);
    this.updateOpenness();
    this.events.emit('windowRepaired', { id: w.id, stage: w.stage, wasBreached });
    return true;
  }

  dropBoard(w, b) {
    if (b.fallen) return;
    b.fallen = true; b.health = 0;
    // move to world space and let it fall outside, torn away from the wall
    const wp = new THREE.Vector3(); const wq = new THREE.Quaternion();
    b.pivot.getWorldPosition(wp); b.pivot.getWorldQuaternion(wq);
    w.group.remove(b.pivot);
    this.scene.add(b.pivot);
    b.pivot.position.copy(wp); b.pivot.quaternion.copy(wq);
    b.fallV.copy(w.normal).multiplyScalar(1.4 + Math.random()); b.fallV.y = 1.0;
    b.groundY = terrainHeight(wp.x + w.normal.x * 0.8, wp.z + w.normal.z * 0.8) + 0.03;
    this.audio.play('boardBreak', { position: w.outside, volume: 1, reverb: 0.3 });
  }

  /** Is there a gap (no standing board) at local height y in this window? */
  gapAt(w, y) {
    return !w.boards.some((b) => !b.fallen && Math.abs(b.y - y) < BOARD_H / 2);
  }

  updateOpenness() {
    let open = 0;
    for (const w of this.windows) open += w.stage >= BREACHED ? 0.5 : w.stage * 0.08;
    this.audio.setExteriorOpenness(Math.min(1, open));
  }

  update(dt, eye, scene) {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    let maxClose = 0;
    for (const w of this.windows) {
      const toWin = _a.copy(w.center).sub(eye);
      const d = toWin.length();
      const cos = Math.max(0, toWin.normalize().dot(w.normal)); // 1 = looking straight out through it
      const dEff = d / (0.45 + 0.55 * cos);
      const t = smoothstep(WC.clearDistance, WC.darkDistance, dEff);
      w.closeness = 1 - t;
      maxClose = Math.max(maxClose, w.closeness);

      // boards: wobble and loose swing
      for (const b of w.boards) {
        if (b.fallen) {
          if (b.pivot.position.y > b.groundY) {
            b.fallV.y -= 9.8 * dt;
            b.pivot.position.addScaledVector(b.fallV, dt);
            b.pivot.rotation.z += dt * 3;
            if (b.pivot.position.y <= b.groundY) { b.pivot.position.y = b.groundY; b.pivot.rotation.set(-Math.PI / 2, b.pivot.rotation.y, b.pivot.rotation.z); this.audio.play('boardHit', { position: b.pivot.position, volume: 0.4, exterior: true }); }
          }
          continue;
        }
        b.wobble *= Math.exp(-6 * dt);
        const hang = b.loose ? -0.9 : 0;
        b.pivot.rotation.z = b.baseRot + hang + Math.sin(performance.now() * 0.04) * b.wobble * 0.04;
      }
    }
    // fog thins a little when you are at a window: more detail outside
    if (scene.fog && scene.fog.density !== undefined) {
      if (this.baseFog === null) this.baseFog = scene.fog.density;
      scene.fog.density = this.baseFog * (1.25 - 0.4 * maxClose);
    }
    this.maxCloseness = maxClose;
  }

  /** Window the player is standing at (closeness > 0.5), or null. */
  nearestWindow(eye) {
    let best = null, bd = Infinity;
    for (const w of this.windows) {
      const d = eye.distanceTo(w.center);
      if (d < bd) { bd = d; best = w; }
    }
    return { window: best, distance: bd };
  }
}

function smoothstep(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
function makeBoardTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#6a513a'; g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(30,18,8,${0.1 + Math.random() * 0.25})`;
    g.lineWidth = 0.5 + Math.random();
    const y = Math.random() * 32;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 20) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.5);
    g.stroke();
  }
  // nail heads
  g.fillStyle = '#222'; for (const x of [10, 246]) { g.beginPath(); g.arc(x, 10, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(x, 22, 2.5, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const _a = new THREE.Vector3();
