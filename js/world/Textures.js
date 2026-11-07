// Procedural textures, all drawn on canvases at start-up. Every texture tiles seamlessly.
// Call initTextures(renderer, quality) once, then ask for textures by function. Results are cached.
//
// Most surface functions return { map, normalMap, roughnessMap, tile: [metresU, metresV] }:
// `tile` says how many metres of the world one repeat of the texture covers, so geometry can use
// world-scale UVs (see uvByWorld in Cabin.js).
import * as THREE from 'three';

let maxAniso = 4;
let big = 1024;   // size for large, close-up surfaces (planks)
let mid = 512;    // size for most other surfaces
let small = 256;  // size for small details
const cache = new Map();

export function initTextures(renderer, quality) {
  maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality.tier === 'high' ? 8 : 4);
  if (quality.tier === 'high') { big = 1024; mid = 512; small = 256; }
  else { big = 512; mid = 256; small = 128; }
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// ---------------------------------------------------------------- noise helpers
function hash(i, j, seed) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// Periodic value noise. u, v in [0,1); nx, ny lattice cells across the tile.
function vnoise(u, v, nx, ny, seed) {
  const X = u * nx, Y = v * ny;
  const xi = Math.floor(X), yi = Math.floor(Y);
  const fx = X - xi, fy = Y - yi;
  const x0 = ((xi % nx) + nx) % nx, y0 = ((yi % ny) + ny) % ny;
  const x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, nx, ny, oct, seed, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(u, v, nx << o, ny << o, seed + o * 31);
    n += a; a *= gain;
  }
  return s / n;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
// Build colour/normal/roughness canvases from per-pixel arrays.
function finish(W, H, rgb, height, rough, normalStrength) {
  const cMap = canvas(W, H), cN = canvas(W, H), cR = canvas(W, H);
  const iMap = cMap.getContext('2d').createImageData(W, H);
  const iN = cN.getContext('2d').createImageData(W, H);
  const iR = cR.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const yu = (y - 1 + H) % H, yd = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, p = i * 4;
      iMap.data[p] = rgb[i * 3]; iMap.data[p + 1] = rgb[i * 3 + 1]; iMap.data[p + 2] = rgb[i * 3 + 2]; iMap.data[p + 3] = 255;
      const xl = (x - 1 + W) % W, xr = (x + 1) % W;
      let nx = -(height[y * W + xr] - height[y * W + xl]) * normalStrength;
      let ny = (height[yd * W + x] - height[yu * W + x]) * normalStrength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      iN.data[p] = (nx * inv * 0.5 + 0.5) * 255; iN.data[p + 1] = (ny * inv * 0.5 + 0.5) * 255; iN.data[p + 2] = (inv * 0.5 + 0.5) * 255; iN.data[p + 3] = 255;
      const r = clamp01(rough[i]) * 255;
      // roughnessMap reads the green channel
      iR.data[p] = r; iR.data[p + 1] = r; iR.data[p + 2] = r; iR.data[p + 3] = 255;
    }
  }
  cMap.getContext('2d').putImageData(iMap, 0, 0);
  cN.getContext('2d').putImageData(iN, 0, 0);
  cR.getContext('2d').putImageData(iR, 0, 0);
  return { map: tex(cMap, true), normalMap: tex(cN, false), roughnessMap: tex(cR, false) };
}

