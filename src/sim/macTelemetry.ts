export type TelemetrySource = 'iokit' | 'node' | 'browser' | 'capture';

export interface LiveMacTelemetry {
  chipName: string;
  totalCores: number;
  pCoreCount: number;
  eCoreCount: number;
  gpuCores: number;
  coreLoads: number[];
  pCoreAvg: number;
  eCoreAvg: number;
  cpuTotal: number;
  memUsedGB: number;
  memTotalGB: number;
  memRatio: number;
  netKBps: number;
  gpuEst: number; // Real IOKit GPU Device Utilization (0..1) or browser hardware-timed estimate
  gpuRenderer: number;
  gpuTiler: number;
  gpuMemGB: number;
  socTempC: number | null; // Real Apple Silicon PMU die temp in deg C (or modeled thermal curve)
  thermalState: string;
  topProcs: { name: string; cpu: number }[];
  nativeTelemetry: boolean;
  live: boolean;
  source?: TelemetrySource;
  pressureState?: string | null;
  gpuTimed?: boolean;
  gpuFrameMs?: number | null;
  workloadSummary?: string | null;
  captureName?: string | null;
  memBandwidthGBs?: number;
  slcMB?: number;
  aneTops?: string;
  timestamp: number;
}

export const DEFAULT_TELEMETRY: LiveMacTelemetry = {
  chipName: 'Apple Silicon',
  totalCores: 10,
  pCoreCount: 8,
  eCoreCount: 2,
  gpuCores: 24,
  coreLoads: [0.18, 0.14, 0.25, 0.22, 0.15, 0.12, 0.1, 0.08, 0.12, 0.09],
  pCoreAvg: 0.18,
  eCoreAvg: 0.16,
  cpuTotal: 0.17,
  memUsedGB: 14.2,
  memTotalGB: 32,
  memRatio: 0.44,
  netKBps: 12.4,
  gpuEst: 0.22,
  gpuRenderer: 0.22,
  gpuTiler: 0.22,
  gpuMemGB: 0.5,
  socTempC: null,
  thermalState: 'Nominal',
  topProcs: [{ name: 'Connecting to Mac...', cpu: 0 }],
  nativeTelemetry: false,
  live: false,
  memBandwidthGBs: 400,
  slcMB: 48,
  aneTops: '11 TOPS',
  timestamp: Date.now(),
};
