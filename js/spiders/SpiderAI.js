// Spider behaviour and the manager that owns all live spiders.
//
// Life of a spider:
//   approach (walk a forest route) -> [stalker: watch from the dark] -> climb to a window slot
//   -> attackWindow (claw at the glass / boards) -> window breached -> enter -> inside (hunt the player)
//   Any time: shot dead -> dying (falls off walls) -> fades away.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { CABIN, terrainHeight, WINDOWS } from '../world/Layout.js';
import { createSpiderVisual } from './SpiderModel.js';
import { SpiderVoice } from '../audio/SpiderVoice.js';
import { groundRoute, climbToSlot, bruteSlot, climberRoute, enterPath, groundNode } from './SpiderPaths.js';

const UP = new THREE.Vector3(0, 1, 0);
const SLOTS = [ { u: 0, y: 1.42 }, { u: -0.32, y: 1.2 }, { u: 0.34, y: 1.62 } ]; // attack spots on a window

let nextId = 1;

export class Spider {
  constructor(type, mgr) {
    this.id = nextId++;
    this.type = type;
    this.mgr = mgr;
    this.cfg = Config.spiders[type];
    this.health = this.cfg.health;
    this.visual = createSpiderVisual(type, mgr.quality);
    this.root = this.visual.root;
    this.visual.hitbox.userData.spider = this;
    this.voice = mgr.audio ? new SpiderVoice(mgr.audio, type, this.root) : null;
    this.visual.rig.onStep = () => this.voice?.step(this.surface);
    mgr.scene.add(this.root);

    this.state = 'approach';
    this.path = null; this.seg = 0; this.segT = 0; this.pathDone = null;
    this.surface = 'ground';
    this.up = UP.clone();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.speed = 0;           // current actual speed (m/s)
    this.pause = 0;           // seconds standing still
    this.burst = 0;           // runner burst timer
    this.flinch = 0;
    this.attackT = 1 + Math.random();
    this.attackAnim = 0;
    this.window = null; this.slot = -1;
    this.watchT = 0; this.vanishes = 0; this.fade = 1;
    this.deadT = 0; this.fallV = null;
    this.alive = true; this.removed = false;
    this.distToPlayer = 99;
    this.visual.setOpacity(1);
  }

  get position() { return this.root.position; }

  /** Start following a path. onDone runs when the last node is reached. */
  follow(nodes, onDone) {
    this.path = nodes; this.seg = 0; this.segT = 0; this.pathDone = onDone;
    if (nodes.length) { this.root.position.copy(nodes[0].p); this.up.copy(nodes[0].n); }
  }

