// Lights, sky, fog and the lantern model.
//  - Lantern: warm PointLight with shadows, hanging from the beam above LANTERN.position. Organic flicker.
//  - Moon: cold DirectionalLight from high east-north-east; shadows only on quality.moonShadows.
//  - Hemisphere: weak cold fill for the exterior.
//  - Interior materials are patched (interiorMaterial) so the moon and hemisphere barely reach inside;
//    the walls would otherwise let the moon "leak" in on the low tier, which has no moon shadows.
//  - flash(strength): lightning. muzzleFlash(position): 60 ms warm burst.
import * as THREE from 'three';
import { LANTERN, WALL_LAMP, CABIN } from './Layout.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glow } from './Textures.js';

// How much outside light (moon + hemisphere) reaches interior surfaces. Raised briefly by lightning.
const OUTSIDE_INSIDE_BASE = 0.05;
export const outsideInside = { value: OUTSIDE_INSIDE_BASE };

// Patch a MeshStandardMaterial so the moon and hemisphere light are scaled by outsideInside.
export function interiorMaterial(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uOutsideInside = outsideInside;
    const chunk = THREE.ShaderChunk.lights_fragment_begin
      .replace('getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uOutsideInside;')
      .replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
        'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * uOutsideInside;');
    sh.fragmentShader = 'uniform float uOutsideInside;\n' + sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
  };
  mat.customProgramCacheKey = () => 'interior';
  mat.userData.interior = true;
  mat.fog = false; // the room is small; scene fog would only add a cold haze indoors
  return mat;
}

// Restrict which shadow passes a mesh is drawn into: 'dir' = moon only, 'point' = lantern only.
// (Skipped passes return before issuing a draw call.)
export function limitShadow(mesh, only) {
  mesh.onBeforeShadow = function (r, o, cam, shadowCamera) {
    const isPoint = !!shadowCamera.isPerspectiveCamera;
    if ((only === 'dir' && isPoint) || (only === 'point' && !isPoint)) {
      const g = this.geometry;
      g.userData._dc = g.drawRange.count;
      g.drawRange.count = -1;
    }
  };
  mesh.onAfterShadow = function () {
    const g = this.geometry;
    if (g.userData._dc !== undefined) { g.drawRange.count = g.userData._dc; delete g.userData._dc; }
  };
  return mesh;
}

// Colour temperature helpers (approximate, in linear sRGB).
const LANTERN_COLOR = new THREE.Color().setRGB(1.0, 0.6, 0.3, THREE.LinearSRGBColorSpace); // ~2400 K
const CANDLE_COLOR = new THREE.Color().setRGB(1.0, 0.56, 0.24, THREE.LinearSRGBColorSpace);
const MOON_COLOR = new THREE.Color().setRGB(0.62, 0.72, 0.95, THREE.SRGBColorSpace);
// Night fog is close to black: things get DARKER with distance, not hazier. (It was a blue-grey haze,
// which made the far forest brighter than the near one.)
const FOG_COLOR = new THREE.Color().setRGB(0.006, 0.008, 0.011, THREE.LinearSRGBColorSpace);
const FLASH_FOG = new THREE.Color().setRGB(0.16, 0.18, 0.22, THREE.LinearSRGBColorSpace);

const LANTERN_INTENSITY = 11.5;
const WALL_LAMP_INTENSITY = 6.5;
const MOON_INTENSITY = 0.5;
const HEMI_INTENSITY = 0.6;

// smooth pseudo-random 0..1 signal
function wobble(t, seed) {
  return 0.5 + 0.25 * Math.sin(t * 1.7 + seed) + 0.15 * Math.sin(t * 3.9 + seed * 2.1) + 0.1 * Math.sin(t * 9.3 + seed * 0.7);
}

