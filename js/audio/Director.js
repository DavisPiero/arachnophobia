// Ambience director: wind, rain and room tone, plus the horror cues that make the night feel
// inhabited. It schedules sounds, it never plays music. Silence is used on purpose.
//
// Cues:
//   thunder        every 40-120 s; 'lightning' is emitted 2.5-6 s before (closer = stronger = shorter gap)
//   one-shots      tree creaks, branch snaps (forest 10-40 m), cabin creaks (walls/roof), lantern squeaks,
//                  distant unknown noises (40-80 m); more frequent as danger rises
//   silence        10-25 s windows with almost nothing but wind; call silence(s) before a wave starts
//   behind you     a tap on a window or a roof step placed outside the player's view, where no spider is
//   approaching    footsteps that start 40 m out, walk closer over 20-40 s, then stop dead
//   watching       faint breath / click near a window while a stalker is in 'watch'
//   danger         'drone' fades in above 0.7, a subtle heartbeat above 0.85
import * as THREE from 'three';
import { WINDOWS, CABIN, LANTERN, roofHeight } from '../world/Layout.js';

const rr = (a, b) => a + Math.random() * (b - a);
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const _d = new THREE.Vector3();

export class Director {
  constructor(audio, events) {
    this.audio = audio;
    this.events = events;
    this.started = false;
    this.time = 0;
    this.danger = 0;
    this.debug = null; // optional fn(text) for the sound board

    this.windLevel = 0.6; this.windTarget = 0.6; this.gustTimer = 2;
    this.thunderTimer = rr(18, 45);   // the first one comes a little sooner
    this.pendingThunder = null;
    this.oneShotTimer = rr(4, 9);
    this.silenceUntil = 0;
    this.nextSilence = rr(50, 100);
    this.calmUntil = 0;
    this.behindTimer = rr(25, 50);
    this.approach = null; this.approachTimer = rr(45, 90);
    this.watchTimer = rr(4, 8);
    this.heartTimer = 0;
    this.breach = 0;
    this.tension = 0;
    this.lanternTimer = rr(15, 40);
    this.windGustTimer = rr(20, 40);

    this._off = [];
    if (events) {
      this._off.push(events.on('waveStart', () => this._onWaveStart()));
      this._off.push(events.on('waveEnd', () => this._onWaveEnd()));
      this._off.push(events.on('windowBreached', (e) => this._onBreach(e)));
    }
  }

  _log(s) { if (this.debug) this.debug(s); }

  start() {
    if (this.started) return;
    this.started = true;
    const a = this.audio;
    // two wind layers at different rates so the pattern never lines up the same way twice
    this.wind = a.loop('wind', { volume: 0.5, exterior: true, fadeIn: 3, variant: 0 });
    this.wind2 = a.loop('wind', { volume: 0.25, exterior: true, fadeIn: 4, rate: 0.91, variant: 1 });
    this.rain = a.loop('rain', { volume: 0.55, exterior: true, fadeIn: 3 });
    this.room = a.loop('roomTone', { volume: 0.8, exterior: false, fadeIn: 2 });
    this.drone = a.loop('drone', { volume: 0.0001, exterior: false, fadeIn: 0.1 });
    this._log('ambience started');
  }

  stop() {
    for (const h of [this.wind, this.wind2, this.rain, this.room, this.drone]) if (h) h.stop(1);
    this.started = false;
  }

  dispose() { this.stop(); for (const off of this._off) off(); this._off = []; }

  // Force a stretch of near silence (wind only). Call it ~15 s before a wave starts.
  silence(seconds = rr(10, 25)) {
    this.silenceUntil = Math.max(this.silenceUntil, this.time + seconds);
    if (this.approach) this.approach = null;
    this._log(`silence ${seconds.toFixed(0)} s`);
  }

  _onWaveStart() {
    this.tension = 1;
    this.silenceUntil = 0;
    this.audio.play('windGust', { volume: 0.8 });
    if (Math.random() < 0.7) this._distant(rr(45, 70), 0.9);
    this._log('wave start: tension rise');
  }
  _onWaveEnd() {
    this.tension = 0;
    this.calmUntil = this.time + rr(12, 20);
    this.approach = null;
    this._log('wave end: settling');
  }
  _onBreach(e) {
    this.breach = 1;
    const w = e && WINDOWS.find((x) => x.id === e.id);
    const pos = w ? w.center.clone() : null;
    this.audio.play('windGust', pos ? { position: pos, exterior: false, volume: 1, refDistance: 3 } : { volume: 1, exterior: false });
    this.lanternTimer = rr(0.8, 2);
    this._log(`window breached${e && e.id ? ` (${e.id})` : ''}: wind rushes in`);
  }

