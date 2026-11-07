// First-person view: gloved hands, the lever-action rifle, the axe and the boot, and how they move.
// The rifle, hands and axe are drawn in the weapon's own scene (on top of the world, never clipping walls);
// the boot is drawn in the world (it stamps on the real floor).
//
// Models come from the Blender pipeline (rifle.glb, hands.glb, axe.glb) with code-made fallbacks.
// Every pivot and grip position comes from assets/params/{rifle,hands,axe}.json, the same numbers Blender used.
//
// Spaces: "rifle space" = the params' GAME space (x right, y up, z towards the player, origin = receiver).
// The root follows the camera, so everything under it is in camera space.
import * as THREE from 'three';
import { loadModel, loadParams } from '../core/Assets.js';

// Defaults match assets/params/rifle.json, used if the file cannot be read.
const RIFLE_DEFAULTS = {
  lever: { pivot: [0, -0.028, -0.07], openAngle: 52 },
  hammer: { pivot: [0, 0.012, 0.068], cockAngle: 38 },
  sights: { lineY: 0.046 },
  muzzle: [0, 0.022, -0.665],
  ejectPort: [0.006, 0.048, -0.01],
  loadingGate: [0.021, -0.008, -0.03],
  grips: { right: [0, -0.004, 0.105], left: [0, 0.012, -0.25] },
};

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));
const lerp = THREE.MathUtils.lerp;