export function buildLighting(scene, renderer, quality) {
  const group = new THREE.Group();
  group.name = 'lighting';
  scene.add(group);

  scene.background = new THREE.Color().setRGB(0.012, 0.015, 0.02, THREE.LinearSRGBColorSpace);
  scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.046);
  renderer.toneMappingExposure = 1.15;

  // ---------------------------------------------------------- sky dome
  const skyUniforms = { uFlash: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0.62, 0.62, -0.38).normalize() } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform float uFlash;
        uniform vec3 uMoonDir;
        varying vec3 vDir;
        #include <common>
        void main() {
          float e = vDir.y;
          // fogged trees take the fog colour; the sky behind them must stay a little lighter
          // up to the treetops (~30 deg) so they read as silhouettes, then fall off to a dark zenith
          vec3 horizon = vec3(0.016, 0.02, 0.027);
          vec3 zenith = vec3(0.006, 0.0075, 0.011);
          vec3 c = mix(horizon, zenith, smoothstep(0.3, 0.95, e));
          c = mix(c, vec3(0.006, 0.008, 0.011), smoothstep(0.02, -0.05, e));
          // cloud-hidden moon: broad cold glow
          float m = max(dot(vDir, uMoonDir), 0.0);
          c += vec3(0.05, 0.06, 0.08) * pow(m, 10.0) + vec3(0.02, 0.025, 0.03) * pow(m, 3.0);
          c += vec3(0.35, 0.38, 0.45) * uFlash * (0.4 + 0.6 * smoothstep(-0.1, 0.4, e));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // ---------------------------------------------------------- moon + hemisphere
  const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INTENSITY);
  moon.position.set(19, 21, -11.5);
  moon.target.position.set(0, 0, 0);
  group.add(moon, moon.target);
  if (quality.moonShadows) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(Math.max(1024, quality.shadowMapSize * 2), Math.max(1024, quality.shadowMapSize * 2));
    const s = moon.shadow.camera;
    s.left = -26; s.right = 26; s.top = 26; s.bottom = -26; s.near = 1; s.far = 80;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.05;
    moon.shadow.radius = 2;
  }
  const hemi = new THREE.HemisphereLight(
    new THREE.Color().setRGB(0.32, 0.4, 0.55, THREE.SRGBColorSpace),
    new THREE.Color().setRGB(0.05, 0.05, 0.06, THREE.SRGBColorSpace), HEMI_INTENSITY);
  group.add(hemi);

  // ---------------------------------------------------------- lantern
  const lantern = new THREE.PointLight(LANTERN_COLOR, LANTERN_INTENSITY, 16, 2);
  lantern.position.copy(LANTERN.position);
  if (quality.shadows) {
    lantern.castShadow = true;
    lantern.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    lantern.shadow.camera.near = 0.08;
    lantern.shadow.camera.far = 14;
    lantern.shadow.bias = -0.004;
    lantern.shadow.normalBias = 0.02;
    lantern.shadow.radius = 3;
  }
  group.add(lantern);
  const lanternModel = buildLanternModel();
  lanternModel.position.copy(LANTERN.position);
  group.add(lanternModel);

  // ---------------------------------------------------------- wall lamp (second light, north end of the room)
  const wallLamp = new THREE.PointLight(LANTERN_COLOR, WALL_LAMP_INTENSITY, 9, 2);
  wallLamp.position.copy(WALL_LAMP.position);
  if (quality.shadows && quality.tier === 'high') {
    wallLamp.castShadow = true;
    wallLamp.shadow.mapSize.set(512, 512);
    wallLamp.shadow.camera.near = 0.08;
    wallLamp.shadow.camera.far = 10;
    wallLamp.shadow.bias = -0.004;
    wallLamp.shadow.normalBias = 0.02;
    wallLamp.shadow.radius = 3;
  }
  group.add(wallLamp);
  const wallLampModel = buildLanternModel({ wall: WALL_LAMP });
  wallLampModel.scale.setScalar(0.85);
  wallLampModel.position.copy(WALL_LAMP.position);
  group.add(wallLampModel);

  // ---------------------------------------------------------- muzzle flash
  const muzzle = new THREE.PointLight(new THREE.Color().setRGB(1, 0.72, 0.4, THREE.SRGBColorSpace), 0, 10, 2);
  group.add(muzzle);
  let muzzleAge = 1;

  // ---------------------------------------------------------- flicker / lightning state
  const extraFlames = []; // { light, base, sprite, seed }
  const flashes = [];     // pulses: { t, s }
  let clock = 0, dip = 0, nextDip = 6 + Math.random() * 8, dipT = -1;
  let flashLevel = 0;

  function flash(strength = 1) {
    const s = Math.max(0, Math.min(1, strength));
    flashes.push({ t: clock, s }, { t: clock + 0.11 + Math.random() * 0.05, s: s * 0.55 }, { t: clock + 0.3 + Math.random() * 0.15, s: s * (0.3 + Math.random() * 0.5) });
  }
  function muzzleFlash(position) {
    muzzle.position.copy(position);
    muzzleAge = 0;
    muzzle.intensity = 40;
  }
  function addFlame(light, sprite) {
    extraFlames.push({ light, base: light.intensity, sprite, seed: Math.random() * 100, spriteBase: sprite ? sprite.scale.x : 0 });
  }

  addFlame(wallLamp, wallLampModel.userData.glow);

  function update(dt, time) {
    clock += dt;
    // lantern flicker: slow breathing + fast shimmer + occasional dip
    if (clock > nextDip && dipT < 0) { dipT = 0; nextDip = clock + 5 + Math.random() * 12; }
    if (dipT >= 0) {
      dipT += dt;
      const a = dipT < 0.12 ? dipT / 0.12 : Math.max(0, 1 - (dipT - 0.12) / 0.5);
      dip = a * 0.38;
      if (dipT > 0.62) { dipT = -1; dip = 0; }
    }
    const f = 1 + (wobble(clock * 2.3, 1) - 0.5) * 0.1 + (wobble(clock * 11, 5) - 0.5) * 0.06;
    lantern.intensity = LANTERN_INTENSITY * f * (1 - dip);
    lanternModel.userData.flame.scale.setScalar(lanternModel.userData.flameBase * (0.85 + 0.15 * f) * (1 - dip * 0.6));
    lanternModel.userData.glow.material.opacity = 0.3 * f * (1 - dip);
    for (const e of extraFlames) {
      const g = 1 + (wobble(clock * 3.1, e.seed) - 0.5) * 0.25 + (wobble(clock * 14, e.seed + 3) - 0.5) * 0.1;
      e.light.intensity = e.base * g;
      if (e.sprite) e.sprite.scale.setScalar(e.spriteBase * (0.9 + 0.1 * g));
    }
    // lightning envelope
    let fl = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const age = clock - flashes[i].t;
      if (age < 0) continue;
      if (age > 1.2) { flashes.splice(i, 1); continue; }
      fl += flashes[i].s * Math.exp(-age / 0.075);
    }
    flashLevel = Math.min(1.5, fl);
    moon.intensity = MOON_INTENSITY + flashLevel * 3;
    moon.color.copy(MOON_COLOR).lerp(new THREE.Color(1, 1, 1), Math.min(1, flashLevel));
    hemi.intensity = HEMI_INTENSITY + flashLevel * 2;
    outsideInside.value = OUTSIDE_INSIDE_BASE + flashLevel * 0.12;
    skyUniforms.uFlash.value = flashLevel;
    scene.fog.color.copy(FOG_COLOR).lerp(FLASH_FOG, Math.min(1, flashLevel));
    // muzzle
    if (muzzleAge < 1) {
      muzzleAge += dt;
      muzzle.intensity = muzzleAge < 0.06 ? 40 * (1 - muzzleAge / 0.06) : 0;
    }
  }

  return {
    group, lantern, wallLamp, moon, hemi, sky, lanternModel,
    update, flash, muzzleFlash, addFlame,
    get flashLevel() { return flashLevel; },
  };
}