  takeHit(dmg, point, dir) {
    if (!this.alive) return;
    this.health -= dmg;
    this.flinch = 0.3;
    this.mgr.audio?.play('bulletImpactFlesh', { position: point, volume: 0.9, exterior: this.state !== 'inside' });
    this.mgr.spawnIchor(point, dir);
    this.voice?.hit();
    if (this.state === 'watch') this.startVanish(); // a shot sends a stalker away
    if (this.health <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.state = 'dying';
    this.deadT = 0;
    this.releaseSlot();
    this.voice?.die();
    this.fallV = this.surface === 'ground' || this.surface === 'floor' ? null : this.up.clone().multiplyScalar(1.2);
    this.mgr.events.emit('spiderKilled', { spider: this });
  }

  releaseSlot() {
    if (this.window && this.slot >= 0) { this.mgr.slots[this.window.id][this.slot] = null; }
    this.slot = -1;
  }

  startVanish() {
    if (this.state === 'vanish') return;
    this.state = 'vanish';
    this.vanishT = 0;
    this.mgr.audio?.play('spiderHiss', { object: this.root, volume: 0.35, exterior: true });
  }

  // ---------------------------------------------------------------- update
  update(dt, player) {
    this.distToPlayer = this.root.position.distanceTo(player.position);
    this.flinch = Math.max(0, this.flinch - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt * 2.5);
    let mode = 'walk';
    let moveSpeed = 0;

    switch (this.state) {
      case 'approach': case 'enter': case 'scuttle':
        moveSpeed = this.moveAlongPath(dt);
        break;
      case 'wait':
        this.waitT -= dt;
        if (this.waitT <= 0) { this.waitT = 1; this.tryTakeSlot(); }
        mode = 'idle';
        break;
      case 'watch':
        this.updateWatch(dt, player);
        mode = 'idle';
        break;
      case 'vanish':
        this.vanishT += dt;
        this.fade = Math.max(0, 1 - this.vanishT / 0.7);
        this.visual.setOpacity(this.fade);
        if (this.vanishT > 0.7) this.reappear();
        mode = 'idle';
        break;
      case 'attackWindow':
        this.updateAttackWindow(dt);
        mode = this.attackAnim > 0 ? 'attack' : 'idle';
        break;
      case 'inside':
        moveSpeed = this.updateInside(dt, player);
        mode = this.attackAnim > 0 ? 'attack' : (moveSpeed > 0.05 ? 'walk' : 'idle');
        break;
      case 'dying':
        this.updateDying(dt);
        mode = 'dead';
        break;
    }
    if (this.state === 'approach' || this.state === 'enter' || this.state === 'scuttle') mode = moveSpeed > 0.05 ? 'walk' : 'idle';

    // smooth speed for the rig
    this.speed += (moveSpeed - this.speed) * (1 - Math.exp(-10 * dt));
    this.orient(dt);
    this.visual.rig.update(dt, { speed: this.speed, mode, attack: Math.sin(Math.min(1, this.attackAnim) * Math.PI) });
    if (this.voice) {
      const vs = this.state === 'dying' ? 'dead'
        : this.state === 'attackWindow' ? 'attackWindow'
        : this.state === 'inside' || this.state === 'enter' && this.surface === 'floor' ? 'inside'
        : this.state === 'watch' ? 'watch'
        : this.state === 'wait' || this.state === 'vanish' ? 'idle'
        : this.surface === 'roof' ? 'roof'
        : this.surface === 'wall' || this.surface === 'glass' ? 'climb' : 'approach';
      this.voice.update(dt, { state: vs, speed: this.speed, surface: this.surface, distanceToPlayer: this.distToPlayer });
    }
  }

  /** Walk the current path. Returns the speed used this frame. */
  moveAlongPath(dt) {
    if (!this.path || this.seg >= this.path.length - 1) { this.finishPath(); return 0; }
    if (this.pause > 0) { this.pause -= dt; return 0; }
    const a = this.path[this.seg], b = this.path[this.seg + 1];
    const climbing = b.s !== 'ground' && b.s !== 'floor';
    let v = (climbing ? this.cfg.climbSpeed : this.cfg.speed) * (this.flinch > 0 ? 0.15 : 1);
    v *= this.gaitFactor(dt);
    const len = Math.max(0.001, a.p.distanceTo(b.p));
    this.segT += (v * dt) / len;
    while (this.segT >= 1 && this.seg < this.path.length - 1) {
      this.segT -= 1;
      this.seg++;
      const reached = this.path[this.seg];
      if (reached.pause) this.pause = reached.pause;
      if (this.seg >= this.path.length - 1) break;
    }
    if (this.seg >= this.path.length - 1) {
      const last = this.path[this.path.length - 1];
      this.root.position.copy(last.p); this.up.copy(last.n); this.surface = last.s;
      if (last.face) this.fwd.copy(last.face);
      this.finishPath();
      return v;
    }
    const p0 = this.path[this.seg], p1 = this.path[this.seg + 1];
    const t = this.segT;
    this.root.position.lerpVectors(p0.p, p1.p, t);
    if (p1.s === 'ground') this.root.position.y = terrainHeight(this.root.position.x, this.root.position.z);
    this.up.copy(p0.n).lerp(p1.n, t).normalize();
    this.surface = t < 0.5 ? p0.s : p1.s;
    const dir = _d.subVectors(p1.p, p0.p);
    if (dir.lengthSq() > 1e-6) this.fwd.copy(dir.normalize());
    return v;
  }

  /** Speed multiplier that gives each type its own rhythm. */
  gaitFactor(dt) {
    const t = performance.now() / 1000 + this.id * 1.7;
    switch (this.type) {
      case 'runner': {
        // twitchy bursts and sudden freezes
        this.burst -= dt;
        if (this.burst <= 0) {
          if (Math.random() < 0.28) { this.pause = 0.15 + Math.random() * 0.7; }
          this.burst = 0.4 + Math.random() * 1.4;
        }
        return 0.75 + 0.35 * Math.sin(t * 7);
      }
      case 'brute': return 0.75 + 0.3 * Math.max(0, Math.sin(t * 1.6)); // heavy lurching
      case 'stalker': {
        if (Math.random() < dt * 0.25) this.pause = 1 + Math.random() * 2.5;
        return 0.8;
      }
      default: {
        if (Math.random() < dt * 0.12) this.pause = 0.3 + Math.random();
        return 1;
      }
    }
  }

  finishPath() {
    const cb = this.pathDone;
    this.path = null; this.pathDone = null;
    if (cb) cb();
  }

  orient(dt) {
    // build a basis: Y = surface normal, Z = facing direction projected onto the surface
    const up = this.up;
    const f = _f.copy(this.fwd).addScaledVector(up, -this.fwd.dot(up));
    if (f.lengthSq() < 1e-5) f.set(0, 1, 0).addScaledVector(up, -up.y);
    if (f.lengthSq() < 1e-5) f.set(0, 0, 1);
    f.normalize();
    const x = _x.crossVectors(up, f).normalize();
    _m.makeBasis(x, up, f);
    _q.setFromRotationMatrix(_m);
    const rate = this.type === 'runner' ? 14 : this.type === 'brute' ? 4 : 8;
    this.root.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
  }

  // --- window attack ---
  arriveAtWindow() {
    if (this.window.stage >= 4) { this.goInside(); return; }
    this.tryTakeSlot();
  }

  tryTakeSlot() {
    const w = this.window;
    if (w.stage >= 4 && (this.surface === 'glass' || this.type === 'brute')) { this.goInside(); return; }
    const slots = this.mgr.slots[w.id];
    let idx = -1;
    if (this.type === 'brute') idx = slots[0] ? -1 : 0;
    else for (let i = 0; i < slots.length; i++) if (!slots[i] && !(i === 0 && this.mgr.bruteAt(w.id))) { idx = i; break; }
    if (idx < 0) { this.state = 'wait'; this.waitT = 1 + Math.random(); return; }
    slots[idx] = this;
    this.slot = idx;
    const from = this.root.position.clone();
    this.state = 'approach';
    if (this.type === 'brute') {
      this.follow(bruteSlot(from, w), () => this.beginAttack());
    } else if (this.surface === 'wall' || this.surface === 'glass') {
      const s = SLOTS[idx];
      const target = WINDOW_POINT(w, s.u, s.y);
      this.follow([{ p: from, n: this.up.clone(), s: 'wall' }, { p: target, n: w.normal.clone(), s: 'glass' }], () => this.beginAttack());
    } else {
      this.follow(climbToSlot(from, w, SLOTS[idx]), () => this.beginAttack());
    }
  }

  beginAttack() {
    this.state = 'attackWindow';
    this.attackT = 0.6 + Math.random() * 0.8;
    if (this.type === 'brute') this.fwd.copy(this.window.normal).negate();
    else if (this.type === 'climber') this.fwd.set(0, -1, 0);           // head down
    else this.fwd.set((Math.random() - 0.5) * 0.6, 1, 0).normalize();  // splayed on the glass, head up-ish
  }

  updateAttackWindow(dt) {
    const w = this.window;
    if (w.stage >= 4) { this.goInside(); return; }
    this.attackT -= dt;
    if (this.attackT <= 0) {
      this.attackT = this.cfg.attackInterval * (0.75 + Math.random() * 0.5);
      this.attackAnim = 1;
      this.voice?.attack();
      this.mgr.windows.damage(w.id, this.cfg.windowDamage * (0.8 + Math.random() * 0.4), this.root.position);
    }
    // runners dart sideways across the wall and back
    if (this.type === 'runner' && Math.random() < dt * 0.25) {
      const s = SLOTS[this.slot];
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.8);
      const here = this.root.position.clone();
      this.state = 'scuttle';
      this.follow([
        { p: here, n: w.normal.clone(), s: 'glass' },
        { p: WINDOW_POINT(w, s.u + side, s.y + (Math.random() - 0.5) * 0.6), n: w.normal.clone(), s: 'wall' },
        { p: here.clone(), n: w.normal.clone(), s: 'glass' },
      ], () => this.beginAttack());
    }
  }

