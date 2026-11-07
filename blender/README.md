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
| Rifle (always on screen) | ~1500 tris all parts | ~55 % | 2048 atlas | < 2 MB |
| Hands, sleeves, boot | ~1900 tris per arm | ~50 % | 2048 atlas | < 2 MB |
| Axe | ~500 tris | ~55 % | 1024 | < 2 MB |
| Whole game | | | | < 25 MB |

Texture compression per family: `budget.webpQuality` for colour and roughness, `budget.normalQuality` for the normal map
(normal maps soften badly under lossy WebP, so they get a higher quality).

Rule of thumb: put detail in the baked normal map, not in triangles. Families share one texture atlas so the game draws
all variants of a family with very few draw calls.

## Families

| Family | Variation controls (`assets/params/…json`) |
|---|---|
| rocks | `variants`, `seed`; shape: irregularity, lumpScale, flatness, elongation, fractures, fractureDepth; surface: detail, cracks; uv: angleLimit (higher = fewer, bigger islands); look: stone colours, moss amount, wetness; game: detail grain repeat/strength |
| rifle | barrel, tube, receiver, forend, stock shapes; lever and hammer pivots and angles; sights line; muzzle, eject port, loading gate; grips (where the hands go); look: walnut, bluing, bare-steel wear |
| hands | finger and thumb sizes, grip radius (rifle wrist, axe handle), forearm direction per pose, sleeve size and folds; look: glove, sleeve, boot, trousers colours |
| axe | handle length, shape and curve; head size, poll, edge; look: hickory colours, rust |

The rifle, hands and axe files share one coordinate space (GAME space: x right, y up, z towards the player, metres), so the
game can put the hands exactly where the parameter files say. Moving a grip or pivot in the JSON moves it in both.

Coming next: nine spider species (milestone 4), trees, foliage and cabin pieces (milestone 6).
