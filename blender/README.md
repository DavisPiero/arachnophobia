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

## Editing by hand

1. Run the generator once, then open `blender/build/<name>.glb` in Blender (File → Import → glTF).
2. Sculpt, paint, re-shape. Keep the mesh names.
3. Export to `blender/source/<name>.glb` (File → Export → glTF Binary).
4. `npm run assets <name>`: your file now wins over the generator for that family.

Delete the file in `blender/source/` to go back to the generated version.

## Budgets

| | Desktop mesh | Phone mesh | Texture in game | File |
|---|---|---|---|---|
| Rock | 650 tris | 180 tris | 1024 atlas, shared by all variants | < 2 MB |
| Whole game | | | | < 25 MB |

Rule of thumb: put detail in the baked normal map, not in triangles. Families share one texture atlas so the game draws
all variants of a family with very few draw calls.

## Families

| Family | Variation controls (`assets/params/…json`) |
|---|---|
| rocks | `variants`, `seed`; shape: irregularity, lumpScale, flatness, elongation, fractures, fractureDepth; surface: detail, cracks; look: stone colours, moss amount, wetness |

Coming next: weapons and hands (milestone 3), nine spider species (milestone 4), trees, foliage and cabin pieces (milestone 6).
