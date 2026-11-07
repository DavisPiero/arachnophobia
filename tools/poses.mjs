// Headless screenshots of every first-person pose in one session (cheaper than one browser per shot).
// Usage: node tools/poses.mjs [outDir=shots/poses] [--mobile] [--only=name,name]
// Poses: hip, aim, lever, reload, axe1/axe/axe3 (wind-up, strike, follow-through), stomp, kill. Drives the game through window.game; never opens a window.
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || 'shots/poses';
const mobile = args.includes('--mobile');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const port = 8200 + Math.floor(Math.random() * 500);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
await page.goto(`http://localhost:${port}/index.html?mute=1&autostart=1&quality=${mobile ? 'low' : 'high'}`);
await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 60000 });
await page.waitForTimeout(2500);

// real time passes in the page; advance the game clock by hand for exact moments
const freeze = () => page.evaluate(() => { const g = window.game; g._loop = g.loop; g.loop = () => {}; });
const step = (sec, n = 1) => page.evaluate(([sec, n]) => { const g = window.game; for (let i = 0; i < n; i++) g.update(sec / n); g.postfx.render(sec, { hurt: 0, lowHealth: 0 }); }, [sec, n]);
await freeze();
await page.waitForTimeout(300);
await page.evaluate(() => { const g = window.game; g.player.position.set(0.3, 0, 1.2); g.player.yaw = 0.35; g.player.pitch = -0.08; });

const poses = {
  hip: async () => { await step(0.5, 10); },
  aim: async () => { await page.evaluate(() => { window.game.input.aimHeld = true; }); await step(0.6, 12); await page.evaluate(() => { window.game.input.aimHeld = false; }); },
  lever: async () => { await step(0.6, 12); await page.evaluate(() => window.game.weapon.tryFire()); await step(0.2, 6); },
  reload: async () => {
    await step(0.6, 12);
    await page.evaluate(() => { const g = window.game; g.weapon.mag = 3; const p = g.table.position; g.player.position.set(p.x, 0, p.z - 0.95); g.player.yaw = Math.PI; g.player.pitch = -0.35; g.table.tryStart(); });
    await step(1.2, 24);
  },
  axe1: async () => { await step(0.8, 16); await page.evaluate(() => window.game.melee.tryAxe()); await step(0.19, 6); },
  axe: async () => { await step(0.8, 16); await page.evaluate(() => window.game.melee.tryAxe()); await step(0.29, 8); },
  axe3: async () => { await step(0.8, 16); await page.evaluate(() => window.game.melee.tryAxe()); await step(0.38, 8); },
  stomp: async () => { await step(0.8, 16); await page.evaluate(() => { const g = window.game; g.player.position.set(0.3, 0, 1.2); g.player.pitch = 0; g.melee.tryStomp(); }); await step(0.24, 8); },
  down: async () => { await page.evaluate(() => { window.game.player.pitch = -1.4; }); await step(0.5, 10); },
  kill: async () => {
    await step(0.8, 16);
    await page.evaluate(() => {
      const g = window.game; const T = window.THREE_ || null;
      g.player.position.set(0, 0, 1.6); g.player.yaw = 0; g.player.pitch = -0.52;
      const s = g.spiders.spawn('runner', 'north');
      s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(0, 0, -0.7);
    });
    await step(0.05, 2);
    await page.evaluate(() => {
      // aim straight at the spider's body, then fire
      const g = window.game; const s = g.spiders.spiders[0];
      const c = s.visual.hitbox.getWorldPosition(g.camera.position.clone()); const e = g.camera.position;
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
      g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      g.player.update(0.0001, g.input); g.weapon.cooldown = 0; g.weapon.tryFire();
    });
    await step(0.35, 8);
  },
};
for (const [name, run] of Object.entries(poses)) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate(() => { const g = window.game; g.restart(); g.player.position.set(0.3, 0, 1.2); g.player.yaw = 0.35; g.player.pitch = -0.08; });
  await run();
  await page.screenshot({ path: `${out}/${name}${mobile ? '-phone' : ''}.png` });
  if (args.includes('--debug')) console.log(name, JSON.stringify(await page.evaluate(() => window.game.spiders.spiders.map((s) => ({ t: s.type, st: s.state, a: s.alive, hp: s.health, p: s.root.position.toArray().map((x) => +x.toFixed(2)), vis: s.root.visible, fade: s.fade, dT: s.deadT?.toFixed(2) })))));
  console.log('saved', name);
}
await browser.close();
server.close();
