// Brightness check: the phone tier must not render the gun, the hands or a spider much darker than desktop.
// (User notes, several times: the night is too dark, the far end of the room is dark, and on phones the spiders,
// hands and weapons render pitch black.) Measures mean brightness (0..255) of fixed screen regions in a fixed scene
// on both tiers, at the same small viewport, and compares them.
// Usage: node tests/brightness.mjs [--shots]
import { chromium } from 'playwright';
import { startServer } from '../tools/serve.mjs';
import fs from 'node:fs';

const port = 8900 + Math.floor(Math.random() * 90);
const server = await startServer(port);
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// floors: below these a region reads as black on a dim phone screen
// set 2026-11-10 just under the fixed values (gun 15, spider 22.5, room 16); before the fix: gun 4.7, spider 19, room 14
const FLOOR = { gun: 12, spider: 21, room: 14 };   // gun: mean over the pixels the hands and gun cover
const LOW_VS_HIGH = 0.85;   // the phone tier keeps at least this share of desktop's brightness

async function measure(tier) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}index.html?mute=1&autostart=1&quality=${tier}`);
  await page.waitForFunction(() => window.game && window.game.state === 'playing', null, { timeout: 90000 });
  const out = await page.evaluate(async () => {
    const g = window.game;
    // a fixed scene: standing mid-room facing north, the lantern behind, one spider on the floor 2.4 m ahead
    g.waves.update = () => {};
    g.player.position.set(0, g.player.position.y, 2.2);
    g.player.yaw = 0; g.player.pitch = -0.12;
    const s = g.spiders.spawn('brute', 'north', 'medium');
    s.state = 'inside'; s.surface = 'floor'; s.path = null; s.update = () => {};
    s.root.position.set(0.4, 0, -0.2); s.root.rotation.y = 0;
    s.visual.rig?.snapFeet?.();
    for (let i = 0; i < 40; i++) { g.update(1 / 30); }
    g.flashlight.on = false;
    g.postfx.setOptions({ effects: false, brightness: 1 });   // measure the lighting, not the grain and vignette
    await new Promise((r) => setTimeout(r, 300));
    // render and read back in the same task (the drawing buffer is not preserved)
    g.postfx.render(1 / 30, {});
    const c = g.renderer.domElement;
    const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
    const x = cv.getContext('2d'); x.drawImage(c, 0, 0);
    const W = cv.width, H = cv.height;
    const region = (x0, y0, x1, y1) => {
      const d = x.getImageData(Math.round(x0 * W), Math.round(y0 * H), Math.round((x1 - x0) * W), Math.round((y1 - y0) * H)).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return s / (d.length / 4);
    };
    // the spider's screen box from its world position
    const p = s.root.position.clone(); p.y += 0.3; p.project(g.camera);
    const sx = (p.x + 1) / 2, sy = (1 - p.y) / 2;
    const room = region(0, 0, 1, 1), spider = region(sx - 0.07, sy - 0.07, sx + 0.07, sy + 0.07);
    const png = cv.toDataURL('image/png');
    // the hands and gun alone: hide the world, render, and average only the pixels they cover
    const bg = g.scene.background;
    g.scene.visible = false; g.scene.background = null;
    g.renderer.setClearColor(0x000000, 1);
    g.postfx.render(1 / 30, {});
    x.clearRect(0, 0, W, H); x.drawImage(c, 0, 0);
    g.scene.visible = true; g.scene.background = bg;
    const d = x.getImageData(0, 0, W, H).data;
    let gs = 0, gn = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (l > 0.5) { gs += l; gn++; } }
    return {
      gun: gn ? gs / gn : 0, room, spider, png,
    };
    return {
      gun: region(0.55, 0.62, 0.95, 1.0),
      spider: region(sx - 0.07, sy - 0.07, sx + 0.07, sy + 0.07),
      room: region(0, 0, 1, 1),
      png: cv.toDataURL('image/png'),
    };
  });
  if (process.argv.includes('--shots')) {
    fs.mkdirSync('shots', { recursive: true });
    fs.writeFileSync(`shots/brightness-${tier}.png`, Buffer.from(out.png.split(',')[1], 'base64'));
  }
  delete out.png;
  await ctx.close();
  if (errors.length) console.log(`  ${tier}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  return out;
}

const high = await measure('high');
const low = await measure('low');
let failures = 0;
const row = (k) => {
  const ok = low[k] >= FLOOR[k] && high[k] >= FLOOR[k] && low[k] >= high[k] * LOW_VS_HIGH;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${k.padEnd(7)} high ${high[k].toFixed(1).padStart(5)}  low ${low[k].toFixed(1).padStart(5)}  (floor ${FLOOR[k]}, low ≥ ${LOW_VS_HIGH}× high)`);
};
console.log('brightness (mean 0..255):');
for (const k of Object.keys(FLOOR)) row(k);
await browser.close();
server.close?.();
console.log(failures ? `brightness: ${failures} failed` : 'brightness: ok');
process.exit(failures ? 1 : 0);
