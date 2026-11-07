// Loads the .glb models made by the Blender pipeline (`npm run assets` -> assets/models/).
// Every caller keeps a code-made fallback: if a file is missing, broken or switched off with ?assets=0,
// loadModel resolves to null and the game carries on with what it already built.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const params = new URLSearchParams(location.search);
export const assetsEnabled = params.get('assets') !== '0';

const BASE = new URL('../../assets/', import.meta.url);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/** Resolves to Map(meshName -> { geometry, material }) or null. Geometry is float, with the node transform baked in.
 *  On the low quality tier (phones) it first tries `<name>_low.glb` (the same meshes with half-size textures, made by
 *  `npm run assets`), then the full file. */
export function loadModel(name, quality) {
  if (!assetsEnabled) return Promise.resolve(null);
  const low = quality?.tier === 'low';
  const key = name + (low ? ':low' : '');
  if (!cache.has(key)) {
    const get = (file) => loader.loadAsync(new URL(`models/${file}.glb`, BASE).href).then(collectMeshes);
    const first = low ? get(`${name}_low`).catch(() => get(name)) : get(name);
    cache.set(key, first
      .catch((err) => { console.warn(`[assets] ${name}.glb not loaded, using the built-in model`, err?.message || err); return null; }));
  }
  return cache.get(key);
}

/** The parameter file shared with Blender (assets/params/<name>.json), or {} if missing. */
export function loadParams(name) {
  return fetch(new URL(`params/${name}.json`, BASE).href).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
}

function collectMeshes(gltf) {
  const out = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = dequantize(o.geometry);
    geometry.applyMatrix4(o.matrixWorld);
    out.set(o.name, { geometry, material: o.material });
  });
  return out;
}

// Compressed files store positions/normals/uvs as small integers plus a node scale. Instanced and
// merged meshes need plain floats with that scale applied, so convert every attribute to Float32.
function dequantize(src) {
  const g = new THREE.BufferGeometry();
  for (const [key, attr] of Object.entries(src.attributes)) {
    const n = attr.count, size = attr.itemSize;
    const arr = new Float32Array(n * size);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[i * size + c] = get[c].call(attr, i);
    g.setAttribute(key, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(src.index.clone());
  g.computeBoundingSphere();
  return g;
}
