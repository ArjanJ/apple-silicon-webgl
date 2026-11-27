/**
 * Procedural Sci-Fi & Synthwave Music Library for Silicon Microscope
 *
 * Six distinct zero-dependency Web Audio soundtracks spanning the Sci-Fi and Synthwave spectrum:
 *   1) Hyperion Signal  (Sci-Fi · C# Dorian · 108 BPM)       — Cosmic CS-80 brass, FM crystal arps & Blade Runner lead
 *   2) Neon Die         (Synthwave · E Minor · 118 BPM)      — Classic 80s Outrun saw bass, gated snare & Juno pads
 *   3) Cyber Grid       (Darksynth · C Minor · 126 BPM)      — Aggressive Tron/cyberpunk distorted bass & razor arps
 *   4) Orbital Laser    (Spacesynth · A Minor · 122 BPM)     — Retro-futuristic octave bass, laser arps & disco-synth
 *   5) Starlight Drift  (Dreamwave · D# Minor · 96 BPM)      — Warm VHS chillwave, detuned chorus chords & soft snare
 *   6) Event Horizon    (Deep Sci-Fi · D Phrygian · 92 BPM)  — Vast cosmic sub-monolith, alien brass & radar pings
 *
 * Each style pairs:
 *   - A sample-accurate ~7-second Cold Boot intro synchronized to the visual reveal
 *   - A seamless, evolving 16-bar (4-phrase) infinite background loop that subtly blooms with zoom depth
 *   - A harmonically matched scale table so hover taps, turret stops, and bursts stay in key
 */

export type MusicVibeId = 'scifi' | 'synthwave' | 'darksynth' | 'spacesynth' | 'dreamwave' | 'cyberambient';

export type BgmLevelId = 'off' | 'whisper' | 'quiet' | 'present';

export interface IntroCueMap {
  /** Total intro duration (sec) */
  readonly durationSec: number;
  /** Elapsed offset (sec) used when launching from a held "Power On" screen so Beat 1 hits immediately */
  readonly heldStartSec: number;
  /** Title dissolves out and the dark unpowered chip silhouette begins emerging */
  readonly revealSec: number;
  /** Beat timestamps (sec) during the unpowered build for subtle rhythmic rim-glints */
  readonly pulseBeats: readonly number[];
  /** Tension lift beat — dark silhouette lighting begins its slow build while chip stays unpowered */
  readonly riseSec: number;
  /** Crisp pre-drop suspense breath / inhale right before the major beat */
  readonly preDropSec: number;
  /** THE MAJOR BEAT: musical drop where the chip ignites & studio lighting floods open */
  readonly dropSec: number;
  /** Secondary cascade beat right after the drop where compute cores, GPU & ANE sweep online */
  readonly bloomSec: number;
  /** Optical reticle lock beat (and exact Bar 0 downbeat for seamless background loop handoff) */
  readonly lockSec: number;
  /** Liquid Glass HUD arrival beat */
  readonly hudSec: number;
}

export interface MusicVibeMeta {
  readonly id: MusicVibeId;
  readonly name: string;
  readonly genreTag: string;
  readonly shortLabel: string;
  readonly tagline: string;
  readonly metaBadge: string;
  readonly stepSec: number;
  readonly loopSteps: number;
  /** Exact intro timestamp (sec) where the infinite background loop locks onto Bar 0 downbeat */
  readonly loopHandoffSec: number;
  /** Crossfade duration (sec) when handing off from intro climax to Bar 0 loop */
  readonly handoffFadeSec: number;
  /** BGM master lowpass filter ceiling (base Hz at macro die + span Hz at atomic depth) */
  readonly bgmFilterBaseHz: number;
  readonly bgmFilterSpanHz: number;
  /** Beat-locked intro choreography timestamps shared by audio, camera, lighting, and boot cascade */
  readonly introCues: IntroCueMap;
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
  { id: 'whisper', label: 'Whisper', gain: 0.24 },
  { id: 'quiet', label: 'Quiet', gain: 0.46 },
  { id: 'present', label: 'Present', gain: 0.7 },
];

export const MUSIC_VIBES: readonly MusicVibeMeta[] = [
  {
    id: 'scifi',
    name: 'Hyperion Signal',
    genreTag: 'Sci-Fi',
    shortLabel: 'Sci-Fi',
    tagline: 'Cosmic CS-80 brass swells, shimmering FM arps & laser pings',
    metaBadge: 'SCI-FI · C♯ DOR · 108 BPM',
    stepSec: 0.13889,
    loopSteps: 64,
    loopHandoffSec: 5.756,
    handoffFadeSec: 0.18,
    bgmFilterBaseHz: 5600,
    bgmFilterSpanHz: 7400,
    introCues: {
      durationSec: 7.15,
      heldStartSec: 0.72,
      revealSec: 1.311,
      pulseBeats: [2.422, 2.978, 3.533, 4.089],
      riseSec: 2.422,
      preDropSec: 4.36,
      dropSec: 4.644,
      bloomSec: 5.2,
      lockSec: 5.756,
      hudSec: 6.311,
    },
    turretScaleHz: [69.3, 103.83, 138.59, 155.56, 164.81, 207.65, 233.08, 246.94, 277.18, 51.91, 34.65],
    pCoreScaleHz: [138.59, 155.56, 164.81, 185.0, 207.65, 233.08, 246.94, 277.18],
    rootHz: 138.59,
    fifthHz: 207.65,
    octaveHz: 277.18,
    subHz: 34.65,
    burstNotes: [69.3, 69.3, 138.59, 69.3, 103.83, 69.3, 82.41, 103.83],
  },
  {
    id: 'synthwave',
    name: 'Neon Die',
    genreTag: 'Synthwave',
    shortLabel: 'Synthwave',
    tagline: 'Driving 80s analog bass, gated snare & glowing Juno pads',
    metaBadge: 'SYNTHWAVE · E MIN · 118 BPM',
    stepSec: 0.12712,
    loopSteps: 64,
    loopHandoffSec: 5.285,
    handoffFadeSec: 0.14,
    bgmFilterBaseHz: 5800,
    bgmFilterSpanHz: 7200,
    introCues: {
      durationSec: 6.8,
      heldStartSec: 0.7,
      revealSec: 1.217,
      pulseBeats: [2.234, 2.742, 3.251, 3.759],
      riseSec: 2.234,
      preDropSec: 4.01,
      dropSec: 4.268,
      bloomSec: 4.776,
      lockSec: 5.285,
      hudSec: 5.793,
    },
    turretScaleHz: [82.41, 123.47, 164.81, 185.0, 196.0, 246.94, 261.63, 293.66, 329.63, 61.74, 41.2],
    pCoreScaleHz: [164.81, 185.0, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63],
    rootHz: 164.81,
    fifthHz: 246.94,
    octaveHz: 329.63,
    subHz: 41.2,
    burstNotes: [82.41, 82.41, 164.81, 82.41, 123.47, 82.41, 98.0, 123.47],
  },
  {
    id: 'darksynth',
    name: 'Cyber Grid',
    genreTag: 'Darksynth',
    shortLabel: 'Darksynth',
    tagline: 'Snarling Tron-style Moog bass, heavy punch & razor minor arps',
    metaBadge: 'DARKSYNTH · C MIN · 126 BPM',
    stepSec: 0.11905,
    loopSteps: 64,
    loopHandoffSec: 4.962,
    handoffFadeSec: 0.12,
    bgmFilterBaseHz: 6400,
    bgmFilterSpanHz: 7400,
    introCues: {
      durationSec: 6.5,
      heldStartSec: 0.67,
      revealSec: 1.152,
      pulseBeats: [2.105, 2.581, 3.057, 3.533],
      riseSec: 2.105,
      preDropSec: 3.77,
      dropSec: 4.01,
      bloomSec: 4.486,
      lockSec: 4.962,
      hudSec: 5.438,
    },
    turretScaleHz: [65.41, 98.0, 130.81, 146.83, 155.56, 196.0, 207.65, 233.08, 261.63, 49.0, 32.7],
    pCoreScaleHz: [130.81, 146.83, 155.56, 174.61, 196.0, 207.65, 233.08, 261.63],
    rootHz: 130.81,
    fifthHz: 196.0,
    octaveHz: 261.63,
    subHz: 32.7,
    burstNotes: [65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0],
  },
  {
    id: 'spacesynth',
    name: 'Orbital Laser',
    genreTag: 'Spacesynth',
    shortLabel: 'Spacesynth',
    tagline: 'Bouncy octave-jumping analog bass, laser arps & heroic synth',
    metaBadge: 'SPACESYNTH · A MIN · 122 BPM',
    stepSec: 0.12295,
    loopSteps: 64,
    loopHandoffSec: 5.118,
    handoffFadeSec: 0.12,
    bgmFilterBaseHz: 6200,
    bgmFilterSpanHz: 7400,
    introCues: {
      durationSec: 6.7,
      heldStartSec: 0.69,
      revealSec: 1.184,
      pulseBeats: [2.167, 2.659, 3.151, 3.643],
      riseSec: 2.167,
      preDropSec: 3.89,
      dropSec: 4.134,
      bloomSec: 4.626,
      lockSec: 5.118,
      hudSec: 5.61,
    },
    turretScaleHz: [55.0, 82.41, 110.0, 123.47, 130.81, 164.81, 174.61, 196.0, 220.0, 41.2, 27.5],
    pCoreScaleHz: [110.0, 123.47, 130.81, 146.83, 164.81, 174.61, 196.0, 220.0],
    rootHz: 110.0,
    fifthHz: 164.81,
    octaveHz: 220.0,
    subHz: 55.0,
    burstNotes: [55.0, 55.0, 110.0, 55.0, 82.41, 55.0, 65.41, 82.41],
  },
  {
    id: 'dreamwave',
    name: 'Starlight Drift',
    genreTag: 'Dreamwave',
    shortLabel: 'Dreamwave',
    tagline: 'Warm VHS chorus chords, glossy sunset plucks & hazy chillwave',
    metaBadge: 'DREAMWAVE · D♯ MIN · 96 BPM',
    stepSec: 0.15625,
    loopSteps: 64,
    loopHandoffSec: 5.825,
    handoffFadeSec: 0.2,
    bgmFilterBaseHz: 4600,
    bgmFilterSpanHz: 6800,
    introCues: {
      durationSec: 7.35,
      heldStartSec: 0.8,
      revealSec: 1.45,
      pulseBeats: [2.7, 3.325, 3.95],
      riseSec: 2.7,
      preDropSec: 4.26,
      dropSec: 4.575,
      bloomSec: 5.2,
      lockSec: 5.825,
      hudSec: 6.45,
    },
    turretScaleHz: [77.78, 116.54, 155.56, 174.61, 185.0, 233.08, 246.94, 277.18, 311.13, 58.27, 38.89],
    pCoreScaleHz: [155.56, 174.61, 185.0, 207.65, 233.08, 246.94, 277.18, 311.13],
    rootHz: 155.56,
    fifthHz: 233.08,
    octaveHz: 311.13,
    subHz: 38.89,
    burstNotes: [77.78, 77.78, 155.56, 77.78, 116.54, 77.78, 92.5, 116.54],
  },
  {
    id: 'cyberambient',
    name: 'Event Horizon',
    genreTag: 'Deep Sci-Fi',
    shortLabel: 'Deep Sci-Fi',
    tagline: 'Vast gravity sub-pulses, alien brass monoliths & orbital pings',
    metaBadge: 'DEEP SCI-FI · D PHRYG · 92 BPM',
    stepSec: 0.16304,
    loopSteps: 64,
    loopHandoffSec: 6.07,
    handoffFadeSec: 0.28,
    bgmFilterBaseHz: 4800,
    bgmFilterSpanHz: 7200,
    introCues: {
      durationSec: 7.5,
      heldStartSec: 0.82,
      revealSec: 1.504,
      pulseBeats: [2.809, 3.461, 4.113],
      riseSec: 2.809,
      preDropSec: 4.44,
      dropSec: 4.765,
      bloomSec: 5.417,
      lockSec: 6.07,
      hudSec: 6.722,
    },
    turretScaleHz: [73.42, 110.0, 146.83, 155.56, 174.61, 220.0, 233.08, 261.63, 293.66, 55.0, 36.71],
    pCoreScaleHz: [146.83, 155.56, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66],
    rootHz: 146.83,
    fifthHz: 220.0,
    octaveHz: 293.66,
    subHz: 36.71,
    burstNotes: [73.42, 73.42, 146.83, 73.42, 110.0, 73.42, 77.78, 110.0],
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
  delaySend?: AudioNode;
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
// Sci-Fi & Synthwave Synthesizer Primitives
// ============================================================================

/** Punchy 80s LinnDrum / Cyberpunk electronic kick */
function playSynthKick(
  tk: SynthToolkit,
  time: number,
  dest: AudioNode,
  opts?: {
    startHz?: number;
    endHz?: number;
    durSec?: number;
    gain?: number;
    clickGain?: number;
    drive?: boolean;
  }
): void {
  const { ctx } = tk;
  const startHz = opts?.startHz ?? 155;
  const endHz = opts?.endHz ?? 44;
  const durSec = opts?.durSec ?? 0.24;
  const gain = opts?.gain ?? 0.38;
  const clickGain = opts?.clickGain ?? 0.085;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(26, endHz), time + 0.048);
  osc.frequency.exponentialRampToValueAtTime(Math.max(24, endHz * 0.88), time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.003);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.35), time + durSec * 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  if (opts?.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = tk.warmDriveCurve;
    osc.connect(shaper);
    shaper.connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(dest);
  osc.start(time);
  osc.stop(time + durSec + 0.03);
  tk.track(osc);

  if (clickGain > 0) {
    const src = ctx.createBufferSource();
    src.buffer = tk.crispNoiseBuf;
    const offset = Math.random() * Math.max(0.01, tk.crispNoiseBuf.duration - 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1950, time);
    bp.Q.setValueAtTime(1.4, time);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, time);
    cg.gain.linearRampToValueAtTime(clickGain, time + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.014);
    src.connect(bp);
    bp.connect(cg);
    cg.connect(dest);
    src.start(time, offset, 0.02);
    tk.track(src);
  }
}

