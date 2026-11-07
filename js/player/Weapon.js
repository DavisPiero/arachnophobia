// The rifle: first-person model, firing (hitscan), recoil, muzzle flash, bullet holes,
// and the reload animation that the ammo table drives.
// The gun is drawn in its own small scene on top of the world so it never clips into walls.
import * as THREE from 'three';
import { Config } from '../core/Config.js';

const W = Config.weapon;

export class Weapon {
  constructor({ camera, audio, events, lighting, player }) {
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.lighting = lighting;
    this.player = player;
    this.mag = W.magSize;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;          // 0..1 progress, set by the ammo table
    this.kick = 0;
    this.flashT = 0;
    this.swayX = 0; this.swayY = 0;
    this.targets = [];         // filled each frame by the spider manager: hitbox meshes
    this.worldMeshes = [];     // cabin meshes and window boards that stop bullets
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = W.range;

    // Viewmodel scene, rendered after the world with a cleared depth buffer.
    this.viewScene = new THREE.Scene();
    this.viewCamera = camera; // same projection
    this.viewRoot = new THREE.Group();
    this.viewScene.add(this.viewRoot);
    this.gun = buildRifle();
    this.viewRoot.add(this.gun.group);
    // lighting for the gun: follows the interior mood (warm, dim), plus the muzzle flash
    this.viewAmbient = new THREE.HemisphereLight(0x6a5a48, 0x0a0806, 0.5);
    this.viewKey = new THREE.PointLight(0xffb36b, 2.0, 3, 2);
    this.viewKey.position.set(0.5, 0.45, 0.1);
    this.viewFlash = new THREE.PointLight(0xffc27a, 0, 2.5, 2);
    this.viewFlash.position.set(0.05, 0.0, -0.9);
    this.viewScene.add(this.viewAmbient);
    this.viewRoot.add(this.viewKey, this.viewFlash); // lights travel with the gun

    // muzzle flash sprite
    const flashTex = makeFlashTexture();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flashSprite.scale.set(0.22, 0.22, 1);
    this.gun.muzzle.add(this.flashSprite);

    // bullet holes in the world
    this.holes = [];
    this.holeIdx = 0;
    const holeMat = new THREE.MeshBasicMaterial({ map: makeHoleTexture(), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const holeGeo = new THREE.PlaneGeometry(0.05, 0.05);
    this.holeGroup = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      this.holes.push(m);
      this.holeGroup.add(m);
    }
  }

  reset() { this.mag = W.magSize; this.cooldown = 0; this.reloading = false; this.reloadT = 0; for (const h of this.holes) h.visible = false; }

  /** Try to fire. Returns true if a round was fired. */
  tryFire() {
    if (this.reloading || this.cooldown > 0 || this.player.dead) return false;
    if (this.mag <= 0) {
      this.audio.play('dryFire', { volume: 0.8 });
      this.cooldown = 0.35;
      this.kick = Math.max(this.kick, 0.15);
      return false;
    }
    this.mag--;
    this.cooldown = W.fireInterval;
    this.kick = 1;
    this.flashT = 1;
    this.player.recoil += W.recoilPitch;
    this.player.shake = Math.max(this.player.shake, 0.25);

    const origin = this.camera.getWorldPosition(_o);
    const dir = this.camera.getWorldDirection(_d);
    dir.x += (Math.random() - 0.5) * W.spread * 2;
    dir.y += (Math.random() - 0.5) * W.spread * 2;
    dir.normalize();
    this.raycaster.set(origin, dir);

    const spiderHits = this.raycaster.intersectObjects(this.targets, false);
    const worldHits = this.raycaster.intersectObjects(this.worldMeshes, false);
    const sh = spiderHits[0], wh = worldHits[0];
    let hitSpider = null, hitPoint = null;
    if (sh && (!wh || sh.distance < wh.distance)) {
      hitSpider = sh.object.userData.spider;
      hitPoint = sh.point.clone();
      if (hitSpider) hitSpider.takeHit(W.damage, sh.point, dir);
    } else if (wh) {
      hitPoint = wh.point.clone();
      this.placeHole(wh);
      this.audio.play('bulletImpactWood', { position: wh.point, volume: 0.7, exterior: false });
      const board = wh.object.userData.board;
      if (board) board.onShot?.();
    }

    const muzzleWorld = this.camera.localToWorld(_m.set(0.12, -0.1, -0.7));
    this.audio.play('gunshot', { volume: 1, reverb: 0.6 });
    this.events.emit('muzzleFlash', { position: muzzleWorld.clone() }); // World lights the room from this event
    this.events.emit('shot', { origin: origin.clone(), direction: dir.clone(), hitPoint, hitSpider });
    return true;
  }

  placeHole(hit) {
    if (!hit.face) return;
    const h = this.holes[this.holeIdx++ % this.holes.length];
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    h.position.copy(hit.point).addScaledVector(n, 0.003);
    h.lookAt(_t.copy(h.position).add(n));
    h.rotateZ(Math.random() * Math.PI * 2);
    h.scale.setScalar(0.8 + Math.random() * 0.5);
    h.visible = true;
  }

  update(dt, input, moving) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick *= Math.exp(-14 * dt);
    this.flashT = Math.max(0, this.flashT - dt * 18);

    // sway from looking and bob from walking
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-input.lookDX * 4, -0.05, 0.05), 1 - Math.exp(-10 * dt));
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(-input.lookDY * 4, -0.05, 0.05), 1 - Math.exp(-10 * dt));
    const t = performance.now() / 1000;
    const bob = moving ? Math.sin(t * 8.5) * 0.008 : Math.sin(t * 1.3) * 0.002;

    // the gun follows the camera exactly
    this.viewRoot.position.copy(this.camera.position);
    this.viewRoot.quaternion.copy(this.camera.quaternion);

    const g = this.gun.group;
    // reload pose: lower the rifle, roll it, magazine drops out and comes back
    const r = this.reloading ? reloadCurve(this.reloadT) : 0;
    g.position.set(0.2 + this.swayX - r * 0.06, -0.2 + bob + this.swayY - r * 0.1 - this.kick * 0.012, -0.3 + this.kick * 0.05 + r * 0.06);
    // slight inward yaw so the barrel points toward the crosshair
    g.rotation.set(0.03 + this.kick * 0.09 + r * 0.5, 0.06 + r * 0.35, r * 0.6);
    // magazine animation during reload
    const mt = this.reloadT;
    const magDrop = this.reloading ? (mt < 0.1 ? mt / 0.1 : mt < 0.75 ? 1 : Math.max(0, 1 - (mt - 0.75) / 0.12)) : 0;
    this.gun.mag.position.y = this.gun.magRestY - magDrop * 0.25;
    this.gun.mag.visible = magDrop < 0.98;
    // bolt rack at the end
    const boltT = this.reloading && mt > 0.88 ? Math.sin((mt - 0.88) / 0.12 * Math.PI) : 0;
    this.gun.bolt.position.z = this.gun.boltRestZ + boltT * 0.06;

    this.flashSprite.material.opacity = this.flashT > 0.5 ? 1 : this.flashT * 2;
    this.flashSprite.material.rotation = Math.random() * 6.28;
    this.flashSprite.scale.setScalar(0.16 + Math.random() * 0.12);
    this.viewFlash.intensity = this.flashT * 6;
  }
}

