// Entry point.
import { Game } from './core/Game.js';
import { preventBrowserZoom } from './input/NoZoom.js';

preventBrowserZoom();

const game = new Game(document.getElementById('game'));
game.init();
