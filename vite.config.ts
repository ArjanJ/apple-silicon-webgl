import { ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { defineConfig, Plugin } from 'vite';

const execFileAsync = promisify(execFile);

interface NativeSample {
  chipName: string;
  totalCores: number;
  pCoreCount: number;
  eCoreCount: number;
  gpuCores: number;
  coreLoads: number[];
  memUsedGB: number;
  memTotalGB: number;
  netKBps: number;
  gpuUtil: number;
  gpuRenderer: number;
  gpuTiler: number;
  gpuMemGB: number;
  socTempC: number;
  thermalState: string;
}

interface TelemetryPayload {
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
  gpuEst: number;
  gpuRenderer: number;
  gpuTiler: number;
  gpuMemGB: number;
  socTempC: number | null;
  thermalState: string;
  topProcs: { name: string; cpu: number }[];
  nativeTelemetry: boolean;
  live: boolean;
  timestamp: number;
}

function liveMacTelemetryPlugin(): Plugin {
  const rootDir = __dirname;
  const nativeSrc = path.join(rootDir, 'native', 'mac_telemetry.m');
  const nativeBin = path.join(rootDir, 'native', 'mac_telemetry');

  let nativeProc: ChildProcess | null = null;
  let latestNative: NativeSample | null = null;
  let cachedTopProcs: { name: string; cpu: number }[] = [];
  let lastPsMs = 0;

  // Fallback state (if non-macOS or binary unavailable)
  const totalCoresFallback = os.cpus().length;
  const memTotalFallback = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  let prevCpuTimes = os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });

  async function ensureNativeStarted(): Promise<void> {
    if (nativeProc || process.platform !== 'darwin') return;
    if (!fs.existsSync(nativeBin) && fs.existsSync(nativeSrc)) {
      try {
        await execFileAsync('clang', [
          '-O2',
          '-fobjc-arc',
          '-framework',
          'Foundation',
          '-framework',
          'IOKit',
          '-framework',
          'CoreFoundation',
          nativeSrc,
          '-o',
          nativeBin,
        ]);
      } catch {
        return;
      }
    }
    if (!fs.existsSync(nativeBin)) return;

    const proc = spawn(nativeBin, ['--ms=600'], { stdio: ['ignore', 'pipe', 'ignore'] });
    nativeProc = proc;

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line) as NativeSample;
        if (parsed && Array.isArray(parsed.coreLoads)) {
          latestNative = parsed;
        }
      } catch {
        // ignore partial line
      }
    });

    proc.on('exit', () => {
      if (nativeProc === proc) nativeProc = null;
    });
  }

  async function refreshTopProcsIfStale(): Promise<void> {
    const now = Date.now();
    if (now - lastPsMs < 2400 && cachedTopProcs.length > 0) return;
    lastPsMs = now;
    try {
      const { stdout } = await execFileAsync('ps', ['-Arcwwwxo', '%cpu,comm']);
      const list: { name: string; cpu: number }[] = [];
      for (const line of stdout.trim().split('\n').slice(1, 9)) {
        const m = line.trim().match(/^([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const cpu = parseFloat(m[1]) || 0;
        const shortName = m[2].trim().split('/').pop() || m[2].trim();
        if (shortName === 'ps' || shortName === 'mac_telemetry') continue;
        list.push({ name: shortName, cpu: Math.round(cpu * 10) / 10 });
        if (list.length >= 4) break;
      }
      if (list.length > 0) cachedTopProcs = list;
    } catch {
      // ignore
    }
  }

  async function getTelemetry(): Promise<TelemetryPayload> {
    const now = Date.now();
    void refreshTopProcsIfStale();

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    if (latestNative) {
      const n = latestNative;
      const eSlice = n.coreLoads.slice(0, Math.min(n.eCoreCount, n.coreLoads.length));
      const pSlice = n.coreLoads.slice(Math.min(n.eCoreCount, n.coreLoads.length));
      const eCoreAvg = avg(eSlice);
      const pCoreAvg = avg(pSlice.length ? pSlice : n.coreLoads);
      const cpuTotal = avg(n.coreLoads);

      return {
        chipName: n.chipName,
        totalCores: n.totalCores,
        pCoreCount: n.pCoreCount,
        eCoreCount: n.eCoreCount,
        gpuCores: n.gpuCores || 16,
        coreLoads: n.coreLoads,
        pCoreAvg,
        eCoreAvg,
        cpuTotal,
        memUsedGB: n.memUsedGB,
        memTotalGB: n.memTotalGB,
        memRatio: Math.max(0.05, Math.min(1, n.memUsedGB / Math.max(1, n.memTotalGB))),
        netKBps: n.netKBps,
        gpuEst: n.gpuUtil,
        gpuRenderer: n.gpuRenderer,
        gpuTiler: n.gpuTiler,
        gpuMemGB: n.gpuMemGB,
        socTempC: n.socTempC > 0 ? n.socTempC : null,
        thermalState: n.thermalState || 'Nominal',
        topProcs: cachedTopProcs,
        nativeTelemetry: true,
        live: true,
        timestamp: now,
      };
    }

    // Lightweight fallback while native stream primes (~600ms) or on non-macOS
    const curCpus = os.cpus();
    const coreLoads = curCpus.map((c, idx) => {
      const t = c.times;
      const total = t.user + t.nice + t.sys + t.idle + t.irq;
      const prev = prevCpuTimes[idx] ?? { idle: t.idle, total };
      const dTotal = Math.max(1, total - prev.total);
      const dIdle = Math.max(0, t.idle - prev.idle);
      prevCpuTimes[idx] = { idle: t.idle, total };
      return Math.max(0, Math.min(1, 1 - dIdle / dTotal));
    });
    const cpuTotal = avg(coreLoads);
    const memUsedGB = Math.round(memTotalFallback * (1 - os.freemem() / os.totalmem()) * 10) / 10;

    return {
      chipName: curCpus[0]?.model || 'Apple Silicon',
      totalCores: totalCoresFallback,
      pCoreCount: Math.max(2, totalCoresFallback - 2),
      eCoreCount: Math.min(2, totalCoresFallback),
      gpuCores: 16,
      coreLoads,
      pCoreAvg: cpuTotal,
      eCoreAvg: cpuTotal,
      cpuTotal,
      memUsedGB,
      memTotalGB: memTotalFallback,
      memRatio: Math.max(0.05, Math.min(1, memUsedGB / Math.max(1, memTotalFallback))),
      netKBps: 0,
      gpuEst: Math.min(1, cpuTotal * 0.45),
      gpuRenderer: Math.min(1, cpuTotal * 0.45),
      gpuTiler: Math.min(1, cpuTotal * 0.45),
      gpuMemGB: 0,
      socTempC: null,
      thermalState: 'Nominal',
      topProcs: cachedTopProcs,
      nativeTelemetry: false,
      live: true,
      timestamp: now,
    };
  }

  return {
    name: 'live-mac-telemetry',
    configureServer(server) {
      void ensureNativeStarted();
      void refreshTopProcsIfStale();

      server.httpServer?.once('close', () => {
        if (nativeProc) {
          nativeProc.kill('SIGTERM');
          nativeProc = null;
        }
      });

      server.middlewares.use('/api/telemetry', async (_req, res) => {
        try {
          const data = await getTelemetry();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(data));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err), live: false }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [liveMacTelemetryPlugin()],
  server: {
    port: 5175,
    host: '127.0.0.1',
  },
});
