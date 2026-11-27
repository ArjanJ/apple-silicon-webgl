import { STAGE_RATIOS, WORLD0_FM_PER_UNIT } from '../engine/worlds';

/**
 * Physically accurate optical magnification, live camera-calibrated Zeiss/FEI scale bar,
 * and scale-landmark formatter anchored to the 1:1 US Quarter Dollar (24.26 mm = 6.93 World-0 units)
 * across the continuous 14.5-order-of-magnitude Euclidean chain (`STAGE_RATIOS`):
 *  -2.4 => ~0.9×   · 28 cm     (Wide macro — 1:1 life-size Apple Silicon & Quarter on studio mat)
 *  -1.0 => 3×      · 75 mm     (Package — Apple Silicon package beside 24.26 mm US Quarter)
 *   0.0 => 10×     · 23 mm     (Die — live telemetry-accurate Apple Silicon floorplan)
 *   1.0 => 1.8K×   · 134 µm    (Grid — Top BEOL Global Metal M12–M16 VDD/VSS Power & Clock Mesh)
 *   2.0 => 27K×    · 8.9 µm    (Routing — Intermediate BEOL Copper Damascene M4–M9 & Vias)
 *   3.0 => 240K×   · 990 nm    (Logic — FEOL Standard-Cell Rows, VDD/VSS Rails, PMOS/NMOS)
 *   4.0 => 1.9M×   · 124 nm    (Cell — Pure Uniform GAA Nanosheet CMOS Standard Cell)
 *   5.0 => 15M×    · 15.5 nm   (Gate — 12 nm Gate · 5 nm GAA Ribbon · TiN/W · HfO2/SiO2 · SiN)
 *   6.0 => 154M×   · 1.55 nm   (Lattice — Undoped (100) Silicon Crystal a = 0.543 nm · Bloch Waves)
 *   7.0 => 770M×   · 310 pm    (Atom — Silicon-28 (14Si) · 111 pm Covalent Radius · 3sp3 Orbitals)
 *   8.0 => 23T×    · 10.5 fm   (Nucleus — Oblate 28Si Nucleus · 3.1 fm Radius · 35,800× Vacuum Plunge)
 *   9.0 => 192T×   · 1.24 fm   (Proton — Single Proton · 0.84 fm Charge Radius · uud Quarks & Gluons)
 */

/** Standard W3C 96-DPI CSS Reference Pixel = 1/96 inch = 0.2645833 mm in femtometers */
const CSS_REF_PX_FM = 264_583_333_333;

const LOG_CUM_SCALE: number[] = [0];
for (let i = 0; i < STAGE_RATIOS.length; i++) {
  LOG_CUM_SCALE.push(LOG_CUM_SCALE[i] + Math.log(STAGE_RATIOS[i]));
}

const SCALE_BADGES: readonly { center: number; half: number; label: string; analogy: string }[] = [
  {
    center: 1.0,
    half: 0.36,
    label: '134 µm FOV · BEOL Global Power & Clock Grid (M12–M16)',
    analogy: 'Roughly the width of a single human hair',
  },
  {
    center: 2.0,
    half: 0.36,
    label: '8.9 µm FOV · Copper Damascene Routing (M4–M9) & Vias',
    analogy: 'About the diameter of a single red blood cell (7–8 µm)',
  },
  {
    center: 3.0,
    half: 0.36,
    label: '990 nm FOV · FEOL Standard-Cell Logic Rows · 198 nm Cell Height',
    analogy: 'Shorter than a single wavelength of near-infrared light',
  },
  {
    center: 4.0,
    half: 0.38,
    label: '124 nm FOV · Uniform GAA Nanosheet Cell · 12.7 nm Gate',
    analogy: 'The physical scale of a single virus particle',
  },
  {
    center: 5.0,
    half: 0.38,
    label: '12.7 nm Gate · 5 nm GAA Ribbon · HfO₂/SiO₂ High-k · Undoped Si',
    analogy: '6× wider than a single strand of DNA (2 nm)',
  },
  {
    center: 6.0,
    half: 0.38,
    label: '0.543 nm · (100) Silicon Crystal · Amorphous SiO₂/HfO₂ · Bloch Waves',
    analogy: 'Less than twice the width of a water molecule',
  },
  {
    center: 7.0,
    half: 0.32,
    label: '111 pm · Silicon-28 (¹⁴Si) · 1s² 2s² 2p⁶ 3sp³ Wavefunctions',
    analogy: '35,800× wider than the nucleus hidden at its center',
  },
  {
    center: 7.52,
    half: 0.22,
    label: '99.9999999999% Empty Space · True 35,800× Plunge to the Nucleus',
    analogy: 'If this atom were a stadium, its nucleus is a marble at midfield',
  },
  {
    center: 8.0,
    half: 0.32,
    label: '3.1 fm · Oblate ²⁸Si Nucleus · 14P + 14N · Pion Exchange Field',
    analogy: '99.97% of the atom’s mass packed into a trillionth of its volume',
  },
  {
    center: 9.0,
    half: 0.42,
    label: '0.84 fm · Single Proton · uud Color-Charge Quarks · Gluon Flux',
    analogy: 'Bound by the strong force at ~16 tons of tension inside your chip',
  },
];

