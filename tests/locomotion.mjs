// Locomotion score: runs every spider model at every size over a test course with a fixed time step, headless,
// and counts what looks wrong. Lower is better; the test fails over the limits at the bottom.
//
// Course: walk across the ground, stop, turn on the spot, zig-zag, climb the outside wall, cross the glass,
// squeeze in through the north window, walk across the floor past the furniture.
// Measured per frame:
//   snaps      a joint's turning speed jumps by more than 12 degrees/frame while planted, 30 while swinging (a pop)
//   reachErr   a planted foot's tip is more than 15% of the leg span away from where the foot is (leg can't reach)
//   clipBody   the body centre is inside a wall, the frame or furniture
//   clipKnee   a knee is inside a wall, the frame or furniture (deeper than 2 cm)
//   clipFoot   a planted foot is inside solid geometry (deeper than 2 cm)
// Usage: node tests/locomotion.mjs [--only=runner] [--size=large]
import { chromium } from 'playwright';
import { startServer } from '../tools/serve.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const sizeArg = (args.find((a) => a.startsWith('--size=')) || '').slice(7);
const port = 8700 + Math.floor(Math.random() * 200);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/index.html?mute=1`);
await page.waitForTimeout(1500);

const result = await page.evaluate(async ({ only, sizeArg }) => {
  const THREE = await import('three');
  const { Spider } = await import('./js/spiders/SpiderAI.js');
  const { SpiderCollision } = await import('./js/spiders/SpiderCollision.js');
  const { loadSpiderModels, SPIDER_TYPES, SIZES } = await import('./js/spiders/SpiderModel.js');
  const { BONE } = await import('./js/spiders/SpiderRig.js');
  const { WINDOWS, CABIN, terrainHeight } = await import('./js/world/Layout.js');
  const { groundNode, wallPoint } = await import('./js/spiders/SpiderPaths.js');
  const { Cabin } = await import('./js/world/Cabin.js').catch(() => ({}));
  await loadSpiderModels({ tier: 'high', spiderDetail: 1 });
  const scene = new THREE.Scene();
  // furniture footprints: the real cabin's colliders if we can build it cheaply, else none
  let colliders = [];
  try { const w = await import('./js/world/World.js'); const world = new w.World(scene, { tier: 'low' }); colliders = world.cabin?.colliders || []; } catch { colliders = []; }
  const collision = new SpiderCollision(colliders);
  const win = WINDOWS[0];
  const fakeWin = { id: win.id, center: win.center.clone(), normal: win.normal.clone(), width: win.width, height: win.height, stage: 4 };
  const mgr = { scene, audio: null, events: { emit() {} }, quality: { tier: 'high', spiderDetail: 1 }, collision, colliders, gore: null,
    slots: { north: [null, null, null], east: [null, null, null], west: [null, null, null] }, windows: { byId: { north: fakeWin } }, later() {}, bruteAt() { return false; } };
  const player = { position: new THREE.Vector3(0, 0, 3), camera: new THREE.PerspectiveCamera(), dead: true, damage() {}, health: 100 };
  const types = only ? only.split(',') : SPIDER_TYPES;
  const sizes = sizeArg ? sizeArg.split(',') : Object.keys(SIZES || { medium: 1 });
  const out = {};
  const dt = 1 / 60;
  const UPV = new THREE.Vector3(0, 1, 0);
  for (const type of types) for (const size of sizes) {
    const s = new Spider(type, mgr, { size });
    const rig = s.visual.rig;
    const prevQ = rig.legs.map((l) => l.q.map((q) => q.clone()));
    const prevA = rig.legs.map(() => new Float32Array(6));
    let phase = 'walk';
    const m = { byPhase: {}, frames: 0, snaps: 0, reachErr: 0, clipBody: 0, clipKnee: 0, clipFoot: 0, maxSnapDeg: 0 };
    const run = (secs, each) => {
      const n = Math.round(secs / dt);
      for (let i = 0; i < n; i++) {
        each?.(i * dt);
        s.update(dt, player);
        s.root.updateMatrixWorld(true);
        m.frames++;
        const sp = rig.space;
        for (const l of rig.legs) {
          for (let k = 1; k < 6; k++) {
            const a0 = l.q[k].angleTo(prevQ[l.index][k]) * 180 / Math.PI;
            // a pop is a sudden change in how fast the joint turns, not fast smooth motion
            const a = Math.abs(a0 - prevA[l.index][k]); prevA[l.index][k] = a0;
            if (m.frames > 3 && a > m.maxSnapDeg) m.maxSnapDeg = a;
            if (m.frames > 3 && a > (l.stepping || l.raise > 0.05 ? 30 : 12) && rig.deadK === 0) { m.snaps++; const b = m.byPhase[phase] || (m.byPhase[phase] = { snaps: 0, reach: 0, joints: {} }); b.snaps++; b.joints[k] = (b.joints[k] || 0) + 1; }
            prevQ[l.index][k].copy(l.q[k]);
          }
          if (!l.stepping && l.raise < 0.05) {
            const tip = l.end.clone().applyMatrix4(sp.matrixWorld);
            if (tip.distanceTo(l.foot) > 0.15 * rig.def.restR * sp.matrixWorld.getMaxScaleOnAxis()) { m.reachErr++; const b = m.byPhase[phase] || (m.byPhase[phase] = { snaps: 0, reach: 0, joints: {} }); b.reach++; }
            if (collision.pointInside(l.foot, -0.02)) m.clipFoot++;
          }
          const knee = l.pos[2].clone().applyMatrix4(sp.matrixWorld);
          if (collision.pointInside(knee, -0.02)) m.clipKnee++;
        }
        const body = rig.bodyPos.clone().applyMatrix4(sp.matrixWorld);
        if (collision.pointInside(body, -0.02)) m.clipBody++;
      }
    };
    // 1. walk, stop
    const z0 = -CABIN.halfZ - 9;
    s.state = 'approach';
    const g = (x, z) => groundNode(x, z);
    s.follow([g(-3, z0 - 4), g(-3, z0), g(0, z0 + 1)], null); s.visual.rig.snapFeet();
    run(4);
    s.path = null; run(1.2);
    phase = 'turn';
    // 2. turn on the spot (180 degrees over 1.5 s)
    run(1.5, (t) => { s.fwd.set(Math.sin(t / 1.5 * Math.PI), 0, Math.cos(t / 1.5 * Math.PI)); });
    phase = 'zigclimb';
    // 3. zig-zag towards the wall, 4. climb the outside wall and cross onto the glass
    const base = wallPoint(win, 0.9, CABIN.groundY + 0.05); base.y = Math.max(base.y, terrainHeight(base.x, base.z) + 0.02);
    const here = s.root.position.clone();
    s.follow([{ p: here, n: UPV.clone(), s: 'ground' }, g(here.x + 1.2, here.z + 2), g(here.x - 0.8, here.z + 4), g(0.9, base.z - 1.2),
      { p: base.clone(), n: UPV.clone(), s: 'ground' }, { p: base.clone().setY(base.y + 0.15), n: win.normal.clone(), s: 'wall' },
      { p: wallPoint(win, 0.9, win.center.y - 0.3), n: win.normal.clone(), s: 'wall' }, { p: wallPoint(win, 0.1, win.center.y), n: win.normal.clone(), s: 'glass' }], null);
    while (s.path) run(0.25);
    run(0.8);
    // 5. squeeze in through the window, 6. walk across the floor
    phase = 'squeeze';
    s.window = fakeWin;
    s.goInside();
    let guard = 0;
    while (s.state === 'enter' && guard++ < 200) run(0.25);
    player.position.set(2.5, 0, -1);
    phase = 'inside';
    s.state = 'inside';
    run(4);
    out[type + ':' + size] = m;
    s.remove();
  }
  return out;
}, { only, sizeArg });

await browser.close();
server.close();
let total = { frames: 0, snaps: 0, reachErr: 0, clipBody: 0, clipKnee: 0, clipFoot: 0 };
console.log('model:size'.padEnd(22), 'frames snaps maxSnap reachErr clipBody clipKnee clipFoot');
for (const [k, m] of Object.entries(result)) {
  console.log(k.padEnd(22), String(m.frames).padStart(6), String(m.snaps).padStart(5), m.maxSnapDeg.toFixed(0).padStart(7), String(m.reachErr).padStart(8), String(m.clipBody).padStart(8), String(m.clipKnee).padStart(8), String(m.clipFoot).padStart(8));
  for (const key of Object.keys(total)) total[key] += m[key];
  if (process.env.LOCO_DEBUG) console.log('   ', JSON.stringify(m.byPhase));
}
// per-leg-frame rates (8 legs)
const lf = total.frames * 8;
const rate = (x, n) => (100 * x / n).toFixed(2) + '%';
console.log(`\nsnaps ${rate(total.snaps, lf * 5)} of joint-frames, reach errors ${rate(total.reachErr, lf)}, knees in walls ${rate(total.clipKnee, lf)}, feet in walls ${rate(total.clipFoot, lf)}, body in walls ${rate(total.clipBody, total.frames)}`);
if (errors.length) { console.log('\nPAGE ERRORS:\n' + errors.slice(0, 5).join('\n')); process.exit(1); }
// limits: a guard against getting worse (2026-11-09 baseline: pops ~0.45%, mostly while squeezing through a window)
const fail = total.snaps / (lf * 5) > 0.007 || total.clipBody / total.frames > 0.01 || total.clipKnee / lf > 0.01 || total.clipFoot / lf > 0.005;
console.log(fail ? '\nFAIL: over the limits (pops 0.7%, body 1%, knees 1%, feet 0.5%)' : '\nOK');
process.exit(fail ? 1 : 0);
