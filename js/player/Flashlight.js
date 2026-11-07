// Hand-held flashlight, toggled with T (desktop) or the LIGHT button (touch).
// A spot light that travels with the camera, held a little low and to the right so it throws real shadows.
// The light always exists (intensity 0 when off) so switching never forces shaders to recompile.
import * as THREE from 'three';
import { Config } from '../core/Config.js';

const F = Config.flashlight;

export class Flashlight {
  constructor({ camera, audio, events, quality }) {
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.on = false;
    this.level = 0;          // 0..1 eased brightness
    this.flicker = 0;        // seconds left in a flicker
    this.nextFlicker = 20 + Math.random() * 40;
    const spot = new THREE.SpotLight(F.color, 0, F.range, F.angle, F.penumbra, F.decay);
    spot.position.set(0.16, -0.14, 0.02);
    spot.target.position.set(0.03, -0.06, -6);
    camera.add(spot, spot.target);
    if (quality.shadows && quality.tier === 'high') {
      spot.castShadow = true;
      spot.shadow.mapSize.set(512, 512);
      spot.shadow.camera.near = 0.1;
      spot.shadow.camera.far = F.range;
      spot.shadow.bias = -0.0008;
      spot.shadow.normalBias = 0.03;
      spot.shadow.autoUpdate = false;
    }
    this.spot = spot;
  }

  reset() { this.on = false; this.level = 0; this.spot.intensity = 0; }

  toggle() {
    this.on = !this.on;
    this.audio.play('torchClick', { volume: 0.7 });
    this.events.emit('flashlight', { on: this.on });
  }

  /** Is this world point inside the beam (and close enough to be lit)? Walls are not checked. */
  lights(point, maxDist = F.scareRange) {
    if (this.level < 0.5) return false;
    const origin = this.spot.getWorldPosition(_o);
    const dir = this.camera.getWorldDirection(_d);
    const to = _t.copy(point).sub(origin);
    const d = to.length();
    return d < maxDist && to.dot(dir) / (d || 1) > Math.cos(F.angle * 0.85);
  }

  update(dt, danger = 0) {
    const target = this.on ? 1 : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt * (this.on ? 40 : 60)));
    // an old bulb: very rarely it stutters, more often when things are close
    this.nextFlicker -= dt * (1 + danger * 3);
    if (this.on && this.nextFlicker <= 0) { this.flicker = 0.12 + Math.random() * 0.3; this.nextFlicker = 25 + Math.random() * 50; }
    let f = 1;
    if (this.flicker > 0) { this.flicker -= dt; f = Math.random() < 0.5 ? 0.15 : 0.85; }
    this.spot.intensity = F.intensity * this.level * f;
    if (this.spot.castShadow) this.spot.shadow.autoUpdate = this.level > 0.01;
  }
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();
