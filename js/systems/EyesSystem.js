// Phantom red eyes in the dark outside. Some belong to nothing at all.
// Eyes fade in, blink, sometimes shift, then fade out. They draw after the window veil (renderOrder 20),
// so a pair can show through a window that is otherwise black.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { WINDOWS, terrainHeight } from '../world/Layout.js';

const E = Config.eyes;

export class EyesSystem {
  constructor({ scene, audio }) {
    this.scene = scene;
    this.audio = audio;
    this.tex = makeEyeTexture();
    this.pairs = [];
    this.timer = 4;
    this.enabled = true;
    this.rate = 1; // multiplier set by the game (more eyes as danger rises)
  }
  reset() { for (const p of this.pairs) this.scene.remove(p.group); this.pairs = []; this.timer = 4; }

  spawn() {
    const win = WINDOWS[Math.floor(Math.random() * WINDOWS.length)];
    const ang = (Math.random() - 0.5) * 1.3; // within ~±37° of the window's outward direction
    const dist = E.distance[0] + Math.pow(Math.random(), 0.8) * (E.distance[1] - E.distance[0]);
    const dir = win.normal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const pos = win.center.clone().addScaledVector(dir, dist);
    const ground = terrainHeight(pos.x, pos.z);
    // mostly near the ground (a crouched body), sometimes up in the trees
    pos.y = ground + (Math.random() < 0.2 ? 2 + Math.random() * 4 : 0.25 + Math.random() * 0.9);
    const scale = 0.6 + Math.random() * 1.4;           // small spider .. huge spider
    const spacing = 0.07 * scale;
    const count = Math.random() < 0.5 ? 2 : 4;          // two eyes, or a cluster of four
    const group = new THREE.Group();
    group.position.copy(pos);
    group.lookAt(win.center.x, pos.y, win.center.z);   // face the cabin
    const mat = new THREE.SpriteMaterial({ map: this.tex, color: 0xff1a0a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false });
    const sprites = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(mat);
      const row = count === 4 && i >= 2 ? 1 : 0;
      const side = i % 2 === 0 ? -1 : 1;
      s.position.set(side * spacing * (row ? 0.65 : 1), row * -spacing * 0.7, 0);
      const sz = (row ? 0.05 : 0.075) * scale * (0.9 + dist / 60);
      s.scale.set(sz, sz, 1);
      s.renderOrder = 20;
      sprites.push(s);
      group.add(s);
    }
    this.scene.add(group);
    this.pairs.push({
      group, mat, sprites, age: 0,
      life: E.life[0] + Math.random() * (E.life[1] - E.life[0]),
      blinkT: 1 + Math.random() * 3, blink: 0,
      drift: Math.random() < 0.3 ? new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4) : null,
      peak: 0.55 + Math.random() * 0.45,
    });
  }

  update(dt) {
    if (!this.enabled) return;
    this.timer -= dt * this.rate;
    if (this.timer <= 0 && this.pairs.length < E.maxPairs) {
      this.spawn();
      this.timer = E.interval[0] + Math.random() * (E.interval[1] - E.interval[0]);
    }
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const p = this.pairs[i];
      p.age += dt;
      const fadeIn = Math.min(1, p.age / 1.2), fadeOut = Math.min(1, (p.life - p.age) / 0.6);
      // blink: a quick close and open
      p.blinkT -= dt;
      if (p.blinkT <= 0) { p.blink = 0.18; p.blinkT = 1.5 + Math.random() * 4; }
      p.blink = Math.max(0, p.blink - dt);
      const open = p.blink > 0 ? 0.08 : 1;
      p.mat.opacity = p.peak * Math.max(0, Math.min(fadeIn, fadeOut)) * (0.85 + Math.random() * 0.15);
      for (const s of p.sprites) s.scale.y = s.scale.x * open;
      if (p.drift) p.group.position.addScaledVector(p.drift, dt);
      if (p.age >= p.life) { this.scene.remove(p.group); p.mat.dispose(); this.pairs.splice(i, 1); }
    }
  }
}

function makeEyeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,230,200,1)');
  grd.addColorStop(0.12, 'rgba(255,70,30,1)');
  grd.addColorStop(0.35, 'rgba(200,10,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
