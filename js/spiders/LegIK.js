// Leg inverse kinematics for a six-piece spider leg (coxa, femur, patella, tibia, metatarsus, tarsus).
//
// Why it is built this way (the old solver twitched and snapped):
// - The ankle angle is a smooth function of how far the foot is, all the way to full stretch. The old code jumped
//   to a flat ankle the moment a foot went out of reach: that was the one-frame snap.
// - At full stretch the reach is clamped softly (it eases into the limit), so a leg never pops straight.
// - The leg's swing direction turns smoothly and is filtered over time; it never flips when a foot passes under or
//   behind the hip (the old code jumped back to the default direction).
// - Knees splay: the whole leg rotates outward around the hip-to-foot line, so knees rise up AND out like a real
//   spider's, instead of every leg bending in a vertical plane like a pole. The foot stays exactly where it is.
// - If the knee would end up inside a wall (squeezing through a window), the splay turns the other way to fold it
//   clear.
//
// Everything happens in the spider's local `space` frame (+Y up from the surface).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _d = new THREE.Vector3(), _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
const _pv = new THREE.Vector3(), _chord = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();

/** Angle offset and length of the chord across a two-piece limb (a then b, b bent down by kink). */
export function kinkInfo(a, b, kink) {
  return { psi: Math.atan2(b * Math.sin(kink), a + b * Math.cos(kink)), len: Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(kink)) };
}

/** Soft limit: x below `knee` passes through, above it eases towards `max` and never passes it. */
function softMax(x, knee, max) {
  if (x <= knee) return x;
  const r = max - knee;
  return knee + r * (1 - Math.exp(-(x - knee) / r));
}

/**
 * Solve one leg. l: leg state from the rig ({ lens, pt, mt, dir, R, d, splay }), A: hip (attach) in space,
 * F: foot target in space, opts: { alpha, coxaElev, splay, dt, tuck }.
 * Writes l.pos[k] (start of each piece, space) and l.q[k] (orientation of each piece, space): +X along the piece.
 */
export function solveLeg(l, A, F, opts) {
  const lens = l.lens;
  // swing direction: horizontal hip->foot, blended smoothly towards the leg's natural direction when the foot is
  // under or behind the hip, then filtered so it never jumps
  _d.set(F.x - A.x, 0, F.z - A.z);
  const hd = _d.length();
  if (hd > 1e-5) _d.multiplyScalar(1 / hd); else _d.copy(l.dir);
  const back = smooth(0.15, -0.35, _d.dot(l.dir));          // 0 in front of the hip .. 1 well behind it
  const near = smooth(l.R * 0.25, l.R * 0.05, hd);          // foot almost under the hip
  _d.lerp(l.dir, Math.max(back * 0.7, near)).normalize();
  const k = 1 - Math.exp(-(opts.dt || 0.016) * 30);
  l.d.lerp(_d, l.inited ? k : 1).normalize();
  l.inited = true;
  const d = l.d;

  // planar solve in (d, UP)
  const gam = opts.coxaElev;
  const ch = Math.cos(gam) * lens[0], cv = Math.sin(gam) * lens[0];
  const hF = (F.x - A.x) * d.x + (F.z - A.z) * d.z - ch;
  const vF = F.y - A.y - cv;
  const Lm = l.mt.len, Lp = l.pt.len, Lf = lens[1];
  const maxR = (Lf + Lp) * 0.985, minR = Math.abs(Lf - Lp) * 1.05 + 1e-4;
  // ankle: steeper when the foot is close in, flatter as it reaches out; then flattened further, smoothly,
  // as the hip-to-ankle distance approaches full stretch
  const restH = l.R * 0.9;
  let alpha = clamp(opts.alpha + ((restH - hF) / l.R) * 0.9, 0.35, 1.5);
  let Th = hF - Lm * Math.cos(alpha), Tv = vF + Lm * Math.sin(alpha);
  let D = Math.hypot(Th, Tv);
  const flat = smooth(maxR * 0.86, maxR * 1.12, D);
  if (flat > 0) {
    alpha = alpha + (0.15 - alpha) * flat;
    Th = hF - Lm * Math.cos(alpha); Tv = vF + Lm * Math.sin(alpha); D = Math.hypot(Th, Tv);
  }
  l.stretch = D / maxR;
  const Dc = clamp(softMax(D, maxR * 0.94, maxR), minR, maxR);
  if (D > 1e-6) { Th *= Dc / D; Tv *= Dc / D; }
  D = Dc;
  const base = Math.atan2(Tv, Th);
  const cosA = clamp((Lf * Lf + D * D - Lp * Lp) / (2 * Lf * D), -1, 1);
  const fem = base + Math.acos(cosA);            // knee up
  const Kh = Lf * Math.cos(fem), Kv = Lf * Math.sin(fem);
  const ptc = Math.atan2(Tv - Kv, Th - Kh);
  const mtc = Math.atan2(vF - Tv, hF - Th);
  const ang = l.ang;
  ang[0] = gam; ang[1] = fem;
  ang[2] = ptc + l.pt.psi; ang[3] = ang[2] - 0.22;
  ang[4] = mtc + l.mt.psi; ang[5] = ang[4] - 0.3;
  if (opts.override) opts.override(ang, d);

  // FK in the plane, then splay: rotate everything after the coxa round the coxa-end -> foot line
  const side = _Z.crossVectors(d, UP).normalize();
  const p = _p.copy(A);
  for (let i = 0; i < 6; i++) {
    const a = ang[i];
    const X = _X.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
    const Yv = _Y.crossVectors(side, X);
    _m.makeBasis(X, Yv, side);
    l.q[i].setFromRotationMatrix(_m);
    l.pos[i].copy(p);
    p.addScaledVector(X, lens[i]);
  }
  const splay = opts.splay * l.side;
  if (Math.abs(splay) > 1e-4) {
    const pivot = _pv.copy(l.pos[1]);
    _chord.subVectors(p, pivot);
    if (_chord.lengthSq() > 1e-10) {
      _q.setFromAxisAngle(_chord.normalize(), splay);
      for (let i = 2; i < 6; i++) {
        l.pos[i].sub(pivot).applyQuaternion(_q).add(pivot);
        l.q[i].premultiply(_q);
      }
      l.q[1].premultiply(_q);
    }
  }
  l.end.copy(l.pos[5]).addScaledVector(_X.set(1, 0, 0).applyQuaternion(l.q[5]), lens[5]);
}

/** Knee position (start of the patella) from the last solve. */
export function kneeOf(l) { return l.pos[2]; }
