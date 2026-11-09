// The spider's body as a weight hung on its legs: damped springs pull it towards where its feet say it should be.
// Heavy bodies (big sizes, swollen abdomens) have soft springs and lag behind: they sag when they stop, lurch when
// they start, swing out on turns and settle with a wobble. Small ones are stiff and twitchy.
//
// Channels (all in the spider's local space): height, forward/side offset, pitch, roll, yaw. The rig sets targets
// each frame (from the planted feet, the acceleration and the behaviour's pose) and reads the springs back.

/** A critically-damped-ish spring: x follows target with stiffness k and damping ratio z. */
class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  step(target, k, z, dt) {
    // semi-implicit Euler, sub-stepped so stiff springs stay stable at low frame rates
    const n = dt > 0.02 ? 2 : 1, h = dt / n, c = 2 * z * Math.sqrt(k);
    for (let i = 0; i < n; i++) { this.v += (k * (target - this.x) - c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
  kick(v) { this.v += v; }
  reset(x) { this.x = x; this.v = 0; }
}

export class BodyDynamics {
  /** mass ~0.5 (small, twitchy) .. 3 (huge, heavy) */
  constructor(mass = 1) {
    this.mass = mass;
    this.y = new Spring(); this.fx = new Spring(); this.fz = new Spring();
    this.pitch = new Spring(); this.roll = new Spring(); this.yaw = new Spring();
    this.wob = new Spring();           // a soft abdomen's own jiggle
  }

  reset(y) { this.y.reset(y); for (const s of [this.fx, this.fz, this.pitch, this.roll, this.yaw, this.wob]) s.reset(0); }

  /**
   * t: targets { y, x, z, pitch, roll, yaw } in local space; accel: local acceleration (x, z) m/s²; dt seconds.
   * stiff: 0..1 extra stiffness (frozen, gripping) to override the sag.
   */
  update(t, accel, dt, stiff = 0) {
    const m = this.mass;
    const k = (160 / m) * (1 + stiff * 3), kr = (120 / m) * (1 + stiff * 3);
    const z = 0.55 + 0.25 * stiff;
    // inertia: the body lags opposite the acceleration, and leans back when speeding up, forward when braking
    const lag = 0.004 * m;
    const ax = Math.max(-25, Math.min(25, accel.x)), az = Math.max(-25, Math.min(25, accel.z));
    this.y.step(t.y, k, z, dt);
    this.fx.step(t.x - ax * lag, k * 0.7, z, dt);
    this.fz.step(t.z - az * lag, k * 0.7, z, dt);
    this.pitch.step(t.pitch - az * 0.006 * m, kr, z, dt);
    this.roll.step(t.roll + ax * 0.008 * m, kr, z, dt);
    this.yaw.step(t.yaw, kr * 1.4, z, dt);
    // the abdomen's jiggle is driven by the body's vertical speed and stopping
    this.wob.step(0, 60 / m, 0.18, dt);
    this.wob.kick((-this.y.v * 0.6 - az * 0.02) * dt * 8);
  }

  /** A sudden push (hit, landing, lunge recoil) on the body. */
  kick({ y = 0, z = 0, pitch = 0, roll = 0 } = {}) {
    this.y.kick(y); this.fz.kick(z); this.pitch.kick(pitch); this.roll.kick(roll); this.wob.kick(y * 2);
  }
}
