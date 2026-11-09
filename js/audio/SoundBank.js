// Synthesised sound bank. Every sound is a "recipe" rendered into AudioBuffers with an
// OfflineAudioContext at start-up (several random variations each), so playback is cheap.
//
// How a recipe works: most of the raw material (impacts, clicks, creaks, raindrops, shards)
// is written sample-by-sample in JS as damped resonances ("modes") and noise bursts, because
// that is how real impacts sound. The offline audio graph then does the moving parts:
// filter sweeps, breath envelopes, gust curves, saturation and convolution.
//
// Each recipe:
//   variants   how many random versions to render (fewer on the 'low' quality tier)
//   dur        seconds, or [min, max]
//   sr         sample rate (32000 for dark/long sounds to save memory)
//   stereo     render two decorrelated channels (ambience)
//   loop       seamless loop (an extra crossfade tail is rendered and folded into the start)
//   gain       mix level in the game (buffers are peak-normalised, this sets loudness)
//   bus        'sfx' | 'ambience'
//   exterior   default: outside the cabin (muffled by walls)
//   reverb     default wet send to the small wooden room (indoor echo)
//   outdoor    default wet send to the forest reverb (exterior sounds only)
//   refDistance, rolloff   default distance falloff for positional playback
//   render(k, vi, n)       builds the sound with the Kit `k`; vi = variant index of n

const SR = 44100;
const AMB_SR = 32000;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- random

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- shared noise buffers

const noiseCache = new Map();
function makeBuffer(channels, length, sr) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const c = new Off(1, 1, sr);
  return c.createBuffer(channels, length, sr);
}
function noiseSet(sr) {
  if (noiseCache.has(sr)) return noiseCache.get(sr);
  const len = Math.floor(sr * 3.1);
  const set = { white: [], pink: [], brown: [] };
  for (let s = 0; s < 3; s++) {
    const r = mulberry32(9001 + s * 77 + sr);
    const w = makeBuffer(1, len, sr), p = makeBuffer(1, len, sr), b = makeBuffer(1, len, sr);
    const wd = w.getChannelData(0), pd = p.getChannelData(0), bd = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < len; i++) {
      const x = r() * 2 - 1;
      wd[i] = x;
      // Paul Kellet pink filter
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.96900 * b2 + x * 0.1538520; b3 = 0.86650 * b3 + x * 0.3104856;
      b4 = 0.55000 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.0168980;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
      br = (br + 0.02 * x) / 1.02; bd[i] = br * 3.5;
    }
    // make each buffer loop without a click: crossfade the last 50 ms into the start
    for (const d of [wd, pd, bd]) {
      const f = Math.floor(sr * 0.05);
      for (let i = 0; i < f; i++) { const u = i / f; d[i] = d[i] * Math.sqrt(u) + d[len - f + i] * Math.sqrt(1 - u); }
    }
    set.white.push(w); set.pink.push(p); set.brown.push(b);
  }
  noiseCache.set(sr, set);
  return set;
}

// ---------------------------------------------------------------- JS biquad (RBJ cookbook)

function biquad(type, f, Q, gainDb, sr) {
  const w0 = TAU * Math.min(Math.max(f, 5), sr * 0.48) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { // peaking
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// ---------------------------------------------------------------- the Kit

class Kit {
  constructor(ctx, rnd, irs, stereo) {
    this.ctx = ctx; this.sr = ctx.sampleRate; this.N = ctx.length; this.T = ctx.length / ctx.sampleRate;
    this.rnd = rnd; this.irs = irs; this.stereo = stereo;
    this.noises = noiseSet(this.sr);
    this.mix = ctx.createGain();
    this.dc = ctx.createBiquadFilter(); this.dc.type = 'highpass'; this.dc.frequency.value = 22; this.dc.Q.value = 0.6;
    this.mix.connect(this.dc); this.dc.connect(ctx.destination);
    if (stereo) {
      const m = ctx.createChannelMerger(2);
      this.L = ctx.createGain(); this.R = ctx.createGain();
      this.L.connect(m, 0, 0); this.R.connect(m, 0, 1);
      this.stereoBus = ctx.createGain(); m.connect(this.stereoBus); this.stereoBus.connect(this.dc);
    }
  }
  // random
  r() { return this.rnd(); }
  rr(a, b) { return a + (b - a) * this.rnd(); }
  ri(a, b) { return Math.floor(a + (b - a + 1) * this.rnd()); }
  pick(list) { return list[Math.floor(this.rnd() * list.length)]; }
  chance(p) { return this.rnd() < p; }
  lrr(a, b) { return a * Math.pow(b / a, this.rnd()); } // log-uniform

  // saturation on the whole mix
  drive(amount) {
    const ws = this.ws(amount);
    this.mix.disconnect(); this.mix.connect(ws); ws.connect(this.dc);
  }

  // ---- JS synthesis into Float32Arrays
  arr(sec) { return new Float32Array(sec ? Math.ceil(sec * this.sr) : this.N); }
  // damped sinusoid A r^n sin(wn + ph), via a two-pole recurrence (fast)
  mode(a, t, f, amp, tau, ph = 0) {
    const sr = this.sr; const i0 = Math.max(0, Math.round(t * sr));
    if (f >= sr * 0.47 || amp === 0) return;
    const n = Math.min(a.length - i0, Math.ceil(tau * 7 * sr));
    if (n < 3) return;
    const w = TAU * f / sr, r = Math.exp(-1 / (tau * sr));
    const c = 2 * r * Math.cos(w), r2 = r * r;
    let y2 = amp * Math.sin(ph), y1 = amp * r * Math.sin(w + ph);
    a[i0] += y2; a[i0 + 1] += y1;
    for (let i = 2; i < n; i++) { const y = c * y1 - r2 * y2; a[i0 + i] += y; y2 = y1; y1 = y; }
  }
  modes(a, t, f0, ratios, amps, taus, scale = 1, tauScale = 1) {
    for (let i = 0; i < ratios.length; i++) {
      const jitter = 1 + (this.rnd() - 0.5) * 0.04;
      this.mode(a, t, f0 * ratios[i] * jitter, amps[i] * scale, taus[i] * tauScale, this.rnd() * TAU);
    }
  }
  // decaying noise burst; color 0..0.97 smooths it (one-pole lowpass)
  burst(a, t, amp, tau, color = 0) {
    const sr = this.sr; const i0 = Math.max(0, Math.round(t * sr));
    const n = Math.min(a.length - i0, Math.ceil(tau * 7 * sr) + 2);
    const k = Math.exp(-1 / (tau * sr)); let e = amp, y = 0;
    const comp = color > 0 ? 1 / (1 - color) * 0.6 : 1;
    for (let i = 0; i < n; i++) {
      const x = (this.rnd() * 2 - 1) * e;
      y = color > 0 ? y * color + x * (1 - color) : x;
      a[i0 + i] += y * comp; e *= k;
    }
  }
  imp(a, t, amp) { const i = Math.round(t * this.sr); if (i >= 0 && i < a.length) a[i] += amp; }
  // water/wet bubble: sine whose pitch rises as it decays
  bubble(a, t, f0, amp, tau, rise = 2.5) {
    const sr = this.sr; const i0 = Math.max(0, Math.round(t * sr));
    const n = Math.min(a.length - i0, Math.ceil(tau * 5 * sr));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / sr; const f = f0 * (1 + rise * tt / tau * 0.25);
      ph += TAU * f / sr;
      a[i0 + i] += amp * Math.exp(-tt / tau) * Math.sin(ph) * Math.min(1, i / 20);
    }
  }
  // irregular impulse train (stick-slip friction): rateFn(u), ampFn(u), u = 0..1 over [t0, t1]
  pulses(a, t0, t1, rateFn, ampFn, jitter = 0.1, tau = 0) {
    let t = t0;
    while (t < t1) {
      const u = (t - t0) / (t1 - t0);
      const amp = ampFn(u) * (0.75 + 0.5 * this.rnd());
      if (tau > 0) this.burst(a, t, amp, tau); else this.imp(a, t, amp);
      const rate = Math.max(0.5, rateFn(u));
      t += (1 / rate) * (1 + jitter * (this.rnd() * 2 - 1));
    }
  }
  filt(a, type, f, Q = 0.707, gainDb = 0) {
    const [b0, b1, b2, a1, a2] = biquad(type, f, Q, gainDb, this.sr);
    const o = new Float32Array(a.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i]; const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      o[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return o;
  }
  // bank of resonators (bandpass), each normalised so weights mean what they say
  resonate(a, list) {
    const o = new Float32Array(a.length);
    for (const [f, Q, g] of list) {
      const b = this.norm(this.filt(a, 'bandpass', f, Q), 1);
      for (let i = 0; i < o.length; i++) o[i] += b[i] * g;
    }
    return o;
  }
  norm(a, peak = 1) {
    let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; }
    if (m > 0) { const s = peak / m; for (let i = 0; i < a.length; i++) a[i] *= s; }
    return a;
  }
  add(dst, src, g = 1, offset = 0) {
    const o = Math.round(offset * this.sr);
    for (let i = 0; i < src.length && i + o < dst.length; i++) if (i + o >= 0) dst[i + o] += src[i] * g;
    return dst;
  }
  // smooth random control curve: n points over T seconds, new target every [segMin, segMax] s
  wander(n, T, segMin, segMax, lo, hi, shape = 1) {
    const pts = []; let t = 0;
    while (t <= T + segMax) { pts.push([t, lo + (hi - lo) * Math.pow(this.rnd(), shape)]); t += this.rr(segMin, segMax); }
    const out = new Float32Array(n); let j = 0;
    for (let i = 0; i < n; i++) {
      const tt = (i / (n - 1)) * T;
      while (j < pts.length - 2 && pts[j + 1][0] < tt) j++;
      const [ta, va] = pts[j], [tb, vb] = pts[j + 1];
      const u = Math.min(1, Math.max(0, (tt - ta) / (tb - ta)));
      const s = (1 - Math.cos(Math.PI * u)) / 2;
      out[i] = va + (vb - va) * s;
    }
    return out;
  }

  // ---- graph helpers
  src(a, t0 = 0, dest = this.mix, gain = 1) {
    const b = this.ctx.createBuffer(1, a.length, this.sr);
    b.getChannelData(0).set(a);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    if (dest) { if (gain !== 1) { const g = this.g(gain); s.connect(g); g.connect(dest); } else s.connect(dest); }
    s.start(t0);
    return s;
  }
  noise(color = 'white', t0 = 0, t1 = this.T) {
    const s = this.ctx.createBufferSource();
    const b = this.pick(this.noises[color]);
    s.buffer = b; s.loop = true;
    s.start(t0, this.rnd() * b.duration * 0.9); s.stop(Math.min(this.T, t1) + 0.01);
    return s;
  }
  osc(type, f, t0 = 0, t1 = this.T) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    o.start(t0); o.stop(Math.min(this.T, t1) + 0.01);
    return o;
  }
  g(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  f(type, freq, Q = 0.707, gain = 0) {
    const f = this.ctx.createBiquadFilter(); f.type = type;
    f.frequency.value = Math.min(freq, this.sr * 0.48); f.Q.value = Q; f.gain.value = gain;
    return f;
  }
  ws(amount) {
    const w = this.ctx.createWaveShaper(); const n = 2048; const c = new Float32Array(n);
    const norm = Math.tanh(amount);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / norm; }
    w.curve = c; w.oversample = '2x';
    return w;
  }
  conv(ir) { const c = this.ctx.createConvolver(); c.normalize = true; c.buffer = ir; return c; }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  // envelope points: [t, v, mode]  mode: 'l' linear (default), 'x' exponential, 'h' jump
  env(param, pts) {
    const ny = this.sr * 0.48;
    const clampV = (v) => (param.maxValue !== undefined && param.maxValue < 1e9 ? Math.min(v, param.maxValue, ny) : v);
    param.setValueAtTime(clampV(pts[0][1]), pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      const [t, v, m] = pts[i];
      if (m === 'x') param.exponentialRampToValueAtTime(Math.max(1e-5, clampV(v)), t);
      else if (m === 'h') param.setValueAtTime(clampV(v), t);
      else param.linearRampToValueAtTime(clampV(v), t);
    }
  }
  curve(param, values, t0 = 0, dur = this.T - t0) { param.setValueCurveAtTime(values, t0, Math.max(0.01, dur - 0.001)); }
  // parallel bandpass bank on a node
  bank(input, list, dest = this.mix) {
    for (const [f, Q, g] of list) this.chain(input, this.f('bandpass', f, Q), this.g(g), dest);
  }
}

// ---------------------------------------------------------------- building blocks

const WOOD = { r: [1, 2.27, 3.62, 5.1, 6.9], a: [1, 0.6, 0.42, 0.27, 0.16], t: [0.05, 0.03, 0.02, 0.014, 0.01] };
const METAL = { r: [1, 1.58, 2.33, 3.17, 4.12, 5.4], a: [1, 0.8, 0.6, 0.45, 0.3, 0.2], t: [0.05, 0.04, 0.035, 0.03, 0.022, 0.018] };
const BRASS = { r: [1, 1.47, 2.09, 2.76, 3.6], a: [1, 0.7, 0.5, 0.35, 0.2], t: [0.06, 0.05, 0.04, 0.03, 0.02] };
const GLASS = { r: [1, 1.71, 2.53, 3.62, 4.9, 6.3], a: [1, 0.75, 0.55, 0.4, 0.28, 0.18], t: [0.09, 0.07, 0.055, 0.045, 0.035, 0.025] };