  goInside() {
    this.releaseSlot();
    this.state = 'enter';
    const w = this.window;
    const from = this.root.position.clone();
    const nodes = enterPath(from, this.up, w);
    if (this.type === 'brute') nodes[0].s = 'ground';
    this.follow(nodes, () => { this.state = 'inside'; this.surface = 'floor'; this.up.copy(UP); });
    this.mgr.events.emit('spiderInside', { spider: this });
  }

  updateInside(dt, player) {
    const p = this.root.position;
    const to = _d.set(player.position.x - p.x, 0, player.position.z - p.z);
    const dist = to.length();
    const reach = this.visual.radius + 0.55;
    this.surface = 'floor';
    this.up.copy(UP);
    if (dist > 0.01) this.fwd.copy(to).normalize();
    let v = 0;
    if (dist > reach && this.attackAnim <= 0.3) {
      v = this.cfg.speed * (this.type === 'runner' ? 0.8 : 1) * (this.flinch > 0 ? 0.2 : 1) * (this.pause > 0 ? 0 : 1);
      if (this.pause > 0) this.pause -= dt;
      p.addScaledVector(this.fwd, Math.min(v * dt, dist - reach));
      this.collide();
    } else {
      this.attackT -= dt;
      if (this.attackT <= 0 && !player.dead) {
        this.attackT = this.cfg.attackInterval * (0.8 + Math.random() * 0.4);
        this.attackAnim = 1;
        this.voice?.attack();
        player.damage(this.cfg.playerDamage);
      }
    }
    p.y = 0;
    return v;
  }

