// Player settings (the Settings screen: Gameplay, Graphics, Audio, Controls), saved in this browser.
// Volumes live in AudioEngine (it already saves them); everything else lives here.
// Reading never throws: private windows or blocked storage just get the defaults.
const STORE_KEY = 'arachnophobia.settings.v1';

// every rebindable action, in the order the Controls tab lists them
export const ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
  ['sprint', 'Sprint'], ['interact', 'Use / reload'], ['rifle', 'Rifle'], ['axe', 'Axe'],
  ['stomp', 'Stomp'], ['torch', 'Flashlight'], ['pause', 'Pause'], ['mute', 'Mute'],
];

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft',
  interact: 'KeyE', rifle: 'Digit1', axe: 'Digit2', stomp: 'KeyC', torch: 'KeyQ', pause: 'KeyP', mute: 'KeyM',
};

const DEFAULTS = {
  look: 1,            // look speed multiplier (mouse and touch)
  invertY: false,
  hints: true,        // short first-time prompts
  quality: 'auto',    // auto | low | high (takes effect on reload)
  effects: true,      // film grain, colour fringing, vignette
  brightness: 1,      // 0.7 .. 1.6
  fov: 72,            // field of view, degrees (narrow screens get +8)
  crosshair: true,
  hudOpacity: 1,      // 0.3 .. 1
  showFps: false,
  keys: { ...DEFAULT_KEYS },
};

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

const stored = load();
export const Settings = { ...DEFAULTS, ...stored, keys: { ...DEFAULT_KEYS, ...(stored.keys || {}) } };

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
