/**
 * Procedural Music Vibes Library for Silicon Microscope
 *
 * Five zero-dependency Web Audio soundtracks, each pairing:
 *   1) A sample-accurate 7-second Cold Boot intro synchronized to the visual reveal:
 *        0.00-2.45s : Title card on black -> dormant silicon silhouette fades in
 *        2.45-5.65s : Staged power-on (V_DD rails -> fabric -> LPDDR5 -> E/P cores -> GPU -> ANE)
 *        5.65-7.05s : Full die reveal, reticle lock (5.80s), Liquid Glass HUD arrival (6.10s)
 *   2) A seamless, quiet, evolving infinite background loop that transitions smoothly
 *      out of the intro climax (or crossfades directly if the intro is skipped or vibe is switched).
 *   3) A harmonically matched scale table so hover taps, turret stops, and bursts stay in key.
 */

export type MusicVibeId = 'glass' | 'orbital' | 'pulse' | 'velvet' | 'noir';

export type BgmLevelId = 'off' | 'whisper' | 'quiet' | 'present';

export interface MusicVibeMeta {
  readonly id: MusicVibeId;
  readonly name: string;
  readonly shortLabel: string;
  readonly tagline: string;
  readonly metaBadge: string;
  readonly stepSec: number;
  readonly loopSteps: number;
  /** Exact intro timestamp (sec) where the infinite background loop locks onto Bar 0 downbeat */
  readonly loopHandoffSec: number;
  /** 11 objective turret stop frequencies (Scale -> Quarks) tuned to this vibe's key */
  readonly turretScaleHz: readonly number[];
  /** 8 P-Core hover frequencies tuned to this vibe's key */
  readonly pCoreScaleHz: readonly number[];
  /** Root / fifth / sub frequencies for UI plucks, inspect locks, dives & bursts */
  readonly rootHz: number;
  readonly fifthHz: number;
  readonly octaveHz: number;
  readonly subHz: number;
  readonly burstNotes: readonly number[];
}

export const BGM_LEVEL_OPTIONS: readonly {
  readonly id: BgmLevelId;
  readonly label: string;
  readonly gain: number;
}[] = [
  { id: 'off', label: 'Off', gain: 0.0 },
  { id: 'whisper', label: 'Whisper', gain: 0.13 },
  { id: 'quiet', label: 'Quiet', gain: 0.24 },
  { id: 'present', label: 'Present', gain: 0.38 },
];

export const MUSIC_VIBES: readonly MusicVibeMeta[] = [
  {
    id: 'orbital',
    name: 'Quantum Drift',
    shortLabel: 'Drift',
    tagline: 'Solemn heartbeat & rising dark cinema strings',
    metaBadge: 'F DORIAN · 100 BPM',
    stepSec: 0.6,
    loopSteps: 16,
    loopHandoffSec: 5.65,
    turretScaleHz: [87.31, 130.81, 174.61, 196.0, 207.65, 261.63, 293.66, 311.13, 349.23, 65.41, 43.65],
    pCoreScaleHz: [174.61, 196.0, 207.65, 261.63, 293.66, 311.13, 349.23, 392.0],
    rootHz: 174.61,
    fifthHz: 130.81,
    octaveHz: 349.23,
    subHz: 43.65,
    burstNotes: [87.31, 87.31, 174.61, 87.31, 130.81, 87.31, 103.83, 130.81],
  },
  {
    id: 'glass',
    name: 'Cleanroom Glass',
    shortLabel: 'Glass',
    tagline: 'Crystalline FM bells & warm felt keys',
    metaBadge: 'D LYDIAN · 88 BPM',
    stepSec: 0.17045,
    loopSteps: 64,
    loopHandoffSec: 5.86,
    turretScaleHz: [73.42, 110.0, 146.83, 164.81, 185.0, 220.0, 246.94, 277.18, 293.66, 55.0, 36.71],
    pCoreScaleHz: [146.83, 164.81, 185.0, 220.0, 246.94, 277.18, 293.66, 329.63],
    rootHz: 146.83,
    fifthHz: 220.0,
    octaveHz: 293.66,
    subHz: 36.71,
    burstNotes: [73.42, 73.42, 146.83, 73.42, 110.0, 73.42, 92.5, 110.0],
  },
  {
    id: 'pulse',
    name: 'Silicon Pulse',
    shortLabel: 'Pulse',
    tagline: 'Tactile modular plucks & cleanroom clockwork',
    metaBadge: 'A DORIAN · 114 BPM',
    stepSec: 0.1316,
    loopSteps: 64,
    loopHandoffSec: 5.608,
    turretScaleHz: [55.0, 82.41, 110.0, 123.47, 130.81, 164.81, 185.0, 196.0, 220.0, 41.2, 27.5],
    pCoreScaleHz: [110.0, 123.47, 130.81, 164.81, 185.0, 196.0, 220.0, 246.94],
    rootHz: 110.0,
    fifthHz: 164.81,
    octaveHz: 220.0,
    subHz: 55.0,
    burstNotes: [55.0, 55.0, 110.0, 55.0, 82.41, 55.0, 65.41, 82.41],
  },
  {
    id: 'velvet',
    name: 'Late-Night Lab',
    shortLabel: 'Velvet',
    tagline: 'Warm detuned Rhodes & brushed tape chill',
    metaBadge: 'E♭ MAJ9 · 84 BPM',
    stepSec: 0.17857,
    loopSteps: 64,
    loopHandoffSec: 5.84,
    turretScaleHz: [77.78, 116.54, 155.56, 174.61, 196.0, 233.08, 261.63, 293.66, 311.13, 58.27, 38.89],
    pCoreScaleHz: [155.56, 174.61, 196.0, 233.08, 261.63, 293.66, 311.13, 349.23],
    rootHz: 155.56,
    fifthHz: 233.08,
    octaveHz: 311.13,
    subHz: 38.89,
    burstNotes: [77.78, 77.78, 155.56, 77.78, 116.54, 77.78, 98.0, 116.54],
  },
  {
    id: 'noir',
    name: 'Cyber Noir',
    shortLabel: 'Noir',
    tagline: 'Dark C-minor Moog 16th electro pulse',
    metaBadge: 'C MINOR · 112 BPM',
    stepSec: 0.134,
    loopSteps: 64,
    loopHandoffSec: 5.666,
    turretScaleHz: [65.41, 98.0, 130.81, 146.83, 155.56, 196.0, 207.65, 233.08, 261.63, 49.0, 32.7],
    pCoreScaleHz: [130.81, 146.83, 155.56, 196.0, 207.65, 233.08, 261.63, 293.66],
    rootHz: 130.81,
    fifthHz: 196.0,
    octaveHz: 261.63,
    subHz: 32.7,
    burstNotes: [65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0],
  },
];

