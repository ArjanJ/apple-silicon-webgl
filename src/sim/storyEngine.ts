/**
 * Real 5×7 pixel bitmap font for ASCII characters so Chapter 7 ("Pixels on Screen")
 * genuinely rasterizes the EXACT letter the user pressed on their keyboard!
 */
const FONT_5X7: Record<string, string[]> = {
  A: ['..#..', '.#.#.', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '####.', '#...#', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
};

export function getGlyphGrid(ch: string): number[][] {
  const key = ch.toUpperCase();
  const rows = FONT_5X7[key] ?? FONT_5X7['A'];
  return rows.map((r) => r.split('').map((c) => (c === '#' ? 1 : 0)));
}

export interface JourneyChapter {
  index: number;
  id: string;
  shortTitle: string;
  scaleU: number;
  scaleLabel: string;
  realTimeUs: string; // real-world microsecond timestamp in the 400 µs keystroke journey!
  durationSec: number; // cinematic duration when auto-playing story
  color: string;
  cameraYaw: number;
  cameraPitch: number;
  cameraFocus: [number, number, number];
  headline: (ch: string, bin: string, ascii: number) => string;
  narration: (ch: string, bin: string, ascii: number) => string;
  detailBadge: (ch: string, bin: string, ascii: number) => string;
}

export const JOURNEY_CHAPTERS: JourneyChapter[] = [
  {
    index: 0,
    id: 'keystroke',
    shortTitle: '1. Keystroke',
    scaleU: 0.05,
    scaleLabel: '28 mm · SoC Package',
    realTimeUs: '0 µs',
    durationSec: 4.2,
    color: '#4eff9b',
    cameraYaw: -0.45,
    cameraPitch: 0.62,
    cameraFocus: [-0.4, 0, 0.4],
    headline: (ch, bin) => `You pressed '${ch}' — Electrical Interrupt (${bin})`,
    narration: (ch, bin, ascii) =>
      `Closing the physical switch under '${ch}' fires a tiny voltage pulse over USB into the bottom edge of the chip package, encoding ASCII ${ascii} as the 8-bit binary wave ${bin}.`,
    detailBadge: (ch, bin, ascii) => `USB HID PACKET · '${ch}' = ASCII ${ascii} = ${bin}`,
  },
  {
    index: 1,
    id: 'ecore',
    shortTitle: '2. E-Core',
    scaleU: 1.0,
    scaleLabel: '10 mm · Silicon Die',
    realTimeUs: '18 µs',
    durationSec: 4.5,
    color: '#4cc9ff',
    cameraYaw: -0.14,
    cameraPitch: 0.96,
    cameraFocus: [-0.3, 0, 0.25],
    headline: (ch) => `I/O Wakes Efficiency Core 0 to Decode '${ch}'`,
    narration: (ch) =>
      `The titanium lid opens to reveal 28 billion transistors. The I/O Controller routes your signal along microscopic copper traces straight into Efficiency Core 0—leaving the big Performance Cores asleep to save battery.`,
    detailBadge: () => `ROUTED: USB / I/O → INTERCONNECT FABRIC → E-CORE 0`,
  },
  {
    index: 2,
    id: 'copper',
    shortTitle: '3. Copper City',
    scaleU: 2.0,
    scaleLabel: '200 µm · M10 → M1',
    realTimeUs: '42 µs',
    durationSec: 4.6,
    color: '#ffb347',
    cameraYaw: 0.58,
    cameraPitch: 0.44,
    cameraFocus: [0, 0, 0],
    headline: (ch) => `Diving Down the 10-Story Copper Interconnect City`,
    narration: (ch, bin) =>
      `Inside E-Core 0, '${ch}' (${bin}) races across gleaming multi-story copper highways (Layers M10 down to M1), plunging down vertical copper "vias" like elevators to reach the logic gates on the silicon floor.`,
    detailBadge: () => `METAL STACK M10 → M1 · SIGNAL SPEED ~1/3 SPEED OF LIGHT`,
  },
  {
    index: 3,
    id: 'logic',
    shortTitle: '4. 8-Bit Logic',
    scaleU: 3.0,
    scaleLabel: '2 µm · Logic Cells',
    realTimeUs: '75 µs',
    durationSec: 4.6,
    color: '#29f2d8',
    cameraYaw: 0.22,
    cameraPitch: 0.68,
    cameraFocus: [0, 0, 0],
    headline: (ch, bin) => `8 Logic Cells Latch '${ch}' as ${bin}`,
    narration: (ch, bin) =>
      `On the silicon floor, 8 microscopic FinFET register cells flip simultaneously into '${ch}'s exact binary fingerprint: ${bin}. Bright cyan cells hold a '1' (0.72V); dark cells hold a '0' (0V).`,
    detailBadge: (ch, bin) => `8-BIT REGISTER LATCH · [ ${bin.split('').join(' ')} ]`,
  },
  {
    index: 4,
    id: 'transistor',
    shortTitle: '5. 3nm Switch',
    scaleU: 4.0,
    scaleLabel: '3 nm · GAA Transistor',
    realTimeUs: '110 µs',
    durationSec: 5.4,
    color: '#29f2d8',
    cameraYaw: 0.3,
    cameraPitch: 0.3,
    cameraFocus: [0, 0.15, 0],
    headline: (ch) => `Inside One 3nm Transistor Switching a '1' for '${ch}'`,
    narration: () =>
      `This is the smallest working switch in modern silicon: 3 stacked horizontal silicon ribbons wrapped inside a gold metal Gate collar. Hit 0.72V on the Gate, and electrons physically surge from Source to Drain!`,
    detailBadge: () => `3nm GATE-ALL-AROUND NANOSHEET · 25,000× THINNER THAN HAIR`,
  },
  {
    index: 5,
    id: 'atoms',
    shortTitle: '5b. Atoms',
    scaleU: 5.0,
    scaleLabel: '0.54 nm · Crystal Lattice',
    realTimeUs: '112 µs',
    durationSec: 4.4,
    color: '#7ab2ff',
    cameraYaw: 0.56,
    cameraPitch: 0.36,
    cameraFocus: [0, 0, 0],
    headline: () => `Inside the 3nm Channel — Only ~11 Silicon Atoms Wide`,
    narration: () =>
      `Zooming inside the middle nanosheet ribbon reveals the literal diamond-cubic Silicon crystal lattice. At 3 nanometers, we are right at the edge of quantum physics—electrons drift right through these atomic bonds.`,
    detailBadge: () => `DIAMOND-CUBIC Si CRYSTAL · 0.543 nm LATTICE SPACING`,
  },
  {
    index: 6,
    id: 'ramgpu',
    shortTitle: '6. RAM → GPU',
    scaleU: 1.0,
    scaleLabel: '10 mm · Memory & GPU',
    realTimeUs: '240 µs',
    durationSec: 4.8,
    color: '#c96bff',
    cameraYaw: 0.16,
    cameraPitch: 0.92,
    cameraFocus: [0.35, 0, -0.1],
    headline: (ch) => `Saved to Unified RAM → 16-Core GPU Paints '${ch}'`,
    narration: (ch) =>
      `Pulling back out to the full die: E-Core 0 writes '${ch}' through the 24 MB Cache into Unified Memory (LPDDR5X), then all 16 GPU Cores light up in parallel to turn the font outline of '${ch}' into crisp pixels.`,
    detailBadge: (ch) => `E-CORE 0 → 24MB CACHE → LPDDR5X RAM → 16-CORE GPU`,
  },
  {
    index: 7,
    id: 'pixels',
    shortTitle: '7. Pixels Out',
    scaleU: 0.35,
    scaleLabel: '28 mm · Display Output',
    realTimeUs: '400 µs',
    durationSec: 5.5,
    color: '#ff6e82',
    cameraYaw: 0.42,
    cameraPitch: 0.52,
    cameraFocus: [0.8, 0.6, 0.8],
    headline: (ch) => `'${ch}' Appears on Your Screen — 0.0004 Seconds Total`,
    narration: (ch) =>
      `The Display Engine beams the finished pixel grid of '${ch}' straight out to your monitor. Everything you just watched—from finger to 3nm silicon atoms to glowing pixels—actually took 400 microseconds!`,
    detailBadge: (ch) => `DISPLAY ENGINE SCANOUT · '${ch}' RASTERIZED IN 0.4 ms`,
  },
];

export class KeystrokeStoryEngine {
  public activeChar = 'A';
  public activeAscii = 65;
  public activeBinary = '01000001';
  public activeGlyph: number[][] = getGlyphGrid('A');
  public typedHistory = 'A';

  public chapterIndex = 0;
  public chapterElapsed = 0;
  public autoPlaying = true;
  public storyMode = true; // true = guided cinematic journey, false = free roam

  // Per-block live normalized load [0..1]
  public blockLoad: Record<string, number> = {
    pCores: 0.04,
    eCores: 0.12,
    gpu: 0.06,
    npu: 0.03,
    slc: 0.08,
    ramL: 0.06,
    ramR: 0.06,
    io: 0.08,
    media: 0.12,
  };

  // Active routed highway segment progress for the cinematic comet trail!
  // Each hop has: from, to, color, startT, endT (in chapter-normalized 0..1)
  public activeHops: { pathKey: string; progress: number; color: number; intensity: number }[] = [];

  // Transistor Gate voltage (0..0.72V)
  public gateVoltage = 0.72;
  public manualGate: boolean | null = null;
  public activeBitIndex = 0; // 0..7 stepping through activeBinary

  // Holographic glyph reveal progress (0..1 during Chapter 7!)
  public hologramReveal = 0;

  public onChapterChange?: (idx: number) => void;

  public triggerCharacter(rawChar: string, startStory = true): void {
    const ch = rawChar.length === 1 && rawChar.trim() ? rawChar : 'A';
    this.activeChar = ch;
    this.activeAscii = ch.charCodeAt(0) & 0xff;
    this.activeBinary = this.activeAscii.toString(2).padStart(8, '0');
    this.activeGlyph = getGlyphGrid(ch);
    this.typedHistory = (this.typedHistory + ch).slice(-18);

    if (startStory) {
      this.storyMode = true;
      this.autoPlaying = true;
      this.jumpToChapter(0);
    }
  }

  public jumpToChapter(idx: number): void {
    const clamped = Math.max(0, Math.min(JOURNEY_CHAPTERS.length - 1, idx));
    this.chapterIndex = clamped;
    this.chapterElapsed = 0;
    this.hologramReveal = clamped === 7 ? 0.05 : 0;
    this.onChapterChange?.(clamped);
  }

  public update(dt: number): void {
    const chap = JOURNEY_CHAPTERS[this.chapterIndex];
    this.chapterElapsed += dt;

    // Auto-advance chapters smoothly when autoPlaying is ON
    if (this.storyMode && this.autoPlaying && this.chapterElapsed >= chap.durationSec) {
      if (this.chapterIndex < JOURNEY_CHAPTERS.length - 1) {
        this.jumpToChapter(this.chapterIndex + 1);
      } else {
        // Hold softly on final chapter with gentle loop-ready pulse
        this.chapterElapsed = chap.durationSec;
      }
    }

    const t = Math.min(1, this.chapterElapsed / Math.max(0.1, chap.durationSec));

    // Reset target loads cleanly per chapter so ONLY the blocks participating in THIS chapter light up!
    // (Zero random noise — pure crystal-clear visual storytelling!)
    const targets: Record<string, number> = {
      pCores: 0.04,
      eCores: 0.08,
      gpu: 0.06,
      npu: 0.03,
      slc: 0.06,
      ramL: 0.05,
      ramR: 0.05,
      io: 0.06,
      media: 0.08,
    };

    this.activeHops = [];

    switch (this.chapterIndex) {
      case 0: {
        // Chapter 1: Keystroke hits USB/I/O pin edge -> lights up USB/I/O block!
        targets.io = 0.35 + Math.sin(t * Math.PI) * 0.65;
        targets.eCores = t > 0.55 ? (t - 0.55) * 1.4 : 0.08;
        this.activeHops.push({
          pathKey: 'pin_to_io',
          progress: (this.chapterElapsed * 0.65) % 1,
          color: 0x4eff9b,
          intensity: 1.0,
        });
        if (t > 0.35) {
          this.activeHops.push({
            pathKey: 'io_to_ecore',
            progress: ((this.chapterElapsed - 0.9) * 0.55 + 1) % 1,
            color: 0x4eff9b,
            intensity: 0.85,
          });
        }
        break;
      }
      case 1: {
        // Chapter 2: Signal races from USB/I/O -> E-Core 0!
        targets.io = 0.65;
        targets.eCores = 1.0;
        targets.slc = t > 0.5 ? 0.4 : 0.1;
        this.activeHops.push({
          pathKey: 'io_to_ecore',
          progress: (this.chapterElapsed * 0.65) % 1,
          color: 0x4cc9ff,
          intensity: 1.0,
        });
        break;
      }
      case 2: {
        // Chapter 3: Diving down the Copper City inside E-Core 0
        targets.eCores = 1.0;
        break;
      }
      case 3: {
        // Chapter 4: 8-bit Logic Cells latching exact binary of activeChar
        targets.eCores = 0.95;
        break;
      }
      case 4:
      case 5: {
        // Chapter 5 / 5b: Inside 3nm Transistor & Silicon Atoms
        targets.eCores = 0.95;
        break;
      }
      case 6: {
        // Chapter 6: E-Core -> 24MB Cache -> Unified RAM -> 16-Core GPU!
        targets.eCores = 0.65;
        targets.slc = 0.95;
        targets.ramL = t < 0.6 ? 0.95 : 0.45;
        targets.ramR = t > 0.3 ? 0.85 : 0.3;
        targets.gpu = t > 0.35 ? 1.0 : 0.3;
        this.activeHops.push({
          pathKey: 'ecore_to_slc',
          progress: (this.chapterElapsed * 0.72) % 1,
          color: 0x4cc9ff,
          intensity: 0.95,
        });
        this.activeHops.push({
          pathKey: 'slc_to_ramL',
          progress: ((this.chapterElapsed * 0.72) + 0.33) % 1,
          color: 0x5e8bff,
          intensity: 0.95,
        });
        this.activeHops.push({
          pathKey: 'slc_to_gpu',
          progress: ((this.chapterElapsed * 0.72) + 0.66) % 1,
          color: 0x29f2d8,
          intensity: 1.0,
        });
        break;
      }
      case 7: {
        // Chapter 7: 16-Core GPU -> Display Engine -> Holographic Letter Materializes!
        targets.gpu = 0.95;
        targets.media = 1.0;
        this.hologramReveal = Math.min(1, this.chapterElapsed / 2.2);
        this.activeHops.push({
          pathKey: 'gpu_to_media',
          progress: (this.chapterElapsed * 0.8) % 1,
          color: 0xff6e82,
          intensity: 1.0,
        });
        break;
      }
    }

    const lerpRate = Math.min(1, dt * 5.5);
    for (const k of Object.keys(this.blockLoad)) {
      this.blockLoad[k] += (targets[k] - this.blockLoad[k]) * lerpRate;
    }

    // Drive the 3nm Transistor Gate cleanly with the active character's real binary bits!
    // In Chapter 5, cycle slowly through a crisp OFF -> ON -> OFF demonstration OR the character's bits!
    if (this.manualGate !== null) {
      const tv = this.manualGate ? 0.72 : 0.0;
      this.gateVoltage += (tv - this.gateVoltage) * Math.min(1, dt * 8);
    } else {
      // Step through the 8 bits of activeChar every 0.85s (and guarantee '1' is illuminated prominently in Ch 5!)
      const bitIdx = Math.floor(this.chapterElapsed / 0.85) % 8;
      this.activeBitIndex = bitIdx;
      const bitVal = this.activeBinary[bitIdx] === '1' ? 1 : 0;
      const tv = bitVal === 1 ? 0.72 : 0.0;
      this.gateVoltage += (tv - this.gateVoltage) * Math.min(1, dt * 9);
    }
  }
}
