// audio.js — every sound in Port Solano, synthesised live with the Web Audio API.
// No audio files are shipped: each effect is an oscillator or a burst of filtered
// noise shaped by an envelope, and the two loops (engine, siren) are persistent
// nodes whose pitch and gain the game retunes every frame.
//
// The bank stays silent until unlock() runs from a user gesture (a click or a
// keypress), because browsers will not start audio before one. Every public
// method is a no-op before that, and a no-op while muted, so callers never have
// to guard their calls.

/** Master volume for all game sound. */
const MASTER_GAIN = 0.5;
/** A tone's default length when the caller does not say. */
const SHORT_BLIP = 0.09;

/**
 * SoundBank: the game's whole instrument. One-shots (clicks, shots, crashes,
 * chimes) build a fresh oscillator or noise burst per call; the engine hum and
 * the police siren are long-lived nodes created on first use and retuned by
 * engine() / siren().
 */
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.sirenPhase = 0;
    this.sirenHigh = false;
    this.noiseBuffer = null;
  }

  /**
   * Create (or resume) the audio context. Call from a click / key handler;
   * browsers refuse to start audio before a gesture, and every other method
   * silently does nothing until this has run.
   */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // No audio on this machine: the game plays on silently.
    }
  }

  /** Mute or unmute everything, including the loops. */
  setMuted(m) {
    this.muted = Boolean(m);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
  }

  /** True once unlock() has built a live context. */
  get ready() {
    return Boolean(this.ctx && this.master);
  }

  // ------------------------------------------------------------ primitives

  /**
   * One oscillator note: frequency, seconds, wave shape, peak volume, an
   * optional start delay and an optional slide-to frequency (a rising blip, a
   * falling thud). The gain ramps up fast and decays to silence, so notes
   * never click off.
   */
  tone(freq, dur = SHORT_BLIP, type = 'sine', vol = 0.2, delay = 0, slideTo = 0) {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /**
   * A burst of white noise through a filter: the body of crashes, gunshots and
   * punches. `filterFreq` sets the colour (low for a thud, high for a crack),
   * `type` the filter shape.
   */
  noise(dur, vol, filterFreq = 1200, type = 'lowpass', delay = 0) {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** A short UI blip; the extra args let callers bend it (alarm, pickup). */
  blip(freq, dur = SHORT_BLIP, type = 'square', vol = 0.14, delay = 0, slideTo = 0) {
    this.tone(freq, dur, type, vol, delay, slideTo);
  }

  // ------------------------------------------------------------ one-shots

  /** Menu click: a single bright tick. */
  uiClick() {
    this.tone(660, 0.06, 'square', 0.1);
  }

  /** A job starts: a rising three-note figure over a soft swell. */
  missionStart() {
    this.tone(392, 0.12, 'triangle', 0.22);
    this.tone(523, 0.12, 'triangle', 0.22, 0.09);
    this.tone(659, 0.22, 'triangle', 0.24, 0.18);
    this.noise(0.3, 0.05, 2400, 'highpass', 0.05);
  }

  /** A job pays out: a four-note fanfare, major and unhurried. */
  missionDone() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.22, i * 0.1));
    this.tone(1319, 0.3, 'triangle', 0.16, 0.42);
  }

  /** A job fails: two notes falling into a low thud. */
  missionFail() {
    this.tone(311, 0.22, 'sawtooth', 0.16);
    this.tone(233, 0.34, 'sawtooth', 0.16, 0.16);
    this.tone(110, 0.4, 'sine', 0.2, 0.1);
  }

  /** Picking up a package or a crate: a quick two-note chime. */
  pickup() {
    this.tone(880, 0.09, 'sine', 0.2);
    this.tone(1319, 0.16, 'sine', 0.18, 0.07);
  }

  /** A hidden package found: a brighter three-note chime, worth more. */
  packageFound() {
    this.tone(784, 0.1, 'sine', 0.2);
    this.tone(988, 0.1, 'sine', 0.2, 0.07);
    this.tone(1175, 0.22, 'sine', 0.22, 0.14);
  }

  /** A car door: a low thump with a metallic tick on top. */
  doorSlam() {
    this.noise(0.09, 0.3, 300, 'lowpass');
    this.tone(90, 0.12, 'sine', 0.3, 0, 55);
    this.tone(2400, 0.03, 'square', 0.05, 0.01);
  }

  /** A fist connects: a short band-passed thump. */
  punch() {
    this.noise(0.08, 0.35, 500, 'bandpass');
    this.tone(140, 0.09, 'sine', 0.28, 0, 70);
  }

  /** A gunshot: a high crack over a low boom, gone in a tenth of a second. */
  gunshot() {
    this.noise(0.07, 0.5, 3200, 'highpass');
    this.noise(0.12, 0.35, 220, 'lowpass');
    this.tone(180, 0.08, 'square', 0.16, 0, 60);
  }

  /** A car horn: two detuned saws, the classic two-tone blast. */
  horn() {
    this.tone(370, 0.28, 'sawtooth', 0.16);
    this.tone(466, 0.28, 'sawtooth', 0.14);
  }

  /** A crash: noise and a low thud, scaled by how hard the hit was (0..1). */
  crash(strength = 1) {
    const s = Math.max(0.1, Math.min(1, strength));
    this.noise(0.22, 0.5 * s, 700, 'lowpass');
    this.noise(0.08, 0.3 * s, 2600, 'highpass');
    this.tone(70, 0.25, 'sine', 0.35 * s, 0, 40);
  }

  /** Busted: a flat two-tone, then a low note — the fun is over. */
  busted() {
    this.tone(440, 0.3, 'square', 0.14);
    this.tone(349, 0.45, 'square', 0.14, 0.28);
    this.tone(175, 0.6, 'sine', 0.2, 0.3);
  }

  /** Wasted: three slow notes sinking into the dark. */
  wasted() {
    const notes = [330, 262, 196];
    notes.forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.2, i * 0.32));
    this.tone(98, 0.9, 'sine', 0.22, 0.9);
  }

}

