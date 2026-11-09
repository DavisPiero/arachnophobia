// Which foot may step, and when. Replaces the old "two fixed groups, plus urgent steps whenever a leg felt stretched"
// rule, which let urgent steps break the pattern and made legs fight each other (twitching).
//
// The rules, after how real arthropods coordinate (Cruse's rules, simplified):
// - A leg wants to step when its foot is far enough from where it should be (or is close to full stretch).
// - A leg may NOT lift while a neighbour is in the air: the legs in front of and behind it on the same side, and its
//   partner on the other side. That keeps the body supported and produces wave/tetrapod patterns on its own.
// - At most `maxAir` feet in the air at once: 1 for a slow wave gait (heavy, deliberate), 2 for a ripple, 4 for a
//   fast tetrapod. The pattern shifts with speed: a spider walking slowly ripples, running it alternates fours.
// - Among the legs that want to step, the one furthest behind goes first. A leg that is badly over-stretched may
//   break the neighbour rule (never the maxAir rule), so it can never be dragged.
//
// The rig asks `pick(legs, want)` every frame and starts a step on the legs it returns.

/** Neighbour lists per leg index (legs are ordered right 0..3 front->back, then left 4..7). */
const NEIGH = [];
for (let i = 0; i < 8; i++) {
  const side = i < 4 ? 0 : 1, pair = i % 4, n = [];
  if (pair > 0) n.push(side * 4 + pair - 1);
  if (pair < 3) n.push(side * 4 + pair + 1);
  n.push((1 - side) * 4 + pair);
  NEIGH.push(n);
}

export class Gait {
  /** style: 'tetrapod' | 'ripple' | 'wave'. Speed (body lengths per second) can raise the number of feet in the air. */
  constructor(style = 'tetrapod') { this.style = style; this.maxAir = 4; }

  /**
   * need: how many feet must be in the air on average to keep up (swing time / whole step cycle x 8).
   * The style sets the floor: a wave walker lifts one leg at a time until it has to hurry; a tetrapod runner
   * goes to alternating fours as soon as it moves fast.
   */
  setDemand(need) {
    const floor = this.style === 'wave' ? 1 : 2;
    this.maxAir = Math.max(floor, Math.min(4, Math.ceil(need * 1.15)));
  }

  /**
   * legs: rig legs ({ stepping, err, stretch }), err = how far the foot is from its target relative to the step
   * threshold (>1 wants a step). Returns the indices to lift now.
   */
  pick(legs, out = []) {
    out.length = 0;
    let air = 0;
    for (const l of legs) if (l.stepping) air++;
    if (air >= this.maxAir) return out;
    // candidates, worst first
    const cand = [];
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (l.stepping || l.locked) continue;
      const need = Math.max(l.err, (l.stretch - 0.9) * 8);
      if (need > 1) cand.push([need, i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (const [need, i] of cand) {
      if (air >= this.maxAir + 1) break;
      let blocked = false;
      for (const j of NEIGH[i]) if (legs[j].stepping || out.includes(j)) { blocked = true; break; }
      // badly over-stretched: it steps even next to a lifted neighbour, and may exceed the limit by one
      const urgent = need >= 2.2;
      if (blocked && !urgent) continue;
      if (air >= this.maxAir && !(urgent && air < this.maxAir + 1)) continue;
      out.push(i); air++;
    }
    return out;
  }
}
