// Things to gather by day (SURVIVAL.md S1): dry branches (logs), ammo tins (rounds and shells), yarrow (bandages).
// Each morning a fresh set lies scattered in the forest around the cabin. Look at one close by and press USE to put it
// in your pack (Config.survival.pack places); walk back into the cabin and the pack is emptied into the woodpile, the
// ammo table and the medical table. Meshes are code-made placeholders until S4.
import * as THREE from 'three';
import { Config } from '../core/Config.js';

const S = Config.survival;
const REACH = 2.3;      // how close you must be (m, eye to item)
const LOOK = 0.3;       // look tolerance (rad) on top of the item's size

export class Pickups {
  constructor({ scene, obstacles, groundAt, camera, audio, events }) {
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    scene.add(this.group);
    this.obstacles = obstacles;
    this.groundAt = groundAt;
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.items = [];
    this.pack = [];
    this.target = null;
    this.mats = {
      bark: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x9a7f5a, roughness: 1 }),
      tin: new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.5 }),
      stencil: new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.8 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x4f6b38, roughness: 0.9 }),
      flower: new THREE.MeshStandardMaterial({ color: 0xe8e4d4, roughness: 0.9 }),
      twine: new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 }),
    };
  }

  /** A new morning: clear what is left and scatter a fresh set. */
  scatter(seed = Math.random() * 1e9) {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items = [];
    let s = seed >>> 0 || 1;
    const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const [r0, r1] = S.itemRange;
    for (const [type, def] of Object.entries(S.items)) {
      for (let n = 0, tries = 0; n < def.count && tries < 400; tries++) {
        const a = R() * Math.PI * 2, r = r0 + Math.sqrt(R()) * (r1 - r0);
        const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
        const q = { ...p };
        if (this.obstacles?.push(q, 0.6)) continue;   // not under a trunk or a rock
        if (this.items.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 4)) continue;
        const mesh = this.build(type, R);
        mesh.position.set(p.x, this.groundAt(p.x, p.z), p.z);
        mesh.rotation.y = R() * Math.PI * 2;
        this.group.add(mesh);
        this.items.push({ type, x: p.x, z: p.z, mesh, glow: 0 });
        n++;
      }
    }
  }

  build(type, R) {
    const g = new THREE.Group(), M = this.mats;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
    if (type === 'branches') {
      // a bundle of dry branches tied with twine
      for (let i = 0; i < 5; i++) {
        const len = 1.0 + R() * 0.5, r = 0.035 + R() * 0.025;
        add(new THREE.CylinderGeometry(r * 0.7, r, len, 6), i % 2 ? M.bark : M.wood, (i - 2) * 0.06, 0.06 + (i % 2) * 0.05, (R() - 0.5) * 0.15, 0, (R() - 0.5) * 0.25, Math.PI / 2);
      }
      // the branches lie along x: each loop of twine stands across them (its ring in the y-z plane)
      for (const x of [-0.25, 0.25]) add(new THREE.TorusGeometry(0.11, 0.014, 4, 12), M.twine, x, 0.08, 0, 0, Math.PI / 2, 0);
    } else if (type === 'ammo') {
      // an olive ammo tin with a pale stencil band and a handle
      add(new THREE.BoxGeometry(0.34, 0.2, 0.17), M.tin, 0, 0.1, 0);
      add(new THREE.BoxGeometry(0.345, 0.04, 0.175), M.stencil, 0, 0.13, 0);
      add(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), M.tin, 0, 0.2, 0);
    } else {
      // yarrow: a clump of stems with flat white flower heads
      for (let i = 0; i < 7; i++) {
        const h = 0.25 + R() * 0.2, x = (R() - 0.5) * 0.22, z = (R() - 0.5) * 0.22;
        add(new THREE.CylinderGeometry(0.006, 0.008, h, 4), M.leaf, x, h / 2, z, (R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3);
        add(new THREE.CylinderGeometry(0.05, 0.03, 0.025, 7), M.flower, x, h, z);
      }
      add(new THREE.ConeGeometry(0.16, 0.12, 6), M.leaf, 0, 0.05, 0);
    }
    g.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });   // each glows on its own
    return g;
  }

  /** What USE would pick up: the item most squarely in view within reach, or null. */
  findTarget() {
    const eye = this.camera.position, fwd = this.camera.getWorldDirection(_f);
    let best = null, bm = 0;
    for (const it of this.items) {
      _to.set(it.x, it.mesh.position.y + 0.12, it.z).sub(eye);
      const d = _to.length();
      if (d > REACH) continue;
      const m = _to.divideScalar(d).dot(fwd) - Math.cos(Math.atan2(0.3, d) + LOOK);
      if (m > bm) { bm = m; best = it; }
    }
    return best;
  }

  prompt() {
    const it = this.target = this.findTarget();
    if (!it) return null;
    const label = S.items[it.type].label;
    if (this.pack.length >= S.pack) return { title: label, target: 'pickup', text: `Your pack is full · take it home`, can: false };
    return { title: label, target: 'pickup', text: `Pick up · pack ${this.pack.length}/${S.pack}`, can: true };
  }

  /** USE on the item in view. Returns its label, or null. */
  take() {
    const it = this.target;
    if (!it || this.pack.length >= S.pack) return null;
    this.items.splice(this.items.indexOf(it), 1);
    this.group.remove(it.mesh);
    this.pack.push(it.type);
    this.target = null;
    this.audio.play(it.type === 'ammo' ? 'ammoPickup' : 'branchSnap', { volume: it.type === 'ammo' ? 0.6 : 0.25, exterior: false });
    this.events.emit('picked', { type: it.type, pack: this.pack.length });
    return S.items[it.type].label;
  }

  /** Empty the pack into the cabin's stocks. Returns what went where, e.g. { logs: 3, rounds: 8, shells: 4, bandages: 1 }. */
  unpack({ firewood, table, healing }) {
    if (!this.pack.length) return null;
    const got = { logs: 0, rounds: 0, shells: 0, bandages: 0 };
    for (const type of this.pack) {
      const d = S.items[type];
      got.logs += d.logs || 0; got.rounds += d.rounds || 0; got.shells += d.shells || 0; got.bandages += d.bandages || 0;
    }
    firewood.logs = Math.min(Config.logs.max, firewood.logs + got.logs);
    table.stocks.rifle += got.rounds; table.stocks.shotgun += got.shells; table.updateSupplies();
    healing.bandages = Math.min(Config.heal.bandage.max, healing.bandages + got.bandages);
    this.pack = [];
    this.events.emit('unpacked', got);
    return got;
  }

  /** The item you are looking at glows faintly, like the things you can use in the cabin. */
  update(dt, time) {
    for (const it of this.items) {
      const want = it === this.target ? 1 : 0;
      if (want === 0 && it.glow < 0.003) continue;
      it.glow += (want - it.glow) * Math.min(1, dt * 8);
      const e = it.glow * (0.8 + 0.2 * Math.sin(time * 3)) * 0.06;
      it.mesh.traverse((o) => { if (o.isMesh) o.material.emissive.setRGB(1, 0.66, 0.25).multiplyScalar(e); });
    }
  }

  reset() { this.pack = []; this.target = null; for (const it of this.items) this.group.remove(it.mesh); this.items = []; }
}

const _f = new THREE.Vector3(), _to = new THREE.Vector3();
