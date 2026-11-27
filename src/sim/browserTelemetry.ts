import { LiveMacTelemetry } from './macTelemetry';

/**
 * Pure-Browser Hybrid Telemetry Engine (Zero Install / GitHub Pages Compatible).
 *
 * Combines real browser-exposed signals:
 *   - navigator.hardwareConcurrency (logical CPU core count)
 *   - WebGL UNMASKED_RENDERER_WEBGL (chip / GPU identification when unmasked)
 *   - navigator.deviceMemory & Chromium performance.memory (coarse RAM / JS heap)
 *   - Compute Pressure API (PressureObserver, Chromium) for real OS CPU pressure
 *   - Live WebGL2 frame timing & camera motion + real Web Worker Burst intensity
 *
 * Drives smooth, physically plausible per-core CPU, GPU, memory, and thermal dynamics
 * when the local macOS Mach/IOKit dev middleware (/api/telemetry) is not present.
 */

interface PressureRecordLike {
  state: 'nominal' | 'fair' | 'serious' | 'critical';
}

interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}

type PressureObserverCtor = new (
  callback: (records: PressureRecordLike[]) => void
) => PressureObserverLike;

interface PerfWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface BrowserFrameSignal {
  frameMs: number;
  motion: number;
  zoom: number;
  idlePaced?: boolean;
}

