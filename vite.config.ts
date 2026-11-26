import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { defineConfig, Plugin } from 'vite';

const execFileAsync = promisify(execFile);

interface CpuTimes {
  idle: number;
  total: number;
}

interface TelemetryPayload {
  chipName: string;
  totalCores: number;
  pCoreCount: number;
  eCoreCount: number;
  coreLoads: number[]; // 0..1 per core
  pCoreAvg: number; // 0..1
  eCoreAvg: number; // 0..1
  cpuTotal: number; // 0..1
  memUsedGB: number;
  memTotalGB: number;
  memRatio: number; // 0..1
  netKBps: number;
  gpuEst: number; // 0..1 estimated from WindowServer / media / GPU-heavy procs
  topProcs: { name: string; cpu: number }[];
  live: boolean;
  timestamp: number;
}

function liveMacTelemetryPlugin(): Plugin {
  let chipName = 'Apple Silicon';
  let pCoreCount = 8;
  let eCoreCount = 2;
  let totalCores = os.cpus().length;
  let memTotalGB = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;

  let prevCpuTimes: CpuTimes[] = os.cpus().map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });

  let prevNetBytes = 0;
  let prevNetTime = Date.now();
  let lastCached: TelemetryPayload | null = null;
  let lastFetchMs = 0;
  let initDone = false;

  async function initStaticInfo() {
    if (initDone) return;
    initDone = true;
    try {
      const { stdout } = await execFileAsync('sysctl', [
        '-n',
        'machdep.cpu.brand_string',
        'hw.ncpu',
        'hw.perflevel0.physicalcpu',
        'hw.perflevel1.physicalcpu',
      ]);
      const lines = stdout.trim().split('\n').map((l) => l.trim());
      if (lines[0]) chipName = lines[0];
      if (lines[1]) totalCores = parseInt(lines[1], 10) || totalCores;
      if (lines[2]) pCoreCount = parseInt(lines[2], 10) || pCoreCount;
      if (lines[3]) eCoreCount = parseInt(lines[3], 10) || eCoreCount;
    } catch {
      chipName = os.cpus()[0]?.model || 'Apple Silicon';
    }
  }

  async function sampleTelemetry(): Promise<TelemetryPayload> {
    const now = Date.now();
    if (lastCached && now - lastFetchMs < 420) {
      return lastCached;
    }
    lastFetchMs = now;
    await initStaticInfo();

    // 1. Real Per-Core CPU Utilization Delta from Node os.cpus()
    const curCpus = os.cpus();
    const coreLoads: number[] = curCpus.map((c, idx) => {
      const t = c.times;
      const total = t.user + t.nice + t.sys + t.idle + t.irq;
      const prev = prevCpuTimes[idx] ?? { idle: t.idle, total };
      const dTotal = Math.max(1, total - prev.total);
      const dIdle = Math.max(0, t.idle - prev.idle);
      prevCpuTimes[idx] = { idle: t.idle, total };
      return Math.max(0, Math.min(1, 1 - dIdle / dTotal));
    });

    // On Apple Silicon macOS, E-cores are listed first (0..eCoreCount-1), P-cores follow
    const eSlice = coreLoads.slice(0, Math.min(eCoreCount, coreLoads.length));
    const pSlice = coreLoads.slice(Math.min(eCoreCount, coreLoads.length));
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const eCoreAvg = avg(eSlice);
    const pCoreAvg = avg(pSlice.length ? pSlice : coreLoads);
    const cpuTotal = avg(coreLoads);

    // 2. Real Unified Memory Usage via vm_stat
    let memUsedGB = memTotalGB * (1 - os.freemem() / os.totalmem());
    try {
      const { stdout } = await execFileAsync('vm_stat', []);
      const pageMatch = stdout.match(/page size of (\d+) bytes/);
      const pageSize = pageMatch ? parseInt(pageMatch[1], 10) : 16384;
      const grab = (label: string) => {
        const m = stdout.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
        return m ? parseInt(m[1], 10) : 0;
      };
      const active = grab('Pages active');
      const wired = grab('Pages wired down');
      const compressed = grab('Pages occupied by compressor');
      const usedBytes = (active + wired + compressed) * pageSize;
      if (usedBytes > 0) {
        memUsedGB = Math.min(memTotalGB, usedBytes / 1024 ** 3);
      }
    } catch {
      // keep os.freemem fallback
    }

    // 3. Real Network Traffic KB/s via netstat -ib
    let netKBps = 0;
    try {
      const { stdout } = await execFileAsync('netstat', ['-ib']);
      let sumBytes = 0;
      const seen = new Set<string>();
      for (const line of stdout.split('\n')) {
        if (!line.startsWith('en')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10 && parts[2].includes('<Link#')) {
          const iface = parts[0];
          if (seen.has(iface)) continue;
          seen.add(iface);
          const ibytes = parseInt(parts[6], 10) || 0;
          const obytes = parseInt(parts[9], 10) || 0;
          sumBytes += ibytes + obytes;
        }
      }
      const dtSec = Math.max(0.2, (now - prevNetTime) / 1000);
      if (prevNetBytes > 0 && sumBytes >= prevNetBytes) {
        netKBps = Math.round(((sumBytes - prevNetBytes) / 1024 / dtSec) * 10) / 10;
      }
      prevNetBytes = sumBytes;
      prevNetTime = now;
    } catch {
      netKBps = 0;
    }

    // 4. Real Top Running Processes on This Mac
    const topProcs: { name: string; cpu: number }[] = [];
    let gpuEst = Math.min(1, cpuTotal * 0.45 + 0.08);
    try {
      const { stdout } = await execFileAsync('ps', ['-Arcwwwxo', '%cpu,comm']);
      const lines = stdout.trim().split('\n').slice(1, 9);
      for (const line of lines) {
        const m = line.trim().match(/^([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const cpu = parseFloat(m[1]) || 0;
        const rawPath = m[2].trim();
        const shortName = rawPath.split('/').pop() || rawPath;
        if (shortName === 'ps') continue;
        if (topProcs.length < 4) {
          topProcs.push({ name: shortName, cpu: Math.round(cpu * 10) / 10 });
        }
        if (/WindowServer|Renderer|GPU|ffmpeg|Safari|Chrome|Final Cut|Blender/i.test(shortName)) {
          gpuEst = Math.min(1, gpuEst + cpu / 180);
        }
      }
    } catch {
      // ignore
    }

    lastCached = {
      chipName,
      totalCores,
      pCoreCount,
      eCoreCount,
      coreLoads,
      pCoreAvg,
      eCoreAvg,
      cpuTotal,
      memUsedGB: Math.round(memUsedGB * 10) / 10,
      memTotalGB,
      memRatio: Math.max(0.05, Math.min(1, memUsedGB / Math.max(1, memTotalGB))),
      netKBps,
      gpuEst,
      topProcs,
      live: true,
      timestamp: now,
    };
    return lastCached;
  }

  return {
    name: 'live-mac-telemetry',
    configureServer(server) {
      server.middlewares.use('/api/telemetry', async (_req, res) => {
        try {
          const data = await sampleTelemetry();
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
  plugins: [react(), liveMacTelemetryPlugin()],
  server: {
    port: 5175,
    host: '127.0.0.1',
  },
});
