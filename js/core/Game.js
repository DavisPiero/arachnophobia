// Owns every system and runs the game states: boot -> loading -> title -> playing <-> paused -> gameover.
// boot waits for the first click/tap/key (it unlocks sound), loading shows the boot log, title is the main menu.
import * as THREE from 'three';
import { Config } from './Config.js';
import { Quality, isTouch } from './Quality.js';
import { events } from './Events.js';
import { buildWorld } from '../world/World.js';
import { LANTERN, WINDOWS, WALL_CLOCK, MED_TABLE, AMMO_TABLE, BED } from '../world/Layout.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Director } from '../audio/Director.js';
import { Input } from '../input/Input.js';
import { Player } from '../player/Player.js';
import { Weapon } from '../player/Weapon.js';
import { Melee } from '../player/Melee.js';
import { Gore } from '../fx/Gore.js';
import { AmmoTable } from '../player/AmmoTable.js';
import { Healing } from '../player/Healing.js';
import { Arsenal } from '../player/Arsenal.js';
import { Flares } from '../player/Flares.js';
import { Inventory } from '../ui/Inventory.js';
import { WallClock } from '../world/WallClock.js';
import { Flashlight } from '../player/Flashlight.js';
import { WindowSystem } from '../systems/WindowSystem.js';
import { EyesSystem } from '../systems/EyesSystem.js';
import { SpiderManager } from '../spiders/SpiderAI.js';
import { WaveSystem } from '../spiders/WaveSystem.js';
import { PostFX } from '../fx/PostFX.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { MenuScene, quadTransform, SCREEN_W, SCREEN_H } from '../ui/MenuScene.js';
import { loadSpiderModels } from '../spiders/SpiderModel.js';
import { Music } from '../audio/Music.js';
import { Firewood } from '../systems/Firewood.js';
import { Settings, onSettingsChange } from './Settings.js';

const params = new URLSearchParams(location.search);

