// What is in your hands and the guns: the lever-action rifle and the double-barrelled shotgun (hitscan; the shotgun
// fires a spread of pellets), the lever cycle, recoil, muzzle flash, bullet holes. Fists and the axe are swung by
// Melee.js, flares thrown by Flares.js. Which weapons you may pick up: Arsenal.js (unlocks by wave).
// What you see (hands, guns, axe, how they move) lives in ViewModel.js; reloading is driven by the ammo table.
// The view is drawn in its own small scene on top of the world so it never clips into walls.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { ViewModel } from './ViewModel.js';

const W = Config.weapon, SG = Config.shotgun;
export const GUNS = ['rifle', 'shotgun'];
export const MAG = { rifle: W.magSize, shotgun: SG.magSize };

export class Weapon {
  constructor({ camera, audio, events, lighting, player }) {
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.lighting = lighting;
    this.player = player;
    this.ammo = { ...MAG };    // rounds loaded in each gun
    this.arsenal = null;       // set by the game: what you have unlocked
    this.cooldown = 0;
    this.sinceShot = 9;        // seconds since the last shot (drives the lever animation)
    this.leverDone = true;     // lever sound and case ejection for the last shot already happened
    this.queued = false;       // a fire press that arrived just before the lever finished
    this.reloading = false;
    this.reloadT = 0;          // 0..1 progress, set by the ammo table
    this.reloadRounds = 0;     // rounds being loaded (the hand animation repeats this many times)
    this.busy = false;         // the axe or stomp is in use (set by Melee)
    this.held = 'fists';       // what is in your hands: fists, rifle, axe, shotgun or flare
    this.want = 'fists';       // what you asked for; the switch lowers one and raises the other
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
    this.viewAmbient = new THREE.HemisphereLight(0x6a5a48, 0x1a120c, Config.render.viewAmbient);
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
    this.ammo = { ...MAG }; this.cooldown = 0; this.reloading = false; this.reloadT = 0; this.aimK = 0; this.sprintK = 0;
    this.sinceShot = 9; this.leverDone = true; this.queued = false; this.busy = false;
    this.held = this.want = 'fists'; this.drawK = 1;
    for (const h of this.holes) h.visible = false;
  }

  /** The gun whose rounds the HUD and the table talk about: the one in your hands, else the rifle. */
  get gun() { return GUNS.includes(this.want) ? this.want : 'rifle'; }
  /** Rounds loaded in that gun. */
  get mag() { return this.ammo[this.gun]; }
  isGun(name = this.held) { return GUNS.includes(name); }

  /** Ask for a weapon. The current one goes down, then the other comes up (Config.weapon.switchTime). */
  select(name) {
    if (!name || this.reloading || this.player.dead) return false;
    if (this.arsenal && !this.arsenal.has(name)) return false;
    if (name !== this.want) this.last = this.want;
    this.want = name;
    return true;
  }
  /** Back to what you held before (Q-style quick swap), or the next weapon you own. */
  toggle() {
    const back = this.last && this.last !== this.want && (!this.arsenal || this.arsenal.has(this.last)) ? this.last : null;
    this.select(back || this.arsenal?.next(this.want) || this.want);
  }
  /** Up and ready to use (not mid-switch). */
  ready(name) { return this.held === name && this.want === name && this.drawK > 0.9; }
  /** Put a gun straight into the hands (the ammo table does this when a reload starts). */
  forceGun(name) { if (name !== this.want) this.last = this.want; this.held = this.want = name; }

