// Rendering pipeline: world -> first-person gun (own depth) -> tone mapping -> a restrained "camera" look:
// a slight barrel lens distortion ("optics compensation": the middle bulges a little, the edges pull in; radial-only
// Brown-Conrady, the usual game post-process form), faint film grain, slight chromatic aberration toward the edges,
// vignette, red pain edges when hurt.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LookShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uAberration: { value: 0.0018 },
    uVignette: { value: 0.55 },
    uHurt: { value: 0 },
    uHurtDir: { value: new THREE.Vector2() },
    uBrightness: { value: 1 },
    uFxScale: { value: 1 },
    uLowHealth: { value: 0 },
    uAspect: { value: 1 },
    uLens: { value: 0 },      // barrel strength (Config.render.lens); 0 = off
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uAberration, uVignette, uHurt, uLowHealth, uAspect, uBrightness, uFxScale, uLens;
    uniform vec2 uHurtDir;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 uv0 = vUv - 0.5;
      // barrel distortion: sample further out the further from the centre, scaled so the corners stay on screen
      vec2 ca = uv0 * vec2(uAspect, 1.0);
      float k = uLens * uFxScale;
      float rc2 = 0.25 * (uAspect * uAspect + 1.0);            // corner radius squared
      vec2 duv = uv0 * (1.0 + k * dot(ca, ca)) / (1.0 + k * rc2);
      vec2 suv = duv + 0.5;
      vec2 c = suv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      // chromatic aberration grows toward the edges
      vec2 off = c * uAberration * uFxScale * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, suv + off).r;
      col.g = texture2D(tDiffuse, suv).g;
      col.b = texture2D(tDiffuse, suv - off).b;
      // vignette
      float vig = smoothstep(0.95, 0.15, r2 * uVignette * 2.2);
      col *= mix(mix(1.0, 0.35, uFxScale), 1.0, vig);
      // brightness setting (Graphics tab): lifts the darks more than the lights
      col = pow(max(col, 0.0), vec3(1.0 / uBrightness)) * mix(1.0, uBrightness, 0.35);
      // pain: red at the edges
      float edge = smoothstep(0.1, 0.6, r2);
      float pulse = 0.6 + 0.4 * sin(uTime * 6.0);
      // a hit: red flooding in from the side it came from, and a brief darkening
      float side = length(uHurtDir) > 0.1 ? smoothstep(-0.3, 0.9, dot(normalize(c * vec2(uAspect, 1.0)), uHurtDir)) : 1.0;
      float hitEdge = smoothstep(0.02, 0.45, r2) * mix(0.35, 1.0, side);
      col *= 1.0 - uHurt * 0.25;
      col = mix(col, vec3(0.4, 0.0, 0.0), clamp(hitEdge * uHurt * 1.1, 0.0, 0.9));
      col = mix(col, vec3(0.3, 0.0, 0.0), edge * clamp(uLowHealth * 0.45 * pulse, 0.0, 0.6));
      // film grain: stronger in the shadows, like a sensor
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float g = hash(suv * 1000.0 + fract(uTime * 13.7)) - 0.5;
      col += g * uGrain * uFxScale * (1.2 - lum);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, viewScene, quality) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.tier === 'high' ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (viewScene) {
      const gunPass = new RenderPass(viewScene, camera);
      gunPass.clear = false;
      gunPass.clearDepth = true;
      this.composer.addPass(gunPass);
    }
    this.composer.addPass(new OutputPass());
    this.look = new ShaderPass(LookShader);
    this.composer.addPass(this.look);
    this.look.uniforms.uLens.value = Config.render.lens;
    if (quality.tier === 'low') { this.look.uniforms.uAberration.value = 0.0012; this.look.uniforms.uGrain.value = 0.04; }
  }
  setSize(w, h) { this.composer.setSize(w, h); this.look.uniforms.uAspect.value = w / h; }
  /** Graphics settings: film effects on/off (grain, aberration, vignette) and brightness (0.7..1.6). */
  setOptions({ effects = true, brightness = 1 } = {}) {
    this.look.uniforms.uFxScale.value = effects ? 1 : 0;
    this.look.uniforms.uBrightness.value = brightness;
  }
  render(dt, { hurt = 0, lowHealth = 0, hurtDir = null } = {}) {
    const u = this.look.uniforms;
    if (hurtDir) u.uHurtDir.value.copy(hurtDir);
    u.uTime.value += dt;
    u.uHurt.value = hurt;
    u.uLowHealth.value = lowHealth;
    this.composer.render(dt);
  }
}
