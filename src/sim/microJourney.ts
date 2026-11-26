/**
 * Physically accurate logarithmic magnification & scale formatter across zoom [0..8]:
 *   0.0 => 10x      · 12.0 mm   (Die — full Apple Silicon package & die)
 *   1.0 => 1.0K x   · 120 um    (Striations — core SRAM vaults & micro-striations)
 *   2.0 => 100K x   · 1.2 um    (Canyons — multi-layer damascene metal routing & vias)
 *   3.0 => 1.0M x   · 120 nm    (Grid — standard-cell nanometer grid)
 *   4.0 => 5.0M x   · 24 nm     (Cell — 3nm GAA multi-fin transistor cell)
 *   5.0 => 40M x    · 3.0 nm    (3 nm — single GAA nanosheet inside cutaway gold/HfO2 gate)
 *   6.0 => 250M x   · 0.54 nm   (Lattice — Silicon diamond-cubic crystal & HfO2 overhead)
 *   7.0 => 1.2B x   · 111 pm    (Atom — single Silicon-28 atom & sp3 quantum orbitals)
 *   8.0 => 40T x    · 3.1 fm    (Nucleus — 28Si atomic nucleus: 14P + 14N)
 */
export function formatMagnification(uZoom: number): {
  magText: string;
  sizeText: string;
  dialDeg: number;
  bracketText: string | null;
  bracketOpacity: number;
} {
  const z = Math.max(0, Math.min(8, uZoom));
  const magKnots = [
    10,
    1_000,
    100_000,
    1_000_000,
    5_000_000,
    40_000_000,
    250_000_000,
    1_200_000_000,
    40_000_000_000_000,
  ];
  // Physical field-of-view feature scale in femtometers (1 nm = 1,000,000 fm; 1 pm = 1,000 fm)
  const fmKnots = [
    12_000_000_000_000, // 12.0 mm
    120_000_000_000,    // 120 um
    1_200_000_000,      // 1.2 um
    120_000_000,        // 120 nm
    24_000_000,         // 24 nm
    3_000_000,          // 3.0 nm
    543_000,            // 0.543 nm
    111_000,            // 111 pm
    3.1,                // 3.1 fm
  ];

  const i0 = Math.min(7, Math.floor(z));
  const f = z - i0;
  const mag = Math.exp(Math.log(magKnots[i0]) * (1 - f) + Math.log(magKnots[i0 + 1]) * f);
  const fm = Math.exp(Math.log(fmKnots[i0]) * (1 - f) + Math.log(fmKnots[i0 + 1]) * f);

  let magText: string;
  if (mag >= 999_500_000_000) magText = `${Math.round(mag / 1_000_000_000_000)}T×`;
  else if (mag >= 999_500_000) magText = `${(mag / 1_000_000_000).toFixed(mag >= 10_000_000_000 ? 0 : 1)}B×`;
  else if (mag >= 999_500) magText = `${(mag / 1_000_000).toFixed(mag >= 10_000_000 ? 0 : 1)}M×`;
  else if (mag >= 999.5) magText = `${(mag / 1_000).toFixed(mag >= 10_000 ? 0 : 1)}K×`;
  else magText = `${Math.round(mag)}×`;

  let sizeText: string;
  if (fm >= 1_000_000_000_000) sizeText = `${(fm / 1_000_000_000_000).toFixed(1)} mm`;
  else if (fm >= 10_000_000_000) sizeText = `${Math.round(fm / 1_000_000_000)} µm`;
  else if (fm >= 1_000_000_000) sizeText = `${(fm / 1_000_000_000).toFixed(1)} µm`;
  else if (fm >= 10_000_000) sizeText = `${Math.round(fm / 1_000_000)} nm`;
  else if (fm >= 500_000) sizeText = `${(fm / 1_000_000).toFixed(2)} nm`;
  else if (fm >= 1_000) sizeText = `${Math.round(fm / 1_000)} pm`;
  else sizeText = `${fm.toFixed(1)} fm`;

  let bracketText: string | null = null;
  let bracketOpacity = 0;
  const badges: { center: number; label: string }[] = [
    { center: 4.0, label: '24 nm · 3 nm GAA Multi-Fin Transistor Cell' },
    { center: 5.0, label: '3.0 nm · Single GAA Nanosheet · ~11 Atoms Wide · HfO₂ Gate' },
    { center: 6.0, label: '0.543 nm · Silicon Crystal Lattice · HfO₂ Overhead' },
    { center: 7.0, label: '111 pm · Silicon-28 (¹⁴Si) · sp³ Quantum Orbitals' },
    { center: 8.0, label: '3.1 fm · ²⁸Si Nucleus · 14 Protons + 14 Neutrons' },
  ];
  for (const b of badges) {
    const dist = Math.abs(z - b.center);
    if (dist < 0.42) {
      bracketText = b.label;
      bracketOpacity = Math.max(0, Math.min(1, (0.42 - dist) / 0.22));
      break;
    }
  }

  const dialDeg = z * 36;
  return { magText, sizeText, dialDeg, bracketText, bracketOpacity };
}