// ---------------------------------------------------------------- wood planks
// Boards run along U (texture x). `rows` boards across V. Butt joints, knots, grain, gaps, dirt.
// opts: dark/light [r,g,b] 0..255, weather 0..1 (silver-grey), gap px, rows, joints per row,
//       worldU/worldV metres per tile, wet 0..1 (lower roughness), shingle (roof shingles mode), moss 0..1
function planks(opts) {
  const o = Object.assign({ rows: 8, joints: 1, gap: 2.5, knots: 1.2, weather: 0, wet: 0, dirt: 0.5,
    dark: [52, 34, 20], light: [128, 88, 54], worldU: 2.4, worldV: 1.6, seed: 1, size: big, shingle: false, moss: 0, ringFreq: 5 }, opts);
  const W = o.size, H = Math.max(64, Math.round(o.size * Math.min(1, o.worldV / o.worldU)));
  const R = rng(o.seed);
  const rgb = new Uint8ClampedArray(W * H * 3), height = new Float32Array(W * H), rough = new Float32Array(W * H);
  // per row: joint positions and per-board randoms
  const rowsData = [];
  for (let r = 0; r < o.rows; r++) {
    const n = o.shingle ? 6 + Math.floor(R() * 5) : o.joints;
    const js = [];
    if (o.shingle) {
      let u = R() * 0.1;
      for (let k = 0; k < n; k++) { js.push(u % 1); u += (1 / n) * (0.6 + R() * 0.8); }
      js.sort((a, b) => a - b);
    } else for (let k = 0; k < n; k++) js.push((R() + k) / n);
    const boards = [];
    for (let k = 0; k < Math.max(1, n); k++) {
      const kn = [];
      const kc = R() < o.knots % 1 ? Math.ceil(o.knots) : Math.floor(o.knots);
      for (let q = 0; q < kc; q++) kn.push({ u: R(), f: 0.25 + R() * 0.5, r: 0.006 + R() * 0.012 });
      boards.push({ tone: 0.72 + R() * 0.5, hue: R() - 0.5, phase: R() * 10, kn, grey: R(), off: R() * 7 });
    }
    rowsData.push({ js, boards, wobble: R() * 0.15 });
  }
  const pxU = W, pxV = H / o.rows; // pixels per tile in u; pixels per board across
  const aspect = o.worldU / o.worldV; // world-units ratio for round knots
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const rf = v * o.rows, row = Math.floor(rf), fy = rf - row;
    const rd = rowsData[row];
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // board segment
      let seg = 0; let dj = 1e9;
      for (let k = 0; k < rd.js.length; k++) {
        if (u >= rd.js[k]) seg = k + 1;
        let d = Math.abs(u - rd.js[k]); d = Math.min(d, 1 - d); if (d < dj) dj = d;
      }
      if (seg >= rd.js.length) seg = 0;
      const b = rd.boards[Math.min(seg, rd.boards.length - 1)];
      // grain: long streaks + rings warped by noise
      const streak = fbm(u, v, 4, o.rows * 24, 4, o.seed + 7);
      const warp = fbm(u, v, 3, o.rows * 2, 3, o.seed + 11);
      let phase = fy * 2.2 + warp * 3.0 + b.phase + u * 0.6;
      let knotDark = 0, knotH = 0;
      for (const k of b.kn) {
        let du = u - k.u; du -= Math.round(du);
        const dv = (fy - k.f) / o.rows / aspect;
        const d2 = (du * du + dv * dv) / (k.r * k.r);
        if (d2 < 30) {
          phase += 2.2 * Math.exp(-d2 * 0.15);
          knotDark = Math.max(knotDark, Math.exp(-d2 * 0.8));
          knotH += Math.exp(-d2 * 1.5) * 0.3;
        }
      }
      const ring = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * o.ringFreq * 0.5), 3);
      let g = clamp01(0.55 * streak + 0.45 * (1 - ring) + (b.hue * 0.1));
      // edges, gaps, joints
      const ePx = Math.min(fy, 1 - fy) * pxV;
      const jPx = dj * pxU;
      let h = 1, gapMask = 0;
      if (o.shingle) {
        // shingles: thicker at the bottom edge (fy near 1 = lower edge in canvas)
        h = 0.35 + 0.65 * fy;
        if ((1 - fy) * pxV < 3) { h = 0.05; gapMask = 0.9; }
        if (jPx < 1.6) { gapMask = Math.max(gapMask, 0.85); h = 0.1; }
      } else {
        if (ePx < o.gap) { gapMask = 1; h = 0; }
        else if (ePx < o.gap + 3) { h = (ePx - o.gap) / 3; gapMask = 0.35 * (1 - h); }
        if (o.joints > 0 && jPx < 1.2) { gapMask = Math.max(gapMask, 0.8); h = Math.min(h, 0.2); }
      }
      // dirt / grime / weathering
      const dirt = fbm(u, v, 3, 3, 4, o.seed + 23);
      const streaks = fbm(u, v, 2, 40, 3, o.seed + 41);
      let cr = mix(o.dark[0], o.light[0], g), cg = mix(o.dark[1], o.light[1], g), cb = mix(o.dark[2], o.light[2], g);
      const tone = b.tone * (1 - o.dirt * 0.5 * sstep(0.45, 0.8, dirt));
      cr *= tone; cg *= tone; cb *= tone;
      if (o.weather > 0) {
        const lum = (cr * 0.3 + cg * 0.59 + cb * 0.11);
        const wv = clamp01(o.weather * (0.7 + 0.5 * b.grey) * (0.6 + 0.6 * streaks));
        cr = mix(cr, lum * 0.95, wv); cg = mix(cg, lum * 0.98, wv); cb = mix(cb, lum * 1.03, wv);
      }
      if (o.moss > 0) {
        const m = sstep(0.55, 0.75, fbm(u, v, 4, 4, 4, o.seed + 77)) * o.moss * (o.shingle ? (0.4 + 0.6 * (1 - fy)) : 1);
        cr = mix(cr, 38, m); cg = mix(cg, 52, m); cb = mix(cb, 22, m);
      }
      // knots
      cr = mix(cr, o.dark[0] * 0.45, knotDark); cg = mix(cg, o.dark[1] * 0.4, knotDark); cb = mix(cb, o.dark[2] * 0.4, knotDark);
      // board edges slightly darker (worn grime collects)
      const edgeDark = 1 - 0.25 * Math.exp(-ePx / 6);
      cr *= edgeDark; cg *= edgeDark; cb *= edgeDark;
      // gaps
      cr = mix(cr, 6, gapMask); cg = mix(cg, 4, gapMask); cb = mix(cb, 3, gapMask);
      const i = y * W + x;
      rgb[i * 3] = cr; rgb[i * 3 + 1] = cg; rgb[i * 3 + 2] = cb;
      height[i] = h + (streak - 0.5) * 0.12 + ring * 0.05 + knotH;
      rough[i] = mix(0.62, 0.92, g * 0.5 + dirt * 0.5) - o.wet * (0.25 + 0.25 * (1 - streaks)) + gapMask * 0.1;
    }
  }
  const t = finish(W, H, rgb, height, rough, o.shingle ? 3.5 : 2.2);
  t.tile = [o.worldU, o.worldV];
  return t;
}

