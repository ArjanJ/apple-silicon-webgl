/**
 * Physically accurate logarithmic magnification, calibrated optical scale bar & landmark formatter
 * across zoom [-2.4..9.0]:
 *  -2.4 => 0.25x    · 26.0 cm   (Wide macro — pocket-size Apple Silicon & Quarter on studio mat)
 *  -1.0 => 1.0x     · 72 mm     (Package — 1:1 Apple Silicon package next to a 24.26 mm US Quarter)
 *   0.0 => 4x       · 21.0 mm   (Die — live telemetry-accurate Apple Silicon floorplan)
 *   1.0 => 1.0K x   · 120 um    (Grid — Top BEOL Global Metal M12–M16 VDD/VSS Power & Clock Mesh)
 *   2.0 => 40K x    · 3.0 um    (Routing — Intermediate BEOL Copper Damascene M4–M9 & Vias)
 *   3.0 => 200K x   · 600 nm    (Logic — FEOL Standard-Cell Rows, VDD/VSS Rails, PMOS/NMOS)
 *   4.0 => 1.0M x   · 120 nm    (Cell — Pure Uniform GAA Nanosheet CMOS Standard Cell)
 *   5.0 => 10M x    · 12 nm     (Gate — 12 nm Gate · 5 nm GAA Ribbon · TiN/W · HfO2/SiO2 · SiN)
 *   6.0 => 220M x   · 0.54 nm   (Lattice — Undoped (100) Silicon Crystal · Amorphous SiO2/HfO2)
 *   7.0 => 1.1B x   · 111 pm    (Atom — Silicon-28 (14Si) · 1s2 2s2 2p6 3sp3 Wavefunctions)
 *   8.0 => 40T x    · 3.1 fm    (Nucleus — Oblate 28Si Nucleus · 14P + 14N · Pion Field)
 *   9.0 => 150T x   · 0.84 fm   (Proton — Single Proton · uud Color-Charge Quarks · Gluons)
 */

function formatPhysicalLength(fm: number): string {
  const fmt = (v: number) => (v >= 10 || Math.abs(v - Math.round(v)) < 1e-4 ? `${Math.round(v)}` : v.toFixed(1));
  if (fm >= 1e14) return `${fmt(fm / 1e13)} cm`;
  if (fm >= 1e12) return `${fmt(fm / 1e12)} mm`;
  if (fm >= 1e9) return `${fmt(fm / 1e9)} µm`;
  if (fm >= 1e6) return `${fmt(fm / 1e6)} nm`;
  if (fm >= 1e3) return `${fmt(fm / 1e3)} pm`;
  if (fm >= 1) return `${fmt(fm)} fm`;
  return `${fm.toFixed(1)} fm`;
}

/**
 * Compute a calibrated Zeiss/FEI-style optical scale bar on clean 1 / 2 / 5 engineering decades.
 * Given field-of-view feature span `fovFm` (~420px reference viewport span), picks the cleanest
 * physical length whose bar renders between 54px and 130px wide and grows smoothly as you zoom!
 */
function computeScaleBar(fovFm: number): { label: string; px: number } {
  const refSpanPx = 380;
  const targetFm = fovFm * (86 / refSpanPx);
  const exp10 = Math.floor(Math.log10(Math.max(targetFm, 1e-3)));
  const base = Math.pow(10, exp10);
  const candidates = [0.5 * base, 1 * base, 2 * base, 5 * base, 10 * base];

  let bestFm = candidates[1];
  let bestScore = Infinity;
  for (const c of candidates) {
    const px = (c / fovFm) * refSpanPx;
    if (px >= 48 && px <= 132) {
      const score = Math.abs(px - 84);
      if (score < bestScore) {
        bestScore = score;
        bestFm = c;
      }
    }
  }
  const px = Math.max(44, Math.min(136, (bestFm / fovFm) * refSpanPx));
  return { label: formatPhysicalLength(bestFm), px };
}

