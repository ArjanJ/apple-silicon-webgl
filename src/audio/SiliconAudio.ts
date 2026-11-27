/**
 * Zero-Dependency Procedural Mechanical Web Audio Engine for Silicon Microscope
 *
 * Purely interaction-driven, dead-silent at rest, close-miked precision hardware acoustics:
 *   - Knurled aluminum focus-ring ball-bearing detents while zooming
 *   - Zeiss objective turret double-action latch & seat when crossing named scale stops
 *   - Material-accurate probe taps on hover (cupronickel quarter, silicon wafer, matte DRAM/SLC, MLCC)
 *   - Mechanical SLR/optical clamp lock & release for Inspect cards
 *   - Helical lens-barrel solenoid & servo glide for Dive / Zoom-Rail flights
 *   - Heavy electromagnetic contactor + micro-flywheel spin-up for Burst
 *   - Tactile click-thock switches for Liquid Glass HUD controls
 */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type AudioIntroPhase =
  | 'idle'
  | 'off'
  | 'power'
  | 'fabric'
  | 'cores'
  | 'dissolve'
  | 'lock'
  | 'hud'
  | 'settle'
  | 'done';

/** Dark C-minor / open-fifth cyber-noir scale frequencies for each of the 11 objective stops */
const TURRET_SCALE_HZ = [
  65.41,   // -1 Scale   (C2)
  98.0,    //  0 Die     (G2)
  130.81,  //  1 Power   (C3)
  146.83,  //  2 Routing (D3)
  155.56,  //  3 Rows    (Eb3)
  196.0,   //  4 Cell    (G3)
  207.65,  //  5 Gate    (Ab3)
  233.08,  //  6 Lattice (Bb3)
  261.63,  //  7 Atom    (C4)
  49.0,    //  8 Nucleus (G1 — colossal sub-lock after the 35,800x void!)
  32.7,    //  9 Quarks  (C1 — deepest subatomic vault lock)
] as const;

/** Stepped C-minor hover frequencies for P-cores 0..7 */
const PCORE_MINOR_HZ = [130.81, 146.83, 155.56, 196.0, 207.65, 233.08, 261.63, 293.66] as const;

export class SiliconAudio {
  private ctx: AudioContext | null = null;
  private initialized = false;
  private userMuted = false;
  private tabHidden = false;
  private autoSuspended = false;
  private activeUntilWallMs = 0;
  private idleSuspendTimer: number | null = null;
  private stateChangeCb?: (active: boolean, muted: boolean) => void;

  // Master graph (close-miked mechanical acoustics + wide cinematic hall bus for Cold Boot score)
  private masterGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private dryBus!: GainNode;
  private roomSend!: GainNode;
  private convolver!: ConvolverNode;
  private roomGain!: GainNode;
  private cinemaSend!: GainNode;
  private cinemaConvolver!: ConvolverNode;
  private cinemaGain!: GainNode;

  // Active cinematic Cold Boot score state (for clean sync, mid-intro unlock, & early skip fadeout)
  private introRunning = false;
  private introStartWallMs = 0;
  private introScoreBus: GainNode | null = null;
  private introSources: AudioScheduledSourceNode[] = [];
  private introScheduled = false;

  // Pre-generated impulse & mechanical texture buffers (zero runtime allocation!)
  private crispNoiseBuf!: AudioBuffer;
  private brushedNoiseBuf!: AudioBuffer;
  private warmDriveCurve!: Float32Array<ArrayBuffer>;

  // Tracking state for focus-ring detents & objective turret stop crossings
  private lastZoom = 0;
  private lastTickZoom = 0;
  private lastTickMs = 0;
  private lastHoverMs = 0;
  private lastHoverId: string | null = null;
  private lastStopIdx = 1;
  private hasInitialZoom = false;

