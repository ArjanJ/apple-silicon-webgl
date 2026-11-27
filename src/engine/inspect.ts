import { LiveMacTelemetry } from '../sim/macTelemetry';
import { DEFAULT_DIE_SPEC, DieFloorplanSpec, QUARTER_RADIUS, QUARTER_X, QUARTER_Z } from './worlds';

export interface DieInspectHit {
  id: string;
  /** World-0 XZ highlight rectangle [cx, cz, hx, hz] (or circle when hz < 0: radius = |hz|) */
  box: [number, number, number, number];
  /** Target zoom level when user clicks "Dive Inside" */
  diveZoom: number;
  /** Region architecture kind for micro-scale context (0 = logic, 1 = SRAM/cache, 2 = GPU) */
  regionKind: 0 | 1 | 2;
  title: (t: LiveMacTelemetry) => string;
  subtitle: (t: LiveMacTelemetry) => string;
  metric: (t: LiveMacTelemetry) => string;
  detail: (t: LiveMacTelemetry) => string;
}

/**
 * Analytical hit-test against every functional block on the Apple Silicon Die (World 0).
 * Dynamically matches the telemetry-driven floorplan in buildWorld0(spec)!
 */
export function pickDieRegion(
  wx: number,
  wz: number,
  spec: DieFloorplanSpec = DEFAULT_DIE_SPEC
): DieInspectHit | null {
  // 1) Individual Performance Cores (dynamically adapts to 2..12 P-Cores)
  const pCount = Math.max(2, Math.min(12, spec.pCores || 8));
  const pRowsN = pCount <= 4 ? 1 : 2;
  const pColsN = Math.ceil(pCount / pRowsN);
  const pStepX = 2.48 / pColsN;
  const pStepZ = 1.68 / pRowsN;
  let pIdx = 0;
  for (let r = 0; r < pRowsN; r++) {
    for (let c = 0; c < pColsN && pIdx < pCount; c++) {
      const cx = -1.68 + (c - (pColsN - 1) * 0.5) * pStepX;
      const cz = -1.04 + (r - (pRowsN - 1) * 0.5) * pStepZ;
      const hx = pStepX * 0.46;
      const hz = pStepZ * 0.47;
      if (Math.abs(wx - cx) <= hx && Math.abs(wz - cz) <= hz) {
        const coreIdx = pIdx;
        return {
          id: `pcore-${coreIdx}`,
          box: [cx, cz, hx, hz],
          diveZoom: 4.0,
          regionKind: 0,
          title: () => `Performance Core P${coreIdx}`,
          subtitle: (t) => `${t.chipName} · High-Performance Cluster`,
          metric: (t) => {
            const eOff = Math.min(t.eCoreCount, Math.max(0, t.coreLoads.length - pCount));
            const load = t.coreLoads[eOff + coreIdx] ?? t.pCoreAvg;
            const tempStr = t.socTempC !== null ? ` · ${t.socTempC.toFixed(1)}°C` : '';
            return `${Math.round(load * 100)}% Load${tempStr}`;
          },
          detail: () =>
            '8-wide out-of-order decode pipeline backed by 192 KB L1 instruction cache and 12 MB shared cluster L2.',
        };
      }
      pIdx++;
    }
  }

  // 2) Efficiency Core Cluster (mid-left)
  if (wx >= -2.94 && wx <= -0.42 && wz >= 0.04 && wz <= 1.00) {
    return {
      id: 'ecores',
      box: [-1.68, 0.52, 1.25, 0.48],
      diveZoom: 3.0,
      regionKind: 0,
      title: (t) => `${t.eCoreCount}-Core Efficiency Cluster`,
      subtitle: () => 'Background & Low-Power Execution Domain',
      metric: (t) => `${Math.round(t.eCoreAvg * 100)}% Avg Load · 4 MB Shared L2`,
      detail: () =>
        'Runs macOS background daemons and idle UI threads at a fraction of a watt so P-cores can power-gate completely.',
    };
  }

  // 3) GPU Core Array (top-right, dynamically adapts to live GPU core count)
  if (wx >= 0.50 && wx <= 2.86 && wz >= -1.88 && wz <= 0.32) {
    return {
      id: 'gpu',
      box: [1.68, -0.78, 1.18, 1.10],
      diveZoom: 2.0,
      regionKind: 2,
      title: (t) => `${t.gpuCores}-Core Apple GPU`,
      subtitle: () => 'Tile-Based Deferred Rendering (TBDR) Array',
      metric: (t) =>
        `${Math.round(t.gpuEst * 100)}% Active · Tiler ${Math.round(t.gpuTiler * 100)}% · ${t.gpuMemGB.toFixed(2)} GB VRAM`,
      detail: () =>
        'On-chip tile memory executes 4× MSAA and HDR shading directly in silicon without round-tripping to external DRAM.',
    };
  }

  // 4) 16-Core Neural Engine (mid-right)
  if (wx >= 0.54 && wx <= 2.82 && wz >= 0.48 && wz <= 1.40) {
    return {
      id: 'ane',
      box: [1.68, 0.94, 1.12, 0.46],
      diveZoom: 3.0,
      regionKind: 0,
      title: () => '16-Core Neural Engine',
      subtitle: () => 'Dedicated FP16 / INT8 Matrix Accelerator',
      metric: (t) => `11+ TOPS Peak · Thermal ${t.thermalState}`,
      detail: () =>
        'Streams weights directly from Unified Memory over the coherent fabric for Core ML, Vision, and on-device inference.',
    };
  }

  // 5) Center Spine: System-Level Cache (SRAM)
  if (wx >= -0.36 && wx <= 0.36 && wz >= -2.18 && wz <= 2.18) {
    return {
      id: 'slc',
      box: [0.0, 0.0, 0.35, 2.16],
      diveZoom: 1.0,
      regionKind: 1,
      title: () => 'System-Level Cache (SLC)',
      subtitle: () => '6T SRAM Coherent Interconnect Fabric',
      metric: (t) => `48 MB Coherent SRAM · ${Math.round(((t.pCoreAvg + t.gpuEst) / 2) * 100)}% Traffic`,
      detail: () =>
        'High-density 6T SRAM cache spine shared simultaneously by CPU, GPU, Neural Engine, and Media blocks to avoid memory copies.',
    };
  }

  // 6) Unified Memory LPDDR5 Packages (4 stacked DRAM dies, 2 per side)
  if (Math.abs(wx) >= 3.42 && Math.abs(wx) <= 5.02 && Math.abs(wz) <= 2.48) {
    const side = wx < 0 ? -1 : 1;
    const row = wz < 0 ? -1 : 1;
    return {
      id: `ram-${side < 0 ? 'l' : 'r'}-${row < 0 ? 't' : 'b'}`,
      box: [side * 4.22, row * 1.28, 0.79, 1.17],
      diveZoom: 1.0,
      regionKind: 1,
      title: (t) => `${t.memTotalGB} GB Unified Memory`,
      subtitle: () => '512-bit LPDDR5 On-Package DRAM (1T1C)',
      metric: (t) => `${t.memUsedGB.toFixed(1)} / ${t.memTotalGB} GB Used · 400 GB/s Bus`,
      detail: () =>
        'Four LPDDR5 DRAM packages bonded directly beside the logic die on the organic interposer for zero-copy CPU/GPU unified address space.',
    };
  }

  // 7) Display & Media Engine (bottom-right)
  if (wx >= 0.54 && wx <= 2.82 && wz >= 1.56 && wz <= 2.16) {
    return {
      id: 'media',
      box: [1.68, 1.86, 1.12, 0.28],
      diveZoom: 2.0,
      regionKind: 0,
      title: () => 'Display & ProRes Media Engine',
      subtitle: () => 'ProMotion 120 Hz & Hardware Video Codecs',
      metric: (t) => `GPU ${Math.round(t.gpuEst * 100)}% · Dual ProRes Pipelines`,
      detail: () =>
        'Dedicated fixed-function H.264, HEVC, and ProRes encode/decode blocks alongside the 120 Hz ProMotion display pipe.',
    };
  }

  // 8) I/O & Network PHY (bottom-left)
  if (wx >= -2.76 && wx <= -0.60 && wz >= 1.28 && wz <= 2.14) {
    return {
      id: 'io-phy',
      box: [-1.68, 1.70, 1.08, 0.42],
      diveZoom: 2.0,
      regionKind: 0,
      title: () => 'I/O & Thunderbolt 4 PHY',
      subtitle: () => 'High-Speed Serial Transceivers & Network DMA',
      metric: (t) =>
        t.netKBps >= 1024 ? `${(t.netKBps / 1024).toFixed(1)} MB/s Live I/O` : `${t.netKBps.toFixed(0)} KB/s Live I/O`,
      detail: () =>
        'Independent Thunderbolt 4 / USB4 controllers, NVMe SSD lanes, and Wi-Fi/Ethernet DMA ring buffers.',
    };
  }

  // 9) SMD Decoupling Capacitors (around die perimeter)
  const nearTB = Math.abs(wx) <= 3.05 && Math.abs(Math.abs(wz) - 2.86) <= 0.16;
  const nearLR = Math.abs(wz) <= 2.45 && Math.abs(Math.abs(wx) - 3.32) <= 0.16;
  if (nearTB || nearLR) {
    return {
      id: 'smd-caps',
      box: [0, 0, 3.42, 2.95],
      diveZoom: 1.0,
      regionKind: 0,
      title: () => 'SMD Decoupling Capacitor Ring',
      subtitle: () => 'Ultra-Low-ESR Ceramic Bulk Power Reservoirs',
      metric: (t) => `0.72 V Core Rail · ${Math.round(t.cpuTotal * 100)}% Transient Demand`,
      detail: () =>
        'Supplies instant nanosecond current bursts into the M12–M16 BEOL power grid when billions of transistors switch simultaneously.',
    };
  }

  // 10) US Quarter Dollar 1:1 Scale Reference (next to package in Scale view)
  const qDist = Math.hypot(wx - QUARTER_X, wz - QUARTER_Z);
  if (qDist <= QUARTER_RADIUS + 0.12) {
    return {
      id: 'us-quarter',
      box: [QUARTER_X, QUARTER_Z, QUARTER_RADIUS, -(QUARTER_RADIUS + 0.06)],
      diveZoom: 0.0,
      regionKind: 0,
      title: () => 'US Quarter Dollar (25¢)',
      subtitle: () => '1:1 Physical Scale Reference · US Mint Spec',
      metric: () => '24.26 mm Dia · 1.75 mm Thick · ~2M × 12 nm Gates',
      detail: () =>
        'Roughly 1.1× the width of the bare silicon die. Over two million 12 nm gate lengths could fit side-by-side across a single quarter.',
    };
  }

  return null;
}