const _clockTo = new THREE.Vector3(), _clockFwd = new THREE.Vector3(), _lookTo = new THREE.Vector3();
// where each thing you can use is, for "are you looking at it" (point, rough radius in metres)
const LOOK = {
  med: [MED_TABLE.position.clone().setY(0.85), 0.45],
  ammo: [AMMO_TABLE.position.clone().setY(0.8), AMMO_TABLE.size.x / 2],
  bed: [BED.position.clone().setY(0.4), 0.9],
};
const REST_TIPS = [
  'Feed the stove before you sleep. The dark brings them closer.',
  'A plank nailed back now is a plank they have to tear off again.',
  'Small ones die to a stomp. Save your rounds.',
  'Bandages are on the medical table, beside the ammo.',
  'Listen. They tell you which window before you see them.',
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'boot';
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
    this.arsenal = new Arsenal({ events });
    this.weapon.arsenal = this.arsenal;
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
    this.flares = new Flares({ scene: this.scene, camera: this.camera, windows: this.windows, weapon: this.weapon, arsenal: this.arsenal, audio: this.audio, events, player: this.player });
    this.healing = new Healing({ player: this.player, weapon: this.weapon, waves: this.waves, audio: this.audio, events });
    this.firewood = new Firewood({ player: this.player, weapon: this.weapon, windows: this.windows, spiders: this.spiders, lighting: this.world.lighting, audio: this.audio, events, camera: this.camera });
    this.clock = new WallClock(this.scene);
    this.director = new Director(this.audio, events);
    this.postfx = new PostFX(renderer, this.scene, this.camera, this.weapon.viewScene, Quality);
    this.hud = new HUD(isTouch);
    this.menuScene = new MenuScene(renderer, Quality);
    this.music = new Music(this.audio);
    this.menu = new Menu(this.audio, this.input.keyboard);
    this.menu.onOptions = () => this.postfx.setOptions(Settings);
    this.inventory = new Inventory({ arsenal: this.arsenal, weapon: this.weapon, isTouch });
    this.healing.atTable = () => this.nearMed();
    this.inventory.supplies = () => ({ bandages: this.healing.bandages });
    this.inventory.onClose = () => { this.input.endFrame(); this.resume(); };
    this.postfx.setOptions(Settings);
    onSettingsChange((key) => { if (key === 'fov') this.resize(); this.applyHudSettings(); });
    this.heartT = 0;

    // meshes that stop bullets: the cabin itself and the window boards
    this.cabinMeshes = [];
    this.world.cabin.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) this.cabinMeshes.push(o); });

    this.danger = 0;
    this.kills = 0;
    this.overTimer = 0;
    this.time = 0;
    this.wireEvents();
    this.resize();
    this.applyHudSettings();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    if (this.debug) this.setupDebug();
    window.game = this; // handy for headless tests and debugging
  }

  wireEvents() {
    const $ = (id) => document.getElementById(id);
    // the Begin button: also the audio unlock gesture
    // picking begin plays the loading screen again; pointer lock is asked for now, inside the click
    const begin = async (e) => {
      e.preventDefault();
      if (this.state !== 'title' || this.entering) return;
      this.entering = true;
      this.audio.unlock();
      this.music.stop();
      if (!isTouch) this.input.keyboard.requestLock();
      await this.menu.runEnter();
      // the loading screen's own cut already left the view black; hold that (no transition) across the
      // scene switch, then fade up into the cabin instead of popping straight to full brightness
      const fade = $('enter-fade');
      fade.classList.add('instant', 'on');
      this.entering = false;
      this.start(false);
      requestAnimationFrame(() => requestAnimationFrame(() => { fade.classList.remove('instant'); fade.classList.remove('on'); }));
    };
    $('btn-start').addEventListener('click', begin);
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-inventory-pause').addEventListener('click', () => { this.menu.showPause(false); this.inventory.show(); });
    $('btn-restart').addEventListener('click', () => { this.restart(); this.resume(); });
    $('btn-again').addEventListener('click', () => { this.restart(); this.resume(); });
    $('btn-pause').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.pause(); });
    $('btn-mute').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggleMute(); });
    this.input.keyboard.onLockChange = (locked) => {
      // Esc releases the mouse: treat that as pause on desktop
      if (!locked && this.state === 'playing' && !isTouch) this.pause();
    };

    events.on('spiderKilled', () => { this.kills++; });
    events.on('waveStart', ({ wave, last }) => {
      this.hud.flash(last ? 'The last wave' : `Wave ${wave}`, wave === 1 ? 'They are coming. Listen for where.' : last ? 'Hold on until dawn.' : '', 3);
      if (wave === 1) this.hud.hint('fists', isTouch ? 'Only your fists for now. FIRE punches, STOMP the small ones.' : `Only your fists for now. Click to punch, ${this.hud.key('stomp', '')} to stomp the small ones.`, 7);
      if (wave === 3) this.hud.hint('windows', 'Shoot through the gaps between the boards.');
    });
    events.on('weaponUnlocked', ({ name, slot }) => {
      const label = Config.arsenal.names[name];
      const how = isTouch ? 'the weapon button' : slot ? `key ${this.hud.key('slot' + slot, String(slot))}` : `the inventory (${this.hud.key('inventory', 'pause')})`;
      this.newWeapon = { title: `New: ${label.toLowerCase()}`, sub: `Take it up with ${how}.` };
      if (name === 'flare') this.hud.hint('flare', `Hold a flare and throw it at a window you are looking at. While it burns, they keep away from that window.`, 8);
      if (name === 'shotgun') this.hud.hint('shotgun', 'The shotgun loads at the ammo table too, from its own box of shells.', 6);
      this.hud.hint('inventory', `Press ${this.hud.key('inventory', 'pause → inventory')} to see your weapons. Drag them to change the order.`, 6);
    });
    events.on('waveEnd', ({ wave, last }) => {
      if (last) return;   // dawn has its own screen
      const nw = this.newWeapon; this.newWeapon = null;
      if (nw) { this.hud.flash(`Wave ${wave} survived`, `${nw.title} · ${nw.sub}`, 5); return; }
      this.hud.flash(`Wave ${wave} survived`, `+${Config.logs.perWave} logs · a bandage`, 4);
      if (wave === 1) this.hud.hint('logs', `Take a log from the stack by the stove (${this.hud.key('interact', 'USE')}): feed the fire, or nail it over a window. Never enough for both.`, 8);
      if (wave === 1) this.hud.hint('heal', `Hurt? Bandages are on the ammo table. Or rest on the cot once a break.`, 7);
    });
    events.on('healed', () => this.hud.healBurst());
    events.on('fireFed', () => this.hud.toast('The fire takes it'));
    events.on('windowRepaired', () => this.hud.toast('Plank nailed back'));
    events.on('reloadStart', () => this.hud.toast('Reloading'));
    events.on('dawn', () => { this.dawnTimer = 3; this.hud.flash('Dawn', 'The light is coming up through the trees.', 3); });
    events.on('dryFire', () => {
      this.hud.notice('NO AMMO', 'Reload at the ammo table');
      this.hud.hint('reload', `Your rounds are on the ammo table. Stand at it and press ${this.hud.key('interact', 'USE')} to reload.`, 6);
    });
    events.on('windowDamaged', ({ stage }) => { if (stage === 1) this.hud.hint('crack', `A plank is gone. Bring a log from the stack and press ${this.hud.key('interact', 'USE')}.`); });
    events.on('windowBreached', ({ id }) => {
      const w = WINDOWS.find((x) => x.id === id);
      this.hud.flash(`The ${w.label.toLowerCase()} window is broken`, '', 3);
    });
  }

  async init() {
    // loading starts at once, behind the boot gate
    const loaded = (async () => {
      this.menu.setLoading('building sounds');
      try { await this.audio.init(); } catch (err) { console.error('audio init failed', err); }
      this.menu.setLoading('loading models');
      await Promise.all([this.world.loadAssets(), this.weapon.loadAssets(Quality),
        loadSpiderModels(Quality).then((t) => { this.spiderModels = t; })]);
      this.menu.setLoading('models ok');
    })();
    if (params.has('autostart')) {
      // tests and quick looks: no gate, no loading screen, no music
      document.getElementById('screen-boot').classList.add('hidden');
      await loaded;
      this.state = 'title';
      this.menu.ready();
      this.loop();
      this.start(false);
      return;
    }
    if (params.has('menu')) {
      // straight to the main menu (screenshots of the menu scene)
      document.getElementById('screen-boot').classList.add('hidden');
      await loaded;
      this.state = 'title'; this.menu.ready(); this.menu.showMain(); this.loop();
      return;
    }
    await this.menu.waitForWake();
    this.audio.unlock();          // inside the gesture: sound may start from here on
    this.music.start();
    this.state = 'loading';
    await this.menu.runLoading(loaded);
    this.music.kickIn();
    this.state = 'title';
    this.menu.ready();
    this.menu.showMain();
    this.loop();
  }

  start(fromGesture = true) {
    if (this.state !== 'title') return;
    this.audio.unlock();
    this.music.stop();
    this.director.start();
    this.menu.showStart(false);
    this.hud.hint('start', 'Nothing but your fists tonight, at first. Better weapons come as the night goes on.', 6);
    this.resume(fromGesture);
  }

  resume(fromGesture = true) {
    this.state = 'playing';
    this.menu.showPause(false);
    this.menu.showOver(false);
    this.inventory.screen.classList.add('hidden');
    this.hud.show(true);
    document.body.classList.add('playing');
    this.input.setEnabled(true);
    if (!isTouch && fromGesture) this.input.keyboard.requestLock();
    this.audio.listener?.context.resume?.();
  }

  /** The inventory: pauses like the pause menu, but shows the weapons instead. */
  openInventory() {
    if (this.state !== 'playing') return;
    this.pause();
    this.menu.showPause(false);
    this.inventory.show();
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
    const dawn = this.waves.phase === 'dawn';
    this.menu.showOver(true, { wave: this.waves.wave, kills: this.kills, dawn });
    events.emit('gameOver', { wave: this.waves.wave, kills: this.kills, dawn });
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
    this.flares.reset();
    this.arsenal.reset();
    this.newWeapon = null;
    this.gore.clear();
    this.waves.reset();
    this.healing.reset();
    this.firewood.reset();
    this.dawnTimer = 0;
    this.kills = 0;
    this.overTimer = 0;
  }

  toggleMute() { this.audio.setMuted(!this.audio.muted); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep a sensible horizontal view on tall/narrow screens
    this.baseFov = Settings.fov + (w / h < 1.2 ? 8 : 0);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
    this.menuScene?.resize(w, h);
  }

  applyHudSettings() {
    const hud = document.getElementById('hud');
    hud.style.opacity = Settings.hudOpacity;
    document.getElementById('crosshair').style.display = Settings.crosshair ? '' : 'none';
    document.getElementById('fps').classList.toggle('hidden', !Settings.showFps);
  }

  /** Main menu: the 3D lab renders, and the menu HTML (and settings, if open) is warped onto the left monitor. */
  renderTitle(dt) {
    this.menuScene.update(dt);
    this.menuScene.render();
    const m = quadTransform(SCREEN_W, SCREEN_H, this.menuScene.screenQuad());
    for (const el of this.onScreenEls ||= [document.getElementById('menu-screen'), document.querySelector('#screen-settings .term-panel')]) el.style.transform = m;
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
    this.lastT = now;
    if (Settings.showFps) {
      this.fpsN = (this.fpsN || 0) + 1; this.fpsT = (this.fpsT || 0) + dt;
      if (this.fpsT > 0.5) { document.getElementById('fps').textContent = `${Math.round(this.fpsN / this.fpsT)} fps`; this.fpsN = 0; this.fpsT = 0; }
    }
    this.update(dt);
    const title = this.state === 'title';
    document.body.classList.toggle('title', title);
    if (title) { this.renderTitle(dt); if (this.debug) this.updateDebug(dt); return; }
    for (const el of this.onScreenEls || []) el.style.transform = '';
    this.postfx.render(dt, { hurt: this.player.hurtFlash, hurtDir: this.player.hurtDir, lowHealth: this.player.health < 35 ? 1 - this.player.health / 35 : 0 });
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
      if (input.consume('interact') && !this.healing.busy && !this.firewood.busy) {
        const t = this.currentPrompt()?.target;
        if (t === 'stove' || t === 'woodpile' || t === 'window') { const had = this.firewood.carrying; if (this.firewood.tryStart() && !had && this.firewood.carrying) this.hud.toast('Log in hand'); }
        else if (t === 'med') { if (this.healing.tryBandage() === 'ok') this.hud.toast('Bandaging'); }
        else if (t === 'ammo') this.table.tryStart();
        else if (t === 'bed') this.healing.tryBed();
      }
      if (input.consume('bandage')) {
        const r = this.healing.tryBandage();
        if (r === 'ok') this.hud.toast('Bandaging');
        else if (r === 'none') this.hud.notice('NO BANDAGES', 'You get one for every wave you survive');
        else if (r === 'full') this.hud.notice('NOT HURT');
        else if (r === 'table') this.hud.notice('BANDAGES ARE ON THE MEDICAL TABLE');
      }
      for (let n = 1; n <= 5; n++) if (input.consume('slot' + n)) {
        const w = this.arsenal.atSlot(n), name = this.arsenal.slots[n - 1];
        if (w) this.weapon.select(w);
        else if (name) this.hud.notice(Config.arsenal.names[name].toUpperCase(), `Comes at wave ${Config.arsenal.unlock[name]}`);
      }
      if (input.consume('swap')) this.weapon.select(this.arsenal.next(this.weapon.want));
      if (input.consume('swapBack')) this.weapon.select(this.arsenal.next(this.weapon.want, -1));
      if (input.consume('inventory')) { this.openInventory(); input.endFrame(); return; }
      // left click / FIRE uses whatever is in your hands; holding it keeps punching or swinging the axe
      const fire = input.consume('fire');
      const held = this.weapon.held;
      if (held === 'axe') { if (fire || input.fireHeld) this.melee.tryAxe(); }
      else if (held === 'fists') { if (fire || input.fireHeld) this.melee.tryPunch(); }
      else if (held === 'flare') {
        if (fire) {
          const why = this.flares.tryThrow();
          if (why === 'aim') this.hud.notice('LOOK AT A WINDOW', 'Throw it at a window close by');
          else if (why === 'lit') this.hud.notice('A FLARE IS BURNING THERE');
          else if (why === 'none') this.hud.notice('NO FLARES', 'You get one for every wave you survive');
        }
      } else if (fire) this.weapon.tryFire();
      if (input.consume('stomp')) this.melee.tryStomp();
      if (input.consume('torch')) this.flashlight.toggle();
    }
    this.time += simulate ? dt : 0;
    this.player.update(simulate ? dt : 0, input);
    this.updateRest();
    if (simulate) {
      this.table.update(dt);
      this.healing.update(dt);
      this.firewood.update(dt);
      this.melee.update(dt);
      this.flares.update(dt);
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
      // low health: a heartbeat you can feel
      if (this.player.health < 35 && !this.player.dead) {
        this.heartT -= dt;
        if (this.heartT <= 0) { this.audio.play('heartbeat', { volume: 0.5 + 0.5 * (1 - this.player.health / 35), exterior: false }); this.heartT = 0.7 + this.player.health / 35 * 0.5; }
      }
      this.clock.set(this.waves.clockHours);
      if (this.dawnTimer > 0 && this.state === 'playing') { this.dawnTimer -= dt; if (this.dawnTimer <= 0) this.gameOver(); }
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
    this.weapon.viewKey.intensity = Config.render.viewKeyMin + 2.0 / (1 + dl * dl * 0.35) * (this.world.lighting.lantern.intensity / (this.lanternBase ||= this.world.lighting.lantern.intensity || 1))
      + this.flashlight.level * 1.2;
    this.audio.update(dt);

    // HUD
    const prompt = playing ? this.currentPrompt() : null;
    const clockText = playing ? this.clockReading() : null;
    this.updateHighlight(dt, prompt?.target || (clockText ? 'clock' : null));
    this.hud.setClock(clockText);
    const bandageMeshes = this.world.cabin.medBandages || [];
    bandageMeshes.forEach((m, i) => { m.visible = i < this.healing.bandages; });
    this.input.touch.setInteractAvailable(!!prompt?.can, this.table.reloading ? '…' : 'USE');
    const want = this.weapon.want, flareHeld = want === 'flare';
    const anyGun = this.arsenal.has('rifle') || this.arsenal.has('shotgun');
    const shownGun = this.weapon.isGun(want) ? want : this.arsenal.has('rifle') ? 'rifle' : 'shotgun';
    this.hud.update(dt, {
      mag: flareHeld ? this.arsenal.flares : this.weapon.ammo[shownGun], stock: this.table.stocks[shownGun], health: this.player.health,
      ammoMode: flareHeld ? 'flare' : this.weapon.isGun(want) ? 'gun' : anyGun ? 'melee' : 'none', unit: shownGun === 'shotgun' ? 'shells' : 'rounds',
      prompt, reloadT: this.weapon.reloadT, reloading: this.table.reloading, muted: this.audio.muted, held: want,
      bandages: this.healing.bandages,
      healT: this.healing.bandageT >= 0 ? this.healing.bandageT : this.healing.bedT >= 0 ? this.healing.bedT : this.firewood.progress,
    });
    const next = this.arsenal.next(want);
    this.input.touch.setNextWeapon(next !== want ? TOUCH_NAMES[next] : null);
    this.input.touch.setBandages(this.healing.bandages);
    input.endFrame();
  }

  /** What the wall clock tells you when you look at it (within 7 m, near the middle of the view), or null. */
  clockReading() {
    const eye = this.camera.position;
    const to = _clockTo.copy(WALL_CLOCK.position).sub(eye);
    const d = to.length();
    if (d > 7 || to.normalize().dot(this.camera.getWorldDirection(_clockFwd)) < 0.985 - 0.02 * WALL_CLOCK.radius / Math.max(1, d)) return null;
    const W = this.waves, C = Config.waves, mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    if (W.phase === 'wave') {
      const left = C.waveTime - W.waveT;
      return `Wave ${W.wave} of ${C.count} · ${left > 0 ? `${mmss(left)} left` : 'the last of them'}`;
    }
    if (W.phase === 'calm') return `${W.wave ? 'Break' : 'Quiet'} · wave ${W.wave + 1} in ${mmss(Math.max(0, W.timer))}`;
    return null;
  }

  nearMed() {
    const p = this.player.position;
    return Math.hypot(p.x - MED_TABLE.position.x, p.z - MED_TABLE.position.z) < MED_TABLE.interactRadius + 0.3;
  }

  /** The medical table's prompt (bandages), or null when not at it. */
  medPrompt() {
    if (!this.nearMed() || this.player.dead) return null;
    const h = this.healing;
    if (h.bandageT >= 0) return { text: 'Bandaging…', can: false };
    if (h.bandages <= 0) return { text: 'No bandages · one for each wave you survive', can: false };
    if (this.player.health >= Config.player.maxHealth) return { text: `Not hurt · ${h.bandages} bandage${h.bandages > 1 ? 's' : ''}`, can: false };
    return { text: `Bandage up · ${h.bandages} left`, can: true };
  }

  /** The one thing you can use where you stand: its prompt, with a title and what to light up (target). */
  currentPrompt() {
    // only for what you are looking at, and only when you are near it (user, 2026-11-15)
    // the one most squarely in view wins (the two tables stand side by side)
    let best = null, bm = 0;
    for (const [p, target, title] of [[this.medPrompt(), 'med', 'Medical table'], [this.table.prompt(), 'ammo', 'Ammo table'], [this.healing.bedPrompt(), 'bed', 'Cot']]) {
      if (!p) continue;
      if (!p.can && p.text.endsWith('…')) return { ...p, target, title };   // busy here: keep showing it
      const m = this.lookingAt(...LOOK[target]);
      if (m > bm) { bm = m; best = { ...p, target, title }; }
    }
    if (best) return best;
    const f = this.firewood.prompt();
    return f && (!f.at || this.lookingAt(f.at, f.r) > 0) ? f : null;
  }

  /** How squarely the view is on this point (within its radius plus a little); > 0 means you are looking at it. */
  lookingAt(point, r) {
    const to = _lookTo.copy(point).sub(this.camera.position), d = to.length();
    const ang = Math.atan2(r, d) + 0.32;   // generous: a glance at it is enough (user, 2026-11-15; was 0.14)
    return to.divideScalar(d).dot(this.camera.getWorldDirection(_clockFwd)) - Math.cos(ang);   // > 0: yes, bigger = more squarely
  }

  /** The cot: tip down into bed, fade to black for ~5 s with a tip and drifting Z's, then fade up and sit up. */
  updateRest() {
    const T = Config.heal.bed.time, h = this.healing, el = this.restEl ||= document.getElementById('rest');
    if (h.bedT < 0) { if (this.resting) { this.resting = false; el.classList.remove('on'); el.style.opacity = 0; } return; }
    if (!this.resting) { this.resting = true; el.querySelector('p').textContent = REST_TIPS[(Math.random() * REST_TIPS.length) | 0]; el.classList.add('on'); }
    const s = h.bedT * T, ease = (x) => x * x * (3 - 2 * x), cl = (x) => Math.min(1, Math.max(0, x));
    const down = s < T - 1.2 ? ease(cl(s / 1.1)) : ease(cl((T - s) / 1.1));
    this.camera.rotateX(-0.75 * down);
    this.camera.rotateZ(0.25 * down);
    this.camera.position.y -= 0.7 * down;
    el.style.opacity = s < 0.9 ? 0 : s < 1.5 ? (s - 0.9) / 0.6 : s < T - 1.5 ? 1 : cl((T - 0.9 - s) / 0.6);
  }

  /** The object you are at glows a warm gold, slowly breathing (user, 2026-11-15). */
  updateHighlight(dt, target) {
    const I = this.world.cabin.interactables; if (!I) return;
    I.clock ||= this.clock.group;
    this.hl ||= {};
    const pulse = 0.8 + 0.2 * Math.sin(this.time * 3);
    for (const [k, g] of Object.entries(I)) {
      const v = this.hl[k] = (this.hl[k] || 0) + ((k === target ? 1 : 0) - (this.hl[k] || 0)) * Math.min(1, dt * 8);
      const e = v < 0.003 ? 0 : v * pulse * Config.render.highlight;
      if (g.userData.hl === e) continue;
      g.userData.hl = e;
      g.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(1, 0.66, 0.25).multiplyScalar(e); });
    }
  }

  // ---------------- debug helpers (?debug=1) ----------------
  setupDebug() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:8px;font:11px monospace;color:#9f9;z-index:99;pointer-events:none;white-space:pre;text-shadow:0 0 2px #000';
    document.body.appendChild(el);
    this.debugEl = el;
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    addEventListener('keydown', (e) => {
      const types = { Digit1: 'runner', Digit2: 'brute', Digit3: 'climber', Digit4: 'stalker', Digit5: 'weeper' };
      if (types[e.code]) this.spiders.spawn(types[e.code], WINDOWS[Math.floor(Math.random() * 3)].id);
      if (e.code === 'KeyK') for (const s of this.spiders.spiders) if (s.alive) s.die();
      if (e.code === 'KeyG') this.arsenal.unlockUpTo(99, true);   // every weapon now
      if (e.code === 'KeyU') { // a runner right in front of you, inside (to try the stomp and the axe)
        const s = this.spiders.spawn('runner', 'north');
        if (s) { const f = this.player.forward(new THREE.Vector3()); s.state = 'inside'; s.surface = 'floor'; s.path = null; s.root.position.set(this.player.position.x + f.x * 1.1, 0, this.player.position.z + f.z * 1.1); }
      }
      if (e.code === 'KeyB') for (const w of this.windows.windows) this.windows.damage(w.id, 30);
      if (e.code === 'KeyJ') events.emit('lightning', { strength: 1 });
      if (e.code === 'KeyN') { this.waves.waveT = 999; for (const s of this.spiders.spiders) if (s.alive) s.die(); } // end this wave now
    });
  }
  updateDebug(dt) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    const i = this.renderer.info;
    this.debugEl.textContent = `${this.fps} fps  ${Quality.tier}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\nwave ${this.waves.wave} ${this.waves.phase}  spiders ${this.spiders.aliveCount}\ndanger ${this.danger.toFixed(2)}\n1-5 spawn  U runner inside  G all weapons  K kill  B damage windows  J lightning  N end wave`;
  }
}

function now() { return performance.now() / 1000; }
const TOUCH_NAMES = { fists: 'FISTS', rifle: 'RIFLE', axe: 'AXE', shotgun: 'SHOTGUN', flare: 'FLARE' };
