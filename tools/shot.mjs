// Headless screenshot helper. Never opens a visible window.
// Usage: node tools/shot.mjs <page-path> <out.png> [--mobile] [--wait=ms] [--eval="js to run after load"]
// Example: node tools/shot.mjs "index.html?mute=1&autostart=1" shots/game.png --wait=4000
// Prints console errors from the page. Exit code 1 if any page error happened.
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pagePath = args[0] || 'index.html?mute=1';
const out = args[1] || 'shots/shot.png';
const mobile = args.includes('--mobile');
const wait = Number((args.find((a) => a.startsWith('--wait=')) || '--wait=3000').slice(7));
const evalArg = args.find((a) => a.startsWith('--eval='));
const port = 8200 + Math.floor(Math.random() * 500);

const server = await startServer(port);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
let errors = 0;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { console.log(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors++; } });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); errors++; });
await page.goto(`http://localhost:${port}/${pagePath}`);
await page.waitForTimeout(wait);
if (evalArg) {
  const r = await page.evaluate(evalArg.slice(7));
  if (r !== undefined) console.log('eval:', JSON.stringify(r));
  await page.waitForTimeout(500);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
server.close();
process.exit(errors ? 1 : 0);