function woodKnock(k, a, t, amp, f0, tauScale = 1) {
  k.modes(a, t, f0, WOOD.r, WOOD.a, WOOD.t, amp, tauScale);
  k.burst(a, t, amp * 0.5, 0.0015, 0.5);
}
function metalClick(k, a, t, amp, f0, tauScale = 1) {
  k.burst(a, t, amp * 0.9, 0.0005);
  k.modes(a, t, f0, METAL.r, METAL.a, METAL.t, amp * 0.35, tauScale * k.rr(0.4, 0.8));
}
function brassTink(k, a, t, amp, f0) { k.modes(a, t, f0, BRASS.r, BRASS.a, BRASS.t, amp * 0.5, k.rr(0.5, 1)); k.burst(a, t, amp * 0.3, 0.0004); }
function glassRing(k, a, t, amp, f0, tauScale = 1) { k.modes(a, t, f0, GLASS.r, GLASS.a, GLASS.t, amp, tauScale); }

// creak: stick-slip impulses through resonances
function creak(k, t0, t1, rateFn, ampFn, res, jitter = 0.15) {
  const p = k.arr();
  k.pulses(p, t0, t1, rateFn, ampFn, jitter, 0.00025);
  return k.resonate(p, res);
}
const bell = (u, a = 0.15, r = 0.3) => (u < a ? u / a : u > 1 - r ? Math.max(0, (1 - u) / r) : 1);

// insect click cluster (mandibles, leg tips)
function chitinClick(k, a, t, amp, f0) {
  k.burst(a, t, amp, 0.0003);
  k.mode(a, t, f0, amp * 0.6, k.rr(0.0012, 0.003));
  k.mode(a, t, f0 * k.rr(1.35, 1.55), amp * 0.4, k.rr(0.0008, 0.002));
  k.mode(a, t, f0 * k.rr(0.45, 0.6), amp * 0.3, 0.002);
  k.mode(a, t, f0 * k.rr(0.22, 0.3), amp * 0.3, 0.003);
}

// the screech used by spiderScream / spiderPain
function screech(k, T, intensity = 1) {
  const sr = k.sr;
  const f0 = k.rr(650, 950), fPeak = f0 * k.rr(1.3, 1.6), fEnd = f0 * k.rr(0.35, 0.55);
  const saw = k.osc('sawtooth', f0, 0, T);
  k.env(saw.frequency, [[0, f0], [Math.min(0.05, T * 0.1), fPeak, 'x'], [T * 0.45, fPeak * k.rr(0.85, 1.05), 'x'], [T * 0.92, fEnd, 'x']]);
  const vib = k.osc('sine', k.rr(17, 29), 0, T); const vg = k.g(f0 * k.rr(0.05, 0.1));
  k.chain(vib, vg, saw.frequency);
  // jitter: a second slow random wobble
  const wob = k.osc('triangle', k.rr(5, 8), 0, T); const wg = k.g(f0 * 0.04); k.chain(wob, wg, saw.frequency);
  // stuttering amplitude (insect chatter) times overall envelope
  const n = Math.ceil(T * 400); const curve = new Float32Array(n);
  const rate = k.rr(22, 36); let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); const t = u * T;
    ph += TAU * rate * (1 + 0.3 * Math.sin(t * 7)) * (T / n) * (1 - 0.4 * u);
    const gate = 0.5 + 0.5 * Math.tanh(4 * Math.sin(ph));
    const envv = Math.min(1, t / 0.015) * (u < 0.6 ? 1 : Math.pow(Math.max(0, (1 - u) / 0.4), 1.4));
    curve[i] = envv * (0.45 + 0.55 * gate) * intensity;
  }
  const amp = k.g(0); k.curve(amp.gain, curve);
  saw.connect(amp);
  const voice = k.g(1);
  k.bank(amp, [[k.rr(1900, 2400), 4, 1.6], [k.rr(3100, 3700), 5, 1.3], [k.rr(4800, 5600), 4, 0.9], [k.rr(900, 1200), 3, 0.6]], voice);
  voice.connect(k.mix);
  // FM squeal on top
  const car = k.osc('sine', k.rr(2600, 3400), 0, T); const mod = k.osc('sine', k.rr(170, 260), 0, T);
  const mg = k.g(k.rr(500, 900)); k.chain(mod, mg, car.frequency);
  k.env(car.frequency, [[0, car.frequency.value], [T, car.frequency.value * 0.6, 'x']]);
  const cg = k.g(0); k.env(cg.gain, [[0, 0], [0.03, 0.18 * intensity], [T * 0.5, 0.12], [T * 0.85, 0.0001, 'x']]);
  k.chain(car, cg, k.mix);
  // rasp noise
  const nz = k.noise('white', 0, T); const nb = k.f('bandpass', k.rr(3500, 4500), 1.2); const ng = k.g(0);
  k.curve(ng.gain, curve.map((v) => v * 0.6));
  k.chain(nz, nb, ng, k.mix);
}

// breathing: noise through formant filters with an envelope
function breathLayer(k, t0, t1, color, formants, peak, attackFrac = 0.35) {
  const n = k.noise(color, t0, t1 + 0.05); const g = k.g(0); const len = t1 - t0;
  k.env(g.gain, [[t0, 0], [t0 + len * attackFrac, peak], [t0 + len * 0.75, peak * 0.6], [t1, 0]]);
  n.connect(g);
  k.bank(g, formants);
  return g;
}

// ---------------------------------------------------------------- impulse responses

// Impulse responses must match the sample rate of the context they are used in.
export async function renderIR(kind, sr = SR) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const T = kind === 'room' ? 0.95 : 2.4;
  const ctx = new Off(2, Math.ceil(T * sr), sr);
  const k = new Kit(ctx, mulberry32(kind === 'room' ? 77 : 99), null, true);
  for (const [chan, seed] of [[k.L, 0], [k.R, 1]]) {
    const a = k.arr();
    if (kind === 'room') {
      // small wooden room (wet only, no direct sound): dense early reflections, then a boomy, dark tail
      for (let i = 0; i < 14; i++) k.burst(a, k.rr(0.002, 0.028), k.rr(0.15, 0.55) * (1 - i / 16), 0.0007, 0.3);
      const tail = k.arr();
      for (let i = 0; i < tail.length; i++) tail[i] = (k.r() * 2 - 1) * Math.exp(-i / sr / 0.115);
      const low = k.filt(tail, 'lowpass', 420, 0.7); // wood: lows ring longer
      const lowLong = k.arr();
      for (let i = 0; i < lowLong.length; i++) lowLong[i] = low[i] * Math.exp(i / sr / 0.115 - i / sr / 0.16);
      const mid = k.filt(tail, 'bandpass', 1400, 0.6);
      const hi = k.filt(tail, 'highpass', 3500, 0.7);
      for (let i = 0; i < hi.length; i++) hi[i] *= Math.exp(-i / sr / 0.05);
      k.add(a, k.norm(lowLong, 0.55), 1, 0.006);
      k.add(a, k.norm(mid, 0.3), 1, 0.008);
      k.add(a, k.norm(hi, 0.12), 1, 0.006);
      // room modes (6 x 8 x 2.6 m wooden box): the 'boom'
      for (const f of [57, 66, 86, 107, 132, 171, 214]) k.mode(a, 0.004, f * k.rr(0.97, 1.03), 0.05, k.rr(0.12, 0.2), k.r() * TAU);
      // fade end
      for (let i = 0; i < 2000; i++) a[a.length - 1 - i] *= i / 2000;
    } else {
      // forest: sparse reflections off trees for 0.4 s, then a long diffuse dark tail
      k.imp(a, 0, 0.0001);
      for (let i = 0; i < 40; i++) { const t = k.rr(0.02, 0.45); k.burst(a, t, k.rr(0.05, 0.4) * Math.exp(-t / 0.3), 0.002, 0.6); }
      const tail = k.arr();
      for (let i = 0; i < tail.length; i++) { const t = i / sr; tail[i] = (k.r() * 2 - 1) * Math.exp(-t / 0.42) * Math.min(1, t / 0.08); }
      k.add(a, k.norm(k.filt(k.filt(tail, 'lowpass', 2200, 0.6), 'highpass', 120, 0.6), 0.35), 1);
      for (let i = 0; i < 4000; i++) a[a.length - 1 - i] *= i / 4000;
    }
    void seed;
    k.src(a, 0, chan);
  }
  return ctx.startRendering();
}

// ---------------------------------------------------------------- recipes

