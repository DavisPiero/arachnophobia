// Audio engine: buses, mute/volume, 3D positional one-shots and loops, indoor and forest reverb,
// and the "exterior" filter that muffles everything outside the cabin walls.
//
// Signal flow (live context):
//   voice -> [panner] -> bus input                    (interior sounds)
//   voice -> [panner] -> exterior lowpass -> bus      (exterior: true, muffled by walls)
//   voice -> room send   -> room convolver   -> sfx bus           (indoor echo, 'reverb' option)
//   voice -> forest send -> forest convolver -> sfx exterior      (distance/forest echo for exterior sounds)
//   sfx, ambience -> master -> limiter -> speakers
//
// The AudioContext is created inside unlock() (first user gesture), which is what iOS Safari
// and Android Chrome need. Sound bank rendering (init) does not need the live context.
import * as THREE from 'three';
import { buildBank, renderIR } from './SoundBank.js';
import { Quality } from '../core/Quality.js';

const STORE_KEY = 'arachnophobia.audio.v1';
const DEFAULT_VOL = { master: 0.85, sfx: 1, ambience: 0.8 };
const MAX_ONESHOTS = 24;
const STUB = Object.freeze({ stop() {} });

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();

function setParam(param, value, ctx, ramp = 0) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  if (ramp > 0) { param.setValueAtTime(param.value, now); param.linearRampToValueAtTime(value, now + ramp); }
  else param.setValueAtTime(value, now);
}

function setPannerPos(p, v, ctx, glide) {
  if (p.positionX) {
    const now = ctx.currentTime;
    if (glide) {
      p.positionX.linearRampToValueAtTime(v.x, now + glide); p.positionY.linearRampToValueAtTime(v.y, now + glide); p.positionZ.linearRampToValueAtTime(v.z, now + glide);
    } else {
      for (const [prm, val] of [[p.positionX, v.x], [p.positionY, v.y], [p.positionZ, v.z]]) { prm.cancelScheduledValues(now); prm.setValueAtTime(val, now); }
    }
  } else p.setPosition(v.x, v.y, v.z);
}

// A reusable chain: gain -> (panner) -> out, with reverb sends.
class Voice {
  constructor(engine, positional) {
    const ctx = engine.ctx;
    this.positional = positional;
    this.gain = ctx.createGain();
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 0;
    this.outSend = ctx.createGain(); this.outSend.gain.value = 0;
    if (positional) {
      this.panner = ctx.createPanner();
      this.panner.panningModel = Quality.tier === 'low' ? 'equalpower' : 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.maxDistance = 200;
      this.gain.connect(this.panner);
      this.out = this.panner;
    } else this.out = this.gain;
    this.out.connect(this.roomSend); this.roomSend.connect(engine.roomIn);
    this.gain.connect(this.outSend); this.outSend.connect(engine.forestIn);
    this.target = null;
  }
  route(target) {
    if (this.target === target) return;
    if (this.target) { try { this.out.disconnect(this.target); } catch (e) { /* not connected */ } }
    this.out.connect(target); this.target = target;
  }
}

export class AudioEngine {
  constructor(camera) {
    this.camera = camera;
    this.listener = null; // THREE.AudioListener, created in unlock() together with the AudioContext
    this.ctx = null;
    this.bank = null;
    this.initMs = 0;
    this._unlocked = false;
    this._initPromise = null;
    this._openness = 0;
    this._active = [];          // one-shot records
    this._loops = new Set();    // live loop records
    this._pendingLoops = [];    // loops requested before ready
    this._pool = { pos: [], flat: [] };
    this._warned = new Set();

    const params = new URLSearchParams(location.search);
    this.urlMute = params.get('mute') === '1';
    const stored = this._load();
    this._vol = { ...DEFAULT_VOL, ...(stored.vol || {}) };
    this._muted = this.urlMute ? true : !!stored.muted;
  }

  // ---------------------------------------------------------------- setup

