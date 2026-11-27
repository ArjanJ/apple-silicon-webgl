/**
 * Zero-Dependency Procedural Web Audio Engine for Silicon Microscope
 *
 * Combines:
 *   - Five distinct musical vibes (Cleanroom Glass, Quantum Drift, Silicon Pulse, Late-Night Lab, Cyber Noir)
 *   - Synchronized 7-second Cold Boot intro scores that seamlessly hand off into an infinite,
 *     quiet, evolving background loop via a sample-accurate lookahead scheduler
 *   - Harmonically tuned tactile microscope foley (focus-ring detents, objective turret locks,
 *     material-accurate hover probe taps, inspect clamp locks, dive glides, and overclock bursts)
 *     that automatically adapt to the active vibe's musical key and gently duck the background bed
 */

import {
  BGM_LEVEL_OPTIONS,
  BgmLevelId,
  getVibeMeta,
  IntroCueMap,
  MUSIC_VIBES,
  MusicVibeId,
  MusicVibeMeta,
  scheduleVibeIntro,
  scheduleVibeLoopStep,
  SynthToolkit,
} from './vibes';

export { BGM_LEVEL_OPTIONS, MUSIC_VIBES };
export type { BgmLevelId, IntroCueMap, MusicVibeId, MusicVibeMeta };

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

const STORAGE_VIBE_KEY = 'silicon-microscope-vibe-v3';
const STORAGE_BGM_KEY = 'silicon-microscope-bgm-level';

function loadStoredVibe(): MusicVibeId {
  try {
    const raw = window.localStorage.getItem(STORAGE_VIBE_KEY);
    if (raw && MUSIC_VIBES.some((v) => v.id === raw)) {
      return raw as MusicVibeId;
    }
  } catch {
    // ignore storage errors
  }
  return 'minimal';
}

function loadStoredBgmLevel(): BgmLevelId {
  try {
    const raw = window.localStorage.getItem(STORAGE_BGM_KEY);
    if (raw && BGM_LEVEL_OPTIONS.some((o) => o.id === raw)) {
      return raw as BgmLevelId;
    }
  } catch {
    // ignore storage errors
  }
  return 'quiet';
}

function getBgmGainForLevel(level: BgmLevelId): number {
  return BGM_LEVEL_OPTIONS.find((o) => o.id === level)?.gain ?? 0.44;
}

export class SiliconAudio {
  private ctx: AudioContext | null = null;
  private initialized = false;
  private userMuted = false;
  private tabHidden = false;
  private autoSuspended = false;
  private activeUntilWallMs = 0;
  private idleSuspendTimer: number | null = null;
  private stateChangeCb?: (active: boolean, muted: boolean) => void;

  // Vibe & Background Music Loop state
  private vibeId: MusicVibeId = loadStoredVibe();
  private bgmLevel: BgmLevelId = loadStoredBgmLevel();
  private bgmRunning = false;
  private bgmWanted = false;
  private bgmSuspendedByTab = false;
  private bgmTimer: number | null = null;
  private bgmStepIdx = 0;
  private bgmCycleIdx = 0;
  private bgmNextStepTime = 0;
  private bgmActiveBus: GainNode | null = null;
  private bgmTrackedNodes = new Set<AudioScheduledSourceNode>();
  private burstDuckTimer: number | null = null;
  private burstDucking = false;
  private depthNorm = 0.1;
  private lastFilterDepth = -1;

  // Master graph (close-miked mechanical acoustics + wide cinematic hall bus + quiet BGM bus)
  private masterGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private dryBus!: GainNode;
  private roomSend!: GainNode;
  private convolver!: ConvolverNode;
  private roomGain!: GainNode;
  private cinemaSend!: GainNode;
  private cinemaConvolver!: ConvolverNode;
  private cinemaGain!: GainNode;

  // Persistent quiet background loop shaping chain
  private bgmFilter!: BiquadFilterNode;
  private bgmDuckGain!: GainNode;
  private bgmLevelGain!: GainNode;
  private bgmDelaySend!: GainNode;
  private bgmDelayL!: DelayNode;
  private bgmDelayR!: DelayNode;
  private introDelaySend!: GainNode;
  private introDelayL!: DelayNode;
  private introDelayR!: DelayNode;