export const RECIPES = {
  // ================================================================ weapon
  gunshot: {
    variants: 4, lowVariants: 3, dur: 1.9, gain: 1.0, reverb: 0.75, peak: 0.97,   // milestone 3: heavier, longer tail (lever-action .30-30)
    render(k) {
      const t0 = 0.003;
      k.drive(2.0);
      // the crack: an extremely sharp broadband transient
      const c = k.arr(0.05);
      k.burst(c, t0, 1, 0.0009); k.burst(c, t0 + 0.0003, 0.7, 0.003);
      k.chain(k.src(c, 0, null), k.f('highpass', 1400, 0.6), k.g(0.85), k.mix);
      // the blast: noise with a lowpass that closes fast
      const n = k.noise('white', 0, 1.0); const lp = k.f('lowpass', 12000, 0.5); const g = k.g(0);
      k.env(lp.frequency, [[0, 15000], [t0 + 0.015, 5000, 'x'], [0.1, 1400, 'x'], [0.6, 260, 'x']]);
      k.env(g.gain, [[0, 0], [t0, 0], [t0 + 0.0005, 1], [t0 + 0.01, 0.5, 'x'], [0.08, 0.13, 'x'], [0.35, 0.015, 'x'], [0.95, 0.0001, 'x']]);
      k.chain(n, lp, g, k.mix);
      // chest-thump: sine with a pitch drop
      const o = k.osc('sine', 140, 0, 0.9); const og = k.g(0);
      k.env(o.frequency, [[0, k.rr(140, 175)], [t0 + 0.04, 62, 'x'], [0.45, 36, 'x']]);
      k.env(og.gain, [[0, 0], [t0, 0], [t0 + 0.0015, 1.1], [0.08, 0.6, 'x'], [0.75, 0.0001, 'x']]);
      k.chain(o, og, k.mix);
      // pressure body: lowpassed brown noise, longer
      const b = k.noise('brown', 0, 1.85); const bl = k.f('lowpass', 240, 0.8); const bg = k.g(0);
      k.env(bg.gain, [[0, 0], [t0, 0], [t0 + 0.003, 1.3], [0.18, 0.4, 'x'], [1.75, 0.0001, 'x']]);
      k.chain(b, bl, bg, k.mix);
      // mid punch
      const m = k.noise('pink', 0, 0.4); const mb = k.f('bandpass', k.rr(650, 900), 1.1); const mg = k.g(0);
      k.env(mg.gain, [[0, 0], [t0, 0], [t0 + 0.001, 1.4], [0.05, 0.2, 'x'], [0.3, 0.0001, 'x']]);
      k.chain(m, mb, mg, k.mix);
      // a short metallic knock of the action (no long ring: it read as a 'ping')
      const r = k.arr(0.3); k.modes(r, t0 + 0.002, k.rr(1800, 2400), [1, 1.58, 2.33], [1, 0.7, 0.5], [0.025, 0.02, 0.015], 0.05);
      k.src(r, 0, k.mix);
    },
  },
  dryFire: {
    variants: 4, lowVariants: 2, dur: 0.22, gain: 0.5, reverb: 0.1, peak: 0.8,
    render(k) {
      const a = k.arr(); const t = 0.004;
      metalClick(k, a, t, 1, k.rr(2300, 3200));
      metalClick(k, a, t + k.rr(0.011, 0.02), k.rr(0.35, 0.55), k.rr(1400, 1900));
      woodKnock(k, a, t + 0.001, 0.25, k.rr(380, 460), 0.4); // stock/body resonance
      k.src(k.filt(a, 'highpass', 250), 0);
    },
  },
  magOut: {
    variants: 3, lowVariants: 2, dur: 0.7, gain: 0.55, reverb: 0.1, peak: 0.85,
    render(k) {
      const a = k.arr();
      metalClick(k, a, 0.01, 0.45, k.rr(2800, 3400)); // release button
      // metal slide friction
      const n = k.noise('white', 0.03, 0.17); const bp = k.f('bandpass', 1800, 2.2); const g = k.g(0);
      k.env(bp.frequency, [[0.03, 1800], [0.16, 3200, 'x']]);
      k.env(g.gain, [[0.03, 0], [0.12, 0.35], [0.16, 0.05]]);
      k.chain(n, bp, g, k.mix);
      const tc = k.rr(0.13, 0.16);
      metalClick(k, a, tc, 0.8, k.rr(1600, 2000));
      woodKnock(k, a, tc + 0.002, 0.55, k.rr(380, 460), 0.6);
      for (let i = 0, nn = k.ri(3, 6); i < nn; i++) brassTink(k, a, tc + k.rr(0.02, 0.2), k.rr(0.08, 0.25), k.rr(3800, 6500));
      // caught in the palm
      const tp = tc + k.rr(0.2, 0.3); k.mode(a, tp, k.rr(140, 180), 0.5, 0.025); k.burst(a, tp, 0.3, 0.008, 0.85);
      k.src(a, 0);
    },
  },
  magIn: {
    variants: 3, lowVariants: 2, dur: 0.6, gain: 0.6, reverb: 0.1, peak: 0.88,
    render(k) {
      const a = k.arr();
      const n = k.noise('white', 0, 0.14); const bp = k.f('bandpass', 2200, 2); const g = k.g(0);
      k.env(bp.frequency, [[0, 2400], [0.13, 1500, 'x']]);
      k.env(g.gain, [[0, 0], [0.09, 0.3], [0.13, 0.4], [0.135, 0]]);
      k.chain(n, bp, g, k.mix);
      const tl = k.rr(0.13, 0.15);
      metalClick(k, a, tl, 1, k.rr(2200, 2700));
      metalClick(k, a, tl + k.rr(0.004, 0.008), 0.6, k.rr(3200, 3700));
      woodKnock(k, a, tl, 0.8, k.rr(240, 300), 0.8);
      k.mode(a, tl, k.rr(110, 130), 0.6, 0.03);
      k.burst(a, tl, 0.5, 0.012, 0.9); // palm slap
      for (let i = 0, nn = k.ri(2, 3); i < nn; i++) brassTink(k, a, tl + k.rr(0.02, 0.1), k.rr(0.05, 0.15), k.rr(4000, 6000));
      k.src(a, 0);
    },
  },
  roundLoad: {
    variants: 4, lowVariants: 2, dur: 0.22, gain: 0.45, reverb: 0.08, peak: 0.8,
    render(k) {
      const a = k.arr();
      const n = k.noise('white', 0, 0.06); const bp = k.f('bandpass', k.rr(3000, 4200), 2.5); const g = k.g(0);
      k.env(g.gain, [[0, 0], [0.04, 0.25], [0.055, 0]]); k.chain(n, bp, g, k.mix);
      const t = k.rr(0.05, 0.065);
      brassTink(k, a, t, 0.9, k.rr(3800, 5200));
      metalClick(k, a, t + 0.002, 0.5, k.rr(1500, 1900)); // spring
      k.src(a, 0);
    },
  },
  boltRack: {
    variants: 3, lowVariants: 2, dur: 0.9, gain: 0.65, reverb: 0.12, peak: 0.9,
    render(k) {
      const a = k.arr();
      metalClick(k, a, 0.01, 0.5, k.rr(1900, 2300)); // handle lifts
      const back0 = 0.03, back1 = k.rr(0.15, 0.19);
      const n = k.noise('white', back0, back1); const bp = k.f('bandpass', 1500, 2.5); const g = k.g(0);
      k.env(bp.frequency, [[back0, 1500], [back1, 3100, 'x']]); k.env(g.gain, [[back0, 0], [back0 + 0.04, 0.3], [back1, 0.25], [back1 + 0.005, 0]]);
      k.chain(n, bp, g, k.mix);
      metalClick(k, a, back1, 0.8, k.rr(1400, 1700)); woodKnock(k, a, back1, 0.4, k.rr(280, 330), 0.6);
      if (k.chance(0.7)) { // spent casing hits the floor
        let tt = back1 + k.rr(0.12, 0.2), amp = 0.3; const f = k.rr(4200, 5600);
        for (let i = 0; i < 3; i++) { brassTink(k, a, tt, amp, f * k.rr(0.97, 1.03)); tt += 0.09 * Math.pow(0.6, i); amp *= 0.5; }
      }
      const f0 = back1 + k.rr(0.12, 0.17), f1 = f0 + k.rr(0.1, 0.13);
      const n2 = k.noise('white', f0, f1); const bp2 = k.f('bandpass', 2600, 2.5); const g2 = k.g(0);
      k.env(bp2.frequency, [[f0, 2800], [f1, 1600, 'x']]); k.env(g2.gain, [[f0, 0], [f0 + 0.03, 0.28], [f1, 0.3], [f1 + 0.005, 0]]);
      k.chain(n2, bp2, g2, k.mix);
      metalClick(k, a, f1, 1, k.rr(1200, 1450)); woodKnock(k, a, f1, 0.8, k.rr(200, 250), 0.9); k.mode(a, f1, 105, 0.5, 0.03);
      metalClick(k, a, f1 + k.rr(0.05, 0.08), 0.6, k.rr(2400, 2800)); // handle down
      k.src(a, 0);
    },
  },
  // lever-action cycle: lever down (hammer cocks, case kicked out), lever up (round chambers, lever locks)
  leverCycle: {
    variants: 4, lowVariants: 2, dur: 0.55, gain: 0.7, reverb: 0.12, peak: 0.9,
    render(k) {
      const a = k.arr();
      const t1 = 0.01;
      metalClick(k, a, t1, 0.8, k.rr(1700, 2100));            // lever unlatches
      const d0 = t1 + 0.005, d1 = d0 + k.rr(0.07, 0.09);      // bolt slides back
      const n = k.noise('white', d0, d1); const bp = k.f('bandpass', 1700, 2.4); const g = k.g(0);
      k.env(bp.frequency, [[d0, 1500], [d1, 2900, 'x']]); k.env(g.gain, [[d0, 0], [d0 + 0.02, 0.35], [d1, 0.25], [d1 + 0.004, 0]]);
      k.chain(n, bp, g, k.mix);
      metalClick(k, a, d1, 0.9, k.rr(1300, 1600)); woodKnock(k, a, d1, 0.45, k.rr(260, 320), 0.6);   // fully open
      const u0 = d1 + k.rr(0.1, 0.13), u1 = u0 + k.rr(0.06, 0.08);   // closing
      const n2 = k.noise('white', u0, u1); const bp2 = k.f('bandpass', 2400, 2.4); const g2 = k.g(0);
      k.env(bp2.frequency, [[u0, 2800], [u1, 1500, 'x']]); k.env(g2.gain, [[u0, 0], [u0 + 0.02, 0.3], [u1, 0.32], [u1 + 0.004, 0]]);
      k.chain(n2, bp2, g2, k.mix);
      metalClick(k, a, u1, 1, k.rr(1150, 1400)); woodKnock(k, a, u1, 0.9, k.rr(190, 240), 0.9); k.mode(a, u1, 100, 0.5, 0.03);   // locks shut
      k.src(a, 0);
    },
  },
  // the spent case bouncing on the floorboards
  caseTink: {
    variants: 4, lowVariants: 2, dur: 0.6, gain: 0.35, reverb: 0.15, peak: 0.8,
    render(k) {
      const a = k.arr();
      let t = 0.005, amp = 1; const f = k.rr(4200, 5600);
      for (let i = 0, nn = k.ri(3, 4); i < nn; i++) { brassTink(k, a, t, amp, f * k.rr(0.97, 1.03)); woodKnock(k, a, t, amp * 0.15, k.rr(900, 1300), 0.3); t += k.rr(0.07, 0.12) * Math.pow(0.65, i); amp *= 0.5; }
      k.src(a, 0);
    },
  },
  // one round pushed into the loading gate: brass on steel, the gate spring snapping shut
  roundInsert: {
    variants: 4, lowVariants: 2, dur: 0.25, gain: 0.5, reverb: 0.08, peak: 0.8,
    render(k) {
      const a = k.arr();
      const n = k.noise('white', 0, 0.07); const bp = k.f('bandpass', k.rr(2600, 3400), 2.5); const g = k.g(0);
      k.env(g.gain, [[0, 0], [0.05, 0.3], [0.065, 0]]); k.chain(n, bp, g, k.mix);
      const t = k.rr(0.06, 0.075);
      metalClick(k, a, t, 0.8, k.rr(1900, 2400));
      brassTink(k, a, t + 0.001, 0.5, k.rr(3800, 5000));
      metalClick(k, a, t + k.rr(0.012, 0.02), 0.45, k.rr(2900, 3400));   // gate snaps back
      k.src(a, 0);
    },
  },
  // axe through the air
  axeSwing: {
    variants: 4, lowVariants: 2, dur: 0.45, gain: 0.55, reverb: 0.05, peak: 0.85,
    render(k) {
      const n = k.noise('pink', 0, 0.42); const bp = k.f('bandpass', 500, 1.6); const g = k.g(0);
      const pk = k.rr(0.16, 0.2);
      k.env(bp.frequency, [[0, 350], [pk, k.rr(1100, 1500), 'x'], [0.4, 400, 'x']]);
      k.env(g.gain, [[0, 0], [pk, 0.9], [0.4, 0.0001, 'x']]);
      k.chain(n, bp, g, k.mix);
    },
  },
  // the axe biting into a spider: a heavy chop, cracking shell, a wet give
  axeChop: {
    variants: 4, lowVariants: 2, dur: 0.7, gain: 0.95, reverb: 0.1, peak: 0.95,
    render(k) {
      const a = k.arr(); const t0 = 0.003;
      k.drive(1.4);
      k.burst(a, t0, 1, 0.0012, 0.3);
      k.mode(a, t0, k.rr(85, 110), 1, 0.07);
      for (let i = 0, nn = k.ri(10, 18); i < nn; i++) {
        const t = t0 + Math.pow(k.r(), 1.5) * 0.06; const amp = k.rr(0.3, 1) * Math.exp(-(t - t0) / 0.04);
        k.burst(a, t, amp, k.rr(0.0002, 0.0007)); k.mode(a, t, k.rr(1200, 3500), amp * 0.35, k.rr(0.003, 0.009));
      }
      const w = k.arr();
      for (let i = 0, nn = k.ri(8, 14); i < nn; i++) k.bubble(w, t0 + k.rr(0.02, 0.3), k.rr(150, 500), k.rr(0.2, 0.7), k.rr(0.01, 0.03), k.rr(1, 3));
      k.add(a, k.norm(w, 0.6));
      k.src(a, 0);
    },
  },
  // boot stamping the floorboards
  stomp: {
    variants: 3, lowVariants: 2, dur: 0.5, gain: 0.8, reverb: 0.2, peak: 0.9,
    render(k) {
      const a = k.arr(); const t0 = 0.003;
      woodKnock(k, a, t0, 1, k.rr(120, 160), 1.6);
      k.mode(a, t0, k.rr(55, 70), 1, 0.09);
      k.burst(a, t0, 0.6, 0.004, 0.6);
      for (let i = 0, nn = k.ri(2, 4); i < nn; i++) woodKnock(k, a, t0 + k.rr(0.01, 0.06), k.rr(0.05, 0.15), k.rr(700, 1300), 0.4);  // boards rattle
      k.src(k.filt(a, 'lowpass', 3000), 0);
    },
  },
  // a spider crushed under the boot
  stompSquish: {
    variants: 3, lowVariants: 2, dur: 0.55, gain: 0.85, reverb: 0.06, peak: 0.9,
    render(k) {
      const a = k.arr(); const t0 = 0.004;
      for (let i = 0, nn = k.ri(14, 24); i < nn; i++) {
        const t = t0 + Math.pow(k.r(), 1.3) * 0.09; const amp = k.rr(0.3, 1) * Math.exp(-(t - t0) / 0.06);
        k.burst(a, t, amp, k.rr(0.0002, 0.0006)); k.mode(a, t, k.rr(1800, 4500), amp * 0.3, k.rr(0.002, 0.006));
      }
      const w = k.arr();
      for (let i = 0, nn = k.ri(10, 16); i < nn; i++) k.bubble(w, t0 + k.rr(0.01, 0.35), k.rr(120, 420), k.rr(0.3, 0.8), k.rr(0.012, 0.035), k.rr(0.5, 2));
      k.add(a, k.norm(w, 0.75));
      k.src(a, 0);
    },
  },
  // the killing hit (user: make kills sound better). Three layers so a kill never sounds like a hit:
  // the body bursting (deep thump, shell splitting, a wet blast), a strangled dying screech, then the chunks
  // pattering down and sliding for a second.
  spiderKill: {
    variants: 5, lowVariants: 3, dur: 1.7, gain: 1.0, reverb: 0.1, peak: 0.95,
    render(k) {
      const a = k.arr(); const t0 = 0.004;
      k.drive(1.8);
      // burst: a low gut thump with a pitch drop, and the shell splitting
      const o = k.osc('sine', 90, 0, 0.5); const og = k.g(0);
      k.env(o.frequency, [[0, k.rr(85, 110)], [0.12, 38, 'x']]);
      k.env(og.gain, [[0, 0], [t0 + 0.002, 1.2], [0.06, 0.5, 'x'], [0.45, 0.0001, 'x']]);
      k.chain(o, og, k.mix);
      k.burst(a, t0, 1, 0.003, 0.3);
      for (let i = 0, nn = k.ri(24, 36); i < nn; i++) {
        const t = t0 + Math.pow(k.r(), 1.5) * 0.1; const amp = k.rr(0.3, 1) * Math.exp(-(t - t0) / 0.06);
        k.burst(a, t, amp, k.rr(0.0002, 0.0008)); k.mode(a, t, k.rr(900, 3600), amp * 0.45, k.rr(0.004, 0.012));
      }
      // the wet blast: pink noise through a lowpass that closes, like something full giving way
      const n = k.noise('pink', 0, 0.7); const lp = k.f('lowpass', 4500, 0.9); const ng = k.g(0);
      k.env(lp.frequency, [[0, 5000], [0.05, 1600, 'x'], [0.5, 300, 'x']]);
      k.env(ng.gain, [[0, 0], [t0 + 0.003, 1.1], [0.04, 0.45, 'x'], [0.6, 0.0001, 'x']]);
      k.chain(n, lp, ng, k.mix);
      // the screech: a short rasping cry that chokes off and falls in pitch
      const sc0 = k.rr(0.015, 0.05), scLen = k.rr(0.28, 0.5), f0 = k.rr(700, 1300);
      const v = k.osc('sawtooth', f0, sc0, sc0 + scLen + 0.05); const vg = k.g(0);
      k.env(v.frequency, [[0, f0], [sc0, f0 * k.rr(1.1, 1.35)], [sc0 + scLen * 0.4, f0, 'x'], [sc0 + scLen, f0 * 0.35, 'x']]);
      const rasp = k.noise('white', sc0, sc0 + scLen + 0.05); const rb = k.f('bandpass', f0 * 2.2, 2.5); const rg = k.g(0.5);
      k.chain(rasp, rb, rg);
      const form = k.f('bandpass', k.rr(1800, 2600), 3); const form2 = k.f('bandpass', k.rr(700, 1000), 2.5);
      v.connect(form); v.connect(form2); rg.connect(form);
      form.connect(vg); form2.connect(vg);
      k.env(vg.gain, [[0, 0], [sc0, 0], [sc0 + 0.02, 0.55], [sc0 + scLen * 0.6, 0.35, 'x'], [sc0 + scLen, 0.0001, 'x']]);
      k.chain(vg, k.ws(3), k.g(0.6), k.mix);
      // chunks landing and sliding: wet patters spread over a second, thinning out
      const w = k.arr();
      for (let i = 0, nn = k.ri(16, 26); i < nn; i++) {
        const t = t0 + 0.08 + Math.pow(k.r(), 1.8) * 1.2; const amp = k.rr(0.25, 0.9) * Math.exp(-(t - 0.08) / 0.5);
        k.bubble(w, t, k.rr(110, 420), amp, k.rr(0.012, 0.04), k.rr(0.6, 2));
        k.burst(w, t, amp * 0.25, k.rr(0.0004, 0.0015), 0.5);
      }
      k.add(a, k.norm(k.filt(w, 'lowpass', 2600), 0.7));
      k.src(a, 0);
    },
  },
  ammoPickup: {
    variants: 3, lowVariants: 2, dur: [1.0, 1.35], gain: 0.55, reverb: 0.1, peak: 0.85,
    render(k) {
      const T = k.T - 0.1;
      // cardboard / wooden crate rustle: dense tiny grains with a wandering intensity
      const rust = k.arr(); const inten = k.wander(200, T, 0.08, 0.25, 0, 1, 1.5);
      for (let t = 0.02; t < T; t += k.rr(0.004, 0.02)) {
        const amp = inten[Math.min(199, Math.floor((t / T) * 199))];
        k.burst(rust, t, amp * k.rr(0.2, 1), k.rr(0.001, 0.005), 0.4);
      }
      k.chain(k.src(k.norm(rust, 0.35), 0, null), k.f('bandpass', k.rr(1200, 1800), 0.8), k.mix);
      // rounds clinking
      const a = k.arr();
      for (let i = 0, nn = k.ri(10, 18); i < nn; i++) {
        const t = k.rr(0.05, T - 0.1), f = k.rr(3000, 6200);
        brassTink(k, a, t, k.rr(0.15, 0.5), f);
        if (k.chance(0.4)) brassTink(k, a, t + k.rr(0.008, 0.03), k.rr(0.08, 0.25), f * k.rr(0.8, 1.2));
      }
      // handful grabbed, bumping the box
      woodKnock(k, a, k.rr(0.1, 0.3), 0.5, k.rr(170, 230)); woodKnock(k, a, T - k.rr(0.05, 0.2), 0.4, k.rr(200, 260));
      k.src(a, 0);
    },
  },

  // ================================================================ glass & wood
  glassTap: {
    variants: 6, lowVariants: 3, dur: 0.45, gain: 0.7, reverb: 0.08, peak: 0.85,
    render(k, vi) {
      const a = k.arr(); const f0 = k.rr(950, 1500);
      const tap = (t, amp) => {
        k.burst(a, t, amp, 0.00025);
        glassRing(k, a, t, amp * 0.3, f0 * k.rr(0.98, 1.02), k.rr(0.6, 1.2));
        k.mode(a, t, k.rr(140, 210), amp * 0.35, 0.025); // the pane flexing
      };
      tap(0.003, 1);
      if (vi % 3 === 1) tap(k.rr(0.07, 0.13), k.rr(0.5, 0.85));
      if (vi % 3 === 2) { tap(k.rr(0.05, 0.08), 0.6); tap(k.rr(0.12, 0.17), 0.45); }
      k.src(k.filt(a, 'highpass', 90), 0);
    },
  },
  glassScratch: {
    variants: 4, lowVariants: 2, dur: [0.7, 1.3], gain: 0.7, reverb: 0.08, peak: 0.8,
    render(k) {
      const T = k.T - 0.05; const f0 = k.rr(1100, 1600);
      const rate = k.wander(64, 1, 0.1, 0.3, k.rr(220, 320), k.rr(500, 800));
      const env = (u) => bell(u, 0.08, 0.25) * (0.6 + 0.4 * Math.sin(u * 23 + 1));
      const sq = creak(k, 0.01, T, (u) => rate[Math.floor(u * 63)], env,
        GLASS.r.map((r, i) => [f0 * r, 22 - i * 2, GLASS.a[i]]), 0.12);
      k.src(k.norm(sq, 0.7), 0);
      // gritty scratch
      const n = k.noise('white', 0, T); const bp = k.f('bandpass', k.rr(3500, 5000), 0.9); const g = k.g(0);
      const fl = k.wander(300, T, 0.02, 0.06, 0.1, 1);
      for (let i = 0; i < fl.length; i++) fl[i] *= env(i / (fl.length - 1)) * 0.2;
      k.curve(g.gain, fl); k.chain(n, bp, g, k.mix);
      const a = k.arr(); k.burst(a, 0.01, 0.4, 0.0004); glassRing(k, a, 0.01, 0.1, f0, 0.8); k.src(a, 0);
    },
  },
  glassCrack: {
    variants: 4, lowVariants: 2, dur: 0.9, gain: 1.0, reverb: 0.25, refDistance: 3, peak: 0.92,
    render(k) {
      const a = k.arr(); const t0 = 0.003;
      k.burst(a, t0, 1, 0.0004); k.burst(a, t0, 0.6, 0.003);
      glassRing(k, a, t0, 0.35, k.rr(2000, 3200), k.rr(1.2, 2));
      k.mode(a, t0, k.rr(120, 180), 0.6, 0.05);
      // the crack running through the pane
      let t = t0 + 0.004;
      for (let i = 0, nn = k.ri(7, 15); i < nn; i++) {
        t += k.rr(0.004, 0.035) * (1 + i * 0.15); const amp = k.rr(0.15, 0.55) * Math.exp(-i / 8);
        k.burst(a, t, amp, k.rr(0.0002, 0.0007)); if (k.chance(0.5)) glassRing(k, a, t, amp * 0.12, k.rr(2500, 5000), 0.5);
      }
      k.src(k.filt(a, 'highpass', 100), 0);
    },
  },
  glassShatter: {
    variants: 4, lowVariants: 2, dur: 2.2, gain: 1.4, reverb: 0.3, refDistance: 4, peak: 0.95,
    render(k) {
      const a = k.arr(); const t0 = 0.004;
      k.mode(a, t0, k.rr(90, 130), 0.9, 0.06); k.burst(a, t0, 1, 0.002);
      // bright crash
      const n = k.noise('white', 0, 0.8); const hp = k.f('highpass', 2200, 0.6); const g = k.g(0);
      k.env(g.gain, [[0, 0], [t0, 0], [t0 + 0.002, 0.7], [0.06, 0.3, 'x'], [0.7, 0.0001, 'x']]);
      k.chain(n, hp, g, k.mix);
      // shards: breaking cloud, then pieces landing on sill and floor
      const sh = k.arr();
      for (let i = 0; i < 260; i++) {
        const falling = i > 150;
        const t = falling ? k.rr(0.25, 1.4) : t0 + -Math.log(1 - k.r() * 0.99) * 0.09;
        const amp = Math.pow(k.r(), 2.2) * (falling ? 0.35 : 0.6) * (falling ? Math.exp(-(t - 0.25) / 0.6) : 1);
        const f = k.lrr(2200, 11000);
        k.mode(sh, t, f, amp, k.rr(0.006, 0.05)); k.mode(sh, t, f * k.rr(1.4, 2.3), amp * 0.5, k.rr(0.004, 0.02));
        if (k.chance(0.3)) k.burst(sh, t, amp * 0.5, 0.0003);
      }
      // bigger pieces hitting the floor
      for (let i = 0, nn = k.ri(4, 8); i < nn; i++) {
        const t = k.rr(0.3, 1.1); const f = k.rr(700, 1600);
        glassRing(k, sh, t, k.rr(0.08, 0.2), f, 0.4); k.burst(sh, t, 0.15, 0.001, 0.5);
        glassRing(k, sh, t + k.rr(0.05, 0.12), k.rr(0.03, 0.08), f * 1.02, 0.3);
      }
      k.add(a, k.norm(sh, 0.8));
      k.src(k.filt(a, 'highpass', 60), 0);
    },
  },
  woodScrape: {
    variants: 4, lowVariants: 2, dur: [0.9, 1.6], gain: 0.55, reverb: 0.12, peak: 0.85,
    render(k) {
      const T = k.T - 0.05;
      const rate = k.wander(64, 1, 0.08, 0.3, 50, 180);
      const amp = k.wander(64, 1, 0.05, 0.2, 0.3, 1);
      const sc = creak(k, 0.01, T, (u) => rate[Math.floor(u * 63)], (u) => amp[Math.floor(u * 63)] * bell(u, 0.1, 0.2),
        [[k.rr(320, 420), 6, 1], [k.rr(750, 950), 8, 0.8], [k.rr(1400, 1800), 8, 0.5], [k.rr(2400, 3000), 6, 0.3]], 0.3);
      k.src(k.norm(sc, 0.6), 0);
      const n = k.noise('pink', 0, T); const bp = k.f('bandpass', k.rr(700, 1100), 0.8); const g = k.g(0);
      const c = new Float32Array(100); for (let i = 0; i < 100; i++) c[i] = bell(i / 99, 0.1, 0.2) * amp[Math.floor((i / 99) * 63)] * 0.5;
      k.curve(g.gain, c); k.chain(n, bp, g, k.mix);
      const cr = k.arr(); for (let i = 0, nn = k.ri(4, 10); i < nn; i++) k.burst(cr, k.rr(0.05, T - 0.1), k.rr(0.1, 0.4), 0.0006);
      k.src(k.filt(cr, 'highpass', 1500), 0);
    },
  },
  boardHit: {
    variants: 4, lowVariants: 2, dur: 0.9, gain: 1.0, reverb: 0.3, refDistance: 3, peak: 0.95,
    render(k) {
      k.drive(1.3);
      const a = k.arr(); const t0 = 0.004;
      k.modes(a, t0, k.rr(90, 140), [1, 2.1, 3.3, 4.6, 6.0, 7.7], [1, 0.6, 0.45, 0.3, 0.2, 0.12], [0.12, 0.07, 0.05, 0.035, 0.025, 0.02]);
      k.mode(a, t0, k.rr(62, 78), 0.7, 0.15); // the whole wall
      k.burst(a, t0, 0.9, 0.006, 0.8);
      for (let i = 0; i < 3; i++) metalClick(k, a, t0 + k.rr(0.008, 0.05), k.rr(0.05, 0.12), k.rr(3000, 5000)); // nails
      for (let i = 0, nn = k.ri(4, 9); i < nn; i++) k.burst(a, k.rr(0.05, 0.4), k.rr(0.02, 0.07), 0.0015, 0.3); // dust and grit
      k.src(a, 0);
    },
  },
  boardBreak: {
    variants: 3, lowVariants: 2, dur: 1.7, gain: 1.2, reverb: 0.3, refDistance: 4, peak: 0.95,
    render(k) {
      k.drive(1.4);
      const a = k.arr(); const t0 = 0.004;
      k.modes(a, t0, k.rr(95, 130), [1, 2.1, 3.3, 4.6, 6.0], [1, 0.6, 0.45, 0.3, 0.2], [0.1, 0.06, 0.045, 0.03, 0.02]);
      k.mode(a, t0, 70, 0.6, 0.12); k.burst(a, t0, 0.8, 0.005, 0.7);
      const snap = t0 + k.rr(0.03, 0.09);
      k.burst(a, snap, 1, 0.004, 0.2); k.mode(a, snap, k.rr(70, 90), 0.8, 0.08);
      // splinters
      for (let i = 0, nn = k.ri(10, 22); i < nn; i++) {
        const t = snap + Math.pow(k.r(), 1.8) * 0.4; const amp = k.rr(0.15, 0.7) * Math.exp(-(t - snap) / 0.25);
        k.burst(a, t, amp, k.rr(0.0004, 0.0015)); k.modes(a, t, k.rr(600, 1800), WOOD.r, WOOD.a, WOOD.t, amp * 0.3, 0.3);
      }
      // tearing fibres
      const n = k.noise('white', snap, snap + 0.5); const bp = k.f('bandpass', k.rr(1200, 1900), 1.4); const g = k.g(0);
      const fl = k.wander(120, 0.5, 0.01, 0.03, 0, 1, 2); for (let i = 0; i < 120; i++) fl[i] *= 0.45 * (1 - i / 119);
      k.curve(g.gain, fl, snap, 0.5); k.chain(n, bp, g, k.mix);
      // pieces landing
      for (let i = 0, nn = k.ri(3, 6); i < nn; i++) {
        const t = k.rr(0.45, 1.4); const f = k.rr(250, 600); const amp = k.rr(0.15, 0.45);
        woodKnock(k, a, t, amp, f); if (k.chance(0.6)) woodKnock(k, a, t + k.rr(0.06, 0.14), amp * 0.4, f * 1.05);
      }
      k.src(a, 0);
    },
  },
  footWood: {
    variants: 8, lowVariants: 5, dur: (vi) => (vi % 3 === 2 ? 0.95 : 0.42), gain: 0.38, reverb: 0.15, peak: 0.85,
    render(k, vi) {
      const a = k.arr(); const t0 = 0.004;
      const fB = k.rr(220, 380);
      k.mode(a, t0, k.rr(85, 120), 1, 0.04); k.burst(a, t0, 0.7, 0.006, 0.85); // heel
      woodKnock(k, a, t0, 0.35, fB, 0.7);
      const tt = t0 + k.rr(0.06, 0.11); // toe
      k.mode(a, tt, k.rr(110, 150), 0.4, 0.03); woodKnock(k, a, tt, 0.18, fB * 1.1, 0.6); k.burst(a, tt, 0.25, 0.004, 0.8);
      if (k.chance(0.5)) metalClick(k, a, t0 + k.rr(0.01, 0.04), 0.04, k.rr(2500, 4000)); // nail ticks in the board
      let out = k.filt(a, 'lowpass', 3500);
      if (vi % 3 === 2) { // floorboard creak
        const c0 = k.rr(0.05, 0.12), c1 = c0 + k.rr(0.25, 0.55);
        const p0 = k.rr(60, 90), p1 = k.rr(110, 160);
        const cr = creak(k, c0, c1, (u) => p0 + (p1 - p0) * Math.sin(Math.PI * u), (u) => bell(u, 0.25, 0.4),
          [[k.rr(480, 650), 12, 1], [k.rr(1050, 1350), 14, 0.7], [k.rr(1900, 2500), 10, 0.35]], 0.06);
        k.add(out, k.norm(cr, 0.35));
      }
      k.src(out, 0);
    },
  },
  footRug: {
    variants: 6, lowVariants: 3, dur: 0.38, gain: 0.28, reverb: 0.06, peak: 0.8,
    render(k) {
      const a = k.arr(); const t0 = 0.004;
      k.mode(a, t0, k.rr(80, 105), 1, 0.035); k.burst(a, t0, 0.5, 0.01, 0.92);
      const tt = t0 + k.rr(0.06, 0.1); k.mode(a, tt, k.rr(100, 130), 0.35, 0.025);
      k.src(k.filt(a, 'lowpass', 380), 0);
      const n = k.noise('white', 0, 0.2); const bp = k.f('bandpass', k.rr(1500, 2400), 0.7); const g = k.g(0);
      k.env(g.gain, [[0, 0], [0.01, 0.06], [0.08, 0.03], [0.18, 0]]); k.chain(n, bp, g, k.mix);
    },
  },

  // ================================================================ player
  playerHurt: {
    variants: 4, lowVariants: 2, dur: 1.1, gain: 0.85, reverb: 0.05, peak: 0.92,
    render(k) {
      k.drive(1.3);
      const a = k.arr(); const t0 = 0.003;
      k.mode(a, t0, k.rr(65, 90), 1, 0.06); k.burst(a, t0, 0.9, 0.012, 0.88); // punch
      // wet squelch: bubbles + moving bandpassed noise
      const w = k.arr();
      for (let i = 0, nn = k.ri(10, 20); i < nn; i++) k.bubble(w, t0 + Math.pow(k.r(), 1.5) * 0.25, k.rr(300, 1400), k.rr(0.1, 0.5), k.rr(0.006, 0.02), k.rr(1, 4));
      k.src(k.norm(w, 0.5), 0);
      const n = k.noise('white', 0, 0.35); const bp = k.f('bandpass', 1400, 4); const g = k.g(0);
      k.curve(bp.frequency, k.wander(60, 0.35, 0.01, 0.04, 450, 1900), 0, 0.35);
      k.env(g.gain, [[0, 0], [0.02, 0.6], [0.12, 0.25], [0.33, 0]]); k.chain(n, bp, g, k.mix);
      // sting: a sharp bright slice
      const s = k.noise('white', 0, 0.12); const hp = k.f('bandpass', k.rr(5500, 7500), 1.6); const sg = k.g(0);
      k.env(sg.gain, [[0, 0], [t0 + 0.001, 0.7], [0.1, 0.0001, 'x']]); k.chain(s, hp, sg, k.mix);
      // ear ring (subtle)
      const o = k.osc('sine', k.rr(3300, 4200), 0, 1.1); const og = k.g(0);
      k.env(og.gain, [[0, 0], [0.05, 0.035], [1.05, 0.0001, 'x']]); k.chain(o, og, k.mix);
      k.src(a, 0);
    },
  },
  heartbeat: {
    variants: 3, lowVariants: 2, dur: 0.75, sr: AMB_SR, gain: 0.4, peak: 0.9,
    render(k) {
      const beat = (t, f, amp) => {
        const o = k.osc('sine', f, t, t + 0.3); const g = k.g(0);
        k.env(o.frequency, [[t, f], [t + 0.12, f * 0.7, 'x']]);
        k.env(g.gain, [[t, 0], [t + 0.012, amp], [t + 0.2, 0.0001, 'x']]); k.chain(o, g, k.mix);
        const n = k.noise('brown', t, t + 0.2); const lp = k.f('lowpass', 170, 0.9); const ng = k.g(0);
        k.env(ng.gain, [[t, 0], [t + 0.01, amp * 0.9], [t + 0.15, 0.0001, 'x']]); k.chain(n, lp, ng, k.mix);
      };
      beat(0.01, k.rr(52, 60), 1);
      beat(k.rr(0.24, 0.3), k.rr(62, 72), k.rr(0.6, 0.75));
    },
  },
  bulletImpactWood: {
    variants: 5, lowVariants: 3, dur: 0.6, gain: 0.75, reverb: 0.25, peak: 0.9,
    render(k) {
      const a = k.arr(); const t0 = 0.002;
      k.burst(a, t0, 1, 0.0008);
      woodKnock(k, a, t0, 0.7, k.rr(250, 450));
      k.mode(a, t0, k.rr(90, 130), 0.4, 0.04);
      for (let i = 0, nn = k.ri(4, 8); i < nn; i++) k.burst(a, t0 + k.rr(0.001, 0.06), k.rr(0.1, 0.45), k.rr(0.0003, 0.001));
      for (let i = 0, nn = k.ri(3, 8); i < nn; i++) woodKnock(k, a, k.rr(0.08, 0.45), k.rr(0.02, 0.08), k.rr(1500, 3500), 0.2); // chips
      k.src(k.filt(a, 'highpass', 60), 0);
    },
  },
  bulletImpactFlesh: {
    variants: 5, lowVariants: 3, dur: 0.55, gain: 0.8, reverb: 0.05, peak: 0.9,
    render(k) {
      const a = k.arr(); const t0 = 0.002;
      // chitin cracking
      for (let i = 0, nn = k.ri(6, 14); i < nn; i++) {
        const t = t0 + Math.pow(k.r(), 1.6) * 0.04; const amp = k.rr(0.3, 1) * Math.exp(-(t - t0) / 0.03);
        k.burst(a, t, amp, k.rr(0.0002, 0.0006)); k.mode(a, t, k.rr(1500, 4000), amp * 0.4, k.rr(0.003, 0.008));
      }
      k.mode(a, t0, k.rr(110, 160), 0.8, 0.04);
      // wet splat
      const w = k.arr();
      for (let i = 0, nn = k.ri(6, 12); i < nn; i++) k.bubble(w, t0 + k.rr(0.01, 0.2), k.rr(200, 700), k.rr(0.2, 0.6), k.rr(0.008, 0.025), k.rr(1, 3));
      k.add(a, k.norm(w, 0.45));
      k.src(a, 0);
      const n = k.noise('white', 0, 0.3); const bp = k.f('bandpass', 2000, 1.5); const g = k.g(0);
      k.env(bp.frequency, [[0, 2200], [0.25, 380, 'x']]);
      k.env(g.gain, [[0, 0], [0.006, 0.8], [0.25, 0.0001, 'x']]); k.chain(n, bp, g, k.mix);
    },
  },
  // flashlight switch: a stiff plastic-and-spring click, slightly hollow (the battery tube)
  torchClick: {
    variants: 3, lowVariants: 2, dur: 0.16, gain: 0.45, reverb: 0.08, peak: 0.75,
    render(k) {
      const a = k.arr(); const t = 0.003;
      metalClick(k, a, t, 0.6, k.rr(3200, 4200), 0.5);
      k.burst(a, t + k.rr(0.004, 0.008), 0.5, 0.0012, 0.4);
      k.mode(a, t, k.rr(900, 1150), 0.25, 0.012);   // hollow tube body
      k.src(k.filt(a, 'highpass', 400), 0);
    },
  },
  uiClick: {
    variants: 3, lowVariants: 2, dur: 0.09, gain: 0.3, peak: 0.7,
    render(k) {
      const a = k.arr(); k.burst(a, 0.002, 0.6, 0.0004);
      k.mode(a, 0.002, k.rr(1800, 2400), 0.5, 0.006); k.mode(a, 0.002, k.rr(550, 700), 0.4, 0.005);
      k.src(a, 0);
    },
  },

  // ================================================================ spiders
  chitterRunner: {
    variants: 6, lowVariants: 3, dur: [0.55, 1.0], gain: 1.3, refDistance: 5, rolloff: 1.0, peak: 0.88, exterior: true, outdoor: 0.25,
    render(k) {
      const a = k.arr(); const T = k.T - 0.03;
      let t = 0.01; const curve = new Float32Array(200);
      while (t < T - 0.08) {
        const len = k.rr(0.06, 0.2); const rate = k.rr(35, 75); const f0 = k.rr(2500, 4300);
        const i0 = Math.floor((t / k.T) * 199), i1 = Math.floor(((t + len) / k.T) * 199);
        for (let i = i0; i <= i1 && i < 200; i++) curve[i] = Math.sin(Math.PI * (i - i0) / Math.max(1, i1 - i0));
        for (let c = t; c < t + len; c += (1 / rate) * k.rr(0.8, 1.2)) {
          const u = (c - t) / len; chitinClick(k, a, c, Math.sin(Math.PI * u) * k.rr(0.5, 1), f0 * k.rr(0.92, 1.08));
        }
        t += len + k.rr(0.03, 0.12);
      }
      k.src(k.filt(a, 'highpass', 700), 0);
      const n = k.noise('white'); const bp = k.f('bandpass', k.rr(4500, 6000), 3); const g = k.g(0);
      k.curve(g.gain, curve.map((v) => v * 0.12)); k.chain(n, bp, g, k.mix);
    },
  },
  skitterRunner: {
    variants: 6, lowVariants: 3, dur: [0.45, 0.85], gain: 1.1, refDistance: 5, rolloff: 1.0, peak: 0.85, exterior: true, outdoor: 0.2,
    render(k) {
      const ticks = k.arr(), rust = k.arr(); const T = k.T - 0.04;
      let t = 0.005;
      while (t < T) {
        const u = t / T; const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.6);
        const group = k.ri(2, 4); // legs land in small clusters
        for (let i = 0; i < group; i++) {
          const tt = t + i * k.rr(0.006, 0.018); const amp = env * k.rr(0.35, 1);
          k.burst(ticks, tt, amp, k.rr(0.0003, 0.001)); k.mode(ticks, tt, k.rr(220, 450), amp * 0.25, 0.004);
          k.burst(rust, tt, amp * k.rr(0.2, 0.5), k.rr(0.005, 0.015));
        }
        t += k.rr(0.045, 0.085);
      }
      k.chain(k.src(k.norm(ticks, 0.8), 0, null), k.f('bandpass', k.rr(2500, 4000), 0.6), k.g(2), k.mix);
      k.src(k.filt(k.filt(rust, 'bandpass', k.rr(1200, 2200), 0.6), 'lowpass', 5000), 0, k.mix, 1);
      k.src(k.filt(ticks, 'lowpass', 700), 0, k.mix, 0.4);
    },
  },
  clickClimber: {
    variants: 5, lowVariants: 3, dur: [0.7, 1.3], gain: 1.25, refDistance: 4.5, rolloff: 1.0, peak: 0.85, exterior: true, outdoor: 0.3,
    render(k, vi) {
      const a = k.arr(); const T = k.T - 0.08; const f0 = k.rr(650, 1150);
      const click = (t, amp) => {
        k.burst(a, t, amp, 0.0003);
        k.modes(a, t, f0 * k.rr(0.95, 1.05), [1, 1.93, 2.8], [1, 0.5, 0.3], [0.012, 0.008, 0.005], amp * 0.55);
        k.mode(a, t, k.rr(3200, 4200), amp * 0.3, 0.0015);
      };
      if (vi === 4) { // a slow ratchet that speeds up
        let t = 0.01, gap = 0.18;
        while (t < T) { click(t, k.rr(0.5, 0.9)); t += gap; gap *= 0.82; if (gap < 0.025) break; }
      } else {
        let t = 0.01;
        for (let i = 0, nn = k.ri(2, 5); i < nn && t < T; i++) {
          click(t, k.rr(0.6, 1)); if (k.chance(0.35)) click(t + k.rr(0.02, 0.04), k.rr(0.3, 0.6));
          t += k.rr(0.08, 0.28);
        }
      }
      k.src(k.filt(a, 'highpass', 200), 0);
    },
  },
  breathBrute: {
    variants: 4, lowVariants: 2, dur: [2.6, 3.6], sr: AMB_SR, gain: 0.85, refDistance: 6, rolloff: 0.6, peak: 0.9, exterior: true, outdoor: 0.3,
    render(k) {
      k.drive(1.4);
      const T = k.T; const iEnd = k.rr(0.9, 1.2), e0 = iEnd + k.rr(0.12, 0.3), e1 = T - 0.1;
      // inhale
      breathLayer(k, 0.02, iEnd, 'pink', [[k.rr(280, 380), 4, 0.9], [k.rr(700, 900), 5, 0.7], [k.rr(1600, 2000), 6, 0.35]], 1, 0.7);
      // exhale, lower and longer
      const ex = breathLayer(k, e0, e1, 'pink', [[k.rr(200, 260), 3, 1], [k.rr(480, 600), 4, 0.8], [k.rr(1100, 1400), 5, 0.4]], 1.4, 0.25);
      void ex;
      // growl: brown noise amplitude-modulated by a low rattle
      for (const [t0, t1, pk] of [[0.02, iEnd, 0.35], [e0, e1, 0.9]]) {
        const n = k.noise('brown', t0, t1); const lp = k.f('lowpass', 420, 0.8);
        const am = k.g(0.5); const lfo = k.osc('sawtooth', k.rr(26, 38), t0, t1); const lg = k.g(0.5);
        k.chain(lfo, lg, am.gain);
        const g = k.g(0); k.env(g.gain, [[t0, 0], [t0 + (t1 - t0) * 0.3, pk], [t1, 0]]);
        k.chain(n, lp, am, g, k.mix);
      }
      // wet gurgle in the exhale
      const w = k.arr();
      for (let i = 0, nn = k.ri(18, 36); i < nn; i++) {
        const t = e0 + Math.pow(k.r(), 0.8) * (e1 - e0) * 0.85; k.bubble(w, t, k.rr(80, 320), k.rr(0.2, 1), k.rr(0.01, 0.04), k.rr(0.5, 2));
      }
      k.src(k.norm(w, 0.5), 0);
      // sub weight
      const s = k.noise('brown', 0, T); const sl = k.f('lowpass', 90, 0.9); const sg = k.g(0);
      k.env(sg.gain, [[0, 0], [iEnd * 0.7, 0.5], [e0, 0.2], [e0 + 0.4, 1], [e1, 0]]); k.chain(s, sl, sg, k.mix);
      // wet mouth click at the start
      const c = k.arr(); k.mode(c, 0.01, k.rr(350, 500), 0.3, 0.01); k.burst(c, 0.01, 0.2, 0.002, 0.5); k.src(c, 0);
    },
  },
  stepBrute: {
    variants: 5, lowVariants: 3, dur: 0.95, sr: AMB_SR, gain: 0.95, refDistance: 5, rolloff: 0.6, peak: 0.95, exterior: true, outdoor: 0.3,
    render(k) {
      k.drive(1.3);
      const t0 = 0.012;
      const o = k.osc('sine', 50, 0, 0.9); const og = k.g(0);
      k.env(o.frequency, [[0, k.rr(48, 58)], [t0 + 0.12, 32, 'x']]);
      k.env(og.gain, [[0, 0], [t0, 0], [t0 + 0.006, 1], [0.25, 0.3, 'x'], [0.85, 0.0001, 'x']]); k.chain(o, og, k.mix);
      const a = k.arr();
      k.burst(a, 0.004, 0.3, 0.0006); // claw tip lands first
      k.mode(a, t0, k.rr(90, 120), 0.7, 0.08); k.burst(a, t0, 0.9, 0.03, 0.95);
      for (let i = 0, nn = k.ri(5, 12); i < nn; i++) k.burst(a, t0 + k.rr(0, 0.09), k.rr(0.05, 0.18), k.rr(0.0005, 0.002)); // twigs
      k.src(a, 0);
      const n = k.noise('pink', 0, 0.3); const bp = k.f('bandpass', k.rr(900, 1500), 0.7); const g = k.g(0);
      k.env(g.gain, [[0, 0], [t0 + 0.005, 0.25], [0.25, 0.0001, 'x']]); k.chain(n, bp, g, k.mix);
    },
  },
  breathStalker: {
    variants: 4, lowVariants: 2, dur: [2.2, 3.4], gain: 1.0, refDistance: 1.5, rolloff: 1.5, peak: 0.8, exterior: true, outdoor: 0.1,
    render(k) {
      const T = k.T; const iEnd = k.rr(1.0, 1.4), e0 = iEnd + k.rr(0.2, 0.5), e1 = T - 0.1;
      // thin, wheezy inhale through a narrow opening
      breathLayer(k, 0.05, iEnd, 'white', [[k.rr(3000, 4500), 3, 0.8], [k.rr(1100, 1400), 5, 0.4]], 0.6, 0.8);
      const w = k.noise('white', 0.05, iEnd); const wb = k.f('bandpass', 2000, 35); const wg = k.g(0);
      const wf = k.rr(1800, 2600); k.env(wb.frequency, [[0.05, wf * 0.9], [iEnd, wf * 1.1, 'x']]);
      k.env(wg.gain, [[0.05, 0], [iEnd * 0.8, 1.8], [iEnd, 0]]); k.chain(w, wb, wg, k.mix);
      // exhale with a faint rattle
      const n = k.noise('pink', e0, e1); const bp = k.f('bandpass', k.rr(700, 900), 2);
      const am = k.g(0.6); const lfo = k.osc('triangle', k.rr(16, 26), e0, e1); const lg = k.g(0.4); k.chain(lfo, lg, am.gain);
      const g = k.g(0); k.env(g.gain, [[e0, 0], [e0 + 0.3, 0.7], [e1, 0]]);
      k.chain(n, bp, am, g, k.mix);
      // wet mouth clicks
      const c = k.arr();
      for (let i = 0, nn = k.ri(2, 4); i < nn; i++) { const t = k.rr(0.05, T - 0.2); k.mode(c, t, k.rr(1400, 2600), 0.25, 0.003); k.burst(c, t, 0.15, 0.001, 0.4); }
      k.src(c, 0);
    },
  },
  stepSpider: {
    variants: 8, lowVariants: 4, dur: 0.2, gain: 0.4, refDistance: 2, rolloff: 1.2, peak: 0.85, exterior: true, outdoor: 0.15,
    render(k) {
      const a = k.arr(); const t0 = 0.003;
      k.burst(a, t0, 1, k.rr(0.0003, 0.0008)); k.mode(a, t0, k.rr(250, 450), 0.3, 0.006);
      for (let i = 0, nn = k.ri(1, 4); i < nn; i++) k.burst(a, t0 + k.rr(0.003, 0.03), k.rr(0.2, 0.5), k.rr(0.001, 0.003), 0.3); // leaf crunch
      k.src(k.filt(a, 'highpass', 150), 0);
      const n = k.noise('white', 0, 0.12); const bp = k.f('bandpass', k.rr(1500, 3000), 0.8); const g = k.g(0);
      k.env(g.gain, [[0, 0], [t0 + 0.004, 0.25], [k.rr(0.04, 0.08), 0.0001, 'x']]); k.chain(n, bp, g, k.mix);
    },
  },
  roofStep: {
    variants: 6, lowVariants: 3, dur: 0.55, sr: AMB_SR, gain: 0.4, refDistance: 3, rolloff: 1.0, peak: 0.88, exterior: true, outdoor: 0,
    render(k) {
      const a = k.arr(); const t0 = 0.004;
      k.mode(a, t0, k.rr(110, 170), 1, 0.05); k.mode(a, t0, k.rr(260, 360), 0.6, 0.03); k.mode(a, t0, k.rr(600, 800), 0.25, 0.015);
      k.burst(a, t0, 0.4, 0.001, 0.6); k.burst(a, t0, 0.1, 0.015, 0.5);
      if (k.chance(0.4)) { // a little scrape as the leg slides
        const n = k.noise('pink', 0.03, 0.35); const bp = k.f('bandpass', k.rr(500, 900), 2); const g = k.g(0);
        k.env(g.gain, [[0.03, 0], [0.1, 0.12], [0.3, 0]]); k.chain(n, bp, g, k.mix);
      }
      k.src(k.filt(a, 'lowpass', 2200), 0);
    },
  },
  spiderHiss: {
    variants: 4, lowVariants: 2, dur: [0.8, 1.4], gain: 0.62, refDistance: 3, rolloff: 1.0, peak: 0.88, exterior: true, outdoor: 0.25,
    render(k) {
      k.drive(1.2);
      const T = k.T - 0.05;
      const n = k.noise('white', 0, T); const hp = k.f('highpass', 2500, 0.7); const bp = k.f('bandpass', k.rr(4500, 6500), 0.8); const g = k.g(0);
      k.env(g.gain, [[0, 0], [0.04, 1], [T * 0.5, 0.7], [T, 0]]); k.chain(n, hp, bp, g, k.mix);
      const st = creak(k, 0.02, T * 0.85, (u) => k.rr(90, 160) * (1 + 0.3 * u), (u) => bell(u, 0.1, 0.3),
        [[k.rr(1800, 2500), 6, 1], [k.rr(3800, 4500), 5, 0.6]], 0.2);
      k.src(k.norm(st, 0.6), 0);
      const r = k.noise('brown', 0, T); const rb = k.f('bandpass', k.rr(300, 500), 1);
      const am = k.g(0.5); const lfo = k.osc('sawtooth', k.rr(35, 50), 0, T); const lg = k.g(0.5); k.chain(lfo, lg, am.gain);
      const rg = k.g(0); k.env(rg.gain, [[0, 0], [0.05, 0.5], [T, 0]]); k.chain(r, rb, am, rg, k.mix);
      const s = k.arr(); k.burst(s, 0.005, 0.5, 0.004); k.src(k.filt(s, 'highpass', 2000), 0); // the spit
    },
  },
  spiderScream: {
    variants: 4, lowVariants: 2, dur: [1.1, 1.7], gain: 0.8, refDistance: 4, rolloff: 1.0, peak: 0.95, exterior: true, outdoor: 0.35,
    render(k) {
      k.drive(1.4);
      const T = k.T - 0.25;
      screech(k, T, 1);
      // dying rattle: clicks slowing, then wet bubbles
      const a = k.arr(); let t = T * 0.75, gap = 0.03;
      while (t < k.T - 0.03) { chitinClick(k, a, t, k.rr(0.3, 0.7), k.rr(2000, 3500)); t += gap; gap *= 1.25; }
      for (let i = 0; i < 8; i++) k.bubble(a, T * k.rr(0.7, 1.05), k.rr(150, 400), k.rr(0.1, 0.3), 0.02, 1.5);
      k.src(k.norm(a, 0.4), 0);
    },
  },
  spiderPain: {
    variants: 4, lowVariants: 2, dur: [0.35, 0.55], gain: 0.7, refDistance: 4, rolloff: 1.0, peak: 0.92, exterior: true, outdoor: 0.3,
    render(k) { k.drive(1.3); screech(k, k.T - 0.02, 1); },
  },
  spiderAttack: {
    variants: 4, lowVariants: 2, dur: 0.8, gain: 0.95, refDistance: 3, rolloff: 1.0, peak: 0.92, exterior: true, outdoor: 0.2,
    render(k) {
      k.drive(1.4);
      const n = k.noise('pink', 0, 0.4); const bp = k.f('bandpass', 400, 1.2); const g = k.g(0);
      k.env(bp.frequency, [[0, 350], [0.22, 1800, 'x'], [0.38, 600, 'x']]); k.env(g.gain, [[0, 0], [0.2, 0.7], [0.38, 0]]); k.chain(n, bp, g, k.mix);
      const h = k.noise('white', 0.05, 0.45); const hp = k.f('highpass', 3000, 0.7); const hg = k.g(0);
      k.env(hg.gain, [[0.05, 0], [0.18, 0.4], [0.42, 0]]); k.chain(h, hp, hg, k.mix);
      const a = k.arr(); const ts = k.rr(0.24, 0.3);
      for (let i = 0, nn = k.ri(2, 3); i < nn; i++) { const t = ts + i * k.rr(0.03, 0.06); k.burst(a, t, 1, 0.0004); k.modes(a, t, k.rr(1500, 2500), [1, 1.6, 2.4], [1, 0.6, 0.3], [0.006, 0.004, 0.003], 0.6); }
      for (let i = 0, nn = k.ri(6, 10); i < nn; i++) k.bubble(a, ts + k.rr(0.02, 0.18), k.rr(250, 800), k.rr(0.2, 0.5), k.rr(0.008, 0.02), 2);
      for (let t = ts + 0.2; t < 0.75; t += k.rr(0.015, 0.03)) chitinClick(k, a, t, k.rr(0.1, 0.3) * (1 - (t - ts) / 0.6), k.rr(2500, 4000));
      k.src(a, 0);
    },
  },

  // ================================================================ ambience loops
  wind: {
    variants: 2, lowVariants: 1, dur: 26, loop: true, xf: 3, stereo: true, sr: AMB_SR, gain: 0.42, bus: 'ambience', exterior: true, peak: 0.85,
    render(k) {
      const T = k.T; const P = 1200;
      const gust = k.wander(P, T, 1.2, 3.8, 0.15, 1, 1.3);
      const pow = (p, s = 1) => gust.map((v) => s * Math.pow(v, p));
      for (const [ch, side] of [[k.L, 0], [k.R, 1]]) {
        // low roar
        const b = k.noise('brown'); const lp = k.f('lowpass', 380, 0.5); const bg = k.g(0);
        k.curve(bg.gain, gust.map((v) => 0.15 + 0.85 * v)); k.chain(b, lp, bg, ch);
        // body
        const p = k.noise('pink'); const bp = k.f('bandpass', 500, 0.6); const pg = k.g(0);
        k.curve(bp.frequency, gust.map((v) => 280 + 520 * v)); k.curve(pg.gain, pow(1.5, 0.5)); k.chain(p, bp, pg, ch);
        // leaves in the trees: bright, fluttering, mostly in gusts
        const fl = k.wander(P, T, 0.05, 0.18, 0.4, 1);
        const l = k.noise('white'); const lh = k.f('highpass', 1800, 0.6); const lb = k.f('bandpass', 3800 + side * 400, 0.45); const lg = k.g(0);
        k.curve(lg.gain, gust.map((v, i) => 0.3 * Math.pow(v, 2.2) * fl[i] + 0.015)); k.chain(l, lh, lb, lg, ch);
      }
      // whistling through the gaps of the cabin (centre)
      for (const base of [k.rr(380, 520), k.rr(700, 950)]) {
        const p = k.noise('pink'); const bp = k.f('bandpass', base, 22); const g = k.g(0);
        k.curve(bp.frequency, gust.map((v) => base * (0.85 + 0.3 * v)));
        k.curve(g.gain, gust.map((v) => 4 * Math.pow(Math.max(0, v - 0.5), 1.3)));
        k.chain(p, bp, g, k.mix);
      }
    },
  },
  rain: {
    variants: 2, lowVariants: 1, dur: 16, loop: true, xf: 2, stereo: true, sr: AMB_SR, gain: 0.36, bus: 'ambience', exterior: true, peak: 0.85,
    render(k) {
      for (const ch of [k.L, k.R]) {
        const h = k.noise('pink'); const hp = k.f('highpass', 900, 0.6); const lp = k.f('lowpass', 9000, 0.6); const hg = k.g(0.32);
        k.chain(h, hp, lp, hg, ch);
        const w = k.noise('pink'); const wb = k.f('bandpass', 2500, 0.5); const wg = k.g(0.2); k.chain(w, wb, wg, ch);
        // drops drumming on the roof shingles
        const d = k.arr();
        for (let t = 0; t < k.T; t += -Math.log(1 - k.r() * 0.999) / 380) {
          const amp = 0.04 + 0.7 * Math.pow(k.r(), 3);
          k.burst(d, t, amp, k.rr(0.0003, 0.0025), 0.3);
          if (k.chance(0.3)) k.mode(d, t, k.rr(180, 450), amp * 0.35, 0.006);
        }
        k.src(k.norm(k.filt(d, 'lowpass', 3500), 0.9), 0, ch, 0.55);
        // drips off the eaves
        const e = k.arr();
        for (let t = k.rr(0, 0.5); t < k.T; t += k.rr(0.2, 0.9)) { k.bubble(e, t, k.rr(900, 2200), k.rr(0.1, 0.3), k.rr(0.012, 0.03), 3); k.burst(e, t, 0.08, 0.002); }
        k.src(k.norm(k.filt(e, 'bandpass', 1500, 0.7), 0.4), 0, ch, 1);
        const r = k.noise('brown'); const rl = k.f('lowpass', 150, 0.7); const rg = k.g(0.25); k.chain(r, rl, rg, ch);
      }
    },
  },
  roomTone: {
    variants: 1, lowVariants: 1, dur: 12, loop: true, xf: 2, stereo: true, sr: AMB_SR, gain: 0.14, bus: 'ambience', peak: 0.8,
    render(k) {
      for (const ch of [k.L, k.R]) {
        const b = k.noise('brown'); const lp = k.f('lowpass', 120, 0.6); const g = k.g(0.6); k.chain(b, lp, g, ch);
        const p = k.noise('pink'); const bp = k.f('bandpass', 400, 0.5); const pg = k.g(0.07); k.chain(p, bp, pg, ch);
        const w = k.noise('white'); const hp = k.f('highpass', 4000, 0.6); const wg = k.g(0.015); k.chain(w, hp, wg, ch);
      }
    },
  },
  drone: {
    variants: 1, lowVariants: 1, dur: 20, loop: true, xf: 2, sr: AMB_SR, gain: 0.55, bus: 'ambience', peak: 0.85,
    render(k) {
      const L = 20; const q = (f) => Math.round(f * L) / L; // whole cycles per loop
      const f1 = q(k.rr(34, 40));
      for (const [f, g, type] of [[f1, 0.9, 'sine'], [q(f1 * 1.5 + 0.15), 0.35, 'sine'], [q(f1 * 2 - 0.1), 0.3, 'sine'], [f1, 0.5, 'sawtooth']]) {
        const o = k.osc(type, f); const og = k.g(g);
        if (type === 'sawtooth') { const lp = k.f('lowpass', 170, 0.7); k.chain(o, lp, og, k.mix); } else k.chain(o, og, k.mix);
      }
      // slow breathing swell (periodic over the loop)
      const n = k.noise('brown'); const bp = k.f('bandpass', 75, 2); const am = k.g(0);
      const lfo = k.osc('sine', q(0.1)); const lg = k.g(0.25); k.chain(lfo, lg, am.gain); am.gain.value = 0.35;
      k.chain(n, bp, am, k.mix);
      // faint high unease: a thin band of noise
      const h = k.noise('pink'); const hb = k.f('bandpass', k.rr(2200, 2800), 9); const hg = k.g(0.12); k.chain(h, hb, hg, k.mix);
    },
  },
  windGust: {
    variants: 3, lowVariants: 2, dur: [3, 5], stereo: true, sr: AMB_SR, gain: 0.7, bus: 'ambience', exterior: true, peak: 0.9,
    render(k) {
      const T = k.T;
      const shape = (pk) => [[0, 0], [T * k.rr(0.3, 0.5), pk], [T, 0]];
      for (const ch of [k.L, k.R]) {
        const b = k.noise('brown'); const lp = k.f('lowpass', 500, 0.5); const g = k.g(0); k.env(g.gain, shape(1)); k.chain(b, lp, g, ch);
        const l = k.noise('white'); const hp = k.f('highpass', 2000, 0.6); const lg = k.g(0); k.env(lg.gain, shape(0.25)); k.chain(l, hp, lg, ch);
      }
      const p = k.noise('pink'); const bp = k.f('bandpass', 450, 16); const pg = k.g(0);
      k.env(bp.frequency, [[0, 400], [T * 0.45, k.rr(650, 800)], [T, 480]]); k.env(pg.gain, shape(3)); k.chain(p, bp, pg, k.mix);
    },
  },

  // ================================================================ ambience one-shots
  thunder: {
    variants: 5, lowVariants: 3, dur: [6.5, 9], stereo: true, sr: AMB_SR, gain: 0.9, bus: 'ambience', exterior: true, peak: 0.95,
    // variant index = closeness: 0 is far away, the last one is close
    render(k, vi, n) {
      const c = n > 1 ? vi / (n - 1) : 0.5; const T = k.T;
      const onset = 0.05 + (1 - c) * k.rr(0.2, 0.6);
      const bumps = []; let tb = onset;
      for (let i = 0, nn = k.ri(3, 6); i < nn; i++) { bumps.push([tb, k.rr(0.4, 1) * Math.exp(-i * 0.35), k.rr(0.3, 1.2)]); tb += k.rr(0.4, 1.6); }
      bumps[0][1] = 1;
      const P = 600;
      const bumpCurve = (shift) => {
        const o = new Float32Array(P);
        for (let i = 0; i < P; i++) {
          const t = (i / (P - 1)) * T; let v = 0;
          for (const [t0, a, w] of bumps) { const tt = t - t0 - shift; v += tt < 0 ? a * Math.exp(-(tt * tt) / 0.02) : a * Math.exp(-tt / w); }
          o[i] = v * Math.min(1, Math.max(0, (T - t) / 1.5));
        }
        return o;
      };
      if (c > 0.35) { // the crack of a closer strike
        const a = k.arr(); let t = onset - 0.03;
        for (let i = 0, nn = k.ri(10, 25); i < nn; i++) { k.burst(a, t, k.rr(0.3, 1) * c, k.rr(0.001, 0.006), 0.5); t += k.rr(0.005, 0.03); }
        k.src(k.norm(k.filt(a, 'lowpass', 800 + 3500 * c), 0.6 * c), 0, k.mix);
      }
      for (const [ch, shift] of [[k.L, 0], [k.R, k.rr(0.03, 0.15)]]) {
        const bc = bumpCurve(shift);
        const b = k.noise('brown'); const lp = k.f('lowpass', 300, 0.7); const g = k.g(0);
        k.env(lp.frequency, [[0, 180 + 400 * c], [T, 80, 'x']]); k.curve(g.gain, bc); k.chain(b, lp, g, ch);
        const p = k.noise('pink'); const bp = k.f('bandpass', 130, 0.7); const pg = k.g(0); k.curve(pg.gain, bc.map((v) => v * 0.4 * (0.5 + c))); k.chain(p, bp, pg, ch);
      }
    },
  },
  treeCreak: {
    variants: 5, lowVariants: 3, dur: [1.4, 2.8], gain: 0.6, bus: 'ambience', exterior: true, outdoor: 0.45, refDistance: 8, rolloff: 0.8, peak: 0.85,
    render(k) {
      const T = k.T - 0.1; const r0 = k.rr(8, 15), r1 = k.rr(25, 60);
      const cr = creak(k, 0.05, T, (u) => r0 + (r1 - r0) * Math.sin(Math.PI * u), (u) => bell(u, 0.3, 0.35),
        [[k.rr(250, 350), 10, 1], [k.rr(550, 750), 12, 0.8], [k.rr(1100, 1500), 10, 0.5], [k.rr(1900, 2400), 8, 0.25]], 0.25);
      k.src(k.filt(k.norm(cr, 0.9), 'lowpass', 3000), 0);
    },
  },
  branchSnap: {
    variants: 5, lowVariants: 3, dur: 0.95, gain: 0.7, bus: 'ambience', exterior: true, outdoor: 0.4, refDistance: 6, rolloff: 0.8, peak: 0.9,
    render(k) {
      const a = k.arr(); const t0 = k.rr(0.02, 0.04);
      for (let i = 0, nn = k.ri(1, 3); i < nn; i++) k.burst(a, t0 - k.rr(0.003, 0.02), k.rr(0.1, 0.3), 0.0005); // fibres giving
      k.burst(a, t0, 1, 0.0018); k.modes(a, t0, k.rr(600, 1100), WOOD.r, WOOD.a, WOOD.t, 0.5, 0.3);
      for (let i = 0, nn = k.ri(2, 5); i < nn; i++) { const t = t0 + k.rr(0.01, 0.12); k.burst(a, t, k.rr(0.2, 0.6), k.rr(0.0005, 0.0015)); }
      const tl = t0 + k.rr(0.35, 0.6); woodKnock(k, a, tl, 0.15, k.rr(200, 400)); // lands
      k.src(a, 0);
      const n = k.noise('white', t0, tl + 0.1); const bp = k.f('bandpass', k.rr(1500, 2200), 0.8); const g = k.g(0);
      k.env(g.gain, [[t0, 0], [t0 + 0.05, 0.12], [tl + 0.08, 0]]); k.chain(n, bp, g, k.mix);
    },
  },
  cabinCreak: {
    variants: 5, lowVariants: 3, dur: [1.8, 3.4], sr: AMB_SR, gain: 0.55, bus: 'ambience', reverb: 0.1, refDistance: 4, rolloff: 1, peak: 0.85,
    render(k, vi) {
      const T = k.T - 0.15;
      const res = [[k.rr(120, 180), 8, 1], [k.rr(300, 420), 10, 0.9], [k.rr(650, 850), 10, 0.55], [k.rr(1300, 1600), 8, 0.25]];
      let cr;
      if (vi % 2 === 0) { // slow ticking strain
        const r0 = k.rr(5, 12), r1 = k.rr(18, 32);
        cr = creak(k, 0.05, T, (u) => r0 + (r1 - r0) * Math.sin(Math.PI * u), (u) => bell(u, 0.3, 0.3), res, 0.3);
      } else { // pitched groan
        const p0 = k.rr(45, 65), p1 = k.rr(85, 120);
        cr = creak(k, 0.05, T, (u) => p0 + (p1 - p0) * Math.sin(Math.PI * Math.min(1, u * 1.3)), (u) => bell(u, 0.2, 0.4), res, 0.08);
      }
      const a = k.norm(cr, 0.8);
      if (k.chance(0.6)) woodKnock(k, a, T + 0.02, 0.25, k.rr(250, 380)); // settles with a tick
      k.src(a, 0);
    },
  },
  lanternCreak: {
    variants: 4, lowVariants: 2, dur: [0.45, 0.95], gain: 0.32, bus: 'ambience', reverb: 0.1, refDistance: 1.5, rolloff: 1.2, peak: 0.8,
    render(k) {
      const T = k.T - 0.05; const squeaks = k.ri(1, 2); const res = [[k.rr(1800, 2400), 30, 1], [k.rr(3600, 4300), 25, 0.6], [k.rr(5200, 6000), 20, 0.3]];
      const a = k.arr();
      for (let s = 0; s < squeaks; s++) {
        const t0 = 0.01 + (s * T) / squeaks, t1 = t0 + (T / squeaks) * k.rr(0.6, 0.9);
        const r0 = k.rr(280, 400), r1 = k.rr(500, 750);
        k.add(a, creak(k, t0, t1, (u) => r0 + (r1 - r0) * Math.sin(Math.PI * u), (u) => bell(u, 0.3, 0.4) * (s ? 0.6 : 1), res, 0.05));
      }
      k.norm(a, 0.7);
      if (k.chance(0.6)) metalClick(k, a, k.rr(0.02, T), 0.15, k.rr(3000, 4500));
      k.src(a, 0);
    },
  },
  distantUnknown: {
    variants: 5, lowVariants: 3, dur: [3.5, 5], sr: AMB_SR, gain: 0.7, bus: 'ambience', exterior: true, outdoor: 0.08, refDistance: 10, rolloff: 0.6, peak: 0.85,
    // 0 knock, 1 dragging, 2 low call, 3 insect chirr, 4 metal clank
    render(k, vi) {
      const T = k.T - 2.2; // leave room for the baked forest echo
      const dry = k.g(0.55), wet = k.g(1.0); const air = k.f('lowpass', 2300, 0.6);
      const cv = k.conv(k.sr === SR ? k.irs.forest : k.irs.forestAmb);
      dry.connect(air); k.chain(wet, cv, air); air.connect(k.mix);
      const sendAll = k.g(1); sendAll.connect(dry); sendAll.connect(wet);
      const kind = vi % 5; const a = k.arr();
      if (kind === 0) {
        let t = 0.05; const f = k.rr(140, 220);
        for (let i = 0, nn = k.ri(2, 4); i < nn; i++) { woodKnock(k, a, t, k.rr(0.7, 1), f * k.rr(0.97, 1.03), 1.5); k.mode(a, t, f * 0.5, 0.4, 0.04); t += k.rr(0.3, 0.65); }
      } else if (kind === 1) {
        let t = 0.05;
        for (let i = 0, nn = k.ri(2, 3); i < nn && t < T; i++) {
          const len = k.rr(0.6, 1.1);
          const n = k.noise('pink', t, t + len); const bp = k.f('bandpass', k.rr(300, 600), 1); const g = k.g(0);
          k.env(g.gain, [[t, 0], [t + len * 0.2, 1], [t + len, 0]]); k.chain(n, bp, g, sendAll);
          for (let j = 0; j < 20; j++) k.burst(a, t + k.r() * len, k.rr(0.05, 0.25), 0.002, 0.5);
          t += len + k.rr(0.3, 0.7);
        }
      } else if (kind === 2) {
        const f0 = k.rr(95, 135); const len = Math.min(T, k.rr(1.5, 2.2));
        const s = k.osc('sawtooth', f0, 0.05, 0.05 + len); const v = k.osc('sine', k.rr(4, 6), 0.05, 0.05 + len); const vg = k.g(f0 * 0.03);
        k.chain(v, vg, s.frequency); k.env(s.frequency, [[0.05, f0], [0.05 + len * 0.3, f0 * 1.08], [0.05 + len, f0 * 0.68, 'x']]);
        const sub = k.osc('sawtooth', f0 / 2, 0.05, 0.05 + len); k.env(sub.frequency, [[0.05, f0 / 2], [0.05 + len, f0 * 0.34, 'x']]);
        const g = k.g(0); k.env(g.gain, [[0.05, 0], [0.05 + len * 0.25, 1], [0.05 + len * 0.7, 0.8], [0.05 + len, 0]]);
        s.connect(g); const sg = k.g(0.35); sub.connect(sg); sg.connect(g);
        k.bank(g, [[k.rr(400, 600), 5, 1], [k.rr(900, 1200), 6, 0.6], [2400, 8, 0.2]], sendAll);
        const br = k.noise('pink', 0.05, 0.05 + len); const bb = k.f('bandpass', 700, 1); const bg = k.g(0);
        k.env(bg.gain, [[0.05, 0], [0.4, 0.15], [0.05 + len, 0]]); k.chain(br, bb, bg, sendAll);
      } else if (kind === 3) {
        let t = 0.05; const f0 = k.rr(1800, 2500);
        for (let b = 0, nb = k.ri(3, 5); b < nb && t < T; b++) {
          const len = k.rr(0.2, 0.4) * (1 - b * 0.12); const rate = k.rr(45, 70) * (1 + b * 0.1);
          for (let c = t; c < t + len; c += 1 / rate) chitinClick(k, a, c, Math.sin(Math.PI * (c - t) / len), f0 * k.rr(0.95, 1.05));
          t += len + k.rr(0.12, 0.3) * (1 - b * 0.15);
        }
      } else {
        let t = 0.05; const f = k.rr(400, 700);
        for (let i = 0, nn = k.ri(2, 3); i < nn; i++) {
          k.modes(a, t, f * k.rr(0.97, 1.03), [1, 2.76, 5.4, 8.9], [1, 0.6, 0.35, 0.2], [0.6, 0.4, 0.25, 0.15], k.rr(0.5, 1));
          k.burst(a, t, 0.5, 0.001);
          for (let j = 0; j < 5; j++) metalClick(k, a, t + k.rr(0.02, 0.25), k.rr(0.05, 0.15), k.rr(2500, 4000)); // chain rattle
          t += k.rr(0.5, 1.0);
        }
      }
      k.src(k.norm(a, 0.9), 0, sendAll);
    },
  },
};

