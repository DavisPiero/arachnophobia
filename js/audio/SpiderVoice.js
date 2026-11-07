// Per-spider sound emitter. Gives each type a recognisable signature so the player can tell
// what is out there, and where, by ear alone:
//   runner   quick high chitter and bursts of rapid leg patter
//   brute    huge wet breathing (heard from far away) and heavy sub-bass steps
//   climber  deliberate dry clicks, steps on the roof, scraping on walls
//   stalker  almost silent: faint close breathing, only when near
//
// Spiders vocalise at distance so they are usually heard before they are seen.
// Sounds are exterior (muffled by the walls) unless the spider is inside, or the sound is
// the spider touching the window glass itself (the glass radiates straight into the room).

const TYPES = {
  runner: {
    rate: 1.18, ref: 5, rolloff: 1.0,
    vocal: 'chitterRunner', vocalEvery: [1.4, 3.6], vocalRange: 45, vocalVol: 1.0,
    stepThrottle: 0.35, stepSound: 'skitterRunner', stepVol: 0.8,
    windowEvery: [0.35, 1.0],
  },
  brute: {
    rate: 0.75, ref: 5.5, rolloff: 0.6,
    vocal: 'breathBrute', vocalEvery: [2.9, 4.6], vocalRange: 70, vocalVol: 1.0,
    stepThrottle: 0.32, stepSound: 'stepBrute', stepVol: 1.0,
    windowEvery: [1.2, 2.4],
  },
  climber: {
    rate: 0.95, ref: 4.5, rolloff: 1.0,
    vocal: 'clickClimber', vocalEvery: [2.0, 5.5], vocalRange: 45, vocalVol: 0.9,
    stepThrottle: 0.16, stepSound: 'stepSpider', stepVol: 0.6,
    windowEvery: [0.7, 1.6],
  },
  stalker: {
    rate: 0.9, ref: 1.5, rolloff: 1.5,
    vocal: 'breathStalker', vocalEvery: [4, 9], vocalRange: 14, vocalVol: 0.8,
    stepThrottle: 0.6, stepSound: 'stepSpider', stepVol: 0.18,
    windowEvery: [2.5, 5],
  },
};

const rr = (a, b) => a + Math.random() * (b - a);

export class SpiderVoice {
  constructor(audio, type, object3D) {
    this.audio = audio;
    this.type = TYPES[type] ? type : 'runner';
    this.cfg = TYPES[this.type];
    this.object = object3D;
    this.state = 'idle';
    this.surface = 'ground';
    this.speed = 0;
    this.distance = 30;
    this.dead = false;
    this.handles = new Set();
    this.vocalTimer = rr(0.2, this.cfg.vocalEvery[1]); // first call soon, so spiders announce themselves
    this.windowTimer = rr(0.3, 1);
    this.lastStep = -1;
    this.lastStepPlay = -1;
    this.clock = 0;
    this.hissTimer = rr(6, 14);
  }

  get exterior() { return this.state !== 'inside'; }

  _play(name, opts = {}) {
    if (this.dead) return null;
    const c = this.cfg;
    const h = this.audio.play(name, {
      object: this.object,
      refDistance: c.ref, rolloff: c.rolloff,
      exterior: this.exterior,
      reverb: this.exterior ? 0 : 0.15,
      ...opts,
      rate: (opts.rate ?? 1) * c.rate,
    });
    this.handles.add(h);
    if (this.handles.size > 12) { const first = this.handles.values().next().value; this.handles.delete(first); }
    return h;
  }

  update(dt, { state = this.state, speed = 0, surface = 'ground', distanceToPlayer = 30 } = {}) {
    if (this.dead) return;
    this.clock += dt;
    this.state = state; this.speed = speed; this.surface = surface; this.distance = distanceToPlayer;
    if (state === 'dead') { this.die(); return; }
    const c = this.cfg;

    // vocalisation: more often when close or attacking, silent beyond range
    this.vocalTimer -= dt * (state === 'attackWindow' || state === 'inside' ? 1.8 : distanceToPlayer < 10 ? 1.3 : 1);
    if (this.vocalTimer <= 0) {
      this.vocalTimer = rr(c.vocalEvery[0], c.vocalEvery[1]);
      if (distanceToPlayer < c.vocalRange) this._vocalise();
    }

    // glass and wall contact while attacking a window
    if (state === 'attackWindow') {
      this.windowTimer -= dt;
      if (this.windowTimer <= 0) {
        this.windowTimer = rr(c.windowEvery[0], c.windowEvery[1]);
        this._windowContact(surface);
      }
    }

    // the occasional hiss when close and agitated
    this.hissTimer -= dt;
    if (this.hissTimer <= 0) {
      this.hissTimer = rr(7, 16);
      if (this.type !== 'stalker' && distanceToPlayer < 12 && (state === 'attackWindow' || state === 'inside' || state === 'approach')) {
        this._play('spiderHiss', { volume: 0.7 });
      }
    }
  }

