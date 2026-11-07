// Builds the whole world (cabin, forest, lighting) and wires it to the event bus.
// API (the lead codes against this):
//   buildWorld(scene, renderer, quality, events) -> {
//     cabin:    { group, colliders, floorTypeAt(x, z), ammoTable: { group, supplies }, windowFrames: { north, east, west } },
//     forest:   { group, update(dt, time) },
//     lighting: { lantern, moon, update(dt, time), flash(strength), muzzleFlash(position) },
//     update(dt, time),
//   }
import { initTextures } from './Textures.js';
import { buildLighting } from './Lighting.js';
import { buildCabin } from './Cabin.js';
import { buildForest } from './Forest.js';
import { loadModel, loadParams } from '../core/Assets.js';

export function buildWorld(scene, renderer, quality, events) {
  initTextures(renderer, quality);
  const lighting = buildLighting(scene, renderer, quality);
  const cabin = buildCabin(quality);
  scene.add(cabin.group);
  if (cabin.candle) lighting.addFlame(cabin.candle.light, cabin.candle.sprite);
  const forest = buildForest(scene, quality, lighting);
  scene.add(forest.group);

  if (events) {
    events.on('lightning', (e) => lighting.flash(e && e.strength != null ? e.strength : 1));
    events.on('muzzleFlash', (e) => { if (e && e.position) lighting.muzzleFlash(e.position); });
  }

  const forestUpdate = (dt, time) => forest.update(dt, time, lighting.flashLevel);
  function update(dt, time) {
    lighting.update(dt, time);
    forestUpdate(dt, time);
  }

  // Swap built-in models for Blender ones where a .glb exists. Safe to skip: everything already works without it.
  const used = [];
  async function loadAssets() {
    const [rocks, rockParams] = await Promise.all([loadModel('rocks'), loadParams('rocks')]);
    if (forest.useRocks(rocks, rockParams)) used.push('rocks');
    return used;
  }

  return {
    loadAssets, assetsUsed: used,
    cabin: {
      group: cabin.group,
      colliders: cabin.colliders,
      floorTypeAt: cabin.floorTypeAt,
      ammoTable: cabin.ammoTable,
      windowFrames: cabin.windowFrames,
      candle: cabin.candle.light,
    },
    forest: { group: forest.group, update: forestUpdate, rain: forest.rain },
    lighting: {
      lantern: lighting.lantern,
      wallLamp: lighting.wallLamp,
      moon: lighting.moon,
      hemi: lighting.hemi,
      update: lighting.update,
      flash: lighting.flash,
      muzzleFlash: lighting.muzzleFlash,
      get flashLevel() { return lighting.flashLevel; },
    },
    update,
  };
}