export const REQUIRED_NAMES = [
  'gunshot', 'dryFire', 'magOut', 'magIn', 'roundLoad', 'boltRack', 'ammoPickup', 'glassCrack', 'glassShatter', 'glassTap',
  'glassScratch', 'woodScrape', 'boardHit', 'boardBreak', 'footWood', 'footRug', 'playerHurt', 'heartbeat', 'bulletImpactWood',
  'bulletImpactFlesh', 'uiClick', 'torchClick',
  'leverCycle', 'caseTink', 'roundInsert', 'axeSwing', 'axeChop', 'stomp', 'stompSquish', 'spiderKill',
  'chitterRunner', 'skitterRunner', 'clickClimber', 'breathBrute', 'stepBrute', 'breathStalker', 'stepSpider', 'roofStep',
  'spiderHiss', 'spiderScream', 'spiderAttack',
  'wind', 'rain', 'roomTone', 'thunder', 'treeCreak', 'branchSnap', 'cabinCreak', 'lanternCreak', 'distantUnknown', 'drone',
];

export const CATEGORIES = {
  Weapon: ['gunshot', 'leverCycle', 'caseTink', 'roundInsert', 'dryFire', 'ammoPickup', 'torchClick', 'magOut', 'magIn', 'roundLoad', 'boltRack'],
  Melee: ['axeSwing', 'axeChop', 'stomp', 'stompSquish', 'spiderKill'],
  'Glass & wood': ['glassTap', 'glassScratch', 'glassCrack', 'glassShatter', 'woodScrape', 'boardHit', 'boardBreak', 'bulletImpactWood'],
  Player: ['footWood', 'footRug', 'playerHurt', 'heartbeat', 'bulletImpactFlesh', 'uiClick'],
  Spiders: ['chitterRunner', 'skitterRunner', 'clickClimber', 'breathBrute', 'stepBrute', 'breathStalker', 'stepSpider', 'roofStep', 'spiderHiss', 'spiderPain', 'spiderScream', 'spiderAttack'],
  'Ambience one-shots': ['thunder', 'treeCreak', 'branchSnap', 'cabinCreak', 'lanternCreak', 'distantUnknown', 'windGust'],
  'Ambience loops': ['wind', 'rain', 'roomTone', 'drone'],
};