/** Iconic 80s gated snare, crisp electro clap, or dusty dreamwave snare */
function playRetroSnare(
  tk: SynthToolkit,
  time: number,
  dest: AudioNode,
  style: 'gated' | 'clap' | 'dusty',
  gain = 0.2,
  panVal = 0
): void {
  const { ctx } = tk;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.7, 0.7), time);
  pan.connect(dest);

  if (style === 'clap') {
    const taps = [0, 0.011, 0.022];
    taps.forEach((dt, idx) => {
      const src = ctx.createBufferSource();
      src.buffer = tk.crispNoiseBuf;
      const offset = Math.random() * Math.max(0.01, tk.crispNoiseBuf.duration - 0.16);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1320 + idx * 140, time + dt);
      bp.Q.setValueAtTime(1.45, time + dt);

      const g = ctx.createGain();
      const dur = idx === 2 ? 0.15 : 0.024;
      g.gain.setValueAtTime(0.0001, time + dt);
      g.gain.linearRampToValueAtTime(gain * (idx === 2 ? 1.0 : 0.65), time + dt + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dt + dur);

      src.connect(bp);
      bp.connect(g);
      g.connect(pan);
      src.start(time + dt, offset, dur + 0.01);
      tk.track(src);
    });
    return;
  }

  const body = ctx.createOscillator();
  body.type = 'triangle';
  const startHz = style === 'dusty' ? 185 : 215;
  const endHz = style === 'dusty' ? 115 : 122;
  const bodyDur = style === 'dusty' ? 0.12 : 0.15;
  body.frequency.setValueAtTime(startHz, time);
  body.frequency.exponentialRampToValueAtTime(endHz, time + 0.048);

  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, time);
  bg.gain.linearRampToValueAtTime(gain * (style === 'dusty' ? 0.7 : 0.85), time + 0.002);
  bg.gain.exponentialRampToValueAtTime(0.0001, time + bodyDur);
  body.connect(bg);
  bg.connect(pan);
  body.start(time);
  body.stop(time + bodyDur + 0.02);
  tk.track(body);

  const src = ctx.createBufferSource();
  src.buffer = style === 'dusty' ? tk.brushedNoiseBuf : tk.crispNoiseBuf;
  const noiseDur = style === 'gated' ? 0.25 : 0.18;
  const offset = Math.random() * Math.max(0.01, src.buffer.duration - noiseDur - 0.02);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(style === 'dusty' ? 1450 : 1900, time);
  bp.Q.setValueAtTime(style === 'dusty' ? 1.1 : 0.82, time);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, time);
  ng.gain.linearRampToValueAtTime(gain * (style === 'dusty' ? 0.72 : 0.95), time + 0.002);
  if (style === 'gated') {
    ng.gain.setValueAtTime(gain * 0.74, time + 0.145);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + noiseDur);
  } else {
    ng.gain.exponentialRampToValueAtTime(0.0001, time + noiseDur);
  }

  src.connect(bp);
  bp.connect(ng);
  ng.connect(pan);
  src.start(time, offset, noiseDur + 0.01);
  tk.track(src);
}

/** Crisp closed/open hi-hat or laser percussion tick */
function playHiHat(
  tk: SynthToolkit,
  time: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  freqHz = 8800
): void {
  const { ctx } = tk;
  const src = ctx.createBufferSource();
  src.buffer = tk.crispNoiseBuf;
  const offset = Math.random() * Math.max(0.01, tk.crispNoiseBuf.duration - Math.min(0.28, durSec) - 0.02);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(freqHz, time);
  hp.Q.setValueAtTime(1.1, time);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.0018);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.78, 0.78), time);

  src.connect(hp);
  hp.connect(g);
  g.connect(pan);
  pan.connect(dest);
  src.start(time, offset, Math.min(0.32, durSec + 0.01));
  tk.track(src);
}

/** Snarling distorted Darksynth / Tron Moog bass note */
function playDarkSynthBass(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  cutoffPeak: number,
  dest: AudioNode,
  panVal = 0
): void {
  const { ctx } = tk;
  const shaper = ctx.createWaveShaper();
  shaper.curve = tk.warmDriveCurve;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(4.4, time);
  lp.frequency.setValueAtTime(Math.max(freqHz * 2.0, cutoffPeak), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(105, freqHz * 1.45), time + durSec * 0.9);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.65, 0.65), time);

  shaper.connect(lp);
  lp.connect(env);
  env.connect(pan);
  pan.connect(dest);

  for (const det of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freqHz, time);
    osc.detune.setValueAtTime(det, time);
    osc.connect(shaper);
    osc.start(time);
    osc.stop(time + durSec + 0.025);
    tk.track(osc);
  }
}

