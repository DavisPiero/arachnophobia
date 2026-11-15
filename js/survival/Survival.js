// Survival's own rules on top of the shared cabin night (SURVIVAL.md S1): the door, going outside, the day cycle,
// gathering and unpacking. The game owns one of these and calls it every frame; in Waves mode it is switched off and
// the cabin behaves as it always did (door boarded, no day, no leaving).
import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { DOOR, CABIN } from '../world/Layout.js';
import { groundHeight } from '../world/Forest.js';
import { DayCycle } from './DayCycle.js';
import { Pickups } from './Pickups.js';

const S = Config.survival;
const DOOR_LOOK = DOOR.center.clone().setY(1.05);
const OPEN_ANGLE = 1.5;   // radians the door swings in

export class Survival {
  constructor(game) {
    this.game = game;
    const { world, waves, events, scene, camera, audio, player, spiders } = game;
    this.door = world.cabin.door;
    this.cycle = new DayCycle({ waves, lighting: world.lighting, events });
    this.pickups = new Pickups({ scene, obstacles: world.forest.obstacles, groundAt: groundHeight, camera, audio, events });
    player.obstacles = world.forest.obstacles;
    player.groundAt = groundHeight;
    player.leash = S.leash;
    spiders.obstacles = world.forest.obstacles;
    // the door glows when you can use it: its own materials, so the rest of the cabin's wood does not glow with it
    this.door.pivot.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    world.cabin.interactables.door = this.door.pivot;
    this.active = false;
    this.doorOpen = false;
    this.doorK = 0;            // 0 shut .. 1 open (animated)
    this.wasOutside = false;
    events.on('dayPhase', ({ phase, day }) => this.onPhase(phase, day));
  }

  /** Survival on or off (the menu's mode). */
  setActive(on) {
    this.active = on;
    this.cycle.setActive(on);
    this.game.player.canLeave = on;
    this.game.spiders.hunt.on = on;
    this.game.firewood.perWave = on ? Config.modes.survival.logsPerWave : undefined;
    this.door.boards.visible = !on;
    this.reset();
  }

  reset() {
    this.cycle.reset();
    this.cycle.setActive(this.active);
    this.pickups.reset();
    if (this.active) this.pickups.scatter();
    this.doorOpen = false; this.doorK = 0;
    this.applyDoor();
    this.wasOutside = false;
  }

  /** Daylight 0..1 (0 in Waves). */
  get light() { return this.active ? this.cycle.light : 0; }
  /** The waves only run at night (in Waves mode they always run). */
  get wavesRun() { return !this.active || this.cycle.isNight; }

  onPhase(phase, day) {
    const hud = this.game.hud;
    if (phase === 'dusk') {
      hud.flash('Dusk', this.game.player.outside ? 'Get back inside. They come with the dark.' : 'They come with the dark.', 4);
      this.game.audio.play('distantUnknown', { volume: 0.6 });
    }
    if (phase === 'day') {
      this.pickups.scatter();
      hud.flash(`Day ${day}`, 'You lived through the night. Go out while it is light.', 4);
    }
  }

  /** First words of a Survival run. */
  started() {
    this.game.hud.flash('Day 1', 'Gather what you can. Be inside before dark.', 4);
    this.game.hud.hint('door', `The door opens (${this.game.hud.key('interact', 'USE')}). Wood, ammo tins and yarrow lie out in the forest.`, 8);
  }

  // ---------------------------------------------------------------- the door
  nearDoor() {
    const p = this.game.player.position;
    return Math.abs(p.x - DOOR.center.x) < 1.6 && Math.abs(p.z - (CABIN.halfZ + CABIN.wallThickness / 2)) < 1.7;
  }
  doorPrompt() {
    if (!this.nearDoor() || this.game.player.dead) return null;
    if (!this.active) return null;
    return { title: 'Door', target: 'door', at: DOOR_LOOK, r: 0.5, text: this.doorOpen ? 'Close the door' : this.cycle.isNight ? 'Open the door · they are out there' : 'Open the door', can: true };
  }
  toggleDoor() {
    this.doorOpen = !this.doorOpen;
    this.game.audio.play('cabinCreak', { volume: 0.7, exterior: false });
    if (!this.doorOpen) setTimeout(() => this.game.audio.play('boardHit', { volume: 0.25, exterior: false }), 380);
  }
  applyDoor() {
    this.door.pivot.rotation.y = OPEN_ANGLE * (this.doorK * this.doorK * (3 - 2 * this.doorK));
    // shut: the door stops you; open (more than a little): the way is clear
    const c = this.door.collider;
    const leaf = this.door.leaf, open = this.doorK > 0.6;
    if (open) { c.minX = c.maxX = 1e6; } else { c.minX = this.door.closed.minX; c.maxX = this.door.closed.maxX; }
    if (this.doorK > 0.95) { leaf.minX = this.door.open.minX; leaf.maxX = this.door.open.maxX; } else { leaf.minX = leaf.maxX = 1e6; }
  }

  // ---------------------------------------------------------------- per frame
  /** The survival prompts (door, a thing to pick up), or null. */
  prompt(lookingAt) {
    if (!this.active) return null;
    const d = this.doorPrompt();
    if (d && lookingAt(d.at, d.r) > 0) { this.pickups.target = null; return d; }
    return this.game.player.outside ? this.pickups.prompt() : (this.pickups.target = null);
  }
  use(target) {
    if (target === 'door') { this.toggleDoor(); return true; }
    if (target === 'pickup') {
      const label = this.pickups.take();
      if (label) this.game.hud.toast(`${label} · pack ${this.pickups.pack.length}/${S.pack}`);
      return true;
    }
    return false;
  }

  update(dt) {
    if (!this.active) { this.game.windows.extraOpen = 0; return; }
    this.cycle.update(dt);
    const g = this.game, p = g.player;
    this.doorK = THREE.MathUtils.clamp(this.doorK + (this.doorOpen ? dt : -dt) / 0.6, 0, 1);
    this.applyDoor();
    // standing outside you hear the forest plainly; an open door lets some of it in
    g.windows.extraOpen = p.outside ? 1 : 0.35 * this.doorK;
    // back inside: the pack is emptied onto the woodpile and the tables
    const out = p.outside;
    if (this.wasOutside && !out) {
      const got = this.pickups.unpack(g);
      if (got) {
        const parts = [];
        if (got.logs) parts.push(`${got.logs} log${got.logs > 1 ? 's' : ''}`);
        if (got.rounds) parts.push(`${got.rounds} rounds, ${got.shells} shells`);
        if (got.bandages) parts.push(`${got.bandages} bandage${got.bandages > 1 ? 's' : ''}`);
        g.hud.toast(`Unpacked · ${parts.join(' · ')}`, 3);
      }
    }
    this.wasOutside = out;
    this.pickups.update(dt, g.time);
  }

  /** What the wall clock says by day (null at night: the waves have their own reading). */
  clockText(mmss) {
    const c = this.cycle;
    if (c.phase === 'day') return `Day ${c.day} · ${mmss(c.left)} until dusk`;
    if (c.phase === 'dusk') return `Dusk · dark in ${mmss(c.left)}`;
    if (c.phase === 'dawn') return `Dawn · day ${c.day + 1}`;
    return null;
  }
}