  collide() {
    const p = this.root.position, r = Math.min(0.5, this.visual.radius * 0.6);
    p.x = THREE.MathUtils.clamp(p.x, -CABIN.halfX + r, CABIN.halfX - r);
    p.z = THREE.MathUtils.clamp(p.z, -CABIN.halfZ + r, CABIN.halfZ - r);
    for (const b of this.mgr.colliders) {
      const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX), cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
    }
  }

  // --- stalker ---
  updateWatch(dt, player) {
    this.watchT -= dt;
    this.visual.setEyeGlow(0.7 + 0.3 * Math.sin(performance.now() * 0.002 + this.id));
    // face the cabin
    this.fwd.set(this.window.center.x - this.root.position.x, 0, this.window.center.z - this.root.position.z).normalize();
    const w = this.window;
    if (w.closeness > 0.65 && player.camera.getWorldDirection(_d).dot(w.normal) > 0.5) { this.startVanish(); return; }
    if (this.watchT <= 0) {
      // done watching: come for the window
      this.visual.setEyeGlow(1);
      this.state = 'approach';
      this.follow(groundRoute(w.id, this.routeIndex, { zigzag: 0.2, fromT: this.watchFrac, toT: 1 }), () => this.arriveAtWindow());
    }
  }

  reappear() {
    this.vanishes++;
    const mgr = this.mgr;
    // somewhere else, later
    this.visual.root.visible = false;
    this.state = 'hidden';
    mgr.later(4 + Math.random() * 8, () => {
      if (!this.alive || this.removed) return;
      this.visual.root.visible = true;
      this.fade = 1; this.visual.setOpacity(1);
      const others = WINDOWS.filter((w) => w.id !== this.window.id);
      this.window = mgr.windows.byId[others[Math.floor(Math.random() * others.length)].id];
      if (this.vanishes >= 2) {
        this.state = 'approach';
        this.routeIndex = Math.floor(Math.random() * 3);
        this.follow(groundRoute(this.window.id, this.routeIndex, { zigzag: 0.2, fromT: 0.55 }), () => this.arriveAtWindow());
      } else {
        mgr.startStalker(this);
      }
      this.visual.rig.snapFeet();
    });
  }

  updateDying(dt) {
    this.deadT += dt;
    if (this.fallV) {
      this.fallV.y -= 9.8 * dt;
      this.root.position.addScaledVector(this.fallV, dt);
      const p = this.root.position;
      const inside = Math.abs(p.x) < CABIN.halfX && Math.abs(p.z) < CABIN.halfZ;
      const ground = inside ? 0 : terrainHeight(p.x, p.z);
      this.up.lerp(UP, 1 - Math.exp(-4 * dt)).normalize();
      if (p.y <= ground) {
        p.y = ground; this.fallV = null; this.up.copy(UP);
        this.mgr.audio?.play('bulletImpactWood', { position: p, volume: 0.4, rate: 0.6, exterior: !inside });
      }
    }
    if (this.deadT > 7) {
      this.fade = Math.max(0, 1 - (this.deadT - 7) / 2);
      this.visual.setOpacity(this.fade);
      this.visual.setEyeGlow(0);
      if (this.fade <= 0) this.remove();
    } else {
      this.visual.setEyeGlow(Math.max(0, 1 - this.deadT * 1.5));
    }
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.releaseSlot();
    this.mgr.scene.remove(this.root);
    this.voice?.dispose();
    this.visual.dispose();
  }
}

function WINDOW_POINT(win, u, y) {
  const tangent = _t.crossVectors(UP, win.normal);
  return win.center.clone().addScaledVector(win.normal, CABIN.wallThickness / 2 + 0.03).addScaledVector(tangent, u).setY(y);
}

