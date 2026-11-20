// audio.js — all sound is synthesized with WebAudio, no audio files: a two-oscillator
// engine whose pitch follows speed, a horn, a two-tone police siren, gunshots, punches,
// pickups, UI clicks and little mission jingles. One master gain keeps mute (M) simple.
// The context is created lazily on the first user gesture, as browsers require.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.sirenHigh = false;
  }

  /** Create the context if needed (call from a click/keydown handler) and resume it. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /** A short tone blip: the building block for clicks, chimes and jingles. */
  blip(freq, dur, type = 'square', vol = 0.16, when = 0, slideTo = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  /** A burst of filtered noise: gunshots, punches, crashes. */
  noise(dur, vol, freq, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  uiClick() { this.blip(660, 0.07, 'square', 0.12); }
  pickup() { this.blip(880, 0.09, 'sine', 0.2); this.blip(1320, 0.14, 'sine', 0.2, 0.07); }
  /** The hidden-package chime: a brighter, higher sparkle than a mission pickup. */
  packageFound() {
    this.blip(1318, 0.1, 'triangle', 0.22);
    this.blip(1760, 0.16, 'triangle', 0.22, 0.06);
    this.blip(2637, 0.22, 'sine', 0.12, 0.12);
  }
  gunshot() { this.noise(0.13, 0.5, 2600); this.blip(160, 0.09, 'sawtooth', 0.22, 0, 60); }
  punch() { this.noise(0.09, 0.4, 700); }
  crash(intensity = 1) { this.noise(0.22, 0.4 * intensity, 900); this.blip(90, 0.2, 'triangle', 0.25, 0, 45); }
  horn() { this.blip(370, 0.32, 'square', 0.2); this.blip(466, 0.32, 'square', 0.14); }
  doorSlam() { this.noise(0.07, 0.3, 500); this.blip(120, 0.08, 'triangle', 0.2, 0, 70); }
  missionStart() { this.blip(523, 0.1, 'square', 0.14); this.blip(784, 0.16, 'square', 0.14, 0.09); }
  missionDone() { [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.16, 'square', 0.15, i * 0.09)); }
  missionFail() { this.blip(392, 0.16, 'square', 0.15); this.blip(311, 0.16, 'square', 0.15, 0.13); this.blip(233, 0.3, 'square', 0.15, 0.26); }
  busted() { [660, 587, 523, 440].forEach((f, i) => this.blip(f, 0.18, 'triangle', 0.2, i * 0.13)); }
  wasted() { this.blip(220, 0.7, 'sawtooth', 0.2, 0, 55); this.noise(0.5, 0.2, 400); }

  /** Start/stop the car engine hum; pitch and volume follow speed each frame. */
  engine(on, speedRatio = 0) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc2.type = 'square';
      this.engineGain.gain.value = 0.0;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 480;
      this.engineOsc.connect(f); this.engineOsc2.connect(f);
      f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start(); this.engineOsc2.start();
    }
    if (!on && this.engineOsc) {
      this.engineOsc.stop(); this.engineOsc2.stop();
      this.engineOsc = null; this.engineOsc2 = null; this.engineGain = null;
      return;
    }
    if (this.engineOsc) {
      const base = 55 + speedRatio * 130;
      this.engineOsc.frequency.value = base;
      this.engineOsc2.frequency.value = base * 1.5 + 2;
      this.engineGain.gain.value = 0.05 + speedRatio * 0.075;
    }
  }

  /** The police siren: a two-tone square wave that runs while any pursuit is close. */
  siren(on, dt) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenGain.gain.value = 0.045;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    }
    if (!on && this.sirenOsc) {
      this.sirenOsc.stop(); this.sirenOsc = null; this.sirenGain = null;
      return;
    }
    if (this.sirenOsc) {
      this.sirenTimer += dt;
      if (this.sirenTimer > 0.34) { // a faster two-tone, in step with the strobing lightbars
        this.sirenTimer = 0;
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.value = this.sirenHigh ? 960 : 720;
      }
    }
  }
}
