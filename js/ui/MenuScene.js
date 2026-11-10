// The main menu as a 3D room, built in code: a lab bench with notes and photographs, old monitors, and at the back a
// glass panel with a spider nailed to the wall behind it. Depth of field blurs the back; the camera drifts slowly.
// The menu itself is HTML, warped onto the left monitor's screen every frame (so buttons and sliders stay real).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// the HTML laid onto the menu monitor is this many CSS pixels before warping (4:3, like the screen)
export const SCREEN_W = 640, SCREEN_H = 480;

const NOTES = [
  ['Oct 29', 'Specimen 7 is bigger again.', 'It watched me through the', 'glass while I fed the others.'],
  ['Oct 30', 'The big one smiled.', 'Teeth like ours.'],
  ['Oct 31', 'Seal 7 is gone.', 'Keep the fire going.', 'Never stand at a window', 'too long.'],
];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function noteTex(lines, seed) {
  return canvasTex(256, 330, (g, w, h) => {
    g.fillStyle = '#d9cfb2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,90,130,0.35)'; g.lineWidth = 1;
    for (let y = 40; y < h; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(180,60,60,0.5)'; g.beginPath(); g.moveTo(30, 0); g.lineTo(30, h); g.stroke();
    const stain = g.createRadialGradient(w * 0.75, h * 0.3, 0, w * 0.75, h * 0.3, 60);
    stain.addColorStop(0, 'rgba(110,70,30,0.35)'); stain.addColorStop(1, 'rgba(110,70,30,0)');
    g.fillStyle = stain; g.fillRect(0, 0, w, h);
    g.font = '26px "Reenie Beanie", cursive';
    lines.forEach((l, i) => { g.fillStyle = i === 0 ? '#7a2020' : '#2b2540'; g.fillText(l, 38, 34 + i * 26 + (seed % 3)); });
  });
}

// murky photographs: something with too many legs, a window at night, a shape in the trees
function photoTex(kind) {
  return canvasTex(200, 240, (g, w, h) => {
    g.fillStyle = '#e8e2d2'; g.fillRect(0, 0, w, h);
    const x = 12, y = 12, pw = w - 24, ph = h - 64;
    const bg = g.createLinearGradient(0, y, 0, y + ph);
    bg.addColorStop(0, kind === 1 ? '#1d2630' : '#2a2620'); bg.addColorStop(1, '#0b0a09');
    g.fillStyle = bg; g.fillRect(x, y, pw, ph);
    g.save(); g.beginPath(); g.rect(x, y, pw, ph); g.clip();
    g.filter = 'blur(2px)';
    g.fillStyle = '#050404'; g.strokeStyle = '#050404';
    const cx = x + pw / 2, cy = y + ph / 2;
    if (kind === 0) {
      g.beginPath(); g.ellipse(cx, cy + 10, 26, 32, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(cx, cy - 26, 14, 0, 7); g.fill();
      g.lineWidth = 4;
      for (let i = 0; i < 8; i++) {
        const s = i < 4 ? -1 : 1, k = i % 4;
        g.beginPath(); g.moveTo(cx, cy - 20 + k * 8);
        g.quadraticCurveTo(cx + s * 55, cy - 60 + k * 25, cx + s * 80, cy - 10 + k * 30); g.stroke();
      }
      g.fillStyle = '#ff2010'; g.filter = 'blur(1px)';
      for (const dx of [-5, 5]) { g.beginPath(); g.arc(cx + dx, cy - 30, 2, 0, 7); g.fill(); }
    } else if (kind === 1) {
      g.fillStyle = '#3a4a52'; g.fillRect(cx - 40, cy - 50, 80, 90);
      g.fillStyle = '#050404'; g.fillRect(cx - 2, cy - 50, 4, 90); g.fillRect(cx - 40, cy - 7, 80, 4);
      g.beginPath(); g.ellipse(cx + 18, cy + 20, 14, 10, 0.4, 0, 7); g.fill();
      g.fillStyle = '#ff2010'; for (const dx of [12, 20]) { g.beginPath(); g.arc(cx + dx, cy + 16, 1.6, 0, 7); g.fill(); }
    } else {
      for (let i = 0; i < 7; i++) { g.fillRect(x + i * 28 + 4, y, 8 + (i % 3) * 3, ph); }
      g.beginPath(); g.ellipse(cx + 10, cy + 30, 40, 18, 0, 0, 7); g.fill();
    }
    g.restore(); g.filter = 'none';
    // grain and a red circle in marker
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; g.fillRect(x + Math.random() * pw, y + Math.random() * ph, 1, 1); }
    g.strokeStyle = 'rgba(170,20,20,0.8)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(x + pw * 0.52, y + ph * 0.48, 46, 38, 0.2, 0, 6); g.stroke();
    g.font = '22px "Reenie Beanie", cursive'; g.fillStyle = '#2b2540';
    g.fillText(['spec. 7 - day 40', 'north window 3am', 'treeline. WHAT IS IT'][kind], 16, h - 18);
  });
}

function screenNoiseTex() {
  return canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#021008'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3fbf62'; g.lineWidth = 1.5; g.beginPath();
    for (let x = 0; x < w; x++) { const y = h / 2 + Math.sin(x * 0.25) * 10 * Math.sin(x * 0.03) + (Math.random() - 0.5) * 6; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, w, 1); }
  });
}