/** Cosmic CS-80 / Blade Runner / Dune brassy synth swell */
function playCosmicBrass(
  tk: SynthToolkit,
  time: number,
  notesHz: readonly number[],
  durSec: number,
  gain: number,
  dest: AudioNode,
  opts?: {
    attackSec?: number;
    cutoffPeak?: number;
    bright?: boolean;
    detuneCents?: number;
  }
): void {
  const { ctx } = tk;
  const atk = Math.min(opts?.attackSec ?? 0.32, durSec * 0.44);
  const peak = opts?.cutoffPeak ?? (opts?.bright ? 2250 : 1450);
  const detune = opts?.detuneCents ?? 9;

  const shaper = ctx.createWaveShaper();
  shaper.curve = tk.warmDriveCurve;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(1.6, time);
  lp.frequency.setValueAtTime(220, time);
  lp.frequency.exponentialRampToValueAtTime(peak, time + atk + 0.12);
  lp.frequency.exponentialRampToValueAtTime(300, time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + atk);
  env.gain.setValueAtTime(gain * 0.88, Math.max(time + atk + 0.02, time + durSec * 0.68));
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  shaper.connect(lp);
  lp.connect(env);
  env.connect(dest);

  const perVoice = 1 / Math.max(1, notesHz.length);
  notesHz.forEach((hz, i) => {
    const spread = notesHz.length > 1 ? ((i / (notesHz.length - 1)) * 2 - 1) * 0.56 : 0;
    for (const det of [-detune, 0, detune]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz, time);
      if (det !== 0) osc.detune.setValueAtTime(det, time);

      const vg = ctx.createGain();
      vg.gain.setValueAtTime(perVoice * 0.36, time);

      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(spread + det * 0.014, -0.82, 0.82), time);

      osc.connect(vg);
      vg.connect(p);
      p.connect(shaper);
      osc.start(time);
      osc.stop(time + durSec + 0.05);
      tk.track(osc);
    }
  });
}

/** Shimmering Sci-Fi / Synthwave FM+Analog lead & arp with optional vibrato and stereo delay */
function playSciFiLead(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  opts?: {
    wave?: OscillatorType;
    fmRatio?: number;
    bright?: number;
    sendDelay?: number;
    vibrato?: boolean;
  }
): void {
  const { ctx } = tk;
  const bright = opts?.bright ?? 0.62;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(clamp(panVal, -0.82, 0.82), time);
  pan.connect(dest);

  const car = ctx.createOscillator();
  car.type = opts?.wave ?? 'sawtooth';
  car.frequency.setValueAtTime(freqHz, time);

  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.setValueAtTime(freqHz * (opts?.fmRatio ?? 2.0), time);

  const modG = ctx.createGain();
  modG.gain.setValueAtTime(freqHz * (0.26 + bright * 0.85), time);
  modG.gain.exponentialRampToValueAtTime(0.01, time + Math.min(durSec * 0.55, 0.42));

  if (opts?.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(5.3, time);
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0.0, time);
    lfoG.gain.linearRampToValueAtTime(freqHz * 0.008, time + Math.min(0.42, durSec * 0.45));
    lfo.connect(lfoG);
    lfoG.connect(car.frequency);
    lfo.start(time);
    lfo.stop(time + durSec + 0.04);
    tk.track(lfo);
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(2.5, time);
  lp.frequency.setValueAtTime(Math.min(6400, freqHz * (2.5 + bright * 4.5)), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(240, freqHz * 1.3), time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.007);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  mod.connect(modG);
  modG.connect(car.frequency);
  car.connect(lp);
  lp.connect(env);
  env.connect(pan);

  const sendDelay = opts?.sendDelay ?? 0.52;
  if (sendDelay > 0 && tk.delaySend) {
    const ds = ctx.createGain();
    ds.gain.setValueAtTime(sendDelay, time);
    env.connect(ds);
    ds.connect(tk.delaySend);
  }

  car.start(time);
  mod.start(time);
  car.stop(time + durSec + 0.04);
  mod.stop(time + durSec + 0.04);
  tk.track(car);
  tk.track(mod);
}

/** Warm VHS chorus synth pluck for Dreamwave / Chillwave */
function playDreamPluck(
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
  pan.pan.setValueAtTime(clamp(panVal, -0.8, 0.8), time);
  pan.connect(dest);

  // Subtle VHS tape pitch drift
  const drift = Math.sin(time * 1.7 + freqHz * 0.02) * 4.5;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(1.8, time);
  lp.frequency.setValueAtTime(Math.min(4200, freqHz * (2.8 + bright * 3.8)), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(260, freqHz * 1.35), time + durSec * 0.85);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  lp.connect(env);
  env.connect(pan);

  if (tk.delaySend) {
    const ds = ctx.createGain();
    ds.gain.setValueAtTime(0.54, time);
    env.connect(ds);
    ds.connect(tk.delaySend);
  }

  for (const det of [-9, 9]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqHz, time);
    osc.detune.setValueAtTime(det + drift, time);
    osc.connect(lp);
    osc.start(time);
    osc.stop(time + durSec + 0.04);
    tk.track(osc);
  }
}

/** Crystalline FM laser bell / orbital radar ping */
function playGlassBell(
  tk: SynthToolkit,
  time: number,
  freqHz: number,
  durSec: number,
  gain: number,
  panVal: number,
  dest: AudioNode,
  bright = 0.6,
  sendDelay = 0.55
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

  if (sendDelay > 0 && tk.delaySend) {
    const ds = ctx.createGain();
    ds.gain.setValueAtTime(sendDelay, time);
    env.connect(ds);
    ds.connect(tk.delaySend);
  }

  carrier.start(time);
  mod.start(time);
  carrier.stop(time + durSec + 0.03);
  mod.stop(time + durSec + 0.03);
  tk.track(carrier);
  tk.track(mod);
}

/** Lush breathing stereo analog Juno / Prophet poly-pad chord */
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
  const cutPeak = opts?.cutoffPeak ?? 980;
  const cutEnd = opts?.cutoffEnd ?? 320;
  const attack = Math.min(opts?.attackSec ?? 0.55, durSec * 0.45);
  const release = Math.min(opts?.releaseSec ?? 0.85, durSec * 0.45);
  const det = opts?.detuneCents ?? 9;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(opts?.q ?? 1.0, time);
  lp.frequency.setValueAtTime(cutStart, time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(90, cutPeak), time + attack + (durSec - attack) * 0.34);
  lp.frequency.exponentialRampToValueAtTime(Math.max(85, cutEnd), time + durSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + attack);
  env.gain.setValueAtTime(gain * 0.9, Math.max(time + attack + 0.02, time + durSec - release));
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
    const spread = notesHz.length > 1 ? ((i / (notesHz.length - 1)) * 2 - 1) * 0.6 : 0;
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

/** Deep cinematic sub-impact boom + velvety air thump for the major ignition beat */
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
  g.gain.linearRampToValueAtTime(gain, time + 0.012);
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
  lp.frequency.setValueAtTime(420, time);
  lp.frequency.exponentialRampToValueAtTime(75, time + 0.55);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, time);
  ng.gain.linearRampToValueAtTime(gain * 0.32, time + 0.018);
  ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.65);

  src.connect(lp);
  lp.connect(ng);
  ng.connect(dest);
  src.start(time, 0, 0.72);
  tk.track(src);
}

/** Rising filtered air/noise sweep into the major drop */
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
  bp.Q.setValueAtTime(2.2, time);
  bp.frequency.setValueAtTime(startHz, time);
  bp.frequency.exponentialRampToValueAtTime(peakHz, time + durSec * 0.9);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + durSec * 0.88);
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + durSec + 0.05);
  tk.track(src);
}

/** Soft rounded sub-bass pulse */
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
  g.gain.linearRampToValueAtTime(gain, time + (pitchDropFrom ? 0.004 : 0.035));
  g.gain.exponentialRampToValueAtTime(0.0001, time + durSec);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + durSec + 0.03);
  tk.track(osc);
}

// ============================================================================
// INTRO SCORES (0.00s -> ~7s, beat-locked to Cold Boot visual reveal)
// ============================================================================

export function scheduleVibeIntro(
  vibeId: MusicVibeId,
  tk: SynthToolkit,
  t0: number,
  now: number,
  scoreBus: AudioNode
): void {
  switch (vibeId) {
    case 'scifi':
      scheduleSciFiIntro(tk, t0, now, scoreBus);
      break;
    case 'synthwave':
      scheduleSynthwaveIntro(tk, t0, now, scoreBus);
      break;
    case 'darksynth':
      scheduleDarksynthIntro(tk, t0, now, scoreBus);
      break;
    case 'spacesynth':
      scheduleSpacesynthIntro(tk, t0, now, scoreBus);
      break;
    case 'dreamwave':
      scheduleDreamwaveIntro(tk, t0, now, scoreBus);
      break;
    case 'cyberambient':
      scheduleCyberAmbientIntro(tk, t0, now, scoreBus);
      break;
  }
}

