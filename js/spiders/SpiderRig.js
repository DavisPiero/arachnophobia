// Procedural spider animation: planted feet, per-species gait (alternating tetrapod, or a slow one-leg-at-a-time wave),
// analytic IK, body bob/sway, idle twitches, attack rear-up/lunge, death curl.
// Feet land on the real ground (a height function from the AI); the body lifts and tilts to follow where its feet stand.
// Squeezing through a window: every leg grips the window frame (inside or outside the wall, whichever side it reaches
// for), re-gripping one leg at a time, while the body narrows as it passes the wall.
//
// All maths happen in the spider's local `space` (+Y = surface normal, +Z = forward), so walking on
// walls and the roof works as long as the AI orients the root to the surface. Feet are kept in WORLD
// space while planted, so they never slide when the body moves.
import * as THREE from 'three';

// bone indices shared with SpiderModel
export const BONE = { BODY: 0, ABD: 1, CHEL: 2, PALP: 4, LEG: 10 };
export const BONE_COUNT = 10 + 8 * 6;

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

// angle offset so that a two-piece kinked limb (a then b, b bent down by kink) has its chord along 0
function kinkInfo(a, b, kink) {
  return { psi: Math.atan2(b * Math.sin(kink), a + b * Math.cos(kink)), len: Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(kink)) };
}

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

export class SpiderRig {
  constructor({ space, bones, def, layout, seed = 1 }) {
    this.space = space;
    this.bones = bones;
    this.def = def;
    this.layout = layout;
    this.onStep = null;
    const r = this.rand = rng(seed * 7 + 3);
    this.time = r() * 100;
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.turn = 0;
    this.prevPos = new THREE.Vector3();
    this.inv = new THREE.Matrix4();
    this.inited = false;
    this.deadK = 0;
    this.attackK = 0;
    this.atk = 0;
    this.idleTimer = 1 + r() * 3;
    this.accel = 0;
    this.prevSpeedZ = 0;
    this.bodyMat = new THREE.Matrix4();
    this.bodyQ = new THREE.Quaternion();
    this.bodyPos = new THREE.Vector3();
    this.feetLift = 0; this.feetPitch = 0; this.feetRoll = 0;   // body follows where its feet actually stand
    this.squeezeK = 0;
    this.nBob = makeNoise(r); this.nRoll = makeNoise(r); this.nYaw = makeNoise(r); this.nPitch = makeNoise(r);
    this.nBreath = makeNoise(r, 2); this.nPalpL = makeNoise(r); this.nPalpR = makeNoise(r); this.nChel = makeNoise(r);
    this.nAbd = makeNoise(r);
    const lmt = (l) => {
      const pt = kinkInfo(l.lens[2], l.lens[3], 0.22);
      const mt = kinkInfo(l.lens[4], l.lens[5], 0.3);
      return { pt, mt };
    };
    this.legs = layout.legs.map((l, i) => ({
      ...l, index: i, ...lmt(l),
      foot: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(), jitter: new THREE.Vector3(),
      stepping: false, t: 0, dur: 0.2, arc: 0.1, stretched: false,
      twitch: 0, twitchTimer: 0.5 + r() * 4, ang: new Float32Array(6), d: new THREE.Vector3().copy(l.dir), noise: makeNoise(r, 2),
      raise: 0, targetW: new THREE.Vector3(), grip: null,
    }));
  }

  /** Re-plant all feet at their rest positions (after spawn / teleport). */
  snapFeet() {
    const s = this.space;
    s.updateWorldMatrix(true, false);
    for (const l of this.legs) {
      l.foot.copy(l.rest).applyMatrix4(s.matrixWorld);
      l.stepping = false; l.t = 0; l.stretched = false;
    }
    this.prevPos.setFromMatrixPosition(s.matrixWorld);
    this.vel.set(0, 0, 0);
    this.inited = true;
  }