  constructor(onStateChange?: (active: boolean, muted: boolean) => void) {
    this.stateChangeCb = onStateChange;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.tabHidden = document.hidden;
        if (this.tabHidden) {
          this.syncMasterGain(0.04);
          if (this.ctx?.state === 'running') {
            this.autoSuspended = true;
            void this.ctx.suspend();
          }
        } else if (this.ctx?.state === 'running') {
          this.syncMasterGain(0.04);
        }
      });
    }
  }

  public isActive(): boolean {
    return (
      this.initialized &&
      !this.userMuted &&
      !this.tabHidden &&
      (this.ctx?.state === 'running' || this.autoSuspended)
    );
  }

  /**
   * Probe whether the browser permits unmuted Web Audio autoplay on fresh load.
   * Calls `onAllowed` immediately if AudioContext runs (within ~90ms), or `onBlocked`
   * if Chromium's autoplay policy holds AudioContext suspended awaiting a user gesture.
   */
  public probeAutoplay(onAllowed: () => void, onBlocked: () => void): void {
    if (this.userMuted) {
      onAllowed();
      return;
    }
    if (!this.initialized) {
      this.initGraph();
    }
    const ctx = this.ctx;
    if (!ctx) {
      onAllowed();
      return;
    }
    if (ctx.state === 'running') {
      this.autoSuspended = false;
      this.syncMasterGain(0.015);
      this.emitState();
      onAllowed();
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      if (ctx.state === 'running') {
        this.autoSuspended = false;
        this.syncMasterGain(0.015);
        this.emitState();
        onAllowed();
      } else {
        onBlocked();
      }
    }, 90);

    void ctx
      .resume()
      .then(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (ctx.state === 'running') {
          this.autoSuspended = false;
          this.syncMasterGain(0.015);
          this.emitState();
          onAllowed();
        } else {
          onBlocked();
        }
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        onBlocked();
      });
  }

  /** True when the Cold Boot intro is running but browser autoplay policy is holding AudioContext suspended */
  public isIntroAwaitingUnlock(): boolean {
    return (
      this.introRunning &&
      !this.introScheduled &&
      !this.userMuted &&
      !this.tabHidden &&
      (!this.ctx || (this.ctx.state === 'suspended' && !this.autoSuspended))
    );
  }

  /** Keep AudioContext awake while sounds & reverb tails play, then suspend to 0% CPU when silent! */
  private touchAudio(tailSec = 1.8): void {
    if (!this.ctx || this.userMuted || this.tabHidden) return;
    if (this.ctx.state === 'suspended' && this.autoSuspended) {
      this.autoSuspended = false;
      void this.ctx.resume().then(() => {
        this.syncMasterGain(0.015);
      });
    } else if (this.ctx.state === 'running') {
      this.syncMasterGain(0.015);
    }
    const targetWall = performance.now() + tailSec * 1000;
    if (targetWall > this.activeUntilWallMs) {
      this.activeUntilWallMs = targetWall;
    }
    this.scheduleIdleSuspend();
  }

  private scheduleIdleSuspend(): void {
    if (this.idleSuspendTimer !== null) {
      window.clearTimeout(this.idleSuspendTimer);
      this.idleSuspendTimer = null;
    }
    const delayMs = Math.max(400, this.activeUntilWallMs - performance.now() + 500);
    this.idleSuspendTimer = window.setTimeout(() => {
      this.idleSuspendTimer = null;
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (performance.now() < this.activeUntilWallMs) {
        this.scheduleIdleSuspend();
        return;
      }
      this.autoSuspended = true;
      void this.ctx.suspend();
    }, delayMs);
  }

  public isMuted(): boolean {
    return this.userMuted;
  }

  private emitState(): void {
    this.stateChangeCb?.(this.isActive(), this.userMuted);
  }

  /** Unlock cleanly on the first user gesture (unless explicitly muted) */
  public unlockFromGesture(): void {
    if (this.userMuted) return;
    if (!this.initialized) {
      this.initGraph();
    }
    if (!this.ctx) return;

    const onRunning = () => {
      this.autoSuspended = false;
      this.syncMasterGain(0.015);
      this.emitState();
      this.maybeLaunchPendingIntro();
      this.touchAudio(2.0);
    };

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(onRunning);
    } else if (this.ctx.state === 'running') {
      onRunning();
    }
  }

  /** Explicit toggle from Sound HUD button or `M` key */
  public toggle(): boolean {
    if (!this.initialized || (this.ctx?.state !== 'running' && !this.autoSuspended)) {
      this.userMuted = false;
      if (!this.initialized) {
        this.initGraph();
      }
      if (this.ctx) {
        void this.ctx.resume().then(() => {
          this.autoSuspended = false;
          this.syncMasterGain(0.012);
          this.emitState();
          if (this.introRunning && !this.introScheduled) {
            this.maybeLaunchPendingIntro();
          } else {
            this.playUiTap(true);
          }
        });
      }
      this.emitState();
      return true;
    }

    this.userMuted = !this.userMuted;
    if (!this.userMuted) {
      this.touchAudio(1.8);
      this.syncMasterGain(0.012);
      if (this.introRunning && !this.introScheduled) {
        this.maybeLaunchPendingIntro();
      } else {
        this.playUiTap(true);
      }
    } else {
      this.stopIntroScore(0.12);
      this.playMuteSwitch();
      this.syncMasterGain(0.08);
      this.activeUntilWallMs = performance.now() + 450;
      this.scheduleIdleSuspend();
    }
    this.emitState();
    return !this.userMuted;
  }

  private syncMasterGain(tau: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = !this.userMuted && !this.tabHidden && this.ctx.state === 'running' ? 1.0 : 0.0;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, tau);
  }

  private initGraph(): void {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
    } catch {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0, now);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-7, now);
    this.compressor.knee.setValueAtTime(12, now);
    this.compressor.ratio.setValueAtTime(3.2, now);
    this.compressor.attack.setValueAtTime(0.002, now);
    this.compressor.release.setValueAtTime(0.11, now);

    this.dryBus = ctx.createGain();
    this.dryBus.gain.setValueAtTime(1.0, now);

    // Tight, close-miked desktop/lab early-reflection room so mechanical clicks feel solid & physical
    this.roomSend = ctx.createGain();
    this.roomSend.gain.setValueAtTime(0.22, now);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.buildCloseRoomIR(ctx, 0.48, 4.8);

    this.roomGain = ctx.createGain();
    this.roomGain.gain.setValueAtTime(0.45, now);

    // Wide stereo cinematic hall reverb exclusively for the Cold Boot score (fast 2.2s IR — <3ms init!)
    this.cinemaSend = ctx.createGain();
    this.cinemaSend.gain.setValueAtTime(0.75, now);

    this.cinemaConvolver = ctx.createConvolver();
    this.cinemaConvolver.buffer = this.buildCinemaHallIR(ctx, 2.2, 2.75);

    this.cinemaGain = ctx.createGain();
    this.cinemaGain.gain.setValueAtTime(0.66, now);

    this.dryBus.connect(this.compressor);
    this.roomSend.connect(this.convolver);
    this.convolver.connect(this.roomGain);
    this.roomGain.connect(this.compressor);
    this.cinemaSend.connect(this.cinemaConvolver);
    this.cinemaConvolver.connect(this.cinemaGain);
    this.cinemaGain.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.crispNoiseBuf = this.buildCrispNoiseBuffer(ctx, 0.35);
    this.brushedNoiseBuf = this.buildBrushedMetalBuffer(ctx, 1.4);
    this.warmDriveCurve = this.buildWarmDriveCurve(2.0);

    this.initialized = true;
    this.emitState();
  }

  /** Tight studio/lab room IR (~480 ms) with crisp early reflections for physical weight */
  private buildCloseRoomIR(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const buf = ctx.createBuffer(2, len, rate);

    // Subtle discrete early reflection taps (desk + instrument housing bounce)
    const earlyTaps: [number, number, number][] = [
      [0.006, 0.42, 0.28],
      [0.013, 0.24, 0.36],
      [0.021, 0.18, 0.15],
      [0.032, 0.12, 0.14],
    ];

    const decayMul = Math.exp(-decay / Math.max(1, len));
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      let hp = 0;
      let prev = 0;
      let env = 1.0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        env *= decayMul;
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * (0.36 * (1 - t * 0.65) + 0.06);
        hp = 0.985 * (hp + lp - prev);
        prev = lp;
        data[i] = hp * env * 0.34;
      }
      for (const [sec, lAmp, rAmp] of earlyTaps) {
        const idx = Math.floor(sec * rate);
        if (idx < len) data[idx] += (ch === 0 ? lAmp : rAmp) * 0.5;
      }
    }
    return buf;
  }

  /** Fast lush stereo concert/keynote hall IR (multiplicative decay — zero Math.pow stall!) */
  private buildCinemaHallIR(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const buf = ctx.createBuffer(2, len, rate);
    const preDelaySamples = Math.floor(0.020 * rate);
    const attackSamples = Math.floor(0.032 * rate);
    const bodyLen = Math.max(1, len - preDelaySamples);
    const decayMul = Math.exp(-(decay * 1.45) / bodyLen);

    const earlyTaps: [number, number, number][] = [
      [0.024, 0.34, 0.16],
      [0.041, 0.18, 0.32],
      [0.064, 0.24, 0.19],
      [0.095, 0.14, 0.22],
      [0.130, 0.16, 0.11],
    ];

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp1 = 0;
      let lp2 = 0;
      let hp = 0;
      let prev = 0;
      let env = 1.0;
      for (let i = 0; i < len; i++) {
        if (i < preDelaySamples) {
          data[i] = 0;
          continue;
        }
        const idx = i - preDelaySamples;
        const t = idx / bodyLen;
        env *= decayMul;
        const attack = idx < attackSamples ? idx / attackSamples : 1.0;
        const w = Math.random() * 2 - 1;
        const cutoff = 0.24 * (1 - t * 0.78) + 0.028;
        lp1 += (w - lp1) * cutoff;
        lp2 += (lp1 - lp2) * (cutoff * 0.85);
        hp = 0.992 * (hp + lp2 - prev);
        prev = lp2;
        data[i] = hp * env * attack * 0.44;
      }
      for (const [sec, lAmp, rAmp] of earlyTaps) {
        const idx = Math.floor(sec * rate);
        if (idx < len) data[idx] += (ch === 0 ? lAmp : rAmp) * 0.38;
      }
    }
    return buf;
  }

  /** Sharp broadband white-noise buffer for steel-on-aluminum transient strikes */
  private buildCrispNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return buf;
  }

  /** Textured mid-focused noise evoking machined helical threads & pneumatic stage bearings */
  private buildBrushedMetalBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.994 * b0 + w * 0.045;
        b1 = 0.965 * b1 + w * 0.06;
        b2 = 0.88 * b2 + w * 0.09;
        // Subtle fine gear-tooth micro-ripple
        const ripple = 0.88 + 0.12 * Math.sin(i * 0.11 + ch * 1.4);
        data[i] = (b0 + b1 + b2) * 0.65 * ripple;
      }
    }
    return buf;
  }

  // ============================================================================
  // Physical Mechanical Synthesis Primitives
  // ============================================================================

  /**
   * Steel-on-metal micro-strike: ultra-short filtered noise impulse.
   * Gives tactile "snick" / "tick" snap that pure oscillators cannot produce.
   */
  private triggerStrike(
    time: number,
    freqHz: number,
    q: number,
    durSec: number,
    gain: number,
    dest: AudioNode
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.crispNoiseBuf;
    const offset = Math.random() * Math.max(0.01, this.crispNoiseBuf.duration - durSec - 0.02);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freqHz, time);
    bp.Q.setValueAtTime(q, time);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(time, offset, durSec + 0.006);
  }

  /**
   * Machined housing "thock" / body impulse: fast pitch-dropping low-mid resonator.
   * Gives physical weight & solid anodized-aluminum / brass barrel feel.
   */
  private triggerThock(
    time: number,
    startHz: number,
    endHz: number,
    durSec: number,
    gain: number,
    dest: AudioNode,
    type: OscillatorType = 'triangle'
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startHz, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, endHz), time + durSec * 0.72);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(startHz * 2.4, time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(90, endHz * 1.4), time + durSec);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.0018);
    g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

    osc.connect(lp);
    lp.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + durSec + 0.01);
  }

  /**
   * Short inharmonic metallic modal resonance (2 coupled partials) for brass/steel/coin rings.
   */
  private triggerMetalRing(
    time: number,
    baseHz: number,
    ratio: number,
    durSec: number,
    gain: number,
    dest: AudioNode
  ): void {
    const ctx = this.ctx!;
    const freqs = [baseHz, baseHz * ratio];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, time);
      const g = ctx.createGain();
      const peak = i === 0 ? gain : gain * 0.48;
      const d = i === 0 ? durSec : durSec * 0.58;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, time + d);
      osc.connect(g);
      g.connect(dest);
      osc.start(time);
      osc.stop(time + d + 0.01);
    });
  }

  /**
   * Dark Moog-style resonant analog filter pluck (unified cyber-noir voice across intro, stops, hover & UI).
   */
  private triggerAnalogPluck(
    time: number,
    freqHz: number,
    cutoffPeakHz: number,
    q: number,
    durSec: number,
    gain: number,
    dest: AudioNode,
    type: OscillatorType = 'sawtooth',
    detuneCents = 0
  ): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, time);
    if (detuneCents !== 0) {
      osc.detune.setValueAtTime(detuneCents, time);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(q, time);
    lp.frequency.setValueAtTime(Math.max(freqHz * 1.4, cutoffPeakHz), time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(65, freqHz * 1.15), time + durSec);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

    osc.connect(lp);
    lp.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + durSec + 0.02);
    return osc;
  }

  private routeOut(panVal = 0, roomMix = 1.0, cinemaMix = 0.0): AudioNode {
    this.touchAudio(cinemaMix > 0 ? 3.2 : 1.5);
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(clamp(panVal, -0.8, 0.8), ctx.currentTime);
    pan.connect(this.dryBus);
    if (roomMix > 0) {
      if (roomMix >= 0.99) {
        pan.connect(this.roomSend);
      } else {
        const rs = ctx.createGain();
        rs.gain.setValueAtTime(roomMix, ctx.currentTime);
        pan.connect(rs);
        rs.connect(this.roomSend);
      }
    }
    if (cinemaMix > 0 && this.cinemaSend) {
      const cs = ctx.createGain();
      cs.gain.setValueAtTime(cinemaMix, ctx.currentTime);
      pan.connect(cs);
      cs.connect(this.cinemaSend);
    }
    return pan;
  }

  // ============================================================================
  // Microscope Interaction Foley
  // ============================================================================

  /**
   * Called from `onZoomFrame` — fires knurled focus-ring detents and objective turret locks.
   */
  public updateFrame(
    zoom: number,
    motion: number,
    _interacting: boolean,
    _yawVel = 0,
    _regionKind = 0,
    introActive = false
  ): void {
    const nowMs = performance.now();

    if (!this.hasInitialZoom) {
      this.hasInitialZoom = true;
      this.lastZoom = zoom;
      this.lastTickZoom = zoom;
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, TURRET_SCALE_HZ.length - 1);
    }

    const dz = zoom - this.lastZoom;
    this.lastZoom = zoom;

    if (!this.isActive() || !this.ctx) {
      this.lastTickZoom = zoom;
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, TURRET_SCALE_HZ.length - 1);
      return;
    }

    const z = clamp(zoom, -2.4, 9.0);

    // 1) Precision cyber-noir focus-ring clock detents while zooming
    if (!introActive && Math.abs(z - this.lastTickZoom) >= 0.088 && nowMs - this.lastTickMs >= 38) {
      const zoomingIn = dz >= 0;
      this.playFocusDetent(zoomingIn, clamp(motion, 0.15, 1.0), z);
      this.lastTickZoom = z;
      this.lastTickMs = nowMs;
    }

    // 2) Bold dark-electro objective lock when crossing one of the 11 named scale stops
    const stopIdx = clamp(Math.round(z) + 1, 0, TURRET_SCALE_HZ.length - 1);
    if (!introActive && stopIdx !== this.lastStopIdx) {
      const direction = stopIdx > this.lastStopIdx ? 1 : -1;
      this.lastStopIdx = stopIdx;
      this.playTurretLock(stopIdx, direction);
    }
  }

  /**
   * Cyber-noir focus-ring clock detent:
   * Razor-tight metallic micro-tick + resonant analog filter blip tracking magnification depth.
   */
  private playFocusDetent(zoomingIn: boolean, vel: number, z: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(zoomingIn ? 0.08 : -0.08, 0.48, 0.08);

    const jitter = 0.98 + Math.random() * 0.04;
    const scaleNorm = clamp((z + 1) / 10, 0, 1);

    // Crisp dark digital-mechanical notch click
    const strikeHz = ((zoomingIn ? 3400 : 2500) + scaleNorm * 1100) * jitter;
    this.triggerStrike(now, strikeHz, 4.0, 0.006, 0.13 + vel * 0.11, out);

    // Subtle resonant dark Moog filter blip (moves cleanly through C-minor depth range)
    const pluckHz = (zoomingIn ? 130.81 : 98.0) * (1.0 + scaleNorm * 1.15) * jitter;
    this.triggerAnalogPluck(now, pluckHz, 480 + scaleNorm * 920, 3.8, 0.032, 0.068 + vel * 0.055, out, 'sawtooth');
  }

  /**
   * Dark-Electro Scale Stop Lock:
   * Crisp two-stage mechanical latch fused with a tuned C-minor analog bass/synth lock pulse!
   */
  private playTurretLock(stopIdx: number, direction: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const scaleHz = TURRET_SCALE_HZ[stopIdx] ?? 130.81;
    const isSubatomic = stopIdx >= 9; // Colossal sub-drop vault lock past the 35,800x void!
    const out = this.routeOut(0, 0.72, isSubatomic ? 0.45 : 0.22);

    // Stage 1 (t = 0ms): sharp precision clock latch
    this.triggerStrike(now, direction > 0 ? 4100 : 3000, 3.2, 0.007, 0.18, out);

    // Stage 2 (t = 16ms): dark analog sub-pulse + resonant Moog synth lock in C minor
    const seatT = now + (isSubatomic ? 0.020 : 0.015);
    this.triggerStrike(seatT, isSubatomic ? 1500 : 2400, 2.4, 0.012, isSubatomic ? 0.30 : 0.21, out);
    this.triggerThock(
      seatT,
      isSubatomic ? 140 : 210,
      isSubatomic ? scaleHz : 65.41,
      isSubatomic ? 0.18 : 0.055,
      isSubatomic ? 0.42 : 0.24,
      out,
      'sine'
    );
    this.triggerAnalogPluck(
      seatT,
      isSubatomic ? scaleHz * 2 : scaleHz,
      isSubatomic ? 620 : scaleHz * 5.2,
      3.6,
      isSubatomic ? 0.42 : 0.16,
      isSubatomic ? 0.18 : 0.125,
      out,
      'sawtooth'
    );
    if (isSubatomic) {
      this.triggerAnalogPluck(seatT, scaleHz * 3, 740, 2.8, 0.36, 0.085, out, 'triangle');
    }
  }

  /**
   * Dark cyber-noir material-aware probe ticks when hovering blocks on the die / US Quarter.
   */
  public playHover(hitId: string | null, clientX: number): void {
    if (!hitId) {
      this.lastHoverId = null;
      return;
    }
    if (hitId === this.lastHoverId) return;
    this.lastHoverId = hitId;

    const nowMs = performance.now();
    if (nowMs - this.lastHoverMs < 55) return;
    this.lastHoverMs = nowMs;

    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const panVal = clamp((clientX / Math.max(1, window.innerWidth)) * 2 - 1, -0.65, 0.65) * 0.65;
    const out = this.routeOut(panVal, 0.60, 0.14);

    if (hitId === 'us-quarter') {
      // Authentic cupronickel coin strike + metallic partials
      this.triggerStrike(now, 5800, 2.6, 0.006, 0.22, out);
      this.triggerMetalRing(now, 2560, 1.608, 0.12, 0.105, out);
      this.triggerMetalRing(now, 6180, 1.31, 0.05, 0.04, out);
      return;
    }

    if (hitId === 'slc' || hitId.startsWith('ram-')) {
      // Deep muted cyber-noir sub-pulse for dense matte memory/SLC blocks (C2 / G2)
      const hz = hitId === 'slc' ? 98.0 : 65.41;
      this.triggerStrike(now, 1700, 2.2, 0.008, 0.14, out);
      this.triggerAnalogPluck(now, hz, 540, 3.4, 0.09, 0.14, out, 'sawtooth');
      return;
    }

    if (hitId === 'gpu' || hitId === 'ane') {
      // Sleek twin-pulse dark synth micro-tap (G3 -> C4)
      this.triggerStrike(now, 3600, 3.6, 0.005, 0.13, out);
      this.triggerAnalogPluck(now, 196.0, 980, 3.8, 0.055, 0.095, out, 'sawtooth');
      this.triggerAnalogPluck(now + 0.016, 261.63, 1280, 3.6, 0.065, 0.08, out, 'sawtooth');
      return;
    }

    if (hitId === 'smd-caps') {
      // Tiny crisp electrostatic MLCC snap
      this.triggerStrike(now, 4900, 4.8, 0.004, 0.15, out);
      this.triggerAnalogPluck(now, 392.0, 1800, 4.2, 0.028, 0.065, out, 'triangle');
      return;
    }

    if (hitId === 'io-phy' || hitId === 'media') {
      // Tight dark telemetry connector ping (Eb3 / Bb3)
      const hz = hitId === 'io-phy' ? 155.56 : 233.08;
      this.triggerStrike(now, 2900, 3.0, 0.007, 0.15, out);
      this.triggerAnalogPluck(now, hz, 820, 3.6, 0.075, 0.105, out, 'sawtooth');
      return;
    }

    // Performance & Efficiency Cores: stepped C-minor dark Moog micro-plucks!
    const coreIdx = hitId.startsWith('pcore-') ? Number(hitId.slice(6)) || 0 : 0;
    const hz = PCORE_MINOR_HZ[coreIdx % PCORE_MINOR_HZ.length];
    this.triggerStrike(now, 3500 + (coreIdx % 8) * 160, 3.8, 0.005, 0.13, out);
    this.triggerAnalogPluck(now, hz, 740 + (coreIdx % 8) * 110, 3.8, 0.068, 0.105, out, 'sawtooth');
  }

  /**
   * Cyber-noir targeting lock (open) & filter-closing unlatch (close) for Inspect Card.
   */
  public playInspect(open: boolean, hitId?: string): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.68, 0.28);
    const isCoin = hitId === 'us-quarter';

    if (open) {
      // Crisp optical latch + bold C-minor fifth analog targeting lock!
      this.triggerStrike(now, 4300, 3.4, 0.007, 0.20, out);
      this.triggerAnalogPluck(now, 130.81, 1100, 3.8, 0.12, 0.11, out, 'sawtooth');

      const t2 = now + 0.030;
      this.triggerStrike(t2, isCoin ? 5200 : 2500, 2.4, 0.011, 0.24, out);
      this.triggerThock(t2, 165, 65.41, 0.085, 0.26, out, 'sine');
      if (isCoin) {
        this.triggerMetalRing(t2, 2560, 1.608, 0.14, 0.09, out);
      } else {
        this.triggerAnalogPluck(t2, 65.41, 680, 3.4, 0.26, 0.14, out, 'sawtooth', -5);
        this.triggerAnalogPluck(t2, 196.0, 1450, 3.8, 0.24, 0.10, out, 'sawtooth', 5);
      }
    } else {
      // Sleek downward filter-closing release
      this.triggerStrike(now, 2900, 2.8, 0.006, 0.16, out);
      this.triggerAnalogPluck(now, 196.0, 920, 3.4, 0.065, 0.09, out, 'sawtooth');
      this.triggerAnalogPluck(now + 0.022, 98.0, 420, 3.0, 0.11, 0.11, out, 'triangle');
    }
  }

  /**
   * Dark sci-fi sub-bass & resonant filter hyper-glide when diving / clicking zoom rail stops.
   */
  public playDive(fromZ: number, toZ: number): void {
    if (!this.ctx || !this.isActive()) return;
    const dist = Math.abs(toZ - fromZ);
    if (dist < 0.22) {
      this.playUiTap(true);
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.routeOut(0, 0.65, 0.34);
    const divingIn = toZ > fromZ;
    const dur = clamp(0.22 + dist * 0.058, 0.26, 0.62);

    // 1) Punchy sub-kick + crisp clock-latch launch
    this.triggerStrike(now, divingIn ? 3900 : 2800, 3.0, 0.008, 0.20, out);
    this.triggerThock(now, divingIn ? 160 : 120, 49.0, 0.11, 0.24, out, 'sine');

    // 2) Dark resonant analog sawtooth synth glide (C2 <-> C3)
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.setValueAtTime(divingIn ? 65.41 : 130.81, now);
    oscA.frequency.exponentialRampToValueAtTime(divingIn ? 130.81 : 65.41, now + dur * 0.9);

    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.setValueAtTime(divingIn ? 98.0 : 196.0, now);
    oscB.frequency.exponentialRampToValueAtTime(divingIn ? 196.0 : 98.0, now + dur * 0.9);
    oscB.detune.setValueAtTime(6, now);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(3.6, now);
    lp.frequency.setValueAtTime(divingIn ? 240 : 1850, now);
    lp.frequency.exponentialRampToValueAtTime(divingIn ? 2050 : 210, now + dur * 0.85);

    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.linearRampToValueAtTime(0.115, now + 0.035);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    oscA.connect(lp);
    oscB.connect(lp);
    lp.connect(sg);
    sg.connect(out);
    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + dur + 0.03);
    oscB.stop(now + dur + 0.03);

    // 3) Tight stereo brushed-air velocity sweep
    const src = ctx.createBufferSource();
    src.buffer = this.brushedNoiseBuf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(3.2, now);
    bp.frequency.setValueAtTime(divingIn ? 360 : 1680, now);
    bp.frequency.exponentialRampToValueAtTime(divingIn ? 1850 : 320, now + dur);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(clamp(0.09 + dist * 0.018, 0.10, 0.20), now + 0.045);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now);
    src.stop(now + dur + 0.03);
  }

  /**
   * Dark analog console micro-switch (crisp click + resonant C-minor blip).
   */
  public playUiTap(active: boolean): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.52, 0.12);

    if (active) {
      this.triggerStrike(now, 3900, 3.6, 0.006, 0.20, out);
      this.triggerAnalogPluck(now + 0.006, 130.81, 1250, 3.8, 0.068, 0.125, out, 'sawtooth');
    } else {
      this.triggerStrike(now, 2400, 3.0, 0.006, 0.16, out);
      this.triggerAnalogPluck(now + 0.005, 98.0, 680, 3.2, 0.055, 0.105, out, 'triangle');
    }
  }

  /** Tactile switch-off click played right before muting */
  private playMuteSwitch(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.4);
    this.triggerStrike(now, 2200, 3.0, 0.007, 0.18, out);
    this.triggerAnalogPluck(now + 0.006, 98.0, 420, 2.8, 0.06, 0.11, out, 'triangle');
  }

  /**
   * Cyber-Noir Multi-Core Overclock Burst (3.5s):
   * Heavy contactor sub-drop + driving overclocked 16th-note Moog dark-electro bass pulse + power-down latch!
   */
  public triggerBurst(durationSec = 3.5): void {
    if (!this.ctx || !this.isActive()) return;
    this.touchAudio(durationSec + 3.4);
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.routeOut(0, 0.55, 0.52);

    // 1) Heavy high-voltage contactor slam + C1 sub-drop
    this.triggerStrike(now, 3800, 2.4, 0.011, 0.28, out);
    this.triggerThock(now, 155, 32.7, 0.26, 0.40, out, 'sine');
    this.triggerStrike(now + 0.024, 1900, 2.0, 0.016, 0.30, out);

    // 2) Overclocked dark C-minor Moog 16th-note pulse engine synced to the 3.5s compute burst!
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.warmDriveCurve;
    shaper.connect(out);

    const step = 0.125; // Crisp 120 BPM overclocked 16th-note pulse
    const totalSteps = Math.max(8, Math.floor((durationSec - 0.18) / step));
    const notes = [65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0];

    for (let i = 0; i < totalSteps; i++) {
      const ct = now + 0.04 + i * step;
      const prog = i / Math.max(1, totalSteps - 1);
      // Fast ramp up into full overdrive heat, then smooth wind-down over final 0.55s
      const heat = Math.min(1.0, prog / 0.18) * (1.0 - Math.max(0, (prog - 0.80) / 0.24));
      const hz = notes[i % notes.length];

      if (i % 4 === 0) {
        this.triggerThock(ct, 130, 32.7, 0.20, 0.26 * (0.55 + 0.45 * heat), out, 'sine');
      }

      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(i % 2 === 0 ? -0.24 : 0.24, ct);
      p.connect(shaper);

      const cutPeak = 360 + heat * 2250 + (i % 4 === 2 ? 420 : 0);
      this.triggerAnalogPluck(ct, hz, cutPeak, 4.2, 0.115, 0.135 * (0.45 + 0.55 * heat), p, 'sawtooth', -5);
      this.triggerAnalogPluck(ct, hz, cutPeak, 4.0, 0.115, 0.125 * (0.45 + 0.55 * heat), p, 'sawtooth', 5);
    }

    // 3) Crisp solenoid relay release + dark resonant power-down settle when Burst completes
    const relT = now + durationSec + 0.02;
    this.triggerStrike(relT, 3100, 3.0, 0.008, 0.24, out);
    this.triggerThock(relT + 0.014, 150, 49.0, 0.18, 0.28, out, 'sine');
    this.triggerAnalogPluck(relT + 0.014, 65.41, 580, 3.0, 0.38, 0.14, out, 'sawtooth');
  }

  /** Soft analog tape/tube saturation curve for bold sci-fi sub-bass & brass monolith weight */
  private buildWarmDriveCurve(drive = 2.4): Float32Array<ArrayBuffer> {
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  /**
   * Launch (or queue until browser gesture unlock) the synchronized 5.4s Dark Sci-Fi Cold Boot Score.
   *
   * Narrative arc matching the visual power-on choreography:
   *   0.00-0.90s : Deep C1/G1 blackout sub-void drone (beating low-frequency tension)
   *   0.90-1.75s : Massive PMIC breaker SLAM + C1 sub-drop + saturated reactor rail charge riser
   *   1.38-2.25s : Cold FM metallic clock-lock impulse + dark stereo plasma/fabric sweep
   *   1.85-2.75s : Hard-panned stereo LPDDR5 high-speed digital bus handshake bursts
   *   2.20-3.85s : Heavy rhythmic electromagnetic cluster ignition thumps (E-cores -> P-cores -> GPU)
   *   2.25-5.95s : Bold wide-stereo saturated dark sci-fi brass monolith swell (C minor/open 5th + 9th)
   *   4.22-4.55s : Mechanical Leica optical reticle lock + dual-detent Liquid Glass rail calibration
   */
  public startIntroScore(offsetSec = 0): void {
    this.stopIntroScore(0.10);
    if (this.userMuted) return;

    this.introRunning = true;
    this.introScheduled = false;
    this.introStartWallMs = performance.now() - offsetSec * 1000;

    if (!this.initialized) {
      this.initGraph();
    }
    if (!this.ctx) return;

    if (this.ctx.state === 'running') {
      this.autoSuspended = false;
      this.syncMasterGain(0.015);
      this.emitState();
      this.scheduleCinematicIntro(offsetSec);
    } else if (this.ctx.state === 'suspended') {
      // Attempt autoplay silently (succeeds when browser permits or when waking from autoSuspended / user gesture like `R`!)
      void this.ctx
        .resume()
        .then(() => {
          this.autoSuspended = false;
          this.syncMasterGain(0.015);
          this.emitState();
          this.maybeLaunchPendingIntro();
        })
        .catch(() => {
          this.emitState();
        });
    }
  }

  /** Smoothly fade out & cancel the cinematic score if the user skips the intro early or mutes */
  public stopIntroScore(fadeSec = 0.28): void {
    this.introRunning = false;
    this.introScheduled = false;

    const ctx = this.ctx;
    const bus = this.introScoreBus;
    const sources = this.introSources;
    this.introScoreBus = null;
    this.introSources = [];

    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    try {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fadeSec));
    } catch {
      // ignore
    }
    const stopAt = now + Math.max(0.03, fadeSec) + 0.04;
    for (const s of sources) {
      try {
        s.stop(stopAt);
      } catch {
        // already stopped
      }
    }
  }

  private maybeLaunchPendingIntro(): void {
    if (!this.introRunning || this.introScheduled || !this.isActive()) return;
    const elapsed = (performance.now() - this.introStartWallMs) / 1000;
    if (elapsed >= 6.45) {
      this.introRunning = false;
      return;
    }
    this.scheduleCinematicIntro(Math.max(0, elapsed));
  }

  private scheduleCinematicIntro(offsetSec: number): void {
    if (!this.ctx || !this.isActive()) return;
    this.touchAudio(Math.max(4.0, 14.5 - offsetSec));
    this.introScheduled = true;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t0 = now - offsetSec;

    const scoreBus = ctx.createGain();
    scoreBus.gain.setValueAtTime(offsetSec > 0.05 ? 0.0001 : 1.0, now);
    if (offsetSec > 0.05) {
      scoreBus.gain.linearRampToValueAtTime(1.0, now + 0.14);
    }

    const drySend = ctx.createGain();
    drySend.gain.setValueAtTime(0.88, now);
    const hallSend = ctx.createGain();
    hallSend.gain.setValueAtTime(0.86, now);

    scoreBus.connect(drySend);
    drySend.connect(this.dryBus);
    scoreBus.connect(hallSend);
    hallSend.connect(this.cinemaSend);

    this.introScoreBus = scoreBus;
    const sources: AudioScheduledSourceNode[] = [];
    this.introSources = sources;

    const driveCurve = this.warmDriveCurve;

    const makePan = (panVal: number): StereoPannerNode => {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(panVal, -0.85, 0.85), now);
      p.connect(scoreBus);
      return p;
    };

    // -------------------------------------------------------------------------
    // ACT 0 (0.00 - 2.45s): Centered Title on Black -> Dormant Chip Fades In + C1 Sub + Clock Ticks
    // -------------------------------------------------------------------------
    if (t0 + 2.48 > now) {
      const sT = Math.max(now, t0 + 0.12);
      const peakT = Math.max(sT + 0.12, t0 + 2.38);
      const endT = Math.max(peakT + 0.05, t0 + 2.48);

      const subPre = ctx.createOscillator();
      subPre.type = 'sine';
      subPre.frequency.setValueAtTime(32.7, sT);
      const spg = ctx.createGain();
      spg.gain.setValueAtTime(0.0001, sT);
      spg.gain.linearRampToValueAtTime(0.21, peakT);
      spg.gain.exponentialRampToValueAtTime(0.0001, endT);
      subPre.connect(spg);
      spg.connect(scoreBus);
      subPre.start(sT);
      subPre.stop(endT + 0.02);
      sources.push(subPre);

      // Subtle resonant pulse under the title, then accelerating clock ticks as the dormant chip fades in!
      const preTicks: [number, number, number][] = [
        [0.65, 1650, 0.11],
        [1.56, 2100, 0.14],
        [2.02, 2650, 0.17],
        [2.28, 3150, 0.21],
      ];
      for (const [cue, hz, amp] of preTicks) {
        if (t0 + cue >= now - 0.02) {
          const ct = Math.max(now, t0 + cue);
          this.triggerStrike(ct, hz, 3.8, 0.007, amp, scoreBus);
          this.triggerThock(ct, 155, 52, 0.06, amp * 0.92, scoreBus, 'triangle');
        }
      }
    }

    // -------------------------------------------------------------------------
    // ACT 1-5 (2.45 - 9.42s): Extended Option-A Dark Electro Moog 16th Arp
    //   - Bars 1-3 (steps 0..23, 2.45-5.66s): Power-on build opening filter to climax
    //   - Bars 4-6 (steps 24..51, 5.66-9.42s): Hypnotic post-reveal groove slowly closing filter & fading out!
    // -------------------------------------------------------------------------
    const basePattern = [
      65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0,
      65.41, 65.41, 130.81, 65.41, 116.54, 98.0, 77.78, 65.41,
      51.91, 51.91, 103.83, 51.91, 77.78, 98.0, 130.81, 155.56,
      // Extended outro groove (C-minor hypnotic pulse gradually drifting into dark stillness)
      65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0,
      65.41, 65.41, 130.81, 65.41, 98.0, 77.78, 65.41, 98.0,
      65.41, 65.41, 98.0, 65.41, 77.78, 65.41, 65.41, 65.41,
      65.41, 65.41, 65.41, 65.41,
    ];
    const step = 0.134;
    const arpDrive = ctx.createWaveShaper();
    arpDrive.curve = driveCurve;
    arpDrive.connect(scoreBus);

    // Reusable L/R panners (zero extra panner allocations per step!)
    const arpPanL = ctx.createStereoPanner();
    arpPanL.pan.setValueAtTime(-0.22, now);
    arpPanL.connect(arpDrive);
    const arpPanR = ctx.createStereoPanner();
    arpPanR.pan.setValueAtTime(0.22, now);
    arpPanR.connect(arpDrive);

    for (let i = 0; i < basePattern.length; i++) {
      const cueSec = 2.45 + i * step;
      if (t0 + cueSec + 0.14 <= now) continue;
      const ct = Math.max(now, t0 + cueSec);
      const hz = basePattern[i];

      const isOutro = i >= 24;
      const buildProg = isOutro ? 1.0 : i / 23;
      const outroFade = isOutro ? Math.pow(1.0 - (i - 24) / 28, 1.45) : 1.0;

      if (i % 4 === 0 && t0 + cueSec >= now - 0.02 && outroFade > 0.16) {
        const kickAmp = 0.35 * (0.72 + buildProg * 0.32) * outroFade;
        this.triggerThock(ct, 138, 32.7, 0.24, kickAmp, scoreBus, 'sine');
        this.triggerStrike(ct, 2500 + buildProg * 1100, 2.2, 0.008, (0.14 + buildProg * 0.06) * outroFade, scoreBus);
      }

      if (i >= 16 && i < 24 && t0 + cueSec >= now - 0.02) {
        const bp = (i - 16) / 7;
        const tickOut = makePan(i % 2 === 0 ? -0.34 : 0.34);
        this.triggerStrike(ct, 3600 + bp * 1800, 4.2, 0.004, 0.10 + bp * 0.09, tickOut);
      }

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.setValueAtTime(isOutro ? 2.4 + outroFade * 1.8 : 4.2, ct);
      const cutPeak = isOutro
        ? 160 + outroFade * 2250 + (i % 4 === 2 ? 320 * outroFade : 0)
        : 320 + buildProg * 2450 + (i % 4 === 2 ? 460 : 0);
      lp.frequency.setValueAtTime(cutPeak, ct);
      lp.frequency.exponentialRampToValueAtTime(Math.max(85, 110 * Math.max(0.7, outroFade)), ct + 0.118);

      const g = ctx.createGain();
      const peak = Math.max(0.004, 0.17 * (0.55 + buildProg * 0.55) * outroFade);
      g.gain.setValueAtTime(0.0001, ct);
      g.gain.linearRampToValueAtTime(peak, ct + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.128);

      lp.connect(g);
      g.connect(i % 2 === 0 ? arpPanL : arpPanR);

      const detunes = outroFade > 0.35 ? [-6, 6] : [0];
      for (const det of detunes) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(hz, ct);
        if (det !== 0) osc.detune.setValueAtTime(det, ct);
        osc.connect(lp);
        osc.start(ct);
        osc.stop(ct + 0.14);
        sources.push(osc);
      }
    }

    // -------------------------------------------------------------------------
    // ACT 5-OUTRO (5.66 - 11.60s): Resolving C-Minor Dark Synth Bed Slowly Fading Out!
    // -------------------------------------------------------------------------
    if (t0 + 11.6 > now) {
      const tRes = Math.max(now, t0 + 5.66);
      const holdT = Math.max(tRes + 0.25, t0 + 7.30);
      const endT = Math.max(holdT + 0.80, t0 + 11.60);

      if (t0 + 5.66 >= now - 0.03) {
        this.triggerThock(tRes, 132, 32.7, 0.52, 0.44, scoreBus, 'sine');
      }

      const rDrive = ctx.createWaveShaper();
      rDrive.curve = driveCurve;
      const rLp = ctx.createBiquadFilter();
      rLp.type = 'lowpass';
      rLp.Q.setValueAtTime(1.3, tRes);
      rLp.frequency.setValueAtTime(1650, tRes);
      rLp.frequency.exponentialRampToValueAtTime(680, holdT);
      rLp.frequency.exponentialRampToValueAtTime(115, endT);

      const rG = ctx.createGain();
      rG.gain.setValueAtTime(0.0001, tRes);
      rG.gain.linearRampToValueAtTime(0.24, tRes + 0.035);
      rG.gain.linearRampToValueAtTime(0.17, holdT);
      rG.gain.exponentialRampToValueAtTime(0.0001, endT);

      rDrive.connect(rLp);
      rLp.connect(rG);
      rG.connect(scoreBus);

      const resolveVoices: [number, number, number, OscillatorType, number][] = [
        [32.7, 0, 0.0, 'sine', 0.48],
        [65.41, -6, -0.35, 'sawtooth', 0.24],
        [65.41, 6, 0.35, 'sawtooth', 0.24],
        [98.0, 0, 0.0, 'triangle', 0.22],
        [130.81, -4, -0.45, 'sawtooth', 0.16],
        [130.81, 4, 0.45, 'sawtooth', 0.16],
        [155.56, 5, 0.52, 'triangle', 0.09],
      ];
      for (const [hz, det, pv, type, lvl] of resolveVoices) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(hz, tRes);
        o.detune.setValueAtTime(det, tRes);
        const vg = ctx.createGain();
        vg.gain.setValueAtTime(lvl, tRes);
        const p = ctx.createStereoPanner();
        p.pan.setValueAtTime(pv, tRes);
        o.connect(vg);
        vg.connect(p);
        p.connect(rDrive);
        o.start(tRes);
        o.stop(endT + 0.06);
        sources.push(o);
      }
    }

    // Crisp optical reticle lock (5.80s) + dual-detent Liquid Glass rail calibration (6.10s)
    if (t0 + 5.80 >= now - 0.03) {
      const lockT = Math.max(now, t0 + 5.80);
      const out = this.routeOut(0, 0.85, 0.25);
      this.triggerStrike(lockT, 4400, 3.0, 0.008, 0.28, out);
      this.triggerStrike(lockT + 0.024, 2200, 2.2, 0.014, 0.32, out);
      this.triggerThock(lockT + 0.024, 240, 66, 0.062, 0.32, out, 'triangle');
    }

    if (t0 + 6.10 >= now - 0.03) {
      const hudT = Math.max(now, t0 + 6.10);
      const out = this.routeOut(0, 0.65, 0.16);
      this.triggerStrike(hudT, 3500, 3.6, 0.006, 0.18, out);
      this.triggerAnalogPluck(hudT, 130.81, 950, 3.6, 0.055, 0.10, out, 'sawtooth');
      this.triggerStrike(hudT + 0.068, 4100, 3.6, 0.006, 0.20, out);
      this.triggerAnalogPluck(hudT + 0.068, 196.0, 1350, 3.6, 0.06, 0.11, out, 'sawtooth');
    }
  }

  /** Legacy phase hook kept for compatibility (cues are now sample-accurately scored in startIntroScore) */
  public onIntroPhase(_phase: AudioIntroPhase): void {
    // Handled with sample-accurate cinematic timing by startIntroScore()
  }
}