export const woodWall = () => cached('woodWall', () => planks({ seed: 3, rows: 8, joints: 1, worldU: 2.6, worldV: 1.6, dark: [40, 33, 26], light: [116, 100, 80], knots: 1.3, dirt: 0.6 }));
export const woodFloor = () => cached('woodFloor', () => planks({ seed: 5, rows: 6, joints: 1, worldU: 2.6, worldV: 1.2, dark: [36, 30, 24], light: [104, 90, 72], knots: 0.8, dirt: 0.9, gap: 3 }));
export const woodCeiling = () => cached('woodCeiling', () => planks({ seed: 9, rows: 10, joints: 1, worldU: 2.6, worldV: 1.5, dark: [32, 27, 21], light: [88, 76, 60], knots: 1, dirt: 0.7, size: mid }));
export const woodBeam = () => cached('woodBeam', () => planks({ seed: 13, rows: 2, joints: 0, gap: 0, worldU: 2.2, worldV: 0.36, dark: [34, 28, 22], light: [92, 78, 62], knots: 1.5, dirt: 0.8, size: mid, ringFreq: 3 }));
export const woodFurniture = () => cached('woodFurniture', () => planks({ seed: 17, rows: 4, joints: 0, gap: 1.5, worldU: 1.6, worldV: 0.6, dark: [44, 36, 28], light: [120, 102, 80], knots: 0.7, dirt: 0.5, size: mid }));
export const woodExterior = () => cached('woodExterior', () => planks({ seed: 21, rows: 7, joints: 1, gap: 3, worldU: 2.8, worldV: 1.4, dark: [40, 36, 32], light: [112, 102, 90], weather: 0.85, wet: 0.45, knots: 1.4, dirt: 0.9, moss: 0.35 }));
export const woodTrimExterior = () => cached('woodTrimExt', () => planks({ seed: 25, rows: 2, joints: 0, gap: 0, worldU: 1.6, worldV: 0.3, dark: [36, 33, 30], light: [100, 92, 82], weather: 0.9, wet: 0.4, knots: 1, size: mid }));
export const roofShingles = () => cached('roofShingles', () => planks({ seed: 29, rows: 9, shingle: true, worldU: 2.0, worldV: 1.6, dark: [30, 27, 24], light: [84, 74, 64], weather: 0.7, wet: 0.5, knots: 0, moss: 0.7, dirt: 0.8 }));

