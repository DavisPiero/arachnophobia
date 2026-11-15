// Smoke test: loads the game headless at desktop and phone sizes, plays a short scripted scene,
// and fails on any console error or if the core loop does not work.
// Usage: npm test            (screenshots land in shots/)
//        node tests/smoke.mjs https://davispiero.github.io/arachnophobia/   (test the live site)
//        flags: --full (high-quality desktop, slow), --shots (save screenshots), --verbose (list every check)
import { chromium } from 'playwright';
import { watchdog } from '../tools/watchdog.mjs';
const dog = watchdog(240, 'smoke');
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
dog.browser = browser;
let failures = 0;
// Prints only failures (and a one-line summary) so the output stays short.
const check = (ok, msg) => { if (!ok) { console.log(`  FAIL ${msg}`); failures++; } else if (process.argv.includes('--verbose')) console.log(`  ok   ${msg}`); };

// desktop and phone run side by side (halves the wall time); the menu scene is a third, short check
const menuCheck = (async () => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}index.html?mute=1&menu=1&quality=low`);
  await page.waitForFunction(() => window.game?.state === 'title' && document.getElementById('menu-screen').style.transform.startsWith('matrix3d'), null, { timeout: 60000 }).catch(() => {});
  const box = await page.locator('#btn-start').boundingBox();
  const box2 = await page.locator('#btn-settings-menu').boundingBox(), panel = await page.locator('#menu-screen').boundingBox();
  check(box && box.x + box.width < 960 * 0.6, `menu buttons sit on the left monitor (${box && Math.round(box.x)})`);
  check(box2 && panel && box2.y + box2.height <= panel.y + panel.height + 1, `all three menu entries fit on the monitor (${box2 && Math.round(box2.y + box2.height)} of ${panel && Math.round(panel.y + panel.height)})`);
  if (process.argv.includes('--shots')) await page.screenshot({ path: 'shots/smoke-menu.png' });
  check(errors.length === 0, `menu: no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
})();
await Promise.all(['desktop', 'phone'].map(async (device) => {
  if (process.argv.includes('--verbose')) console.log(`\n${device}`);
  const ctx = await browser.newContext(device === 'phone'
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 640, height: 360 } });
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

  // the night starts with fists only; a punch lands on a runner inside; the rifle is locked until wave 3
  const f0 = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
    g.waves.timer = 1e9;               // no real waves during the test: they would kill the player and stop the clock
    const r = { held: g.weapon.held, rifleRefused: !g.weapon.select('rifle'), fistsShown: g.weapon.view.fistR.visible };
    g.player.position.set(0, 0, 1.6); g.player.yaw = 0; g.player.pitch = -0.3;
    const s = g.spiders.spawn('climber', 'north', 'medium');
    s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(0, 0, 0.7);
    await simWait(0.2);
    const h0 = s.health; r.punch = g.melee.tryPunch(); await simWait(0.6);
    r.hurt = h0 - s.health; s.die();
    // surviving wave 2 hands over the rifle for wave 3
    g.events.emit('waveEnd', { wave: 2, last: false });
    r.rifleAfter = g.arsenal.has('rifle') && !g.arsenal.has('axe');
    g.arsenal.unlockUpTo(99, false);   // everything, for the rest of the test
    g.weapon.select('rifle'); await simWait(0.6);
    return r;
  });
  check(f0.held === 'fists' && f0.fistsShown, `the night starts with fists (${f0.held})`);
  check(f0.rifleRefused, 'the rifle is locked at the start');
  check(f0.punch && f0.hurt > 5, `a punch hurts a spider (${f0.hurt})`);
  check(f0.rifleAfter, 'surviving wave 2 unlocks the rifle (and not the axe)');

  // walk to the north window, look out, spawn spiders, shoot
  const r = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    g.player.position.set(0, 0, -5.2); g.player.yaw = 0; g.player.pitch = -0.05;
    for (const t of ['runner', 'brute', 'climber', 'stalker']) g.spiders.spawn(t, 'north');
    // headless rendering is slow, so wait on simulated time, not wall time
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
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
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
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

  // milestone 3: lever-action, axe, stomp, kill feedback
  const m3 = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
    g.player.position.set(0, 0, 1.6); g.player.yaw = 0; g.player.pitch = 0;
    await simWait(0.6);
    const view = g.weapon.view;
    const r = { viewAssets: view.usingAssets };
    // the lever cycle blocks a second shot until it is done
    g.weapon.cooldown = 0;
    const m0 = g.weapon.mag; g.weapon.tryFire(); await simWait(0.2);
    r.leverOpen = view.leverPivot.rotation.x;
    g.weapon.tryFire(); r.blocked = g.weapon.mag === m0 - 1;
    await simWait(0.5);
    // axe: a full swing comes back to the rifle
    // weapon switch: 2 brings the axe up, a click swings it, 1 brings the rifle back
    g.weapon.select('axe'); await simWait(0.6);
    r.axeHeld = g.weapon.ready('axe') && view.axe.visible && !view.rifle.visible;
    r.axeStarted = g.melee.tryAxe(); await simWait(0.3); r.axeVisible = view.axe.visible;
    await simWait(0.7); r.axeDone = !g.melee.busy;
    g.weapon.select('rifle'); await simWait(0.6); r.rifleBack = g.weapon.ready('rifle') && !view.axe.visible;
    // a runner inside, in front: the stomp kills it, with gore
    const s = g.spiders.spawn('runner', 'north');
    s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(0, 0, 0.75);
    let killed = null; const off = g.events.on?.('spiderKilled', (e) => { killed = e.by; });
    r.stompStarted = g.melee.tryStomp(); await simWait(0.7);
    r.stompKilled = !s.alive; r.killedBy = killed;
    r.splats = g.gore.splats.filter((x) => x.mesh.visible).length;
    r.chunks = g.gore.chunks.pools.reduce((n, p) => n + p.list.length, 0);
    r.models = (g.spiderModels || []).length;
    off?.();
    return r;
  });
  check(m3.viewAssets, 'Blender hands, rifle and axe loaded');
  check(m3.leverOpen > 0.3, `lever opens after a shot (${m3.leverOpen.toFixed(2)} rad)`);
  check(m3.blocked, 'a second shot waits for the lever');
  check(m3.axeHeld, 'pressing 2 puts the axe in your hands');
  check(m3.axeStarted && m3.axeVisible && m3.axeDone, 'the held axe swings');
  check(m3.rifleBack, 'pressing 1 brings the rifle back');
  check(m3.stompStarted && m3.stompKilled && m3.killedBy === 'stomp', `stomp kills a runner on the floor (${m3.killedBy})`);
  check(m3.splats > 0, `kills leave splats (${m3.splats})`);
  check(m3.chunks > 5, `a killed spider bursts into chunks (${m3.chunks})`);
  check(m3.models === 5, `Blender spider models loaded (${m3.models} of 5)`);

  // reload at the table
  const rl = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
    const tp = g.table.position; g.player.position.set(tp.x, 0, tp.z - 0.95); g.player.yaw = Math.PI; g.player.pitch = -0.4;
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

  // shotgun (two shells, reloads from its own box), a flare at the north window, the inventory on I
  const sg = await page.evaluate(async () => {
    const g = window.game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const simWait = async (sec) => { for (let i = 0, n = Math.ceil(sec * 30); i < n; i++) { g.update(1 / 30); if (i % 10 === 9) await wait(0); } };   // steps the clock itself: a busy machine cannot stall it
    const r = {};
    g.weapon.select('shotgun'); await simWait(0.6);
    r.sgShown = g.weapon.view.shotgun.visible && !g.weapon.view.rifle.visible;
    g.weapon.tryFire(); await simWait(0.45); g.weapon.tryFire(); await simWait(0.45);
    r.sgAmmo = g.weapon.ammo.shotgun; r.rifleKept = g.weapon.ammo.rifle;
    const shells = g.table.stocks.shotgun;
    r.reload = g.table.tryStart(); await simWait(2.6);
    r.sgAfter = g.weapon.ammo.shotgun; r.shellsUsed = shells - g.table.stocks.shotgun;
    // a flare thrown at the north window: it burns there and the spiders keep away
    g.player.position.set(0, 0, -4.6); g.player.yaw = 0; g.player.pitch = 0;
    g.weapon.select('flare'); await simWait(0.6);
    const f0 = g.arsenal.flares;
    r.throwWhy = g.flares.tryThrow(); await simWait(0.8);
    r.flared = g.spiders.flared.has('north'); r.flareUsed = f0 - g.arsenal.flares;
    r.picked = g.waves.pickWindow();
    // the inventory: I pauses and shows it; putting the axe on 1 swaps it with what was there
    r.stateBefore = g.state; g.input.press('inventory');
    for (let w0 = performance.now(); !g.inventory.open && performance.now() - w0 < 5000;) await wait(50);   // a busy machine may take a while to draw the next frame
    r.invOpen = g.inventory.open && g.state === 'paused';
    g.inventory.picked = 'axe'; g.inventory.assign(1);
    r.slots = g.arsenal.slots.join(',');
    g.inventory.close(); g.arsenal.resetSlots();
    r.after = g.state;
    g.flares.reset(); g.weapon.select('rifle'); await simWait(0.6);
    return r;
  });
  check(sg.sgShown, 'the shotgun comes up in place of the rifle');
  check(sg.sgAmmo === 0 && sg.rifleKept === 8, `two shotgun shots empty it and leave the rifle loaded (${sg.sgAmmo}, ${sg.rifleKept})`);
  check(sg.reload && sg.sgAfter === 2 && sg.shellsUsed === 2, `the shotgun reloads two shells from the table (${sg.sgAfter}, ${sg.shellsUsed})`);
  check(sg.throwWhy === null && sg.flared && sg.flareUsed === 1, `a flare lands at the north window (${sg.throwWhy}, ${sg.flared})`);
  check(sg.invOpen, `I opens the inventory and pauses (game was ${sg.stateBefore})`);
  check(sg.slots.startsWith('axe,') && sg.slots.includes('fists'), `the inventory remaps a weapon (${sg.slots})`);
  check(sg.after === 'playing', 'closing the inventory resumes play');
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
    const how = await page.evaluate(() => { const g = window.game; return `${g.state}, health ${Math.round(g.player.health)}, input ${g.input.enabled}, wave ${g.waves.phase}`; });
    check(z1 < z0 - 0.3, `joystick moves the player forward (${z0.toFixed(2)} -> ${z1.toFixed(2)}; ${how})`);
    const fire = await page.locator('#btn-fire').boundingBox() || { x: 0, y: 0, width: 0, height: 0 };
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
    await page.waitForFunction(() => !window.game.melee.busy, null, { timeout: 10000 }).catch(() => {});
    // the weapon button (reading AXE while the rifle is up) swaps to the axe and then names the next one; FIRE swings it
    const label0 = await page.locator('#btn-axe').textContent();
    await page.locator('#btn-axe').tap();
    await page.waitForFunction(() => window.game.weapon.ready('axe'), null, { timeout: 5000 }).catch(() => {});
    const label = await page.locator('#btn-axe').textContent();
    check(label0 === 'AXE' && await page.evaluate(() => window.game.weapon.ready('axe')) && label === 'SHOTGUN', `weapon button swaps to the axe (${label0} -> ${label})`);
    await page.locator('#btn-fire').tap();
    await page.waitForFunction(() => window.game.melee.axeT >= 0, null, { timeout: 3000 }).catch(() => {});
    const ax = await page.evaluate(() => { const g = window.game; return { t: g.melee.axeT, st: g.state, dead: g.player.dead, rel: g.weapon.reloading, en: g.input.enabled }; });
    check(ax.t >= 0, `FIRE swings the held axe (${JSON.stringify(ax)})`);
    // game time runs slower than real time in a headless browser: wait for the swing to end, not a fixed time
    await page.waitForFunction(() => !window.game.melee.busy, null, { timeout: 10000 }).catch(() => {});
    await page.locator('#btn-stomp').tap();
    await page.waitForFunction(() => window.game.melee.stompT >= 0, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => window.game.melee.stompT >= 0), 'STOMP button stomps');
    await page.waitForFunction(() => !window.game.melee.busy, null, { timeout: 10000 }).catch(() => {});
    // a double tap must not zoom the page
    await page.touchscreen.tap(600, 200); await page.waitForTimeout(80); await page.touchscreen.tap(600, 200);
    await page.waitForTimeout(300);
    check(await page.evaluate(() => (window.visualViewport?.scale ?? 1) <= 1.01), 'double tap does not zoom the page');
  }

  // stand at a window too long while spiders are out: one springs at you; inside, a leaper leaps and hurts
  const jump = await page.evaluate(async () => {
    const g = window.game, m = g.spiders;
    const { WINDOWS } = await import('./js/world/Layout.js');
    const w = WINDOWS.find((x) => x.id === 'north');
    g.player.position.set(w.center.x - w.normal.x * 0.6, g.player.position.y, w.center.z - w.normal.z * 0.6);
    g.player.yaw = 0; g.player.pitch = 0; g.player.health = 100; g.player.dead = false;
    const far = m.spawn('runner', 'east', 'medium');
    let jumped = false;
    const off = g.events.on('windowJump', () => { jumped = true; });
    m.lingerCD = 0; m.lingerNeed = 0.5; m.lingerT = 0;
    for (let i = 0; i < 90 && !jumped; i++) g.update(1 / 30);
    for (let i = 0; i < 30; i++) g.update(1 / 30);
    off?.();
    const hurtAtWindow = g.player.health < 100;
    // a leaper inside, 4 m away
    for (const s of m.spiders) s.die();
    g.player.position.set(0, g.player.position.y, 2); g.player.health = 100;
    const s = m.spawn('runner', 'north', 'medium');
    s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(0, 0, -2); s.visual.rig.snapFeet();
    s.leapCD = 0; s.cfg = { ...s.cfg, leap: { ...s.cfg.leap, chance: 1000 } };
    let leapt = false;
    for (let i = 0; i < 60; i++) { g.update(1 / 30); if (s.state === 'leap') leapt = true; }
    for (const x of m.spiders) x.die();
    return { jumped, hurtAtWindow, leapt, hurtByLeap: g.player.health < 100 };
  });
  check(jump.jumped && jump.hurtAtWindow, `a spider springs at you when you stay at a window (${JSON.stringify(jump)})`);
  check(jump.leapt && jump.hurtByLeap, 'a leaper inside leaps and hurts');

  // window damage through to breach
  const br = await page.evaluate(async () => {
    const g = window.game;
    // no glass: the planks are the barrier, and the player cannot hurt them (bullets and punches stop at a plank)
    const w = g.windows.byId.west;
    const firstBoard = w.boards[0].health;
    g.melee?.axeHit?.();                                   // a punch at nothing must not touch a window
    for (let i = 0; i < 60 && w.stage < 4; i++) g.windows.damage('west', 10, w.center);
    await new Promise((res) => setTimeout(res, 300));
    return { stage: w.stage, boards: w.boards.length, fallen: w.boards.filter((b) => b.fallen).length, firstBoard };
  });
  check(br.stage === 4 && br.fallen === br.boards, 'window boards torn off one by one reach breach');

  // game modes: Waves never ends, Survival (for now) ends in dawn after its last wave
  const modes = await page.evaluate(() => {
    const g = window.game, W = g.waves;
    const endWave = (mode) => {
      for (const s of g.spiders.spiders) if (s.alive) s.die();
      g.setMode(mode); W.wave = 10; W.phase = 'wave'; W.waveT = 999; W.spawnedThisWave = [];
      W.update(0.01);
      return { phase: W.phase, timer: W.timer };
    };
    const waves = endWave('waves');
    W.timer = 0; W.update(0.01);
    const next = W.wave;
    const survival = endWave('survival');
    for (let i = 0; i < 10; i++) g.update(0.05);
    survival.cycle = g.survival.cycle.phase; survival.state = g.state; survival.dawnTimer = g.dawnTimer || 0;
    return { waves, next, survival, buttons: !!document.getElementById('btn-waves') };
  });
  check(modes.waves.phase === 'calm' && modes.waves.timer === 15 && modes.next === 11, `Waves mode goes on past wave 10 with 15 s breaks (${JSON.stringify(modes.waves)}, next ${modes.next})`);
  check(modes.survival.phase === 'dawn' && modes.survival.cycle === 'dawn' && modes.survival.state === 'playing' && !modes.survival.dawnTimer && modes.buttons,
    `Survival's night ends in dawn and the run goes on into the next day; the menu has both modes (${JSON.stringify(modes.survival)})`);

  // Survival S1: the door opens, you can walk out onto the ground, things lie in the forest, the pack empties at home
  const s1 = await page.evaluate(() => {
    const g = window.game, S = g.survival, p = g.player;
    g.restart(); g.setMode('survival');
    const items = S.pickups.items.length, boards = S.door.boards.visible;
    p.position.set(2.55, 0, 5.2); p.yaw = Math.PI;
    for (let i = 0; i < 30; i++) { g.input.getMove = () => ({ x: 0, y: 1 }); g.update(0.033); }
    const shutZ = p.position.z;
    S.use('door');
    for (let i = 0; i < 120; i++) { g.input.getMove = () => ({ x: 0, y: 1 }); g.update(0.033); }
    const out = { z: p.position.z, y: p.position.y, outside: p.outside };
    S.pickups.pack = ['branches', 'ammo'];
    const logs = g.firewood.logs;
    p.position.set(2.55, 0, 3); g.update(0.033); g.update(0.033);
    delete g.input.getMove;
    const r = { items, boards, shutZ, out, logsGot: g.firewood.logs - logs, pack: S.pickups.pack.length, light: S.light, wavesRun: S.wavesRun };
    g.setMode('waves');
    r.wavesBoards = S.door.boards.visible; r.wavesLeave = p.canLeave;
    return r;
  });
  check(s1.items > 0 && !s1.boards && s1.shutZ < 6, `Survival starts by day with things to gather and an unboarded door that stops you while shut (${JSON.stringify(s1)})`);
  check(s1.out.outside && s1.out.z > 8 && s1.out.y < -0.1, 'Survival: through the open door and down onto the ground outside');
  check(s1.logsGot === 1 && s1.pack === 0 && s1.light === 1 && !s1.wavesRun, 'Survival: back inside, the pack is emptied onto the woodpile; no waves by day');
  check(s1.wavesBoards && !s1.wavesLeave, 'Waves mode keeps the door boarded and you inside');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}).concat(menuCheck));

await browser.close();
server?.close();
console.log(failures ? `${failures} check(s) failed` : `smoke: all checks passed (${((performance.now()) / 1000).toFixed(0)} s)`);
process.exit(failures ? 1 : 0);