export function getVibeMeta(id: MusicVibeId): MusicVibeMeta {
  return MUSIC_VIBES.find((v) => v.id === id) ?? MUSIC_VIBES[0];
}

export interface SynthToolkit {
  ctx: AudioContext;
  crispNoiseBuf: AudioBuffer;
  brushedNoiseBuf: AudioBuffer;
  warmDriveCurve: Float32Array<ArrayBuffer>;
  track: (node: AudioScheduledSourceNode) => void;
  triggerStrike: (time: number, freqHz: number, q: number, durSec: number, gain: number, dest: AudioNode) => void;
  triggerThock: (
    time: number,
    startHz: number,
    endHz: number,
    durSec: number,
    gain: number,
    dest: AudioNode,
    type?: OscillatorType
  ) => void;
  triggerAnalogPluck: (
    time: number,
    freqHz: number,
    cutoffPeakHz: number,
    q: number,
    durSec: number,
    gain: number,
    dest: AudioNode,
    type?: OscillatorType,
    detuneCents?: number
  ) => OscillatorNode;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ============================================================================
// Shared Musical Instrument Primitives
// ============================================================================

/** Crystalline FM glass bell / celesta chime (cleanroom metrology shimmer) */
function playGlassBell(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  bright = 0.55
): void {
  const { ctx } = tk;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.82, 0.82), time);
  pan.connect(dest);

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(freqHz, time);

  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.setValueAtTime(freqHz * 3.0, time);

  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freqHz * (0.35 + bright * 1.15), time);
  modGain.gain.exponentialRampToValueAtTime(0.01, time + Math.min(durSec * 0.45, 0.48));

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(env);
  env.connect(pan);

  carrier.start(time);
  mod.start(time);
  carrier.stop(time + durSec + 0.03);
  mod.stop(time + durSec + 0.03);
  tk.track(carrier);
  tk.track(mod);
}

/** Intimate felt-piano / electric Rhodes tine voice with warm stereo body */
function playRhodesNote(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  warmth = 1.0
): void {
  const { ctx } = tk;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.78, 0.78), time);
  pan.connect(dest);

  // Subtle analog pitch drift (very gentle tape warmth)
  const drift = (Math.sin(time * 2.1 + freqHz * 0.03) * 2.4) * warmth;

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(freqHz, time);
  body.detune.setValueAtTime(drift, time);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(2400, freqHz * (3.2 + warmth * 1.4)), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(240, freqHz * 1.35), time + durSec * 0.85);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.011);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.36), time + durSec * 0.42);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  body.connect(lp);
  lp.connect(env);
  env.connect(pan);
  body.start(time);
  body.stop(time + durSec + 0.04);
  tk.track(body);

  // Soft Rhodes bell-tine transient (2nd + 4th partial)
  const tine = ctx.createOscillator();
  tine.type = 'sine';
  tine.frequency.setValueAtTime(freqHz * 2.0, time);
  tine.detune.setValueAtTime(-drift * 0.6, time);

  const tineG = ctx.createGain();
  tineG.gain.setValueAtTime(0.0001, time);
  tineG.gain.linearRampToValueAtTime(gain * 0.26, time + 0.004);
  tineG.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(durSec * 0.42, 0.42));

  tine.connect(tineG);
  tineG.connect(pan);
  tine.start(time);
  tine.stop(time + Math.min(durSec * 0.45, 0.46));
  tk.track(tine);
}

/** Lush breathing stereo analog poly-pad chord */
function playPadChord(
  tk: SynthToolkit,
  time: number,
  notesHz: readonly number[],
  durSec: number,
  gain: number,
  dest: AudioNode,
  opts?: {
    wave?: OscillatorType;
    cutoffStart?: number;
    cutoffPeak?: number;
    cutoffEnd?: number;
    attackSec?: number;
    releaseSec?: number;
    detuneCents?: number;
    q?: number;
    useDrive?: boolean;
  }
): void {
  const { ctx } = tk;
  const wave = opts?.wave ?? 'sawtooth';
  const cutStart = opts?.cutoffStart ?? 380;
  const cutPeak = opts?.cutoffPeak ?? 920;
  const cutEnd = opts?.cutoffEnd ?? 320;
  const attack = Math.min(opts?.attackSec ?? 0.65, durSec * 0.45);
  const release = Math.min(opts?.releaseSec ?? 0.9, durSec * 0.45);
  const det = opts?.detuneCents ?? 7;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(opts?.q ?? 0.9, time);
  lp.frequency.setValueAtTime(cutStart, time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(90, cutPeak), time + attack + (durSec - attack) * 0.32);
  lp.frequency.exponentialRampToValueAtTime(Math.max(85, cutEnd), time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + attack);
  env.gain.setValueAtTime(gain * 0.92, Math.max(time + attack + 0.02, time + durSec - release));
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  let busIn: AudioNode = lp;
  if (opts?.useDrive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = tk.warmDriveCurve;
    shaper.connect(lp);
    busIn = shaper;
  }
  lp.connect(env);
  env.connect(dest);

  const perVoice = 1 / Math.max(1, notesHz.length);
  for (let i = 0; i < notesHz.length; i++) {
    const hz = notesHz[i];
    const spread = notesHz.length > 1 ? ((i / (notesHz.length - 1)) * 2 - 1) * (opts?.useDrive ? 0.62 : 0.56) : 0;
    const pairs = det > 0 ? (opts?.useDrive ? [-det, 0, det] : [-det, det]) : [0];
    const wMul = pairs.length === 3 ? 0.38 : pairs.length === 2 ? 0.55 : 1.0;
    for (const d of pairs) {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(hz, time);
      if (d !== 0) osc.detune.setValueAtTime(d, time);

      const vg = ctx.createGain();
      vg.gain.setValueAtTime(perVoice * wMul, time);

      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(spread + (d > 0 ? 0.14 : d < 0 ? -0.14 : 0), -0.82, 0.82), time);

      osc.connect(vg);
      vg.connect(p);
      p.connect(busIn);
      osc.start(time);
      osc.stop(time + durSec + 0.05);
      tk.track(osc);
    }
  }
}

