// The lever-action rifle: firing (hitscan), the lever cycle, recoil, muzzle flash, bullet holes.
// What you see (hands, rifle, axe, how they move) lives in ViewModel.js; reloading is driven by the ammo table.
// The view is drawn in its own small scene on top of the world so it never clips into walls.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { ViewModel } from './ViewModel.js';

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
    this.sinceShot = 9;        // seconds since the last shot (drives the lever animation)
    this.leverDone = true;     // lever sound and case ejection for the last shot already happened
    this.queued = false;       // a fire press that arrived just before the lever finished
    this.reloading = false;
    this.reloadT = 0;          // 0..1 progress, set by the ammo table
    this.reloadRounds = 0;     // rounds being loaded (the hand animation repeats this many times)
    this.busy = false;         // the axe or stomp is in use (set by Melee)
    this.held = 'rifle';       // what is in your hands: 'rifle' (1) or 'axe' (2)
    this.want = 'rifle';       // what you asked for; the switch lowers one and raises the other
    this.drawK = 1;            // 0 = lowered out of view, 1 = up and ready
    this.kick = 0;
    this.flashT = 0;
    this.swayX = 0; this.swayY = 0;
    this.aimK = 0;             // 0 = hip, 1 = aimed down the sights
    this.sprintK = 0;          // 0 = ready, 1 = lowered for running
    this.targets = [];         // filled each frame by the spider manager: hitbox meshes
    this.worldMeshes = [];     // cabin meshes and window boards that stop bullets
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = W.range;

    // Viewmodel scene, rendered after the world with a cleared depth buffer.
    this.viewScene = new THREE.Scene();
    this.viewCamera = camera; // same projection
    this.view = new ViewModel();
    this.viewRoot = this.view.root;
    this.viewScene.add(this.viewRoot);
    // lighting for the hands and gun: follows the interior mood (warm, dim), plus the muzzle flash
    this.viewAmbient = new THREE.HemisphereLight(0x5a5048, 0x0a0806, 0.32);
    this.viewKey = new THREE.PointLight(0xffc48a, 2.0, 3, 2);
    this.viewKey.position.set(0.5, 0.45, 0.1);
    this.viewFlash = new THREE.PointLight(0xffc27a, 0, 2.5, 2);
    this.viewFlash.position.set(0.05, 0.0, -0.9);
    this.viewScene.add(this.viewAmbient);
    this.viewRoot.add(this.viewKey, this.viewFlash); // lights travel with the view

    // muzzle flash sprite
    const flashTex = makeFlashTexture();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flashSprite.scale.set(0.22, 0.22, 1);
    this.view.muzzle.add(this.flashSprite);

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

  loadAssets(quality) { return this.view.loadAssets(quality); }

  reset() {
    this.mag = W.magSize; this.cooldown = 0; this.reloading = false; this.reloadT = 0; this.aimK = 0; this.sprintK = 0;
    this.sinceShot = 9; this.leverDone = true; this.queued = false; this.busy = false;
    this.held = this.want = 'rifle'; this.drawK = 1;
    for (const h of this.holes) h.visible = false;
  }

  /** Ask for the rifle or the axe. The current one goes down, then the other comes up (Config.weapon.switchTime). */
  select(name) {
    if (this.reloading || this.player.dead) return;
    this.want = name;
  }
  toggle() { this.select(this.want === 'rifle' ? 'axe' : 'rifle'); }
  /** Up and ready to use (not mid-switch). */
  ready(name) { return this.held === name && this.want === name && this.drawK > 0.9; }
  /** Put the rifle straight into the hands (the ammo table does this when a reload starts). */
  forceRifle() { this.held = this.want = 'rifle'; }

  /** Try to fire. Returns true if a round was fired. */
  tryFire() {
    if (this.reloading || this.busy || this.player.dead || this.sprintK > 0.5 || !this.ready('rifle')) return false;
    if (this.cooldown > 0) {
      // pressed while the lever is still moving: fire as soon as it is done (touch players tap early)
      if (this.cooldown <= W.fireBuffer) this.queued = true;
      return false;
    }
    if (this.mag <= 0) {
      this.audio.play('dryFire', { volume: 0.8 });
      this.cooldown = 0.35;
      this.kick = Math.max(this.kick, 0.15);
      return false;
    }
    this.mag--;
    this.cooldown = W.fireInterval;
    this.sinceShot = 0;
    this.leverDone = this.mag <= 0;   // an empty tube: nothing to chamber, the lever stays shut until the reload
    this.kick = 1;
    this.flashT = 1;
    this.player.recoil += W.recoilPitch * (0.9 + Math.random() * 0.2);
    this.player.recoilYaw += (Math.random() - 0.5) * 2 * W.recoilYaw;
    this.player.shake = Math.max(this.player.shake, 0.3);

    const origin = this.camera.getWorldPosition(_o);
    const dir = this.camera.getWorldDirection(_d);
    const spread = W.spread * THREE.MathUtils.lerp(1, W.aimSpread, this.aimK);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.raycaster.set(origin, dir);

    const spiderHits = this.raycaster.intersectObjects(this.targets, false);
    const worldHits = this.raycaster.intersectObjects(this.worldMeshes, false);
    const sh = spiderHits[0], wh = worldHits[0];
    let hitSpider = null, hitPoint = null;
    if (sh && (!wh || sh.distance < wh.distance)) {
      hitSpider = sh.object.userData.spider;
      hitPoint = sh.point.clone();
      if (hitSpider) hitSpider.takeHit(W.damage, sh.point, dir, { by: 'bullet' });
    } else if (wh) {
      hitPoint = wh.point.clone();
      this.placeHole(wh);
      this.audio.play('bulletImpactWood', { position: wh.point, volume: 0.7, exterior: false });
      const board = wh.object.userData.board;
      if (board) board.onShot?.();
    }

    const muzzleWorld = this.camera.localToWorld(_m.set(0.12, -0.1, -0.7));
    this.audio.play('gunshot', { volume: 1, reverb: 0.75 });
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
    this.sinceShot += dt;
    // weapon switch: lower what you hold, swap, raise the other
    const half = W.switchTime / 2;
    if (this.want !== this.held) {
      this.drawK -= dt / half;
      if (this.drawK <= 0) {
        this.drawK = 0; this.held = this.want;
        this.audio.play(this.held === 'axe' ? 'axeSwing' : 'leverCycle', { volume: 0.25 });
      }
    } else this.drawK = Math.min(1, this.drawK + dt / half);
    // the lever: thrown after each shot (sound + spent case), unless the tube is empty
    if (!this.leverDone && this.sinceShot >= W.leverAt) {
      this.leverDone = true;
      this.audio.play('leverCycle', { volume: 0.85 });
      setTimeout(() => this.view.ejectCase(), 60);
      const p = this.player.position;
      this.audio.play('caseTink', { position: _t.set(p.x + 0.35, 0.02, p.z), volume: 0.6, delay: 0.55, exterior: false });
    }
    if (this.queued && this.cooldown <= 0) { this.queued = false; this.tryFire(); }
    this.kick *= Math.exp(-12 * dt);
    this.flashT = Math.max(0, this.flashT - dt * 18);

    // sway from looking and bob from walking
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-input.lookDX * 4, -0.05, 0.05), 1 - Math.exp(-10 * dt));
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(-input.lookDY * 4, -0.05, 0.05), 1 - Math.exp(-10 * dt));
    const t = performance.now() / 1000;
    // aim and sprint poses ease in and out
    const wantAim = input.aim && this.ready('rifle') && !this.reloading && !this.busy && !this.player.dead && !this.player.sprinting;
    this.aimK += ((wantAim ? 1 : 0) - this.aimK) * (1 - Math.exp(-W.aimSpeed * dt));
    this.sprintK += ((this.player.sprinting ? 1 : 0) - this.sprintK) * (1 - Math.exp(-9 * dt));
    this.player.aiming = this.aimK > 0.5;
    const steady = 1 - 0.75 * this.aimK * this.aimK * (3 - 2 * this.aimK);
    const bob = (moving ? Math.sin(t * (this.player.sprinting ? 11 : 8.5)) * 0.008 * (1 + this.sprintK) : Math.sin(t * 1.3) * 0.002) * steady;

    this.view.update(dt, this.camera, {
      aimK: this.aimK, sprintK: this.sprintK, kick: this.kick, swayX: this.swayX, swayY: this.swayY, bob,
      reloading: this.reloading, reloadT: this.reloadT, rounds: this.reloadRounds,
      leverT: this.mag <= 0 && this.sinceShot > 0.05 ? 9 : this.sinceShot,
      axeT: this.axeT ?? -1, stompT: this.stompT ?? -1, held: this.held, drawK: this.drawK,
    });

    this.flashSprite.material.opacity = this.flashT > 0.5 ? 1 : this.flashT * 2;
    this.flashSprite.material.rotation = Math.random() * 6.28;
    this.flashSprite.scale.setScalar(0.16 + Math.random() * 0.14);
    this.viewFlash.intensity = this.flashT * 8;
  }
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
