// Asset pipeline: `npm run assets [names...]`
//  1. Runs Blender in the background (no window) on blender/build.py -> blender/build/<name>.glb
//  2. Shrinks each file for the web (WebP textures at the size in assets/params/<name>.json, meshopt geometry)
//     -> assets/models/<name>.glb, which the game loads.
// A hand-made export in blender/source/<name>.glb wins over the generated one (step 1 is skipped for it).
// Flags: --no-blender (only redo step 2)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const args = process.argv.slice(2);
const skipBlender = args.includes('--no-blender');
const generators = fs.readdirSync('blender/generators').filter((f) => f.endsWith('.py') && !f.startsWith('_')).map((f) => f.slice(0, -3));
const names = args.filter((a) => !a.startsWith('--'));
const wanted = names.length ? names : generators;

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

const toGenerate = wanted.filter((n) => !fs.existsSync(`blender/source/${n}.glb`) && generators.includes(n));
if (!skipBlender && toGenerate.length) {
  if (!fs.existsSync(BLENDER)) { console.error(`Blender not found at ${BLENDER} (set BLENDER=/path/to/blender)`); process.exit(1); }
  const r = run(BLENDER, ['-b', '--factory-startup', '-P', 'blender/build.py', '--', ...toGenerate]);
  for (const line of r.out.split('\n')) if (line.startsWith('[assets]') || /Error|Traceback|^\s+File /.test(line)) console.log(line);
  if (!r.ok) { console.error('Blender step failed'); process.exit(1); }
}

fs.mkdirSync('assets/models', { recursive: true });
let failed = false;
for (const n of wanted) {
  const src = fs.existsSync(`blender/source/${n}.glb`) ? `blender/source/${n}.glb` : `blender/build/${n}.glb`;
  if (!fs.existsSync(src)) { console.log(`[assets] ${n}: no ${src}, skipped`); continue; }
  let size = 1024;
  try { size = JSON.parse(fs.readFileSync(`assets/params/${n}.json`, 'utf8')).budget?.gameTexture || size; } catch (_) {}
  const out = `assets/models/${n}.glb`;
  const r = run(path.join('node_modules', '.bin', 'gltf-transform'), ['optimize', src, out,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size),
    '--simplify', 'false', '--join', 'false', '--instance', 'false', '--flatten', 'false', '--palette', 'false']);
  if (!r.ok) { console.log(r.out); failed = true; continue; }
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`[assets] ${n}: ${src} -> ${out} (${kb} KB)${kb > 2048 ? '  OVER the 2 MB budget' : ''}`);
}
process.exit(failed ? 1 : 0);
