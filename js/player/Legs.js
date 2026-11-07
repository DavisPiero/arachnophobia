// The player's own legs and waist, seen when looking down (reference/m4-legs-pov.webp).
// Drawn in the world scene under the player, a little behind the eye (legs.json `behind`), so looking down shows
// the front of the body, the thighs and the boots. Each leg swings from its hip while walking. The right leg hides
// while the stomp boot (ViewModel.boot, placed by Melee) is out.
// Model: assets/models/legs.glb from blender/generators/legs.py, with a code-made fallback.
import * as THREE from 'three';
import { loadModel, loadParams } from '../core/Assets.js';

const DEFAULTS = { stance: 0.11, hip: [0.095, 0.93], behind: 0.24 };

export class Legs {
  constructor() {
    this.P = DEFAULTS;
    this.root = new THREE.Group();
    this.root.name = 'player-legs';
    this.hipL = new THREE.Group();
    this.hipR = new THREE.Group();
    this.root.add(this.hipL, this.hipR);
    this.phase = 0;
    this.buildFallback();
    this.applyPivots();
  }

  buildFallback() {
    const cloth = new THREE.MeshLambertMaterial({ color: 0x24261f });
    const leather = new THREE.MeshLambertMaterial({ color: 0x141210 });
    const leg = (side) => {
      const g = new THREE.Group();
      const x = side * DEFAULTS.stance;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.068, 0.75, 12), cloth);
      tr.position.set(x, 0.56, 0);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.3), leather);
      boot.position.set(x, 0.065, -0.04);
      g.add(tr, boot);
      return g;
    };
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.18, 0.3, 16), cloth);
    waist.position.y = 1.0;
    this.setParts({ legL: leg(-1), legR: leg(1), waist });
  }

  async loadAssets(quality) {
    const [m, p] = await Promise.all([loadModel('legs', quality), loadParams('legs')]);
    if (p && p.hip) this.P = { ...DEFAULTS, ...p };
    if (m) {
      const lod = quality?.tier === 'low' ? '_lod1' : '';
      const mk = (name) => {
        const e = m.get(name + lod) || m.get(name);
        if (!e) return null;
        // matte, like the stomp boot: seen from above, cloth is all grazing angles and a glossy sheen reads as white
        const src = e.material;
        const mat = new THREE.MeshLambertMaterial({ map: src.map, normalMap: src.normalMap });
        if (src.normalScale) mat.normalScale.copy(src.normalScale);
        return new THREE.Mesh(e.geometry, mat);
      };
      const parts = { legL: mk('leg_l'), legR: mk('leg_r'), waist: mk('waist') };
      if (parts.legL && parts.legR) this.setParts(parts);
    }
    this.applyPivots();
    return !!m;
  }

  setParts({ legL, legR, waist }) {
    for (const [k, holder, obj] of [['legL', this.hipL, legL], ['legR', this.hipR, legR], ['waist', this.root, waist]]) {
      if (!obj) continue;
      if (this[k]) holder.remove(this[k]);
      this[k] = obj;
      obj.castShadow = false;
      holder.add(obj);
    }
  }

  applyPivots() {
    const [hx, hy] = this.P.hip;
    // legs are modelled standing in place (feet on y = 0): hang each from its hip so it can swing
    this.hipL.position.set(-hx, hy, 0);
    this.hipR.position.set(hx, hy, 0);
    if (this.legL) this.legL.position.set(hx, -hy, 0);
    if (this.legR) this.legR.position.set(-hx, -hy, 0);
  }

  /** player: position (feet), yaw, velocity. stomping: hide the right leg while the stomp boot is out. */
  update(dt, player, stomping) {
    const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
    this.root.position.set(player.position.x - fwdX * this.P.behind, player.position.y, player.position.z - fwdZ * this.P.behind);
    this.root.rotation.y = player.yaw;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.phase += dt * speed * 4.2;
    const k = Math.min(1, speed / 2.5);
    const swing = Math.sin(this.phase) * 0.32 * k;
    this.hipL.rotation.x = swing;
    this.hipR.rotation.x = -swing;
    this.hipR.visible = !stomping;
  }
}