  _vocalise() {
    const c = this.cfg;
    if (this.type === 'stalker') {
      // close-mic breathing only within a few metres; in 'watch' it is fainter still
      this._play(c.vocal, { volume: this.state === 'watch' ? 0.55 : c.vocalVol });
      return;
    }
    if (this.type === 'climber' && this.state === 'roof' && Math.random() < 0.4) {
      this._play('woodScrape', { volume: 0.5, rate: 0.85 });
      return;
    }
    this._play(c.vocal, { volume: c.vocalVol });
  }

  _windowContact(surface) {
    const t = this.type;
    // the glass itself radiates into the room: not muffled by the walls
    const glassOpts = { exterior: false, reverb: 0.06, refDistance: 1.5, rolloff: 1.2, rate: 1 / this.cfg.rate };
    if (surface === 'glass') {
      if (t === 'runner') {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this._play('glassTap', { ...glassOpts, delay: i * rr(0.06, 0.11), volume: rr(0.5, 0.9) });
      } else if (t === 'brute') {
        this._play('boardHit', { ...glassOpts, volume: 0.55, rate: 1.25 / this.cfg.rate });
        this._play('glassTap', { ...glassOpts, volume: 1.0, rate: 0.7 / this.cfg.rate });
      } else if (t === 'climber') {
        if (Math.random() < 0.55) this._play('glassScratch', { ...glassOpts, volume: 0.8 });
        else this._play('glassTap', { ...glassOpts, volume: 0.8 });
      } else {
        this._play(Math.random() < 0.5 ? 'glassScratch' : 'glassTap', { ...glassOpts, volume: 0.35 });
      }
    } else {
      // boards or wall
      if (t === 'brute') this._play('boardHit', { volume: 1.0, exterior: false, reverb: 0.25, rate: 1 / this.cfg.rate });
      else if (Math.random() < 0.5) this._play('woodScrape', { volume: 0.7, exterior: false, reverb: 0.1, rate: 1 / this.cfg.rate });
      else this._play('boardHit', { volume: 0.35, exterior: false, reverb: 0.15, rate: 1.4 / this.cfg.rate });
    }
  }

  // Called by the leg rig whenever a foot lands. Throttled per type so eight legs do not spam.
  step(surface = this.surface) {
    if (this.dead) return;
    const now = this.clock; const c = this.cfg;
    if (surface === 'roof') {
      if (now - this.lastStepPlay < (this.type === 'brute' ? 0.3 : 0.14)) return;
      this.lastStepPlay = now;
      this._play('roofStep', { volume: this.type === 'brute' ? 1 : this.type === 'stalker' ? 0.25 : 0.75, rate: (this.type === 'brute' ? 0.7 : rr(0.9, 1.15)) / c.rate });
      return;
    }
    if (now - this.lastStepPlay < c.stepThrottle) return;
    this.lastStepPlay = now;
    if (this.type === 'runner') {
      // one skitter burst covers many feet; when slow, single taps
      if (this.speed > 1.5) this._play('skitterRunner', { volume: c.stepVol });
      else this._play('stepSpider', { volume: 0.5, rate: 1.1 });
      return;
    }
    if (surface === 'floor') {
      this._play(this.type === 'brute' ? 'stepBrute' : 'footWood', { volume: this.type === 'brute' ? 0.8 : 0.4, exterior: false, reverb: 0.15, rate: this.type === 'brute' ? 1 : 1.6 / c.rate });
      return;
    }
    if (surface === 'glass' || surface === 'wall') {
      if (this.type === 'brute') this._play('boardHit', { volume: 0.4, exterior: false, rate: 0.9 / c.rate });
      else this._play('glassTap', { volume: this.type === 'stalker' ? 0.15 : 0.35, exterior: surface !== 'glass', rate: 1.2 / c.rate });
      return;
    }
    this._play(c.stepSound, { volume: c.stepVol });
  }

  hit() {
    if (this.dead) return;
    const r = this.type === 'brute' ? 0.85 : this.type === 'runner' ? 1.1 : 1;
    this._play('spiderPain', { volume: this.type === 'stalker' ? 0.7 : 1, rate: r });
  }

  attack() {
    if (this.dead) return;
    this._play('spiderAttack', { volume: 1, reverb: this.exterior ? 0 : 0.2 });
  }

  die() {
    if (this.dead) return;
    for (const h of this.handles) h.stop(0.08);
    this.handles.clear();
    this.dead = true;
    // not tracked in handles: dispose() right after death must not cut the scream off
    const c = this.cfg;
    this.audio.play('spiderScream', {
      object: this.object, exterior: this.exterior, reverb: this.exterior ? 0 : 0.2,
      refDistance: c.ref * 1.5, rolloff: c.rolloff,
      rate: c.rate * (this.type === 'brute' ? 0.85 : this.type === 'runner' ? 1.05 : 1),
    });
  }

  dispose() {
    for (const h of this.handles) h.stop(0.1);
    this.handles.clear();
    this.dead = true;
  }
}