// ---------------------------------------------------------------- bark
export const bark = (dead = false) => cached('bark' + dead, () => {
  const W = mid, H = mid * 2;
  const rgb = new Uint8ClampedArray(W * H * 3), height = new Float32Array(W * H), rough = new Float32Array(W * H);
  const seed = dead ? 101 : 99;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = fbm(u, v, 4, 8, 3, seed) * 0.08;
      const ridge = 1 - Math.abs(fbm(u + warp, v, 10, 3, 4, seed + 3) * 2 - 1);  // vertical furrows
      const plates = fbm(u, v, 12, 10, 3, seed + 5);
      const fine = fbm(u, v, 40, 40, 2, seed + 9);
      let h = Math.pow(ridge, 1.6) * 0.7 + plates * 0.25 + fine * 0.1;
      if (!dead) h *= 0.8 + 0.4 * sstep(0.3, 0.7, plates);
      const lichen = sstep(0.62, 0.78, fbm(u, v, 5, 6, 4, seed + 13));
      let c = 0.25 + 0.75 * h;
      let r, g, b;
      if (dead) { r = 70 * c + 18; g = 66 * c + 16; b = 62 * c + 16; }
      else { r = 64 * c + 10; g = 46 * c + 8; b = 34 * c + 7; }
      r = mix(r, 70, lichen * 0.6); g = mix(g, 84, lichen * 0.6); b = mix(b, 62, lichen * 0.6);
      const i = y * W + x;
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      height[i] = h * 4; rough[i] = 0.75 + 0.2 * (1 - h);
    }
  }
  const t = finish(W, H, rgb, height, rough, 2.5);
  t.tile = [1.2, 2.4];
  return t;
});

// cut wood end grain (log ends, firewood)
export const endGrain = () => cached('endGrain', () => {
  const W = small, H = small;
  const rgb = new Uint8ClampedArray(W * H * 3), height = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W - 0.5, v = y / H - 0.5;
    const r = Math.hypot(u, v) * 2 + fbm(x / W, y / H, 6, 6, 3, 61) * 0.08;
    const ring = 0.5 + 0.5 * Math.sin(r * 60);
    const crack = sstep(0.0, 0.02, Math.abs(Math.sin(Math.atan2(v, u) * 3 + 1) - 0.0));
    const bark = sstep(0.9, 0.96, r);
    const i = y * W + x;
    const c = (0.55 + 0.25 * ring) * (0.6 + 0.4 * crack);
    rgb[i * 3] = mix(118 * c, 40, bark); rgb[i * 3 + 1] = mix(92 * c, 30, bark); rgb[i * 3 + 2] = mix(64 * c, 22, bark);
    height[i] = ring * 0.3 + crack; rough[i] = 0.85;
  }
  return finish(W, H, rgb, height, rough, 1.5);
});

// ---------------------------------------------------------------- rock
export const rock = () => cached('rock', () => {
  const W = mid, H = mid;
  const rgb = new Uint8ClampedArray(W * H * 3), height = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const n = fbm(u, v, 6, 6, 6, 201);
    const cr = 1 - sstep(0.0, 0.03, Math.abs(fbm(u, v, 4, 4, 4, 207) - 0.5));
    const moss = sstep(0.55, 0.72, fbm(u, v, 3, 3, 5, 211));
    const speck = fbm(u, v, 64, 64, 1, 219);
    let c = 0.45 + 0.55 * n;
    let r = 72 * c, g = 72 * c, b = 74 * c;
    r *= 0.85 + speck * 0.3; g *= 0.85 + speck * 0.3; b *= 0.85 + speck * 0.3;
    r = mix(r, 34, moss); g = mix(g, 46, moss); b = mix(b, 22, moss);
    r *= 1 - cr * 0.6; g *= 1 - cr * 0.6; b *= 1 - cr * 0.6;
    const i = y * W + x;
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    height[i] = n * 3 - cr * 0.6; rough[i] = mix(0.45, 0.8, n) + moss * 0.15; // wet stone
  }
  const t = finish(W, H, rgb, height, rough, 2.0);
  t.tile = [1.5, 1.5];
  return t;
});

