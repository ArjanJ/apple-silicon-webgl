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

/** Modal chassis ring frequencies for each of the 11 objective turret stops */
const TURRET_MODAL_HZ = [
  520,   // -1 Scale
  585,   //  0 Die
  655,   //  1 Power
  735,   //  2 Routing
  825,   //  3 Rows
  925,   //  4 Cell
  1040,  //  5 Gate
  1170,  //  6 Lattice
  1310,  //  7 Atom
  360,   //  8 Nucleus (heavy tungsten-steel detent after the 35,800x void!)
  295,   //  9 Quarks (deepest solid vault lock)
] as const;

export class SiliconAudio {
  private ctx: AudioContext | null = null;
  private initialized = false;
  private userMuted = false;
  private tabHidden = false;
  private stateChangeCb?: (active: boolean, muted: boolean) => void;

  // Master graph (close-miked mechanical acoustics: tight studio room + punchy bus limiter)
  private masterGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private dryBus!: GainNode;
  private roomSend!: GainNode;
  private convolver!: ConvolverNode;
  private roomGain!: GainNode;

  // Pre-generated impulse & mechanical texture buffers (zero runtime allocation!)
  private crispNoiseBuf!: AudioBuffer;
  private brushedNoiseBuf!: AudioBuffer;

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
        this.syncMasterGain(0.06);
      });
    }
  }

  public isActive(): boolean {
    return this.initialized && !this.userMuted && !this.tabHidden && this.ctx?.state === 'running';
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

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        this.syncMasterGain(0.015);
        this.emitState();
      });
    } else if (this.ctx.state === 'running') {
      this.syncMasterGain(0.015);
      this.emitState();
    }
  }

  /** Explicit toggle from Sound HUD button or `M` key */
  public toggle(): boolean {
    if (!this.initialized || this.ctx?.state !== 'running') {
      this.userMuted = false;
      if (!this.initialized) {
        this.initGraph();
      }
      if (this.ctx) {
        void this.ctx.resume().then(() => {
          this.syncMasterGain(0.012);
          this.emitState();
          this.playUiTap(true);
        });
      }
      this.emitState();
      return true;
    }

    this.userMuted = !this.userMuted;
    if (!this.userMuted) {
      this.syncMasterGain(0.012);
      this.playUiTap(true);
    } else {
      this.playMuteSwitch();
      this.syncMasterGain(0.08);
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

    this.dryBus.connect(this.compressor);
    this.roomSend.connect(this.convolver);
    this.convolver.connect(this.roomGain);
    this.roomGain.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.crispNoiseBuf = this.buildCrispNoiseBuffer(ctx, 0.35);
    this.brushedNoiseBuf = this.buildBrushedMetalBuffer(ctx, 1.4);

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

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      let hp = 0;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
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

  private routeOut(panVal = 0, roomMix = 1.0): AudioNode {
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
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, TURRET_MODAL_HZ.length - 1);
    }

    const dz = zoom - this.lastZoom;
    this.lastZoom = zoom;

    if (!this.isActive() || !this.ctx) {
      this.lastTickZoom = zoom;
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, TURRET_MODAL_HZ.length - 1);
      return;
    }

    const z = clamp(zoom, -2.4, 9.0);

    // 1) Knurled Leica/Zeiss focus-ring ball-bearing detent ticks while zooming
    if (!introActive && Math.abs(z - this.lastTickZoom) >= 0.088 && nowMs - this.lastTickMs >= 38) {
      const zoomingIn = dz >= 0;
      this.playFocusDetent(zoomingIn, clamp(motion, 0.15, 1.0), z);
      this.lastTickZoom = z;
      this.lastTickMs = nowMs;
    }

    // 2) Heavy objective turret detent lock when crossing one of the 11 named scale stops
    const stopIdx = clamp(Math.round(z) + 1, 0, TURRET_MODAL_HZ.length - 1);
    if (!introActive && stopIdx !== this.lastStopIdx) {
      const direction = stopIdx > this.lastStopIdx ? 1 : -1;
      this.lastStopIdx = stopIdx;
      this.playTurretLock(stopIdx, direction);
    }
  }

  /**
   * Knurled-metal aperture/focus-ring ball-bearing detent:
   * Crisp steel micro-tick + tight machined-aluminum barrel knock.
   */
  private playFocusDetent(zoomingIn: boolean, vel: number, z: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(zoomingIn ? 0.05 : -0.05, 0.45);

    // Tiny ±3% organic tolerance so rapid scrolling sounds like real machined teeth
    const jitter = 0.97 + Math.random() * 0.06;
    const scaleNorm = clamp((z + 1) / 10, 0, 1);

    // Steel ball-bearing notch strike
    const strikeHz = ((zoomingIn ? 3550 : 2750) + scaleNorm * 750) * jitter;
    const strikeGain = (0.14 + vel * 0.12);
    this.triggerStrike(now, strikeHz, 3.4, 0.007, strikeGain, out);

    // Solid anodized-aluminum barrel body knock
    const bodyStart = ((zoomingIn ? 420 : 330) + scaleNorm * 110) * jitter;
    const bodyEnd = bodyStart * 0.42;
    this.triggerThock(now, bodyStart, bodyEnd, 0.016, 0.095 + vel * 0.075, out, 'triangle');
  }

  /**
   * Zeiss Objective Lens Turret Stop Lock:
   * Signature two-part mechanical *snick-CLUNK* when crossing a named magnification stop!
   */
  private playTurretLock(stopIdx: number, direction: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.85);
    const modalHz = TURRET_MODAL_HZ[stopIdx] ?? 780;
    const isSubatomic = stopIdx >= 9; // Heavy vault-latch weight past the 35,800x void!

    // Stage 1 (t = 0ms): spring-loaded latch pin slipping over bevel
    this.triggerStrike(now, direction > 0 ? 4100 : 3300, 2.8, 0.008, 0.20, out);

    // Stage 2 (t = 18ms): solid mechanical detent drop & chassis seat
    const seatT = now + (isSubatomic ? 0.022 : 0.017);
    this.triggerStrike(seatT, isSubatomic ? 1650 : 2450, 2.2, 0.014, isSubatomic ? 0.34 : 0.24, out);
    this.triggerThock(
      seatT,
      isSubatomic ? 195 : 265,
      isSubatomic ? 58 : 92,
      isSubatomic ? 0.068 : 0.042,
      isSubatomic ? 0.36 : 0.24,
      out,
      'triangle'
    );
    // Subtle precision brass/steel housing overtone
    this.triggerMetalRing(
      seatT,
      modalHz,
      1.585,
      isSubatomic ? 0.16 : 0.085,
      isSubatomic ? 0.095 : 0.068,
      out
    );
  }

  /**
   * Material-aware physical probe ticks when hovering blocks on the Apple Silicon die / US Quarter.
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
    const out = this.routeOut(panVal, 0.75);

    if (hitId === 'us-quarter') {
      // Authentic cupronickel coin strike + 3 inharmonic metallic partials
      this.triggerStrike(now, 5800, 2.6, 0.006, 0.24, out);
      this.triggerMetalRing(now, 2560, 1.608, 0.13, 0.115, out);
      this.triggerMetalRing(now, 6180, 1.31, 0.055, 0.045, out);
      return;
    }

    if (hitId === 'slc' || hitId.startsWith('ram-')) {
      // Dense matte epoxy / ceramic package *thock*
      this.triggerStrike(now, 1550, 1.8, 0.009, 0.16, out);
      this.triggerThock(now, 310, 118, 0.032, 0.21, out, 'triangle');
      return;
    }

    if (hitId === 'gpu' || hitId === 'ane') {
      // Crisp twin-pin micro-switch double-tap + machined titanium shimmer
      this.triggerStrike(now, 3400, 3.0, 0.006, 0.16, out);
      this.triggerStrike(now + 0.011, 2900, 2.6, 0.007, 0.13, out);
      this.triggerMetalRing(now + 0.011, 1380, 1.62, 0.05, 0.055, out);
      return;
    }

    if (hitId === 'smd-caps') {
      // Tiny crisp MLCC ceramic capacitor snap
      this.triggerStrike(now, 4800, 4.2, 0.005, 0.16, out);
      this.triggerMetalRing(now, 2920, 1.48, 0.024, 0.05, out);
      return;
    }

    if (hitId === 'io-phy' || hitId === 'media') {
      // Spring-loaded precision connector tick
      this.triggerStrike(now, 2750, 2.5, 0.008, 0.18, out);
      this.triggerThock(now, 460, 170, 0.022, 0.14, out, 'sine');
      return;
    }

    // Performance & Efficiency Cores: precision silicon-wafer stepped relay tick
    const coreIdx = hitId.startsWith('pcore-') ? Number(hitId.slice(6)) || 0 : 0;
    const stepHz = 1650 + (coreIdx % 8) * 115;
    this.triggerStrike(now, 3600 + (coreIdx % 8) * 160, 3.6, 0.006, 0.17, out);
    this.triggerThock(now, 480 + (coreIdx % 8) * 28, 195, 0.018, 0.12, out, 'triangle');
    this.triggerMetalRing(now, stepHz, 1.51, 0.036, 0.048, out);
  }

  /**
   * Mechanical optical reticle clamp lock (open) & spring unlatch (close) for Inspect Card.
   */
  public playInspect(open: boolean, hitId?: string): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.9);
    const isCoin = hitId === 'us-quarter';

    if (open) {
      // Precision SLR / optical clamp lock: crisp *snick* -> solid *THOCK*
      this.triggerStrike(now, 4400, 3.0, 0.008, 0.24, out);
      this.triggerThock(now, 520, 210, 0.018, 0.14, out, 'triangle');

      const t2 = now + 0.026;
      this.triggerStrike(t2, isCoin ? 5200 : 2500, 2.4, 0.012, 0.28, out);
      this.triggerThock(t2, 290, 96, 0.046, 0.28, out, 'triangle');
      this.triggerMetalRing(t2, isCoin ? 2560 : 1180, isCoin ? 1.608 : 1.56, isCoin ? 0.15 : 0.095, 0.09, out);
    } else {
      // Spring-return mechanical unlatch: *clik-thup*
      this.triggerStrike(now, 3100, 2.6, 0.007, 0.18, out);
      const t2 = now + 0.018;
      this.triggerThock(t2, 240, 105, 0.032, 0.19, out, 'triangle');
      this.triggerMetalRing(t2, 740, 1.49, 0.055, 0.045, out);
    }
  }

  /**
   * Motorized helical lens barrel & solenoid clutch sweep when diving / clicking zoom rail stops.
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
    const out = this.routeOut(0, 0.85);
    const divingIn = toZ > fromZ;
    const dur = clamp(0.20 + dist * 0.055, 0.24, 0.58);

    // 1) Crisp solenoid clutch engage click at launch
    this.triggerStrike(now, divingIn ? 3800 : 3000, 2.8, 0.008, 0.22, out);
    this.triggerThock(now, divingIn ? 360 : 280, 120, 0.028, 0.18, out, 'triangle');

    // 2) Brushed helical-thread & precision servo barrel glide
    const src = ctx.createBufferSource();
    src.buffer = this.brushedNoiseBuf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(2.6, now);
    bp.frequency.setValueAtTime(divingIn ? 420 : 1480, now);
    bp.frequency.exponentialRampToValueAtTime(divingIn ? 1620 : 380, now + dur);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(clamp(0.11 + dist * 0.02, 0.12, 0.24), now + 0.045);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now);
    src.stop(now + dur + 0.03);

    // Subtle precision micro-motor whirr harmonic
    const motor = ctx.createOscillator();
    motor.type = 'triangle';
    motor.frequency.setValueAtTime(divingIn ? 190 : 360, now);
    motor.frequency.exponentialRampToValueAtTime(divingIn ? 390 : 175, now + dur * 0.88);
    const mlp = ctx.createBiquadFilter();
    mlp.type = 'lowpass';
    mlp.frequency.setValueAtTime(620, now);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.0001, now);
    mg.gain.linearRampToValueAtTime(0.055, now + 0.04);
    mg.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.92);
    motor.connect(mlp);
    mlp.connect(mg);
    mg.connect(out);
    motor.start(now);
    motor.stop(now + dur);
  }

  /**
   * Custom machined mechanical switch (click-thock on engage, crisp upstroke on release).
   */
  public playUiTap(active: boolean): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.65);

    if (active) {
      // Tactile leaf-spring snap + solid housing bottom-out thock
      this.triggerStrike(now, 3700, 3.4, 0.007, 0.24, out);
      this.triggerThock(now + 0.013, 330, 118, 0.034, 0.24, out, 'triangle');
      this.triggerMetalRing(now + 0.013, 1480, 1.54, 0.045, 0.055, out);
    } else {
      // Lighter crisp keycap/switch upstroke release
      this.triggerStrike(now, 2500, 2.8, 0.007, 0.18, out);
      this.triggerThock(now + 0.006, 240, 108, 0.025, 0.17, out, 'triangle');
    }
  }

  /** Tactile switch-off click played right before muting */
  private playMuteSwitch(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const out = this.routeOut(0, 0.4);
    this.triggerStrike(now, 2300, 2.8, 0.007, 0.20, out);
    this.triggerThock(now + 0.008, 220, 95, 0.028, 0.20, out, 'triangle');
  }

  /**
   * Heavy electromagnetic contactor throw + precision micro-flywheel spin-up & relay release!
   */
  public triggerBurst(durationSec = 3.5): void {
    if (!this.ctx || !this.isActive()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.routeOut(0, 0.9);

    // 1) Heavy two-stage contactor switch clunk (KA-CLACK!)
    this.triggerStrike(now, 3400, 2.2, 0.011, 0.30, out);
    this.triggerThock(now, 310, 110, 0.036, 0.26, out, 'triangle');
    this.triggerStrike(now + 0.026, 1850, 1.9, 0.018, 0.36, out);
    this.triggerThock(now + 0.026, 210, 56, 0.075, 0.40, out, 'triangle');
    this.triggerMetalRing(now + 0.026, 620, 1.61, 0.14, 0.095, out);

    // 2) Precision lab micro-flywheel / turbine spin-up & spin-down
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(72, now + 0.03);
    osc1.frequency.exponentialRampToValueAtTime(220, now + 0.52);
    osc1.frequency.setValueAtTime(220, now + durationSec - 0.55);
    osc1.frequency.exponentialRampToValueAtTime(64, now + durationSec + 0.25);

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(108, now + 0.03);
    osc2.frequency.exponentialRampToValueAtTime(330, now + 0.52);
    osc2.frequency.setValueAtTime(330, now + durationSec - 0.55);
    osc2.frequency.exponentialRampToValueAtTime(96, now + durationSec + 0.25);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(2.4, now);
    lp.frequency.setValueAtTime(180, now + 0.03);
    lp.frequency.exponentialRampToValueAtTime(1180, now + 0.52);
    lp.frequency.setValueAtTime(1020, now + durationSec - 0.55);
    lp.frequency.exponentialRampToValueAtTime(140, now + durationSec + 0.28);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now + 0.03);
    g.gain.linearRampToValueAtTime(0.145, now + 0.45);
    g.gain.setValueAtTime(0.115, now + durationSec - 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.30);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(out);
    osc1.start(now + 0.03);
    osc2.start(now + 0.03);
    osc1.stop(now + durationSec + 0.34);
    osc2.stop(now + durationSec + 0.34);

    // 3) Crisp solenoid relay release click when Burst completes
    const relT = now + durationSec + 0.02;
    this.triggerStrike(relT, 2900, 2.8, 0.009, 0.26, out);
    this.triggerThock(relT + 0.015, 220, 74, 0.052, 0.28, out, 'triangle');
    this.triggerMetalRing(relT + 0.015, 510, 1.56, 0.09, 0.06, out);
  }

  /**
   * Synchronized "Cold Boot" power-on acoustics:
   *   - power:  precision PMIC micro-relay engage + subtle V_DD rail capacitor charge swell
   *   - fabric: crystal clock-lock double ping + coherent bus sweep
   *   - cores:  staggered silicon core relay bring-up cascade
   *   - lock:   iconic Leica/Zeiss optical reticle lock
   *   - hud:    crisp dual-detent rail calibration ticks
   */
  public onIntroPhase(phase: AudioIntroPhase): void {
    if (!this.ctx || !this.isActive()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.routeOut(0, 0.9);

    if (phase === 'power') {
      // Solid PMIC power-rail relay engage (*snick-THOCK*) + subtle capacitive V_DD charge rise
      this.triggerStrike(now, 3600, 2.6, 0.009, 0.28, out);
      this.triggerThock(now + 0.016, 250, 74, 0.056, 0.32, out, 'triangle');
      this.triggerMetalRing(now + 0.016, 540, 1.54, 0.14, 0.08, out);

      const cap = ctx.createOscillator();
      cap.type = 'sine';
      cap.frequency.setValueAtTime(118, now + 0.02);
      cap.frequency.exponentialRampToValueAtTime(248, now + 0.62);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, now + 0.02);
      cg.gain.linearRampToValueAtTime(0.048, now + 0.18);
      cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.68);
      cap.connect(cg);
      cg.connect(out);
      cap.start(now + 0.02);
      cap.stop(now + 0.72);
    } else if (phase === 'fabric') {
      // Quartz oscillator clock-lock ping + subtle brushed fabric sweep
      this.triggerStrike(now, 4300, 3.6, 0.007, 0.19, out);
      this.triggerMetalRing(now, 1320, 1.50, 0.15, 0.068, out);
      this.triggerMetalRing(now + 0.055, 1980, 1.50, 0.12, 0.052, out);

      const src = ctx.createBufferSource();
      src.buffer = this.brushedNoiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.setValueAtTime(2.6, now);
      bp.frequency.setValueAtTime(340, now);
      bp.frequency.exponentialRampToValueAtTime(1280, now + 0.55);
      bp.frequency.exponentialRampToValueAtTime(480, now + 0.92);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(0.085, now + 0.25);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.96);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      src.start(now);
      src.stop(now + 1.0);
    } else if (phase === 'cores') {
      // Subtle staggered silicon cluster relay ticks (E-cores -> P-cores -> GPU)
      const offsets = [0.0, 0.24, 0.34, 0.44, 0.54, 0.72];
      offsets.forEach((dt, idx) => {
        const t = now + dt;
        const hz = 2900 + idx * 240;
        const outPan = this.routeOut(-0.22 + idx * 0.09, 0.65);
        this.triggerStrike(t, hz, 3.8, 0.005, 0.12 + idx * 0.01, outPan);
        this.triggerThock(t, 360 + idx * 28, 150, 0.016, 0.085, outPan, 'triangle');
      });
    } else if (phase === 'lock') {
      // Iconic mechanical Leica/Zeiss prism & reticle lock (*snick-CLACK!*)
      this.triggerStrike(now, 4500, 3.0, 0.008, 0.28, out);
      this.triggerStrike(now + 0.024, 2400, 2.2, 0.014, 0.34, out);
      this.triggerThock(now + 0.024, 260, 78, 0.062, 0.34, out, 'triangle');
      this.triggerMetalRing(now + 0.024, 980, 1.59, 0.18, 0.11, out);
    } else if (phase === 'hud') {
      // Crisp dual-detent rail calibration ticks (tk-tk)
      this.triggerStrike(now, 3600, 3.4, 0.007, 0.20, out);
      this.triggerThock(now, 380, 155, 0.022, 0.16, out, 'triangle');
      this.triggerStrike(now + 0.068, 4100, 3.4, 0.007, 0.22, out);
      this.triggerThock(now + 0.068, 430, 175, 0.024, 0.18, out, 'triangle');
    }
  }
}
