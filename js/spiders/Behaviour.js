// What a spider does with its body from moment to moment: its personality. SpiderAI decides WHERE it goes (routes,
// windows, inside); Behaviour decides HOW: speed changes, freezes, twitch fits, stalking, sudden bursts, strange
// postures, the face (mouth, lids), reacting to the player, and the attacks.
//
// Every species has its own personality (PERSONALITY below). They all notice the same things (`sense`):
//   looked   is the player looking straight at it (and close enough to see it)?
//   lit      is it in the flashlight beam?
//   near     how close is the player (m)?  moving: is the player moving?  shot: seconds since a gunshot nearby
//
// Attacks are four beats, never the same twice in a row:
//   wind-up (it rears, plants wide, trembles, the mouth opens; length varies so you cannot time it)
//   strike  (a lunge, a flurry of rakes, a slam with its whole weight, or a feint: it winds up and does NOT strike)
//   impact  (the hit lands at the moment of contact: damage, the view knocked, the player shoved)
//   recover (it is thrown back by its own weight and stays low for a moment)
//
// Output each frame: `speedK` (multiplier for the AI's speed, 0 = holding still), `pose` for the rig, and
// `strike` (true on the frame an attack lands; the AI applies the damage).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Per species. attacks: weighted choice. windup: seconds [min, max]. moves: how it travels.
 *   burst: moves in bursts, freezing between them (s ranges); freezeLooked: chance it goes dead still when looked at;
 *   stareCharge: when you look at it or light it, it stops and stares (the smile widening), then charges; crouch: travels low;
 *   twitch: how often it has a fit of trembling (per second); smileLooked: the smile widens while you watch.
 */
const PERSONALITY = {
  runner: { // the Knot: lopsided, frantic; bursts and dead stops, fits of trembling, darts aside when watched
    attacks: { lunge: 3, flurry: 3, feint: 1 }, windup: [0.25, 0.6], recover: [0.3, 0.6],
    burst: { go: [0.3, 1.1], stop: [0.15, 1.2], fast: 1.5 }, freezeLooked: 0.6, twitch: 0.5, dartLooked: 0.5,
  },
  brute: { // the Sac: slow and relentless; heaving breaths, a lurch forward when you least expect it, a smile that opens
    attacks: { slam: 4, lunge: 2, feint: 1 }, windup: [0.7, 1.4], recover: [0.7, 1.2],
    lurch: 0.12, twitch: 0.08, smileNear: 1,
  },
  climber: { // the Flayed: skitters fast, then freezes splayed flat; repositions suddenly
    attacks: { flurry: 3, lunge: 2, feint: 2 }, windup: [0.35, 0.8], recover: [0.4, 0.8],
    burst: { go: [0.4, 1.4], stop: [0.6, 2.5], fast: 1.7 }, splayStill: 1, twitch: 0.25, freezeLooked: 0.4,
  },
  stalker: { // the Grinner: when you look at it or light it, it stops dead, stares, smiles wider, then charges
    // (replaces "only moves while unseen": user's call, 2026-11-10)
    attacks: { lunge: 3, feint: 2, flurry: 1 }, windup: [0.5, 1.6], recover: [0.4, 0.9],
    stareCharge: { stare: [0.6, 1.3], charge: [1.2, 2.0], fast: 2.3, rest: [3, 6] }, smileLooked: true, headTilt: 0.5, twitch: 0.12,
  },
  weeper: { // the Weeper: creeps low under the sill, rises slowly into view, stares and blinks; sinks away when you turn
    attacks: { lunge: 2, slam: 1, feint: 3 }, windup: [0.8, 1.8], recover: [0.5, 1.0],
    crouch: 0.85, blink: true, headTilt: 0.35, twitch: 0.1, riseWhenNear: true,
  },
};

export class Behaviour {
  constructor(type) {
    this.type = type;
    this.P = PERSONALITY[type] || PERSONALITY.runner;
    this.speedK = 1;
    this.pose = { crouch: 0, rear: 0, lunge: 0, freeze: 0, shiver: 0, spread: 0, headYaw: 0, headPitch: 0, mouth: 0, lids: 0, reachK: 0, reach: null, palpRub: 0 };
    this.t = Math.random() * 10;
    this.phase = 'go'; this.phaseT = rnd(0.3, 1);
    this.fit = 0;              // trembling fit 0..1
    this.blinkT = rnd(2, 6); this.blink = 0;
    this.smile = 0;
    this.stillLooked = false;
    this.dart = 0;             // sideways dart (-1/1) when watched
    this.attack = null;        // { kind, t, windup, strike, recover, struck }
    this.lastKind = '';
    this.strike = false;
    this.lurchT = 0;
  }

