// Tiny static file server for local play and tests. No dependencies.
// Usage: npm start            -> http://localhost:8173
//        PORT=9000 npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

export function startServer(p = port) {
  const server = http.createServer((req, res) => {
    // the placement tool (dev/place.html) saves here: only this one file, only numbers it knows
    if (req.method === 'POST' && req.url === '/save-placement') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4000) req.destroy(); });
      req.on('end', () => {
        try {
          const p = JSON.parse(body), n = (v) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error('bad number'); return v; };
          const clean = {
            table: { x: n(p.table.x), length: n(p.table.length) },
            clock: { x: n(p.clock.x), y: n(p.clock.y), radius: n(p.clock.radius) },
            med: { x: n(p.med.x) },
            lantern: { x: n(p.lantern.x), z: n(p.lantern.z) },
          };
          const head = fs.readFileSync(path.join(root, 'js/world/placement.js'), 'utf8').split('export const PLACEMENT')[0];
          const rows = Object.entries(clean).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,/g, ', ').replace(/:/g, ': ').replace(/^\{/, '{ ').replace(/\}$/, ' }')}`);
          fs.writeFileSync(path.join(root, 'js/world/placement.js'), `${head}export const PLACEMENT = {\n${rows.join(',\n')}\n};\n`);
          res.writeHead(200); res.end('ok');
        } catch (e) { res.writeHead(400); res.end(String(e.message)); }
      });
      return;
    }
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(root, urlPath);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(p, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`ARACHNOPHOBIA running at http://localhost:${port}  (add ?mute=1 for silence)`));
}
