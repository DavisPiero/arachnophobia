// Picks a quality tier once at start. Phones and tablets get 'low'; desktops get 'high'.
// Override with ?quality=low or ?quality=high in the URL, or in Settings → Graphics (applies on reload).
import { Settings } from './Settings.js';
const params = new URLSearchParams(location.search);

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const forced = params.get('quality') || Settings.quality; // URL wins over the Graphics setting
const tier = forced === 'low' || forced === 'high' ? forced : (isTouch ? 'low' : 'high');

export const Quality = tier === 'high'
  ? {
      tier: 'high',
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      shadows: true,          // lantern casts shadows; moon casts shadows
      moonShadows: true,
      shadowMapSize: 1024,
      treeCount: 900,
      grassCount: 6000,
      rainDrops: 3000,
      spiderDetail: 1,        // 1 = full segments + hairs
      maxSpiders: 14,
      postFX: true,
    }
  : {
      tier: 'low',
      pixelRatio: Math.min(window.devicePixelRatio, 1.0),
      shadows: true,          // lantern only, small map
      moonShadows: false,
      shadowMapSize: 512,
      treeCount: 420,
      grassCount: 1500,
      rainDrops: 900,
      spiderDetail: 0,        // 0 = fewer segments, no hairs
      maxSpiders: 9,
      postFX: true,
    };