/** 1) SCI-FI — HYPERION SIGNAL (C# Dorian · 108 BPM): Cosmic FM arps & CS-80 brass -> 4.644s Hyperion Ignition */
function scheduleSciFiIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.13889;
  const beat = step * 4;
  const b0 = 0.2;

  if (t0 + 2.45 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [69.3, 138.59, 207.65], Math.max(0.2, t0 + 2.45 - sT), 0.16, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 180,
      cutoffPeak: 620,
      cutoffEnd: 280,
      attackSec: 0.9,
      detuneCents: 11,
      useDrive: true,
    });
    const pings = [554.37, 830.61, 659.25, 1108.73];
    for (let i = 0; i < 4; i++) {
      const cue = b0 + i * beat;
      if (t0 + cue >= now - 0.02) {
        playGlassBell(tk, Math.max(now, t0 + cue), pings[i], 1.3, 0.075 + i * 0.012, i % 2 === 0 ? -0.45 : 0.45, scoreBus, 0.72, 0.65);
      }
    }
  }

  const riseStart = b0 + beat * 4;
  const arp = [277.18, 329.63, 415.3, 493.88, 554.37, 659.25, 830.61];
  for (let i = 0; i < 14; i++) {
    const cue = riseStart + i * step;
    if (t0 + cue + 0.12 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 13;
    const hz = arp[i % arp.length] * (i >= 7 ? 1.5 : 1.0);
    playSciFiLead(tk, ct, hz, 0.26, 0.08 + prog * 0.07, ((i % 5) - 2) * 0.25, scoreBus, {
      fmRatio: 3.0,
      bright: 0.35 + prog * 0.6,
      sendDelay: 0.58,
    });
    if (i % 4 === 0) {
      playSoftSub(tk, ct, i < 8 ? 69.3 : 61.74, 0.42, 0.25 + prog * 0.1, scoreBus, 140);
    }
  }
  if (t0 + 4.38 > now) {
    const sT = Math.max(now, t0 + riseStart);
    playAirSwell(tk, sT, Math.max(0.2, t0 + 4.38 - sT), 380, 2600, 0.055, scoreBus);
  }

  const drop = 4.644;
  if (t0 + 7.2 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 7.2 - tRes);
    if (t0 + drop >= now - 0.03) {
      playCinemaImpact(tk, tRes, 118, 34.65, 2.4, 0.46, scoreBus);
      playGlassBell(tk, tRes, 1108.73, 2.0, 0.095, -0.35, scoreBus, 0.85, 0.65);
      playGlassBell(tk, tRes + 0.05, 830.61, 2.0, 0.085, 0.35, scoreBus, 0.8, 0.65);
    }
    playCosmicBrass(tk, tRes, [69.3, 138.59, 164.81, 207.65, 246.94, 311.13], dur, 0.26, scoreBus, {
      attackSec: 0.12,
      cutoffPeak: 2200,
      bright: true,
    });
  }

  const bloom = 5.2;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playSoftSub(tk, ct, 69.3, 0.5, 0.26, scoreBus, 130);
    [554.37, 659.25, 830.61].forEach((hz, idx) => {
      playSciFiLead(tk, ct + idx * 0.07, hz, 0.9, 0.095, (idx - 1) * 0.36, scoreBus, {
        fmRatio: 2.0,
        bright: 0.78,
        sendDelay: 0.62,
        vibrato: true,
      });
    });
  }
}

/** 2) SYNTHWAVE — NEON DIE (E Minor · 118 BPM): Retro 80s analog bass + gated snare -> 4.268s Outrun Drop */
function scheduleSynthwaveIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.12712;
  const beat = step * 4;
  const b0 = 0.2;

  if (t0 + 2.26 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [82.41, 164.81, 196.0, 246.94, 329.63], Math.max(0.2, t0 + 2.26 - sT), 0.18, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 260,
      cutoffPeak: 920,
      cutoffEnd: 420,
      attackSec: 0.85,
      detuneCents: 10,
    });
  }

  const riseStart = b0 + beat * 4;
  for (let i = 0; i < 14; i++) {
    const cue = riseStart + i * step;
    if (t0 + cue + 0.1 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 13;
    const bHz = i < 8 ? 82.41 : i < 12 ? 65.41 : 73.42;
    const osc = tk.triggerAnalogPluck(ct, bHz, 420 + prog * 1950, 2.8, 0.115, 0.16 + prog * 0.08, scoreBus, 'sawtooth');
    tk.track(osc);

    if (i % 4 === 0) {
      playSynthKick(tk, ct, scoreBus, { startHz: 150, endHz: 46, gain: 0.3 + prog * 0.1 });
    }
    if (i === 4 || i === 12 || i === 13) {
      playRetroSnare(tk, ct, scoreBus, 'gated', 0.16 + prog * 0.08, i === 13 ? 0.2 : -0.15);
    }
  }
  if (t0 + 4.02 > now) {
    const sT = Math.max(now, t0 + riseStart);
    playAirSwell(tk, sT, Math.max(0.2, t0 + 4.02 - sT), 360, 2200, 0.06, scoreBus);
  }

  const drop = 4.268;
  if (t0 + 6.8 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 6.8 - tRes);
    if (t0 + drop >= now - 0.03) {
      playSynthKick(tk, tRes, scoreBus, { startHz: 165, endHz: 41.2, gain: 0.44, drive: true });
      playCinemaImpact(tk, tRes, 112, 41.2, 1.8, 0.36, scoreBus);
      playSciFiLead(tk, tRes, 659.25, 1.2, 0.13, -0.22, scoreBus, { bright: 0.8, sendDelay: 0.55, vibrato: true });
    }
    playPadChord(tk, tRes, [82.41, 164.81, 196.0, 246.94, 293.66, 369.99], dur, 0.23, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 1850,
      cutoffPeak: 1500,
      cutoffEnd: 320,
      attackSec: 0.05,
      detuneCents: 10,
    });
  }

  const bloom = 4.776;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playRetroSnare(tk, ct, scoreBus, 'gated', 0.25, 0);
    playSciFiLead(tk, ct + step * 2, 783.99, 0.45, 0.11, 0.28, scoreBus, { bright: 0.78, sendDelay: 0.5 });
  }
}

/** 3) DARKSYNTH — CYBER GRID (C Minor · 126 BPM): Distorted Tron Moog build -> 4.010s Cyberpunk Monolith Drop */
function scheduleDarksynthIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.11905;
  const beat = step * 4; // 0.47619s
  const b0 = 0.2;

  // Act 0-1 (0.20 - 2.105s): Menacing C1 sub drone + heavy metallic cyber pulses
  if (t0 + 2.12 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [65.41, 130.81, 196.0], Math.max(0.2, t0 + 2.12 - sT), 0.18, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 150,
      cutoffPeak: 480,
      cutoffEnd: 260,
      attackSec: 0.75,
      useDrive: true,
    });
    for (let b = 0; b < 4; b++) {
      const cue = b0 + b * beat;
      if (t0 + cue >= now - 0.02) {
        const ct = Math.max(now, t0 + cue);
        playSynthKick(tk, ct, scoreBus, { startHz: 145, endHz: 32.7, gain: 0.24 + b * 0.04, drive: true });
        tk.triggerStrike(ct, 2200 + b * 550, 3.6, 0.008, 0.08 + b * 0.02, scoreBus);
      }
    }
  }

  // Act 2 (2.105 - 3.77s): 14 steps of snarling distorted 16th-note cyberpunk bass & razor arp!
  const riseStart = b0 + beat * 4;
  const bassSeq = [65.41, 65.41, 130.81, 65.41, 98.0, 65.41, 77.78, 98.0, 51.91, 51.91, 103.83, 51.91, 77.78, 98.0];
  for (let i = 0; i < 14; i++) {
    const cue = riseStart + i * step;
    if (t0 + cue + 0.1 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 13;
    playDarkSynthBass(tk, ct, bassSeq[i], 0.115, 0.17 + prog * 0.09, 420 + prog * 2600, scoreBus, i % 2 === 0 ? -0.22 : 0.22);
    if (i % 4 === 0) {
      playSynthKick(tk, ct, scoreBus, { startHz: 170, endHz: 32.7, gain: 0.34 + prog * 0.1, drive: true });
    }
    if (i >= 10) {
      playRetroSnare(tk, ct, scoreBus, 'gated', 0.14 + prog * 0.1, i % 2 === 0 ? -0.2 : 0.2);
    }
  }
  if (t0 + 3.79 > now) {
    const sT = Math.max(now, t0 + riseStart);
    playAirSwell(tk, sT, Math.max(0.2, t0 + 3.79 - sT), 320, 2900, 0.07, scoreBus);
  }

  // Act 3 (4.010s = MAJOR DROP BEAT): Massive distorted Cm cyberpunk brass + kick impact!
  const drop = 4.01;
  if (t0 + 6.5 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 6.5 - tRes);
    if (t0 + drop >= now - 0.03) {
      playSynthKick(tk, tRes, scoreBus, { startHz: 180, endHz: 32.7, durSec: 0.26, gain: 0.46, drive: true });
      playCinemaImpact(tk, tRes, 130, 32.7, 2.0, 0.44, scoreBus);
      playSciFiLead(tk, tRes, 523.25, 0.85, 0.14, 0, scoreBus, { wave: 'sawtooth', fmRatio: 1.5, bright: 0.9, sendDelay: 0.5 });
    }
    playCosmicBrass(tk, tRes, [65.41, 98.0, 130.81, 155.56, 196.0], dur, 0.26, scoreBus, {
      attackSec: 0.04,
      cutoffPeak: 2500,
      bright: true,
    });
  }

  // Act 4 (4.486s = BLOOM BEAT): Heavy snare + bass pickup into 4.962s Bar 0!
  const bloom = 4.486;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playRetroSnare(tk, ct, scoreBus, 'gated', 0.26, 0);
    playDarkSynthBass(tk, ct + step * 2, 77.78, 0.12, 0.2, 2200, scoreBus, -0.2);
    playDarkSynthBass(tk, ct + step * 3, 98.0, 0.12, 0.22, 2600, scoreBus, 0.2);
  }
}