  /** Is an attack under way (wind-up to recovery)? */
  get attacking() { return !!this.attack; }

  /** Start an attack. Returns the kind. */
  startAttack() {
    const P = this.P;
    let kinds = Object.entries(P.attacks).filter(([k]) => k !== this.lastKind || Object.keys(P.attacks).length === 1);
    let total = kinds.reduce((a, [, w]) => a + w, 0), r = Math.random() * total, kind = kinds[0][0];
    for (const [k, w] of kinds) { if ((r -= w) <= 0) { kind = k; break; } }
    this.lastKind = kind;
    const windup = rnd(P.windup[0], P.windup[1]) * (Math.random() < 0.2 ? 1.8 : 1);   // sometimes it holds the wind-up far too long
    const strike = kind === 'flurry' ? 0.75 : kind === 'slam' ? 0.32 : 0.16;
    this.attack = { kind, t: 0, windup, strike, recover: rnd(P.recover[0], P.recover[1]), struck: 0 };
    return kind;
  }

  /**
   * sense: { looked, lit, near, moving, shot, inside, atWindow, reach (world point to claw at, or null) }
   */
  update(dt, sense) {
    const P = this.P, pose = this.pose;
    this.t += dt;
    this.strike = false;
    let speedK = 1;
    let freeze = 0, shiver = 0, crouch = P.crouch || 0, spread = 0, rear = 0, lunge = 0, mouth = 0, reachK = 0;

    // --- trembling fits: something passes through it
    if (Math.random() < dt * (P.twitch || 0)) this.fit = 1;
    this.fit = Math.max(0, this.fit - dt * 1.4);
    shiver = Math.max(shiver, smooth(0, 0.3, this.fit) * (0.6 + 0.4 * Math.sin(this.t * 3)));

    // --- how it travels
    if (P.burst) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = this.phase === 'go' ? 'stop' : 'go';
        const r = P.burst[this.phase];
        // far from the player the stops are short (it is travelling); close by they stretch out (it is stalking)
        this.phaseT = rnd(r[0], r[1]) * (this.phase === 'stop' && sense.near > 12 ? 0.35 : 1);
      }
      speedK = this.phase === 'go' ? P.burst.fast : 0;
      if (this.phase === 'stop') { freeze = 1; if (P.splayStill) spread = 1; }
    }
    if (P.lurch) {
      // mostly a slow drag, then without warning two quick heavy strides forward
      this.lurchT -= dt;
      if (this.lurchT <= 0 && Math.random() < dt * P.lurch * 8) this.lurchT = rnd(0.5, 0.9);
      speedK = this.lurchT > 0 ? 2.4 : 0.75 + 0.25 * Math.sin(this.t * 1.3);
    }
    // looked at: some go dead still; the Grinner stares then charges; the Knot sometimes darts aside
    if (sense.looked) {
      if (!this.stillLooked && Math.random() < (P.freezeLooked || 0)) this.stillLooked = true;
      if (P.dartLooked && !this.dart && Math.random() < dt * P.dartLooked) this.dart = Math.random() < 0.5 ? -1 : 1;
    } else this.stillLooked = false;
    if (this.dart) { this.dartT = (this.dartT || 0) + dt; if (this.dartT > 0.35) { this.dart = 0; this.dartT = 0; } }
    if (P.stareCharge) {
      const C = P.stareCharge;
      this.scRest = Math.max(0, (this.scRest || 0) - dt);
      if (this.stareT > 0) {
        this.stareT -= dt; speedK = 0; freeze = 1;
        if (this.stareT <= 0) this.chargeT = rnd(...C.charge);
      } else if (this.chargeT > 0) {
        this.chargeT -= dt; speedK *= C.fast; crouch = Math.max(crouch, 0.35);
        if (this.chargeT <= 0) this.scRest = rnd(...C.rest);
      } else if ((sense.looked || sense.lit) && this.scRest <= 0) this.stareT = rnd(...C.stare);
    }
    if (this.stillLooked && !this.dart) { speedK = 0; freeze = 1; shiver = 0; }
    if (this.dart) speedK = 2.2;

    // --- the Weeper creeps low and rises into view when you come near its window; sinks away when you look off
    if (P.riseWhenNear) {
      const rise = sense.atWindow && sense.near < 4.5 ? 1 : 0;
      this.riseK = lerp(this.riseK || 0, rise, 1 - Math.exp(-dt * (rise ? 0.35 : 2.5)));   // slow up, quick down
      crouch = lerp(crouch, -0.2, this.riseK);
    }

    // --- the face: smiles that widen while you watch, slow blinks, the head tilting at an angle no animal holds
    const wantSmile = (P.smileLooked && sense.looked ? 1 : 0) + (P.smileNear ? smooth(6, 1.5, sense.near) : 0);
    this.smile = lerp(this.smile, clamp(wantSmile, 0, 1), 1 - Math.exp(-dt * (wantSmile > this.smile ? 0.4 : 1.5)));
    mouth = this.smile * 0.75;
    if (P.blink) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 1; this.blinkT = sense.looked ? rnd(4, 9) : rnd(1.5, 4); }
      this.blink = Math.max(0, this.blink - dt / 0.55);   // a slow, heavy blink
    }
    const lids = Math.sin(Math.PI * this.blink) * 0.95;
    const tilt = (P.headTilt || 0) * (sense.looked ? 1 : 0.3);
    pose.headYaw = lerp(pose.headYaw, tilt * Math.sin(this.t * 0.23) * 0.6, 1 - Math.exp(-dt * 1.2));
    pose.headPitch = lerp(pose.headPitch, tilt * 0.4, 1 - Math.exp(-dt * 1.2));

    // --- light: the Grinner and the Weeper hate it (they shrink down and tremble), others go still
    if (sense.lit) { shiver = Math.max(shiver, 0.5); if (this.type === 'stalker' || this.type === 'weeper') crouch = Math.max(crouch, 0.6); }

    // --- an attack overrides the rest
    const a = this.attack;
    if (a) {
      a.t += dt;
      const w = a.windup, s = a.strike;
      speedK = 0;
      if (a.t < w) {
        // wind-up: rears, plants wide, trembles harder and harder, mouth opening
        const k = smooth(0, w, a.t);
        rear = a.kind === 'flurry' ? 0.4 * k : a.kind === 'slam' ? k : 0.75 * k;
        spread = 0.7 * k; shiver = Math.max(shiver, 0.3 + 0.7 * k); mouth = Math.max(mouth, k);
        crouch = a.kind === 'lunge' ? -0.1 : crouch * (1 - k);
        reachK = a.kind === 'flurry' ? 0.6 * k : 0;
      } else if (a.t < w + s) {
        const k = (a.t - w) / s;
        if (a.kind === 'feint') {
          // no strike: it jerks forward an inch and stops dead
          lunge = 0.25 * Math.sin(Math.PI * k); rear = 0.4 * (1 - k); freeze = 1; mouth = 1;
        } else if (a.kind === 'flurry') {
          // rakes: front legs claw three times
          reachK = 1; rear = 0.3; mouth = 1;
          const n = k > 0.85 ? 3 : k > 0.55 ? 2 : k > 0.25 ? 1 : 0;
          if (n > a.struck) { a.struck = n; this.strike = 1 / 3; }
        } else if (a.kind === 'slam') {
          // its whole weight comes down
          rear = 1 - smooth(0, 0.6, k); lunge = smooth(0.2, 0.8, k); crouch = 0.6 * smooth(0.4, 1, k); mouth = 1;
          if (!a.struck && k > 0.7) { a.struck = 1; this.strike = 1.3; }
        } else {
          // lunge: fast and straight at you
          lunge = smooth(0, 0.6, k); rear = 0.75 * (1 - k); mouth = 1;
          if (!a.struck && k > 0.6) { a.struck = 1; this.strike = 1; }
        }
      } else if (a.t < w + s + a.recover) {
        // recovery: thrown back by its own weight, low, breathing hard
        const k = (a.t - w - s) / a.recover;
        lunge = 0.4 * (1 - smooth(0, 0.4, k)); crouch = 0.5 * (1 - k); mouth = 0.6 * (1 - k); shiver = 0.2;
        if (a.kind === 'feint') freeze = 1 - k;   // after a feint it just watches you
      } else this.attack = null;
    }

    this.speedK = speedK;
    const k = 1 - Math.exp(-dt * 12);
    pose.freeze = lerp(pose.freeze, freeze, k);
    pose.shiver = lerp(pose.shiver, shiver, 1 - Math.exp(-dt * 8));
    pose.crouch = lerp(pose.crouch, crouch, 1 - Math.exp(-dt * 4));
    pose.spread = lerp(pose.spread, spread, 1 - Math.exp(-dt * 6));
    pose.rear = lerp(pose.rear, rear, 1 - Math.exp(-dt * 10));
    pose.lunge = lerp(pose.lunge, lunge, 1 - Math.exp(-dt * 22));   // lunges are fast
    pose.mouth = lerp(pose.mouth, mouth, 1 - Math.exp(-dt * 5));
    pose.lids = lids;
    pose.reachK = lerp(pose.reachK, reachK, 1 - Math.exp(-dt * 10));
    pose.reach = sense.reach;
    pose.palpRub = shiver;
    return this;
  }
}