// Small tiling stone grain laid over the Blender rocks so they stay sharp up close.
// One non-colour texture: R,G = detail normal (x, y), B = grain brightness (0.5 = no change).
export const rockDetail = () => cached('rockDetail', () => {
  const W = 256, H = 256;
  const c = canvas(W, H), img = c.getContext('2d').createImageData(W, H);
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const pit = sstep(0.62, 0.8, fbm(u, v, 24, 24, 2, 233));          // tiny pits
    h[y * W + x] = fbm(u, v, 8, 8, 5, 227, 0.6) - pit * 0.35;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    const nx = -(h[y * W + (x + 1) % W] - h[y * W + (x - 1 + W) % W]) * 6;
    const ny = (h[((y + 1) % H) * W + x] - h[((y - 1 + H) % H) * W + x]) * 6;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    img.data[p] = (nx * inv * 0.5 + 0.5) * 255; img.data[p + 1] = (ny * inv * 0.5 + 0.5) * 255;
    img.data[p + 2] = clamp01(0.5 + (h[i] - 0.5) * 0.9) * 255; img.data[p + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return tex(c, false);
});

// ---------------------------------------------------------------- forest floor
// Mud + needles + leaves + twigs, wet puddles. Drawn as a noise base, then strokes on top.
export const forestFloor = () => cached('forestFloor', () => {
  const W = big, H = big;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const puddle = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const n = fbm(u, v, 5, 5, 5, 301);
    const p = sstep(0.62, 0.7, fbm(u, v, 3, 3, 4, 305));
    const i = y * W + x;
    puddle[i] = p;
    const k = (0.5 + 0.6 * n) * (1 - p * 0.5);
    img.data[i * 4] = 78 * k; img.data[i * 4 + 1] = 64 * k; img.data[i * 4 + 2] = 48 * k; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const R = rng(311);
  const wrapDraw = (fn, x, y, m) => { for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) if (Math.abs(x + dx - W / 2) < W / 2 + m && Math.abs(y + dy - H / 2) < H / 2 + m) fn(x + dx, y + dy); };
  const s = W / 1024;
  // fallen leaves (dark, decayed)
  for (let k = 0; k < 900; k++) {
    const x = R() * W, y = R() * H, a = R() * Math.PI, l = (8 + R() * 10) * s, w = l * (0.35 + R() * 0.2);
    const t = R();
    const col = t < 0.5 ? `rgb(${90 + R() * 50},${62 + R() * 26},${30 + R() * 14})` : `rgb(${62 + R() * 30},${50 + R() * 18},${34 + R() * 10})`;
    wrapDraw((px, py) => {
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(20,12,6,0.6)'; ctx.lineWidth = 0.8 * s; ctx.beginPath(); ctx.moveTo(-l, 0); ctx.lineTo(l, 0); ctx.stroke();
      ctx.restore();
    }, x, y, 30 * s);
  }
  // pine needles
  ctx.lineCap = 'round';
  for (let k = 0; k < 6000; k++) {
    const x = R() * W, y = R() * H, a = R() * Math.PI * 2, l = (6 + R() * 10) * s;
    const b = 80 + R() * 70;
    ctx.strokeStyle = `rgba(${b},${b * 0.66},${b * 0.4},${0.5 + R() * 0.5})`;
    ctx.lineWidth = (0.8 + R() * 0.8) * s;
    wrapDraw((px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); }, x, y, 20 * s);
  }
  // twigs
  for (let k = 0; k < 120; k++) {
    const x = R() * W, y = R() * H, a = R() * Math.PI * 2, l = (20 + R() * 50) * s;
    ctx.strokeStyle = `rgb(${30 + R() * 25},${24 + R() * 15},${16 + R() * 10})`;
    ctx.lineWidth = (1.5 + R() * 2.5) * s;
    wrapDraw((px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a + 0.3) * l * 0.5, py + Math.sin(a + 0.3) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); }, x, y, 80 * s);
  }
  // wet puddles: darken & flatten again
  const d = ctx.getImageData(0, 0, W, H);
  const rgb = new Uint8ClampedArray(W * H * 3), height = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = puddle[i];
    let r = d.data[i * 4], g = d.data[i * 4 + 1], b = d.data[i * 4 + 2];
    r = mix(r, 14, p * 0.8); g = mix(g, 13, p * 0.8); b = mix(b, 12, p * 0.8);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    const lum = (r + g + b) / 765;
    height[i] = lum * 6 * (1 - p);
    rough[i] = mix(0.55 + (1 - lum) * 0.35, 0.08, p);
  }
  const t = finish(W, H, rgb, height, rough, 1.4);
  t.tile = [3.5, 3.5];
  return t;
});

// ---------------------------------------------------------------- alpha cards (foliage)
function alphaTex(c) { const t = tex(c, true, false); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping; return t; }