/** 4) SPACESYNTH — ORBITAL LASER (A Minor · 122 BPM): Retro-futuristic laser arps -> 4.134s Octave-Bass Drop */
function scheduleSpacesynthIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.12295;
  const beat = step * 4; // 0.4918s
  const b0 = 0.2;

  // Act 0-1 (0.20 - 2.167s): Sparkling high laser pings + cosmic A-minor pad
  if (t0 + 2.18 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [110.0, 164.81, 220.0, 261.63], Math.max(0.2, t0 + 2.18 - sT), 0.16, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 320,
      cutoffPeak: 1100,
      cutoffEnd: 460,
      attackSec: 0.75,
    });
    const pings = [440.0, 523.25, 659.25, 880.0];
    for (let b = 0; b < 4; b++) {
      const cue = b0 + b * beat;
      if (t0 + cue >= now - 0.02) {
        playGlassBell(tk, Math.max(now, t0 + cue), pings[b], 0.9, 0.085, b % 2 === 0 ? -0.35 : 0.35, scoreBus, 0.8, 0.6);
      }
    }
  }

  // Act 2 (2.167 - 3.89s): Bouncy octave-jumping Italo/Spacesynth bass + laser arpeggio build!
  const riseStart = b0 + beat * 4;
  const arp = [440.0, 523.25, 659.25, 880.0, 659.25, 523.25, 587.33, 659.25];
  for (let i = 0; i < 14; i++) {
    const cue = riseStart + i * step;
    if (t0 + cue + 0.1 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 13;
    const root = i < 8 ? 55.0 : 65.41;
    const bHz = i % 2 === 0 ? root : root * 2;
    const bOsc = tk.triggerAnalogPluck(ct, bHz, 550 + prog * 2100, 3.0, 0.11, 0.16 + prog * 0.07, scoreBus, 'sawtooth');
    tk.track(bOsc);

    playSciFiLead(tk, ct, arp[i % arp.length], 0.16, 0.075 + prog * 0.06, i % 2 === 0 ? -0.35 : 0.35, scoreBus, {
      wave: 'square',
      fmRatio: 2.0,
      bright: 0.5 + prog * 0.45,
      sendDelay: 0.48,
    });
    if (i % 4 === 0) {
      playSynthKick(tk, ct, scoreBus, { startHz: 158, endHz: 46, gain: 0.32 + prog * 0.08 });
    }
    if (i % 4 === 2) {
      playHiHat(tk, ct, 0.1, 0.075 + prog * 0.03, 0.28, scoreBus, 9200);
    }
  }
  if (t0 + 3.9 > now) {
    const sT = Math.max(now, t0 + riseStart);
    playAirSwell(tk, sT, Math.max(0.2, t0 + 3.9 - sT), 420, 3000, 0.06, scoreBus);
  }

  // Act 3 (4.134s = MAJOR DROP BEAT): Punchy 4-on-the-floor spacesynth drop + soaring heroic lead!
  const drop = 4.134;
  if (t0 + 6.7 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 6.7 - tRes);
    if (t0 + drop >= now - 0.03) {
      playSynthKick(tk, tRes, scoreBus, { startHz: 165, endHz: 46, gain: 0.44, drive: true });
      playCinemaImpact(tk, tRes, 115, 55.0, 1.5, 0.36, scoreBus);
      playSciFiLead(tk, tRes, 880.0, 0.9, 0.13, -0.25, scoreBus, { bright: 0.85, sendDelay: 0.58, vibrato: true });
    }
    playPadChord(tk, tRes, [110.0, 164.81, 220.0, 261.63, 329.63], dur, 0.22, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 1900,
      cutoffPeak: 1600,
      cutoffEnd: 380,
      attackSec: 0.04,
      detuneCents: 10,
    });
  }

  // Act 4 (4.626s = BLOOM BEAT): Disco-synth clap + laser pickup into 5.118s Bar 0!
  const bloom = 4.626;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playSynthKick(tk, ct, scoreBus, { startHz: 160, endHz: 46, gain: 0.4, drive: true });
    playRetroSnare(tk, ct, scoreBus, 'clap', 0.22, 0);
    playSciFiLead(tk, ct + step * 2, 783.99, 0.25, 0.11, 0.3, scoreBus, { bright: 0.8, sendDelay: 0.5 });
    playSciFiLead(tk, ct + step * 3, 880.0, 0.25, 0.12, -0.3, scoreBus, { bright: 0.85, sendDelay: 0.5 });
  }
}

/** 5) DREAMWAVE — STARLIGHT DRIFT (D# Minor · 96 BPM): Warm VHS sunset pads -> 4.575s Chillwave Bloom */
function scheduleDreamwaveIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.15625;
  const beat = step * 4; // 0.625s
  const b0 = 0.2;

  // Act 0-1 (0.20 - 2.70s): Nostalgic warm VHS chorus pad + glossy sunset plucks
  if (t0 + 2.72 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [77.78, 155.56, 185.0, 233.08, 277.18], Math.max(0.2, t0 + 2.72 - sT), 0.17, scoreBus, {
      wave: 'triangle',
      cutoffStart: 240,
      cutoffPeak: 820,
      cutoffEnd: 380,
      attackSec: 0.95,
      detuneCents: 12,
    });
    const notes = [311.13, 369.99, 466.16, 554.37];
    for (let i = 0; i < 4; i++) {
      const cue = b0 + i * beat;
      if (t0 + cue >= now - 0.02) {
        playDreamPluck(tk, Math.max(now, t0 + cue), notes[i], 1.1, 0.095, i % 2 === 0 ? -0.35 : 0.35, scoreBus, 0.55);
      }
    }
  }

  // Act 2 (2.70 - 4.26s): Dreamy chillwave arp build with warm dusty snare & sub pulse
  const riseStart = 2.7;
  const arp = [311.13, 369.99, 466.16, 554.37, 622.25, 554.37, 466.16, 622.25, 739.99, 622.25];
  for (let i = 0; i < 10; i++) {
    const cue = riseStart + i * step;
    if (t0 + cue + 0.14 <= now) continue;
    const ct = Math.max(now, t0 + cue);
    const prog = i / 9;
    playDreamPluck(tk, ct, arp[i], 0.55, 0.09 + prog * 0.055, ((i % 4) - 1.5) * 0.25, scoreBus, 0.45 + prog * 0.45);
    if (i % 4 === 0) {
      playSoftSub(tk, ct, i < 4 ? 77.78 : 61.74, 0.55, 0.25 + prog * 0.07, scoreBus, 130);
    }
    if (i === 4 || i === 8) {
      playRetroSnare(tk, ct, scoreBus, 'dusty', 0.14 + prog * 0.06, 0);
    }
  }
  if (t0 + 4.28 > now) {
    const sT = Math.max(now, t0 + riseStart);
    playAirSwell(tk, sT, Math.max(0.2, t0 + 4.28 - sT), 280, 1550, 0.048, scoreBus);
  }

  // Act 3 (4.575s = MAJOR DROP BEAT): Lush wide D#m9 VHS dreamwave bloom!
  const drop = 4.575;
  if (t0 + 7.35 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 7.35 - tRes);
    if (t0 + drop >= now - 0.03) {
      playCinemaImpact(tk, tRes, 108, 38.89, 2.2, 0.4, scoreBus);
      [466.16, 554.37, 739.99].forEach((hz, idx) => {
        playDreamPluck(tk, tRes + idx * 0.045, hz, 1.8, 0.11, (idx - 1) * 0.34, scoreBus, 0.78);
      });
    }
    playPadChord(tk, tRes, [77.78, 155.56, 185.0, 233.08, 277.18, 349.23], dur, 0.24, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 1380,
      cutoffPeak: 1180,
      cutoffEnd: 280,
      attackSec: 0.08,
      detuneCents: 13,
    });
  }

  // Act 4 (5.20s = BLOOM BEAT): Dusty sunset snare + warm echo into 5.825s Bar 0!
  const bloom = 5.2;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playRetroSnare(tk, ct, scoreBus, 'dusty', 0.2, 0);
    playDreamPluck(tk, ct + step * 2, 622.25, 0.9, 0.095, 0.3, scoreBus, 0.72);
  }
}

