export interface LiveMacTelemetry {
  chipName: string;
  totalCores: number;
  pCoreCount: number;
  eCoreCount: number;
  coreLoads: number[];
  pCoreAvg: number;
  eCoreAvg: number;
  cpuTotal: number;
  memUsedGB: number;
  memTotalGB: number;
  memRatio: number;
  netKBps: number;
  gpuEst: number;
  topProcs: { name: string; cpu: number }[];
  live: boolean;
  timestamp: number;
}

export interface MooresEra {
  year: number;
  nodeNm: number;
  chip: string;
  transistorsTotal: string;
  densityVs1971: string;
  headline: string;
  caption: string;
}

export const MOORES_ERAS: MooresEra[] = [
  {
    year: 1971,
    nodeNm: 10000,
    chip: 'Intel 4004',
    transistorsTotal: '2,300',
    densityVs1971: '1×',
    headline: '1971 · 10,000 nm — One Single Transistor Fills the Frame',
    caption:
      'At the dawn of microprocessors, a single planar aluminum-gate transistor was 10 micrometers wide—roughly the size of a red blood cell. Lock your eyes on this white footprint.',
  },
  {
    year: 1982,
    nodeNm: 1500,
    chip: 'Intel 286 / Motorola 68000',
    transistorsTotal: '134,000',
    densityVs1971: '44×',
    headline: '1982 · 1,500 nm — 44 Transistors Fit Inside One 1971 Switch',
    caption:
      'Optical lithography shrinks features nearly 7× in a decade. Dozens of smaller planar transistors now pack cleanly inside the exact square that held a single 1971 switch.',
  },
  {
    year: 1995,
    nodeNm: 350,
    chip: 'Pentium Pro / PowerPC',
    transistorsTotal: '5.5 Million',
    densityVs1971: '816×',
    headline: '1995 · 350 nm — Sub-Wavelength Silicon & Multi-Layer Metal',
    caption:
      'Transistors become smaller than the wavelength of visible light. Hundreds of logic gates and stacked metallic interconnects crowd into the original 1971 footprint.',
  },
  {
    year: 2006,
    nodeNm: 65,
    chip: 'Core 2 Duo',
    transistorsTotal: '291 Million',
    densityVs1971: '23,600×',
    headline: '2006 · 65 nm — Deep Copper Canyons & Dual-Core Density',
    caption:
      'Tens of thousands of transistors now sit inside the space of one 1971 switch, wired by multi-story copper canyons and vertical circular vias.',
  },
  {
    year: 2016,
    nodeNm: 14,
    chip: 'Apple A10 Fusion (FinFET)',
    transistorsTotal: '3.3 Billion',
    densityVs1971: '510,000×',
    headline: '2016 · 14 nm — Silicon Goes 3D with Vertical FinFETs',
    caption:
      'Flat transistors leak too much current, so engineers pull silicon vertically into 3D fins. Half a million FinFETs now pack into the 1971 footprint.',
  },
  {
    year: 2026,
    nodeNm: 3,
    chip: 'Apple Silicon 3nm GAA',
    transistorsTotal: '28+ Billion',
    densityVs1971: '11,100,000×',
    headline: '2026 · 3 nm — 11 Million Transistors Inside One 1971 Switch',
    caption:
      'Gate-All-Around stacked silicon nanosheets—only ~11 silicon atoms wide. Eleven million modern switches now occupy the exact patch of silicon one 1971 transistor used.',
  },
];

export function interpolateMooresLaw(year: number): {
  year: number;
  nodeNm: number;
  nodeLabel: string;
  densityFactor: number;
  densityLabel: string;
  era: MooresEra;
  progress: number; // 0..1 across 1971..2026
} {
  const y = Math.max(1971, Math.min(2026, year));
  const progress = (y - 1971) / (2026 - 1971);

  // Piece-wise log interpolation across the 6 historical nodes
  let i0 = 0;
  for (let i = 0; i < MOORES_ERAS.length - 1; i++) {
    if (y >= MOORES_ERAS[i].year) i0 = i;
  }
  const e0 = MOORES_ERAS[i0];
  const e1 = MOORES_ERAS[Math.min(MOORES_ERAS.length - 1, i0 + 1)];
  const frac = e1.year > e0.year ? (y - e0.year) / (e1.year - e0.year) : 0;

  const nodeNm = Math.exp(Math.log(e0.nodeNm) * (1 - frac) + Math.log(e1.nodeNm) * frac);
  const densityFactor = Math.pow(10000 / Math.max(3, nodeNm), 2);

  const nodeLabel =
    nodeNm >= 1000
      ? `${(nodeNm / 1000).toFixed(nodeNm >= 5000 ? 0 : 1)} µm (${Math.round(nodeNm).toLocaleString()} nm)`
      : nodeNm >= 20
        ? `${Math.round(nodeNm)} nm`
        : `${nodeNm.toFixed(1)} nm`;

  let densityLabel: string;
  if (densityFactor >= 1_000_000) densityLabel = `${(densityFactor / 1_000_000).toFixed(1)}M`;
  else if (densityFactor >= 1_000) densityLabel = `${(densityFactor / 1_000).toFixed(1)}K`;
  else densityLabel = `${Math.max(1, Math.round(densityFactor))}`;

  // Pick nearest era description
  let nearest = MOORES_ERAS[0];
  let bestD = Infinity;
  for (const e of MOORES_ERAS) {
    const d = Math.abs(e.year - y);
    if (d < bestD) {
      bestD = d;
      nearest = e;
    }
  }

  return { year: Math.round(y), nodeNm, nodeLabel, densityFactor, densityLabel, era: nearest, progress };
}

export const DEFAULT_TELEMETRY: LiveMacTelemetry = {
  chipName: 'Apple Silicon',
  totalCores: 10,
  pCoreCount: 8,
  eCoreCount: 2,
  coreLoads: [0.18, 0.14, 0.25, 0.22, 0.15, 0.12, 0.1, 0.08, 0.12, 0.09],
  pCoreAvg: 0.18,
  eCoreAvg: 0.16,
  cpuTotal: 0.17,
  memUsedGB: 14.2,
  memTotalGB: 32,
  memRatio: 0.44,
  netKBps: 12.4,
  gpuEst: 0.22,
  topProcs: [{ name: 'Connecting to Mac...', cpu: 0 }],
  live: false,
  timestamp: Date.now(),
};
