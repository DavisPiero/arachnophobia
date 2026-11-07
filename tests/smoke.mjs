// Smoke test: loads the game headless at desktop and phone sizes, plays a short scripted scene,
// and fails on any console error or if the core loop does not work.
// Usage: npm test            (screenshots land in shots/)
//        node tests/smoke.mjs https://davispiero.github.io/arachnophobia/   (test the live site)
//        flags: --full (high-quality desktop, slow), --shots (save screenshots), --verbose (list every check)
import { chromium } from 'playwright';
import { startServer } from '../tools/serve.mjs';
import fs from 'node:fs';

const remote = process.argv.slice(2).find((a) => a.startsWith('http'));
let server = null, base = remote;
if (!remote) {
  const port = 8700 + Math.floor(Math.random() * 200);
  server = await startServer(port);
  base = `http://localhost:${port}/`;
}
fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
// Prints only failures (and a one-line summary) so the output stays short.
const check = (ok, msg) => { if (!ok) { console.log(`  FAIL ${msg}`); failures++; } else if (process.argv.includes('--verbose')) console.log(`  ok   ${msg}`); };

for (const device of ['desktop', 'phone']) {
  if (process.argv.includes('--verbose')) console.log(`\n${device}`);
  const ctx = await browser.newContext(device === 'phone'
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // Low quality and small viewports keep headless (CPU) rendering fast; this tests behaviour, not looks.
  // Pass --full to test the high-quality desktop renderer too.
  const q = device === 'desktop' && process.argv.includes('--full') ? 'high' : 'low';
  await page.goto(`${base}index.html?mute=1&autostart=1&quality=${q}`);
  await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 60000 }).catch(() => {});
  check(await page.evaluate(() => window.game?.state === 'playing'), 'game starts and reaches the playing state');
  check(await page.evaluate(() => document.body.classList.contains('touch')) === (device === 'phone'), 'touch controls only on touch devices');

  // walk to the north window, look out, spawn spiders, shoot
  const r = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    g.player.position.set(0, 0, -3.2); g.player.yaw = 0; g.player.pitch = -0.05;
    for (const t of ['runner', 'brute', 'climber', 'stalker']) g.spiders.spawn(t, 'north');
    // headless rendering is slow, so wait on simulated time, not wall time
    const simWait = async (sec) => { const t0 = g.time; while (g.time - t0 < sec) await wait(50); };
    await simWait(2.5);
    const before = g.weapon.mag;
    g.weapon.tryFire();
    await simWait(0.4);
    const near = g.windows.byId.north.closeness;
    const far = g.windows.byId.east.closeness;
    const fps = g.renderer.info.render.frame / Math.max(1, performance.now() / 1000);
    return { fired: before - g.weapon.mag, near, far, spiders: g.spiders.aliveCount, fps };
  });
  check(r.fired === 1, 'weapon fires and uses a round');
  check(r.near > 0.6 && r.far < 0.4, `player is close to the near window (${r.near?.toFixed(2)}), not the far one (${r.far?.toFixed(2)})`);
  check(r.spiders >= 3, `spiders spawned and alive (${r.spiders})`);
  if (process.argv.includes('--shots')) await page.screenshot({ path: `shots/smoke-${device}-window.png` });

  // milestone 2: Blender assets, flashlight, aim down sights, sprint
  const m2 = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { const t0 = g.time; while (g.time - t0 < sec) await wait(50); };
    g.player.position.set(0, 0, 1.5); g.player.yaw = 0; g.player.pitch = 0;
    g.flashlight.toggle();
    g.input.aimHeld = true;
    await simWait(0.6);
    const torch = g.flashlight.spot.intensity, aimK = g.weapon.aimK, fovRatio = g.camera.fov / g.baseFov;
    g.input.aimHeld = false; g.flashlight.toggle();
    const kb = g.input.keyboard; kb.keys.add('KeyW'); kb.keys.add('ShiftLeft'); kb.update();
    await simWait(0.5);
    const runSpeed = Math.hypot(g.player.velocity.x, g.player.velocity.z), sprinting = g.player.sprinting;
    kb.keys.clear(); kb.update();
    await simWait(0.3);
    return { assets: g.world.assetsUsed.slice(), torch, aimK, fovRatio, runSpeed, sprinting, walk: 2.6 };
  });
  check(m2.assets.includes('rocks'), `Blender rocks loaded (${m2.assets.join(', ') || 'none'})`);
  check(m2.torch > 1, `flashlight turns on (${m2.torch.toFixed(1)})`);
  check(m2.aimK > 0.9 && m2.fovRatio < 0.8, `aim down sights zooms in (aim ${m2.aimK.toFixed(2)}, fov x${m2.fovRatio.toFixed(2)})`);
  check(m2.sprinting && m2.runSpeed > m2.walk * 1.4, `Shift sprints (${m2.runSpeed.toFixed(2)} m/s)`);

  // reload at the table
  const rl = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { const t0 = g.time; while (g.time - t0 < sec) await wait(50); };
    g.player.position.set(-1.1, 0, 2.5); g.player.yaw = Math.PI; g.player.pitch = -0.4;
    await wait(300);
    const stockBefore = g.table.stock;
    const started = g.table.tryStart();
    await simWait(1.2);
    const lockedDuring = g.player.locked;
    await simWait(2.6);
    return { started, lockedDuring, mag: g.weapon.mag, stockBefore, stockAfter: g.table.stock };
  });
  check(rl.started && rl.lockedDuring, 'reload starts at the table and locks movement');
  check(rl.mag === 8 && rl.stockAfter < rl.stockBefore, `reload refills the magazine from the table (${rl.stockBefore} -> ${rl.stockAfter})`);
  if (process.argv.includes('--shots')) await page.screenshot({ path: `shots/smoke-${device}-table.png` });

  if (device === 'phone') {
    // drag the left joystick forward and press FIRE, as a thumb would
    await page.evaluate(() => { const g = window.game; g.player.position.set(0, 0, 1); g.player.yaw = 0; });
    const z0 = await page.evaluate(() => window.game.player.position.z);
    await page.mouse.move(150, 260); await page.mouse.down();
    await page.mouse.move(150, 200, { steps: 4 });
    await page.waitForFunction((z) => window.game.player.position.z < z - 0.3, z0, { timeout: 30000 }).catch(() => {});
    await page.mouse.up();
    const z1 = await page.evaluate(() => window.game.player.position.z);
    check(z1 < z0 - 0.3, `joystick moves the player forward (${z0.toFixed(2)} -> ${z1.toFixed(2)})`);
    const fire = await page.locator('#btn-fire').boundingBox();
    const m0 = await page.evaluate(() => window.game.weapon.mag);
    await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2); await page.mouse.down();
    await page.waitForTimeout(800); await page.mouse.up();
    const m1 = await page.evaluate(() => window.game.weapon.mag);
    check(m1 === m0 - 1, `FIRE button shoots (${m0} -> ${m1})`);
    await page.locator('#btn-torch').tap(); await page.waitForTimeout(400);
    check(await page.evaluate(() => window.game.flashlight.on), 'LIGHT button turns the flashlight on');
    await page.locator('#btn-aim').tap();
    check(await page.evaluate(() => window.game.input.aim), 'AIM button toggles aiming');
    await page.locator('#btn-aim').tap();
    // a double tap must not zoom the page
    await page.touchscreen.tap(600, 200); await page.waitForTimeout(80); await page.touchscreen.tap(600, 200);
    await page.waitForTimeout(300);
    check(await page.evaluate(() => (window.visualViewport?.scale ?? 1) <= 1.01), 'double tap does not zoom the page');
  }

  // window damage through to breach
  const br = await page.evaluate(async () => {
    const g = window.game;
    for (let i = 0; i < 12; i++) g.windows.damage('west', 10);
    await new Promise((res) => setTimeout(res, 300));
    return g.windows.byId.west.stage;
  });
  check(br === 4, 'window damage reaches breach');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

await browser.close();
server?.close();
console.log(failures ? `${failures} check(s) failed` : `smoke: all checks passed (${((performance.now()) / 1000).toFixed(0)} s)`);
process.exit(failures ? 1 : 0);
