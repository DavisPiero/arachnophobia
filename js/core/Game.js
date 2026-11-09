// Owns every system and runs the game states: loading -> title -> playing <-> paused -> gameover.
import * as THREE from 'three';
import { Config } from './Config.js';
import { Quality, isTouch } from './Quality.js';
import { events } from './Events.js';
import { buildWorld } from '../world/World.js';
import { LANTERN, WINDOWS } from '../world/Layout.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Director } from '../audio/Director.js';
import { Input } from '../input/Input.js';
import { Player } from '../player/Player.js';
import { Weapon } from '../player/Weapon.js';
import { Melee } from '../player/Melee.js';
import { Gore } from '../fx/Gore.js';
import { AmmoTable } from '../player/AmmoTable.js';
import { Flashlight } from '../player/Flashlight.js';
import { WindowSystem } from '../systems/WindowSystem.js';
import { EyesSystem } from '../systems/EyesSystem.js';
import { SpiderManager } from '../spiders/SpiderAI.js';
import { WaveSystem } from '../spiders/WaveSystem.js';
import { PostFX } from '../fx/PostFX.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { loadSpiderModels } from '../spiders/SpiderModel.js';

const params = new URLSearchParams(location.search);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.debug = params.has('debug');
    this.events = events;

    // --- renderer, scene, camera ---
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Quality.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = Quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 180);
    this.scene.add(this.camera);

    // --- systems ---
    this.audio = new AudioEngine(this.camera);
    this.world = buildWorld(this.scene, renderer, Quality, events);
    this.input = new Input(canvas, document.getElementById('touch-ui'));
    this.player = new Player(this.camera, this.audio, events);
    this.player.colliders = this.world.cabin.colliders;
    this.player.floorTypeAt = this.world.cabin.floorTypeAt;
    this.windows = new WindowSystem({ scene: this.scene, audio: this.audio, events, camera: this.camera });
    this.weapon = new Weapon({ camera: this.camera, audio: this.audio, events, lighting: this.world.lighting, player: this.player });
    this.scene.add(this.weapon.holeGroup);
    this.table = new AmmoTable({ player: this.player, weapon: this.weapon, audio: this.audio, events, tableVisual: this.world.cabin.ammoTable });
    this.flashlight = new Flashlight({ camera: this.camera, audio: this.audio, events, quality: Quality });
    this.eyes = new EyesSystem({ scene: this.scene, audio: this.audio });
    this.spiders = new SpiderManager({ scene: this.scene, audio: this.audio, events, quality: Quality, windows: this.windows, colliders: this.world.cabin.colliders });
    this.spiders.flashlight = this.flashlight;
    this.gore = new Gore({ scene: this.scene, events, windows: this.windows, quality: Quality });
    this.spiders.gore = this.gore;
    this.melee = new Melee({ player: this.player, weapon: this.weapon, camera: this.camera, audio: this.audio, events, windows: this.windows, spiders: this.spiders });
    this.waves = new WaveSystem({ spiders: this.spiders, events, quality: Quality, player: this.player });
    this.director = new Director(this.audio, events);
    this.postfx = new PostFX(renderer, this.scene, this.camera, this.weapon.viewScene, Quality);
    this.hud = new HUD(isTouch);
    this.menu = new Menu(this.audio);

    // meshes that stop bullets: the cabin itself and the window boards
    this.cabinMeshes = [];
    this.world.cabin.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) this.cabinMeshes.push(o); });

    this.danger = 0;
    this.kills = 0;
    this.overTimer = 0;
    this.time = 0;
    this.wireEvents();
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    if (this.debug) this.setupDebug();
    window.game = this; // handy for headless tests and debugging
  }

  wireEvents() {
    const $ = (id) => document.getElementById(id);
    // the Begin button: also the audio unlock gesture
    const begin = (e) => { e.preventDefault(); this.start(); };
    $('btn-start').addEventListener('click', begin);
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-restart').addEventListener('click', () => { this.restart(); this.resume(); });
    $('btn-again').addEventListener('click', () => { this.restart(); this.resume(); });
    $('btn-pause').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pause(); });
    $('btn-mute').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggleMute(); });
    this.input.keyboard.onLockChange = (locked) => {
      // Esc releases the mouse: treat that as pause on desktop
      if (!locked && this.state === 'playing' && !isTouch) this.pause();
    };

    events.on('spiderKilled', () => { this.kills++; });
    events.on('waveStart', ({ wave }) => this.hud.flash(`Wave ${wave}`, wave === 1 ? 'Listen.' : '', 3));
    events.on('waveEnd', ({ wave }) => this.hud.flash('Silence', `Wave ${wave} survived · supplies on the table`, 4));
    events.on('windowBreached', ({ id }) => {
      const w = WINDOWS.find((x) => x.id === id);
      this.hud.flash(`The ${w.label.toLowerCase()} window is broken`, '', 3);
    });
  }

  async init() {
    this.menu.setLoading('Building sounds…');
    try { await this.audio.init(); } catch (err) { console.error('audio init failed', err); }
    this.menu.setLoading('Carving rocks…');
    await Promise.all([this.world.loadAssets(), this.weapon.loadAssets(Quality),
      loadSpiderModels(Quality).then((t) => { this.spiderModels = t; })]);
    this.state = 'title';
    this.menu.ready();
    this.loop();
    if (params.has('autostart')) this.start(false);
  }

  start(fromGesture = true) {
    if (this.state !== 'title') return;
    this.audio.unlock();
    this.director.start();
    this.menu.showStart(false);
    this.resume(fromGesture);
  }

  resume(fromGesture = true) {
    this.state = 'playing';
    this.menu.showPause(false);
    this.menu.showOver(false);
    this.hud.show(true);
    document.body.classList.add('playing');
    this.input.setEnabled(true);
    if (!isTouch && fromGesture) this.input.keyboard.requestLock();
    this.audio.listener?.context.resume?.();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.input.keyboard.exitLock();
    document.body.classList.remove('playing');
    this.menu.showPause(true);
    this.audio.listener?.context.suspend?.();
  }

  gameOver() {
    this.state = 'gameover';
    this.input.setEnabled(false);
    this.input.keyboard.exitLock();
    document.body.classList.remove('playing');
    this.menu.showOver(true, { wave: this.waves.wave, kills: this.kills });
    events.emit('gameOver', { wave: this.waves.wave, kills: this.kills });
  }

  restart() {
    this.spiders.reset();
    this.windows.reset();
    this.player.reset();
    this.weapon.reset();
    this.table.reset();
    this.eyes.reset();
    this.flashlight.reset();
    this.melee.reset();
    this.gore.clear();
    this.waves.reset();
    this.kills = 0;
    this.overTimer = 0;
  }

  toggleMute() { this.audio.setMuted(!this.audio.muted); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep a sensible horizontal view on tall/narrow screens
    this.baseFov = w / h < 1.2 ? 80 : 72;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
    this.lastT = now;
    this.update(dt);
    this.postfx.render(dt, { hurt: this.player.hurtFlash, lowHealth: this.player.health < 35 ? 1 - this.player.health / 35 : 0 });
    if (this.debug) this.updateDebug(dt);
  };

  update(dt) {
    const input = this.input;
    if (input.consume('mute')) this.toggleMute();
    if (input.consume('pause') && this.state === 'playing') this.pause();

    const playing = this.state === 'playing';
    const simulate = playing || this.state === 'gameover';
    if (this.state === 'title') {
      // slow drift on the title screen so the scene is alive behind the menu
      this.player.yaw = Math.sin(now() * 0.05) * 0.6;
    }

    if (playing) {
      if (input.consume('interact')) this.table.tryStart();
      if (input.consume('rifle')) this.weapon.select('rifle');
      if (input.consume('axe')) this.weapon.select('axe');
      if (input.consume('swap')) this.weapon.toggle();
      // left click / FIRE uses whatever is in your hands; holding it keeps swinging the axe
      const fire = input.consume('fire');
      if (this.weapon.held === 'axe') { if (fire || input.fireHeld) this.melee.tryAxe(); }
      else if (fire) this.weapon.tryFire();
      if (input.consume('stomp')) this.melee.tryStomp();
      if (input.consume('torch')) this.flashlight.toggle();
    }
    this.time += simulate ? dt : 0;
    this.player.update(simulate ? dt : 0, input);
    if (simulate) {
      this.table.update(dt);
      this.melee.update(dt);
      const calmBefore = this.waves.phase === 'calm' ? this.waves.timer : null;
      this.waves.update(dt);
      // deliberate silence in the seconds before a wave arrives
      if (calmBefore !== null && calmBefore > 14 && this.waves.timer <= 14) this.director.silence?.(14);
      this.spiders.update(dt, this.player);
      this.eyes.update(dt);
      this.weapon.targets = this.spiders.targets;
      this.weapon.worldMeshes = this.cabinMeshes.concat(this.windows.boardMeshes());
      this.danger += (this.spiders.danger(this.player) - this.danger) * (1 - Math.exp(-dt * 0.8));
      this.eyes.rate = 0.6 + this.danger * 1.2;
      this.director.update(dt, {
        danger: this.danger,
        playerPos: this.player.position,
        playerForward: this.player.forward(new THREE.Vector3()),
        waveActive: this.waves.phase === 'wave',
        betweenWaves: this.waves.betweenWaves,
        spiders: this.spiders.summary(),
      });
      if (this.player.dead && this.state === 'playing') {
        this.overTimer += dt;
        if (this.overTimer > 2.5) this.gameOver();
      }
    }
    this.windows.update(dt, this.camera.position, this.scene);
    this.world.update(simulate ? dt : dt * 0.3, this.time);
    const moving = Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.4;
    this.weapon.update(dt, input, moving);
    this.flashlight.update(dt, this.danger);
    // aiming down sights: a gentle zoom, slower look; running: a touch wider
    const fovK = THREE.MathUtils.lerp(1, Config.weapon.aimFov, this.weapon.aimK) * (1 + 0.04 * this.weapon.sprintK);
    const fov = this.baseFov * fovK;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.player.lookScale = THREE.MathUtils.lerp(1, Config.weapon.aimLookScale, this.weapon.aimK);
    this.hud.setAim(this.weapon.aimK > 0.6);
    this.input.touch.setTorchOn(this.flashlight.on);
    // the gun picks up the lantern's warmth depending on how close you are to it
    const dl = this.camera.position.distanceTo(LANTERN.position);
    this.weapon.viewKey.intensity = 0.5 + 2.6 / (1 + dl * dl * 0.35) * (this.world.lighting.lantern.intensity / (this.lanternBase ||= this.world.lighting.lantern.intensity || 1))
      + this.flashlight.level * 1.2;
    this.audio.update(dt);

    // HUD
    const prompt = playing ? this.table.prompt() : null;
    this.input.touch.setInteractAvailable(!!prompt?.can, this.table.reloading ? '…' : 'USE');
    this.hud.update(dt, {
      mag: this.weapon.mag, stock: this.table.stock, health: this.player.health,
      prompt, reloadT: this.weapon.reloadT, reloading: this.table.reloading, muted: this.audio.muted, held: this.weapon.want,
    });
    this.input.touch.setHeld(this.weapon.want);
    input.endFrame();
  }

  // ---------------- debug helpers (?debug=1) ----------------
  setupDebug() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:8px;font:11px monospace;color:#9f9;z-index:99;pointer-events:none;white-space:pre;text-shadow:0 0 2px #000';
    document.body.appendChild(el);
    this.debugEl = el;
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    addEventListener('keydown', (e) => {
      const types = { Digit1: 'runner', Digit2: 'brute', Digit3: 'climber', Digit4: 'stalker' };
      if (types[e.code]) this.spiders.spawn(types[e.code], WINDOWS[Math.floor(Math.random() * 3)].id);
      if (e.code === 'KeyK') for (const s of this.spiders.spiders) if (s.alive) s.die();
      if (e.code === 'KeyI') { // a runner right in front of you, inside (to try the stomp and the axe)
        const s = this.spiders.spawn('runner', 'north');
        if (s) { const f = this.player.forward(new THREE.Vector3()); s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(this.player.position.x + f.x * 1.1, 0, this.player.position.z + f.z * 1.1); }
      }
      if (e.code === 'KeyB') for (const w of this.windows.windows) this.windows.damage(w.id, 30);
      if (e.code === 'KeyJ') events.emit('lightning', { strength: 1 });
    });
  }
  updateDebug(dt) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    const i = this.renderer.info;
    this.debugEl.textContent = `${this.fps} fps  ${Quality.tier}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\nwave ${this.waves.wave} ${this.waves.phase}  spiders ${this.spiders.aliveCount}\ndanger ${this.danger.toFixed(2)}\n1-4 spawn  I runner inside  K kill  B damage windows  J lightning`;
  }
}

function now() { return performance.now() / 1000; }