  /**
   * Advance the animation. Call once per frame AFTER setting root.position / root.quaternion.
   * Gait speed is measured from the root's actual motion (so feet never slide even if `speed` is off);
   * `speed` is accepted for API symmetry, `turnRate` (rad/s) leads foot placement and banks the body.
   * mode: 'walk' | 'idle' | 'attack' | 'dead'. attack: 0..1 (0-0.5 rear up, 0.55-1 lunge/strike).
   */
  /**
   * ground: optional (x, z) -> world height, for feet on uneven ground (AI passes it on the ground and floor only).
   * squeeze: optional { center, normal, tangent, width, height, depth, k } while passing through a window:
   *   center = middle of the opening on the wall's inner face, normal = out of the cabin, k = 0..1 how far through.
   */
  update(dt, { speed = 0, turnRate = 0, mode = 'walk', attack = 0, thrash = 0, ground = null, squeeze = null } = {}) { // eslint-disable-line no-unused-vars
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    // hit reactions decay: whole-body jolt (crumple) and per-leg kicks
    this.joltK = (this.joltK || 0) * Math.exp(-dt * 6);
    for (const l of this.legs) l.hitK = (l.hitK || 0) * Math.exp(-dt * 5);
    const jolt = Math.min(1.4, this.joltK);
    const def = this.def, lay = this.layout, R = def.restR, H = def.bodyH, r = this.rand;
    this.time += dt;
    const T = this.time;
    const space = this.space;
    space.updateWorldMatrix(true, false);
    if (!this.inited) this.snapFeet();
    const inv = this.inv.copy(space.matrixWorld).invert();

    // ---- velocity in local space (from actual motion, so it works whatever the AI does)
    const prevLocal = _v.copy(this.prevPos).applyMatrix4(inv);
    const raw = _v2.copy(prevLocal).multiplyScalar(-1 / dt);
    raw.y = 0;
    this.prevPos.setFromMatrixPosition(space.matrixWorld);
    if (raw.length() > 40) { this.snapFeet(); raw.set(0, 0, 0); }
    this.vel.lerp(raw, 1 - Math.exp(-dt * 14));
    const spd = this.speed = this.vel.length();
    this.turn = lerp(this.turn, turnRate, 1 - Math.exp(-dt * 8));
    const accelZ = (this.vel.z - this.prevSpeedZ) / dt; this.prevSpeedZ = this.vel.z;
    this.accel = lerp(this.accel, clamp(accelZ, -20, 20), 1 - Math.exp(-dt * 6));

    // ---- mode blends
    const deadTarget = mode === 'dead' ? 1 : 0;
    const wasDead = this.deadK > 0;
    this.deadK = clamp(this.deadK + (deadTarget ? dt / 0.6 : -dt / 0.8), 0, 1);
    if (wasDead && this.deadK === 0) this.snapFeet();
    const dead = smooth(0, 1, this.deadK);
    this.attackK = lerp(this.attackK, mode === 'attack' ? 1 : 0, 1 - Math.exp(-dt * 7));
    this.atk = lerp(this.atk, mode === 'attack' ? clamp(attack, 0, 1) : 0, 1 - Math.exp(-dt * 18));
    const aK = this.attackK, atk = this.atk;
    const rear = smooth(0.0, 0.5, atk) * (1 - smooth(0.6, 0.9, atk));
    const lunge = smooth(0.55, 0.95, atk);
    const idle = mode === 'idle' || (spd < 0.03 * R && mode !== 'attack');

    // ---- body
    let swing = 0;
    for (const l of this.legs) if (l.stepping) swing += Math.sin(Math.PI * l.t);
    const moveK = smooth(0, R * 0.6, spd);
    const bob = -swing / 4 * H * 0.12 * moveK;
    const breath = this.nBreath(T * 0.9);
    let y = H * (1 + bob / H) + H * 0.025 * this.nBob(T * 0.7) + H * 0.015 * breath + this.feetLift;
    y += aK * (rear * H * 0.55 + rear * R * 0.08 - lunge * H * 0.25);
    let z = lay.bodyZ0 + R * 0.02 * this.nBob(T * 0.31 + 4) + aK * (-rear * R * 0.14 + lunge * R * 0.3);
    let x = R * 0.015 * this.nRoll(T * 0.27 + 9);
    let pitch = clamp(this.accel * 0.012, -0.12, 0.12) + 0.03 * this.nPitch(T * 0.5) + aK * (-rear * 0.6 + lunge * 0.18) - aK * 0.08 + this.feetPitch;
    let roll = clamp(-this.turn * spd / R * 0.05, -0.2, 0.2) + 0.035 * this.nRoll(T * 0.6) * (0.4 + moveK) + this.feetRoll;
    let yaw = 0.03 * this.nYaw(T * 0.4) + clamp(this.turn * 0.04, -0.12, 0.12);
    // hit: the body crumples down and rears back for a moment
    y -= jolt * H * 0.32; pitch -= jolt * 0.22; roll += jolt * 0.12 * this.nRoll(T * 7);
    // dying: thrashing on its back legs, rolling
    if (thrash > 0) {
      y -= thrash * H * 0.25; roll += thrash * 0.45 * Math.sin(T * 9.3); pitch += thrash * 0.25 * Math.sin(T * 11.7);
    }
    // dead: drop onto the surface, slightly tilted
    const deadY = def.ceph.ry * 0.85;
    y = lerp(y, deadY, dead); pitch = lerp(pitch, 0.12, dead); roll = lerp(roll, 0.08, dead); x = lerp(x, 0, dead);
    this.bodyPos.set(x, y, z);
    this.bodyQ.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    this.bodyMat.compose(this.bodyPos, this.bodyQ, _v.set(1, 1, 1));
    const bodyBone = this.bones[BONE.BODY];
    bodyBone.position.copy(this.bodyPos); bodyBone.quaternion.copy(this.bodyQ);
    // squeezing through a window: the body narrows as it passes the wall
    this.squeezeK = lerp(this.squeezeK, squeeze ? squeeze.narrow ?? 0 : 0, 1 - Math.exp(-dt * 6));
    const sq = this.squeezeK;
    bodyBone.scale.set(1 - 0.22 * sq, 1 - 0.1 * sq, 1 + 0.08 * sq);

    // abdomen: breathing pulse, lag, sway
    {
      const b = this.bones[BONE.ABD];
      b.position.copy(lay.abdAttach).applyMatrix4(this.bodyMat);
      const pulse = 0.5 + 0.5 * Math.sin(T * (2.2 + 0.4 * breath)) ;
      const tilt = def.abd.tilt + 0.04 * this.nAbd(T * 0.8) - bob / H * 0.6 + aK * rear * 0.25 - dead * (def.abd.tilt + 0.1) + clamp(-this.accel * 0.01, -0.1, 0.1);
      _q.setFromEuler(_e.set(tilt, 0.05 * this.nAbd(T * 0.45 + 3) - this.turn * 0.04, 0.03 * this.nAbd(T * 0.6 + 7), 'YXZ'));
      b.quaternion.copy(this.bodyQ).multiply(_q);
      const br = (0.012 + 0.012 * (1 - moveK)) * pulse * (1 - dead);
      b.scale.set((1 + br) * (1 - 0.25 * sq), (1 + br * 1.4) * (1 - 0.12 * sq), (1 + br * 0.4) * (1 + 0.12 * sq));
    }

    // chelicerae: slow flexing, open on attack
    for (let s = 0; s < 2; s++) {
      const c = lay.chel[s], b = this.bones[BONE.CHEL + s];
      b.position.copy(c.attach).applyMatrix4(this.bodyMat);
      const tw = Math.max(0, this.nChel(T * 1.3 + s * 5)) ;
      const open = 0.05 + tw * tw * 0.25 + aK * (0.15 + 0.45 * smooth(0.3, 0.8, atk)) - dead * 0.1;
      const fwd = 0.1 * this.nChel(T * 0.7 + s) + aK * (-0.25 * rear - 0.3 * lunge) + dead * 0.3;
      _q.setFromEuler(_e.set(fwd, 0, c.side * open, 'YXZ'));
      b.quaternion.copy(this.bodyQ).multiply(_q);
    }

    // pedipalps: rubbing, tapping, flaring on attack
    for (let s = 0; s < 2; s++) {
      const p = lay.palps[s], n = s ? this.nPalpR : this.nPalpL;
      const rub = n(T * (1.6 + 0.5 * moveK));
      const flare = aK * (0.35 + 0.65 * rear);
      const spread = 0.25 + 0.15 * n(T * 0.5 + 2) + flare * 0.9 - dead * 0.2;
      const a0 = 0.55 + 0.25 * rub + flare * 0.8 + dead * 0.6;
      const a1 = -0.7 + 0.35 * n(T * 1.1 + 9) + flare * 0.2 - dead * 1.2;
      const a2 = -1.45 + 0.3 * rub - flare * 0.2 - dead * 0.8;
      _v3.set(p.side * Math.sin(spread), 0, Math.cos(spread)); // plane direction in body space
      this._chainFK(BONE.PALP + s * 3, p.attach, _v3, [a0, a1, a2], p.lens);
    }

    // ---- legs
    const thr = Math.min(R * 0.8, R * 0.3 + spd * def.strideK);
    const dur = clamp((thr / Math.max(spd, 1e-3)) * 0.8, def.stepMin, def.stepMax);
    const leadK = smooth(0.02 * R, 0.25 * R, spd);
    const groupStepping = [0, 0];
    let anyStepping = 0;
    for (const l of this.legs) if (l.stepping) { groupStepping[l.group]++; anyStepping++; }
    const wave = def.gait === 'wave';
    // squeeze: grip points round the window frame, on whichever side of the wall each leg reaches for
    if (squeeze) this._grips(squeeze, space);
    const upW = _X.set(0, 1, 0).transformDirection(space.matrixWorld).clone();
    const scaleW = space.matrixWorld.getMaxScaleOnAxis();

    // occasional idle repositioning step (unpredictable fidget)
    let fidget = -1;
    if (idle && dead === 0) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) { fidget = Math.floor(r() * 8); this.idleTimer = 1.2 + r() * 4.5; }
    }

    for (const l of this.legs) {
      // attach point and the raise amount (attack) for front legs
      const A = _v3.copy(l.attach).applyMatrix4(this.bodyMat);
      const raiseT = l.pair === 0 ? aK * (0.5 + 0.5 * smooth(0, 0.4, atk)) : l.pair === 1 ? aK * 0.3 * smooth(0, 0.5, atk) : 0;
      l.raise = lerp(l.raise, raiseT, 1 - Math.exp(-dt * 10));

      // step target in local space: rest, rotated by turn, plus lead, plus jitter
      const ang = this.turn * dur * 0.6;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const tx = l.rest.x * ca + l.rest.z * sa, tz = -l.rest.x * sa + l.rest.z * ca;
      l.target.set(tx, 0, tz);
      if (spd > 1e-4) l.target.addScaledVector(this.vel, (thr * 0.5 * leadK) / spd);
      l.target.add(l.jitter);

      const footL = _v.copy(l.foot).applyMatrix4(inv);
      // where the foot should land, in world space: on the real ground, or on a window-frame grip
      const tw = l.targetW;
      if (squeeze && l.grip) tw.copy(l.grip);
      else {
        tw.copy(l.target).applyMatrix4(space.matrixWorld);
        if (ground) tw.y = ground(tw.x, tw.z);
      }
      const tL = _X.copy(tw).applyMatrix4(inv);
      if (dead === 0 && l.raise < 0.05) {
        if (!l.stepping) {
          const dist = squeeze ? footL.distanceTo(tL) : Math.hypot(footL.x - tL.x, footL.z - tL.z);
          const off = Math.abs(footL.y - tL.y);
          const urgent = !squeeze && (dist > thr * 1.7 || off > thr * 0.7 || l.stretched);
          let want = squeeze ? dist > R * 0.06 : dist > thr || off > Math.max(R * 0.03, thr * 0.1) || urgent;
          if (fidget === l.index && !squeeze) { want = true; l.jitter.set((r() - 0.5) * R * 0.12, 0, (r() - 0.5) * R * 0.12); }
          // who may lift a foot: tetrapod = while the other set is planted; wave (and any squeeze) = one leg at a time
          const free = squeeze || wave ? anyStepping === 0 : groupStepping[1 - l.group] === 0;
          if (want && (urgent || free || fidget === l.index)) {
            l.stepping = true; l.t = 0; l.from.copy(l.foot); anyStepping++;
            l.dur = squeeze ? def.stepMax * 0.9 : fidget === l.index ? def.stepMax * 1.2 : dur * (0.9 + r() * 0.2) * (wave ? 1.6 : 1);
            l.arc = clamp(dist * 0.45 + R * 0.04, R * 0.05, R * def.arc) + off * 0.3;
            if (fidget !== l.index) l.jitter.set((r() - 0.5) * R * 0.05, 0, (r() - 0.5) * R * 0.05);
            groupStepping[l.group]++;
          }
        }
        if (l.stepping) {
          l.t = Math.min(1, l.t + dt / l.dur);
          const e = l.t * l.t * (3 - 2 * l.t);
          l.foot.copy(l.from).lerp(tw, e).addScaledVector(upW, l.arc * scaleW * Math.sin(Math.PI * Math.pow(l.t, 0.8)));
          if (l.t >= 1) {
            l.foot.copy(tw);
            l.stepping = false;
            l.stretched = false;
            if (this.onStep) this.onStep(l.foot.clone());
          }
          footL.copy(l.foot).applyMatrix4(inv);
        }
      }

      // idle twitch: lift a planted foot a little, then put it back
      l.twitchTimer -= dt;
      if (l.twitchTimer <= 0) {
        l.twitchTimer = (idle ? 0.8 : 2.5) + r() * (idle ? 5 : 8);
        if (!l.stepping && spd < 0.3 * R) l.twitch = 0.4 + r() * 0.6;
      }
      l.twitch = Math.max(0, l.twitch - dt * 2.4);
      const twv = Math.sin(Math.min(1, l.twitch) * Math.PI) * (1 - dead);

      // effective foot for IK
      const F = _v2.copy(footL);
      F.y += twv * R * 0.07;
      if (l.raise > 0.001) {
        const wave = l.noise(T * 2.2);
        const hx = A.x + l.side * R * (0.2 + 0.08 * wave), hy = H * 1.6 + R * (0.38 + 0.05 * wave), hz = A.z + R * 0.4;
        const sx = A.x + l.side * R * 0.12, sy = H * 0.25, sz = A.z + R * 0.95;
        const k = l.pair === 0 ? lunge : 0;
        F.lerp(_X.set(lerp(hx, sx, k), lerp(hy, sy, k), lerp(hz, sz, k)), l.raise);
      }
      // hit reactions: a jolt pulls every leg in under the body; a leg hit kicks that leg up and out
      if (jolt > 0.01) { F.x = lerp(F.x, A.x, jolt * 0.3); F.z = lerp(F.z, A.z, jolt * 0.3); F.y += jolt * R * 0.12; }
      if (l.hitK > 0.01) { F.y += l.hitK * R * 0.4; F.x += l.side * l.hitK * R * 0.12; }
      if (thrash > 0) {
        const ph = l.index * 1.37;
        F.x += l.side * R * 0.28 * thrash * Math.sin(T * 21 + ph);
        F.y += R * 0.45 * thrash * Math.max(0, Math.sin(T * 17 + ph * 1.6));
        F.z += R * 0.2 * thrash * Math.sin(T * 14 + ph * 0.7);
      }
      this._legIK(l, A, F, dead);
    }

    // the body follows its planted feet: lifts with them and tilts front-back and side to side (used next frame)
    {
      let sy = 0, n = 0, front = 0, nf = 0, back = 0, nb = 0, left = 0, nl = 0, right = 0, nr = 0;
      for (const l of this.legs) {
        if (l.stepping) continue;
        const y = _v.copy(l.foot).applyMatrix4(inv).y;
        sy += y; n++;
        if (l.pair <= 1) { front += y; nf++; } else { back += y; nb++; }
        if (l.side > 0) { right += y; nr++; } else { left += y; nl++; }
      }
      const k = 1 - Math.exp(-dt * 5);
      const lim = squeeze ? 0 : 1;   // gripping a frame: the feet are all over the place, keep the body level
      const lift = n ? clamp(sy / n, -R * 0.4, R * 0.4) * lim : 0;
      const pitchT = nf && nb ? clamp(-Math.atan2(front / nf - back / nb, R * 1.1), -0.35, 0.35) * lim : 0;
      const rollT = nl && nr ? clamp(Math.atan2(right / nr - left / nl, R * 1.4), -0.3, 0.3) * lim : 0;
      this.feetLift = lerp(this.feetLift, lift, k);
      this.feetPitch = lerp(this.feetPitch, pitchT, k);
      this.feetRoll = lerp(this.feetRoll, rollT, k);
    }
  }

  /** Squeeze grips: each leg holds the window frame, beside the opening, on the wall face of the side it reaches into. */
  _grips(sq, space) {
    const { center, normal, tangent, width, height, depth } = sq;
    for (const l of this.legs) {
      // where this leg naturally reaches: its rest foot, pulled in towards the body
      const reach = _v.copy(l.rest).lerp(_v2.set(0, 0, this.layout.bodyZ0), 0.35).applyMatrix4(space.matrixWorld);
      const inside = _v3.copy(reach).sub(center).dot(normal) < depth * 0.5;   // past the middle of the wall
      // which corner of the frame: front legs high, back legs low; each side of the opening by the leg's side,
      // mirrored when facing into the room (tangent is fixed to the wall)
      const sideSign = Math.sign(_X.copy(reach).sub(center).dot(tangent)) || l.side;
      const v = [0.92, 0.62, 0.32, 0.04][l.pair];
      const g = l.grip || (l.grip = new THREE.Vector3());
      g.copy(center)
        .addScaledVector(tangent, sideSign * (width / 2 + 0.06 + 0.04 * l.pair))
        .setY(center.y - height / 2 + v * height)
        .addScaledVector(normal, inside ? -0.02 : depth + 0.02);
    }
  }

  /** A hit: the whole body jolts (k ~0.4 leg hit .. 1 body hit .. 1.4 stagger). */
  jolt(k) { this.joltK = Math.max(this.joltK || 0, k); }

  /** A leg was hit at this world point: the nearest leg kicks. */
  hitLeg(point) {
    let best = null, bd = Infinity;
    for (const l of this.legs) { const d = l.foot.distanceToSquared(point); if (d < bd) { bd = d; best = l; } }
    if (best) best.hitK = 1;
  }

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

  // Leg IK in the vertical plane through the attach point and the foot (space frame).
  _legIK(l, A, F, dead) {
    const def = this.def, lens = l.lens;
    const d = l.d.set(F.x - A.x, 0, F.z - A.z);
    const hd = d.length();
    if (hd < 1e-5) d.copy(l.dir); else d.multiplyScalar(1 / hd);
    // keep the plane from flipping behind the attach point
    if (d.dot(l.dir) < -0.2) d.copy(l.dir);
    const ang = l.ang;
    // coxa
    const gam = this.def.coxaElev;
    const ch = Math.cos(gam) * lens[0], cv = Math.sin(gam) * lens[0];
    const hF = (F.x - A.x) * d.x + (F.z - A.z) * d.z - ch;
    const vF = F.y - A.y - cv;
    // ankle: metatarsus+tarsus chord comes down at alpha (flatter when the foot is far out)
    const restH = l.R - 0.1 * l.R;
    let alpha = clamp(def.alpha + (restH - hF) / l.R * 0.9, 0.45, 1.5);
    const Lm = l.mt.len, Lp = l.pt.len, Lf = lens[1];
    let Th = hF - Lm * Math.cos(alpha), Tv = vF + Lm * Math.sin(alpha);
    let D = Math.hypot(Th, Tv);
    const maxR = (Lf + Lp) * 0.995, minR = Math.abs(Lf - Lp) + 1e-4;
    l.stretched = D > maxR * 1.0 && hF > 0;
    if (D > maxR) {
      // try flattening the ankle to reach further before giving up
      alpha = 0.3; Th = hF - Lm * Math.cos(alpha); Tv = vF + Lm * Math.sin(alpha); D = Math.hypot(Th, Tv);
      if (D > maxR) { Th *= maxR / D; Tv *= maxR / D; D = maxR; }
      else l.stretched = false;
    }
    if (D < minR) { Th *= minR / D; Tv *= minR / D; D = minR; }
    const base = Math.atan2(Tv, Th);
    const cosA = clamp((Lf * Lf + D * D - Lp * Lp) / (2 * Lf * D), -1, 1);
    const fem = base + Math.acos(cosA);           // knee up
    const Kh = Lf * Math.cos(fem), Kv = Lf * Math.sin(fem);
    const ptc = Math.atan2(Tv - Kv, Th - Kh);
    const mtc = Math.atan2(vF - Tv, hF - Th);
    ang[0] = gam;
    ang[1] = fem;
    ang[2] = ptc + l.pt.psi;
    ang[3] = ang[2] - 0.22;
    ang[4] = mtc + l.mt.psi;
    ang[5] = ang[4] - 0.3;
    if (dead > 0) {
      const v = (l.pair - 1.5) * 0.12;
      for (let k = 0; k < 6; k++) ang[k] = lerp(ang[k], DEAD[k] + v * (k > 1 ? 1 : 0) + (l.side > 0 ? 0.04 : -0.03) * k, dead);
      d.lerp(l.dir, dead).normalize();
    }
    // FK -> bones (space frame)
    const side = _Z.crossVectors(d, UP).normalize();
    const p = _Y.copy(A);
    const b0 = BONE.LEG + l.index * 6;
    for (let k = 0; k < 6; k++) {
      const a = ang[k];
      const X = _X.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
      const Yv = _v.crossVectors(side, X);
      _m.makeBasis(X, Yv, side);
      const b = this.bones[b0 + k];
      b.position.copy(p);
      b.quaternion.setFromRotationMatrix(_m);
      p.addScaledVector(X, lens[k]);
    }
  }
}