/** Woody modular Buchla/FM pluck for Silicon Pulse */
function playModularPluck(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  brightness = 0.6
): void {
  const { ctx } = tk;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.78, 0.78), time);
  pan.connect(dest);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freqHz, time);

  const fm = ctx.createOscillator();
  fm.type = 'sine';
  fm.frequency.setValueAtTime(freqHz * 2.0, time);

  const fmG = ctx.createGain();
  fmG.gain.setValueAtTime(freqHz * (0.4 + brightness * 1.6), time);
  fmG.gain.exponentialRampToValueAtTime(0.01, time + Math.min(0.08, durSec * 0.55));

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(2.6, time);
  lp.frequency.setValueAtTime(Math.max(freqHz * 2.0, 520 + brightness * 2100), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(120, freqHz * 1.25), time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.0025);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  fm.connect(fmG);
  fmG.connect(osc.frequency);
  osc.connect(lp);
  lp.connect(env);
  env.connect(pan);

  osc.start(time);
  fm.start(time);
  osc.stop(time + durSec + 0.02);
  fm.stop(time + durSec + 0.02);
  tk.track(osc);
  tk.track(fm);
}

/** Soft rounded sub-bass / heartbeat pulse */
function playSoftSub(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  dest: AudioNode,
  pitchDropFrom?: number
): void {
  const { ctx } = tk;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  if (pitchDropFrom) {
    osc.frequency.setValueAtTime(pitchDropFrom, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, freqHz), time + Math.min(0.075, durSec * 0.35));
  } else {
    osc.frequency.setValueAtTime(freqHz, time);
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + (pitchDropFrom ? 0.004 : 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + durSec + 0.03);
  tk.track(osc);
}

/** Delicate brushed micro-hat / cleanroom air tick */
function playMicroHat(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode
): void {
  const { ctx } = tk;
  const src = ctx.createBufferSource();
  src.buffer = tk.crispNoiseBuf;
  const offset = Math.random() * Math.max(0.01, tk.crispNoiseBuf.duration - durSec - 0.02);

  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.setValueAtTime(freqHz, time);
  hp.Q.setValueAtTime(2.8, time);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.7, 0.7), time);

  src.connect(hp);
  hp.connect(g);
  g.connect(pan);
  pan.connect(dest);
  src.start(time, offset, durSec + 0.01);
  tk.track(src);
}

// ============================================================================
// INTRO SCORES (0.00s -> ~7.5s, synced to Cold Boot visual reveal)
// ============================================================================

export function scheduleVibeIntro(
  vibeId: MusicVibeId,
  tk: SynthToolkit,
  t0: number,
  now: number,
  scoreBus: AudioNode
): void {
  switch (vibeId) {
    case 'glass':
      scheduleGlassIntro(tk, t0, now, scoreBus);
      break;
    case 'orbital':
      scheduleOrbitalIntro(tk, t0, now, scoreBus);
      break;
    case 'pulse':
      schedulePulseIntro(tk, t0, now, scoreBus);
      break;
    case 'velvet':
      scheduleVelvetIntro(tk, t0, now, scoreBus);
      break;
    case 'noir':
      scheduleNoirIntro(tk, t0, now, scoreBus);
      break;
  }
}

/** 1) CLEANROOM GLASS — Luminous D Lydian minimalist crystal bells + felt keys */
function scheduleGlassIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  // Act 0 (0.00 - 2.45s): Warm D2 breath swell + laser-clean glass harmonic pings
  if (t0 + 2.55 > now) {
    const sT = Math.max(now, t0 + 0.08);
    const dur = Math.max(0.2, t0 + 2.55 - sT);
    playPadChord(tk, sT, [73.42, 146.83, 220.0], dur, 0.16, scoreBus, {
      wave: 'triangle',
      cutoffStart: 220,
      cutoffPeak: 640,
      cutoffEnd: 380,
      attackSec: 1.15,
      releaseSec: 0.4,
      detuneCents: 4,
    });

    const pings: [number, number, number, number][] = [
      [0.42, 587.33, -0.35, 0.075], // D5
      [1.18, 880.0, 0.32, 0.07], // A5
      [1.78, 739.99, -0.25, 0.08], // F#5
      [2.16, 1174.66, 0.28, 0.085], // D6
    ];
    for (const [cue, hz, pv, amp] of pings) {
      if (t0 + cue >= now - 0.02) {
        const ct = Math.max(now, t0 + cue);
        playGlassBell(tk, ct, hz, 1.35, amp, pv, scoreBus, 0.45);
        tk.triggerStrike(ct, 3200 + cue * 420, 4.4, 0.005, amp * 0.75, scoreBus);
      }
    }
  }

  // Act 1-4 (2.45 - 5.86s): 20 steps of cascading crystalline glass arpeggios + rising Dmaj9 -> Gmaj7#11 -> A6/9 pad
  const step = 0.17045;
  const arpNotes = [
    // Bar 1 (Dmaj9): V_DD rails & fabric ignite
    293.66, 440.0, 587.33, 659.25, 739.99, 659.25, 587.33, 440.0,
    // Bar 2 (Gmaj7#11 -> A6/9): Memory training & core clusters wake
    392.0, 587.33, 739.99, 880.0, 987.77, 880.0, 739.99, 659.25,
    // Pre-climax lift into Dmaj9 hero bloom
    587.33, 739.99, 880.0, 1174.66,
  ];
  for (let i = 0; i < arpNotes.length; i++) {
    const cue = 2.45 + i * step;
    if (t0 + cue + 0.15 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / (arpNotes.length - 1);
    const pv = (i % 2 === 0 ? -1 : 1) * (0.22 + (i % 4) * 0.12);
    playGlassBell(tk, ct, arpNotes[i], 0.65 + prog * 0.5, 0.075 + prog * 0.065, pv, scoreBus, 0.35 + prog * 0.45);
    if (i % 2 === 0) {
      playRhodesNote(tk, ct, arpNotes[i] * 0.5, 0.55 + prog * 0.3, 0.08 + prog * 0.05, -pv * 0.6, scoreBus, 0.7);
    }
    if (i % 4 === 0 && t0 + cue >= now - 0.02) {
      const bassHz = i < 8 ? 73.42 : i < 16 ? 98.0 : 110.0;
      playSoftSub(tk, ct, bassHz, 0.55, 0.24 + prog * 0.08, scoreBus, bassHz * 1.9);
      playMicroHat(tk, ct, 6400, 0.028, 0.045 + prog * 0.03, pv * 0.7, scoreBus);
    }
  }

  // Rising warm pad bed across power-on (2.45 - 5.90s)
  if (t0 + 4.15 > now) {
    const sT = Math.max(now, t0 + 2.45);
    playPadChord(tk, sT, [146.83, 220.0, 277.18, 329.63], Math.max(0.2, t0 + 4.25 - sT), 0.17, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 360,
      cutoffPeak: 1150,
      cutoffEnd: 820,
      attackSec: 0.55,
      releaseSec: 0.45,
      detuneCents: 6,
    });
  }
  if (t0 + 5.95 > now) {
    const sT = Math.max(now, t0 + 4.1);
    playPadChord(tk, sT, [196.0, 293.66, 369.99, 440.0], Math.max(0.2, t0 + 5.95 - sT), 0.21, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 580,
      cutoffPeak: 1650,
      cutoffEnd: 920,
      attackSec: 0.5,
      releaseSec: 0.55,
      detuneCents: 7,
    });
  }

  // Act 5 (5.86 - 8.80s): Luminous Dmaj9 Hero Bloom gently handing off to the quiet loop
  if (t0 + 8.6 > now) {
    const tRes = Math.max(now, t0 + 5.86);
    const dur = Math.max(0.5, t0 + 8.8 - tRes);
    if (t0 + 5.86 >= now - 0.03) {
      playSoftSub(tk, tRes, 36.71, 1.35, 0.34, scoreBus, 92);
      playGlassBell(tk, tRes, 587.33, 2.2, 0.14, -0.22, scoreBus, 0.65);
      playGlassBell(tk, tRes + 0.045, 739.99, 2.1, 0.11, 0.25, scoreBus, 0.6);
      playGlassBell(tk, tRes + 0.09, 1174.66, 2.3, 0.09, 0.0, scoreBus, 0.55);
    }
    playPadChord(tk, tRes, [73.42, 146.83, 220.0, 277.18, 329.63, 369.99], dur, 0.22, scoreBus, {
      wave: 'triangle',
      cutoffStart: 1300,
      cutoffPeak: 1450,
      cutoffEnd: 280,
      attackSec: 0.14,
      releaseSec: 1.9,
      detuneCents: 5,
    });
  }
}

