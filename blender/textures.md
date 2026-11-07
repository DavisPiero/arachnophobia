# Texture sources

The generators layer these photo-scanned texture sets into the rifle, axe, hands and legs, then bake the result into
each asset's own textures. Only the baked results (`assets/models/*.glb`) are committed; the sets themselves live in
git-ignored `blender/textures/` and are fetched with `node tools/fetch-textures.mjs`.

All from [ambientCG](https://ambientcg.com), licence **CC0 1.0** (public domain: free for any use, no attribution needed).

| Set | Used for |
|---|---|
| Wood026 | walnut: rifle stock and forend |
| Wood058 | hickory: axe handle |
| Metal046B | worn dark steel: rifle bluing, bolt, axe edge |
| Metal038 | forged iron: axe head |
| Rubber004 | butt pad, glove knuckle guard, boot soles |
| Leather026 | black leather: boots, belt |
| Leather032 | dark olive leather: glove palms |
| Fabric039 | dark synthetic fabric: glove backs |
| Fabric079 | ribbed knit: glove and sleeve cuffs |
| Fabric063 | olive canvas: trousers, jacket, sleeves |
| Ground051 | mud and grime |
