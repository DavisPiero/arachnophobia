// Procedural spider animation. Three modules do the work:
//   Gait.js          which foot may step and when (neighbour rules; wave / ripple / tetrapod by species and speed)
//   LegIK.js         a stable leg solver (smooth at full stretch, knees splay up and out, never flips)
//   BodyDynamics.js  the body as a weight on springs (sags, lags, leans into turns and speed changes, wobbles)
// and SpiderCollision.js tells the feet what they can stand on (terrain, walls, window frames, roof, floor, ceiling,
// furniture) and pushes the body and knees out of solid geometry.
//
// All maths happen in the spider's local `space` (+Y = surface normal, +Z = forward), so walls and the ceiling work
// as long as the AI orients the root to the surface. Planted feet are kept in WORLD space so they never slide.
//
// Behaviour talks to the rig through `pose` (see update()): crouch, rear, lunge, freeze, shiver, spread, head turn,
// mouth, front legs reaching for a point. Squeezing through a window: every leg grips the frame, the body drops,
// rolls to fit the opening corner to corner and folds its legs in; nothing is scaled down (only a soft abdomen squashes).
import * as THREE from 'three';
import { solveLeg, kinkInfo } from './LegIK.js';
import { Gait } from './Gait.js';
import { BodyDynamics } from './BodyDynamics.js';

// bone indices shared with SpiderModel. Optional face bones (mouth, lids) follow the 58 leg/body bones.
export const BONE = { BODY: 0, ABD: 1, CHEL: 2, PALP: 4, LEG: 10, MOUTH: 58, LID: 59 };
export const BONE_COUNT = 10 + 8 * 6;
export const FACE_BONES = 2;   // mouth (jaw), lids

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
const _acc = { x: 0, z: 0 }, _tg = { y: 0, x: 0, z: 0, pitch: 0, roll: 0, yaw: 0 };
const _probe = {}, _pick = [];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

