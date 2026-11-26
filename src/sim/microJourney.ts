import { getGlyphGrid } from './storyEngine';

export interface MicroChapter {
  index: number;
  id: string;
  shortLabel: string;
  targetZoom: number; // 0..4 shader uZoom
  magLabel: string;
  featureSize: string;
  timeUs: string;
  durationSec: number;
  yaw: number;
  pitch: number;
  headline: (ch: string, bin: string) => string;
  caption: (ch: string, bin: string, ascii: number) => string;
}

export const MICRO_CHAPTERS: MicroChapter[] = [
  {
    index: 0,
    id: 'die',
    shortLabel: 'Silicon Die',
    targetZoom: 0.0,
    magLabel: '10×',
    featureSize: '12 mm',
    timeUs: '0 µs',
    durationSec: 4.5,
    yaw: -0.35,
    pitch: 0.88,
    headline: (ch, bin) => `You pressed '${ch}' — Entering the Silicon Die (${bin})`,
    caption: (ch, bin, ascii) =>
      `A tiny electrical pulse encoding ASCII ${ascii} (${bin}) hits the iridescent silicon wafer, sweeping past golden bond pads along microscopic power spines toward Efficiency Core 0.`,
  },
  {
    index: 1,
    id: 'striations',
    shortLabel: 'Micro-Striations',
    targetZoom: 1.0,
    magLabel: '2,500×',
    featureSize: '60 µm',
    timeUs: '24 µs',
    durationSec: 4.6,
    yaw: 0.25,
    pitch: 0.78,
    headline: (ch) => `Inside E-Core 0 — Thousands of Parallel Micro-Striations`,
    caption: (ch) =>
      `What looked like a solid block breaks open into tightly packed SRAM cache banks and hair-thin metallic bus rails—half the width of a human hair—guiding '${ch}' deeper into silicon.`,
  },
  {
    index: 2,
    id: 'canyons',
    shortLabel: 'Metal Canyons',
    targetZoom: 2.0,
    magLabel: '250,000×',
    featureSize: '800 nm',
    timeUs: '58 µs',
    durationSec: 5.0,
    yaw: 0.54,
    pitch: 0.56,
    headline: (ch) => `3D Sculpted Metal Routing & Vertical Vias`,
    caption: (ch) =>
      `At 250,000×, rainbow optics give way to electron-microscope metallic depth: layered silver-titanium traces turn 90° over shadowed silicon trenches as '${ch}' plunges straight down a circular vertical via.`,
  },
  {
    index: 3,
    id: 'grid',
    shortLabel: 'Nano Cell Grid',
    targetZoom: 3.0,
    magLabel: '8,000,000×',
    featureSize: '25 nm',
    timeUs: '95 µs',
    durationSec: 5.0,
    yaw: 0.14,
    pitch: 0.92,
    headline: (ch, bin) => `Repeating Nanometer Cells Latch '${ch}' as ${bin}`,
    caption: (ch, bin) =>
      `Irregular routing resolves into an endless repeating checkerboard of walled nanometer cell modules. The center 8 cells physically latch '${ch}'s exact 8-bit binary fingerprint: ${bin}.`,
  },
  {
    index: 4,
    id: 'fins',
    shortLabel: '3nm Fin Array',
    targetZoom: 4.0,
    magLabel: '100,000,000×',
    featureSize: '3 nm',
    timeUs: '120 µs',
    durationSec: 5.6,
    yaw: 0.34,
    pitch: 0.64,
    headline: (ch) => `Peak Magnification — 3 nm Fin & Nanosheet Switch`,
    caption: () =>
      `Inside one walled nanometer module resting on granular crystalline silicon: parallel 3 nm fin/nanosheet comb arrays (~11 silicon atoms wide). Applying 0.72V to the gold gate sends charge waves surging across the channel.`,
  },
  {
    index: 5,
    id: 'output',
    shortLabel: 'Pixels Out',
    targetZoom: 0.12,
    magLabel: '14×',
    featureSize: '10 mm',
    timeUs: '400 µs',
    durationSec: 5.4,
    yaw: 0.36,
    pitch: 0.74,
    headline: (ch) => `'${ch}' Materializes on Display — 0.0004 Seconds Total`,
    caption: (ch) =>
      `Pulling back out across 100,000,000× of scale: the GPU rasterizes '${ch}' and the Display Engine illuminates its exact pixel grid on your screen—all completed in 400 microseconds.`,
  },
];