// A pine/spruce branch seen from above: stem along +x from the left edge, needles in sprays.
export const needleBranch = () => cached('needles', () => {
  const W = mid, H = mid / 2;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const R = rng(401);
  ctx.lineCap = 'round';
  const s = W / 512;
  const twig = (x0, y0, ang, len, depth) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    ctx.strokeStyle = `rgb(${34 + R() * 10},${26 + R() * 8},${18 + R() * 6})`;
    ctx.lineWidth = (depth === 0 ? 3 : 1.4) * s;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    // needles
    const n = Math.floor(len / (2.2 * s));
    for (let i = 0; i < n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const taper = 1 - t * 0.55;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.7 + R() * 0.5);
        const l = (9 + R() * 6) * s * taper * (depth === 0 ? 1.1 : 0.9);
        const gcol = 30 + R() * 34;
        ctx.strokeStyle = `rgb(${gcol * 0.5},${gcol},${gcol * 0.62})`;
        ctx.lineWidth = (1.1 + R() * 0.6) * s;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
      }
    }
    if (depth < 2) {
      const k = depth === 0 ? 9 : 4;
      for (let i = 1; i <= k; i++) {
        const t = i / (k + 1) + (R() - 0.5) * 0.05;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const side = i % 2 ? 1 : -1;
        const l = len * (depth === 0 ? 0.42 : 0.5) * (1 - t * 0.6) * (0.8 + R() * 0.4);
        twig(px, py, ang + side * (0.6 + R() * 0.35), l, depth + 1);
      }
    }
  };
  twig(2 * s, H / 2, 0, W - 18 * s, 0);
  return alphaTex(c);
});

// Clump of tall wet grass blades growing from the bottom edge.
export const grassBlades = () => cached('grass', () => {
  const W = small, H = small * 2;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const R = rng(501);
  for (let k = 0; k < 70; k++) {
    const x0 = W * (0.1 + R() * 0.8), h = H * (0.45 + R() * 0.55), bend = (R() - 0.5) * W * 0.5, w = (2 + R() * 3) * W / 256;
    const g = 50 + R() * 50, y = 0.75 + R() * 0.25;
    ctx.fillStyle = `rgb(${g * 0.78 * y},${g * y},${g * 0.6 * y})`;
    ctx.beginPath();
    ctx.moveTo(x0 - w, H);
    ctx.quadraticCurveTo(x0 + bend * 0.3, H - h * 0.6, x0 + bend, H - h);
    ctx.quadraticCurveTo(x0 + bend * 0.3 + w * 0.4, H - h * 0.6, x0 + w, H);
    ctx.fill();
  }
  return alphaTex(c);
});

export const fernFrond = () => cached('fern', () => {
  const W = small * 2, H = small;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const R = rng(601);
  const s = W / 512;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgb(30,40,20)'; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.quadraticCurveTo(W * 0.5, H * 0.45, W * 0.98, H / 2); ctx.stroke();
  for (let i = 0; i < 34; i++) {
    const t = i / 34, x = t * W * 0.96, l = H * 0.46 * Math.sin(Math.PI * (0.15 + t * 0.85)) * (0.9 + R() * 0.2);
    for (const side of [-1, 1]) {
      const g = 38 + R() * 30;
      ctx.fillStyle = `rgb(${g * 0.7},${g},${g * 0.45})`;
      ctx.beginPath();
      ctx.moveTo(x, H / 2);
      ctx.quadraticCurveTo(x + l * 0.4, H / 2 + side * l * 0.6, x + l * 0.35, H / 2 + side * l);
      ctx.quadraticCurveTo(x + l * 0.1, H / 2 + side * l * 0.5, x - 2 * s, H / 2);
      ctx.fill();
    }
  }
  return alphaTex(c);
});

// Single conifer silhouette for distant impostor cards.
export const pineSilhouette = () => cached('pineSil', () => {
  const W = small, H = small * 2;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const R = rng(701);
  const cx = W / 2;
  ctx.fillStyle = 'rgb(24,26,22)';
  ctx.beginPath(); ctx.moveTo(cx - W * 0.02, H); ctx.lineTo(cx - W * 0.006, H * 0.05); ctx.lineTo(cx + W * 0.006, H * 0.05); ctx.lineTo(cx + W * 0.02, H); ctx.fill();
  // drooping branch tufts, widest a little above the bottom, irregular
  for (let i = 0; i < 90; i++) {
    const t = i / 90, y = H * (0.03 + t * 0.8);
    const half = W * 0.47 * Math.pow(t, 0.8) * (0.55 + R() * 0.55);
    for (const sd of [-1, 1]) {
      if (R() < 0.25) continue;
      const g = 16 + R() * 12;
      ctx.fillStyle = `rgb(${g},${g + 6},${g + 2})`;
      const tipX = cx + sd * half, tipY = y + H * (0.02 + R() * 0.05) * (0.5 + t);
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + sd * half * 0.5, y - H * 0.005, tipX, tipY);
      ctx.quadraticCurveTo(cx + sd * half * 0.45, y + H * 0.025, cx, y + H * 0.02);
      ctx.fill();
    }
  }
  return alphaTex(c);
});