export class MenuScene {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.t = 0;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030404);
    scene.fog = new THREE.Fog(0x030404, 3, 9);
    const cam = this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 30);
    this.camBase = new THREE.Vector3(0.2, 1.5, 1.05);
    this.lookAt = new THREE.Vector3(-0.1, 1.05, -1.0);

    const mat = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const box = (w, h, d, m, x, y, z, parent = scene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; };

    // room: floor, back wall, side walls
    const wall = mat(0x2a302b, 0.95);
    box(8, 0.05, 8, mat(0x14110e), 0, -0.025, -1);
    box(8, 4, 0.1, wall, 0, 2, -3.2);
    box(0.1, 4, 8, wall, -3, 2, -1); box(0.1, 4, 8, wall, 3, 2, -1);

    // the bench
    const wood = mat(0x3b2a1c, 0.8);
    box(3.4, 0.07, 1.1, wood, 0, 0.9, -0.55);
    for (const x of [-1.6, 1.6]) for (const z of [-1.0, -0.1]) box(0.07, 0.9, 0.07, wood, x, 0.45, z);

    // the menu monitor, left: a beige CRT turned toward you; its screen is where the HTML goes
    const crt = this.crt = new THREE.Group();
    crt.position.set(-0.42, 0.94, -0.12); crt.rotation.y = 0.5;
    scene.add(crt);
    const beige = mat(0x6b6352, 0.7);
    box(0.62, 0.5, 0.5, beige, 0, 0.27, -0.12, crt);
    box(0.4, 0.34, 0.25, mat(0x4f4839, 0.8), 0, 0.27, -0.45, crt);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), new THREE.MeshBasicMaterial({ color: 0x041a0c }));
    glass.position.set(0, 0.28, 0.131); crt.add(glass);
    this.screenCorners = [[-0.26, 0.475], [0.26, 0.475], [0.26, 0.085], [-0.26, 0.085]].map(([x, y]) => new THREE.Vector3(x, y, 0.132));
    this.screenLight = new THREE.PointLight(0x5fe08a, 0.5, 1.6, 2);
    this.screenLight.position.set(0, 0.28, 0.4); crt.add(this.screenLight);

    // more monitors, right and back, showing waveforms
    const noise = screenNoiseTex();
    for (const [x, z, ry, s] of [[0.7, -0.75, -0.3, 0.75], [1.25, -0.6, -0.55, 0.6]]) {
      const g = new THREE.Group(); g.position.set(x, 0.94, z); g.rotation.y = ry; g.scale.setScalar(s); scene.add(g);
      box(0.62, 0.5, 0.5, beige, 0, 0.27, -0.12, g);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), new THREE.MeshBasicMaterial({ map: noise, color: 0x88aa88 }));
      scr.position.set(0, 0.28, 0.131); g.add(scr);
    }

    // notes and photographs on the bench
    const flat = (tex, w, h, x, z, rz, y = 0.937) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
      m.rotation.set(-Math.PI / 2, 0, rz); m.position.set(x, y, z); scene.add(m); return m;
    };
    this.texts = [];
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const addLater = (make, ...args) => { const m = flat(make(), ...args); fontsReady.then(() => { m.material.map = make(); m.material.needsUpdate = true; }); };
    addLater(() => noteTex(NOTES[0], 1), 0.22, 0.28, 0.05, -0.2, 0.25);
    addLater(() => noteTex(NOTES[1], 2), 0.22, 0.28, 0.3, -0.3, -0.15, 0.938);
    addLater(() => noteTex(NOTES[2], 3), 0.22, 0.28, -0.05, -0.62, 0.6, 0.936);
    addLater(() => photoTex(0), 0.15, 0.18, 0.5, -0.15, -0.4, 0.939);
    addLater(() => photoTex(1), 0.15, 0.18, 0.95, -0.25, 0.3);
    // pinned to the back wall
    const pin = (make, x, y, rz) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.36), new THREE.MeshStandardMaterial({ map: make(), roughness: 0.95 }));
      m.position.set(x, y, -3.14); m.rotation.z = rz; scene.add(m);
      fontsReady.then(() => { m.material.map = make(); m.material.needsUpdate = true; });
    };
    pin(() => photoTex(2), -1.7, 1.9, 0.08); pin(() => noteTex(NOTES[1], 4), 1.7, 1.75, -0.06); pin(() => photoTex(0), 1.95, 2.25, 0.12);

    // a desk lamp's warm pool on the bench
    const lamp = new THREE.SpotLight(0xffb070, 9, 4, 0.75, 0.6, 1.6);
    lamp.position.set(0.6, 2.1, 0.1); lamp.target.position.set(0.2, 0.9, -0.5);
    scene.add(lamp, lamp.target);
    box(0.04, 0.6, 0.04, mat(0x222222, 0.4, 0.8), 1.2, 1.2, -0.85);
    scene.add(new THREE.AmbientLight(0x404a50, 0.35));

    // the back: a glass panel in a steel frame, and behind it, on the wall, the spider
    const steel = mat(0x2c2f30, 0.45, 0.8);
    const gw = 2.2, gh = 1.7, gz = -2.6, gy = 1.85;
    for (const [w, h, x, y] of [[gw + 0.1, 0.06, 0, gy + gh / 2], [gw + 0.1, 0.06, 0, gy - gh / 2], [0.06, gh, -gw / 2, gy], [0.06, gh, gw / 2, gy]]) box(w, h, 0.08, steel, x, y, gz);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshBasicMaterial({ map: canvasTex(256, 200, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(170,200,210,0.025)'; g.fillRect(0, 0, w, h);
      for (const [x, wd, a] of [[40, 22, 0.05], [90, 6, 0.08], [200, 5, 0.06]]) {
        g.save(); g.translate(x, 0); g.transform(1, 0, -0.5, 1, 0, 0); g.fillStyle = `rgba(200,225,235,${a})`; g.fillRect(0, 0, wd, h); g.restore();
      }
      g.fillStyle = 'rgba(200,225,235,0.25)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    }), transparent: true, depthWrite: false }));
    pane.position.set(0, gy, gz); scene.add(pane);
    this.spider = this.buildSpider(); this.spider.position.set(0.05, gy, -3.12); scene.add(this.spider);
    this.backLight = new THREE.PointLight(0xa8c4ff, 3.5, 2.6, 2);
    this.backLight.position.set(0.2, gy + 0.6, -2.75); scene.add(this.backLight);

    // depth of field: sharp on the menu monitor, soft at the back
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(scene, cam));
    this.bokeh = new BokehPass(scene, cam, { focus: 1.4, aperture: quality.tier === 'low' ? 0.006 : 0.008, maxblur: 0.009 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    this.resize(innerWidth, innerHeight);
  }

  // a big dark spider, legs splayed flat, nailed through the body and each leg
  buildSpider() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.45, metalness: 0.1 });
    const nailM = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.35, metalness: 0.9 });
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin); abd.scale.set(1, 1.25, 0.6); abd.position.y = -0.2; g.add(abd);
    const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin); ceph.scale.set(1, 1.1, 0.6); ceph.position.y = 0.08; g.add(ceph);
    const eyes = new THREE.MeshBasicMaterial({ color: 0x5a0a06 });
    for (const dx of [-0.035, 0.035]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyes); e.position.set(dx, 0.16, 0.06); g.add(e); }
    const nail = (x, y, s = 1) => {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.03, 8), nailM);
      n.rotation.x = Math.PI / 2; n.position.set(x, y, 0.09); g.add(n);
    };
    nail(0, -0.15, 2.2); nail(0, 0.08, 1.6);
    for (let i = 0; i < 8; i++) {
      const s = i < 4 ? -1 : 1, k = i % 4;
      const a0 = (0.9 - k * 0.55);  // fan from up to down
      const knee = new THREE.Vector3(s * (0.32 + k * 0.03), 0.06 + Math.sin(a0) * 0.35, 0.05);
      const foot = new THREE.Vector3(s * (0.55 + k * 0.08), knee.y + (k < 2 ? 0.25 : -0.3), 0.01);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 0.06, 0.05 - k * 0.03, 0.04), knee, foot);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 6), skin));
      nail(foot.x * 0.92, foot.y * 0.92 + knee.y * 0.08);
    }
    return g;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // wide phones: pull back so the menu monitor stays fully in view
    this.camera.fov = w / h > 1.9 ? 46 : 50;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  update(dt) {
    this.t += dt;
    const t = this.t, c = this.camera;
    // slow handheld drift
    c.position.set(
      this.camBase.x + Math.sin(t * 0.31) * 0.025 + Math.sin(t * 0.83) * 0.006,
      this.camBase.y + Math.sin(t * 0.27 + 1) * 0.015 + Math.sin(t * 0.71) * 0.004,
      this.camBase.z + Math.sin(t * 0.19 + 2) * 0.02);
    c.lookAt(this.lookAt);
    c.rotation.z += Math.sin(t * 0.23) * 0.006;
    // the monitor hums, the light behind the glass stutters
    this.screenLight.intensity = 0.5 + Math.sin(t * 50) * 0.02 + (Math.random() < 0.01 ? -0.2 : 0);
    this.bokeh.uniforms.focus.value = c.position.distanceTo(this.crt.position) + 0.1;
    this.backLight.intensity = Math.random() < 0.03 ? 0.6 : 3.5;
  }

  render() { this.composer.render(); }

  /** The menu monitor's screen corners in CSS pixels: top-left, top-right, bottom-right, bottom-left. */
  screenQuad() {
    this.crt.updateWorldMatrix(true, false);
    const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    return this.screenCorners.map((p) => {
      v.copy(p).applyMatrix4(this.crt.matrixWorld).project(this.camera);
      return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
    });
  }
}

/** CSS matrix3d that maps a W x H box (origin top-left) onto a quad of 4 points (tl, tr, br, bl). */
export function quadTransform(W, H, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + gg * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + gg * y1, e = y3 - y0 + hh * y3, f = y0;
  const m = [a / W, d / W, 0, gg / W, b / H, e / H, 0, hh / H, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => +n.toFixed(6)).join(',')})`;
}