// organic noise: sum of sines with per-instance random incommensurate frequencies
function makeNoise(rand, n = 3) {
  const f = [], p = [];
  for (let i = 0; i < n; i++) { f.push((0.6 + rand() * 1.4) * Math.pow(1.9, i)); p.push(rand() * 100); }
  return (t) => { let s = 0, w = 1, tw = 0; for (let i = 0; i < n; i++) { s += Math.sin(t * f[i] + p[i]) * w; tw += w; w *= 0.5; } return s / tw; };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dead pose: absolute segment angles in the leg plane (0 = straight out, +up), legs folded in under the body.
const DEAD = [0.1, 0.4, -1.5, -2.4, -2.95, -3.4];
const NO_POSE = {};

export class SpiderRig {
  /**
   * def: rig numbers (restR, bodyH, alpha, coxaElev, stepMin, stepMax, strideK, arc, gait, mass, splay, soft, ...)
   * layout: leg layout from the model. collision: SpiderCollision (optional; without it feet use `ground`).
   */
  constructor({ space, bones, def, layout, seed = 1, collision = null, mass }) {
    this.space = space;
    this.bones = bones;
    this.def = def;
    this.layout = layout;
    this.collision = collision;
    this.onStep = null;
    const r = this.rand = rng(seed * 7 + 3);
    this.time = r() * 100;
    this.vel = new THREE.Vector3();
    this.velPrev = new THREE.Vector3();
    this.speed = 0;
    this.turn = 0;
    this.prevPos = new THREE.Vector3();
    this.inv = new THREE.Matrix4();
    this.inited = false;
    this.deadK = 0;
    this.attackK = 0;
    this.atk = 0;
    this.idleTimer = 1 + r() * 3;
    this.bodyMat = new THREE.Matrix4();
    this.bodyQ = new THREE.Quaternion();
    this.bodyPos = new THREE.Vector3();
    this.squeezeK = 0;
    this.joltK = 0;
    this.gait = new Gait(def.gait === 'wave' ? 'wave' : def.gait === 'ripple' ? 'ripple' : 'tetrapod');
    this.body = new BodyDynamics(mass ?? def.mass ?? 1);
    this.body.reset(def.bodyH);
    this.nBob = makeNoise(r); this.nRoll = makeNoise(r); this.nYaw = makeNoise(r); this.nPitch = makeNoise(r);
    this.nBreath = makeNoise(r, 2); this.nPalpL = makeNoise(r); this.nPalpR = makeNoise(r); this.nChel = makeNoise(r);
    this.nAbd = makeNoise(r); this.nShiver = makeNoise(r, 2);
    this.legs = layout.legs.map((l, i) => ({
      ...l, index: i,
      pt: kinkInfo(l.lens[2], l.lens[3], 0.22), mt: kinkInfo(l.lens[4], l.lens[5], 0.3),
      foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), targetW: new THREE.Vector3(),
      jitter: new THREE.Vector3(), d: new THREE.Vector3().copy(l.dir), ang: new Float32Array(6),
      pos: Array.from({ length: 6 }, () => new THREE.Vector3()), q: Array.from({ length: 6 }, () => new THREE.Quaternion()),
      end: new THREE.Vector3(),
      stepping: false, t: 0, dur: 0.2, arc: 0.1, err: 0, stretch: 0, locked: false, inited: false,
      twitch: 0, twitchTimer: 0.5 + r() * 4, noise: makeNoise(r, 2), raise: 0, hitK: 0, grip: null, splayK: 0,
    }));
  }

  /** Re-plant all feet at their rest positions (after spawn / teleport). */
  snapFeet() {
    const s = this.space;
    s.updateWorldMatrix(true, false);
    for (const l of this.legs) {
      l.foot.copy(l.rest).applyMatrix4(s.matrixWorld);
      l.stepping = false; l.t = 0; l.inited = false;
    }
    this.prevPos.setFromMatrixPosition(s.matrixWorld);
    this.vel.set(0, 0, 0); this.velPrev.set(0, 0, 0);
    this.body.reset(this.def.bodyH);
    this.inited = true;
  }

  /**
   * Advance the animation. Call once per frame AFTER setting root.position / root.quaternion.
   * mode: 'walk' | 'idle' | 'attack' | 'dead'. attack: 0..1 (0-0.5 rear up, 0.55-1 lunge/strike).
   * ground: optional (x, z) -> height, used when there is no collision world.
   * squeeze: { center, normal, tangent, width, height, depth, k } while passing through a window (center = middle of
   *   the opening on the wall's inner face, normal = out of the cabin).
   * pose (all optional, 0..1 unless said): crouch, rear, lunge, freeze, shiver, spread, headYaw/headPitch (rad),
   *   mouth, lids, reach (world point the front legs claw at), reachK.
   */
  update(dt, { turnRate = 0, mode = 'walk', attack = 0, thrash = 0, ground = null, squeeze = null, pose = NO_POSE } = {}) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    this.joltK *= Math.exp(-dt * 6);
    for (const l of this.legs) l.hitK *= Math.exp(-dt * 5);
    const jolt = Math.min(1.4, this.joltK);
    const def = this.def, lay = this.layout, R = def.restR, H = def.bodyH, r = this.rand;
    this.time += dt;
    const T = this.time;
    const space = this.space;
    space.updateWorldMatrix(true, false);
    if (!this.inited) this.snapFeet();
    const inv = this.inv.copy(space.matrixWorld).invert();
    const scaleW = space.matrixWorld.getMaxScaleOnAxis();
    const upW = _w.set(0, 1, 0).transformDirection(space.matrixWorld);

    // ---- velocity in local space, from the root's actual motion (feet never slide whatever the AI does)
    const prevLocal = _v.copy(this.prevPos).applyMatrix4(inv);
    const raw = _v2.copy(prevLocal).multiplyScalar(-1 / dt);
    raw.y = 0;
    this.prevPos.setFromMatrixPosition(space.matrixWorld);
    if (raw.length() > 40 * R) { this.snapFeet(); raw.set(0, 0, 0); }
    this.velPrev.copy(this.vel);
    this.vel.lerp(raw, 1 - Math.exp(-dt * 10));
    const spd = this.speed = this.vel.length();
    _acc.x = (this.vel.x - this.velPrev.x) / dt; _acc.z = (this.vel.z - this.velPrev.z) / dt;
    this.turn = lerp(this.turn, turnRate, 1 - Math.exp(-dt * 8));

    // ---- mode blends
    const wasDead = this.deadK > 0;
    this.deadK = clamp(this.deadK + (mode === 'dead' ? dt / 0.6 : -dt / 0.8), 0, 1);
    if (wasDead && this.deadK === 0) this.snapFeet();
    const dead = smooth(0, 1, this.deadK);
    this.attackK = lerp(this.attackK, mode === 'attack' ? 1 : 0, 1 - Math.exp(-dt * 7));
    this.atk = lerp(this.atk, mode === 'attack' ? clamp(attack, 0, 1) : 0, 1 - Math.exp(-dt * 18));
    const aK = this.attackK, atk = this.atk;
    const rear = Math.max(pose.rear || 0, aK * smooth(0.0, 0.5, atk) * (1 - smooth(0.6, 0.9, atk)));
    const lunge = Math.max(pose.lunge || 0, aK * smooth(0.55, 0.95, atk));
    const crouch = pose.crouch || 0, freeze = pose.freeze || 0, spread = pose.spread || 0;
    const shiver = (pose.shiver || 0) * (1 - dead);
    const idle = mode === 'idle' || (spd < 0.03 * R && mode !== 'attack');

    // squeeze progress (0 outside .. 1 in the middle of the wall)
    this.squeezeK = lerp(this.squeezeK, squeeze ? squeeze.narrow ?? 0 : 0, 1 - Math.exp(-dt * 6));
    const sq = this.squeezeK;
    if (squeeze) this._grips(squeeze, space);
    else for (const l of this.legs) l.grip = null;

    // ---- step thresholds: bigger and slower steps for bigger, heavier bodies
    const thr = Math.min(R * 0.75, R * 0.28 + spd * def.strideK) * (1 - 0.35 * spread);
    // a swing lasts about as long as the body takes to cover most of a step; a slow walker (wave) takes its time
    const durBase = clamp((thr / Math.max(spd, 1e-3)) * (def.gait === 'wave' ? 1.1 : 0.8), def.stepMin * 0.6, def.stepMax * (def.gait === 'wave' ? 1.5 : 1));
    // how many feet must be up at once to keep pace: swing time over the whole cycle (swing + time planted)
    const planted = thr * 1.6 / Math.max(spd, 1e-3);
    this.gait.setDemand(8 * durBase / (durBase + planted));
    const lead = smooth(0.02 * R, 0.25 * R, spd);

    // occasional idle repositioning step (unpredictable fidget); none while frozen
    let fidget = -1;
    if (idle && dead === 0 && freeze < 0.5) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) { fidget = Math.floor(r() * 8); this.idleTimer = 1.2 + r() * 4.5; }
    }

    // ---- foot targets and how badly each foot wants to move
    const coll = this.collision;
    const bodyW = _v3.set(0, H, lay.bodyZ0).applyMatrix4(space.matrixWorld);
    for (const l of this.legs) {
      l.locked = dead > 0 || l.raise > 0.05;
      const ang = this.turn * durBase * 0.6;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // spread pushes feet out wide (threat display); crouch pulls them in a little
      const wide = 1 + spread * 0.28 - crouch * 0.08;
      const rx = l.rest.x * wide, rz = (l.rest.z - lay.bodyZ0) * wide + lay.bodyZ0;
      const tL = _v.set(rx * ca + rz * sa, 0, -rx * sa + rz * ca);
      // lead: put the foot where the body will be when this step lands
      if (spd > 1e-4) tL.addScaledVector(this.vel, (thr * 0.55 * lead) / spd);
      tL.add(l.jitter);
      const tw = l.targetW;
      if (squeeze && l.grip) tw.copy(l.grip);
      else {
        tw.copy(tL).applyMatrix4(space.matrixWorld);
        if (coll) {
          const hit = coll.footProbe(tw, upW, R * scaleW * 0.9, bodyW, _probe);
          if (hit) tw.copy(hit.p);
        } else if (ground) tw.y = ground(tw.x, tw.z);
      }
      if (!l.stepping) {
        const fl = _v2.copy(l.foot).applyMatrix4(inv), tl = _Y.copy(tw).applyMatrix4(inv);
        const dist = squeeze ? fl.distanceTo(tl) : Math.hypot(fl.x - tl.x, fl.z - tl.z);
        const off = Math.abs(fl.y - tl.y);
        l.err = squeeze ? dist / (R * 0.08) : Math.max(dist / thr, off / Math.max(R * 0.05, thr * 0.25));
        if (freeze > 0.5) l.err *= 0.25;   // frozen: only a badly misplaced foot moves
        // stretch is measured NOW, hip to foot (the old rig used last frame's IK result, a feedback loop)
        const A = _Z.copy(l.attach).applyMatrix4(this.bodyMat);
        l.stretch = A.distanceTo(fl) / (l.lens.reduce((a, b) => a + b, 0) * 0.97);
        if (fidget === l.index && !squeeze) { l.err = 1.5; l.jitter.set((r() - 0.5) * R * 0.12, 0, (r() - 0.5) * R * 0.12); }
      }
    }

    // ---- gait: who lifts a foot now
    const gaitMax = this.gait.maxAir;
    if (squeeze) this.gait.maxAir = 1;
    for (const i of this.gait.pick(this.legs, _pick)) {
      const l = this.legs[i];
      l.stepping = true; l.t = 0; l.from.copy(l.foot);
      const dist = l.from.distanceTo(l.targetW) / scaleW;
      l.dur = squeeze ? def.stepMax * 0.9 : (fidget === i ? def.stepMax * 1.2 : durBase * (0.9 + r() * 0.2));
      l.arc = clamp(dist * 0.45 + R * 0.04, R * 0.05, R * def.arc);
      if (fidget !== i) l.jitter.set((r() - 0.5) * R * 0.05, 0, (r() - 0.5) * R * 0.05);
    }
    this.gait.maxAir = gaitMax;

    // ---- swing feet
    for (const l of this.legs) {
      if (!l.stepping) continue;
      l.t = Math.min(1, l.t + dt / l.dur);
      // the landing point tracks the target for most of the swing, then commits
      if (l.t < 0.75) l.to.copy(l.targetW);
      const t = l.t;
      const e = t * t * t * (t * (t * 6 - 15) + 10);           // smootherstep: no jerk at lift-off or landing
      const lift = Math.sin(Math.PI * Math.pow(t, 0.75));      // quick lift, slow careful placement
      l.foot.copy(l.from).lerp(l.to, e).addScaledVector(upW, l.arc * scaleW * lift);
      // keep the swinging foot out of walls and furniture: lift it higher
      if (coll && coll.pointInside(l.foot, -0.01)) l.foot.addScaledVector(upW, l.arc * scaleW * 0.8);
      if (l.t >= 1) {
        l.foot.copy(l.to);
        l.stepping = false;
        if (this.onStep) this.onStep(l.foot);
        // heavy bodies thud down a little on every footfall
        this.body.kick({ y: -0.04 * H * (this.body.mass - 0.5) });
      }
    }

    // ---- body targets: height and tilt from where the planted feet stand, weight shift, attack / pose
    let swing = 0, sy = 0, n = 0, front = 0, nf = 0, back = 0, nb = 0, left = 0, nl = 0, right = 0, nr = 0, cx = 0, cz = 0, rcx = 0, rcz = 0;
    for (const l of this.legs) {
      if (l.stepping) { swing += Math.sin(Math.PI * l.t); continue; }
      const f = _v.copy(l.foot).applyMatrix4(inv);
      sy += f.y; n++; cx += f.x; cz += f.z; rcx += l.rest.x; rcz += l.rest.z;
      if (l.pair <= 1) { front += f.y; nf++; } else { back += f.y; nb++; }
      if (l.side > 0) { right += f.y; nr++; } else { left += f.y; nl++; }
    }
    const lim = squeeze ? 0.3 : 1;   // gripping a frame: the feet are all over the place, keep the body mostly level
    const lift = n ? clamp(sy / n, -R * 0.4, R * 0.4) * lim : 0;
    const moveK = smooth(0, R * 0.6, spd);
    const breath = this.nBreath(T * 0.9);
    const sh = shiver * (0.5 + 0.5 * this.nShiver(T * 3));
    const tg = _tg;
    tg.y = H * (1 - 0.45 * crouch + 0.15 * spread) - swing / Math.max(2, gaitMax) * H * 0.1 * moveK + lift
      + H * 0.02 * this.nBob(T * 0.7) * (1 - freeze) + H * 0.015 * breath
      + rear * (H * 0.55 + R * 0.08) - lunge * H * 0.25 - squeezeDrop(squeeze, sq, H);
    // weight shifts towards the planted feet (off a lifted leg)
    tg.x = n ? (cx / n - rcx / n) * 0.25 * lim : 0;
    tg.z = lay.bodyZ0 + (n ? (cz / n - rcz / n) * 0.25 * lim : 0) + R * 0.02 * this.nBob(T * 0.31 + 4) * (1 - freeze) - rear * R * 0.14 + lunge * R * 0.32;
    tg.pitch = (nf && nb ? clamp(-Math.atan2(front / nf - back / nb, R * 1.1), -0.4, 0.4) * lim : 0)
      + 0.03 * this.nPitch(T * 0.5) * (1 - freeze) - rear * 0.6 + lunge * 0.2 - aK * 0.08 + crouch * 0.12 + (pose.headPitch || 0) * 0.3;
    tg.roll = (nl && nr ? clamp(Math.atan2(right / nr - left / nl, R * 1.4), -0.35, 0.35) * lim : 0)
      - clamp(this.turn * spd / R * 0.05, -0.2, 0.2) + 0.035 * this.nRoll(T * 0.6) * (0.4 + moveK) * (1 - freeze) + squeezeRoll(squeeze, sq, def);
    tg.yaw = 0.03 * this.nYaw(T * 0.4) * (1 - freeze) + clamp(this.turn * 0.04, -0.12, 0.12) + (pose.headYaw || 0) * 0.35;
    // hit: crumple down and rear back for a moment
    tg.y -= jolt * H * 0.32; tg.pitch -= jolt * 0.22;
    if (thrash > 0) { tg.y -= thrash * H * 0.25; }
    this.body.update(tg, _acc, dt, Math.max(freeze, sq));
    const B = this.body;
    let y = B.y.x, z = B.fz.x, x = B.fx.x, pitch = B.pitch.x, roll = B.roll.x + jolt * 0.12 * this.nRoll(T * 7), yaw = B.yaw.x;
    // shiver: a fast, fine tremor through the whole body (fear, anticipation, something wrong)
    if (sh > 0) { y += sh * H * 0.04 * Math.sin(T * 61); roll += sh * 0.05 * Math.sin(T * 47 + 1); yaw += sh * 0.04 * Math.sin(T * 53 + 2); }
    if (thrash > 0) { roll += thrash * 0.45 * Math.sin(T * 9.3); pitch += thrash * 0.25 * Math.sin(T * 11.7); }
    const deadY = def.ceph.ry * 0.85;
    y = lerp(y, deadY, dead); pitch = lerp(pitch, 0.12, dead); roll = lerp(roll, 0.08, dead); x = lerp(x, 0, dead);
    this.bodyPos.set(x, y, z);
    // the body itself never goes through a wall, the window frame, the floor or the ceiling
    if (coll && dead === 0) {
      const c = _v.copy(this.bodyPos).applyMatrix4(space.matrixWorld);
      const before = _v2.copy(c);
      if (coll.pushOutSphere(c, Math.max(def.ceph.ry, def.ceph.rx * 0.8) * scaleW)) {
        const dw = c.sub(before), len = dw.length();
        if (len > 1e-6) this.bodyPos.addScaledVector(dw.transformDirection(inv), len / scaleW);
      }
    }
    this.bodyQ.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    this.bodyMat.compose(this.bodyPos, this.bodyQ, _v.set(1, 1, 1));
    const bodyBone = this.bones[BONE.BODY];
    bodyBone.position.copy(this.bodyPos); bodyBone.quaternion.copy(this.bodyQ);
    bodyBone.scale.set(1, 1, 1);

    // ---- abdomen: breathing pulse, lag, sway, a soft one's wobble; only a soft abdomen squashes in a window
    {
      const b = this.bones[BONE.ABD];
      b.position.copy(lay.abdAttach).applyMatrix4(this.bodyMat);
      const pulse = 0.5 + 0.5 * Math.sin(T * (2.2 + 0.4 * breath + shiver * 4));
      const wob = B.wob.x * (def.soft ? 1.6 : 0.4);
      const tilt = def.abd.tilt + 0.04 * this.nAbd(T * 0.8) + wob * 0.6 + rear * 0.25 - dead * (def.abd.tilt + 0.1) + clamp(-_acc.z * 0.004, -0.1, 0.1) - crouch * 0.1;
      _q.setFromEuler(_e.set(tilt, 0.05 * this.nAbd(T * 0.45 + 3) - this.turn * 0.04, 0.03 * this.nAbd(T * 0.6 + 7) + wob * 0.3, 'YXZ'));
      b.quaternion.copy(this.bodyQ).multiply(_q);
      const br = (0.012 + 0.012 * (1 - moveK)) * pulse * (1 - dead) * (def.soft ? 2.2 : 1);
      const squash = def.soft ? sq * 0.3 : 0;
      b.scale.set((1 + br + wob * 0.1) * (1 - squash), (1 + br * 1.4 - wob * 0.1) * (1 - squash * 0.6), (1 + br * 0.4) * (1 + squash * 0.9));
    }

    // ---- chelicerae: slow flexing, open on attack and with the mouth
    const mouth = Math.max(pose.mouth || 0, aK * smooth(0.3, 0.8, atk));
    for (let s = 0; s < 2; s++) {
      const c = lay.chel[s], b = this.bones[BONE.CHEL + s];
      b.position.copy(c.attach).applyMatrix4(this.bodyMat);
      const tw = Math.max(0, this.nChel(T * 1.3 + s * 5)) * (1 - freeze * 0.7);
      const open = 0.05 + tw * tw * 0.25 + aK * 0.15 + mouth * 0.45 - dead * 0.1;
      const fwd = 0.1 * this.nChel(T * 0.7 + s) + aK * (-0.25 * rear - 0.3 * lunge) + dead * 0.3;
      _q.setFromEuler(_e.set(fwd, 0, c.side * open, 'YXZ'));
      b.quaternion.copy(this.bodyQ).multiply(_q);
    }
    // optional face bones: the mouth opens (a smile widening), the lids blink
    const mb = this.bones[BONE.MOUTH];
    if (mb && lay.mouth) {
      mb.position.copy(lay.mouth.attach).applyMatrix4(this.bodyMat);
      _q.setFromEuler(_e.set(mouth * (lay.mouth.open ?? 0.6), 0, 0, 'YXZ'));
      mb.quaternion.copy(this.bodyQ).multiply(_q);
      mb.scale.set(1 + mouth * (lay.mouth.widen ?? 0.25), 1, 1);
    }
    const lb = this.bones[BONE.LID];
    if (lb && lay.lids) {
      lb.position.copy(lay.lids.attach).applyMatrix4(this.bodyMat);
      lb.quaternion.copy(this.bodyQ);
      const lids = clamp(pose.lids ?? 0, 0, 1);
      lb.scale.set(1, Math.max(0.02, 1 - lids), 1);
    }

    // ---- pedipalps: rubbing, tapping, flaring on attack
    for (let s = 0; s < 2; s++) {
      const p = lay.palps[s], nz = s ? this.nPalpR : this.nPalpL;
      const rub = nz(T * (1.6 + 0.5 * moveK + (pose.palpRub || 0) * 4)) * (1 - freeze * 0.8);
      const flare = aK * (0.35 + 0.65 * rear) + spread * 0.4;
      const spr = 0.25 + 0.15 * nz(T * 0.5 + 2) + flare * 0.9 - dead * 0.2;
      const a0 = 0.55 + 0.25 * rub + flare * 0.8 + dead * 0.6;
      const a1 = -0.7 + 0.35 * nz(T * 1.1 + 9) + flare * 0.2 - dead * 1.2;
      const a2 = -1.45 + 0.3 * rub - flare * 0.2 - dead * 0.8;
      _v3.set(p.side * Math.sin(spr), 0, Math.cos(spr));
      this._chainFK(BONE.PALP + s * 3, p.attach, _v3, [a0, a1, a2], p.lens);
    }

    // ---- legs: effective foot (planted, twitching, raised for an attack or a reach), then IK
    const reachL = pose.reach ? _Z.copy(pose.reach).applyMatrix4(inv) : null;
    for (const l of this.legs) {
      const A = _v3.copy(l.attach).applyMatrix4(this.bodyMat);
      const raiseT = (l.pair === 0 ? Math.max(aK * (0.5 + 0.5 * smooth(0, 0.4, atk)), (pose.reachK || 0)) : l.pair === 1 ? Math.max(aK * 0.3 * smooth(0, 0.5, atk), (pose.reachK || 0) * 0.35) : 0)
        + (l.pair === 0 ? rear * 0.4 : 0);
      l.raise = lerp(l.raise, clamp(raiseT, 0, 1), 1 - Math.exp(-dt * 10));
      // idle twitch: lift a planted foot a little and put it back
      l.twitchTimer -= dt;
      if (l.twitchTimer <= 0) {
        l.twitchTimer = (idle ? 0.8 : 2.5) + r() * (idle ? 5 : 8);
        if (!l.stepping && spd < 0.3 * R && freeze < 0.5) l.twitch = 0.4 + r() * 0.6;
      }
      l.twitch = Math.max(0, l.twitch - dt * 2.4);
      const twv = Math.sin(Math.min(1, l.twitch) * Math.PI) * (1 - dead);
      const F = _v2.copy(l.foot).applyMatrix4(inv);
      F.y += twv * R * 0.07;
      if (sh > 0 && !l.stepping) F.y += sh * R * 0.012 * Math.max(0, Math.sin(T * 37 + l.index * 2.1));
      if (l.raise > 0.001) {
        const wv = l.noise(T * 2.2);
        let hx = A.x + l.side * R * (0.2 + 0.08 * wv), hy = H * 1.6 + R * (0.38 + 0.05 * wv), hz = A.z + R * 0.4;
        if (reachL && l.pair <= 1) {
          // claw towards a point (the glass, the player): front legs scrape at it
          hx = lerp(hx, reachL.x + l.side * R * 0.15, 0.8); hy = lerp(hy, reachL.y + R * 0.1 * Math.sin(T * 9 + l.index), 0.8); hz = lerp(hz, reachL.z, 0.8);
        }
        const sx = A.x + l.side * R * 0.12, sy = H * 0.25, sz = A.z + R * 0.95;
        const k = l.pair === 0 ? lunge : 0;
        F.lerp(_X.set(lerp(hx, sx, k), lerp(hy, sy, k), lerp(hz, sz, k)), l.raise);
      }
      if (jolt > 0.01) { F.x = lerp(F.x, A.x, jolt * 0.3); F.z = lerp(F.z, A.z, jolt * 0.3); F.y += jolt * R * 0.12; }
      if (l.hitK > 0.01) { F.y += l.hitK * R * 0.4; F.x += l.side * l.hitK * R * 0.12; }
      if (thrash > 0) {
        const ph = l.index * 1.37;
        F.x += l.side * R * 0.28 * thrash * Math.sin(T * 21 + ph);
        F.y += R * 0.45 * thrash * Math.max(0, Math.sin(T * 17 + ph * 1.6));
        F.z += R * 0.2 * thrash * Math.sin(T * 14 + ph * 0.7);
      }
      this._solve(l, A, F, dead, sq, dt, coll, space);
    }
  }

  /** IK for one leg, folding the knee the other way if it would go through a wall (window frame). */
  _solve(l, A, F, dead, sq, dt, coll, space) {
    const def = this.def;
    const base = (def.splay ?? 0.25) * (l.pair <= 1 ? 1 : -1) * (1 + sq * 1.2);
    // knee fold: eased in and out over a few frames (never a jump), held while the knee is near a wall
    l.foldT = Math.max(0, (l.foldT || 0) - dt);
    l.splayK = lerp(l.splayK, l.foldT > 0 ? -base * 2.6 : 0, 1 - Math.exp(-dt * 7));
    const opts = {
      alpha: def.alpha, coxaElev: def.coxaElev, dt, splay: base + l.splayK,
      override: dead > 0 ? (ang, d) => {
        const v = (l.pair - 1.5) * 0.12;
        for (let k = 0; k < 6; k++) ang[k] = lerp(ang[k], DEAD[k] + v * (k > 1 ? 1 : 0) + (l.side > 0 ? 0.04 : -0.03) * k, dead);
        d.lerp(l.dir, dead).normalize();
      } : null,
    };
    solveLeg(l, A, F, opts);
    if (coll && dead === 0) {
      const knee = _X.copy(l.pos[2]).applyMatrix4(space.matrixWorld);
      if (coll.pointInside(knee, -0.005)) {
        // fold the knee sideways the other way (gradually, see above) and hold it so it does not flicker back
        l.foldT = 0.6;
      }
    }
    const b0 = BONE.LEG + l.index * 6;
    for (let k = 0; k < 6; k++) {
      const b = this.bones[b0 + k];
      b.position.copy(l.pos[k]);
      b.quaternion.copy(l.q[k]);
    }
  }

  /**
   * Squeeze grips: front legs reach through and grip the inside of the wall beside the opening, middle legs grip the
   * jambs (the sides of the hole), back legs push off the sill and the outside wall. As the body passes, each grip
   * moves to the side of the wall the leg can reach.
   */
  _grips(sq, space) {
    const { center, normal, tangent, width, height, depth } = sq;
    const sill = center.y - height / 2;
    for (const l of this.legs) {
      const reach = _v.copy(l.rest).lerp(_v2.set(0, 0, this.layout.bodyZ0), 0.4).applyMatrix4(space.matrixWorld);
      const depthAt = _v3.copy(reach).sub(center).dot(normal);    // <0 inside the room, 0..depth in the wall, >depth outside
      const sideSign = Math.sign(_X.copy(reach).sub(center).dot(tangent)) || l.side;
      const g = l.grip || (l.grip = new THREE.Vector3());
      if (depthAt < -0.02) {
        // inside: on the inner wall face beside the opening, front legs high, back legs low
        const v = [0.85, 0.55, 0.3, 0.1][l.pair];
        g.copy(center).addScaledVector(tangent, sideSign * (width / 2 + 0.05 + 0.04 * l.pair)).setY(sill + v * height).addScaledVector(normal, -0.015);
      } else if (depthAt < depth + 0.03) {
        // in the hole: on the jamb itself (the side of the opening) or on the sill, folded in tight
        const onSill = l.pair >= 2;
        if (onSill) g.copy(center).addScaledVector(tangent, sideSign * width * 0.32).setY(sill + 0.005).addScaledVector(normal, clamp(depthAt, 0.02, depth - 0.02));
        else g.copy(center).addScaledVector(tangent, sideSign * (width / 2 - 0.005)).setY(sill + (0.35 + 0.2 * (1 - l.pair)) * height).addScaledVector(normal, clamp(depthAt, 0.02, depth - 0.02));
      } else {
        // outside: on the outer wall face beside / below the opening
        const v = [0.95, 0.6, 0.15, -0.25][l.pair];
        g.copy(center).addScaledVector(tangent, sideSign * (width / 2 + 0.06 + 0.04 * l.pair)).setY(sill + v * height).addScaledVector(normal, depth + 0.015);
      }
      // out of reach (a long way round the wall): grip the edge of the jamb nearest the hip instead
      const hip = _Y.copy(l.attach).applyMatrix4(this.bodyMat).applyMatrix4(space.matrixWorld);
      const legLen = l.lens.reduce((a, b) => a + b, 0) * space.matrixWorld.getMaxScaleOnAxis() * 0.9;
      if (hip.distanceTo(g) > legLen) {
        const dh = clamp(_v3.copy(hip).sub(center).dot(normal), 0.01, depth - 0.01);
        const yy = clamp(hip.y, sill + 0.02, sill + height * 0.8);
        g.copy(center).addScaledVector(tangent, sideSign * (width / 2 - 0.005)).setY(yy).addScaledVector(normal, dh);
        if (hip.distanceTo(g) > legLen) g.sub(hip).setLength(legLen).add(hip);   // still too far: as far as it reaches
      }
    }
  }

  /** A hit: the whole body jolts (k ~0.4 leg hit .. 1 body hit .. 1.4 stagger). */
  jolt(k) { this.joltK = Math.max(this.joltK, k); this.body.kick({ y: -k * this.def.bodyH * 2, pitch: -k * 1.5 }); }

  /** A leg was hit at this world point: the nearest leg kicks. */
  hitLeg(point) {
    let best = null, bd = Infinity;
    for (const l of this.legs) { const d = l.foot.distanceToSquared(point); if (d < bd) { bd = d; best = l; } }
    if (best) best.hitK = 1;
  }

  /** A sudden shove on the body (lunge recoil, landing). */
  kick(k) { this.body.kick(k); }

  // FK for a chain in the body frame (palps). angles are absolute in the (dir, up) plane.
  _chainFK(firstBone, attach, dir, angles, lens) {
    const p = _Y.copy(attach);
    const side = _Z.crossVectors(dir, UP).normalize();
    for (let k = 0; k < angles.length; k++) {
      const a = angles[k];
      const X = _X.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
      const Yv = _v.crossVectors(side, X);
      _m.makeBasis(X, Yv, side);
      _q.setFromRotationMatrix(_m);
      const b = this.bones[firstBone + k];
      b.position.copy(p).applyMatrix4(this.bodyMat);
      b.quaternion.copy(this.bodyQ).multiply(_q);
      p.addScaledVector(X, lens[k]);
    }
  }
}

/** How far the body drops to pass under the lintel: as low as it can while in the wall. */
function squeezeDrop(squeeze, k, H) { return squeeze ? k * H * 0.55 : 0; }

/** Roll the body to fit the opening corner to corner when it is wider than the hole is tall. */
function squeezeRoll(squeeze, k, def) {
  if (!squeeze) return 0;
  const w = Math.max(def.ceph.rx, def.abd.r * (def.abd.sx ?? 1)) * 2;
  const tooWide = smooth(squeeze.height * 0.35, squeeze.height * 0.8, w);
  return k * (0.25 + 0.35 * tooWide) * (def.rollSign ?? 1);
}
