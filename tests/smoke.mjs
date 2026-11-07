// Smoke test: loads the game headless at desktop and phone sizes, plays a short scripted scene,
// and fails on any console error or if the core loop does not work.
// Usage: npm test            (screenshots land in shots/)
//        node tests/smoke.mjs https://davispiero.github.io/arachnophobia/   (test the live site)
import { chromium } from 'playwright';
import { startServer } from '../tools/serve.mjs';
import fs from 'node:fs';

const remote = process.argv[2];
let server = null, base = remote;
if (!remote) {
  const port = 8700 + Math.floor(Math.random() * 200);
  server = await startServer(port);
  base = `http://localhost:${port}/`;
}
fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) failures++; };

for (const device of ['desktop', 'phone']) {
  console.log(`\n${device}`);
  const ctx = await browser.newContext(device === 'phone'
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}index.html?mute=1&autostart=1`);
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
    const veil = g.windows.byId.north.opacity;
    const farVeil = g.windows.byId.east.opacity;
    const fps = g.renderer.info.render.frame / Math.max(1, performance.now() / 1000);
    return { fired: before - g.weapon.mag, veil, farVeil, spiders: g.spiders.aliveCount, fps };
  });
  console.log(`  (headless fps ~${r.fps.toFixed(1)})`);
  check(r.fired === 1, 'weapon fires and uses a round');
  check(r.veil < 0.5 && r.farVeil > 0.8, `window near is clear (${r.veil.toFixed(2)}), far window dark (${r.farVeil.toFixed(2)})`);
  check(r.spiders >= 3, `spiders spawned and alive (${r.spiders})`);
  await page.screenshot({ path: `shots/smoke-${device}-window.png` });

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
  await page.screenshot({ path: `shots/smoke-${device}-table.png` });

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
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