// ---------------------------------------------------------------- rendering

const yieldToMain = () => new Promise((resolve) => {
  if (typeof MessageChannel !== 'undefined') { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(0); }
  else setTimeout(resolve, 0);
});

function seamless(buf, loopLen, xfLen, sr) {
  const out = makeBuffer(buf.numberOfChannels, loopLen, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < loopLen; i++) dst[i] = src[i];
    for (let i = 0; i < xfLen; i++) { const u = i / xfLen; dst[i] = src[i] * Math.sqrt(u) + src[loopLen + i] * Math.sqrt(1 - u); }
  }
  return out;
}

function finish(buf, recipe, sr) {
  const ch = buf.numberOfChannels; let peak = 0;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) d[i] = 0; else if (Math.abs(v) > peak) peak = Math.abs(v); }
  }
  if (peak <= 0) return buf;
  const s = (recipe.peak ?? 0.9) / peak;
  let last = 0;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { d[i] *= s; if (Math.abs(d[i]) > 0.0006) last = Math.max(last, i); }
  }
  if (recipe.loop) return buf;
  // trim trailing silence and fade the last few ms so nothing clicks
  const fade = Math.floor(sr * 0.006);
  const len = Math.min(buf.length, last + fade + 1);
  const out = len < buf.length - sr * 0.02 ? makeBuffer(ch, len, sr) : buf;
  for (let c = 0; c < ch; c++) {
    const d = out.getChannelData(c);
    if (out !== buf) d.set(buf.getChannelData(c).subarray(0, len));
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return out;
}

