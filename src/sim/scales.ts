/**
 * Physical Scale Ladder across 7+ orders of magnitude:
 * Continuous logarithmic parameter `u` in [0, 5.0]:
 *   u = 0.0 -> 28 mm   (Full Apple-Silicon-style SoC Package + Unified Memory)
 *   u = 1.0 -> 10 mm   (Iridescent Silicon Die Floorplan — P/E Cores, GPU, NPU, Cache, I/O)
 *   u = 2.0 -> 200 µm  (Inside a Core: 3D 10-Story Copper Metal Interconnect Metropolis)
 *   u = 3.0 -> 2 µm    (Logic Cell Floor: FinFET NAND/Inverter Standard Cells switching live)
 *   u = 4.0 -> 3 nm    (Single 3nm Gate-All-Around Nanosheet Transistor + live electrons)
 *   u = 5.0 -> 0.5 nm  (Inside the 3nm Channel: Diamond-Cubic Silicon Crystal Lattice)
 */

export interface ScaleStage {
  id: string;
  u: number;
  name: string;
  shortName: string;
  physicalSize: string;
  comparison: string;
  headline: string;
  explanation: string;
}

export const SCALE_STAGES: ScaleStage[] = [
  {
    id: 'package',
    u: 0.0,
    name: 'SoC Package',
    shortName: '28 mm',
    physicalSize: '28 mm',
    comparison: 'About the width of a US quarter',
    headline: 'System-on-Chip Package + Unified Memory',
    explanation:
      'Everything lives on one dark substrate: the main silicon chip in the center flanked by two Unified Memory (RAM) stacks and tiny golden capacitors that stabilize power.',
  },
  {
    id: 'die',
    u: 1.0,
    name: 'Silicon Die',
    shortName: '10 mm',
    physicalSize: '10 mm',
    comparison: 'Size of a fingernail — ~28 billion transistors',
    headline: 'Inside the Iridescent Silicon Die',
    explanation:
      'Different neighborhoods handle different jobs: Efficiency Cores handle typing & cursor, Performance Cores crush heavy math, GPU Cores paint pixels, and the Neural Engine runs AI.',
  },
  {
    id: 'metal',
    u: 2.0,
    name: 'Copper Interconnects',
    shortName: '200 µm',
    physicalSize: '200 µm',
    comparison: 'About 2× the width of a human hair',
    headline: '10-Story 3D Copper Skyscraper City (M1–M10)',
    explanation:
      'Modern chips aren’t flat—they are microscopic multi-story cities of copper highways. Signals race horizontally along metal layers and drop down vertical shafts ("vias") to the transistors below.',
  },
  {
    id: 'logic',
    u: 3.0,
    name: 'Logic Cells',
    shortName: '2 µm',
    physicalSize: '2 µm',
    comparison: 'Smaller than a single red blood cell',
    headline: 'Standard Logic Gates on the Silicon Floor',
    explanation:
      'Where electricity becomes decisions: rows of tiny NAND, NOR, and flip-flop cells flip between 1 (0.72V) and 0 (0V) billions of times per second to add numbers and store bits.',
  },
  {
    id: 'transistor',
    u: 4.0,
    name: '3nm Transistor',
    shortName: '3 nm',
    physicalSize: '3 nm',
    comparison: '25,000× thinner than a human hair (~width of DNA)',
    headline: 'Gate-All-Around (GAA) Nanosheet Transistor',
    explanation:
      'The smallest working switch in a modern chip. Apply 0.72V to the glowing metal Gate collar wrapping these 3 stacked silicon ribbons, and electrons surge across from Source to Drain = "1"!',
  },
  {
    id: 'atoms',
    u: 5.0,
    name: 'Silicon Atoms',
    shortName: '0.5 nm',
    physicalSize: '0.54 nm',
    comparison: 'A 3 nm channel is literally only ~11 silicon atoms wide!',
    headline: 'Diamond-Cubic Silicon Crystal Lattice',
    explanation:
      'You are now inside the 3 nm nanosheet itself. Each sphere is a real Silicon atom sharing 4 covalent bonds. When the Gate switches ON, quantum electron waves drift straight through this crystal.',
  },
];

export function formatPhysicalScale(u: number): { label: string; comparison: string; stage: ScaleStage } {
  // Smooth log interpolation of physical size in nanometers:
  // u=0 -> 28,000,000 nm (28 mm)
  // u=1 -> 10,000,000 nm (10 mm)
  // u=2 -> 200,000 nm (200 µm)
  // u=3 -> 2,000 nm (2 µm)
  // u=4 -> 3 nm
  // u=5 -> 0.54 nm
  const knots = [28_000_000, 10_000_000, 200_000, 2_000, 3.0, 0.54];
  const clamped = Math.max(0, Math.min(5, u));
  const i0 = Math.min(4, Math.floor(clamped));
  const frac = clamped - i0;
  const nm = Math.exp(Math.log(knots[i0]) * (1 - frac) + Math.log(knots[i0 + 1]) * frac);

  let label: string;
  if (nm >= 1_000_000) label = `${(nm / 1_000_000).toFixed(nm >= 10_000_000 ? 0 : 1)} mm`;
  else if (nm >= 1_000) label = `${(nm / 1_000).toFixed(nm >= 10_000 ? 0 : 1)} µm`;
  else if (nm >= 10) label = `${Math.round(nm)} nm`;
  else label = `${nm.toFixed(2)} nm`;

  const nearestIdx = Math.round(clamped);
  const stage = SCALE_STAGES[nearestIdx];
  return { label, comparison: stage.comparison, stage };
}
