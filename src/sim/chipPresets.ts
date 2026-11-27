import { LiveMacTelemetry } from './macTelemetry';

export type ChipPresetId = 'auto' | 'm1' | 'm2-pro' | 'm3-max' | 'm4-max';

export interface ChipPreset {
  id: ChipPresetId;
  shortLabel: string;
  chipName: string;
  pCoreCount: number;
  eCoreCount: number;
  gpuCores: number;
  memTotalGB: number;
  memBandwidthGBs: number;
  slcMB: number;
  aneTops: string;
}

export const CHIP_PRESETS: readonly ChipPreset[] = [
  {
    id: 'auto',
    shortLabel: 'Auto',
    chipName: 'Auto',
    pCoreCount: 8,
    eCoreCount: 2,
    gpuCores: 24,
    memTotalGB: 32,
    memBandwidthGBs: 400,
    slcMB: 48,
    aneTops: '11 TOPS',
  },
  {
    id: 'm1',
    shortLabel: 'M1',
    chipName: 'Apple M1',
    pCoreCount: 4,
    eCoreCount: 4,
    gpuCores: 8,
    memTotalGB: 16,
    memBandwidthGBs: 68,
    slcMB: 16,
    aneTops: '11 TOPS',
  },
  {
    id: 'm2-pro',
    shortLabel: 'M2 Pro',
    chipName: 'Apple M2 Pro',
    pCoreCount: 8,
    eCoreCount: 4,
    gpuCores: 19,
    memTotalGB: 32,
    memBandwidthGBs: 200,
    slcMB: 24,
    aneTops: '15.8 TOPS',
  },
  {
    id: 'm3-max',
    shortLabel: 'M3 Max',
    chipName: 'Apple M3 Max',
    pCoreCount: 12,
    eCoreCount: 4,
    gpuCores: 40,
    memTotalGB: 64,
    memBandwidthGBs: 400,
    slcMB: 48,
    aneTops: '18 TOPS',
  },
  {
    id: 'm4-max',
    shortLabel: 'M4 Max',
    chipName: 'Apple M4 Max',
    pCoreCount: 12,
    eCoreCount: 4,
    gpuCores: 40,
    memTotalGB: 128,
    memBandwidthGBs: 546,
    slcMB: 48,
    aneTops: '38 TOPS',
  },
] as const;

export function getChipPreset(id: ChipPresetId): ChipPreset {
  return CHIP_PRESETS.find((p) => p.id === id) ?? CHIP_PRESETS[0];
}

function resampleCluster(src: number[], targetLen: number, fallback: number): number[] {
  if (targetLen <= 0) return [];
  if (src.length === 0) return Array(targetLen).fill(fallback);
  if (src.length === targetLen) return src.slice();

  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const pos = targetLen === 1 ? 0 : (i / (targetLen - 1)) * (src.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, lo + 1);
    const frac = pos - lo;
    const v = src[lo] * (1 - frac) + src[hi] * frac;
    out.push(Math.round(Math.max(0.02, Math.min(0.99, v)) * 1000) / 1000);
  }
  return out;
}

/**
 * Remaps any live, browser, or captured telemetry payload onto a selected Apple Silicon
 * die floorplan so the 3D WebGL2 engine dynamically rebuilds the physical core & GPU layout.
 */
export function applyChipPreset(base: LiveMacTelemetry, presetId: ChipPresetId): LiveMacTelemetry {
  if (presetId === 'auto') {
    return base;
  }
  const preset = getChipPreset(presetId);
  const srcECount = Math.min(base.eCoreCount, base.coreLoads.length);
  const srcE = base.coreLoads.slice(0, srcECount);
  const srcP = base.coreLoads.slice(srcECount);

  const eLoads = resampleCluster(srcE, preset.eCoreCount, base.eCoreAvg);
  const pLoads = resampleCluster(srcP, preset.pCoreCount, base.pCoreAvg);
  const coreLoads = [...eLoads, ...pLoads];

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const eCoreAvg = avg(eLoads);
  const pCoreAvg = avg(pLoads);
  const cpuTotal = avg(coreLoads);

  const memUsedGB = Math.round(preset.memTotalGB * base.memRatio * 10) / 10;
  const vramScale = Math.min(2.4, Math.max(0.45, preset.memTotalGB / Math.max(8, base.memTotalGB)));
  const gpuMemGB = Math.round(Math.min(preset.memTotalGB * 0.72, base.gpuMemGB * vramScale) * 100) / 100;

  return {
    ...base,
    chipName: preset.chipName,
    totalCores: preset.pCoreCount + preset.eCoreCount,
    pCoreCount: preset.pCoreCount,
    eCoreCount: preset.eCoreCount,
    gpuCores: preset.gpuCores,
    coreLoads,
    eCoreAvg,
    pCoreAvg,
    cpuTotal,
    memTotalGB: preset.memTotalGB,
    memUsedGB,
    gpuMemGB,
    memBandwidthGBs: preset.memBandwidthGBs,
    slcMB: preset.slcMB,
    aneTops: preset.aneTops,
  };
}