export interface OpticalScaleInput {
  fmPerCssPx: number;
  fovHeightFm: number;
}

function formatPhysicalLength(fm: number): string {
  const fmt = (v: number) => (v >= 10 || Math.abs(v - Math.round(v)) < 1e-4 ? `${Math.round(v)}` : v.toFixed(1));
  if (fm >= 1e14) return `${fmt(fm / 1e13)} cm`;
  if (fm >= 1e12) return `${fmt(fm / 1e12)} mm`;
  if (fm >= 1e9) return `${fmt(fm / 1e9)} µm`;
  if (fm >= 1e6) return `${fmt(fm / 1e6)} nm`;
  if (fm >= 1e3) return `${fmt(fm / 1e3)} pm`;
  if (fm >= 1) return `${fmt(fm)} fm`;
  return `${fmt(fm * 1e3)} am`;
}

/**
 * Compute an optically calibrated Zeiss/FEI scale bar on clean 1 / 2 / 5 engineering decades
 * directly from the live camera projection (`fmPerCssPx` = exact femtometers per CSS pixel at the focal plane).
 */
function computeScaleBar(fmPerCssPx: number): { label: string; px: number } {
  const safeFmPerPx = Math.max(1e-6, fmPerCssPx);
  const targetFm = safeFmPerPx * 92;
  const exp10 = Math.floor(Math.log10(Math.max(targetFm, 1e-6)));
  const base = Math.pow(10, exp10);
  const candidates = [0.5 * base, 1 * base, 2 * base, 5 * base, 10 * base];

  let bestFm = candidates[1];
  let bestScore = Infinity;
  for (const c of candidates) {
    const px = c / safeFmPerPx;
    if (px >= 50 && px <= 148) {
      const score = Math.abs(px - 92);
      if (score < bestScore) {
        bestScore = score;
        bestFm = c;
      }
    }
  }
  const px = Math.max(46, Math.min(152, bestFm / safeFmPerPx));
  return { label: formatPhysicalLength(bestFm), px };
}

/** Analytical fallback matching SiliconEngine's reference desktop camera (`1440×900`) before first frame */
function estimateOpticalScale(z: number): OpticalScaleInput {
  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const zClamped = Math.max(0, Math.min(9.0, z));
  const idx = Math.min(STAGE_RATIOS.length - 1, Math.floor(zClamped));
  const f = zClamped >= 9.0 ? 1.0 : zClamped - idx;
  const logCamScale = LOG_CUM_SCALE[idx] * (1 - f) + LOG_CUM_SCALE[idx + 1] * f;
  const world0Scale = Math.exp(logCamScale);

  const outT = Math.max(0, -z);
  const macroOut = smoothstep(0.0, -0.85, z);
  const subatomicBackoff = smoothstep(7.6, 8.2, z);
  const zoomBlend = smoothstep(0.0, 0.95, z);
  const heroDist = 11.2;
  const dist =
    z < 0
      ? heroDist * Math.pow(2.55, outT) * (1.0 + 0.25 * macroOut)
      : heroDist + (5.4 - heroDist) * zoomBlend + subatomicBackoff * 1.15;

  const fovHeightFm = (dist / (1.68 * world0Scale)) * WORLD0_FM_PER_UNIT;
  const refCssH = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900;
  return { fmPerCssPx: fovHeightFm / refCssH, fovHeightFm };
}

