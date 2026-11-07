// First-person player: walking, looking, collisions inside the cabin, footsteps, health.
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { CABIN } from '../world/Layout.js';

const C = Config.player;

export class Player {
  constructor(camera, audio, events) {
    this.camera = camera;
    this.audio = audio;
    this.events = events;
    this.position = new THREE.Vector3(0, 0, 2.2);   // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;            // 0 = looking toward -z (north)
    this.pitch = 0;
    this.recoil = 0;         // extra pitch from weapon kick
    this.health = C.maxHealth;
    this.locked = false;     // true while reloading (cannot move)
    this.colliders = [];
    this.floorTypeAt = () => 'wood';
    this.stepTimer = 0;
    this.bobPhase = 0;
    this.shake = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.sprinting = false;
    this.aiming = false;     // set by the game from the weapon (true once the rifle is up)
    this.lookScale = 1;      // the game lowers this while aiming
    camera.rotation.order = 'YXZ';
  }
  reset() {
    this.position.set(0, 0, 2.2);
    this.velocity.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.recoil = 0;
    this.health = C.maxHealth; this.dead = false; this.locked = false; this.sprinting = false; this.aiming = false;
    this.shake = 0; this.hurtFlash = 0;
  }
  get eye() { return this.camera.position; }
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  aimDirection(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  update(dt, input) {
    // --- look ---
    this.yaw += input.lookDX * this.lookScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookDY * this.lookScale, -C.pitchLimit, C.pitchLimit);
    this.recoil *= Math.exp(-Config.weapon.recoilRecover * dt);

    // --- move ---
    const mv = this.locked || this.dead ? { x: 0, y: 0 } : input.getMove();
    const fwd = this.forward(_v1);
    const right = _v2.set(-fwd.z, 0, fwd.x);
    this.sprinting = !this.locked && !this.dead && !this.aiming && input.sprint && mv.y > 0.5;
    const speedMul = this.sprinting ? C.sprintMultiplier : this.aiming ? C.aimMoveMultiplier : 1;
    const target = _v3.set(0, 0, 0).addScaledVector(fwd, mv.y).addScaledVector(right, mv.x).multiplyScalar(C.walkSpeed * speedMul);
    const k = 1 - Math.exp(-C.accel * dt);
    this.velocity.lerp(target, k);
    if (this.locked) this.velocity.multiplyScalar(0.5);
    this.position.addScaledVector(this.velocity, dt);
    this.collide();

    // --- footsteps and head bob ---
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.4;
    if (moving) {
      this.bobPhase += dt * speed * 3.2;
      this.stepTimer -= dt * (speed / C.walkSpeed);
      if (this.stepTimer <= 0) {
        this.stepTimer = C.stepInterval;
        const surface = this.floorTypeAt(this.position.x, this.position.z);
        const loud = this.sprinting ? C.sprintStepVolume : 1;
        this.audio.play(surface === 'rug' ? 'footRug' : 'footWood', { volume: Math.min(1.2, (0.55 + 0.25 * Math.min(1, speed / C.walkSpeed)) * loud), reverb: 0.15 });
      }
    } else {
      this.stepTimer = Math.min(this.stepTimer, 0.12);
      this.bobPhase *= 0.9;
    }
    this.bobAmp = THREE.MathUtils.lerp(this.bobAmp ?? 1, this.sprinting ? C.sprintBob : this.aiming ? 0.4 : 1, 1 - Math.exp(-6 * dt));
    const bob = Math.sin(this.bobPhase) * C.headBob * Math.min(1, speed / C.walkSpeed) * this.bobAmp;
    const sway = Math.cos(this.bobPhase * 0.5) * C.headBob * 0.5 * Math.min(1, speed / C.walkSpeed) * this.bobAmp;

    // --- camera ---
    this.shake *= Math.exp(-6 * dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    const sh = this.shake;
    const deadDrop = this.dead ? 1.2 : 0;
    this.camera.position.set(
      this.position.x + right.x * sway + (Math.random() - 0.5) * sh * 0.04,
      this.position.y + C.eyeHeight + bob - deadDrop + (Math.random() - 0.5) * sh * 0.04,
      this.position.z + right.z * sway,
    );
    this.camera.rotation.set(this.pitch + this.recoil + (Math.random() - 0.5) * sh * 0.02, this.yaw, this.dead ? 0.5 : 0);
  }

  collide() {
    const p = this.position, r = C.radius;
    // stay inside the cabin
    p.x = THREE.MathUtils.clamp(p.x, -CABIN.halfX + r, CABIN.halfX - r);
    p.z = THREE.MathUtils.clamp(p.z, -CABIN.halfZ + r, CABIN.halfZ - r);
    // push out of furniture boxes (circle vs box), a few passes for corners
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.colliders) {
        const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
        const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
          } else {
            // centre inside the box: push out along the shallowest side
            const opts = [[b.minX - r - p.x, 0], [b.maxX + r - p.x, 0], [0, b.minZ - r - p.z], [0, b.maxZ + r - p.z]];
            opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
            p.x += opts[0][0]; p.z += opts[0][1];
          }
        }
      }
    }
  }

  damage(amount) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.shake = Math.min(1.5, this.shake + amount / 20);
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 30);
    this.audio.play('playerHurt', { volume: 0.9 });
    this.events.emit('playerHurt', { amount, health: this.health });
    if (this.health <= 0) this.dead = true;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