/** Quaternion for an axe (or any tool) whose local -z points along `h` and local -y along `b`. */
function toolQ(h, b, out = new THREE.Quaternion()) {
  const z = _a.copy(h).normalize().negate();
  const y = _b.copy(b).negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = _c.crossVectors(y, z);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

// Axe swing keyframes in camera space: t (0..1 of the swing), hand position, handle direction (grip -> head), bit direction.
const AXE_KEYS = [
  [0.0, [0.38, -0.66, -0.24], [0.3, 0.9, 0.2], [-0.6, 0.3, -0.7]],
  [0.3, [0.3, 0.02, -0.4], [0.45, 0.85, 0.15], [-0.55, 0.35, -0.75]],
  [0.48, [0.02, -0.14, -0.44], [-0.2, 0.3, -0.93], [-0.45, -0.85, -0.2]],
  [0.62, [-0.16, -0.36, -0.38], [-0.6, -0.25, -0.75], [-0.3, -0.9, 0.3]],
  [1.0, [-0.32, -0.85, -0.2], [-0.55, -0.65, -0.5], [-0.2, -0.9, 0.4]],
];

export class ViewModel {
  constructor() {
    this.P = RIFLE_DEFAULTS;
    this.root = new THREE.Group();          // follows the camera (in the weapon scene)
    this.rifle = new THREE.Group();         // the posed rifle, with the arms that hold it
    this.root.add(this.rifle);
    this.leverPivot = new THREE.Group();
    this.hammerPivot = new THREE.Group();
    this.armRPivot = new THREE.Group();     // the right hand rides the lever part of the way
    this.muzzle = new THREE.Object3D();
    this.rifle.add(this.leverPivot, this.hammerPivot, this.armRPivot, this.muzzle);
    this.axe = new THREE.Group();           // grip at the origin, handle along -z
    this.axe.visible = false;
    this.root.add(this.axe);
    this.axeForearm = new THREE.Vector3(0.35, -0.45, 0.82).normalize();   // hands.json forearm.axe (axe space)
    this.shoulder = new THREE.Vector3(0.32, -0.5, 0.12);                  // camera space: where the right arm comes from
    this.boot = new THREE.Group();          // lives in the WORLD scene; Melee places it
    this.boot.visible = false;
    // spent cases flying out of the action
    this.cases = [];
    this.caseIdx = 0;
    this.roundInHand = null;
    this.usingAssets = false;
    this.buildFallback();
    this.applyPivots();
  }

  // ------------------------------------------------------------------ models
  buildFallback() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.55 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4, metalness: 0.6 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.95 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9c7a3a, roughness: 0.3, metalness: 0.9 });
    const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
    };
    const body = new THREE.Group();
    body.add(mesh(new THREE.BoxGeometry(0.04, 0.069, 0.175), steel, 0, 0.0085, -0.0125));
    body.add(mesh(new THREE.CylinderGeometry(0.0092, 0.0105, 0.56, 8), steel, 0, 0.022, -0.38, Math.PI / 2));
    body.add(mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.48, 10), steel, 0, 0.0015, -0.36, Math.PI / 2));
    body.add(mesh(new THREE.BoxGeometry(0.04, 0.046, 0.255), wood, 0, 0.012, -0.232));
    body.add(mesh(new THREE.BoxGeometry(0.036, 0.075, 0.36), wood, 0, -0.03, 0.255, -0.12));
    body.add(mesh(new THREE.BoxGeometry(0.0026, 0.012, 0.006), steel, 0, 0.04, -0.645));
    body.add(mesh(new THREE.BoxGeometry(0.018, 0.006, 0.003), steel, 0, 0.046, -0.27));
    const lever = mesh(new THREE.TorusGeometry(0.032, 0.0042, 6, 16), steel, 0, -0.072, 0.115, 0, Math.PI / 2);
    const leverBar = mesh(new THREE.BoxGeometry(0.009, 0.008, 0.13), steel, 0, -0.032, -0.01);
    const hammer = mesh(new THREE.BoxGeometry(0.009, 0.036, 0.012), steel, 0, 0.03, 0.068);
    const armGeo = new THREE.CapsuleGeometry(0.035, 0.3, 4, 10).rotateX(Math.PI / 2).translate(0, 0, 0.17);
    const fist = new THREE.SphereGeometry(0.042, 12, 10);
    const arm = (dir) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(fist, glove));
      const sl = new THREE.Mesh(armGeo, cloth);
      sl.lookAt(dir[0], dir[1], dir[2]);   // the capsule runs along +z, which lookAt points at dir
      g.add(sl);
      return g;
    };
    const axe = new THREE.Group();
    axe.add(mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.62, 8), wood, 0, 0, -0.22, Math.PI / 2));
    axe.add(mesh(new THREE.BoxGeometry(0.018, 0.13, 0.05), steel, 0, -0.04, -0.49));
    const boot = new THREE.Group();
    boot.add(mesh(new THREE.BoxGeometry(0.11, 0.1, 0.3), glove, 0, 0.05, -0.03));
    boot.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.4, 10), cloth, 0, 0.3, 0.06));
    const round = mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.064, 8), brass, 0, 0, -0.032, Math.PI / 2);
    this.setParts({
      body, lever: new THREE.Group().add(lever, leverBar), hammer: new THREE.Group().add(hammer),
      armR: arm([0.32, -0.36, 0.88]), armL: arm([-0.42, -0.5, 0.76]), armLoad: arm([-0.55, -0.45, 0.7]), armAxe: arm([0.18, -0.9, 0.38]),
      axe, boot, round, caseMesh: () => mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.044, 8), brass, 0, 0, 0, Math.PI / 2),
    });
  }

  /** Swap in the Blender models. Any family that fails keeps its fallback. */
  async loadAssets(quality) {
    const [rifle, hands, axe, rp, hp] = await Promise.all([loadModel('rifle'), loadModel('hands'), loadModel('axe'), loadParams('rifle'), loadParams('hands')]);
    if (rp && rp.lever) this.P = { ...RIFLE_DEFAULTS, ...rp };
    if (hp?.forearm?.axe) this.axeForearm.fromArray(hp.forearm.axe).normalize();
    const lod = quality?.tier === 'low' ? '_lod1' : '';
    const pick = (m, name) => m && (m.get(name + lod) || m.get(name));
    const fix = (mat) => {
      // the glTF metallicRoughness texture holds both; MeshStandard reads roughness from G and metalness from B
      if (mat.roughnessMap && !mat.metalnessMap) mat.metalnessMap = mat.roughnessMap;
      mat.envMapIntensity = 0.6;
      return mat;
    };
    const mk = (m, name) => { const e = pick(m, name); if (!e) return null; const o = new THREE.Mesh(e.geometry, fix(e.material)); o.frustumCulled = false; return o; };
    const parts = {};
    if (rifle && pick(rifle, 'rifle_body')) {
      parts.body = mk(rifle, 'rifle_body');
      parts.lever = mk(rifle, 'rifle_lever');
      parts.hammer = mk(rifle, 'rifle_hammer');
      parts.round = mk(rifle, 'rifle_round');
      const e = pick(rifle, 'rifle_case');
      parts.caseMesh = () => { const o = new THREE.Mesh(e.geometry, e.material); o.frustumCulled = false; return o; };
    }
    if (hands && pick(hands, 'arm_grip_r')) {
      parts.armR = mk(hands, 'arm_grip_r'); parts.armL = mk(hands, 'arm_support_l');
      parts.armLoad = mk(hands, 'arm_load_l'); parts.armAxe = mk(hands, 'arm_axe_r');
      const b = mk(hands, 'boot');
      if (b) {
        // matte: seen from above, the trouser leg is all grazing angles, and a glossy sheen read as white cloth
        const src = b.material;
        b.material = new THREE.MeshLambertMaterial({ map: src.map, normalMap: src.normalMap });
        b.material.normalScale.copy(src.normalScale);
        b.frustumCulled = true;
        parts.boot = b;
      }
    }
    if (axe && pick(axe, 'axe')) parts.axe = mk(axe, 'axe');
    if (Object.keys(parts).length) this.setParts(parts);
    this.applyPivots();
    this.usingAssets = !!(rifle || hands || axe);
    return this.usingAssets;
  }

  setParts(p) {
    const swap = (holder, key, obj) => {
      if (!obj) return;
      if (this[key]) holder.remove(this[key]);
      this[key] = obj;
      holder.add(obj);
    };
    if (p.body) swap(this.rifle, 'bodyMesh', p.body);
    if (p.lever) swap(this.leverPivot, 'leverMesh', p.lever);
    if (p.hammer) swap(this.hammerPivot, 'hammerMesh', p.hammer);
    if (p.armR) swap(this.armRPivot, 'armR', p.armR);
    if (p.armL) swap(this.rifle, 'armL', p.armL);
    if (p.armLoad) { swap(this.rifle, 'armLoad', p.armLoad); this.armLoad.visible = false; }
    if (p.round) { if (this.roundInHand) this.armLoad?.remove(this.roundInHand); this.roundInHand = p.round; }
    if (this.armLoad && this.roundInHand && this.roundInHand.parent !== this.armLoad) this.armLoad.add(this.roundInHand);
    if (p.axe) swap(this.axe, 'axeMesh', p.axe);
    if (p.armAxe) swap(this.axe, 'armAxe', p.armAxe);
    if (p.boot) swap(this.boot, 'bootMesh', p.boot);
    if (p.caseMesh) {
      for (const c of this.cases) this.root.remove(c.obj);
      this.cases = [];
      for (let i = 0; i < 3; i++) { const obj = p.caseMesh(); obj.visible = false; this.root.add(obj); this.cases.push({ obj, v: new THREE.Vector3(), spin: new THREE.Vector3(), t: 9 }); }
    }
  }

  applyPivots() {
    const P = this.P;
    const lp = v3(P.lever.pivot), hp = v3(P.hammer.pivot);
    this.leverPivot.position.copy(lp);
    this.hammerPivot.position.copy(hp);
    this.armRPivot.position.copy(lp);
    // lever and hammer meshes (Blender and fallback alike) are built in rifle space: shift them back by their pivot
    if (this.leverMesh) this.leverMesh.position.copy(lp).negate();
    if (this.hammerMesh) this.hammerMesh.position.copy(hp).negate();
    if (this.armR) this.armR.position.copy(v3(P.grips.right)).sub(lp);
    if (this.armL) this.armL.position.copy(v3(P.grips.left));
    this.muzzle.position.copy(v3(P.muzzle));
    this.gate = v3(P.loadingGate);
    this.eject = v3(P.ejectPort);
    if (this.roundInHand) this.roundInHand.position.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ animation
  /**
   * s: { aimK, sprintK, kick, swayX, swayY, bob, reloading, reloadT, rounds, leverT, axeT, stompT }
   * leverT: seconds since the last shot (large when idle). axeT/stompT: 0..1 progress, or <0 when idle.
   */
  update(dt, camera, s) {
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    const a = smooth(s.aimK), sp = smooth(s.sprintK);
    const steady = 1 - 0.75 * a;
    const r = s.reloading ? reloadCurve(s.reloadT) : 0;
    // rifle lowered out of the way for the axe and the stomp
    const axeDown = s.axeT >= 0 ? Math.min(ramp(s.axeT, 0, 0.14), 1 - ramp(s.axeT, 0.72, 1)) : 0;
    const stompDown = s.stompT >= 0 ? Math.min(ramp(s.stompT, 0, 0.12), 1 - ramp(s.stompT, 0.6, 1)) * 0.6 : 0;
    const down = Math.max(axeDown, stompDown);
    this.rifle.visible = down < 0.98;

    const sx = s.swayX * steady, sy = s.swayY * steady;
    const sightY = this.P.sights.lineY;
    // hip pose -> aimed pose: the sights line up on the centre of the screen
    const hx = lerp(0.17, 0, a), hy = lerp(-0.165, -sightY - 0.001, a), hz = lerp(-0.4, -0.5, a);
    // the lever kick: the rifle dips slightly as the lever is thrown
    const lv = leverCurve(s.leverT / 0.5);
    const g = this.rifle;
    g.position.set(
      hx + sx - r * 0.12 + sp * 0.03,
      hy + s.bob + sy + r * 0.05 - s.kick * 0.014 * (1 - a * 0.5) - sp * 0.07 - lv * 0.008 - down * 0.4,
      hz + s.kick * 0.06 + r * 0.08 + sp * 0.04,
    );
    // reload: rifle turned so the loading gate on its right side faces up towards the eye
    g.rotation.set(
      lerp(0.03, 0.005, a) + s.kick * 0.1 * (1 - a * 0.4) + r * 0.18 - sp * 0.35 - lv * 0.05 - down * 0.7,
      lerp(0.07, 0, a) + r * 0.3 + sp * 0.6,
      r * 0.95 + sp * 0.25,
    );
    // lever and hammer
    const P = this.P;
    const leverAng = THREE.MathUtils.degToRad(P.lever.openAngle) * Math.max(lv, s.reloading ? leverReload(s.reloadT) : 0);
    this.leverPivot.rotation.x = leverAng;
    this.armRPivot.rotation.x = leverAng * 0.7;
    const cock = s.leverT < 0.5 ? ramp(s.leverT, 0.1, 0.2) * (1 - ramp(s.leverT, 0.45, 0.5)) : 0;
    this.hammerPivot.rotation.x = THREE.MathUtils.degToRad(P.hammer.cockAngle) * (s.leverT < 0.02 ? 0 : 1 - 0.85 * (1 - cock));

    // left hand: on the forend, or feeding rounds into the loading gate during a reload
    this.updateLoading(s);

    // axe
    this.axe.visible = s.axeT >= 0 && s.axeT < 1;
    if (this.axe.visible) this.poseAxe(s.axeT);

    // spent cases
    for (const c of this.cases) {
      if (c.t > 0.7) { c.obj.visible = false; continue; }
      c.t += dt;
      c.v.y -= 9.8 * dt;
      c.obj.position.addScaledVector(c.v, dt);
      c.obj.rotation.x += c.spin.x * dt; c.obj.rotation.y += c.spin.y * dt; c.obj.rotation.z += c.spin.z * dt;
    }
  }

  updateLoading(s) {
    const show = s.reloading && s.reloadT > 0.08 && s.reloadT < 0.9;
    if (this.armL) this.armL.visible = !show;
    if (!this.armLoad) return;
    this.armLoad.visible = show;
    if (!show) return;
    // each round: rise from the table, push into the gate, drop back down
    const n = Math.max(1, s.rounds || 1);
    const t0 = 0.12, t1 = 0.84;
    const u = Math.min(0.999, Math.max(0, (s.reloadT - t0) / (t1 - t0))) * n;
    const k = u - Math.floor(u);
    const rise = ramp(k, 0, 0.45), push = ramp(k, 0.45, 0.68), drop = ramp(k, 0.75, 1);
    const off = _a.set(0.06, -0.2, 0.12).lerp(_b.set(0.03, 0.006, 0.05), rise).lerp(_c.set(0.008, 0.002, 0.006), push);
    off.y -= drop * 0.2; off.x += drop * 0.04;
    this.armLoad.position.copy(this.gate).add(off);
    // the round points into the gate (forward and slightly inward)
    this.armLoad.rotation.set(0.15, -0.35, 0.2);
    if (this.roundInHand) this.roundInHand.visible = push < 0.98 && drop < 0.01 || k < 0.4;
  }

  poseAxe(t) {
    let i = 0;
    while (i < AXE_KEYS.length - 2 && t > AXE_KEYS[i + 1][0]) i++;
    const A = AXE_KEYS[i], B = AXE_KEYS[i + 1];
    const k = smooth((t - A[0]) / (B[0] - A[0]));
    this.axe.position.lerpVectors(_a.fromArray(A[1]), _b.fromArray(B[1]), k);
    toolQ(_d.fromArray(A[2]), _e.fromArray(A[3]), _qa);
    toolQ(_d.fromArray(B[2]), _e.fromArray(B[3]), _qb);
    this.axe.quaternion.slerpQuaternions(_qa, _qb, k);
    // turn the arm around the handle (the grip stays closed on it) so the forearm points back to the shoulder
    if (this.armAxe) {
      const d = _a.subVectors(this.shoulder, this.axe.position).applyQuaternion(_qa.copy(this.axe.quaternion).invert());
      const f = this.axeForearm;
      this.armAxe.rotation.set(0, 0, Math.atan2(d.y, d.x) - Math.atan2(f.y, f.x));
    }
  }

  /** Throw a spent case out of the ejection port (camera space). */
  ejectCase() {
    if (!this.cases.length) return;
    const c = this.cases[this.caseIdx++ % this.cases.length];
    this.rifle.updateMatrix();
    c.obj.position.copy(this.eject).applyMatrix4(this.rifle.matrix);
    c.v.set(0.5 + Math.random() * 0.4, 1.3 + Math.random() * 0.4, 0.15 + Math.random() * 0.2);
    c.spin.set(15 + Math.random() * 10, Math.random() * 8, 20 + Math.random() * 10);
    c.obj.rotation.set(0, Math.random() * 6, 0);
    c.t = 0;
    c.obj.visible = true;
  }
}

// 0..1 lever opening over one cycle (x = fraction of the 0.5 s cycle since the shot)
function leverCurve(x) {
  if (!(x >= 0) || x >= 1) return 0;
  return ramp(x, 0.16, 0.44) * (1 - ramp(x, 0.52, 0.8));
}
// one lever cycle at the very end of a reload (chambers a round)
function leverReload(t) { return ramp(t, 0.88, 0.93) * (1 - ramp(t, 0.95, 0.99)); }
function reloadCurve(t) {
  if (t < 0.1) return smooth(t / 0.1);
  if (t > 0.9) return smooth(1 - (t - 0.9) / 0.1);
  return 1;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
