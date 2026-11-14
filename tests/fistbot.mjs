// Fists bot: plays waves 1–2 (fists only, the start of the night) headless and fast, by stepping the game clock
// itself instead of waiting on rendering. It walks up to whatever got in and punches it (stomps the small ones),
// bandages when hurt. It positions perfectly, so treat its damage taken as a best case.
// Usage: node tests/fistbot.mjs [waves=2] [difficulty=normal]
import { chromium } from 'playwright';
import { watchdog } from '../tools/watchdog.mjs';
const dog = watchdog(300, 'fistbot');
import { startServer } from '../tools/serve.mjs';

const waves = Number(process.argv[2] || 2);
const difficulty = process.argv[3] || 'normal';
const port = 8600 + Math.floor(Math.random() * 90);
const server = await startServer(port);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
dog.browser = browser;
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/index.html?mute=1&autostart=1&quality=low`);
await page.waitForFunction(() => window.game?.state === 'playing', null, { timeout: 60000 });

const result = await page.evaluate(async ({ waves, difficulty }) => {
  const g = window.game;
  g.loop = () => {};                          // stop rendering: the bot drives the clock
  const { Settings } = await import('./js/core/Settings.js');
  Settings.difficulty = difficulty;
  g.waves.timer = 2;
  const log = [];
  let minHealth = 100, punches = 0, stomps = 0, bandages = 0;
  g.events.on('waveStart', ({ wave }) => log.push(`t=${g.time.toFixed(0)} wave ${wave} (${g.waves.queue.length} spiders: ${g.waves.queue.join(' ')})`));
  g.events.on('waveEnd', ({ wave }) => log.push(`t=${g.time.toFixed(0)} wave ${wave} survived, health ${Math.round(g.player.health)}`));
  g.events.on('windowBreached', ({ id }) => log.push(`t=${g.time.toFixed(0)} ${id} breached`));
  g.events.on('spiderKilled', ({ spider, by }) => log.push(`t=${g.time.toFixed(0)} killed ${spider.size} ${spider.type} (${by})`));
  const dt = 1 / 30;
  let think = 0;
  const done = () => g.player.dead || g.waves.phase === 'dawn' || (g.waves.wave > waves) || (g.waves.wave === waves && g.waves.inBreak);
  for (let i = 0; i < 30 * 60 * 12 && !done(); i++) {
    g.update(dt);
    minHealth = Math.min(minHealth, g.player.health);
    if ((think -= dt) > 0) continue;
    think = 0.1;
    if (g.player.health < 60 && g.healing.bandages > 0 && g.healing.tryBandage() === true) bandages++;
    const inside = g.spiders.spiders.filter((s) => s.alive && s.state === 'inside');
    if (!inside.length) { g.player.position.set(0, 0, 0.5); continue; }
    const p = g.player.position;
    inside.sort((a, b) => a.root.position.distanceTo(p) - b.root.position.distanceTo(p));
    const s = inside[0], sp = s.root.position;
    // stand 1 m from it, on its side towards the middle of the room
    const dx = -sp.x, dz = -sp.z, l = Math.hypot(dx, dz) || 1;
    p.set(sp.x + dx / l * 1.0, 0, sp.z + dz / l * 1.0);
    const c = s.visual.hitbox.getWorldPosition(g.camera.position.clone());
    g.player.yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
    g.player.pitch = Math.atan2(c.y - 1.65, Math.hypot(c.x - p.x, c.z - p.z));
    g.player.update(0.0001, g.input);
    if (s.size === 'small' || s.type === 'runner') { if (g.melee.tryStomp()) stomps++; }
    else if (g.melee.tryPunch()) punches++;
  }
  return { wave: g.waves.wave, phase: g.waves.phase, dead: g.player.dead, health: Math.round(g.player.health), minHealth: Math.round(minHealth),
    punches, stomps, bandages, simTime: Math.round(g.time), windows: g.windows.windows.map((w) => `${w.id}:${w.stage}`), log };
}, { waves, difficulty });

console.log(JSON.stringify(result, null, 1));
console.log(errors.length ? `ERRORS: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
