// Menu music: the user's track (assets/audio/menu-track.m4a), on the loading screen and the main menu only
// (the spec rules out music during play). The file is fetched at boot; it is decoded once the AudioContext
// exists (first gesture). It starts a little before the good part with a slow fade-in, jumps ("kicks in")
// to the good part when the loading screen ends, and when the track ends it fades back in from the very start.
import { Config } from '../core/Config.js';

const M = Config.music;

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.buffer = null;
    this.src = null;        // current AudioBufferSourceNode
    this.gain = null;       // its own fader, into the music bus
    this.startedAt = 0;     // ctx time when offset 0 of the current source would have played
    this.offset = 0;
    this.fileBytes = fetch(M.url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  }

  async _decode() {
    if (this.buffer || !this.audio.ctx) return this.buffer;
    const bytes = await this.fileBytes;
    if (!bytes) return null;
    try { this.buffer = await this.audio.ctx.decodeAudioData(bytes.slice(0)); } catch (e) { console.warn('menu music could not be decoded', e); }
    return this.buffer;
  }

  /** Position in the track, seconds. */
  get position() {
    if (!this.src || !this.audio.ctx) return 0;
    return this.audio.ctx.currentTime - this.startedAt;
  }

  _startAt(offset, fadeIn) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    // at the end of the track: start again from the beginning, fading in (user: loop nicely, from the very start)
    src.onended = () => { if (this.src === src && !this.stopped) this._startAt(0, M.fadeIn); };
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(1, now + Math.max(0.02, fadeIn));
    src.connect(g); g.connect(this.audio.musicBus);
    src.start(now, offset);
    this.src = src; this.gain = g; this.startedAt = now - offset;
  }

  _fadeOutCurrent(seconds) {
    if (!this.src) return;
    const ctx = this.audio.ctx, now = ctx.currentTime, g = this.gain, src = this.src;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    try { src.stop(now + seconds + 0.05); } catch (e) { /* already stopped */ }
    this.src = null; this.gain = null;
  }

  /** Start from the lead-in with a slow fade (call right after the audio unlock). */
  async start() {
    if (this.src || !(await this._decode()) || this.stopped) return;
    this._startAt(M.leadIn, M.fadeIn);
  }

  /** The loading screen is over: if the good part has not started yet, jump to it now. */
  kickIn() {
    if (!this.src || !this.buffer) return;
    if (this.position >= M.kick - 4) return;   // close enough: let it arrive on its own
    this._fadeOutCurrent(M.kickFade);
    this._startAt(M.kick, M.kickFade);
  }

  /** Leaving the menu for the game. */
  stop(seconds = M.fadeOut) {
    this.stopped = true;
    if (this.audio.ctx) this._fadeOutCurrent(seconds);
  }

  /** Back on the main menu (not used yet: the game has no quit-to-menu). */
  resume() { this.stopped = false; if (!this.src && this.buffer) this._startAt(M.kick, 2); }
}