function parseChipName(renderer: string | null): { chipName: string; gpuCores: number } {
  if (renderer) {
    const appleMatch = renderer.match(/Apple\s+(M\d+(?:\s+(?:Pro|Max|Ultra))?)/i);
    if (appleMatch) {
      const name = `Apple ${appleMatch[1]}`;
      const lower = name.toLowerCase();
      const gpuCores = lower.includes('ultra')
        ? 64
        : lower.includes('max')
          ? 32
          : lower.includes('pro')
            ? 16
            : 10;
      return { chipName: name, gpuCores };
    }

    if (/Apple\s+GPU/i.test(renderer)) {
      return { chipName: 'Apple Silicon', gpuCores: 16 };
    }

    // Strip ANGLE wrapper: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 ..., OpenGL ...)"
    const angleMatch = renderer.match(/ANGLE\s*\([^,]+,\s*([^,(]+)/i);
    const cleaned = (angleMatch ? angleMatch[1] : renderer)
      .replace(/\s+Direct3D.*$/i, '')
      .replace(/\s+vs_\d+.*$/i, '')
      .replace(/\s+OpenGL.*$/i, '')
      .replace(/\(R\)|\(TM\)/gi, '')
      .trim();

    if (cleaned.length > 2 && cleaned.length <= 34) {
      return { chipName: cleaned, gpuCores: 16 };
    }
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Mac OS X|Macintosh/i.test(ua)) {
    return { chipName: 'Apple Silicon', gpuCores: 16 };
  }
  return { chipName: 'Silicon Die', gpuCores: 16 };
}

function splitCoreClusters(totalCores: number): { pCoreCount: number; eCoreCount: number } {
  if (totalCores <= 4) {
    return { pCoreCount: Math.max(2, totalCores - 2), eCoreCount: Math.min(2, totalCores) };
  }
  if (totalCores === 8) return { pCoreCount: 4, eCoreCount: 4 };
  if (totalCores === 10) return { pCoreCount: 8, eCoreCount: 2 };
  if (totalCores === 12) return { pCoreCount: 8, eCoreCount: 4 };
  if (totalCores === 14) return { pCoreCount: 10, eCoreCount: 4 };
  if (totalCores === 16) return { pCoreCount: 12, eCoreCount: 4 };
  const eCoreCount = Math.max(2, Math.min(4, Math.round(totalCores * 0.25)));
  return { pCoreCount: Math.max(2, totalCores - eCoreCount), eCoreCount };
}

function pressureToLabel(state: string | null): string {
  switch (state) {
    case 'fair':
      return 'Fair';
    case 'serious':
      return 'Serious';
    case 'critical':
      return 'Critical';
    default:
      return 'Nominal';
  }
}

function pressureToBias(state: string | null): number {
  switch (state) {
    case 'fair':
      return 0.22;
    case 'serious':
      return 0.48;
    case 'critical':
      return 0.76;
    default:
      return 0.0;
  }
}

export class BrowserTelemetrySource {
  private chipName: string;
  private totalCores: number;
  private pCoreCount: number;
  private eCoreCount: number;
  private gpuCores: number;
  private memTotalGB: number;

  private burstActive = false;
  private burstLevel = 0;
  private dieTempC = 41.5;
  private phase = Math.random() * 100;
  private lastTickMs = performance.now();

  private pressureObserver: PressureObserverLike | null = null;
  private pressureState: string | null = null;

  constructor(gpuRenderer: string | null) {
    const parsed = parseChipName(gpuRenderer);
    this.chipName = parsed.chipName;
    this.gpuCores = parsed.gpuCores;

    const rawCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 10;
    this.totalCores = Math.max(4, Math.min(16, rawCores));
    const split = splitCoreClusters(this.totalCores);
    this.pCoreCount = split.pCoreCount;
    this.eCoreCount = split.eCoreCount;

    const devMem =
      typeof navigator !== 'undefined' && 'deviceMemory' in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
        : NaN;
    // Browsers cap navigator.deviceMemory at 8 GB for fingerprinting protection
    this.memTotalGB = Number.isFinite(devMem) && devMem > 0 ? (devMem >= 8 ? 16 : devMem) : 16;

    this.initComputePressure();
  }

  private initComputePressure(): void {
    const Ctor = (window as unknown as { PressureObserver?: PressureObserverCtor }).PressureObserver;
    if (!Ctor) return;
    try {
      const obs = new Ctor((records) => {
        const last = records[records.length - 1];
        if (last?.state) {
          this.pressureState = last.state;
        }
      });
      void obs.observe('cpu', { sampleInterval: 1000 }).catch(() => {
        // Unsupported or blocked by Permissions-Policy
      });
      this.pressureObserver = obs;
    } catch {
      // Ignore unsupported browsers
    }
  }

  public setBurst(active: boolean): void {
    this.burstActive = active;
  }

  public sample(signal: BrowserFrameSignal): LiveMacTelemetry {
    const now = performance.now();
    const dt = Math.min(2.0, Math.max(0.05, (now - this.lastTickMs) / 1000));
    this.lastTickMs = now;
    this.phase += dt;

    // Smooth burst ramp-up and cooldown
    const burstTarget = this.burstActive ? 1.0 : 0.0;
    const burstRate = this.burstActive ? 3.2 : 1.1;
    this.burstLevel += (burstTarget - this.burstLevel) * (1 - Math.exp(-burstRate * dt));

    const pressureBias = pressureToBias(this.pressureState);
    const motionBoost = Math.min(0.28, signal.motion * 0.25);

    // Per-core loads: E-cores run steady background ripples, P-cores respond to interaction, Pressure API & Burst
    const coreLoads: number[] = [];
    for (let i = 0; i < this.totalCores; i++) {
      const isE = i < this.eCoreCount;
      const wave1 = Math.sin(this.phase * (isE ? 0.7 : 1.15) + i * 1.37) * 0.5 + 0.5;
      const wave2 = Math.sin(this.phase * (isE ? 1.9 : 2.6) + i * 2.41) * 0.5 + 0.5;
      const jitter = wave1 * 0.65 + wave2 * 0.35;

      let load: number;
      if (isE) {
        load = 0.1 + jitter * 0.16 + pressureBias * 0.35 + this.burstLevel * 0.32;
      } else {
        const burstPerCore = this.burstLevel * (0.68 + wave2 * 0.24);
        load = 0.08 + jitter * 0.18 + motionBoost * 0.45 + pressureBias * 0.55 + burstPerCore;
      }
      coreLoads.push(Math.round(Math.max(0.03, Math.min(0.99, load)) * 1000) / 1000);
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const eCoreAvg = avg(coreLoads.slice(0, this.eCoreCount));
    const pCoreAvg = avg(coreLoads.slice(this.eCoreCount));
    const cpuTotal = avg(coreLoads);

    // GPU load reacts genuinely to real WebGL2 frame cost, camera motion, and zoom depth (ignore intentional idle pacing!)
    const framePressure = signal.idlePaced
      ? 0.04
      : Math.max(0, Math.min(0.55, (signal.frameMs - 6.0) / 28.0));
    const zoomComplexity = Math.max(0, Math.min(0.14, (signal.zoom + 1.0) * 0.015));
    const gpuWave = (Math.sin(this.phase * 1.4) * 0.5 + 0.5) * 0.08;
    const gpuEst = Math.max(
      0.12,
      Math.min(0.96, 0.22 + framePressure + motionBoost * 1.05 + zoomComplexity + gpuWave + this.burstLevel * 0.14)
    );
    const gpuRenderer = Math.min(0.98, gpuEst * 1.04);
    const gpuTiler = Math.max(0.06, Math.min(0.92, gpuEst * 0.78 + motionBoost * 0.25));

    // Memory estimate seeded by deviceMemory + real Chromium JS heap if available
    const perfMem = (performance as PerfWithMemory).memory;
    const heapRatio = perfMem && perfMem.jsHeapSizeLimit > 0
      ? Math.min(0.2, perfMem.usedJSHeapSize / perfMem.jsHeapSizeLimit)
      : 0.04;
    const memRatio = Math.max(
      0.24,
      Math.min(0.86, 0.42 + heapRatio + Math.sin(this.phase * 0.18) * 0.02 + this.burstLevel * 0.05)
    );
    const memUsedGB = Math.round(this.memTotalGB * memRatio * 10) / 10;
    const gpuMemGB = Math.round((0.35 + gpuEst * 0.55 + Math.max(0, signal.zoom) * 0.03) * 100) / 100;

    // Thermal inertia model (climbs during Burst / sustained load, cools smoothly)
    const targetTempC = 37.5 + cpuTotal * 26.0 + gpuEst * 12.0 + pressureBias * 11.0;
    const tempRate = targetTempC > this.dieTempC ? 0.55 : 0.25;
    this.dieTempC += (targetTempC - this.dieTempC) * (1 - Math.exp(-tempRate * dt));
    const socTempC = Math.round(this.dieTempC * 10) / 10;

    const thermalState = this.pressureState
      ? pressureToLabel(this.pressureState)
      : socTempC >= 74
        ? 'Serious'
        : socTempC >= 60
          ? 'Fair'
          : 'Nominal';

    const netKBps =
      Math.round(
        (8 + Math.abs(Math.sin(this.phase * 0.9)) * 42 + signal.motion * 85 + this.burstLevel * 60) * 10
      ) / 10;

    const topProcs: { name: string; cpu: number }[] = [
      ...(this.burstLevel > 0.12
        ? [{ name: 'Burst Web Workers', cpu: Math.round(this.burstLevel * this.pCoreCount * 92 * 10) / 10 }]
        : []),
      { name: 'WebGL2 Silicon Engine', cpu: Math.round((14 + gpuEst * 38 + motionBoost * 24) * 10) / 10 },
      { name: 'Browser Compositor', cpu: Math.round((4.5 + motionBoost * 16 + pressureBias * 12) * 10) / 10 },
      ...(this.pressureState
        ? [{ name: `OS Pressure (${pressureToLabel(this.pressureState)})`, cpu: Math.round((cpuTotal * 100) * 10) / 10 }]
        : [{ name: 'Microscope HUD', cpu: Math.round((1.2 + Math.abs(Math.sin(this.phase)) * 1.8) * 10) / 10 }]),
    ].slice(0, 3);

    return {
      chipName: this.chipName,
      totalCores: this.totalCores,
      pCoreCount: this.pCoreCount,
      eCoreCount: this.eCoreCount,
      gpuCores: this.gpuCores,
      coreLoads,
      pCoreAvg,
      eCoreAvg,
      cpuTotal,
      memUsedGB,
      memTotalGB: this.memTotalGB,
      memRatio,
      netKBps,
      gpuEst,
      gpuRenderer,
      gpuTiler,
      gpuMemGB,
      socTempC,
      thermalState,
      topProcs,
      nativeTelemetry: false,
      live: false,
      source: 'browser',
      pressureState: this.pressureState,
      timestamp: Date.now(),
    };
  }

  public dispose(): void {
    this.pressureObserver?.disconnect();
    this.pressureObserver = null;
  }
}
