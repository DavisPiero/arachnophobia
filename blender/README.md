# Blender asset pipeline

One command rebuilds every model the game loads:

```bash
npm run assets            # all families
npm run assets rocks      # just one
npm run assets -- --no-blender   # only re-shrink files already exported
```

Blender runs in the background (no window). Needs Blender 5.2 at `/Applications/Blender.app`, or set `BLENDER=/path/to/blender`.

## How a family is made

```
assets/params/<name>.json   numbers you tune (shape, colour, budgets)  ── also read by the game
        │
blender/generators/<name>.py   builds a HIGH mesh (all the detail) and a LOW mesh (few triangles),
        │                       bakes colour, normals, roughness and ambient occlusion from high onto low
        ▼
blender/build/<name>.glb     raw export (git-ignored)
        │  tools/assets.mjs: textures -> WebP at budget.gameTexture, geometry -> meshopt
        ▼
assets/models/<name>.glb     what the game loads (committed; GitHub Pages serves it)
```

Each family exports meshes named `<thing>_<n>` (desktop) and `<thing>_<n>_lod1` (phones and far away).
The game keeps its old code-made model as a fallback: a missing or broken file never stops the game.
`?assets=0` in the game URL switches all Blender assets off, to compare.

## Seeing the result

`dev/assets.html?model=rocks` shows every mesh in a file. Add `&lod=1` for the phone versions, `&night=1` for moonlight.
Each generator also writes a quick preview render to `blender/build/<name>_preview.png` (rifle, hands, axe).
`node tools/poses.mjs` screenshots every first-person pose in the running game (hip, aim, lever, reload, axe, stomp, kill).

## Editing by hand

1. Run the generator once, then open `blender/build/<name>.glb` in Blender (File → Import → glTF).
2. Sculpt, paint, re-shape. Keep the mesh names.
3. Export to `blender/source/<name>.glb` (File → Export → glTF Binary).
4. `npm run assets <name>`: your file now wins over the generator for that family.

Delete the file in `blender/source/` to go back to the generated version.

## Budgets

| | Desktop mesh | Phone mesh | Texture in game | File |
|---|---|---|---|---|
| Rock | 650 tris | 180 tris | 2048 atlas shared by all variants, plus a tiling grain texture in the game | < 2 MB |
| Rifle (always on screen) | ~12 000 tris all parts | ~50 % | 4096 atlas (phones 2048) | < 5 MB |
| Hands and sleeves | ~7 300 tris per arm | ~50 % | 4096 atlas (phones 2048) | < 5 MB |
| Axe | ~4 300 tris | ~50 % | 2048 (phones 1024) | < 5 MB |
| Spiders (one file per species) | runner ~5 000, climber/stalker ~10 000, brute ~18 000 (skinned) | ~50 % | 2048 (phones 1024) | < 4 MB |
| Whole game | | | | < 25 MB |

Hands (~8.5 MB) and rifle (~5.2 MB) are allowed over the 5 MB per-file mark (`budget.maxKB`): they fill the screen. Phones (the `low` quality tier) load `<name>_low.glb`: the same meshes with `budget.lowTexture`-size textures.

Texture compression per family: `budget.webpQuality` for colour and roughness, `budget.normalQuality` for the normal map
(normal maps soften badly under lossy WebP, so they get a higher quality).

Rule of thumb: put detail in the baked normal map, not in triangles. Families share one texture atlas so the game draws
all variants of a family with very few draw calls.

## Families

| Family | Variation controls (`assets/params/…json`) |
|---|---|
| rocks | `variants`, `seed`; shape: irregularity, lumpScale, flatness, elongation, fractures, fractureDepth; surface: detail, cracks; uv: angleLimit (higher = fewer, bigger islands); look: stone colours, moss amount, wetness; game: detail grain repeat/strength |
| rifle | barrel, tube, receiver, forend, stock shapes; lever (pivot, loop size) and hammer; sights line; muzzle, eject port, loading gate; grips (where the hands go); `view` (where the rifle sits in front of the eye); look: walnut, bluing, worn steel, bolt, rubber, brass |
| hands | a hand skeleton (knuckles, finger bones, thumb) and poses: `grip` wraps the fingers round what is held, `pinch` holds a round; per pose the forearm direction, which way the back of the hand faces, where the thumb rests, the held shape (`stock` = the real rifle wrist); sleeve shape; look: glove panels, guard, sleeve |
| axe | handle length, shape and curve; head size, poll, beard, edge; look: hickory, grime, forge scale, ground edge |
| spiders | per species (`SPECIES.md`): `rig` (body and leg sizes, leg angles and lengths, stance, gait: shared with the game's leg code), `shape` (leg thickness and joints, eyes, face plate, quills), `look` (scan set, colours, mottling, speckles, bands, belly, joints). One `.glb` + `.json` (layout and rest pose) per species; `SPIDERS=runner npm run assets spiders` builds just one |

Materials (`blender/lib/materials.py`) layer CC0 photo-scanned sets (`blender/textures.md`): projected from three sides
along each part's long axis, re-tinted to the parameter file's colour, with bump detail (checkering, stitching, ribs),
worn edges and dirt in the creases, then baked.

## Check tools

- `ASSET_FAST=1 npm run assets <name>`: a small, quick bake for iterating on shapes (never commit a fast build).
- `Blender -b --factory-startup -P blender/tools/viewmodel.py -- hip|aim|axe [out.png]`: the first-person layout as
  the game places it, evenly lit (the game is too dark to judge models). `-- arm_grip_r out.png x,y,z` shows one arm;
  `VM_EYE=x,y,z VM_AT=x,y,z` moves the camera.
- `Blender -b --factory-startup -P blender/tools/clipcheck.py`: lists any hand vertex inside the rifle. Run it after
  every hands or rifle change.
- `HANDS_DEBUG=1 npm run assets hands`: each hand from the back, the thumb side and the palm (`blender/build/dbg_*`).

The rifle, hands and axe files share one coordinate space (GAME space: x right, y up, z towards the player, metres), so the
game can put the hands exactly where the parameter files say. Moving a grip or pivot in the JSON moves it in both.

Spiders are skinned: one smooth mesh per species on 58 bones (body, abdomen, fangs, palps, 8 legs x 6), weighted
smoothly across each joint. The game ignores the glTF's own bones and rebuilds the skeleton from
`assets/models/spider_<species>.json`, so its leg code moves exactly the bones Blender built the mesh around.

Coming next: the other five spider species, trees, foliage and cabin pieces (milestone 6).
