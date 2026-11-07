// Downloads the CC0 texture sets the Blender generators layer into the gun, axe, hands and legs.
// All from ambientCG (https://ambientcg.com), licence CC0 1.0: free for any use, no attribution needed.
// They land in blender/textures/<Id>/ (git-ignored): only the baked results in assets/models/ are committed.
// Usage: node tools/fetch-textures.mjs   (skips sets already there)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const SETS = {
  Wood026: 'walnut (rifle stock and forend)',
  Wood058: 'hickory (axe handle)',
  Metal046B: 'worn dark steel (rifle bluing)',
  Metal038: 'forged iron (axe head)',
  Rubber004: 'butt pad, glove knuckle guard',
  Leather026: 'black leather (boots, glove palm)',
  Leather032: 'dark olive leather (glove patches)',
  Fabric039: 'dark synthetic fabric (glove back)',
  Fabric079: 'ribbed knit (glove and sleeve cuffs)',
  Fabric063: 'olive canvas (trousers, jacket)',
  Ground051: 'mud (boots and trouser hems)',
};

const RES = '2K';
fs.mkdirSync('blender/textures', { recursive: true });
for (const id of Object.keys(SETS)) {
  const dir = `blender/textures/${id}`;
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.includes('_Color'))) { console.log(`have ${id}`); continue; }
  fs.mkdirSync(dir, { recursive: true });
  const zip = `${dir}/${id}.zip`;
  const url = `https://ambientcg.com/get?file=${id}_${RES}-JPG.zip`;
  console.log(`get  ${id}  (${SETS[id]})`);
  let r = spawnSync('curl', ['-sSfL', '-o', zip, url], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`  download failed: ${url}`); process.exit(1); }
  r = spawnSync('unzip', ['-oq', zip, '*.jpg', '-d', dir], { stdio: 'inherit' });
  fs.rmSync(zip);
  if (r.status !== 0) { console.error(`  unzip failed for ${id}`); process.exit(1); }
}