// ======================================================================
export class SpiderManager {
  constructor({ scene, audio, events, quality, windows, colliders }) {
    this.scene = scene;
    this.audio = audio;
    this.events = events;
    this.quality = quality;
    this.windows = windows;
    this.colliders = colliders || [];
    this.spiders = [];
    this.slots = Object.fromEntries(WINDOWS.map((w) => [w.id, [null, null, null]]));
    this.timers = [];
    this.targets = [];
    this.ichor = [];
    // stalkers flee from light near them
    events.on('lightning', () => { for (const s of this.spiders) if (s.state === 'watch' && Math.random() < 0.8) s.startVanish(); });
    events.on('muzzleFlash', ({ position }) => {
      for (const s of this.spiders) if (s.state === 'watch' && s.window.center.distanceTo(position) < 3) s.startVanish();
    });
  }

  get aliveCount() { return this.spiders.filter((s) => s.alive).length; }
  bruteAt(id) { const s = this.slots[id][0]; return s && s.type === 'brute'; }
  later(t, fn) { this.timers.push({ t, fn }); }

  reset() {
    for (const s of this.spiders) s.remove();
    this.spiders = [];
    this.timers = [];
    for (const id in this.slots) this.slots[id] = [null, null, null];
    for (const d of this.ichor) this.scene.remove(d.mesh);
    this.ichor = [];
  }

  /** Spawn a spider of a type heading for a window. */
  spawn(type, windowId) {
    const s = new Spider(type, this);
    s.window = this.windows.byId[windowId];
    s.routeIndex = Math.floor(Math.random() * 3);
    if (type === 'stalker') {
      this.startStalker(s);
    } else if (type === 'climber') {
      const ground = groundRoute(windowId, s.routeIndex, { zigzag: 0.3, toT: 0.92 });
      const from = ground[ground.length - 1].p;
      const climb = climberRoute(s.window, from);
      s.follow([...ground, ...climb.slice(1)], () => s.arriveAtWindow());
    } else {
      const zig = type === 'runner' ? 0.9 : type === 'brute' ? 0.15 : 0.3;
      s.follow(groundRoute(windowId, s.routeIndex, { zigzag: zig }), () => s.arriveAtWindow());
    }
    s.visual.rig.snapFeet();
    this.spiders.push(s);
    this.events.emit('spiderSpawned', { spider: s });
    return s;
  }

  startStalker(s) {
    s.watchFrac = 0.45 + Math.random() * 0.25; // how far along the route it stops to watch
    s.watchT = Config.waves.stalkerWatchTime[0] + Math.random() * (Config.waves.stalkerWatchTime[1] - Config.waves.stalkerWatchTime[0]);
    s.state = 'approach';
    s.follow(groundRoute(s.window.id, s.routeIndex, { zigzag: 0.2, toT: s.watchFrac }), () => {
      s.state = 'watch';
      s.visual.setEyeGlow(1);
    });
  }

  spawnIchor(point, dir) {
    // a few dark droplets
    if (!this.ichorMat) {
      this.ichorMat = new THREE.MeshBasicMaterial({ color: 0x1c2410, transparent: true, opacity: 0.9 });
      this.ichorGeo = new THREE.SphereGeometry(0.015, 5, 4);
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.ichorGeo, this.ichorMat);
      m.position.copy(point);
      const v = dir.clone().multiplyScalar(-0.8 - Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
      this.scene.add(m);
      this.ichor.push({ mesh: m, v, life: 0.8 + Math.random() * 0.4 });
    }
  }

  update(dt, player) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    this.targets.length = 0;
    for (const s of this.spiders) {
      if (s.state === 'hidden') continue;
      s.update(dt, player);
      if (s.alive && s.state !== 'vanish') this.targets.push(s.visual.hitbox);
    }
    this.spiders = this.spiders.filter((s) => !s.removed);
    for (let i = this.ichor.length - 1; i >= 0; i--) {
      const d = this.ichor[i];
      d.v.y -= 9.8 * dt; d.mesh.position.addScaledVector(d.v, dt); d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.ichor.splice(i, 1); }
    }
  }

  /** 0..1: how bad things are right now (drives ambience and eyes). */
  danger(player) {
    let d = 0;
    for (const s of this.spiders) {
      if (!s.alive) continue;
      if (s.state === 'inside' || s.state === 'enter') d += 0.6;
      else if (s.state === 'attackWindow') d += 0.22;
      else if (s.distToPlayer < 15) d += 0.08;
      else d += 0.02;
    }
    let worst = 0;
    for (const w of this.windows.windows) worst = Math.max(worst, w.stage / 4);
    d += worst * 0.35;
    d += (1 - player.health / Config.player.maxHealth) * 0.3;
    return Math.min(1, d);
  }

  /** Summary for the audio director. */
  summary() {
    return this.spiders.filter((s) => s.alive && s.state !== 'hidden').map((s) => ({ type: s.type, position: s.root.position, state: s.state }));
  }
}

const _d = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3(), _t = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
export { groundNode };
