// The three windows: how visible the outside is, and how they get damaged and broken.
//
// Visibility: the windows are always clear (the darkening veil was removed, user's call). `closeness`
// (1 = standing at the window looking out) still drives the watcher, which slips away when you come close.
//
// Damage stages: 0 intact, 1 cracked, 2 shattered (glass gone), 3 boards splintering, 4 breached.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { WINDOWS, CABIN } from '../world/Layout.js';
import { interiorMaterial } from '../world/Lighting.js';

const WC = Config.windows;
// WINDOWS[i].center sits on the INNER face of the wall; the wall runs outward from there.
const GLASS_Z = CABIN.wallThickness / 2;   // glass in the middle of the wall
const BOARD_Z = -0.11;                     // boards nailed on the inside, clear of the window stool

export class WindowSystem {
  constructor({ scene, audio, events, camera }) {
    this.scene = scene;
    this.audio = audio;
    this.events = events;
    this.camera = camera;
    this.flash = 0;
    this.windows = WINDOWS.map((def) => this.buildWindow(def));
    this.byId = Object.fromEntries(this.windows.map((w) => [w.id, w]));
    this.shards = [];
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

    // glass: faint, glossy so the lantern glints on it
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2426, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    glass.position.z = GLASS_Z;
    glass.renderOrder = 11;
    group.add(glass);

    // cracks, drawn on a canvas as damage builds up
    const crackCanvas = document.createElement('canvas');
    crackCanvas.width = crackCanvas.height = 256;
    const crackTex = new THREE.CanvasTexture(crackCanvas);
    crackTex.colorSpace = THREE.SRGBColorSpace;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, color: 0xbfc8c8 }));
    crack.position.z = GLASS_Z - 0.002;
    crack.renderOrder = 12;
    group.add(crack);

    // boards nailed across the inside of the opening
    const boards = [];
    const boardMat = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x5b4532, roughness: 0.85, map: makeBoardTexture() }));
    const boardDefs = [
      { y: -h * 0.36, rot: 0.05, len: w + 0.34 },
      { y: h * 0.38, rot: -0.06, len: w + 0.3 },
    ];
    for (const bd of boardDefs) {
      const pivot = new THREE.Group(); // pivot at the left nail so a loose board swings
      pivot.position.set(-bd.len / 2 + 0.06, bd.y, BOARD_Z);
      pivot.rotation.z = bd.rot;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bd.len, 0.13, 0.03), boardMat);
      mesh.position.x = bd.len / 2 - 0.06;
      mesh.castShadow = true; mesh.receiveShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      const board = { pivot, mesh, homePos: pivot.position.clone(), baseRot: bd.rot, loose: 0, fallen: false, fallV: new THREE.Vector3(), wobble: 0, onShot: null };
      board.onShot = () => { board.wobble = 1; };
      mesh.userData.board = board;
      boards.push(board);
    }

    const win = {
      id: def.id, label: def.label, def, group, glass, crack, crackCanvas, crackTex, boards,
      health: WC.maxHealth, stage: 0, closeness: 0, cracks: [],
      center: def.center.clone(), normal: n, width: def.width, height: def.height,
      // world-space point on the outside face of the glass, used by spiders
      outside: def.center.clone().addScaledVector(n, CABIN.wallThickness + 0.02),
    };
    this.drawCracks(win);
    return win;
  }

  /** Meshes that stop bullets (boards still attached). */
  boardMeshes() {
    const out = [];
    for (const w of this.windows) for (const b of w.boards) if (!b.fallen) out.push(b.mesh);
    return out;
  }

  reset() {
    for (const w of this.windows) {
      w.health = WC.maxHealth; w.stage = 0; w.cracks = [];
      w.glass.visible = true;
      for (const b of w.boards) {
        b.fallen = false; b.loose = 0; b.wobble = 0;
        if (b.pivot.parent !== w.group) { b.pivot.parent?.remove(b.pivot); w.group.add(b.pivot); }
        b.pivot.position.copy(b.homePos);
        b.pivot.rotation.set(0, 0, b.baseRot);
      }
      this.drawCracks(w);
    }
    for (const s of this.shards) this.scene.remove(s.mesh);
    this.shards = [];
    this.updateOpenness();
  }

  stageFor(health) {
    const f = health / WC.maxHealth;
    if (f <= 0) return 4;
    if (f < WC.stages[2]) return 3;
    if (f < WC.stages[1]) return 2;
    if (f < WC.stages[0]) return 1;
    return 0;
  }

  /** A spider hits the window. `point` is where (world space), optional. */
  damage(id, amount, point) {
    const w = this.byId[id];
    if (!w || w.stage >= 4) return;
    w.health = Math.max(0, w.health - amount);
    const before = w.stage;
    const after = this.stageFor(w.health);
    const pos = point || w.outside;

    if (w.stage < 2) {
      // add a crack where it was hit
      const local = w.group.worldToLocal(pos.clone());
      this.addCrack(w, local.x / w.def.width + 0.5, 0.5 - local.y / w.def.height, 0.4 + amount / 25);
      if (Math.random() < 0.6 || after > before) this.audio.play('glassCrack', { position: pos, volume: 0.5 + amount / 30, reverb: 0.25 });
    } else {
      this.audio.play('boardHit', { position: w.center, volume: 0.6 + amount / 30, reverb: 0.2 });
      for (const b of w.boards) if (!b.fallen) b.wobble = Math.min(1.5, b.wobble + amount / 15);
    }

    if (after !== before) {
      w.stage = after;
      if (after >= 2 && before < 2) this.shatter(w);
      if (after >= 3) this.loosenBoard(w, 0);
      if (after >= 4) {
        this.dropBoard(w, 0); this.dropBoard(w, 1);
        this.events.emit('windowBreached', { id: w.id });
      }
      this.events.emit('windowDamaged', { id: w.id, stage: after, health: w.health });
      this.updateOpenness();
    }
    // inside stage 3, the first board falls halfway down
    if (w.stage === 3 && w.health < WC.maxHealth * 0.12) this.dropBoard(w, 0);
  }

  shatter(w) {
    w.glass.visible = false;
    w.cracks = [];
    this.drawCracks(w, true);
    this.audio.play('glassShatter', { position: w.center, volume: 1, reverb: 0.3 });
    // glass shards fall into the room
    const mat = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x9fb0b0, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    for (let i = 0; i < 18; i++) {
      const s = 0.03 + Math.random() * 0.07;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s, Math.random() * s, 0), new THREE.Vector3(Math.random() * s, s * 1.4, 0)]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(w.center).add(new THREE.Vector3((Math.random() - 0.5) * w.def.width, (Math.random() - 0.5) * w.def.height, 0).applyAxisAngle(_up, w.group.rotation.y));
      const v = w.normal.clone().multiplyScalar(-(0.6 + Math.random() * 1.6));
      v.x += (Math.random() - 0.5); v.z += (Math.random() - 0.5) * 0.5; v.y = Math.random() * 1.2;
      this.scene.add(m);
      this.shards.push({ mesh: m, v, spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9), rest: false, life: 30 });
    }
  }

  loosenBoard(w, i) {
    const b = w.boards[i];
    if (b.fallen || b.loose) return;
    b.loose = 1;
    this.audio.play('boardBreak', { position: w.center, volume: 0.6, reverb: 0.2 });
  }

  dropBoard(w, i) {
    const b = w.boards[i];
    if (b.fallen) return;
    b.fallen = true;
    // move to world space and let it fall
    const wp = new THREE.Vector3(); const wq = new THREE.Quaternion();
    b.pivot.getWorldPosition(wp); b.pivot.getWorldQuaternion(wq);
    w.group.remove(b.pivot);
    this.scene.add(b.pivot);
    b.pivot.position.copy(wp); b.pivot.quaternion.copy(wq);
    b.fallV.copy(w.normal).multiplyScalar(-1.2); b.fallV.y = 0.5;
    this.audio.play('boardBreak', { position: w.center, volume: 1, reverb: 0.3 });
  }

  addCrack(w, u, v, size) {
    // one crack = a few jagged lines radiating from (u, v) plus a ring
    const lines = [];
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      let x = u, y = v;
      const pts = [[x, y]];
      const len = (0.15 + Math.random() * 0.35) * size;
      const segs = 4 + Math.floor(Math.random() * 4);
      let ang = a;
      for (let s = 0; s < segs; s++) {
        ang += (Math.random() - 0.5) * 0.7;
        x += Math.cos(ang) * len / segs; y += Math.sin(ang) * len / segs;
        pts.push([x, y]);
      }
      lines.push(pts);
    }
    w.cracks.push({ u, v, lines, ring: 0.03 * size });
    this.drawCracks(w);
  }

  drawCracks(w, shattered = false) {
    const c = w.crackCanvas, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const S = c.width;
    if (shattered) {
      // jagged shards left in the frame edges
      g.fillStyle = 'rgba(190,205,205,0.28)';
      g.strokeStyle = 'rgba(230,240,240,0.7)';
      g.lineWidth = 1.2;
      const edge = (x0, y0, x1, y1, inward) => {
        g.beginPath(); g.moveTo(x0 * S, y0 * S);
        const steps = 6;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const d = Math.random() * 0.18;
          g.lineTo((x0 + (x1 - x0) * t + inward[0] * d) * S, (y0 + (y1 - y0) * t + inward[1] * d) * S);
        }
        g.lineTo(x1 * S, y1 * S); g.closePath(); g.fill(); g.stroke();
      };
      edge(0, 0, 1, 0, [0, 1]); edge(1, 0, 1, 1, [-1, 0]); edge(1, 1, 0, 1, [0, -1]); edge(0, 1, 0, 0, [1, 0]);
    } else {
      g.strokeStyle = 'rgba(235,245,245,0.85)';
      g.lineCap = 'round';
      for (const cr of w.cracks) {
        for (const pts of cr.lines) {
          g.lineWidth = 0.6 + Math.random() * 0.8;
          g.beginPath();
          pts.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S)));
          g.stroke();
        }
        g.beginPath(); g.arc(cr.u * S, cr.v * S, cr.ring * S, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(220,230,230,0.25)';
        g.beginPath(); g.arc(cr.u * S, cr.v * S, cr.ring * S * 0.6, 0, Math.PI * 2); g.fill();
      }
    }
    w.crackTex.needsUpdate = true;
  }

  updateOpenness() {
    let open = 0;
    for (const w of this.windows) if (w.stage >= 2) open += w.stage >= 4 ? 0.5 : 0.3;
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
          if (b.pivot.position.y > 0.05) {
            b.fallV.y -= 9.8 * dt;
            b.pivot.position.addScaledVector(b.fallV, dt);
            b.pivot.rotation.z += dt * 3;
            if (b.pivot.position.y <= 0.05) { b.pivot.position.y = 0.05; b.pivot.rotation.set(-Math.PI / 2, b.pivot.rotation.y, b.pivot.rotation.z); this.audio.play('boardHit', { position: b.pivot.position, volume: 0.5 }); }
          }
          continue;
        }
        b.wobble *= Math.exp(-6 * dt);
        const hang = b.loose ? -0.9 : 0;
        b.pivot.rotation.z = b.baseRot + hang + Math.sin(performance.now() * 0.04) * b.wobble * 0.04;
      }
    }
    // shards falling to the floor
    for (const s of this.shards) {
      if (s.rest) continue;
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt;
      if (s.mesh.position.y < 0.01) { s.mesh.position.y = 0.01; s.rest = true; s.mesh.rotation.x = -Math.PI / 2; }
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
const _up = new THREE.Vector3(0, 1, 0);
