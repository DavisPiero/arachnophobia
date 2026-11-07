// Soak test: a simple bot plays the game headless for a while (phone settings), so waves, spawning,
// window attacks, reloading and breaches all run for real. Reports what happened and any errors.
// Usage: node tests/soak.mjs [simSeconds=150]
// The bot "teleports" between the table and windows (it tests the game systems, not walking skill).
import { chromium } from 'playwright';
import { startServer } from '../tools/serve.mjs';

const simSeconds = Number(process.argv[2] || 150);
const port = 8900 + Math.floor(Math.random() * 90);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/index.html?mute=1&autostart=1&quality=low`);
await page.waitForFunction(() => window.game?.state === 'playing', null, { timeout: 60000 });
// skip most of the quiet intro
await page.evaluate(() => { window.game.waves.timer = 3; });

const result = await page.evaluate(async (limit) => {
  const g = window.game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const seen = new Set();
  g.events.on('waveStart', ({ wave }) => log.push(`t=${g.time.toFixed(0)} wave ${wave} starts`));
  g.events.on('waveEnd', ({ wave }) => log.push(`t=${g.time.toFixed(0)} wave ${wave} survived (table ${g.table.stock})`));
  g.events.on('windowBreached', ({ id }) => log.push(`t=${g.time.toFixed(0)} ${id} window breached`));
  g.events.on('spiderSpawned', ({ spider }) => seen.add(spider.type));
  let shots = 0, hits = 0, reloads = 0;
  const misses = {};
  let aimState = '';
  g.events.on('shot', ({ hitSpider, hitPoint }) => {
    shots++;
    if (hitSpider) hits++;
    else { const k = `${aimState}:${hitPoint ? 'blocked' : 'air'}`; misses[k] = (misses[k] || 0) + 1; }
  });
  g.events.on('reloadStart', () => reloads++);
  const aimAt = (p) => {
    const c = g.camera.position;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  const start = g.time;
  while (g.time - start < limit && !g.player.dead) {
    await wait(60);
    if (g.table.reloading) continue;
    if (g.weapon.mag === 0 && g.table.stock > 0) {
      { const tp = g.table.position; g.player.position.set(tp.x, 0, tp.z - 0.8); }
      g.table.tryStart();
      continue;
    }
    // most urgent target: inside, then at a window, then closest
    const targets = g.spiders.spiders.filter((s) => s.alive && s.state !== 'hidden' && s.state !== 'vanish');
    const score = (s) => (s.state === 'inside' ? 1000 : s.state === 'attackWindow' ? 500 : 0) - s.distToPlayer;
    targets.sort((a, b) => score(b) - score(a));
    const t = targets[0];
    if (!t) continue;
    if (t.state !== 'inside') {
      if (t.distToPlayer > 25 && t.state !== 'attackWindow') continue; // too far to see; wait
      const w = t.window;
      const stand = w.center.clone().addScaledVector(w.normal, -0.75);
      g.player.position.set(stand.x, 0, stand.z);
    }
    const hp = t.visual.hitbox.getWorldPosition(g.camera.position.clone());
    aimAt(hp);
    await wait(250); // let recoil settle, like a person would
    aimAt(t.visual.hitbox.getWorldPosition(g.camera.position.clone()));
    await wait(40);
    aimState = `${t.type}-${t.state}`;
    if (g.weapon.cooldown <= 0) g.weapon.tryFire();
  }
  return {
    simTime: Math.round(g.time - start), wave: g.waves.wave, kills: g.kills, health: Math.round(g.player.health),
    dead: g.player.dead, shots, hits, misses, reloads, tableLeft: g.table.stock, types: [...seen],
    windows: g.windows.windows.map((w) => `${w.id}:${w.stage}`), log,
  };
}, simSeconds);

console.log(JSON.stringify(result, null, 2));
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 8).join('\n')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