export function formatMagnification(uZoom: number): { magText: string; sizeText: string; dialDeg: number } {
  const z = Math.max(0, Math.min(4, uZoom));
  // Smooth log interpolation: 10x -> 2,500x -> 250,000x -> 8,000,000x -> 100,000,000x
  const magKnots = [10, 2500, 250_000, 8_000_000, 100_000_000];
  const nmKnots = [12_000_000, 60_000, 800, 25, 3];

  const i0 = Math.min(3, Math.floor(z));
  const f = z - i0;
  const mag = Math.exp(Math.log(magKnots[i0]) * (1 - f) + Math.log(magKnots[i0 + 1]) * f);
  const nm = Math.exp(Math.log(nmKnots[i0]) * (1 - f) + Math.log(nmKnots[i0 + 1]) * f);

  let magText: string;
  if (mag >= 1_000_000) magText = `${(mag / 1_000_000).toFixed(mag >= 10_000_000 ? 0 : 1)}M×`;
  else if (mag >= 1_000) magText = `${(mag / 1_000).toFixed(mag >= 10_000 ? 0 : 1)}K×`;
  else magText = `${Math.round(mag)}×`;

  let sizeText: string;
  if (nm >= 1_000_000) sizeText = `${(nm / 1_000_000).toFixed(1)} mm`;
  else if (nm >= 1_000) sizeText = `${Math.round(nm / 1_000)} µm`;
  else if (nm >= 10) sizeText = `${Math.round(nm)} nm`;
  else sizeText = `${nm.toFixed(1)} nm`;

  // Smooth rotating dial angle matching the microscope reticle!
  const dialDeg = z * 68;
  return { magText, sizeText, dialDeg };
}

export class MicroJourneyState {
  public char = 'A';
  public ascii = 65;
  public binary = '01000001';
  public glyph: number[][] = getGlyphGrid('A');

  public chapterIdx = 0;
  public elapsed = 0;
  public playing = true;

  public pulsePhase = 0;
  public gateOn = 1.0;
  public manualGate: boolean | null = null;
  public activeBitIdx = 0;

  public onChapterChange?: (idx: number) => void;

  public setKey(raw: string): void {
    const ch = raw.length === 1 && raw.trim() ? raw.toUpperCase() : 'A';
    this.char = ch;
    this.ascii = ch.charCodeAt(0) & 0xff;
    this.binary = this.ascii.toString(2).padStart(8, '0');
    this.glyph = getGlyphGrid(ch);
    this.playing = true;
    this.jumpTo(0);
  }

  public jumpTo(idx: number): void {
    const c = Math.max(0, Math.min(MICRO_CHAPTERS.length - 1, idx));
    this.chapterIdx = c;
    this.elapsed = 0;
    this.onChapterChange?.(c);
  }

  public update(dt: number): void {
    const ch = MICRO_CHAPTERS[this.chapterIdx];
    this.elapsed += dt;
    this.pulsePhase = (this.pulsePhase + dt * 0.42) % 1;

    if (this.playing && this.elapsed >= ch.durationSec) {
      if (this.chapterIdx < MICRO_CHAPTERS.length - 1) {
        this.jumpTo(this.chapterIdx + 1);
      } else {
        this.elapsed = ch.durationSec;
      }
    }

    if (this.manualGate !== null) {
      const target = this.manualGate ? 1.0 : 0.0;
      this.gateOn += (target - this.gateOn) * Math.min(1, dt * 8);
    } else {
      // In Chapter 4 (3nm Fin Array), keep energized most of the time with crisp rhythmic bit pulses
      this.activeBitIdx = Math.floor(this.elapsed / 0.75) % 8;
      const bitVal = this.binary[this.activeBitIdx] === '1' ? 1.0 : 0.0;
      const target = this.chapterIdx === 4 ? (this.elapsed < 1.8 ? 1.0 : bitVal) : bitVal;
      this.gateOn += (target - this.gateOn) * Math.min(1, dt * 8);
    }
  }
}