async function renderVariant(name, recipe, vi, n, irs, lowTier) {
  const sr = lowTier ? Math.min(recipe.sr || SR, AMB_SR) : (recipe.sr || SR);
  const rnd = mulberry32(hashName(name) + vi * 7919);
  let dur = recipe.dur;
  if (typeof dur === 'function') dur = dur(vi);
  else if (Array.isArray(dur)) dur = dur[0] + (dur[1] - dur[0]) * rnd();
  const xf = recipe.loop ? recipe.xf || 2 : 0;
  const loopLen = Math.round(dur * sr), xfLen = Math.round(xf * sr);
  const channels = recipe.stereo ? 2 : 1;
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Off(channels, loopLen + xfLen, sr);
  const k = new Kit(ctx, rnd, irs, recipe.stereo);
  recipe.render(k, vi, n);
  let buf = await ctx.startRendering();
  if (recipe.loop) buf = seamless(buf, loopLen, xfLen, sr);
  return finish(buf, recipe, sr);
}

// Builds every recipe. Returns { sounds: Map(name -> entry), irs, ms }.
export async function buildBank({ lowTier = false, onProgress = null, only = null } = {}) {
  const t0 = performance.now();
  const irs = { room: await renderIR('room'), forest: await renderIR('forest'), forestAmb: await renderIR('forest', AMB_SR) };
  const sounds = new Map();
  const jobs = [];
  for (const [name, r] of Object.entries(RECIPES)) {
    if (only && !only.includes(name)) continue;
    const n = Math.max(1, lowTier ? (r.lowVariants || Math.min(3, r.variants)) : r.variants);
    sounds.set(name, {
      name, buffers: new Array(n), last: -1, loop: !!r.loop,
      gain: r.gain ?? 1, bus: r.bus || 'sfx', exterior: !!r.exterior, reverb: r.reverb || 0, outdoor: r.outdoor ?? 0,
      refDistance: r.refDistance ?? 2, rolloff: r.rolloff ?? 1,
    });
    for (let vi = 0; vi < n; vi++) jobs.push([name, r, vi, n]);
  }
  let done = 0; const batch = lowTier ? 2 : 4;
  for (let i = 0; i < jobs.length; i += batch) {
    await Promise.all(jobs.slice(i, i + batch).map(async ([name, r, vi, n]) => {
      sounds.get(name).buffers[vi] = await renderVariant(name, r, vi, n, irs, lowTier);
      done++;
    }));
    if (onProgress) onProgress(done / jobs.length);
    await yieldToMain();
  }
  return { sounds, irs, ms: performance.now() - t0 };
}
