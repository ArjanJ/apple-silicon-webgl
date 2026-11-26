/**
 * Smooth logarithmic magnification & physical scale formatter across zoom [0..7]:
 *   0.0 => 10x      · 12.0 mm   (Die)
 *   1.0 => 2.5K x   · 60 um     (Striations)
 *   2.0 => 250K x   · 800 nm    (Canyons)
 *   3.0 => 8M x     · 25 nm     (Grid)
 *   4.0 => 100M x   · 3.0 nm    (3 nm GAA)
 *   5.0 => 1B x     · 0.54 nm   (Silicon Diamond-Cubic Lattice)
 *   6.0 => 5B x     · 111 pm    (Single Silicon-28 Atom & sp3 Orbitals)
 *   7.0 => 100T x   · 3.1 fm    (Silicon-28 Atomic Nucleus: 14P + 14N)
 */
export function formatMagnification(uZoom: number): {
  magText: string;
  sizeText: string;
  dialDeg: number;
  bracketText: string | null;
  bracketOpacity: number;
} {
  const z = Math.max(0, Math.min(7, uZoom));
  const magKnots = [10, 2500, 250_000, 8_000_000, 100_000_000, 1_000_000_000, 5_000_000_000, 100_000_000_000_000];
  // Physical size in femtometers (1 nm = 1,000,000 fm; 1 pm = 1,000 fm)
  const fmKnots = [
    12_000_000_000_000, // 12 mm
    60_000_000_000,     // 60 um
    800_000_000,        // 800 nm
    25_000_000,         // 25 nm
    3_000_000,          // 3.0 nm
    543_000,            // 0.543 nm (Si unit cell)
    111_000,            // 111 pm (Si covalent radius)
    3.1,                // 3.1 fm (28Si nucleus radius)
  ];

  const i0 = Math.min(6, Math.floor(z));
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
  else if (fm >= 1_000_000_000) sizeText = `${Math.round(fm / 1_000_000_000)} µm`;
  else if (fm >= 10_000_000) sizeText = `${Math.round(fm / 1_000_000)} nm`;
  else if (fm >= 500_000) sizeText = `${(fm / 1_000_000).toFixed(2)} nm`;
  else if (fm >= 1_000) sizeText = `${Math.round(fm / 1_000)} pm`;
  else sizeText = `${fm.toFixed(1)} fm`;

  // Contextual physical scale badge around 3nm, Lattice, Atom, and Nucleus
  let bracketText: string | null = null;
  let bracketOpacity = 0;
  const badges: { center: number; label: string }[] = [
    { center: 4.0, label: '3 nm · ~11 Silicon Atoms' },
    { center: 5.0, label: '0.543 nm · Silicon Crystal Lattice · HfO₂ Gate' },
    { center: 6.0, label: '111 pm · Silicon-28 (¹⁴Si) · sp³ Quantum Orbitals' },
    { center: 7.0, label: '3.1 fm · ²⁸Si Nucleus · 14 Protons + 14 Neutrons' },
  ];
  for (const b of badges) {
    const dist = Math.abs(z - b.center);
    if (dist < 0.42) {
      bracketText = b.label;
      bracketOpacity = Math.max(0, Math.min(1, (0.42 - dist) / 0.22));
      break;
    }
  }

  const dialDeg = z * 42;
  return { magText, sizeText, dialDeg, bracketText, bracketOpacity };
}
