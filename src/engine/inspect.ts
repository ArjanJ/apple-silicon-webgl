import { LiveMacTelemetry } from '../sim/macTelemetry';

export interface DieInspectHit {
  id: string;
  /** World-0 XZ highlight rectangle: [cx, cz, hx, hz] */
  box: [number, number, number, number];
  /** Target zoom level when user clicks "Dive Inside" */
  diveZoom: number;
  title: (t: LiveMacTelemetry) => string;
  subtitle: (t: LiveMacTelemetry) => string;
  metric: (t: LiveMacTelemetry) => string;
  detail: (t: LiveMacTelemetry) => string;
}

const P_COLS = [-0.96, -0.32, 0.32, 0.96];
const P_ROWS = [-0.43, 0.43];

/**
 * Analytical hit-test against every functional block on the Apple Silicon Die (World 0).
 * Coordinates match buildWorld0() in src/engine/worlds.ts exactly.
 */
export function pickDieRegion(wx: number, wz: number): DieInspectHit | null {
  // 1) Individual Performance Cores P0..P7 (4x2 cluster, top-left)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const cx = -1.52 + P_COLS[c];
      const cz = -1.04 + P_ROWS[r];
      if (Math.abs(wx - cx) <= 0.31 && Math.abs(wz - cz) <= 0.41) {
        const coreIdx = r * 4 + c;
        return {
          id: `pcore-${coreIdx}`,
          box: [cx, cz, 0.305, 0.405],
          diveZoom: 5.0,
          title: () => `Performance Core P${coreIdx}`,
          subtitle: (t) => `${t.chipName} · High-Performance Cluster`,
          metric: (t) => {
            const eOff = Math.min(t.eCoreCount, Math.max(0, t.coreLoads.length - 8));
            const load = t.coreLoads[eOff + coreIdx] ?? t.pCoreAvg;
            const tempStr = t.socTempC !== null ? ` · ${t.socTempC.toFixed(1)}°C` : '';
            return `${Math.round(load * 100)}% Load${tempStr}`;
          },
          detail: () =>
            '8-wide out-of-order decode pipeline backed by 192 KB L1 instruction cache and 12 MB shared cluster L2.',
        };
      }
    }
  }

  // 2) Efficiency Core Cluster (mid-left)
  if (wx >= -2.80 && wx <= -0.24 && wz >= 0.04 && wz <= 1.00) {
    return {
      id: 'ecores',
      box: [-1.52, 0.52, 1.27, 0.48],
      diveZoom: 1.0,
      title: (t) => `${t.eCoreCount}-Core Efficiency Cluster`,
      subtitle: () => 'Background & Low-Power Execution Domain',
      metric: (t) => `${Math.round(t.eCoreAvg * 100)}% Avg Load · 4 MB Shared L2`,
      detail: () =>
        'Runs macOS background daemons and idle UI threads at a fraction of a watt so P-cores can power-gate completely.',
    };
  }

  // 3) GPU Array (top-right)
  if (wx >= 0.54 && wx <= 2.78 && wz >= -1.86 && wz <= 0.30) {
    return {
      id: 'gpu',
      box: [1.66, -0.78, 1.12, 1.08],
      diveZoom: 2.0,
      title: (t) => `${t.gpuCores}-Core Apple GPU`,
      subtitle: () => 'Tile-Based Deferred Rendering (TBDR) Array',
      metric: (t) =>
        `${Math.round(t.gpuEst * 100)}% Active · Tiler ${Math.round(t.gpuTiler * 100)}% · ${t.gpuMemGB.toFixed(2)} GB VRAM`,
      detail: () =>
        'On-chip tile memory executes 4× MSAA and HDR shading directly in silicon without round-tripping to external DRAM.',
    };
  }

  // 4) 16-Core Neural Engine (mid-right)
  if (wx >= 0.54 && wx <= 2.78 && wz >= 0.46 && wz <= 1.38) {
    return {
      id: 'ane',
      box: [1.66, 0.92, 1.12, 0.46],
      diveZoom: 3.0,
      title: () => '16-Core Neural Engine',
      subtitle: () => 'Dedicated FP16 / INT8 Matrix Accelerator',
      metric: (t) => `11 TOPS Peak · Thermal ${t.thermalState}`,
      detail: () =>
        'Streams weights directly from Unified Memory over the coherent fabric for Core ML, Vision, and on-device inference.',
    };
  }

  // 5) Center Spine: System-Level Cache
  if (wx >= -0.22 && wx <= 0.34 && wz >= -2.18 && wz <= 1.98) {
    return {
      id: 'slc',
      box: [0.06, -0.10, 0.25, 2.06],
      diveZoom: 1.0,
      title: () => 'System-Level Cache (SLC)',
      subtitle: () => 'Coherent Central Interconnect Fabric',
      metric: (t) => `48 MB Coherent Fabric · ${Math.round(((t.pCoreAvg + t.gpuEst) / 2) * 100)}% Traffic`,
      detail: () =>
        'High-bandwidth SRAM spine shared simultaneously by CPU, GPU, Neural Engine, and Media blocks to avoid memory copies.',
    };
  }

  // 6) Unified Memory LPDDR5 Slabs (left & right wings)
  if (Math.abs(wx) >= 3.42 && Math.abs(wx) <= 5.02 && Math.abs(wz) <= 2.46) {
    const side = wx < 0 ? -1 : 1;
    return {
      id: side < 0 ? 'ram-left' : 'ram-right',
      box: [side * 4.22, 0.0, 0.79, 2.45],
      diveZoom: 1.0,
      title: (t) => `${t.memTotalGB} GB Unified Memory`,
      subtitle: () => '512-bit LPDDR5 On-Package DRAM',
      metric: (t) => `${t.memUsedGB.toFixed(1)} / ${t.memTotalGB} GB Used · 400 GB/s Bus`,
      detail: () =>
        'Bonded directly beside the silicon die on the same organic interposer for zero-copy CPU/GPU unified address space.',
    };
  }

  // 7) Display & Media Engine (bottom-right)
  if (wx >= 0.54 && wx <= 2.78 && wz >= 1.54 && wz <= 2.10) {
    return {
      id: 'media',
      box: [1.66, 1.82, 1.12, 0.28],
      diveZoom: 2.0,
      title: () => 'Display & ProRes Media Engine',
      subtitle: () => 'ProMotion 120 Hz & Hardware Video Codecs',
      metric: (t) => `GPU ${Math.round(t.gpuEst * 100)}% · Dual ProRes Pipelines`,
      detail: () =>
        'Dedicated fixed-function H.264, HEVC, and ProRes encode/decode blocks alongside the 120 Hz ProMotion display pipe.',
    };
  }

  // 8) I/O & Network PHY (bottom-left)
  if (wx >= -2.58 && wx <= -0.46 && wz >= 1.24 && wz <= 2.08) {
    return {
      id: 'io-phy',
      box: [-1.52, 1.66, 1.05, 0.41],
      diveZoom: 2.0,
      title: () => 'I/O & Thunderbolt 4 PHY',
      subtitle: () => 'High-Speed Serial Transceivers & Network DMA',
      metric: (t) =>
        t.netKBps >= 1024 ? `${(t.netKBps / 1024).toFixed(1)} MB/s Live I/O` : `${t.netKBps.toFixed(0)} KB/s Live I/O`,
      detail: () =>
        'Independent Thunderbolt 4 / USB4 controllers, NVMe SSD lanes, and Wi-Fi/Ethernet DMA ring buffers.',
    };
  }

  // 9) SMD Decoupling Capacitors (around die perimeter)
  const nearTB = Math.abs(wx) <= 3.05 && Math.abs(Math.abs(wz) - 2.78) <= 0.16;
  const nearLR = Math.abs(wz) <= 2.35 && Math.abs(Math.abs(wx) - 3.32) <= 0.16;
  if (nearTB || nearLR) {
    return {
      id: 'smd-caps',
      box: [0, 0, 3.38, 2.86],
      diveZoom: 1.0,
      title: () => 'SMD Decoupling Capacitor Ring',
      subtitle: () => 'Ultra-Low-ESR Ceramic + Gold Bulk Reservoirs',
      metric: (t) => `0.72 V Core Rail · ${Math.round(t.cpuTotal * 100)}% Transient Demand`,
      detail: () =>
        'Supplies instant nanosecond current bursts when billions of transistors switch simultaneously across the die.',
    };
  }

  return null;
}