/** Solemn cinematic timpani / low heartbeat pulse */
function playTimpaniPulse(
  tk: SynthToolkit,
  time: number,
  hz: number,
  durSec: number,
  gain: number,
  dest: AudioNode
): void {
  const { ctx } = tk;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz * 1.32, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(24, hz), time + 0.085);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(hz * 3.0, time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, hz * 1.15), time + durSec);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  osc.connect(lp);
  lp.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + durSec + 0.05);
  tk.track(osc);
}

/** Deep cinematic sub-impact boom + velvety air thump for the 5.65s full-die reveal */
function playCinemaImpact(
  tk: SynthToolkit,
  time: number,
  startHz: number,
  targetHz: number,
  durSec: number,
  gain: number,
  dest: AudioNode
): void {
  const { ctx } = tk;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(26, targetHz), time + 0.14);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.018);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.42), time + durSec * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + durSec + 0.06);
  tk.track(osc);

  const src = ctx.createBufferSource();
  src.buffer = tk.brushedNoiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(340, time);
  lp.frequency.exponentialRampToValueAtTime(75, time + 0.55);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, time);
  ng.gain.linearRampToValueAtTime(gain * 0.24, time + 0.025);
  ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.65);

  src.connect(lp);
  lp.connect(ng);
  ng.connect(dest);
  src.start(time, 0, 0.72);
  tk.track(src);
}

/** Soft horizon air swell rising into the silicon reveal */
function playAirSwell(
  tk: SynthToolkit,
  time: number,
  durSec: number,
  startHz: number,
  peakHz: number,
  gain: number,
  dest: AudioNode
): void {
  const { ctx } = tk;
  const src = ctx.createBufferSource();
  src.buffer = tk.brushedNoiseBuf;
  src.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.setValueAtTime(2.0, time);
  bp.frequency.setValueAtTime(startHz, time);
  bp.frequency.exponentialRampToValueAtTime(peakHz, time + durSec * 0.88);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + durSec * 0.85);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + durSec + 0.05);
  tk.track(src);
}

/** 2) QUANTUM DRIFT (Horizon Pulse) — Solemn timpani heartbeat + rising dark cello strings -> wide Fm9 reveal */
function scheduleOrbitalIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  // Solemn low heartbeat pulse climbing from blackout through power-on (0.25s -> 5.05s)
  for (let i = 0; i < 9; i++) {
    const cue = 0.25 + i * 0.6;
    if (t0 + cue < now - 0.02) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 8;
    const hz = i < 6 ? 43.65 : 69.3;
    playTimpaniPulse(tk, ct, hz, 0.68, 0.16 + prog * 0.22, scoreBus);
  }

  // Rising dark cello / analog string swell climbing across power-on rails & clusters
  if (t0 + 3.75 > now) {
    const sT = Math.max(now, t0 + 1.45);
    playPadChord(tk, sT, [87.31, 130.81, 174.61], Math.max(0.2, t0 + 3.75 - sT), 0.2, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 150,
      cutoffPeak: 680,
      cutoffEnd: 420,
      attackSec: 1.3,
      releaseSec: 0.7,
      detuneCents: 8,
      useDrive: true,
    });
  }
  if (t0 + 5.85 > now) {
    const sT = Math.max(now, t0 + 3.45);
    playPadChord(tk, sT, [69.3, 138.59, 207.65, 261.63, 349.23], Math.max(0.2, t0 + 5.85 - sT), 0.3, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 280,
      cutoffPeak: 1450,
      cutoffEnd: 780,
      attackSec: 1.45,
      releaseSec: 0.65,
      detuneCents: 9,
      useDrive: true,
    });
  }
  if (t0 + 5.65 > now) {
    const sT = Math.max(now, t0 + 2.8);
    const dur = Math.max(0.2, t0 + 5.65 - sT);
    playAirSwell(tk, sT, dur, 220, 920, 0.05, scoreBus);
  }

  // Act 5 (5.65 - 9.45s): Deep cinematic reveal impact + wide warm Fm9 strings settling into loop
  if (t0 + 9.4 > now) {
    const tRes = Math.max(now, t0 + 5.65);
    const dur = Math.max(0.5, t0 + 9.45 - tRes);
    if (t0 + 5.65 >= now - 0.03) {
      playCinemaImpact(tk, tRes, 108, 43.65, 2.8, 0.44, scoreBus);
    }
    playPadChord(tk, tRes, [87.31, 130.81, 196.0, 207.65, 261.63], dur, 0.27, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 1180,
      cutoffPeak: 960,
      cutoffEnd: 210,
      attackSec: 0.14,
      releaseSec: 2.5,
      detuneCents: 8,
      useDrive: true,
    });
  }
}