/** 6) DEEP SCI-FI — EVENT HORIZON (D Phrygian · 92 BPM): Cosmic gravity pulses -> 4.765s Alien Monolith Drop */
function scheduleCyberAmbientIntro(tk: SynthToolkit, t0: number, now: number, scoreBus: AudioNode): void {
  const step = 0.16304;
  const beat = step * 4; // 0.65217s
  const b0 = 0.2;

  // Act 0-1 (0.20 - 2.809s): Deep D1 cosmic void + distant orbital radar sonar pings
  if (t0 + 2.84 > now) {
    const sT = Math.max(now, t0 + b0);
    playPadChord(tk, sT, [73.42, 110.0, 146.83], Math.max(0.2, t0 + 2.84 - sT), 0.18, scoreBus, {
      wave: 'sawtooth',
      cutoffStart: 120,
      cutoffPeak: 420,
      cutoffEnd: 240,
      attackSec: 1.1,
      detuneCents: 12,
      useDrive: true,
    });
    const sonar = [587.33, 622.25, 880.0]; // D5, Eb5 (Phrygian tension!), A5
    for (let i = 0; i < 3; i++) {
      const cue = b0 + i * beat;
      if (t0 + cue >= now - 0.02) {
        playGlassBell(tk, Math.max(now, t0 + cue), sonar[i], 1.7, 0.075, i % 2 === 0 ? -0.45 : 0.45, scoreBus, 0.8, 0.72);
      }
    }
  }

  // Act 2 (2.809 - 4.44s): Slow pulsing gravity sub-beats + rising Phrygian alien brass swell!
  const riseStart = 2.809;
  for (let b = 0; b < 3; b++) {
    const cue = riseStart + b * beat;
    if (t0 + cue >= now - 0.02) {
      const ct = Math.max(now, t0 + cue);
      playSoftSub(tk, ct, b === 2 ? 77.78 : 73.42, 0.56, 0.28 + b * 0.06, scoreBus, 145);
      playGlassBell(tk, ct + step * 2, b === 2 ? 622.25 : 587.33, 0.9, 0.07 + b * 0.015, b % 2 === 0 ? 0.38 : -0.38, scoreBus, 0.75, 0.65);
    }
  }
  if (t0 + 4.46 > now) {
    const sT = Math.max(now, t0 + riseStart);
    const dur = Math.max(0.2, t0 + 4.46 - sT);
    playCosmicBrass(tk, sT, [73.42, 110.0, 155.56, 220.0], dur, 0.25, scoreBus, {
      attackSec: 1.15,
      cutoffPeak: 1580,
      detuneCents: 11,
    });
    playAirSwell(tk, sT, dur, 180, 1420, 0.06, scoreBus);
  }

  // Act 3 (4.765s = MAJOR DROP BEAT): Colossal deep-space gravity impact + wide D-Phrygian monolith chord!
  const drop = 4.765;
  if (t0 + 7.5 > now) {
    const tRes = Math.max(now, t0 + drop);
    const dur = Math.max(0.5, t0 + 7.5 - tRes);
    if (t0 + drop >= now - 0.03) {
      playCinemaImpact(tk, tRes, 118, 36.71, 2.7, 0.5, scoreBus);
      playGlassBell(tk, tRes, 1174.66, 2.3, 0.09, -0.35, scoreBus, 0.85, 0.72);
      playGlassBell(tk, tRes + 0.06, 880.0, 2.2, 0.08, 0.35, scoreBus, 0.8, 0.72);
    }
    playCosmicBrass(tk, tRes, [36.71, 73.42, 110.0, 146.83, 155.56, 220.0, 293.66], dur, 0.28, scoreBus, {
      attackSec: 0.14,
      cutoffPeak: 1950,
      bright: true,
      detuneCents: 11,
    });
  }

  // Act 4 (5.417s = BLOOM BEAT): Deep gravity echo + harmonic shimmer into 6.070s Bar 0!
  const bloom = 5.417;
  if (t0 + bloom >= now - 0.02) {
    const ct = Math.max(now, t0 + bloom);
    playSoftSub(tk, ct, 36.71, 0.75, 0.32, scoreBus, 108);
    playSciFiLead(tk, ct, 587.33, 1.3, 0.09, 0, scoreBus, { fmRatio: 2.5, bright: 0.7, sendDelay: 0.7, vibrato: true });
  }
}

// ============================================================================
// INFINITE BACKGROUND LOOPS (16-bar / 4-phrase evolving Sci-Fi & Synthwave)
// ============================================================================

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
    case 'scifi':
      stepSciFiLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'synthwave':
      stepSynthwaveLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'darksynth':
      stepDarksynthLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'spacesynth':
      stepSpacesynthLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'dreamwave':
      stepDreamwaveLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
    case 'cyberambient':
      stepCyberAmbientLoop(tk, stepIdx, cycleIdx, time, stepSec, bgmDest, depthNorm);
      break;
  }
}

/** 1) SCI-FI — HYPERION SIGNAL LOOP (C# Dorian · 108 BPM): Cosmic brass swells, FM arps & Blade Runner lead */
function stepSciFiLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4;
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  const roots = [69.3, 61.74, 92.5, 51.91];
  const pads: readonly (readonly number[])[] = [
    [138.59, 164.81, 207.65, 246.94, 311.13], // C#m9
    [123.47, 155.56, 185.0, 207.65, 277.18], // B6/9
    [92.5, 138.59, 164.81, 207.65, 233.08], // F#9
    [103.83, 123.47, 155.56, 185.0, 233.08], // G#m9
  ];

  if (inBar === 0) {
    if (phrase === 1 || phrase === 2) {
      playCosmicBrass(tk, time, pads[bar], barDur * 1.04, phrase === 2 ? 0.21 : 0.17, dest, {
        attackSec: 0.55,
        cutoffPeak: 1450 + depthNorm * 950,
        bright: phrase === 2,
      });
    } else {
      playPadChord(tk, time, pads[bar], barDur * 1.1, 0.2, dest, {
        wave: 'sawtooth',
        cutoffStart: 280,
        cutoffPeak: 860 + depthNorm * 620,
        cutoffEnd: 260,
        attackSec: 0.65,
        detuneCents: 11,
        useDrive: true,
      });
    }
  }

  if (inBar === 0 || (phrase !== 3 && (inBar === 6 || inBar === 12))) {
    playSoftSub(tk, time, roots[bar], stepSec * 4.8, inBar === 0 ? 0.3 : 0.21, dest, inBar === 0 ? roots[bar] * 2.0 : undefined);
  }
  if ((phrase === 1 || phrase === 2) && (inBar === 0 || inBar === 8)) {
    playSynthKick(tk, time, dest, { startHz: 125, endHz: 38, durSec: 0.22, gain: 0.22, clickGain: 0.04 });
  }

  const arpGrid: readonly (readonly number[])[] = [
    [277.18, 0, 415.3, 493.88, 0, 554.37, 415.3, 0, 659.25, 0, 554.37, 493.88, 0, 415.3, 329.63, 0],
    [246.94, 0, 369.99, 415.3, 0, 493.88, 369.99, 0, 554.37, 0, 493.88, 415.3, 0, 369.99, 311.13, 0],
    [185.0, 0, 277.18, 329.63, 0, 415.3, 329.63, 0, 466.16, 0, 415.3, 329.63, 0, 277.18, 233.08, 0],
    [207.65, 0, 311.13, 369.99, 0, 466.16, 369.99, 0, 493.88, 0, 415.3, 369.99, 0, 311.13, 246.94, 0],
  ];
  const aHz = arpGrid[bar][inBar];
  if (aHz > 0) {
    playSciFiLead(tk, time, aHz, 0.28, phrase === 3 ? 0.08 : 0.115, Math.sin(step * 0.7) * 0.55, dest, {
      fmRatio: 3.0,
      bright: 0.45 + (phrase === 2 ? 0.35 : 0.1) + depthNorm * 0.3,
      sendDelay: 0.58,
    });
  }

  if (phrase === 2) {
    const lead: readonly (readonly number[])[] = [
      [830.61, 0, 0, 0, 0, 0, 739.99, 0, 659.25, 0, 0, 0, 554.37, 0, 0, 0],
      [739.99, 0, 0, 0, 0, 0, 659.25, 0, 554.37, 0, 0, 0, 493.88, 0, 0, 0],
      [659.25, 0, 0, 0, 0, 0, 739.99, 0, 830.61, 0, 0, 0, 932.33, 0, 0, 0],
      [830.61, 0, 0, 0, 0, 0, 659.25, 0, 622.25, 0, 0, 0, 554.37, 0, 0, 0],
    ];
    const lHz = lead[bar][inBar];
    if (lHz > 0) {
      playSciFiLead(tk, time, lHz, stepSec * 5.2, 0.115, bar % 2 === 0 ? -0.32 : 0.32, dest, {
        fmRatio: 2.0,
        bright: 0.78,
        sendDelay: 0.64,
        vibrato: true,
      });
    }
  }

  if (inBar === 4 || inBar === 12) {
    playHiHat(tk, time, 0.032, 0.04, inBar === 4 ? -0.45 : 0.45, dest, 10200);
  }
  if (inBar === 0 && (phrase === 0 || phrase === 3) && bar % 2 === 0) {
    playGlassBell(tk, time, bar === 0 ? 1108.73 : 932.33, 1.8, 0.055 + depthNorm * 0.025, 0.42, dest, 0.78, 0.65);
  }
}