// Horizontally tiling band of treetops for distant layers.
export const treeline = (seed = 1) => cached('treeline' + seed, () => {
  const W = mid * 2, H = mid / 2;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const R = rng(800 + seed);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, H * 0.75, W, H * 0.25);
  for (let k = 0; k < 140; k++) {
    const x = R() * W, top = H * (0.05 + R() * 0.55), half = (6 + R() * 12) * W / 1024;
    for (const dx of [-W, 0, W]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, top);
      ctx.lineTo(x + dx - half * 2.2, H);
      ctx.lineTo(x + dx + half * 2.2, H);
      ctx.closePath(); ctx.fill();
      for (let j = 0; j < 8; j++) {
        const y = top + (H - top) * (j / 8), w = half * 2.4 * (j / 8 + 0.15);
        ctx.fillRect(x + dx - w, y, w * 2, 2);
      }
    }
  }
  const t = tex(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  t.flipY = false; // drawn tips-up in canvas space; the cylinder's v runs the other way here
  return t;
});

// Soft, lumpy fog puff (white, alpha in the texture).
export const fogPuff = () => cached('fogPuff', () => {
  const W = small, H = small;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
    const r = Math.sqrt(dx * dx + dy * dy * 1.0);
    const n = fbm(u, v, 4, 4, 4, 901);
    const a = clamp01((1 - r) * 1.4) * (0.35 + 0.9 * n);
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = clamp01(a * a) * 255;
  }
  ctx.putImageData(img, 0, 0);
  return alphaTex(c);
});

export const glow = () => cached('glow', () => {
  const W = 128, c = canvas(W, W), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
  return alphaTex(c);
});