/** 3) SILICON PULSE — Precision A Dorian modular micro-plucks & tactile cleanroom groove */
function schedulePulseIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  // Act 0 (0.00 - 2.45s): Microscopic piezo-clock sync pulses + warm A1 sub swell
  if (t0 + 2.46 > now) {
    const sT = Math.max(now, t0 + 0.1);
    playSoftSub(tk, sT, 55.0, Math.max(0.2, t0 + 2.45 - sT), 0.18, scoreBus);

    const clockCues = [0.55, 1.15, 1.55, 1.85, 2.08, 2.24, 2.35];
    for (let i = 0; i < clockCues.length; i++) {
      const cue = clockCues[i];
      if (t0 + cue >= now - 0.02) {
        const ct = Math.max(now, t0 + cue);
        const prog = i / (clockCues.length - 1);
        const pv = (i % 2 === 0 ? -1 : 1) * 0.28;
        playMicroHat(tk, ct, 4200 + prog * 2800, 0.016, 0.09 + prog * 0.08, pv, scoreBus);
        playModularPluck(tk, ct, 220 * (1 + (i % 3) * 0.25), 0.08, 0.055 + prog * 0.04, -pv, scoreBus, 0.3 + prog * 0.5);
      }
    }
  }

  // Act 1-4 (2.45 - 5.608s): 24 steps of interlocking 16th Buchla/modular A-Dorian groove
  const step = 0.1316;
  const bassSeq = [
    110.0, 0, 110.0, 164.81, 0, 110.0, 130.81, 0,
    110.0, 164.81, 0, 110.0, 196.0, 0, 164.81, 130.81,
    87.31, 0, 174.61, 87.31, 130.81, 0, 164.81, 196.0,
  ];
  const topSeq = [
    440.0, 0, 329.63, 0, 392.0, 0, 440.0, 493.88,
    0, 523.25, 0, 440.0, 392.0, 0, 329.63, 0,
    440.0, 493.88, 523.25, 0, 587.33, 659.25, 587.33, 659.25,
  ];

  for (let i = 0; i < 24; i++) {
    const cue = 2.45 + i * step;
    if (t0 + cue + 0.14 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 23;

    if (i % 4 === 0 && t0 + cue >= now - 0.02) {
      playSoftSub(tk, ct, i < 16 ? 55.0 : 43.65, 0.22, 0.3 + prog * 0.08, scoreBus, 148);
    }
    if (i % 2 === 1 && t0 + cue >= now - 0.02) {
      playMicroHat(tk, ct, 7400, 0.02, 0.055 + prog * 0.045, i % 4 === 1 ? -0.32 : 0.32, scoreBus);
    }
    const bHz = bassSeq[i];
    if (bHz > 0) {
      playModularPluck(tk, ct, bHz, 0.16, 0.13 + prog * 0.06, -0.16, scoreBus, 0.35 + prog * 0.6);
    }
    const tHz = topSeq[i];
    if (tHz > 0) {
      playModularPluck(tk, ct, tHz, 0.22, 0.08 + prog * 0.055, i % 2 === 0 ? 0.34 : -0.34, scoreBus, 0.45 + prog * 0.55);
    }
  }

  // Act 5 (5.608 - 7.80s): Clean Am9 modular lock & smooth settle into quiet pulse loop
  if (t0 + 7.8 > now) {
    const tRes = Math.max(now, t0 + 5.608);
    const dur = Math.max(0.4, t0 + 7.85 - tRes);
    if (t0 + 5.608 >= now - 0.03) {
      playSoftSub(tk, tRes, 55.0, 0.65, 0.34, scoreBus, 140);
      playGlassBell(tk, tRes, 440.0, 1.4, 0.09, 0.0, scoreBus, 0.5);
    }
    playPadChord(tk, tRes, [110.0, 164.81, 246.94, 261.63, 329.63], dur, 0.17, scoreBus, {
      wave: 'triangle',
      cutoffStart: 1200,
      cutoffPeak: 1250,
      cutoffEnd: 260,
      attackSec: 0.08,
      releaseSec: 1.5,
      detuneCents: 5,
    });
  }
}

/** 4) LATE-NIGHT LAB — Warm Eb major9 Rhodes chord rolls & brushed analog tape glow */
function scheduleVelvetIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  // Act 0 (0.00 - 2.45s): Warm Eb2 Rhodes swell + cozy soft brushed clicks
  if (t0 + 2.5 > now) {
    const sT = Math.max(now, t0 + 0.12);
    playPadChord(tk, sT, [77.78, 155.56, 233.08], Math.max(0.2, t0 + 2.5 - sT), 0.14, scoreBus, {
      wave: 'triangle',
      cutoffStart: 220,
      cutoffPeak: 540,
      cutoffEnd: 340,
      attackSec: 1.0,
      releaseSec: 0.4,
      detuneCents: 6,
    });
    const taps: [number, number][] = [
      [0.68, 311.13],
      [1.52, 349.23],
      [2.12, 392.0],
    ];
    for (let i = 0; i < taps.length; i++) {
      const [cue, hz] = taps[i];
      if (t0 + cue >= now - 0.02) {
        const ct = Math.max(now, t0 + cue);
        playRhodesNote(tk, ct, hz, 1.1, 0.075 + i * 0.015, i % 2 === 0 ? -0.3 : 0.3, scoreBus, 1.2);
      }
    }
  }

  // Act 1-4 (2.45 - 5.84s): Warm rolled jazz chords (Ebmaj9 -> Cm9 -> Fm9 -> Bb13sus4) + soft groove
  const chords: [number, number, readonly number[]][] = [
    [2.45, 77.78, [155.56, 233.08, 293.66, 349.23, 392.0]], // Ebmaj9
    [3.34, 65.41, [130.81, 196.0, 233.08, 293.66, 311.13]], // Cm9
    [4.24, 87.31, [174.61, 207.65, 261.63, 311.13, 392.0]], // Fm9
    [5.05, 58.27, [155.56, 207.65, 261.63, 349.23, 392.0]], // Bb13sus4
  ];

  for (let c = 0; c < chords.length; c++) {
    const [cue, bassHz, notes] = chords[c];
    if (t0 + cue + 0.5 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    playSoftSub(tk, ct, bassHz, 0.92, 0.25 + c * 0.02, scoreBus, bassHz * 1.4);
    for (let n = 0; n < notes.length; n++) {
      const nt = ct + n * 0.042;
      const pv = ((n / (notes.length - 1)) * 2 - 1) * 0.42;
      playRhodesNote(tk, nt, notes[n], 1.25, 0.088 + c * 0.008, pv, scoreBus, 1.15);
    }
    // Soft brushed percussion pulse
    playMicroHat(tk, ct + 0.36, 5200, 0.042, 0.05, 0.22, scoreBus);
    playMicroHat(tk, ct + 0.72, 4600, 0.032, 0.038, -0.22, scoreBus);
  }

  // Act 5 (5.84 - 8.70s): Resolving warm Ebmaj9 Rhodes bloom melting into late-night loop
  if (t0 + 8.6 > now) {
    const tRes = Math.max(now, t0 + 5.84);
    const dur = Math.max(0.5, t0 + 8.7 - tRes);
    if (t0 + 5.84 >= now - 0.03) {
      playSoftSub(tk, tRes, 77.78, 1.3, 0.3, scoreBus, 120);
      const chord = [155.56, 233.08, 293.66, 349.23, 466.16];
      chord.forEach((hz, i) => {
        playRhodesNote(tk, tRes + i * 0.038, hz, 2.2, 0.095, (i - 2) * 0.2, scoreBus, 1.25);
      });
    }
    playPadChord(tk, tRes, [77.78, 155.56, 233.08, 293.66, 349.23], dur, 0.16, scoreBus, {
      wave: 'triangle',
      cutoffStart: 920,
      cutoffPeak: 980,
      cutoffEnd: 240,
      attackSec: 0.18,
      releaseSec: 1.8,
      detuneCents: 7,
    });
  }
}