  update(dt, ctx = {}) {
    if (!this.started) return;
    this.time += dt;
    const danger = this.danger = Math.min(1, Math.max(0, ctx.danger ?? 0));
    const playerPos = ctx.playerPos || new THREE.Vector3(0, 1.6, 0);
    const forward = ctx.playerForward || new THREE.Vector3(0, 0, -1);
    const spiders = ctx.spiders || [];
    const silent = this.time < this.silenceUntil;
    const calm = this.time < this.calmUntil;
    this.tension = Math.max(0, this.tension - dt / 10);
    this.breach = Math.max(0, this.breach - dt / 25);

    // ---- wind and rain: gusts that drift, louder with danger, breach and tension
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = rr(2.5, 7);
      this.windTarget = rr(0.35, 0.75) * (1 + 0.25 * danger + 0.6 * this.breach + 0.2 * this.tension) * (silent ? 0.85 : 1) * (calm ? 0.8 : 1);
      if (this.wind) this.wind.setVolume(this.windTarget, rr(2, 4.5));
      if (this.wind2) this.wind2.setVolume(this.windTarget * rr(0.3, 0.7), rr(3, 6));
      if (this.rain) this.rain.setVolume(0.5 * (1 + 0.15 * danger + 0.8 * this.breach) * (calm ? 0.85 : 1), 3);
    }
    const roomV = 0.8 * (1 - 0.5 * this.breach);
    if (this.room && Math.abs(roomV - (this._roomV ?? -1)) > 0.02) { this.room.setVolume(roomV, 1); this._roomV = roomV; }