/** 2) SYNTHWAVE — NEON DIE LOOP (E Minor · 118 BPM): Driving 16th analog bass, gated snare & 80s neon lead */
function stepSynthwaveLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4;
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  const bassRoots = [82.41, 65.41, 98.0, 73.42];
  const junoChords: readonly (readonly number[])[] = [
    [164.81, 196.0, 246.94, 329.63], // Em
    [130.81, 164.81, 196.0, 246.94], // Cmaj7
    [146.83, 196.0, 246.94, 293.66], // G
    [146.83, 185.0, 220.0, 293.66], // D
  ];

  const root = bassRoots[bar];
  const octaveJump = (phrase === 1 || phrase === 2) && inBar % 4 === 2;
  const bHz = octaveJump ? root * 2 : root;
  const cut = (phrase === 2 ? 1450 : phrase === 3 ? 640 : 1050) + (inBar % 4 === 0 ? 380 : 0) + depthNorm * 650;
  const bOsc = tk.triggerAnalogPluck(
    time,
    bHz,
    cut,
    2.6,
    stepSec * 0.92,
    phrase === 3 ? 0.14 : 0.18,
    dest,
    'sawtooth',
    inBar % 2 === 0 ? -5 : 5
  );
  tk.track(bOsc);

  if (inBar === 0 || inBar === 8 || (phrase === 2 && inBar === 10)) {
    playSynthKick(tk, time, dest, { startHz: 158, endHz: 44, durSec: 0.22, gain: 0.38, drive: true });
  }
  if (phrase !== 3 && (inBar === 4 || inBar === 12)) {
    playRetroSnare(tk, time, dest, 'gated', 0.22, 0);
  }
  if (inBar % 2 === 0) {
    playHiHat(tk, time, inBar % 4 === 2 ? 0.08 : 0.03, inBar % 4 === 2 ? 0.07 : 0.04, 0.28, dest, 9000);
  }

  if (inBar === 0) {
    playPadChord(tk, time, junoChords[bar], barDur * 1.06, phrase === 3 ? 0.2 : 0.17, dest, {
      wave: 'sawtooth',
      cutoffStart: 420,
      cutoffPeak: (phrase === 2 ? 1450 : 950) + depthNorm * 650,
      cutoffEnd: 380,
      attackSec: 0.35,
      detuneCents: 11,
    });
  }

  if (phrase === 1 || phrase === 2) {
    const leadBars: readonly (readonly number[])[] = [
      [659.25, 0, 587.33, 0, 493.88, 0, 0, 0, 659.25, 0, 783.99, 0, 739.99, 0, 0, 0],
      [659.25, 0, 523.25, 0, 493.88, 0, 0, 0, 523.25, 0, 659.25, 0, 587.33, 0, 0, 0],
      [783.99, 0, 739.99, 0, 659.25, 0, 0, 0, 587.33, 0, 659.25, 0, 493.88, 0, 0, 0],
      [587.33, 0, 659.25, 0, 739.99, 0, 0, 0, 880.0, 0, 739.99, 0, 659.25, 0, 0, 0],
    ];
    const lHz = leadBars[bar][inBar];
    if (lHz > 0) {
      playSciFiLead(tk, time, lHz, stepSec * 2.4, phrase === 2 ? 0.12 : 0.085, bar % 2 === 0 ? -0.28 : 0.28, dest, {
        fmRatio: 2.0,
        bright: 0.72 + depthNorm * 0.22,
        sendDelay: 0.56,
        vibrato: phrase === 2,
      });
    }
  }
}

/** 3) DARKSYNTH — CYBER GRID LOOP (Cm -> Ab -> Fm -> G): Snarling Tron bass, heavy punch & razor minor arps */
function stepDarksynthLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4; // 0: Snarling Grid, 1: Razor Arp Enters, 2: Full Cyberpunk Peak, 3: Dark Breakdown
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Cm -> Ab -> Fm -> G7sus4
  const bassSeqs: readonly (readonly number[])[] = [
    [65.41, 65.41, 130.81, 65.41, 65.41, 98.0, 65.41, 77.78, 65.41, 65.41, 130.81, 65.41, 98.0, 77.78, 65.41, 98.0],
    [51.91, 51.91, 103.83, 51.91, 51.91, 77.78, 51.91, 98.0, 51.91, 51.91, 103.83, 51.91, 77.78, 98.0, 103.83, 77.78],
    [43.65, 43.65, 87.31, 43.65, 43.65, 65.41, 43.65, 77.78, 43.65, 43.65, 87.31, 43.65, 65.41, 77.78, 87.31, 65.41],
    [49.0, 49.0, 98.0, 49.0, 49.0, 73.42, 49.0, 77.78, 49.0, 49.0, 98.0, 73.42, 77.78, 98.0, 116.54, 98.0],
  ];

  // 1) Distorted 16th-note Darksynth Moog bassline
  const bHz = bassSeqs[bar][inBar];
  const breathe = 0.5 + 0.5 * Math.sin(((cycle * 64 + step) / 32) * Math.PI * 2);
  const cut = (phrase === 2 ? 1650 : phrase === 3 ? 620 : 1120) + breathe * 780 + depthNorm * 820;
  playDarkSynthBass(tk, time, bHz, stepSec * 0.94, phrase === 3 ? 0.145 : 0.195, cut, dest, inBar % 2 === 0 ? -0.18 : 0.18);

  // 2) Heavy Cyberpunk kick & big gated snare
  if (inBar % 4 === 0) {
    playSynthKick(tk, time, dest, { startHz: 178, endHz: 32.7, durSec: 0.24, gain: 0.42, drive: true });
  }
  if (phrase !== 3 && (inBar === 4 || inBar === 12)) {
    playRetroSnare(tk, time, dest, 'gated', 0.24, 0);
  }
  if (inBar % 2 === 1) {
    playHiHat(tk, time, 0.04, phrase === 2 ? 0.08 : 0.05, inBar % 4 === 1 ? -0.35 : 0.35, dest, 9600);
  }

  // 3) Dark brass monolith chords on bar downbeat
  if (inBar === 0) {
    const chords: readonly (readonly number[])[] = [
      [130.81, 155.56, 196.0, 261.63], // Cm
      [103.83, 155.56, 207.65, 261.63], // Ab
      [87.31, 130.81, 174.61, 207.65], // Fm
      [98.0, 146.83, 196.0, 233.08], // Gm/G
    ];
    playCosmicBrass(tk, time, chords[bar], barDur * 1.02, phrase === 2 ? 0.22 : 0.16, dest, {
      attackSec: 0.22,
      cutoffPeak: (phrase === 2 ? 2100 : 1250) + depthNorm * 700,
      bright: phrase === 2,
    });
  }

  // 4) Razor-sharp 16th-note Tron cyberpunk arp in Phrases 1 & 2
  if (phrase === 1 || phrase === 2) {
    const arpBars: readonly (readonly number[])[] = [
      [523.25, 0, 622.25, 0, 783.99, 0, 622.25, 523.25, 587.33, 0, 622.25, 0, 783.99, 0, 932.33, 783.99],
      [415.3, 0, 523.25, 0, 622.25, 0, 523.25, 415.3, 466.16, 0, 523.25, 0, 622.25, 0, 783.99, 622.25],
      [349.23, 0, 415.3, 0, 523.25, 0, 415.3, 349.23, 392.0, 0, 415.3, 0, 523.25, 0, 622.25, 523.25],
      [392.0, 0, 466.16, 0, 587.33, 0, 466.16, 392.0, 466.16, 0, 587.33, 0, 622.25, 0, 783.99, 622.25],
    ];
    const aHz = arpBars[bar][inBar];
    if (aHz > 0) {
      playSciFiLead(tk, time, aHz, stepSec * 1.35, phrase === 2 ? 0.11 : 0.08, inBar % 4 === 0 ? -0.38 : 0.38, dest, {
        wave: 'sawtooth',
        fmRatio: 1.5,
        bright: 0.72 + depthNorm * 0.24,
        sendDelay: 0.5,
      });
    }
  }
}

/** 4) SPACESYNTH — ORBITAL LASER LOOP (Am -> F -> C -> G): Octave-jumping analog bass, laser arps & heroic synth */
function stepSpacesynthLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4; // 0: Octave Bass+Arp, 1: Heroic Lead, 2: Full Spacesynth Anthem, 3: Cosmic Cruise
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // Am -> F -> C -> G
  const roots = [55.0, 43.65, 65.41, 49.0];
  const pads: readonly (readonly number[])[] = [
    [110.0, 164.81, 220.0, 261.63], // Am
    [87.31, 130.81, 174.61, 220.0], // F
    [130.81, 164.81, 196.0, 261.63], // C
    [98.0, 146.83, 196.0, 246.94], // G
  ];

  // 1) Classic bouncy octave-jumping Spacesynth bassline (lo-hi-lo-hi every 8th/16th!)
  const root = roots[bar];
  const isHigh = inBar % 2 === 1;
  const bHz = isHigh ? root * 2 : root;
  const cut = (phrase === 2 ? 1750 : phrase === 3 ? 720 : 1250) + (isHigh ? 420 : 0) + depthNorm * 650;
  const bOsc = tk.triggerAnalogPluck(time, bHz, cut, 3.0, stepSec * 0.9, 0.175, dest, 'sawtooth', isHigh ? 6 : -6);
  tk.track(bOsc);

  // 2) Crisp 4-on-the-floor disco-synth kick, claps on 2 & 4, shimmering offbeat hats
  if (inBar % 4 === 0) {
    playSynthKick(tk, time, dest, { startHz: 162, endHz: 46, durSec: 0.21, gain: 0.38, drive: true });
  }
  if (phrase !== 3 && (inBar === 4 || inBar === 12)) {
    playRetroSnare(tk, time, dest, 'clap', 0.2, 0);
  }
  if (inBar % 4 === 2) {
    playHiHat(tk, time, 0.13, phrase === 3 ? 0.06 : 0.095, 0.26, dest, 9200);
  } else if (inBar % 2 === 1) {
    playHiHat(tk, time, 0.028, 0.04, -0.32, dest, 10400);
  }

  // 3) Glossy retro-futuristic pad bed
  if (inBar === 0) {
    playPadChord(tk, time, pads[bar], barDur * 1.06, 0.17, dest, {
      wave: 'sawtooth',
      cutoffStart: 460,
      cutoffPeak: 1250 + depthNorm * 650,
      cutoffEnd: 400,
      attackSec: 0.3,
      detuneCents: 10,
    });
  }

  // 4) Sparkling 16th-note laser arpeggio
  const arpChords: readonly (readonly number[])[] = [
    [440.0, 523.25, 659.25, 880.0], // Am
    [349.23, 440.0, 523.25, 698.46], // F
    [523.25, 659.25, 783.99, 1046.5], // C
    [392.0, 493.88, 587.33, 783.99], // G
  ];
  if (inBar % 2 === 0 || phrase === 2) {
    const hz = arpChords[bar][inBar % 4];
    playGlassBell(tk, time, hz, 0.26, phrase === 3 ? 0.055 : 0.08, Math.sin(step * 0.9) * 0.52, dest, 0.72, 0.5);
  }

  // 5) Soaring heroic Spacesynth lead melody in Phrases 1 & 2
  if (phrase === 1 || phrase === 2) {
    const lead: readonly (readonly number[])[] = [
      [880.0, 0, 0, 783.99, 0, 0, 659.25, 0, 0, 0, 523.25, 0, 587.33, 0, 659.25, 0],
      [698.46, 0, 0, 659.25, 0, 0, 523.25, 0, 0, 0, 440.0, 0, 523.25, 0, 659.25, 0],
      [783.99, 0, 0, 880.0, 0, 0, 1046.5, 0, 0, 0, 880.0, 0, 783.99, 0, 659.25, 0],
      [783.99, 0, 0, 659.25, 0, 0, 587.33, 0, 0, 0, 493.88, 0, 587.33, 0, 659.25, 0],
    ];
    const lHz = lead[bar][inBar];
    if (lHz > 0) {
      playSciFiLead(tk, time, lHz, stepSec * 2.8, phrase === 2 ? 0.12 : 0.09, bar % 2 === 0 ? -0.25 : 0.25, dest, {
        wave: 'square',
        fmRatio: 2.0,
        bright: 0.78 + depthNorm * 0.2,
        sendDelay: 0.58,
        vibrato: true,
      });
    }
  }
}