/** 5) CYBER NOIR — Iconic Dark C-Minor Moog 16th Arp handing off smoothly to dark ambient pulse */
function scheduleNoirIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const { ctx } = tk;

  // Act 0 (0.00 - 2.45s): C1 sub tension + accelerating clock ticks
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
    tk.track(subPre);

    const preTicks: [number, number, number][] = [
      [0.65, 1650, 0.11],
      [1.56, 2100, 0.14],
      [2.02, 2650, 0.17],
      [2.28, 3150, 0.21],
    ];
    for (const [cue, hz, amp] of preTicks) {
      if (t0 + cue >= now - 0.02) {
        const ct = Math.max(now, t0 + cue);
        tk.triggerStrike(ct, hz, 3.8, 0.007, amp, scoreBus);
        tk.triggerThock(ct, 155, 52, 0.06, amp * 0.92, scoreBus, 'triangle');
      }
    }
  }

  // Act 1-4 (2.45 - 5.666s): 24 steps of Dark Electro Moog 16th Arp building to climax
  const buildPattern = [
    65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0,
    65.41, 65.41, 130.81, 65.41, 116.54, 98.0, 77.78, 65.41,
    51.91, 51.91, 103.83, 51.91, 77.78, 98.0, 130.81, 155.56,
  ];
  const step = 0.134;
  const arpDrive = ctx.createWaveShaper();
  arpDrive.curve = tk.warmDriveCurve;
  arpDrive.connect(scoreBus);

  const arpPanL = ctx.createStereoPanner();
  arpPanL.pan.setValueAtTime(-0.22, now);
  arpPanL.connect(arpDrive);
  const arpPanR = ctx.createStereoPanner();
  arpPanR.pan.setValueAtTime(0.22, now);
  arpPanR.connect(arpDrive);

  for (let i = 0; i < buildPattern.length; i++) {
    const cueSec = 2.45 + i * step;
    if (t0 + cueSec + 0.14 <= now) continue;
    const ct = Math.max(now, t0 + cueSec);
    const hz = buildPattern[i];
    const buildProg = i / 23;

    if (i % 4 === 0 && t0 + cueSec >= now - 0.02) {
      const kickAmp = 0.35 * (0.72 + buildProg * 0.32);
      tk.triggerThock(ct, 138, 32.7, 0.24, kickAmp, scoreBus, 'sine');
      tk.triggerStrike(ct, 2500 + buildProg * 1100, 2.2, 0.008, 0.14 + buildProg * 0.06, scoreBus);
    }
    if (i >= 16 && t0 + cueSec >= now - 0.02) {
      const bp = (i - 16) / 7;
      playMicroHat(tk, ct, 3600 + bp * 1800, 0.005, 0.1 + bp * 0.09, i % 2 === 0 ? -0.34 : 0.34, scoreBus);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(4.2, ct);
    const cutPeak = 320 + buildProg * 2450 + (i % 4 === 2 ? 460 : 0);
    lp.frequency.setValueAtTime(cutPeak, ct);
    lp.frequency.exponentialRampToValueAtTime(110, ct + 0.118);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ct);
    g.gain.linearRampToValueAtTime(0.17 * (0.55 + buildProg * 0.55), ct + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.128);

    lp.connect(g);
    g.connect(i % 2 === 0 ? arpPanL : arpPanR);

    for (const det of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz, ct);
      osc.detune.setValueAtTime(det, ct);
      osc.connect(lp);
      osc.start(ct);
      osc.stop(ct + 0.14);
      tk.track(osc);
    }
  }

  // Act 5 (5.666 - 8.60s): Resolving C-Minor Dark Synth Monolith handing off smoothly into quiet Noir loop
  if (t0 + 8.6 > now) {
    const tRes = Math.max(now, t0 + 5.666);
    const dur = Math.max(0.5, t0 + 8.6 - tRes);
    if (t0 + 5.666 >= now - 0.03) {
      tk.triggerThock(tRes, 132, 32.7, 0.52, 0.44, scoreBus, 'sine');
    }
    playPadChord(tk, tRes, [32.7, 65.41, 98.0, 130.81, 155.56], dur, 0.26, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 1650,
      cutoffPeak: 1200,
      cutoffEnd: 160,
      attackSec: 0.04,
      releaseSec: 1.9,
      detuneCents: 6,
      q: 1.3,
      useDrive: true,
    });
  }
}

// ============================================================================
// INFINITE QUIET BACKGROUND LOOPS (Lookahead step-by-step generator)
// ============================================================================

/**
 * Schedule one step of the active vibe's quiet, evolving infinite background loop.
 * `stepIdx` cycles 0..63 (4 bars of 16 steps); `cycleIdx` increments every 4-bar cycle
 * to gently vary voicings and upper melodies so long sessions stay hypnotic and fresh.
 * `depthNorm` is 0.0 (macro die) .. 1.0 (atomic / quark depth) for subtle zoom-reactive bloom!
 */
export function scheduleVibeLoopStep(
  vibeId: MusicVibeId,
  tk: SynthToolkit,
  stepIdx: number,
  cycleIdx: number,
  time: number,
  stepSec: number,
  bgmDest: AudioNode,
  depthNorm: number
): void {
  switch (vibeId) {
    case 'glass':
      stepGlassLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'orbital':
      stepOrbitalLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'pulse':
      stepPulseLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'velvet':
      stepVelvetLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'noir':
      stepNoirLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
  }
}