// ------------------------------------------------------------------ loops

/**
 * The engine hum. `on` starts or stops the loop; `ratio` (0..1) is how hard
 * the car is working, and sets both the pitch and the loudness. The nodes are
 * built once and retuned every frame, so calling this sixty times a second
 * costs nothing. engine(false) ramps the loop out and stops it.
 */
SoundBank.prototype.engine = function engine(on, ratio = 0) {
  if (!this.ready) return;
  if (!on) {
    if (this.engineNodes) {
      const now = this.ctx.currentTime;
      this.engineNodes.gain.gain.setTargetAtTime(0, now, 0.06);
      const nodes = this.engineNodes;
      window.setTimeout(() => {
        try { nodes.osc.stop(); } catch { /* already stopped */ }
        try { nodes.osc.disconnect(); nodes.gain.disconnect(); } catch { /* gone */ }
      }, 350);
      this.engineNodes = null;
    }
    return;
  }
  if (!this.engineNodes) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    this.engineNodes = { osc, filter, gain };
  }
  const now = this.ctx.currentTime;
  const r = Math.max(0, Math.min(1, ratio || 0));
  this.engineNodes.osc.frequency.setTargetAtTime(52 + r * 105, now, 0.08);
  this.engineNodes.filter.frequency.setTargetAtTime(380 + r * 900, now, 0.08);
  this.engineNodes.gain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + r * 0.075, now, 0.08);
};

/**
 * The police siren. `on` starts or stops it; `dt` advances the two-tone
 * wail, which flips between a high and a low note about every 0.45 s. Like
 * the engine, the nodes are built once and retuned. siren(false) stops it.
 */
SoundBank.prototype.siren = function siren(on, dt = 0) {
  if (!this.ready) return;
  if (!on) {
    if (this.sirenNodes) {
      const now = this.ctx.currentTime;
      this.sirenNodes.gain.gain.setTargetAtTime(0, now, 0.05);
      const nodes = this.sirenNodes;
      window.setTimeout(() => {
        try { nodes.osc.stop(); } catch { /* already stopped */ }
        try { nodes.osc.disconnect(); nodes.gain.disconnect(); } catch { /* gone */ }
      }, 300);
      this.sirenNodes = null;
      this.sirenPhase = 0;
      this.sirenHigh = false;
    }
    return;
  }
  if (!this.sirenNodes) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    this.sirenNodes = { osc, gain };
  }
  this.sirenPhase += dt;
  if (this.sirenPhase >= 0.45) {
    this.sirenPhase = 0;
    this.sirenHigh = !this.sirenHigh;
    const now = this.ctx.currentTime;
    this.sirenNodes.osc.frequency.setTargetAtTime(this.sirenHigh ? 920 : 660, now, 0.05);
  }
  const now = this.ctx.currentTime;
  this.sirenNodes.gain.gain.setTargetAtTime(this.muted ? 0 : 0.045, now, 0.1);
};