    // ---- drone (high danger only) and heartbeat (very high)
    if (this.drone) {
      const dv = 0.75 * smoothstep(0.7, 1, danger) + 0.3 * this.tension;
      if (Math.abs(dv - (this._droneV ?? -1)) > 0.02) { this.drone.setVolume(Math.max(0.0001, dv), 1.5); this._droneV = dv; }
    }
    if (danger > 0.85) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const bpm = 72 + ((danger - 0.85) / 0.15) * 38;
        this.heartTimer = 60 / bpm;
        this.audio.play('heartbeat', { volume: 0.25 + 0.35 * smoothstep(0.85, 1, danger), exterior: false, exact: true });
      }
    } else this.heartTimer = 0;

    // ---- thunder, with lightning first
    this.thunderTimer -= dt;
    if (this.thunderTimer <= 0 && !this.pendingThunder) {
      this.thunderTimer = rr(40, 120);
      const strength = rr(0.3, 1);
      this.events && this.events.emit('lightning', { strength });
      this.pendingThunder = { at: this.time + 6 - 3.5 * strength + rr(-0.3, 0.3), strength };
      this._log(`lightning ${strength.toFixed(2)}`);
    }
    if (this.pendingThunder && this.time >= this.pendingThunder.at) {
      const s = this.pendingThunder.strength; this.pendingThunder = null;
      const n = this.audio.bank?.get('thunder')?.buffers.length || 1;
      this.audio.play('thunder', { volume: 0.45 + 0.55 * s, variant: Math.round(s * (n - 1)), exterior: true });
      this._log('thunder');
    }

    // ---- planned silences (wind only), more likely between waves
    if (this.time > this.nextSilence) {
      this.nextSilence = this.time + rr(60, 130) * (ctx.betweenWaves ? 0.6 : 1);
      if (!ctx.waveActive || danger < 0.5) this.silence(rr(10, 25));
    }

    if (!silent) {
      // ---- random one-shots around the cabin
      this.oneShotTimer -= dt;
      if (this.oneShotTimer <= 0) {
        const base = calm ? rr(14, 24) : rr(6, 14) * (1 - 0.55 * danger);
        this.oneShotTimer = base;
        this._randomOneShot(danger);
      }
      // ---- lantern creak (wind through a broken window keeps it swinging)
      this.lanternTimer -= dt;
      if (this.lanternTimer <= 0) {
        this.lanternTimer = this.breach > 0.2 ? rr(2, 6) : rr(25, 60);
        this.audio.play('lanternCreak', { position: LANTERN.position, exterior: false, volume: this.breach > 0.2 ? 1 : 0.6 });
      }
      this.windGustTimer -= dt;
      if (this.windGustTimer <= 0) { this.windGustTimer = rr(25, 55); this.audio.play('windGust', { volume: rr(0.4, 0.75) }); }
      // ---- behind-you cue
      this.behindTimer -= dt * (0.5 + danger);
      if (this.behindTimer <= 0 && !calm) { this.behindTimer = rr(30, 60); this._behind(playerPos, forward, spiders); }
      // ---- approaching cue (mostly between waves)
      this.approachTimer -= dt * (ctx.waveActive ? 0.3 : 1);
      if (!this.approach && this.approachTimer <= 0 && !calm) { this.approachTimer = rr(60, 120); this._startApproach(); }
    }
    if (this.approach) this._tickApproach(dt);

    // ---- watching cue: a stalker in 'watch' breathes near the window it watches
    const watcher = spiders.find((s) => s.type === 'stalker' && s.state === 'watch');
    if (watcher) {
      this.watchTimer -= dt;
      if (this.watchTimer <= 0) {
        this.watchTimer = rr(6, 14);
        const w = this._nearestWindow(watcher.position);
        const pos = w.center.clone().addScaledVector(w.normal, 0.5); pos.y -= 0.2;
        const name = Math.random() < 0.7 ? 'breathStalker' : 'clickClimber';
        this.audio.play(name, { position: pos, exterior: true, volume: name === 'clickClimber' ? 0.25 : 0.5, rate: name === 'clickClimber' ? 1.3 : 0.95, refDistance: 1.2, rolloff: 1.6 });
        this._log(`watching: ${name} at ${w.id} window`);
      }
    }
  }

  _randomOneShot(danger) {
    const r = Math.random();
    const a = this.audio;
    if (r < 0.3) {
      a.play('treeCreak', { position: this._forestPoint(10, 40, rr(2, 8)), volume: rr(0.5, 1) });
      this._log('tree creak');
    } else if (r < 0.5) {
      a.play('branchSnap', { position: this._forestPoint(10, 40, 0), volume: rr(0.5, 1) });
      this._log('branch snap');
    } else if (r < 0.75) {
      a.play('cabinCreak', { position: this._cabinPoint(), exterior: false, volume: rr(0.5, 1) });
      this._log('cabin creak');
    } else if (r < 0.75 + 0.1 + 0.15 * danger) {
      this._distant(rr(40, 80), rr(0.6, 1));
    } else {
      a.play('branchSnap', { position: this._forestPoint(15, 35, 0), volume: rr(0.3, 0.6), rate: 1.2 });
      this._log('twig');
    }
  }

  _distant(dist, vol) {
    const ang = Math.random() * Math.PI * 2;
    this.audio.play('distantUnknown', { position: new THREE.Vector3(Math.cos(ang) * dist, 1, Math.sin(ang) * dist), volume: vol, refDistance: 10, rolloff: 0.7 });
    this._log(`distant unknown at ${dist.toFixed(0)} m`);
  }

  _forestPoint(rMin, rMax, y) {
    const ang = Math.random() * Math.PI * 2, r = rr(rMin, rMax);
    return new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r);
  }

  _cabinPoint() {
    const hx = CABIN.halfX + CABIN.wallThickness / 2, hz = CABIN.halfZ + CABIN.wallThickness / 2;
    const side = Math.floor(Math.random() * 5);
    if (side === 4) { const x = rr(-hx, hx); return new THREE.Vector3(x, roofHeight(x), rr(-hz, hz)); }
    const y = rr(0.3, CABIN.wallHeight);
    if (side === 0) return new THREE.Vector3(rr(-hx, hx), y, -hz);
    if (side === 1) return new THREE.Vector3(rr(-hx, hx), y, hz);
    if (side === 2) return new THREE.Vector3(-hx, y, rr(-hz, hz));
    return new THREE.Vector3(hx, y, rr(-hz, hz));
  }

  _nearestWindow(p) {
    let best = WINDOWS[0], bd = Infinity;
    for (const w of WINDOWS) { const d = w.center.distanceToSquared(p); if (d < bd) { bd = d; best = w; } }
    return best;
  }

  // Where a ray from the player hits the cabin's wall box (horizontal).
  _wallHit(origin, dir) {
    const hx = CABIN.halfX, hz = CABIN.halfZ; let t = Infinity;
    if (dir.x > 1e-4) t = Math.min(t, (hx - origin.x) / dir.x); else if (dir.x < -1e-4) t = Math.min(t, (-hx - origin.x) / dir.x);
    if (dir.z > 1e-4) t = Math.min(t, (hz - origin.z) / dir.z); else if (dir.z < -1e-4) t = Math.min(t, (-hz - origin.z) / dir.z);
    return origin.clone().addScaledVector(dir, Math.max(0.5, t));
  }

  _behind(playerPos, forward, spiders) {
    // a direction behind the player, up to 50 degrees either side
    const back = new THREE.Vector3(-forward.x, 0, -forward.z).normalize();
    back.applyAxisAngle(new THREE.Vector3(0, 1, 0), rr(-0.9, 0.9));
    // a window behind the player?
    let win = null, best = 0.55;
    for (const w of WINDOWS) {
      _d.set(w.center.x - playerPos.x, 0, w.center.z - playerPos.z).normalize();
      const dot = _d.dot(back); if (dot > best) { best = dot; win = w; }
    }
    const spot = win ? win.center.clone() : this._wallHit(new THREE.Vector3(playerPos.x, 1.4, playerPos.z), back);
    // never fake a sound where a real spider is
    if (spiders.some((s) => s.position && s.position.distanceTo(spot) < 6)) return;
    const r = Math.random();
    if (win && r < 0.55) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.audio.play('glassTap', { position: win.center, exterior: false, volume: rr(0.25, 0.45), delay: i * rr(0.25, 0.5), refDistance: 1.5 });
      this._log(`behind you: tap on ${win.id} window`);
    } else if (r < 0.8) {
      const x = Math.max(-CABIN.halfX, Math.min(CABIN.halfX, spot.x)), z = Math.max(-CABIN.halfZ, Math.min(CABIN.halfZ, spot.z));
      const p = new THREE.Vector3(x, roofHeight(x), z);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) this.audio.play('roofStep', { position: p, volume: rr(0.4, 0.7), delay: i * rr(0.18, 0.35), exterior: true });
      this._log('behind you: steps on the roof');
    } else {
      this.audio.play('woodScrape', { position: spot, volume: rr(0.25, 0.4), exterior: true, rate: 0.85 });
      this._log('behind you: scrape on the wall');
    }
  }

  _startApproach() {
    const ang = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const dur = rr(20, 40);
    this.approach = { dir, t: 0, dur, from: 40, to: rr(9, 14), stepTimer: 0, heavy: Math.random() < 0.35 };
    this._log(`something approaching from ${(ang * 180 / Math.PI).toFixed(0)} deg`);
  }

  _tickApproach(dt) {
    const ap = this.approach;
    ap.t += dt;
    const u = Math.min(1, ap.t / ap.dur);
    if (u >= 1) { this.approach = null; this._log('approach stopped'); this.oneShotTimer = Math.max(this.oneShotTimer, rr(6, 10)); return; }
    const dist = ap.from + (ap.to - ap.from) * u;
    ap.stepTimer -= dt;
    if (ap.stepTimer <= 0) {
      // a cluster of 2-3 steps, then a pause: something with many legs, moving carefully
      ap.stepTimer = rr(0.6, 1.4) * (Math.random() < 0.15 ? 3 : 1);
      const base = ap.dir.clone().multiplyScalar(dist);
      const side = new THREE.Vector3(-ap.dir.z, 0, ap.dir.x);
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const p = base.clone().addScaledVector(side, rr(-0.8, 0.8)); p.y = 0;
        const name = ap.heavy ? 'stepBrute' : 'stepSpider';
        this.audio.play(name, { position: p, delay: i * rr(0.07, 0.16), volume: ap.heavy ? 0.6 : rr(0.7, 1), rate: ap.heavy ? 0.9 : 0.8, refDistance: ap.heavy ? 6 : 4, rolloff: 0.9 });
      }
      if (Math.random() < 0.12) this.audio.play('branchSnap', { position: base, volume: 0.6, refDistance: 6 });
    }
  }
}