export function formatMagnification(uZoom: number): {
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
  const magKnots = [
    1,
    4,
    1_000,
    40_000,
    200_000,
    1_000_000,
    10_000_000,
    220_000_000,
    1_100_000_000,
    40_000_000_000_000,
    150_000_000_000_000,
  ];
  const fmKnots = [
    72_000_000_000_000, // 72 mm (package + US Quarter)
    21_000_000_000_000, // 21.0 mm (M-Max silicon die)
    120_000_000_000,    // 120 um (BEOL global power & clock grid)
    3_000_000_000,      // 3.0 um (BEOL copper damascene routing)
    600_000_000,        // 600 nm (FEOL standard-cell logic rows)
    120_000_000,        // 120 nm (GAA CMOS standard cell)
    12_000_000,         // 12 nm (actual physical gate length!)
    543_000,            // 0.543 nm (Si diamond-cubic unit cell)
    111_000,            // 111 pm (Si covalent radius)
    3.1,                // 3.1 fm (28Si nucleus radius)
    0.84,               // 0.84 fm (single proton charge radius)
  ];

  let mag: number;
  let fm: number;
  if (z < -1.0) {
    const extraOut = -1.0 - z;
    const scaleFactor = Math.pow(2.55, extraOut);
    mag = 1.0 / scaleFactor;
    fm = 72_000_000_000_000 * scaleFactor;
  } else {
    const shifted = z + 1;
    const i0 = Math.min(9, Math.floor(shifted));
    const f = shifted - i0;
    mag = Math.exp(Math.log(magKnots[i0]) * (1 - f) + Math.log(magKnots[i0 + 1]) * f);
    fm = Math.exp(Math.log(fmKnots[i0]) * (1 - f) + Math.log(fmKnots[i0 + 1]) * f);
  }

  let magText: string;
  if (mag >= 999_500_000_000) magText = `${Math.round(mag / 1_000_000_000_000)}T×`;
  else if (mag >= 999_500_000) magText = `${(mag / 1_000_000_000).toFixed(mag >= 10_000_000_000 ? 0 : 1)}B×`;
  else if (mag >= 999_500) magText = `${(mag / 1_000_000).toFixed(mag >= 10_000_000 ? 0 : 1)}M×`;
  else if (mag >= 999.5) magText = `${(mag / 1_000).toFixed(mag >= 10_000 ? 0 : 1)}K×`;
  else if (mag >= 0.95) magText = `${Math.round(mag)}×`;
  else magText = `${mag.toFixed(2)}×`;

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
    const badges: { center: number; half: number; label: string; analogy: string }[] = [
      {
        center: 1.0,
        half: 0.36,
        label: '120 µm · BEOL Global Power & Clock Grid (M12–M16)',
        analogy: 'Roughly the width of a single human hair',
      },
      {
        center: 2.0,
        half: 0.36,
        label: '3.0 µm · Copper Damascene Routing (M4–M9) & Vias',
        analogy: 'Smaller than a single red blood cell (7 µm)',
      },
      {
        center: 3.0,
        half: 0.36,
        label: '600 nm · FEOL Standard-Cell Logic Rows · VDD/VSS · PMOS/NMOS',
        analogy: 'About one wavelength of visible orange light',
      },
      {
        center: 4.0,
        half: 0.38,
        label: '120 nm · Uniform GAA Nanosheet Cell · TiN/W · SiN Spacers',
        analogy: 'The physical scale of a single virus particle',
      },
      {
        center: 5.0,
        half: 0.38,
        label: '12 nm Gate · 5 nm GAA Ribbon · HfO₂/SiO₂ High-k · Undoped Si',
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
        analogy: '100,000× wider than the nucleus hidden at its center',
      },
      {
        center: 7.52,
        half: 0.22,
        label: '99.9999999999% Empty Space · Plunging 35,800× to the Nucleus',
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
    for (const b of badges) {
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
  const bar = computeScaleBar(fm);
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