// Hurricane lantern: tank, glass globe, wire guards, cap, bail handle, chain to the beam above.
function buildLanternModel({ wall = null } = {}) {
  const g = new THREE.Group();
  g.name = 'lanternModel';
  // unlit dark metal: the light sits centimetres away and would blow out a lit cap and guards
  const metal = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.027, 0.018) });
  const rust = interiorMaterial(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8, metalness: 0.5 }));
  // metal parts are collected and merged into one mesh per material at the end
  const parts = new Map();
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    if (mat === metal || mat === rust) {
      const gg = geo.index ? geo.toNonIndexed() : geo.clone();
      const o = { geo: gg, position: new THREE.Vector3(x, y, z), rotation: new THREE.Euler(), scale: new THREE.Vector3(1, 1, 1) };
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(o);
      return o;
    }
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };
  // fuel tank (below flame), light centre is the origin of this group
  add(new THREE.CylinderGeometry(0.07, 0.078, 0.06, 20), rust, 0, -0.1, 0);
  add(new THREE.TorusGeometry(0.072, 0.006, 6, 20).rotateX(Math.PI / 2), metal, 0, -0.07, 0);
  // burner
  add(new THREE.CylinderGeometry(0.02, 0.028, 0.03, 12), metal, 0, -0.06, 0);
  // globe
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.03 + Math.sin(t * Math.PI) * 0.035, -0.06 + t * 0.15)); }
  // unlit: the point light sits a few cm inside the globe and would blow a lit material out to white
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.3, 0.12), transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: true });
  add(new THREE.LatheGeometry(pts, 20), glass);
  // wire guards
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 0.072, -0.07, Math.sin(a) * 0.072),
      new THREE.Vector3(Math.cos(a) * 0.075, 0.01, Math.sin(a) * 0.075),
      new THREE.Vector3(Math.cos(a) * 0.05, 0.1, Math.sin(a) * 0.05)]);
    add(new THREE.TubeGeometry(curve, 8, 0.003, 4), metal);
  }
  // cap + chimney
  add(new THREE.CylinderGeometry(0.035, 0.06, 0.035, 16), metal, 0, 0.105, 0);
  add(new THREE.CylinderGeometry(0.02, 0.025, 0.03, 12), metal, 0, 0.135, 0);
  // bail handle (half ring)
  add(new THREE.TorusGeometry(0.075, 0.004, 5, 20, Math.PI), metal, 0, 0.1, 0);
  if (wall) {
    // iron bracket: a plate on the wall, an arm out to a hook above the bail handle (model space, scaled 0.85)
    const toWall = (wall.position.x - (-CABIN.halfX)) / 0.85;   // distance from flame centre back to the wall face
    const s = -Math.sign(wall.wallNormal.x || 1);                 // direction toward the wall along x
    add(new THREE.BoxGeometry(0.012, 0.16, 0.07), rust, s * (toWall - 0.006), 0.2, 0);
    const arm = new THREE.CylinderGeometry(0.006, 0.006, toWall, 6).rotateZ(Math.PI / 2);
    add(arm, metal, s * toWall / 2, 0.24, 0);
    const brace = new THREE.CylinderGeometry(0.004, 0.004, Math.hypot(toWall * 0.6, 0.1), 5).rotateZ(Math.atan2(toWall * 0.6, 0.1) * -s);
    add(brace, metal, s * toWall * 0.7, 0.19, 0);
    add(new THREE.TorusGeometry(0.014, 0.003, 4, 10, Math.PI * 1.5).rotateY(Math.PI / 2), metal, 0, 0.215, 0);
  } else {
    // chain up to the beam bottom (y = 2.42)
    const chainTop = 2.42 - LANTERN.position.y;
    const linkGeo = new THREE.TorusGeometry(0.012, 0.0028, 4, 8);
    for (let y = 0.18, k = 0; y < chainTop; y += 0.022, k++) {
      const l = add(linkGeo, metal, 0, y, 0);
      l.rotation.y = k % 2 ? Math.PI / 2 : 0;
      l.scale.set(1, 1.4, 1);
    }
  }
  // flame
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.35), fog: false });
  const flame = add(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 2, 1), flameMat, 0, -0.025, 0);
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: new THREE.Color(1.0, 0.55, 0.22), transparent: true,
    opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glowSprite.scale.setScalar(0.55);
  glowSprite.position.y = -0.02;
  g.add(glowSprite);
  for (const [mat, list] of parts) {
    const geos = list.map((o) => o.geo.applyMatrix4(new THREE.Matrix4().compose(o.position, new THREE.Quaternion().setFromEuler(o.rotation), o.scale)));
    for (const q of geos) for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
    g.add(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  g.userData.flame = flame;
  g.userData.flameBase = 1;
  g.userData.glow = glowSprite;
  return g;
}

export { CANDLE_COLOR };