export function formatMagnification(
  uZoom: number,
  optical?: OpticalScaleInput
): {
  magText: string;
  sizeText: string;
  dialDeg: number;
  bracketText: string | null;
  bracketAnalogy: string | null;
  bracketOpacity: number;
  scaleBarLabel: string;
  scaleBarPx: number;
} {
  const z = Math.max(-2.4, Math.min(9.0, uZoom));
  const { fmPerCssPx, fovHeightFm } = optical ?? estimateOpticalScale(z);
  const mag = CSS_REF_PX_FM / Math.max(1e-6, fmPerCssPx);
  const fm = fovHeightFm;

  let magText: string;
  if (mag >= 999_500_000_000) magText = `${Math.round(mag / 1_000_000_000_000)}T×`;
  else if (mag >= 999_500_000) magText = `${(mag / 1_000_000_000).toFixed(mag >= 10_000_000_000 ? 0 : 1)}B×`;
  else if (mag >= 999_500) magText = `${(mag / 1_000_000).toFixed(mag >= 10_000_000 ? 0 : 1)}M×`;
  else if (mag >= 999.5) magText = `${(mag / 1_000).toFixed(mag >= 10_000 ? 0 : 1)}K×`;
  else if (mag >= 9.95) magText = `${Math.round(mag)}×`;
  else magText = `${mag.toFixed(1)}×`;

  let sizeText: string;
  if (fm >= 100_000_000_000_000) sizeText = `${(fm / 10_000_000_000_000).toFixed(1)} cm`;
  else if (fm >= 20_000_000_000_000) sizeText = `${Math.round(fm / 1_000_000_000_000)} mm`;
  else if (fm >= 1_000_000_000_000) sizeText = `${(fm / 1_000_000_000_000).toFixed(1)} mm`;
  else if (fm >= 10_000_000_000) sizeText = `${Math.round(fm / 1_000_000_000)} µm`;
  else if (fm >= 1_000_000_000) sizeText = `${(fm / 1_000_000_000).toFixed(1)} µm`;
  else if (fm >= 10_000_000) sizeText = `${Math.round(fm / 1_000_000)} nm`;
  else if (fm >= 500_000) sizeText = `${(fm / 1_000_000).toFixed(2)} nm`;
  else if (fm >= 1_000) sizeText = `${Math.round(fm / 1_000)} pm`;
  else if (fm >= 10) sizeText = `${Math.round(fm)} fm`;
  else sizeText = `${fm.toFixed(2)} fm`;

  let bracketText: string | null = null;
  let bracketAnalogy: string | null = null;
  let bracketOpacity = 0;
  if (z <= -0.58) {
    bracketText = '24.26 mm · US Quarter Dollar · 1:1 Physical Scale';
    bracketAnalogy = 'Over 2,000,000 transistor gates fit side-by-side across this coin';
    bracketOpacity = Math.max(0, Math.min(1, (-0.58 - z) / 0.24));
  } else {
    for (let i = 0; i < SCALE_BADGES.length; i++) {
      const b = SCALE_BADGES[i];
      const dist = Math.abs(z - b.center);
      if (dist < b.half) {
        bracketText = b.label;
        bracketAnalogy = b.analogy;
        bracketOpacity = Math.max(0, Math.min(1, (b.half - dist) / (b.half * 0.55)));
        break;
      }
    }
  }

  const dialDeg = (z + 1) * 28.8;
  const bar = computeScaleBar(fmPerCssPx);
  return {
    magText,
    sizeText,
    dialDeg,
    bracketText,
    bracketAnalogy,
    bracketOpacity,
    scaleBarLabel: bar.label,
    scaleBarPx: bar.px,
  };
}