  /** Try to fire the gun in your hands. Returns true if it fired. */
  tryFire() {
    const gun = this.held;
    if (!this.isGun(gun) || this.reloading || this.busy || this.player.dead || this.sprintK > 0.5 || !this.ready(gun)) return false;
    const C = gun === 'shotgun' ? SG : W;
    if (this.cooldown > 0) {
      // pressed while the lever is still moving: fire as soon as it is done (touch players tap early)
      if (this.cooldown <= W.fireBuffer) this.queued = true;
      return false;
    }
    if (this.ammo[gun] <= 0) {
      this.audio.play('dryFire', { volume: 0.8, rate: gun === 'shotgun' ? 0.8 : 1 });
      this.events.emit('dryFire');
      this.cooldown = 0.35;
      this.kick = Math.max(this.kick, 0.15);
      this.view.bump(0, 0.05, 0.35, 0);
      return false;
    }
    this.ammo[gun]--;
    this.cooldown = C.fireInterval;
    this.sinceShot = 0;
    // rifle: an empty tube has nothing to chamber, the lever stays shut until the reload; the shotgun has no lever
    this.leverDone = gun === 'shotgun' || this.ammo[gun] <= 0;
    const big = gun === 'shotgun' ? 1.6 : 1;
    this.kick = 1;
    this.view.bump((0.1 + Math.random() * 0.05) * big, 0.22 * big, (1.1 + Math.random() * 0.4) * big, (Math.random() - 0.5) * 0.8 * big);   // recoil bounce
    this.flashT = 1;
    this.player.recoil += C.recoilPitch * (0.9 + Math.random() * 0.2);
    this.player.recoilYaw += (Math.random() - 0.5) * 2 * C.recoilYaw;
    this.player.shake = Math.max(this.player.shake, 0.3 * big);

    const origin = this.camera.getWorldPosition(_o);
    const aim = this.camera.getWorldDirection(_aim);
    let hitSpider = null, hitPoint = null, dir = null;
    const pellets = gun === 'shotgun' ? SG.pellets : 1;
    const spread = (gun === 'shotgun' ? SG.spread : W.spread) * THREE.MathUtils.lerp(1, gun === 'shotgun' ? SG.aimSpread : W.aimSpread, this.aimK);
    let woodSound = false;
    for (let i = 0; i < pellets; i++) {
      dir = _d.copy(aim);
      // pellets spread over a disc (square spread for the single rifle round, as before)
      if (pellets > 1) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread; dir.x += Math.cos(a) * r; dir.y += Math.sin(a) * r; dir.z += Math.sin(a) * r * 0.3; }
      else { dir.x += (Math.random() - 0.5) * spread * 2; dir.y += (Math.random() - 0.5) * spread * 2; }
      dir.normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = gun === 'shotgun' ? SG.range : W.range;
      const sh = this.raycaster.intersectObjects(this.targets, false)[0];
      const wh = this.raycaster.intersectObjects(this.worldMeshes, false)[0];
      if (sh && (!wh || sh.distance < wh.distance)) {
        const s = sh.object.userData.spider;
        if (!hitSpider) { hitSpider = s; hitPoint = sh.point.clone(); }
        let dmg = W.damage;
        if (gun === 'shotgun') dmg = SG.damage * (1 - 0.7 * THREE.MathUtils.smoothstep(sh.distance, SG.falloff[0], SG.falloff[1]));
        if (s) s.takeHit(dmg, sh.point, dir, { by: 'bullet' });
      } else if (wh) {
        if (!hitPoint) hitPoint = wh.point.clone();
        if (i < 4 || pellets === 1) this.placeHole(wh);
        if (!woodSound) { woodSound = true; this.audio.play('bulletImpactWood', { position: wh.point, volume: 0.7, exterior: false }); }
        const board = wh.object.userData.board;
        if (board) board.onShot?.();
      }
    }
    dir = _d.copy(aim);

    const muzzleWorld = this.camera.localToWorld(_m.set(0.12, -0.1, -0.7));
    if (gun === 'shotgun') {
      this.audio.play('gunshot', { volume: 1, reverb: 0.85, rate: 0.72 });
      this.audio.play('stomp', { volume: 0.55, rate: 0.8, exterior: false });   // the low thump under it
    } else this.audio.play('gunshot', { volume: 1, reverb: 0.75 });
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
        const h = this.held;
      this.audio.play(h === 'axe' ? 'axeSwing' : h === 'rifle' ? 'leverCycle' : h === 'shotgun' ? 'roundInsert' : h === 'flare' ? 'torchClick' : 'footRug', { volume: h === 'fists' ? 0.4 : 0.25 });
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
    const wantAim = input.aim && this.isGun(this.held) && this.ready(this.held) && !this.reloading && !this.busy && !this.player.dead && !this.player.sprinting;
    this.aimK += ((wantAim ? 1 : 0) - this.aimK) * (1 - Math.exp(-W.aimSpeed * dt));
    this.sprintK += ((this.player.sprinting ? 1 : 0) - this.sprintK) * (1 - Math.exp(-9 * dt));
    this.player.aiming = this.aimK > 0.5;
    const steady = 1 - 0.75 * this.aimK * this.aimK * (3 - 2 * this.aimK);
    const bob = (moving ? Math.sin(t * (this.player.sprinting ? 11 : 8.5)) * 0.008 * (1 + this.sprintK) : Math.sin(t * 1.3) * 0.002) * steady;

    this.view.update(dt, this.camera, {
      aimK: this.aimK, sprintK: this.sprintK, kick: this.kick, swayX: this.swayX, swayY: this.swayY, bob,
      reloading: this.reloading, reloadT: this.reloadT, rounds: this.reloadRounds,
      leverT: this.held !== 'rifle' ? 9 : this.ammo.rifle <= 0 && this.sinceShot > 0.05 ? 9 : this.sinceShot,
      shotT: this.held === 'shotgun' ? this.sinceShot : 9, punchT: this.punchT ?? -1, punchSide: this.punchSide || 0,
      throwT: this.throwT ?? -1, flares: this.arsenal?.flares ?? 0,
      axeT: this.axeT ?? -1, stompT: this.stompT ?? -1, held: this.held, drawK: this.drawK,
    });

    const muzzle = this.held === 'shotgun' ? this.view.shotMuzzle : this.view.muzzle;
    if (this.flashSprite.parent !== muzzle) muzzle.add(this.flashSprite);
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

const _aim = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _t = new THREE.Vector3();