// ---------------------------------------------------------------- fabrics & small props
function fabric(key, W, draw, roughBase = 0.95, tile = [1, 1]) {
  return cached(key, () => {
    const c = canvas(W, W), ctx = c.getContext('2d');
    draw(ctx, W);
    // weave noise + height from luminance
    const d = ctx.getImageData(0, 0, W, W);
    const rgb = new Uint8ClampedArray(W * W * 3), height = new Float32Array(W * W), rough = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const weave = ((x + y) % 4 < 2 ? 1 : 0.85) * (0.85 + 0.3 * fbm(x / W, y / W, 64, 64, 2, 1001));
      const grime = 1 - 0.35 * sstep(0.5, 0.8, fbm(x / W, y / W, 4, 4, 4, 1003));
      rgb[i * 3] = d.data[i * 4] * weave * grime; rgb[i * 3 + 1] = d.data[i * 4 + 1] * weave * grime; rgb[i * 3 + 2] = d.data[i * 4 + 2] * weave * grime;
      height[i] = weave; rough[i] = roughBase;
    }
    const t = finish(W, W, rgb, height, rough, 1.0);
    t.tile = tile;
    return t;
  });
}
export const blanket = () => fabric('blanket', mid, (ctx, W) => {
  ctx.fillStyle = 'rgb(92,30,24)'; ctx.fillRect(0, 0, W, W);
  const n = 6, s = W / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = 'rgba(15,12,10,0.55)';
    ctx.fillRect(i * s, 0, s / 2, W);
    ctx.fillRect(0, i * s, W, s / 2);
  }
}, 0.97, [0.9, 0.9]);
export const mattress = () => fabric('mattress', small, (ctx, W) => {
  ctx.fillStyle = 'rgb(150,140,118)'; ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? 'rgb(70,72,80)' : 'rgb(150,140,118)'; ctx.fillRect(i * W / 16, 0, W / 40, W); }
}, 0.95, [0.6, 0.6]);
export const rug = () => fabric('rug', mid, (ctx, W) => {
  ctx.fillStyle = 'rgb(70,34,26)'; ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = 'rgb(104,82,52)'; ctx.lineWidth = W * 0.03;
  ctx.strokeRect(W * 0.06, W * 0.06, W * 0.88, W * 0.88);
  ctx.strokeStyle = 'rgb(28,26,34)'; ctx.lineWidth = W * 0.02;
  ctx.strokeRect(W * 0.12, W * 0.12, W * 0.76, W * 0.76);
  ctx.fillStyle = 'rgb(98,76,48)';
  for (let k = 0; k < 3; k++) {
    const cy = W * (0.3 + k * 0.2);
    ctx.beginPath(); ctx.moveTo(W * 0.5, cy - W * 0.08); ctx.lineTo(W * 0.62, cy); ctx.lineTo(W * 0.5, cy + W * 0.08); ctx.lineTo(W * 0.38, cy); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgb(30,28,36)';
  for (let k = 0; k < 3; k++) { const cy = W * (0.3 + k * 0.2); ctx.fillRect(W * 0.47, cy - W * 0.03, W * 0.06, W * 0.06); }
}, 0.98, [1, 1]);
export const rag = () => fabric('rag', small, (ctx, W) => {
  ctx.fillStyle = 'rgb(150,140,120)'; ctx.fillRect(0, 0, W, W);
  const R = rng(1101);
  for (let k = 0; k < 30; k++) { ctx.fillStyle = `rgba(30,22,12,${0.15 + R() * 0.3})`; ctx.beginPath(); ctx.arc(R() * W, R() * W, R() * W * 0.15, 0, 7); ctx.fill(); }
}, 0.95, [0.3, 0.3]);

export const ammoBoxLabel = () => cached('ammoLabel', () => {
  const W = small, c = canvas(W, W), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(74,78,52)'; ctx.fillRect(0, 0, W, W);
  const R = rng(1201);
  for (let k = 0; k < 400; k++) { ctx.fillStyle = `rgba(0,0,0,${R() * 0.12})`; ctx.fillRect(R() * W, R() * W, 2, 2); }
  ctx.fillStyle = 'rgb(200,192,160)'; ctx.fillRect(W * 0.08, W * 0.3, W * 0.84, W * 0.4);
  ctx.fillStyle = 'rgb(40,36,30)';
  ctx.font = `bold ${Math.round(W * 0.11)}px monospace`; ctx.textAlign = 'center';
  ctx.fillText('CAL .30', W / 2, W * 0.45);
  ctx.font = `${Math.round(W * 0.07)}px monospace`;
  ctx.fillText('20 CARTRIDGES', W / 2, W * 0.58);
  ctx.fillText('BALL M2', W / 2, W * 0.66);
  const t = tex(c, true, false);
  return t;
});

// Cast iron / dark steel with rust.
export const iron = () => cached('iron', () => {
  const W = small * 2;
  const rgb = new Uint8ClampedArray(W * W * 3), height = new Float32Array(W * W), rough = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W, i = y * W + x;
    const n = fbm(u, v, 8, 8, 5, 1301);
    const rust = sstep(0.55, 0.75, fbm(u, v, 4, 4, 5, 1307));
    const c = 22 + n * 20;
    rgb[i * 3] = mix(c, 80, rust); rgb[i * 3 + 1] = mix(c, 40, rust); rgb[i * 3 + 2] = mix(c * 1.05, 22, rust);
    height[i] = n + rust * 0.5; rough[i] = mix(0.55, 0.9, rust);
  }
  const t = finish(W, W, rgb, height, rough, 1.5);
  t.tile = [0.6, 0.6];
  return t;
});

// Ripple normal map for the creek.
export const waterNormal = () => cached('waterN', () => {
  const W = small * 2;
  const rgb = new Uint8ClampedArray(W * W * 3), height = new Float32Array(W * W), rough = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    height[i] = fbm(x / W, y / W, 6, 12, 4, 1401);
    rough[i] = 0.1;
  }
  return finish(W, W, rgb, height, rough, 6).normalMap;
});

// Equirectangular night sky used only as a reflection source for wet exterior surfaces and water.
export const nightEnv = () => cached('nightEnv', () => {
  const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, 'rgb(6,8,12)');
  g.addColorStop(0.38, 'rgb(28,34,44)');
  g.addColorStop(0.5, 'rgb(40,48,58)');
  g.addColorStop(0.53, 'rgb(10,12,14)');
  g.addColorStop(1.0, 'rgb(3,3,4)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // moon glow toward east-north-east (equirect u ~ 0.5 is -Z; +X ~ 0.75)
  const mg = ctx.createRadialGradient(W * 0.7, H * 0.25, 0, W * 0.7, H * 0.25, W * 0.18);
  mg.addColorStop(0, 'rgba(120,135,160,0.7)'); mg.addColorStop(1, 'rgba(120,135,160,0)');
  ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});
