// Start, pause and game-over screens, plus the volume controls.
const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(audio) {
    this.audio = audio;
    this.start = $('screen-start');
    this.pause = $('screen-pause');
    this.over = $('screen-over');
    this.startBtn = $('btn-start');
    this.loading = $('loading-text');
    for (const bus of ['master', 'sfx', 'ambience']) {
      const el = $(`vol-${bus}`);
      el.value = audio.getVolume(bus);
      el.addEventListener('input', () => audio.setVolume(bus, Number(el.value)));
    }
    const chk = $('chk-mute');
    chk.checked = audio.muted;
    chk.addEventListener('change', () => audio.setMuted(chk.checked));
    // stop clicks on menus from reaching the game
    for (const s of [this.start, this.pause, this.over]) s.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  ready() { this.startBtn.disabled = false; this.loading.textContent = ''; }
  setLoading(text) { this.loading.textContent = text; }
  showStart(v) { this.start.classList.toggle('hidden', !v); }
  showPause(v) {
    if (v) { $('chk-mute').checked = this.audio.muted; for (const b of ['master', 'sfx', 'ambience']) $(`vol-${b}`).value = this.audio.getVolume(b); }
    this.pause.classList.toggle('hidden', !v);
  }
  showOver(v, stats) {
    if (stats) $('over-stats').textContent = `You held out until wave ${stats.wave}. Spiders killed: ${stats.kills}.`;
    this.over.classList.toggle('hidden', !v);
  }
}
