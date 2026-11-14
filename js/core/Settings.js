// Player settings (the Settings screen: Gameplay, Graphics, Audio, Controls), saved in this browser.
// Volumes live in AudioEngine (it already saves them); everything else lives here.
// Reading never throws: private windows or blocked storage just get the defaults.
const STORE_KEY = 'arachnophobia.settings.v1';

// every rebindable action, in the order the Controls tab lists them
export const ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
  ['sprint', 'Sprint'], ['interact', 'Use / reload'],
  ['slot1', 'Weapon 1'], ['slot2', 'Weapon 2'], ['slot3', 'Weapon 3'], ['slot4', 'Weapon 4'], ['slot5', 'Weapon 5'],
  ['inventory', 'Inventory'], ['stomp', 'Stomp'], ['bandage', 'Bandage'], ['torch', 'Flashlight'], ['pause', 'Pause'], ['mute', 'Mute'],
];

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft',
  interact: 'KeyE', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
  inventory: 'KeyI', stomp: 'KeyC', bandage: 'KeyH', torch: 'KeyQ', pause: 'KeyP', mute: 'KeyM',
};

const DEFAULTS = {
  look: 1,            // look speed multiplier (mouse and touch)
  invertY: false,
  hints: true,        // short first-time prompts
  difficulty: 'normal', // easy | normal | hard (Config.difficulty; applies to spiders that arrive from now on)
  quality: 'auto',    // auto | low | high (takes effect on reload)
  effects: true,      // film grain, colour fringing, vignette
  brightness: 1,      // 0.7 .. 1.6
  fov: 72,            // field of view, degrees (narrow screens get +8)
  crosshair: true,
  hudOpacity: 1,      // 0.3 .. 1
  showFps: false,
  keys: { ...DEFAULT_KEYS },
  slots: null,        // which weapon each of the keys 1–5 holds (the inventory sets it; null = Config.arsenal.slots)
};

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

const stored = load();
// only known actions survive (older saves had 'rifle' and 'axe' keys, now 'slot1'..'slot5')
const storedKeys = Object.fromEntries(Object.entries(stored.keys || {}).filter(([a]) => a in DEFAULT_KEYS));
export const Settings = { ...DEFAULTS, ...stored, keys: { ...DEFAULT_KEYS, ...storedKeys } };

const listeners = new Set();
export function onSettingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setSetting(key, value) {
  Settings[key] = value;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(Settings)); } catch (e) { /* private mode */ }
  for (const fn of listeners) fn(key, value);
}

export function bindKey(action, code) {
  // a key does one thing: whatever had it before loses it
  const keys = { ...Settings.keys };
  for (const a of Object.keys(keys)) if (keys[a] === code) keys[a] = '';
  keys[action] = code;
  setSetting('keys', keys);
}

export function resetKeys() { setSetting('keys', { ...DEFAULT_KEYS }); }

/** 'KeyW' -> 'W', 'Digit1' -> '1', 'ShiftLeft' -> 'Shift' */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code];
  return code.replace(/(Left|Right)$/, '').replace('Control', 'Ctrl');
}