  async init(onProgress) {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        const res = await buildBank({ lowTier: Quality.tier === 'low', onProgress });
        this.bank = res.sounds; this.irs = res.irs; this.initMs = Math.round(res.ms);
        this._attachIRs();
        this._flushPending();
        return this.initMs;
      })();
    }
    return this._initPromise;
  }

  async unlock() {
    // Everything up to the first await runs synchronously inside the user gesture.
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
      THREE.AudioContext.setContext(this.ctx);
      this.listener = new THREE.AudioListener();
      this.listener.gain.disconnect(); // we route through our own buses
      this.camera.add(this.listener);
      this._buildGraph();
      this._installResumeHandlers();
    }
    const p = this.ctx.state !== 'running' ? this.ctx.resume() : null;
    this._playSilence();
    try { if (p) await p; } catch (e) { /* retried on the next touch */ }
    this._unlocked = true;
    this._attachIRs();
    this._flushPending();
  }

  get ready() { return this._unlocked && !!this.bank; }

  _buildGraph() {
    const ctx = this.ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8; this.limiter.knee.value = 4; this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = this._muted ? 0 : this._vol.master;
    this.master.connect(this.limiter); this.limiter.connect(ctx.destination);
    this.bus = {}; this.ext = {}; this.extGain = {};
    for (const b of ['sfx', 'ambience']) {
      const g = ctx.createGain(); g.gain.value = this._vol[b]; g.connect(this.master); this.bus[b] = g;
      // exterior: a lowpass (the walls) plus a faint unfiltered leak (the window glass). Without
      // the leak the spiders' high clicks vanished completely, and hearing them is the game.
      const input = ctx.createGain();
      const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.Q.value = 0.55;
      const leak = ctx.createGain();
      const eg = ctx.createGain();
      input.connect(f1); f1.connect(eg); input.connect(leak); leak.connect(eg); eg.connect(g);
      this.ext[b] = input; this.extGain[b] = eg; this[`_extF_${b}`] = [f1]; this[`_extLeak_${b}`] = leak;
    }
    this.roomIn = ctx.createGain(); this.roomConv = ctx.createConvolver();
    this.roomReturn = ctx.createGain(); this.roomReturn.gain.value = 0.9;
    this.roomIn.connect(this.roomConv); this.roomConv.connect(this.roomReturn); this.roomReturn.connect(this.bus.sfx);
    this.forestIn = ctx.createGain(); this.forestConv = ctx.createConvolver();
    this.forestReturn = ctx.createGain(); this.forestReturn.gain.value = 0.8;
    this.forestIn.connect(this.forestConv); this.forestConv.connect(this.forestReturn); this.forestReturn.connect(this.ext.sfx);
    this._applyOpenness(0);
  }

  async _attachIRs() {
    if (!this.ctx || !this.irs || this._irsAttached) return;
    this._irsAttached = true;
    // a ConvolverNode needs an impulse response at the live context's own sample rate
    const sr = this.ctx.sampleRate;
    const room = this.irs.room.sampleRate === sr ? this.irs.room : await renderIR('room', sr);
    const forest = this.irs.forest.sampleRate === sr ? this.irs.forest : await renderIR('forest', sr);
    this.roomConv.buffer = room;
    this.forestConv.buffer = forest;
  }

  _playSilence() {
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) { /* ignore */ }
  }

  _installResumeHandlers() {
    const ctx = this.ctx;
    const tryResume = () => {
      if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) {
        const p = ctx.resume(); this._playSilence(); if (p && p.catch) p.catch(() => {});
      }
    };
    // iOS can put the context into 'interrupted' (calls, Siri, other apps); resume on the next gesture or when visible
    for (const ev of ['touchend', 'click', 'keydown', 'pointerup']) window.addEventListener(ev, tryResume, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
      else tryResume();
    });
    ctx.onstatechange = () => { if (ctx.state === 'interrupted') setTimeout(tryResume, 300); };
  }

  // ---------------------------------------------------------------- volume & mute

  _load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ vol: this._vol, muted: this.urlMute ? this._load().muted : this._muted })); } catch (e) { /* private mode */ }
  }
  setVolume(bus, v) {
    if (!(bus in this._vol)) return;
    this._vol[bus] = Math.min(1, Math.max(0, Number(v) || 0));
    this._save();
    if (!this.ctx) return;
    if (bus === 'master') { if (!this._muted) setParam(this.master.gain, this._vol.master, this.ctx, 0.05); }
    else setParam(this.bus[bus].gain, this._vol[bus], this.ctx, 0.05);
  }
  getVolume(bus) { return this._vol[bus] ?? 0; }
  setMuted(m) {
    this._muted = !!m; this._save();
    if (this.ctx) setParam(this.master.gain, this._muted ? 0 : this._vol.master, this.ctx, 0.06);
  }
  get muted() { return this._muted; }

  // ---------------------------------------------------------------- exterior

  setExteriorOpenness(v) {
    this._openness = Math.min(1, Math.max(0, v));
    if (this.ctx) this._applyOpenness(0.25);
  }
  get exteriorOpenness() { return this._openness; }
  _applyOpenness(ramp) {
    const o = this._openness;
    const f = 1300 * Math.pow(18000 / 1300, Math.pow(o, 0.8));
    for (const b of ['sfx', 'ambience']) {
      for (const flt of this[`_extF_${b}`]) setParam(flt.frequency, Math.min(f, this.ctx.sampleRate * 0.45), this.ctx, ramp);
      setParam(this.extGain[b].gain, 0.72 + 0.28 * o, this.ctx, ramp);
      setParam(this[`_extLeak_${b}`].gain, 0.14 * (1 - o), this.ctx, ramp);
    }
  }

  // ---------------------------------------------------------------- playback

  has(name) { return !!(this.bank && this.bank.get(name)); }
  names() { return this.bank ? [...this.bank.keys()] : []; }

  _entry(name) {
    const e = this.bank && this.bank.get(name);
    if (!e && this.bank && !this._warned.has(name)) { this._warned.add(name); console.warn(`[audio] unknown sound "${name}"`); }
    return e;
  }
  _pickBuffer(e, variant) {
    const n = e.buffers.length;
    let i;
    if (variant !== undefined) i = Math.max(0, Math.min(n - 1, variant | 0));
    else { i = Math.floor(Math.random() * n); if (n > 1 && i === e.last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n; }
    e.last = i;
    return e.buffers[i];
  }
  _listenerPos() {
    if (this.listener) return this.listener.getWorldPosition(_l);
    return this.camera.getWorldPosition(_l);
  }
  _acquire(positional) {
    const pool = positional ? this._pool.pos : this._pool.flat;
    return pool.pop() || new Voice(this, positional);
  }
  _releaseVoice(voice) {
    voice.gain.gain.cancelScheduledValues(0);
    const pool = voice.positional ? this._pool.pos : this._pool.flat;
    if (pool.length < 40) pool.push(voice);
    else { try { voice.out.disconnect(); voice.gain.disconnect(); } catch (e) { /* ignore */ } }
  }

  // Shared setup for one-shots and loops. Returns a record or null.
  _start(name, opts, loop) {
    const e = this._entry(name); if (!e) return null;
    const ctx = this.ctx;
    const positional = !!(opts.position || opts.object);
    const exact = !!opts.exact;
    let vol = (opts.volume ?? 1) * e.gain * (exact || loop ? 1 : 0.94 + Math.random() * 0.12);
    let rate = (opts.rate ?? 1) * (exact ? 1 : 1 + (Math.random() - 0.5) * 0.08);
    const ref = opts.refDistance ?? e.refDistance; const rolloff = opts.rolloff ?? e.rolloff;
    let dist = 0;
    if (positional) {
      if (opts.object) opts.object.getWorldPosition(_v); else _v.copy(opts.position);
      dist = _v.distanceTo(this._listenerPos());
    }
    const att = positional ? ref / (ref + rolloff * Math.max(0, dist - ref)) : 1;
    const prio = vol * att;
    if (!loop && this._active.length >= MAX_ONESHOTS) {
      // steal the voice that matters least (quiet, far, nearly finished)
      const now = ctx.currentTime; let worst = null, worstScore = Infinity;
      for (const r of this._active) {
        const remain = Math.max(0.05, 1 - (now - r.t0) / r.dur);
        const s = r.prio * remain; if (s < worstScore) { worstScore = s; worst = r; }
      }
      if (!worst || worstScore > prio) return null;
      this._kill(worst, 0.03);
    }
    const buf = this._pickBuffer(e, opts.variant);
    const voice = this._acquire(positional);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
    src.playbackRate.value = rate;
    src.connect(voice.gain);
    const now = ctx.currentTime; const when = now + Math.max(0, opts.delay || 0);
    voice.gain.gain.cancelScheduledValues(now);
    const fadeIn = loop ? (opts.fadeIn ?? 1.0) : 0;
    if (fadeIn > 0) { voice.gain.gain.setValueAtTime(0, now); voice.gain.gain.linearRampToValueAtTime(vol, when + fadeIn); }
    else voice.gain.gain.setValueAtTime(vol, now);
    if (positional) {
      const p = voice.panner; p.refDistance = ref; p.rolloffFactor = rolloff;
      setPannerPos(p, _v, ctx, 0);
    }
    const bus = opts.bus || e.bus;
    const exterior = opts.exterior ?? e.exterior;
    voice.route(exterior ? this.ext[bus] || this.ext.sfx : this.bus[bus] || this.bus.sfx);
    setParam(voice.roomSend.gain, opts.reverb ?? (exterior ? 0 : e.reverb), ctx);
    const outdoor = exterior ? (opts.outdoor ?? e.outdoor) : 0;
    setParam(voice.outSend.gain, outdoor * (positional ? 1 / (1 + dist / 25) : 1), ctx);
    if (loop) src.start(when, Math.random() * buf.duration); else src.start(when);
    const rec = { name, src, voice, object: opts.object || null, prio, vol, t0: when, dur: buf.duration / rate, loop, ended: false, outdoor };
    src.onended = () => this._ended(rec);
    if (loop) this._loops.add(rec); else this._active.push(rec);
    return rec;
  }

  _ended(rec) {
    if (rec.ended) return; rec.ended = true;
    try { rec.src.disconnect(); } catch (e) { /* ignore */ }
    if (rec.loop) this._loops.delete(rec);
    else { const i = this._active.indexOf(rec); if (i >= 0) this._active.splice(i, 1); }
    this._releaseVoice(rec.voice);
  }

  _kill(rec, fade = 0.05) {
    if (rec.ended || rec.stopping) return;
    rec.stopping = true;
    const ctx = this.ctx; const now = ctx.currentTime; const g = rec.voice.gain.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade);
    try { rec.src.stop(now + fade + 0.02); } catch (e) { this._ended(rec); }
    if (!rec.loop) { const i = this._active.indexOf(rec); if (i >= 0) this._active.splice(i, 1); }
  }

  play(name, opts = {}) {
    if (!this.ready || this.ctx.state !== 'running') return STUB;
    const rec = this._start(name, opts, false);
    if (!rec) return STUB;
    return { stop: (fade = 0.05) => this._kill(rec, fade) };
  }

  loop(name, opts = {}) {
    const engine = this;
    const h = {
      rec: null, vol: opts.volume ?? 1, rate: opts.rate ?? 1, stopped: false,
      setVolume(v, ramp = 0.5) {
        h.vol = v; const r = h.rec; if (!r || r.ended || r.stopping) return;
        const e = engine.bank.get(name); r.vol = v * e.gain;
        setParam(r.voice.gain.gain, r.vol, engine.ctx, Math.max(0.01, ramp));
      },
      setRate(rt) { h.rate = rt; if (h.rec && !h.rec.ended) setParam(h.rec.src.playbackRate, rt, engine.ctx, 0.1); },
      stop(fade = 0.5) {
        h.stopped = true;
        const i = engine._pendingLoops.indexOf(h); if (i >= 0) engine._pendingLoops.splice(i, 1);
        if (h.rec) engine._kill(h.rec, Math.max(0.01, fade));
      },
      _begin() { if (!h.stopped) h.rec = engine._start(name, { ...opts, volume: h.vol, rate: h.rate, exact: true }, true); },
    };
    if (this.ready && this.ctx.state === 'running') h._begin();
    else this._pendingLoops.push(h);
    return h;
  }

  _flushPending() {
    if (!this.ready) return;
    const list = this._pendingLoops.splice(0);
    for (const h of list) h._begin();
  }

  stopAll(fade = 0.2) {
    for (const r of [...this._active]) this._kill(r, fade);
    for (const r of [...this._loops]) this._kill(r, fade);
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    if (!this.ctx) return;
    if (this.ctx.state === 'running' && this._pendingLoops.length && this.bank) this._flushPending();
    const glide = Math.min(0.1, Math.max(0.016, dt * 1.5));
    for (const set of [this._active, this._loops]) {
      for (const r of set) {
        if (!r.object || r.ended || !r.voice.panner) continue;
        r.object.getWorldPosition(_v);
        setPannerPos(r.voice.panner, _v, this.ctx, glide);
        if (r.outdoor > 0) {
          const d = _v.distanceTo(this._listenerPos());
          r.voice.outSend.gain.setTargetAtTime(r.outdoor / (1 + d / 25), this.ctx.currentTime, 0.1);
        }
      }
    }
  }

  get activeVoices() { return this._active.length; }
  get activeLoops() { return this._loops.size; }

  // Debug/test helper: stats for every buffer in the bank.
  bankReport() {
    const out = {};
    if (!this.bank) return out;
    for (const [name, e] of this.bank) {
      out[name] = e.buffers.map((b) => {
        let peak = 0, sum = 0, nan = 0, n = 0;
        for (let c = 0; c < b.numberOfChannels; c++) {
          const d = b.getChannelData(c);
          for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) { nan++; continue; } const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; n++; }
        }
        const r = { dur: +b.duration.toFixed(2), ch: b.numberOfChannels, sr: b.sampleRate, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(4), nan };
        if (e.loop) {
          // seam: jump across the loop point vs the typical sample-to-sample step
          let seam = 0, step = 0;
          for (let c = 0; c < b.numberOfChannels; c++) {
            const d = b.getChannelData(c);
            seam = Math.max(seam, Math.abs(d[0] - d[d.length - 1]));
            let s = 0; for (let i = 1; i < d.length; i++) s += Math.abs(d[i] - d[i - 1]);
            step = Math.max(step, s / (d.length - 1));
          }
          r.seam = +seam.toFixed(4); r.step = +step.toFixed(4);
        }
        return r;
      });
    }
    return out;
  }
}