/** 5) DREAMWAVE — STARLIGHT DRIFT LOOP (D#m9 -> Bmaj9 -> F#maj9 -> C#6/9): Warm VHS chillwave & sunset plucks */
function stepDreamwaveLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4; // 0: Warm Sunset, 1: Pluck Melody, 2: Full Nostalgic Glow, 3: Tape Haze
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // D#m9 -> Bmaj9 -> F#maj9 -> C#6/9
  const roots = [77.78, 61.74, 92.5, 69.3];
  const chords: readonly (readonly number[])[] = [
    [155.56, 185.0, 233.08, 277.18, 349.23], // D#m9
    [123.47, 155.56, 185.0, 233.08, 277.18], // Bmaj9
    [185.0, 233.08, 277.18, 311.13, 369.99], // F#maj9
    [138.59, 185.0, 207.65, 233.08, 311.13], // C#6/9
  ];

  // 1) Lush VHS-detuned warm chorus pad on bar downbeat
  if (inBar === 0) {
    playPadChord(tk, time, chords[bar], barDur * 1.12, 0.22, dest, {
      wave: 'sawtooth',
      cutoffStart: 320,
      cutoffPeak: (phrase === 2 ? 1150 : 820) + depthNorm * 580,
      cutoffEnd: 290,
      attackSec: 0.65,
      detuneCents: 13,
    });
  }

  // 2) Warm pulsing analog sub-bass (8th-note chillwave bounce)
  if (inBar === 0 || inBar === 6 || inBar === 8 || inBar === 14) {
    const bOsc = tk.triggerAnalogPluck(
      time,
      roots[bar],
      380 + depthNorm * 320,
      1.8,
      stepSec * 2.2,
      inBar === 0 ? 0.23 : 0.17,
      dest,
      'sawtooth'
    );
    tk.track(bOsc);
  }

  // 3) Soft laid-back 80s kick & dusty snare
  if (inBar === 0 || inBar === 10) {
    playSynthKick(tk, time, dest, { startHz: 136, endHz: 46, durSec: 0.24, gain: 0.32, clickGain: 0.045 });
  }
  if (phrase !== 3 && (inBar === 4 || inBar === 12)) {
    playRetroSnare(tk, time, dest, 'dusty', 0.19, 0);
  }
  if (inBar % 2 === 0) {
    playHiHat(tk, time, 0.045, inBar % 4 === 2 ? 0.05 : 0.028, inBar % 4 === 0 ? -0.28 : 0.28, dest, 7600);
  }

  // 4) Glossy sunset chorus arp plucks
  const plucks: readonly (readonly number[])[] = [
    [466.16, 0, 554.37, 0, 0, 622.25, 0, 554.37, 0, 466.16, 0, 0, 369.99, 0, 466.16, 0],
    [466.16, 0, 554.37, 0, 0, 739.99, 0, 622.25, 0, 554.37, 0, 0, 466.16, 0, 369.99, 0],
    [554.37, 0, 622.25, 0, 0, 739.99, 0, 622.25, 0, 554.37, 0, 0, 466.16, 0, 554.37, 0],
    [466.16, 0, 554.37, 0, 0, 622.25, 0, 554.37, 0, 466.16, 0, 0, 415.3, 0, 369.99, 0],
  ];
  const pHz = plucks[bar][inBar];
  if (pHz > 0) {
    playDreamPluck(tk, time, pHz, 0.65, phrase === 3 ? 0.075 : 0.105, Math.sin(step * 0.6) * 0.48, dest, 0.52 + depthNorm * 0.3);
  }

  // 5) Dreamy high vibrato synth melody in Phrase 2
  if (phrase === 2 && (inBar === 0 || inBar === 6 || inBar === 12)) {
    const mel: readonly (readonly number[])[] = [
      [739.99, 622.25, 554.37],
      [622.25, 554.37, 466.16],
      [739.99, 830.61, 739.99],
      [622.25, 554.37, 466.16],
    ];
    const mIdx = inBar === 0 ? 0 : inBar === 6 ? 1 : 2;
    playSciFiLead(tk, time, mel[bar][mIdx], stepSec * 4.5, 0.095, bar % 2 === 0 ? 0.3 : -0.3, dest, {
      wave: 'triangle',
      fmRatio: 2.0,
      bright: 0.65,
      sendDelay: 0.62,
      vibrato: true,
    });
  }
}

/** 6) DEEP SCI-FI — EVENT HORIZON LOOP (D Phrygian · 92 BPM): Gravity sub-pulses, alien brass & radar pings */
function stepCyberAmbientLoop(
  tk: SynthToolkit,
  step: number,
  cycle: number,
  time: number,
  stepSec: number,
  dest: AudioNode,
  depthNorm: number
): void {
  const phrase = cycle % 4; // 0: Orbital Monolith, 1: Shimmering Clouds, 2: Alien Brass Climax, 3: Deep Void
  const bar = Math.floor(step / 16);
  const inBar = step % 16;
  const barDur = stepSec * 16;

  // D Phrygian: Dm -> Eb(maj7) -> Cm -> Dm(add9)
  const roots = [36.71, 38.89, 32.7, 36.71];
  const chords: readonly (readonly number[])[] = [
    [73.42, 110.0, 146.83, 174.61, 220.0], // Dm
    [77.78, 116.54, 146.83, 196.0, 233.08], // Ebmaj7
    [65.41, 98.0, 130.81, 155.56, 196.0], // Cm
    [73.42, 110.0, 146.83, 155.56, 220.0], // Dm(b9) tension
  ];

  // 1) Colossal evolving cosmic brass / monolith pad
  if (inBar === 0) {
    if (phrase === 2) {
      playCosmicBrass(tk, time, chords[bar], barDur * 1.06, 0.24, dest, {
        attackSec: 0.72,
        cutoffPeak: 1750 + depthNorm * 950,
        bright: true,
        detuneCents: 11,
      });
    } else {
      playPadChord(tk, time, chords[bar], barDur * 1.15, phrase === 3 ? 0.18 : 0.22, dest, {
        wave: 'sawtooth',
        cutoffStart: 190,
        cutoffPeak: (phrase === 1 ? 820 : 560) + depthNorm * 680,
        cutoffEnd: 180,
        attackSec: 0.9,
        detuneCents: 12,
        useDrive: true,
      });
    }
  }

  // 2) Deep gravity heartbeat sub-pulse
  if (inBar === 0 || (phrase !== 3 && inBar === 8)) {
    playSoftSub(tk, time, roots[bar] * 2, stepSec * 6.5, inBar === 0 ? 0.34 : 0.24, dest, inBar === 0 ? 112 : undefined);
  }

  // 3) Slow echoing orbital radar sonar pings
  const radar: readonly (readonly number[])[] = [
    [587.33, 0, 0, 0, 0, 0, 880.0, 0, 0, 0, 622.25, 0, 0, 0, 0, 0],
    [622.25, 0, 0, 0, 0, 0, 783.99, 0, 0, 0, 587.33, 0, 0, 0, 0, 0],
    [523.25, 0, 0, 0, 0, 0, 622.25, 0, 0, 0, 783.99, 0, 0, 0, 0, 0],
    [587.33, 0, 0, 0, 0, 0, 880.0, 0, 0, 0, 1174.66, 0, 0, 0, 0, 0],
  ];
  const rHz = radar[bar][inBar];
  if (rHz > 0) {
    playGlassBell(tk, time, rHz, 1.8, phrase === 3 ? 0.065 : 0.09, inBar === 0 ? -0.45 : 0.45, dest, 0.78 + depthNorm * 0.2, 0.72);
  }

  // 4) Ethereal sci-fi telemetry synth voice in Phrases 1 & 2
  if ((phrase === 1 || phrase === 2) && (inBar === 4 || inBar === 12)) {
    const notes = [293.66, 311.13, 392.0, 440.0];
    const hz = notes[(bar + (inBar === 12 ? 1 : 0)) % notes.length];
    playSciFiLead(tk, time, hz, stepSec * 4.2, 0.085, inBar === 4 ? -0.35 : 0.35, dest, {
      fmRatio: 3.0,
      bright: 0.55 + depthNorm * 0.35,
      sendDelay: 0.68,
      vibrato: true,
    });
  }
}