  // Active cinematic Cold Boot score state (for clean sync, mid-intro unlock, & early skip fadeout)
  private introRunning = false;
  private introClockActive = false;
  private introOriginAudioTime: number | null = null;
  private introStartWallMs = 0;
  private introScoreBus: GainNode | null = null;
  private introSources: AudioScheduledSourceNode[] = [];
  private introScheduled = false;
  private introHandoffTimer: number | null = null;

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
          if (this.bgmRunning) {
            this.bgmSuspendedByTab = true;
            this.stopBackgroundLoop(0.06, false);
          }
          this.syncMasterGain(0.04);
          if (this.ctx?.state === 'running') {
            this.autoSuspended = true;
            void this.ctx.suspend();
          }
        } else {
          const shouldResumeLoop =
            (this.bgmSuspendedByTab || this.bgmWanted) &&
            !this.userMuted &&
            !this.introRunning &&
            this.bgmLevel !== 'off';
          this.bgmSuspendedByTab = false;
          if (shouldResumeLoop && this.ctx) {
            this.autoSuspended = false;
            void this.ctx.resume().then(() => {
              this.syncMasterGain(0.08);
              this.startBackgroundLoop(0.65);
            });
          } else if (this.ctx?.state === 'running') {
            this.syncMasterGain(0.04);
          }
        }
      });
    }
  }

  public getVibe(): MusicVibeMeta {
    return getVibeMeta(this.vibeId);
  }

  public getVibeId(): MusicVibeId {
    return this.vibeId;
  }

  public getBgmLevel(): BgmLevelId {
    return this.bgmLevel;
  }

  public isBgmPlaying(): boolean {
    return this.bgmRunning && !this.userMuted && this.bgmLevel !== 'off';
  }

  /** Switch musical vibe live; immediately crossfades the quiet background loop if audio is active */
  public setVibe(next: MusicVibeId, audition = true): MusicVibeMeta {
    const changed = next !== this.vibeId;
    this.vibeId = next;
    try {
      window.localStorage.setItem(STORAGE_VIBE_KEY, next);
    } catch {
      // ignore
    }
    const meta = getVibeMeta(next);

    if (audition) {
      if (this.userMuted) {
        this.userMuted = false;
      }
      if (this.bgmLevel === 'off') {
        this.bgmLevel = 'quiet';
        try {
          window.localStorage.setItem(STORAGE_BGM_KEY, this.bgmLevel);
        } catch {
          // ignore
        }
      }
      if (!this.initialized) {
        this.initGraph();
      }
      if (this.ctx) {
        const launch = () => {
          this.autoSuspended = false;
          this.syncMasterGain(0.02);
          this.syncBgmLevelGain(0.08);
          this.emitState();
          if (this.introRunning) {
            // Let user hear the newly chosen vibe immediately in the loop if they switch mid-intro
            this.stopIntroScore(0.22, false);
          }
          this.bgmWanted = true;
          this.startBackgroundLoop(changed ? 0.45 : 0.3);
        };
        if (this.ctx.state === 'suspended') {
          void this.ctx.resume().then(launch);
        } else {
          launch();
        }
      }
    } else if (changed && this.bgmRunning && !this.userMuted && this.bgmLevel !== 'off') {
      this.startBackgroundLoop(0.45);
    }

    return meta;
  }

  /** Cycle to the next vibe (used by `V` keyboard shortcut) */
  public cycleVibe(): MusicVibeMeta {
    const idx = MUSIC_VIBES.findIndex((v) => v.id === this.vibeId);
    const next = MUSIC_VIBES[(idx + 1) % MUSIC_VIBES.length];
    return this.setVibe(next.id, true);
  }

  /** Adjust quiet background loop level (Off / Whisper / Quiet / Present) */
  public setBgmLevel(level: BgmLevelId): void {
    this.bgmLevel = level;
    try {
      window.localStorage.setItem(STORAGE_BGM_KEY, level);
    } catch {
      // ignore
    }

    if (level === 'off') {
      this.bgmWanted = false;
      this.stopBackgroundLoop(0.32, false);
      this.syncBgmLevelGain(0.1);
      if (this.ctx?.state === 'running' && !this.introRunning) {
        this.activeUntilWallMs = Math.max(this.activeUntilWallMs, performance.now() + 900);
        this.scheduleIdleSuspend();
      }
      return;
    }

    this.bgmWanted = true;
    if (this.userMuted) {
      this.userMuted = false;
    }
    if (!this.initialized) {
      this.initGraph();
    }
    if (!this.ctx) return;

    const apply = () => {
      this.autoSuspended = false;
      this.syncMasterGain(0.02);
      this.syncBgmLevelGain(0.12);
      this.emitState();
      if (!this.introRunning && !this.bgmRunning) {
        this.startBackgroundLoop(0.55);
      }
    };
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(apply);
    } else {
      apply();
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

  /** Keep AudioContext awake while sounds, reverb tails, or quiet background loop play */
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
    // Keep AudioContext running smoothly while the quiet background music loop is active!
    if (this.bgmRunning && !this.userMuted && !this.tabHidden && this.bgmLevel !== 'off') {
      return;
    }
    const delayMs = Math.max(400, this.activeUntilWallMs - performance.now() + 500);
    this.idleSuspendTimer = window.setTimeout(() => {
      this.idleSuspendTimer = null;
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (this.bgmRunning && !this.userMuted && !this.tabHidden && this.bgmLevel !== 'off') return;
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
      if (this.introRunning && !this.introScheduled) {
        this.maybeLaunchPendingIntro();
      } else if (!this.introRunning && !this.bgmRunning && this.bgmLevel !== 'off') {
        // Reduced-motion or already-finished intro: gently bring up the quiet background loop!
        this.bgmWanted = true;
        this.startBackgroundLoop(0.85);
      }
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
            if (this.bgmLevel !== 'off') {
              this.bgmWanted = true;
              this.startBackgroundLoop(0.7);
            }
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
        if (this.bgmLevel !== 'off') {
          this.bgmWanted = true;
          this.startBackgroundLoop(0.7);
        }
      }
    } else {
      this.stopIntroScore(0.12, false);
      this.stopBackgroundLoop(0.14, false);
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

  private syncBgmLevelGain(tau: number): void {
    if (!this.ctx || !this.bgmLevelGain) return;
    const now = this.ctx.currentTime;
    const target = getBgmGainForLevel(this.bgmLevel);
    this.bgmLevelGain.gain.cancelScheduledValues(now);
    this.bgmLevelGain.gain.setTargetAtTime(target, now, tau);
  }

  private syncBgmDuckGain(target: number, tau: number): void {
    if (!this.ctx || !this.bgmDuckGain) return;
    const now = this.ctx.currentTime;
    this.bgmDuckGain.gain.cancelScheduledValues(now);
    this.bgmDuckGain.gain.setTargetAtTime(target, now, tau);
  }

  private initGraph(): void {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

    // Wide stereo IMAX cinematic hall reverb for Cold Boot score & atmospheric background bed
    this.cinemaSend = ctx.createGain();
    this.cinemaSend.gain.setValueAtTime(0.84, now);

    this.cinemaConvolver = ctx.createConvolver();
    this.cinemaConvolver.buffer = this.buildCinemaHallIR(ctx, 3.2, 2.4);

    this.cinemaGain = ctx.createGain();
    this.cinemaGain.gain.setValueAtTime(0.76, now);

    // Dedicated quiet background loop shaping bus (warmly low-passed, duckable on Burst, lush hall send)
    this.bgmFilter = ctx.createBiquadFilter();
    this.bgmFilter.type = 'lowpass';
    this.bgmFilter.frequency.setValueAtTime(2200, now);
    this.bgmFilter.Q.setValueAtTime(0.55, now);

    this.bgmDuckGain = ctx.createGain();
    this.bgmDuckGain.gain.setValueAtTime(1.0, now);

    this.bgmLevelGain = ctx.createGain();
    this.bgmLevelGain.gain.setValueAtTime(getBgmGainForLevel(this.bgmLevel), now);

    const bgmDry = ctx.createGain();
    bgmDry.gain.setValueAtTime(0.72, now);
    const bgmHall = ctx.createGain();
    bgmHall.gain.setValueAtTime(0.72, now);

    this.bgmFilter.connect(this.bgmDuckGain);
    this.bgmDuckGain.connect(this.bgmLevelGain);
    this.bgmLevelGain.connect(bgmDry);
    this.bgmLevelGain.connect(bgmHall);
    bgmDry.connect(this.dryBus);
    bgmHall.connect(this.cinemaSend);

    // Tempo-synced stereo ping-pong dotted-8th delay buses (separate BGM & Intro returns so levels/ducking stay exact)
    const bgmDelay = this.buildPingPongDelay(ctx, 0.416, this.bgmDuckGain);
    this.bgmDelaySend = bgmDelay.send;
    this.bgmDelayL = bgmDelay.delayL;
    this.bgmDelayR = bgmDelay.delayR;

    const introDelayReturn = ctx.createGain();
    introDelayReturn.gain.setValueAtTime(0.75, now);
    introDelayReturn.connect(this.dryBus);
    introDelayReturn.connect(this.cinemaSend);
    const introDelay = this.buildPingPongDelay(ctx, 0.416, introDelayReturn);
    this.introDelaySend = introDelay.send;
    this.introDelayL = introDelay.delayL;
    this.introDelayR = introDelay.delayR;

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
    this.syncVibeShaping(0.01);
    this.emitState();
  }

  /** Clean tempo-synced stereo ping-pong delay with bandpass-filtered feedback */
  private buildPingPongDelay(
    ctx: AudioContext,
    initialDelaySec: number,
    dest: AudioNode
  ): { send: GainNode; delayL: DelayNode; delayR: DelayNode } {
    const now = ctx.currentTime;
    const send = ctx.createGain();
    send.gain.setValueAtTime(0.36, now);

    const delayL = ctx.createDelay(1.5);
    const delayR = ctx.createDelay(1.5);
    delayL.delayTime.setValueAtTime(initialDelaySec, now);
    delayR.delayTime.setValueAtTime(initialDelaySec, now);

    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.setValueAtTime(0.36, now);
    fbR.gain.setValueAtTime(0.36, now);

    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'bandpass';
    fbFilter.frequency.setValueAtTime(1650, now);
    fbFilter.Q.setValueAtTime(0.55, now);

    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.setValueAtTime(-0.68, now);
    panR.pan.setValueAtTime(0.68, now);

    send.connect(delayL);
    delayL.connect(panL);
    panL.connect(dest);
    delayL.connect(fbL);
    fbL.connect(delayR);
    delayR.connect(panR);
    panR.connect(dest);
    delayR.connect(fbFilter);
    fbFilter.connect(fbR);
    fbR.connect(delayL);

    return { send, delayL, delayR };
  }

  /** Tune BGM filter ceiling & dotted-8th stereo delay time to the active vibe */
  private syncVibeShaping(tau = 0.08): void {
    if (!this.ctx || !this.bgmFilter) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const targetCutoff =
      this.vibeId === 'minimal' ? 5400 + this.depthNorm * 6600 : 1950 + this.depthNorm * 1850;
    this.bgmFilter.frequency.setTargetAtTime(targetCutoff, now, tau);
    this.lastFilterDepth = this.depthNorm;

    const beatSec = vibe.stepSec >= 0.4 ? vibe.stepSec : vibe.stepSec * 4;
    const dottedEighth = clamp(beatSec * 0.75, 0.18, 0.9);
    if (this.bgmDelayL && this.bgmDelayR) {
      this.bgmDelayL.delayTime.setTargetAtTime(dottedEighth, now, tau);
      this.bgmDelayR.delayTime.setTargetAtTime(dottedEighth, now, tau);
    }
    if (this.introDelayL && this.introDelayR) {
      this.introDelayL.delayTime.setTargetAtTime(dottedEighth, now, tau);
      this.introDelayR.delayTime.setTargetAtTime(dottedEighth, now, tau);
    }
  }

  /** Tight studio/lab room IR (~480 ms) with crisp early reflections for physical weight */
  private buildCloseRoomIR(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const buf = ctx.createBuffer(2, len, rate);

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
    const preDelaySamples = Math.floor(0.02 * rate);
    const attackSamples = Math.floor(0.032 * rate);
    const bodyLen = Math.max(1, len - preDelaySamples);
    const decayMul = Math.exp(-(decay * 1.45) / bodyLen);

    const earlyTaps: [number, number, number][] = [
      [0.024, 0.34, 0.16],
      [0.041, 0.18, 0.32],
      [0.064, 0.24, 0.19],
      [0.095, 0.14, 0.22],
      [0.13, 0.16, 0.11],
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
      let b0 = 0,
        b1 = 0,
        b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.994 * b0 + w * 0.045;
        b1 = 0.965 * b1 + w * 0.06;
        b2 = 0.88 * b2 + w * 0.09;
        const ripple = 0.88 + 0.12 * Math.sin(i * 0.11 + ch * 1.4);
        data[i] = (b0 + b1 + b2) * 0.65 * ripple;
      }
    }
    return buf;
  }

  // ============================================================================
  // Physical Mechanical Synthesis Primitives
  // ============================================================================

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

  /** Pure, rounded sine/triangle micro-tone for clean, non-fatiguing UI & optical feedback */
  private triggerCleanTone(
    time: number,
    freqHz: number,
    durSec: number,
    gain: number,
    dest: AudioNode,
    type: OscillatorType = 'sine',
    endFreqHz?: number
  ): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, time);
    if (endFreqHz !== undefined && endFreqHz !== freqHz) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFreqHz), time + durSec * 0.85);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + Math.min(0.004, durSec * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

    if (type !== 'sine') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.setValueAtTime(0.8, time);
      lp.frequency.setValueAtTime(Math.min(2600, freqHz * 3.0), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, freqHz * 1.25), time + durSec);
      osc.connect(lp);
      lp.connect(g);
    } else {
      osc.connect(g);
    }

    g.connect(dest);
    osc.start(time);
    osc.stop(time + durSec + 0.02);
    return osc;
  }

  private makeToolkit(trackFn: (node: AudioScheduledSourceNode) => void, delaySend?: AudioNode): SynthToolkit {
    return {
      ctx: this.ctx!,
      crispNoiseBuf: this.crispNoiseBuf,
      brushedNoiseBuf: this.brushedNoiseBuf,
      warmDriveCurve: this.warmDriveCurve,
      delaySend,
      track: trackFn,
      triggerStrike: (t, f, q, d, g, dest) => this.triggerStrike(t, f, q, d, g, dest),
      triggerThock: (t, s, e, d, g, dest, type) => this.triggerThock(t, s, e, d, g, dest, type),
      triggerAnalogPluck: (t, f, c, q, d, g, dest, type, det) =>
        this.triggerAnalogPluck(t, f, c, q, d, g, dest, type, det),
    };
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
  // Quiet Infinite Background Loop Scheduler
  // ============================================================================

  /**
   * Start (or smoothly crossfade into) the active vibe's quiet infinite background loop.
   * Pass `anchorAudioTime` to lock Bar 0 seamlessly to an intro climax downbeat!
   */
  private startBackgroundLoop(fadeInSec = 0.75, anchorAudioTime?: number): void {
    if (!this.ctx || !this.initialized || this.userMuted || this.tabHidden || this.bgmLevel === 'off') {
      return;
    }

    // Smoothly fade out any previously running loop bus (for seamless vibe crossfades!)
    this.stopBackgroundLoop(0.24, false);

    if (this.idleSuspendTimer !== null) {
      window.clearTimeout(this.idleSuspendTimer);
      this.idleSuspendTimer = null;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const startAt = anchorAudioTime !== undefined ? Math.max(now + 0.02, anchorAudioTime) : now + 0.04;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.setValueAtTime(0.0001, startAt);
    bus.gain.linearRampToValueAtTime(1.0, startAt + Math.max(0.08, fadeInSec));
    bus.connect(this.bgmFilter);

    this.bgmActiveBus = bus;
    this.bgmRunning = true;
    this.bgmWanted = true;
    this.bgmStepIdx = 0;
    this.bgmCycleIdx = 0;
    this.bgmNextStepTime = startAt;
    this.syncVibeShaping(0.05);
    this.syncBgmLevelGain(0.08);
    if (!this.burstDucking) {
      this.syncBgmDuckGain(1.0, 0.14);
    }

    // Immediate lookahead pump + 110ms scheduler tick
    this.pumpBackgroundLoop();
    this.bgmTimer = window.setInterval(() => {
      this.pumpBackgroundLoop();
    }, 110);
  }

  private pumpBackgroundLoop(): void {
    if (!this.ctx || !this.bgmRunning || !this.bgmActiveBus || this.userMuted || this.tabHidden) {
      return;
    }
    if (this.ctx.state !== 'running') return;

    const vibe = getVibeMeta(this.vibeId);
    const now = this.ctx.currentTime;
    const horizon = now + 0.34;

    // If tab/main-thread stalled briefly, snap cleanly forward instead of dumping a burst of overdue notes
    if (this.bgmNextStepTime < now - 0.15) {
      this.bgmNextStepTime = now + 0.03;
    }

    const bus = this.bgmActiveBus;
    const tk = this.makeToolkit((node) => {
      this.bgmTrackedNodes.add(node);
      node.onended = () => {
        this.bgmTrackedNodes.delete(node);
      };
    }, this.bgmDelaySend);

    while (this.bgmNextStepTime < horizon) {
      scheduleVibeLoopStep(
        vibe.id,
        tk,
        this.bgmStepIdx,
        this.bgmCycleIdx,
        this.bgmNextStepTime,
        vibe.stepSec,
        bus,
        this.depthNorm
      );

      this.bgmNextStepTime += vibe.stepSec;
      this.bgmStepIdx++;
      if (this.bgmStepIdx >= vibe.loopSteps) {
        this.bgmStepIdx = 0;
        this.bgmCycleIdx++;
      }
    }
  }

  private stopBackgroundLoop(fadeSec = 0.28, clearWanted = false): void {
    this.bgmRunning = false;
    if (clearWanted) {
      this.bgmWanted = false;
    }
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }

    const ctx = this.ctx;
    const bus = this.bgmActiveBus;
    this.bgmActiveBus = null;

    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const f = Math.max(0.03, fadeSec);
    try {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + f);
    } catch {
      // ignore
    }

    const stopAt = now + f + 0.05;
    const stale = Array.from(this.bgmTrackedNodes);
    this.bgmTrackedNodes.clear();
    for (const node of stale) {
      try {
        node.stop(stopAt);
      } catch {
        // already stopped
      }
    }
  }

  // ============================================================================
  // Microscope Interaction Foley (Harmonically Tuned to Active Vibe!)
  // ============================================================================

  /**
   * Called from `onZoomFrame` — fires knurled focus-ring detents, objective turret locks,
   * and subtly shapes the quiet background loop's filter bloom with magnification depth.
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
    const vibe = getVibeMeta(this.vibeId);

    if (!this.hasInitialZoom) {
      this.hasInitialZoom = true;
      this.lastZoom = zoom;
      this.lastTickZoom = zoom;
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, vibe.turretScaleHz.length - 1);
    }

    const dz = zoom - this.lastZoom;
    this.lastZoom = zoom;

    const z = clamp(zoom, -2.4, 9.0);
    this.depthNorm = clamp((z + 1) / 10, 0, 1);

    if (!this.isActive() || !this.ctx) {
      this.lastTickZoom = zoom;
      this.lastStopIdx = clamp(Math.round(zoom) + 1, 0, vibe.turretScaleHz.length - 1);
      return;
    }

    // Gently breathe the background loop filter with magnification depth (warm on die -> luminous at atom/quarks)
    if (this.bgmFilter && Math.abs(this.depthNorm - this.lastFilterDepth) > 0.015) {
      this.lastFilterDepth = this.depthNorm;
      const targetCutoff =
        this.vibeId === 'minimal' ? 5400 + this.depthNorm * 6600 : 1950 + this.depthNorm * 1850;
      this.bgmFilter.frequency.setTargetAtTime(targetCutoff, this.ctx.currentTime, 0.25);
    }

    // 1) Precision focus-ring micro-detents while zooming (calm, damped Leica-ring feel)
    if (!introActive && Math.abs(z - this.lastTickZoom) >= 0.115 && nowMs - this.lastTickMs >= 46) {
      const zoomingIn = dz >= 0;
      this.playFocusDetent(zoomingIn, clamp(motion, 0.15, 1.0), z);
      this.lastTickZoom = z;
      this.lastTickMs = nowMs;
    }

    // 2) Subtle objective stop click when crossing one of the 11 named scale stops
    const stopIdx = clamp(Math.round(z) + 1, 0, vibe.turretScaleHz.length - 1);
    if (!introActive && stopIdx !== this.lastStopIdx) {
      const direction = stopIdx > this.lastStopIdx ? 1 : -1;
      this.lastStopIdx = stopIdx;
      this.playTurretLock(stopIdx, direction);
    }
  }

  private playFocusDetent(zoomingIn: boolean, vel: number, z: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(zoomingIn ? 0.06 : -0.06, 0.28, 0.0);

    const jitter = 0.99 + Math.random() * 0.02;
    const scaleNorm = clamp((z + 1) / 10, 0, 1);

    const strikeHz = ((zoomingIn ? 3200 : 2400) + scaleNorm * 850) * jitter;
    this.triggerStrike(now, strikeHz, 4.6, 0.0045, 0.032 + vel * 0.022, out);

    const baseHz = zoomingIn ? vibe.rootHz * 1.5 : vibe.rootHz;
    const toneHz = baseHz * (1.0 + scaleNorm * 0.75) * jitter;
    this.triggerCleanTone(now, toneHz, 0.026, 0.022 + vel * 0.014, out, 'sine');
  }

  private playTurretLock(stopIdx: number, direction: number): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const scaleHz = vibe.turretScaleHz[stopIdx] ?? vibe.rootHz;
    const isSubatomic = stopIdx >= 9;
    const out = this.routeOut(0, 0.42, isSubatomic ? 0.2 : 0.07);

    // Stage 1: delicate optical detent tick
    this.triggerStrike(now, direction > 0 ? 3600 : 2700, 3.8, 0.005, 0.052, out);

    // Stage 2: soft rounded settle + pure in-key harmonic ping
    const seatT = now + (isSubatomic ? 0.018 : 0.014);
    this.triggerThock(
      seatT,
      isSubatomic ? 115 : 155,
      isSubatomic ? scaleHz : vibe.turretScaleHz[0],
      isSubatomic ? 0.16 : 0.055,
      isSubatomic ? 0.145 : 0.08,
      out,
      'sine'
    );
    this.triggerCleanTone(
      seatT,
      isSubatomic ? scaleHz * 2 : scaleHz * 1.5,
      isSubatomic ? 0.32 : 0.13,
      isSubatomic ? 0.068 : 0.044,
      out,
      'sine'
    );
    if (isSubatomic) {
      this.triggerCleanTone(seatT, scaleHz * 3, 0.28, 0.032, out, 'sine');
    }
  }

  public playHover(hitId: string | null, clientX: number): void {
    if (!hitId) {
      this.lastHoverId = null;
      return;
    }
    if (hitId === this.lastHoverId) return;
    this.lastHoverId = hitId;

    const nowMs = performance.now();
    if (nowMs - this.lastHoverMs < 70) return;
    this.lastHoverMs = nowMs;

    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const panVal = clamp((clientX / Math.max(1, window.innerWidth)) * 2 - 1, -0.65, 0.65) * 0.52;
    const out = this.routeOut(panVal, 0.34, 0.04);

    if (hitId === 'us-quarter') {
      this.triggerStrike(now, 5200, 3.4, 0.0045, 0.045, out);
      this.triggerMetalRing(now, 2560, 1.608, 0.095, 0.032, out);
      return;
    }

    if (hitId === 'slc' || hitId.startsWith('ram-')) {
      const hz = hitId === 'slc' ? vibe.turretScaleHz[1] * 1.5 : vibe.turretScaleHz[0] * 1.5;
      this.triggerStrike(now, 1750, 2.8, 0.005, 0.03, out);
      this.triggerCleanTone(now, hz, 0.075, 0.04, out, 'sine');
      return;
    }

    if (hitId === 'gpu' || hitId === 'ane') {
      this.triggerStrike(now, 3400, 4.2, 0.004, 0.028, out);
      this.triggerCleanTone(now, vibe.fifthHz * 1.5, 0.055, 0.028, out, 'sine');
      this.triggerCleanTone(now + 0.018, vibe.octaveHz, 0.068, 0.024, out, 'sine');
      return;
    }

    if (hitId === 'smd-caps') {
      this.triggerStrike(now, 4600, 5.2, 0.0035, 0.032, out);
      this.triggerCleanTone(now, vibe.octaveHz * 1.5, 0.032, 0.02, out, 'sine');
      return;
    }

    if (hitId === 'io-phy' || hitId === 'media') {
      const hz = hitId === 'io-phy' ? vibe.pCoreScaleHz[2] : vibe.pCoreScaleHz[5];
      this.triggerStrike(now, 2800, 3.6, 0.0045, 0.03, out);
      this.triggerCleanTone(now, hz * 1.5, 0.062, 0.032, out, 'sine');
      return;
    }

    const coreIdx = hitId.startsWith('pcore-') ? Number(hitId.slice(6)) || 0 : 0;
    const hz = vibe.pCoreScaleHz[coreIdx % vibe.pCoreScaleHz.length];
    this.triggerStrike(now, 3200 + (coreIdx % 8) * 120, 4.2, 0.004, 0.026, out);
    this.triggerCleanTone(now, hz * 1.5, 0.058, 0.03, out, 'sine');
  }

  public playInspect(open: boolean, hitId?: string): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(0, 0.44, 0.1);
    const isCoin = hitId === 'us-quarter';

    if (open) {
      this.triggerStrike(now, 3800, 3.8, 0.005, 0.06, out);
      this.triggerCleanTone(now, vibe.rootHz, 0.14, 0.048, out, 'sine');

      const t2 = now + 0.026;
      this.triggerThock(t2, 138, vibe.turretScaleHz[0], 0.072, 0.085, out, 'sine');
      if (isCoin) {
        this.triggerMetalRing(t2, 2560, 1.608, 0.11, 0.038, out);
      } else {
        this.triggerCleanTone(t2, vibe.fifthHz, 0.19, 0.042, out, 'triangle');
        this.triggerCleanTone(t2 + 0.012, vibe.octaveHz, 0.2, 0.026, out, 'sine');
      }
    } else {
      this.triggerStrike(now, 2500, 3.4, 0.0045, 0.045, out);
      this.triggerCleanTone(now, vibe.fifthHz, 0.075, 0.036, out, 'sine');
      this.triggerCleanTone(now + 0.02, vibe.rootHz, 0.1, 0.032, out, 'sine');
    }
  }

  public playDive(fromZ: number, toZ: number): void {
    if (!this.ctx || !this.isActive()) return;
    const dist = Math.abs(toZ - fromZ);
    if (dist < 0.22) {
      this.playUiTap(true);
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(0, 0.42, 0.14);
    const divingIn = toZ > fromZ;
    const dur = clamp(0.24 + dist * 0.055, 0.28, 0.58);

    // Subtle damped launch tap + soft low-end weight
    this.triggerStrike(now, divingIn ? 3200 : 2400, 3.6, 0.005, 0.048, out);
    this.triggerThock(now, divingIn ? 128 : 104, vibe.subHz, 0.1, 0.085, out, 'sine');

    // Clean warm harmonic pitch glide (soft triangle + pure sine fifth, zero resonant buzz)
    const loA = vibe.turretScaleHz[0];
    const hiA = vibe.rootHz;
    const loB = vibe.turretScaleHz[1];
    const hiB = vibe.fifthHz;
    this.triggerCleanTone(now, divingIn ? loA : hiA, dur, 0.048, out, 'triangle', divingIn ? hiA : loA);
    this.triggerCleanTone(now, divingIn ? loB : hiB, dur, 0.032, out, 'sine', divingIn ? hiB : loB);

    // Whisper-soft optical air-bearing glide
    const src = ctx.createBufferSource();
    src.buffer = this.brushedNoiseBuf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.6, now);
    bp.frequency.setValueAtTime(divingIn ? 340 : 1280, now);
    bp.frequency.exponentialRampToValueAtTime(divingIn ? 1320 : 300, now + dur);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(clamp(0.036 + dist * 0.008, 0.04, 0.075), now + 0.055);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now);
    src.stop(now + dur + 0.03);
  }

  public playUiTap(active: boolean): void {
    if (!this.ctx || !this.isActive()) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(0, 0.3, 0.03);

    if (active) {
      this.triggerStrike(now, 3600, 4.2, 0.0045, 0.046, out);
      this.triggerCleanTone(now + 0.004, vibe.rootHz * 1.5, 0.052, 0.04, out, 'sine');
    } else {
      this.triggerStrike(now, 2300, 3.6, 0.0045, 0.036, out);
      this.triggerCleanTone(now + 0.004, vibe.rootHz, 0.048, 0.032, out, 'sine');
    }
  }

  private playMuteSwitch(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(0, 0.25);
    this.triggerStrike(now, 2100, 3.6, 0.005, 0.042, out);
    this.triggerCleanTone(now + 0.004, vibe.turretScaleHz[1], 0.055, 0.036, out, 'sine');
  }

  /**
   * Clean, controlled Multi-Core Burst — warm rising harmonic current + gentle rhythmic pulse,
   * smoothly ducking the background loop without harsh sawtooth screech.
   */
  public triggerBurst(durationSec = 3.5): void {
    if (!this.ctx || !this.isActive()) return;
    this.touchAudio(durationSec + 2.8);
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vibe = getVibeMeta(this.vibeId);
    const out = this.routeOut(0, 0.42, 0.26);

    // Gently duck background loop underneath the compute burst
    if (this.bgmRunning) {
      this.burstDucking = true;
      this.syncBgmDuckGain(0.42, 0.1);
      if (this.burstDuckTimer !== null) {
        window.clearTimeout(this.burstDuckTimer);
      }
      this.burstDuckTimer = window.setTimeout(() => {
        this.burstDuckTimer = null;
        this.burstDucking = false;
        this.syncBgmDuckGain(1.0, 0.55);
      }, (durationSec + 0.35) * 1000);
    }

    // 1) Clean magnetic engagement thump
    this.triggerStrike(now, 3200, 3.2, 0.007, 0.075, out);
    this.triggerThock(now, 132, vibe.subHz, 0.22, 0.16, out, 'sine');

    // 2) Smooth rising harmonic turbine swell (pure detuned triangle/sine fifth)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(1.1, now);
    lp.frequency.setValueAtTime(180, now);
    lp.frequency.exponentialRampToValueAtTime(920, now + durationSec * 0.72);
    lp.frequency.exponentialRampToValueAtTime(220, now + durationSec);

    const swellG = ctx.createGain();
    swellG.gain.setValueAtTime(0.0001, now);
    swellG.gain.linearRampToValueAtTime(0.09, now + 0.35);
    swellG.gain.setValueAtTime(0.085, now + durationSec * 0.78);
    swellG.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.15);

    lp.connect(swellG);
    swellG.connect(out);

    const voices: [number, number, OscillatorType, number][] = [
      [vibe.turretScaleHz[0], -4, 'triangle', 0.45],
      [vibe.turretScaleHz[0], 4, 'triangle', 0.45],
      [vibe.rootHz, 0, 'sine', 0.38],
      [vibe.fifthHz, 3, 'sine', 0.26],
    ];
    for (const [hz, det, type, lvl] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(hz, now);
      o.frequency.exponentialRampToValueAtTime(hz * 1.06, now + durationSec * 0.78);
      o.frequency.exponentialRampToValueAtTime(hz, now + durationSec);
      if (det !== 0) o.detune.setValueAtTime(det, now);
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(lvl, now);
      o.connect(vg);
      vg.connect(lp);
      o.start(now);
      o.stop(now + durationSec + 0.2);
    }

    // 3) Subtle, clean 8th-note compute pulse (soft rounded sine/triangle taps)
    const step = 0.25;
    const totalSteps = Math.max(4, Math.floor((durationSec - 0.2) / step));
    const notes = vibe.burstNotes;
    for (let i = 0; i < totalSteps; i++) {
      const ct = now + 0.08 + i * step;
      const prog = i / Math.max(1, totalSteps - 1);
      const env = Math.min(1.0, prog / 0.22) * (1.0 - Math.max(0, (prog - 0.78) / 0.24));
      const hz = notes[i % notes.length];

      if (i % 2 === 0) {
        this.triggerThock(ct, 105, vibe.subHz, 0.18, 0.085 * (0.5 + 0.5 * env), out, 'sine');
      }
      this.triggerCleanTone(ct, hz * 2, 0.14, 0.036 * (0.45 + 0.55 * env), out, 'triangle');
    }

    // 4) Soft magnetic release settle when Burst completes
    const relT = now + durationSec + 0.02;
    this.triggerStrike(relT, 2600, 3.6, 0.006, 0.055, out);
    this.triggerThock(relT + 0.012, 118, vibe.turretScaleHz[9], 0.16, 0.105, out, 'sine');
    this.triggerCleanTone(relT + 0.014, vibe.rootHz, 0.28, 0.04, out, 'sine');
  }

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

  // ============================================================================
  // Synchronized Cold Boot Intro + Seamless Loop Handoff
  // ============================================================================

  /** Sample-accurate elapsed intro time (sec) directly from Web Audio hardware clock */
  public getIntroClockSec(): number | null {
    if (!this.ctx || !this.introClockActive || this.introOriginAudioTime === null) return null;
    if (this.ctx.state !== 'running' || this.userMuted || this.tabHidden) return null;
    return Math.max(0, this.ctx.currentTime - this.introOriginAudioTime);
  }

  public startIntroScore(offsetSec = 0): void {
    this.stopIntroScore(0.1, false);
    this.stopBackgroundLoop(0.2, false);
    if (this.userMuted) return;

    this.introRunning = true;
    this.introClockActive = false;
    this.introOriginAudioTime = null;
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

  /**
   * Smoothly fade out & cancel the intro score.
   * When `continueLoop` is true (e.g. user skips the intro early by scrolling/clicking),
   * transitions seamlessly into the quiet background loop instead of dropping to silence!
   */
  public stopIntroScore(fadeSec = 0.28, continueLoop = true): void {
    this.introRunning = false;
    this.introClockActive = false;
    this.introOriginAudioTime = null;
    this.introScheduled = false;

    if (this.introHandoffTimer !== null) {
      window.clearTimeout(this.introHandoffTimer);
      this.introHandoffTimer = null;
    }

    const ctx = this.ctx;
    const bus = this.introScoreBus;
    const sources = this.introSources;
    this.introScoreBus = null;
    this.introSources = [];

    if (ctx && bus) {
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

    if (continueLoop && !this.userMuted && !this.tabHidden && this.bgmLevel !== 'off' && this.isActive()) {
      this.bgmWanted = true;
      this.startBackgroundLoop(0.75);
    }
  }

  private maybeLaunchPendingIntro(): void {
    if (!this.introRunning || this.introScheduled || !this.isActive()) return;
    const vibe = getVibeMeta(this.vibeId);
    const elapsed = (performance.now() - this.introStartWallMs) / 1000;
    if (elapsed >= vibe.introCues.durationSec - 0.55) {
      this.introRunning = false;
      this.introClockActive = false;
      if (this.bgmLevel !== 'off') {
        this.bgmWanted = true;
        this.startBackgroundLoop(0.8);
      }
      return;
    }
    this.scheduleCinematicIntro(Math.max(0, elapsed));
  }

  private scheduleCinematicIntro(offsetSec: number): void {
    if (!this.ctx || !this.isActive()) return;
    const vibe = getVibeMeta(this.vibeId);
    const cues = vibe.introCues;
    this.touchAudio(Math.max(4.0, cues.durationSec + 4.5 - offsetSec));
    this.introScheduled = true;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t0 = now - offsetSec;
    this.introOriginAudioTime = t0;
    this.introClockActive = true;

    const scoreBus = ctx.createGain();
    if (offsetSec > 0.05) {
      // Crisp 15ms de-click when launching from held "Power On" so Beat 1 hits at full punch!
      const rampSec = offsetSec <= cues.heldStartSec + 0.2 ? 0.015 : 0.1;
      scoreBus.gain.setValueAtTime(0.0001, now);
      scoreBus.gain.linearRampToValueAtTime(1.0, now + rampSec);
    } else {
      scoreBus.gain.setValueAtTime(1.0, now);
    }

    const drySend = ctx.createGain();
    drySend.gain.setValueAtTime(0.76, now);
    const hallSend = ctx.createGain();
    hallSend.gain.setValueAtTime(0.74, now);

    scoreBus.connect(drySend);
    drySend.connect(this.dryBus);
    scoreBus.connect(hallSend);
    hallSend.connect(this.cinemaSend);

    this.introScoreBus = scoreBus;
    const sources: AudioScheduledSourceNode[] = [];
    this.introSources = sources;

    // 1) Render the active vibe's full beat-locked Cold Boot composition
    this.syncVibeShaping(0.02);
    const tk = this.makeToolkit((node) => sources.push(node), this.introDelaySend);
    scheduleVibeIntro(vibe.id, tk, t0, now, scoreBus);

    // 2) Optical reticle lock on lockSec + whisper-clean Liquid Glass HUD arrival on hudSec
    if (t0 + cues.lockSec >= now - 0.03) {
      const lockT = Math.max(now, t0 + cues.lockSec);
      const out = this.routeOut(0, 0.45, 0.08);
      this.triggerStrike(lockT, 4000, 3.8, 0.005, 0.068, out);
      this.triggerThock(lockT + 0.02, 185, vibe.turretScaleHz[0], 0.055, 0.085, out, 'sine');
    }

    if (t0 + cues.hudSec >= now - 0.03) {
      const hudT = Math.max(now, t0 + cues.hudSec);
      const out = this.routeOut(0, 0.36, 0.06);
      this.triggerStrike(hudT, 3400, 4.2, 0.0045, 0.045, out);
      this.triggerCleanTone(hudT, vibe.rootHz * 1.5, 0.08, 0.036, out, 'sine');
      this.triggerStrike(hudT + 0.068, 3900, 4.2, 0.0045, 0.048, out);
      this.triggerCleanTone(hudT + 0.068, vibe.octaveHz, 0.1, 0.032, out, 'sine');
    }

    // 3) Seamless tempo-locked handoff into the quiet infinite background loop on lockSec downbeat!
    if (this.bgmLevel !== 'off') {
      this.bgmWanted = true;
      const handoffAudioTime = t0 + cues.lockSec;
      const delayMs = Math.max(0, (handoffAudioTime - now - 0.25) * 1000);
      if (this.introHandoffTimer !== null) {
        window.clearTimeout(this.introHandoffTimer);
      }
      this.introHandoffTimer = window.setTimeout(() => {
        this.introHandoffTimer = null;
        this.introRunning = false;
        if (!this.userMuted && !this.tabHidden && this.bgmLevel !== 'off' && this.ctx?.state === 'running') {
          const handoffFade = this.vibeId === 'minimal' ? 0.14 : 1.1;
          this.startBackgroundLoop(handoffFade, handoffAudioTime);
        }
      }, delayMs);
    }
  }

  /** Legacy phase hook kept for compatibility */
  public onIntroPhase(_phase: AudioIntroPhase): void {
    // Handled with sample-accurate cinematic timing by startIntroScore()
  }
}
