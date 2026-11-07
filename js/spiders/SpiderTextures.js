// Procedural canvas textures for the spiders: one tileable set (albedo, normal, roughness)
// shared by every spider type, plus a soft radial glow for the eyes.
// Built once per detail level and cached. Everything is seeded, so it looks the same every run.
import * as THREE from 'three';

const cache = new Map();
let glowTex = null;

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

// Tileable value noise on a lattice of `period` cells.
function makeValueNoise(seed, period, periodY = period) {
  const r = rng(seed);
  const grid = new Float32Array(period * periodY);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const g = (x, y) => grid[((y % periodY + periodY) % periodY) * period + ((x % period + period) % period)];
  return (u, v) => { // u, v in [0,1)
    const x = u * period, y = v * periodY;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// Tileable cellular noise: returns [F1, F2] distances (in cell units).
function makeCells(seed, n) {
  const r = rng(seed);
  const pts = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { pts[i * 2] = r(); pts[i * 2 + 1] = r(); }
  return (u, v) => {
    const x = u * n, y = v * n;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
      const k = (wy * n + wx) * 2;
      const dx = cx + pts[k] - x, dy = cy + pts[k + 1] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return [f1, f2];
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Shared chitin texture set: { map, normalMap, roughnessMap }. detail 0 → 256 px, 1 → 512 px. */
export function getChitinTextures(detail = 1) {
  const key = detail ? 1 : 0;
  if (cache.has(key)) return cache.get(key);
  const N = key ? 512 : 256;
  const n1 = makeValueNoise(11, 8), n2 = makeValueNoise(23, 16), n3 = makeValueNoise(37, 32), n4 = makeValueNoise(41, 64);
  const fib = makeValueNoise(53, 64, 5);        // fibrous streaks along v (leg length)
  const blot = makeValueNoise(67, 4);           // large glossy / matte blotches
  const plates = makeCells(79, 11);
  const fine = makeCells(83, 22);
  const r = rng(97);

  const H = new Float32Array(N * N), G = new Float32Array(N * N), A = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const fbm = n1(u, v) * 0.45 + n2(u, v) * 0.28 + n3(u, v) * 0.17 + n4(u, v) * 0.1;
    const [p1, p2] = plates(u, v);
    const groove = 1 - smooth(0.0, 0.09, p2 - p1);          // 1 in the cracks between plates
    const [q1, q2] = fine(u, v);
    const fgroove = 1 - smooth(0.0, 0.12, q2 - q1);
    // streaks: stretch noise along v (leg length direction)
    const streak = fib(u, v);
    const plateDome = smooth(0.0, 0.6, p2 - p1) * 0.25;     // each plate slightly domed
    let h = fbm * 0.6 + plateDome * 0.3 - groove * 0.08 - fgroove * 0.12 + streak * 0.28;
    H[y * N + x] = h;
    const b = blot(u, v);
    // roughness: mostly rough, glossy wet patches, cracks very rough
    G[y * N + x] = Math.min(1, Math.max(0.12, 0.62 + (fbm - 0.5) * 0.35 + groove * 0.3 - smooth(0.55, 0.75, b) * 0.38));
    A[y * N + x] = 0.78 + (fbm - 0.5) * 0.45 + (streak - 0.5) * 0.12 - groove * 0.1 - fgroove * 0.1 + (b - 0.5) * 0.15;
  }
  // pores / pits
  const pits = key ? 900 : 260;
  for (let i = 0; i < pits; i++) {
    const cx = Math.floor(r() * N), cy = Math.floor(r() * N), rad = 1 + r() * (key ? 2.2 : 1.2);
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d > rad) continue;
      const k = (((cy + oy) % N + N) % N) * N + (((cx + ox) % N + N) % N);
      H[k] -= 0.08 * (1 - d / rad);
      A[k] -= 0.12 * (1 - d / rad);
    }
  }

  const mk = (fill) => {
    const c = canvas(N), ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) fill(i, img.data, i * 4);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const strength = key ? 5.5 : 3.5;
  const normalMap = mk((i, d, o) => {
    const x = i % N, y = (i / N) | 0;
    const hx = H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N];
    const hy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
    let nx = -hx * strength, ny = hy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = (nz * 0.5 + 0.5) * 255; d[o + 3] = 255;
  });
  const roughnessMap = mk((i, d, o) => { const g = G[i] * 255; d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255; });
  const map = mk((i, d, o) => { const a = Math.max(0, Math.min(1, A[i])) * 255; d[o] = a; d[o + 1] = a * 0.97; d[o + 2] = a * 0.94; d[o + 3] = 255; });
  map.colorSpace = THREE.SRGBColorSpace;
  const set = { map, normalMap, roughnessMap };
  cache.set(key, set);
  return set;
}

/** Soft radial glow for eye sprites (white; tinted by the sprite material colour). */
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = canvas(64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