/** 1) CLEANROOM GLASS LOOP — Dmaj9 -> Bm11 -> Gmaj7(#11) -> A6/9 */
function stepGlassLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Bar downbeat: warm low-passed pad + soft bass foundation
  if (inBar === 0) {
    const pads: readonly (readonly number[])[] = [
      [146.83, 220.0, 277.18, 329.63], // Dmaj9
      [123.47, 185.0, 220.0, 293.66], // Bm11
      [98.0, 185.0, 246.94, 293.66], // Gmaj7#11
      [110.0, 164.81, 246.94, 277.18], // A6/9
    ];
    const roots = [73.42, 61.74, 49.0, 55.0];
    playPadChord(tk, time, pads[bar], barDur * 1.12, 0.22, dest, {
      wave: 'triangle',
      cutoffStart: 320 + depthNorm * 140,
      cutoffPeak: 680 + depthNorm * 320,
      cutoffEnd: 290,
      attackSec: 0.72,
      releaseSec: 0.9,
      detuneCents: 5,
    });
    playSoftSub(tk, time, roots[bar], barDur * 0.85, 0.22, dest);
  }

  // Spacious crystalline glass-bell arp (sparse pattern so it breathes quietly)
  const arpGrid: readonly (readonly number[])[] = [
    [587.33, 0, 0, 440.0, 0, 0, 659.25, 0, 739.99, 0, 0, 587.33, 0, 440.0, 0, 0],
    [493.88, 0, 0, 369.99, 0, 0, 587.33, 0, 659.25, 0, 0, 493.88, 0, 440.0, 0, 0],
    [392.0, 0, 0, 587.33, 0, 0, 739.99, 0, 659.25, 0, 0, 587.33, 0, 493.88, 0, 0],
    [440.0, 0, 0, 554.37, 0, 0, 659.25, 0, 587.33, 0, 0, 493.88, 0, 440.0, 0, 0],
  ];
  const bellHz = arpGrid[bar][inBar];
  if (bellHz > 0) {
    // Alternate subtle upper octave shimmer on odd cycles or deep magnification
    const shimmer = (cycle % 2 === 1 && inBar === 8) || (depthNorm > 0.55 && inBar === 6);
    const hz = shimmer ? bellHz * 2 : bellHz;
    const pv = Math.sin(step * 0.85) * 0.45;
    playGlassBell(tk, time, hz, 1.05, shimmer ? 0.065 : 0.095, pv, dest, 0.32 + depthNorm * 0.25);
  }

  // Soft felt-key harmonic answer on beat 3 (inBar === 8)
  if (inBar === 8) {
    const midNotes = [293.66, 246.94, 293.66, 277.18];
    playRhodesNote(tk, time, midNotes[bar], 1.15, 0.11, bar % 2 === 0 ? -0.25 : 0.25, dest, 0.65);
  }

  // Feather-light brushed pulse on offbeats (very quiet, tactile)
  if (inBar === 4 || inBar === 12) {
    playMicroHat(tk, time, 6200, 0.022, 0.028, inBar === 4 ? -0.35 : 0.35, dest);
  }
}

/** 2) QUANTUM DRIFT (Horizon Pulse) LOOP — Quiet cinema heartbeat (1.2s) under dark breathing Fm7 <-> Ebsus2 strings */
function stepOrbitalLoop(
  tk: SynthToolkit,
  step: number,
  _cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  // Two slow breathing dark string chords (4.8s each = 8 steps * 0.6s)
  if (step === 0 || step === 8) {
    const isA = step === 0;
    const chord = isA
      ? [87.31, 130.81, 207.65, 261.63] // Fm7
      : [77.78, 116.54, 174.61, 233.08]; // Ebsus2
    playPadChord(tk, time, chord, stepSec * 9.0, 0.28, dest, {
      wave: 'sawtooth',
      cutoffStart: 160 + depthNorm * 80,
      cutoffPeak: 450 + depthNorm * 290,
      cutoffEnd: 155,
      attackSec: 1.9,
      releaseSec: 2.1,
      detuneCents: 8,
      useDrive: true,
    });
  }

  // Solemn quiet heartbeat pulse every 1.2s (even steps)
  if (step % 2 === 0) {
    const root = step < 8 ? 43.65 : 58.27;
    playTimpaniPulse(tk, time, root, 0.78, step % 8 === 0 ? 0.32 : 0.2, dest);
  }
}

/** 3) SILICON PULSE LOOP — Am9 -> Fmaj7 -> Dm9 -> Em7 (soft modular cleanroom groove) */
function stepPulseLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Soft warm atmospheric pad anchoring each bar
  if (inBar === 0) {
    const pads: readonly (readonly number[])[] = [
      [110.0, 164.81, 246.94, 261.63], // Am9
      [87.31, 164.81, 220.0, 261.63], // Fmaj7
      [146.83, 174.61, 220.0, 329.63], // Dm9
      [164.81, 196.0, 246.94, 293.66], // Em7
    ];
    playPadChord(tk, time, pads[bar], barDur * 1.08, 0.17, dest, {
      wave: 'triangle',
      cutoffStart: 280,
      cutoffPeak: 580 + depthNorm * 240,
      cutoffEnd: 260,
      attackSec: 0.45,
      releaseSec: 0.65,
      detuneCents: 5,
    });
  }

  // Gentle muted sub-kick on quarter notes
  const barRoots = [55.0, 43.65, 73.42, 82.41];
  if (inBar % 4 === 0) {
    playSoftSub(tk, time, barRoots[bar], 0.24, inBar === 0 ? 0.28 : 0.2, dest, 122);
  }

  // Whisper-quiet precision Swiss-watch / cleanroom micro-hats
  if (inBar % 2 === 1) {
    const accent = inBar % 4 === 3 ? 0.042 : 0.024;
    playMicroHat(tk, time, 6800 + (inBar % 4) * 400, 0.018, accent, inBar % 4 === 1 ? -0.34 : 0.34, dest);
  }

  // Interlocking modular bass & upper pluck pattern (softly filtered for effortless background listening)
  const bassPattern = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0];
  if (bassPattern[inBar]) {
    const base = barRoots[bar] * 2;
    const hz = inBar === 12 || inBar === 14 ? base * 1.5 : base;
    playModularPluck(tk, time, hz, 0.16, 0.13, -0.18, dest, 0.25 + depthNorm * 0.25);
  }

  const melodySteps: readonly (readonly number[])[] = [
    [440.0, 0, 329.63, 0, 0, 392.0, 0, 0, 440.0, 0, 0, 493.88, 0, 392.0, 0, 0],
    [440.0, 0, 329.63, 0, 0, 523.25, 0, 0, 440.0, 0, 0, 392.0, 0, 329.63, 0, 0],
    [587.33, 0, 440.0, 0, 0, 523.25, 0, 0, 440.0, 0, 0, 392.0, 0, 329.63, 0, 0],
    [493.88, 0, 392.0, 0, 0, 440.0, 0, 0, 392.0, 0, 0, 329.63, 0, 293.66, 0, 0],
  ];
  const mHz = melodySteps[bar][inBar];
  if (mHz > 0) {
    const alt = cycle % 2 === 1 && inBar === 11 ? mHz * 1.122 : mHz;
    playModularPluck(tk, time, alt, 0.24, 0.085, 0.3, dest, 0.28 + depthNorm * 0.28);
  }
}

