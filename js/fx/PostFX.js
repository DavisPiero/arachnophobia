// Rendering pipeline: world -> first-person gun (own depth) -> tone mapping -> a restrained "camera" look:
// faint film grain, slight chromatic aberration toward the edges, vignette, red pain edges when hurt.
import * as THREE from 'three';
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
    uLowHealth: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uAberration, uVignette, uHurt, uLowHealth, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      // chromatic aberration grows toward the edges
      vec2 off = c * uAberration * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // vignette
      float vig = smoothstep(0.95, 0.15, r2 * uVignette * 2.2);
      col *= mix(0.35, 1.0, vig);
      // pain: red at the edges
      float edge = smoothstep(0.1, 0.6, r2);
      float pulse = 0.6 + 0.4 * sin(uTime * 6.0);
      col = mix(col, vec3(0.35, 0.0, 0.0), edge * clamp(uHurt * 0.8 + uLowHealth * 0.35 * pulse, 0.0, 0.85));
      // film grain: stronger in the shadows, like a sensor
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float g = hash(vUv * 1000.0 + fract(uTime * 13.7)) - 0.5;
      col += g * uGrain * (1.2 - lum);
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
    if (quality.tier === 'low') { this.look.uniforms.uAberration.value = 0.0012; this.look.uniforms.uGrain.value = 0.04; }
  }
  setSize(w, h) { this.composer.setSize(w, h); this.look.uniforms.uAspect.value = w / h; }
  render(dt, { hurt = 0, lowHealth = 0 } = {}) {
    const u = this.look.uniforms;
    u.uTime.value += dt;
    u.uHurt.value = hurt;
    u.uLowHealth.value = lowHealth;
    this.composer.render(dt);
  }
}