function reloadCurve(t) {
  // ease into the reload pose, hold, ease out at the end
  if (t < 0.12) return smooth(t / 0.12);
  if (t > 0.9) return smooth(1 - (t - 0.9) / 0.1);
  return 1;
}
function smooth(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

// --- procedural rifle model (wood + blued steel), about 0.9 m long ---
function buildRifle() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.55, metalness: 0.0, map: makeGunWoodTexture() });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.42, metalness: 0.35 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, metalness: 0.3 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  // stock (tapered) — a lathe-like box made from a shaped extrusion
  const stockShape = new THREE.Shape();
  stockShape.moveTo(0, 0); stockShape.lineTo(0.3, 0.015); stockShape.lineTo(0.3, -0.05); stockShape.lineTo(0.05, -0.075); stockShape.lineTo(0, -0.12); stockShape.lineTo(-0.01, -0.03); stockShape.lineTo(0, 0);
  const stockGeo = new THREE.ExtrudeGeometry(stockShape, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  stockGeo.translate(0, 0, -0.018);
  add(stockGeo, wood, 0, 0.0, 0.32, 0, Math.PI / 2, 0);
  // receiver
  add(new THREE.BoxGeometry(0.048, 0.06, 0.22), steel, 0, 0.012, 0.0);
  // bolt + handle
  const bolt = add(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 10), darkSteel, 0.02, 0.035, 0.02, Math.PI / 2, 0, 0);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), darkSteel);
  handle.position.set(0.0, -0.01, 0.04);
  bolt.add(handle);
  // handguard
  add(new THREE.BoxGeometry(0.044, 0.045, 0.3), wood, 0, -0.005, -0.25);
  // barrel
  add(new THREE.CylinderGeometry(0.0095, 0.011, 0.52, 14), steel, 0, 0.02, -0.4, Math.PI / 2, 0, 0);
  // front sight + rear sight
  add(new THREE.BoxGeometry(0.006, 0.022, 0.012), darkSteel, 0, 0.038, -0.64);
  add(new THREE.BoxGeometry(0.03, 0.014, 0.012), darkSteel, 0, 0.048, -0.08);
  // trigger guard
  add(new THREE.TorusGeometry(0.022, 0.004, 6, 14, Math.PI), darkSteel, 0, -0.03, 0.07, 0, Math.PI / 2, Math.PI);
  // magazine
  const mag = add(new THREE.BoxGeometry(0.028, 0.11, 0.05), darkSteel, 0, -0.065, -0.03, 0.12, 0, 0);
  // muzzle anchor
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.68);
  group.add(muzzle);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { group, mag, magRestY: mag.position.y, bolt, boltRestZ: bolt.position.z, muzzle };
}

function makeGunWoodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3520'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 15},5,${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 0.5 + Math.random() * 1.5;
    g.beginPath();
    const y = Math.random() * 64;
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeFlashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.2, 'rgba(255,200,110,0.9)'); grd.addColorStop(0.5, 'rgba(255,120,30,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  // spikes
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    g.strokeStyle = 'rgba(255,190,100,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
function makeHoleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.25, 'rgba(10,6,3,0.95)'); grd.addColorStop(0.5, 'rgba(60,40,25,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _t = new THREE.Vector3();