/** 4) LATE-NIGHT LAB LOOP — Ebmaj9 -> Cm9 -> Fm9 -> Bb13sus4 (warm Rhodes & tape groove) */
function stepVelvetLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Slight human micro-swing on off-16ths
  const swing = inBar % 2 === 1 ? stepSec * 0.14 : 0;
  const t = time + swing;

  const chords: readonly (readonly number[])[] = [
    [155.56, 233.08, 293.66, 349.23, 392.0], // Ebmaj9
    [130.81, 196.0, 233.08, 293.66, 311.13], // Cm9
    [174.61, 207.65, 261.63, 311.13, 392.0], // Fm9
    [155.56, 207.65, 261.63, 349.23, 392.0], // Bb13sus4
  ];
  const bassNotes = [77.78, 65.41, 87.31, 58.27];

  // Rolled Rhodes chord on beat 1 and gentle syncopated push on beat 3.5 (inBar === 10)
  if (inBar === 0 || inBar === 10) {
    const chord = chords[bar];
    const amp = inBar === 0 ? 0.1 : 0.068;
    const dur = inBar === 0 ? barDur * 0.72 : barDur * 0.42;
    for (let i = 0; i < chord.length; i++) {
      const pv = ((i / (chord.length - 1)) * 2 - 1) * 0.4;
      playRhodesNote(tk, t + i * 0.032, chord[i], dur, amp, pv, dest, 1.15);
    }
  }

  // Round warm bassline
  if (inBar === 0) {
    playSoftSub(tk, t, bassNotes[bar], barDur * 0.58, 0.25, dest);
  } else if (inBar === 6 || inBar === 12) {
    const fifth = bassNotes[bar] * (inBar === 6 ? 1.5 : 1.0);
    playSoftSub(tk, t, fifth, stepSec * 4.5, 0.17, dest);
  }

  // Sparse late-night upper Rhodes melody licks
  const licks: readonly (readonly number[])[] = [
    [0, 0, 0, 0, 587.33, 0, 523.25, 0, 0, 0, 0, 0, 466.16, 0, 0, 0],
    [0, 0, 0, 0, 466.16, 0, 392.0, 0, 0, 0, 0, 0, 349.23, 0, 0, 0],
    [0, 0, 0, 0, 523.25, 0, 466.16, 0, 0, 0, 0, 0, 392.0, 0, 466.16, 0],
    [0, 0, 0, 0, 587.33, 0, 466.16, 0, 0, 0, 0, 0, 349.23, 0, 0, 0],
  ];
  const lickHz = licks[bar][inBar];
  if (lickHz > 0 && (cycle % 2 === 0 || inBar >= 12)) {
    playRhodesNote(tk, t, lickHz, 0.9, 0.075, 0.28, dest, 1.2 + depthNorm * 0.2);
  }

  // Soft lo-fi brushed rhythm
  if (inBar === 0 || inBar === 10) {
    playSoftSub(tk, t, 52, 0.16, 0.16, dest, 115);
  }
  if (inBar === 4 || inBar === 12) {
    playMicroHat(tk, t, 3900, 0.055, 0.042, -0.14, dest);
  }
  if (inBar % 4 === 2) {
    playMicroHat(tk, t, 6100, 0.022, 0.024, 0.26, dest);
  }
}

/** 5) CYBER NOIR LOOP — Quiet, darkly filtered hypnotic C-minor Moog pulse + brooding sub bed */
function stepNoirLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Brooding dark analog pad per bar (Cm -> Cm -> Ab -> Gm)
  if (inBar === 0) {
    const pads: readonly (readonly number[])[] = [
      [65.41, 130.81, 155.56, 196.0],
      [65.41, 130.81, 146.83, 196.0],
      [51.91, 103.83, 155.56, 196.0],
      [49.0, 98.0, 146.83, 196.0],
    ];
    playPadChord(tk, time, pads[bar], barDur * 1.12, 0.2, dest, {
      wave: 'sawtooth',
      cutoffStart: 200,
      cutoffPeak: 480 + depthNorm * 320,
      cutoffEnd: 190,
      attackSec: 0.55,
      releaseSec: 0.8,
      detuneCents: 6,
    });
  }

  // Soft heartbeat sub-kick on quarter notes
  if (inBar % 4 === 0) {
    playSoftSub(tk, time, bar === 2 ? 51.91 : bar === 3 ? 49.0 : 32.7, 0.24, 0.25, dest, 118);
  }

  // Hypnotic muted Moog 16th arp (much softer & warmer than intro so it sits quietly behind UI!)
  const patterns: readonly (readonly number[])[] = [
    [65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0, 65.41, 65.41, 130.81, 65.41, 98.0, 77.78, 65.41, 98.0],
    [65.41, 65.41, 130.81, 65.41, 116.54, 65.41, 98.0, 77.78, 65.41, 65.41, 130.81, 65.41, 98.0, 77.78, 65.41, 65.41],
    [51.91, 51.91, 103.83, 51.91, 77.78, 51.91, 98.0, 77.78, 51.91, 51.91, 103.83, 51.91, 77.78, 98.0, 130.81, 98.0],
    [49.0, 49.0, 98.0, 49.0, 73.42, 49.0, 77.78, 98.0, 49.0, 49.0, 98.0, 73.42, 77.78, 98.0, 116.54, 98.0],
  ];
  const hz = patterns[bar][inBar];
  const breathe = 0.5 + 0.5 * Math.sin(((cycle * 64 + step) / 32) * Math.PI * 2);
  const cut = 260 + breathe * 360 + depthNorm * 280 + (inBar % 4 === 2 ? 180 : 0);

  const p = tk.ctx.createStereoPanner();
  p.pan.setValueAtTime(inBar % 2 === 0 ? -0.2 : 0.2, time);
  p.connect(dest);
  const osc = tk.triggerAnalogPluck(time, hz, cut, 2.8, 0.12, 0.125, p, 'sawtooth', inBar % 2 === 0 ? -4 : 4);
  tk.track(osc);

  // Subtle dark chime accent on odd cycles
  if (cycle % 2 === 1 && inBar === 0 && bar % 2 === 0) {
    playGlassBell(tk, time, bar === 0 ? 523.25 : 415.3, 1.4, 0.055, 0.3, dest, 0.25);
  }
}
