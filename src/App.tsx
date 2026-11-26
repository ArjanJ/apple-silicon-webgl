import React, { useEffect, useRef, useState } from 'react';
import { Activity, Clock, Flame, Pause, Play, Rotate3d, Zap } from 'lucide-react';
import { MicroscopeReticle } from './components/MicroscopeReticle';
import { MicroscopeMode, RaymarchEngine } from './shader/RaymarchEngine';
import {
  DEFAULT_TELEMETRY,
  interpolateMooresLaw,
  LiveMacTelemetry,
  MOORES_ERAS,
} from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';

const LIVE_ZOOM_STOPS = [
  { z: 0.0, label: 'Silicon Die · 10×', desc: 'Your actual Mac’s P-Cores, E-Cores, GPU & Unified RAM glowing live' },
  { z: 1.0, label: 'Striations · 2.5K×', desc: 'Dense SRAM cache banks and hair-thin metallic power rails' },
  { z: 2.0, label: 'Metal Canyons · 250K×', desc: 'Sculpted 3D silver-titanium traces & ringed vertical vias' },
  { z: 3.0, label: 'Nano Grid · 8M×', desc: 'Repeating nanometer cell fortresses switching live with your CPU load' },
  { z: 4.0, label: '3nm Fins · 100M×', desc: '2-tier stacked 3nm GAA nanosheet ribbons over crystalline silicon' },
];

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaymarchEngine | null>(null);

  const [mode, setMode] = useState<MicroscopeMode>('live');
  const [zoom, setZoom] = useState(0.0);
  const [telemetry, setTelemetry] = useState<LiveMacTelemetry>(DEFAULT_TELEMETRY);
  const [thermal, setThermal] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [bursting, setBursting] = useState(false);

  // Moore's Law Time Machine state (1971 -> 2026)
  const [year, setYear] = useState(1971);
  const [moorePlaying, setMoorePlaying] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = new RaymarchEngine(mount, {
      onZoomChange: (z) => setZoom(z),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Poll real live Mac hardware telemetry every 550ms from Vite's zero-sudo /api/telemetry middleware!
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as LiveMacTelemetry;
        if (!alive) return;
        setTelemetry(data);
        engineRef.current?.setTelemetry(data);
      } catch {
        // fallback cleanly if static preview
      }
    };
    poll();
    const id = window.setInterval(poll, 550);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.thermal = thermal;
  }, [thermal]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.autoOrbit = autoOrbit;
  }, [autoOrbit]);

  // Sync Moore's Law year -> GPU shader eraProgress
  useEffect(() => {
    const prog = (year - 1971) / (2026 - 1971);
    engineRef.current?.setEraProgress(prog);
  }, [year]);

  // Auto-play Moore's Law 1971 -> 2026 continuous time-lapse!
  useEffect(() => {
    if (!moorePlaying || mode !== 'moore') return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setYear((prev) => {
        const next = prev + dt * 4.4; // ~12.5 seconds for full 55-year evolution
        if (next >= 2026) {
          setMoorePlaying(false);
          return 2026;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [moorePlaying, mode]);

  // Real 3.5-second multi-core Web Worker burst so the user can watch THEIR ACTUAL MAC spike live!
  const triggerMacBurst = () => {
    if (bursting) return;
    setBursting(true);
    const workerCode = `
      const end = Date.now() + 3400;
      let acc = 0;
      while (Date.now() < end) {
        for (let i = 0; i < 200000; i++) acc += Math.sqrt(i * 1.13);
      }
      postMessage(acc);
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const workers: Worker[] = [];
    const count = Math.min(8, Math.max(4, telemetry.pCoreCount || 6));
    for (let i = 0; i < count; i++) {
      workers.push(new Worker(url));
    }
    window.setTimeout(() => {
      workers.forEach((w) => w.terminate());
      URL.revokeObjectURL(url);
      setBursting(false);
    }, 3600);
  };

  const { magText, sizeText, dialDeg } = formatMagnification(zoom);
  const moore = interpolateMooresLaw(year);
  const activeZoomIdx = Math.round(zoom);
  const activeZoomStop = LIVE_ZOOM_STOPS[activeZoomIdx] ?? LIVE_ZOOM_STOPS[0];

  const cpuPct = Math.round(telemetry.cpuTotal * 100);
  const pPct = Math.round(telemetry.pCoreAvg * 100);
  const ePct = Math.round(telemetry.eCoreAvg * 100);

  return (
    <div className="apple-stage">
      {/* Full-Bleed 2-Pass WebGL2 GPU Raymarched Viewport */}
      <div ref={mountRef} className="raymarch-mount" />

      {/* Circular Optical Microscope Reticle + Scale Bracket */}
      <MicroscopeReticle
        mode={mode}
        zoom={zoom}
        magText={magText}
        sizeText={sizeText}
        dialDeg={mode === 'moore' ? moore.progress * 260 : dialDeg}
        mooreDensityLabel={moore.densityLabel}
        mooreYear={moore.year}
      />

      {/* Top Apple Frosted-Glass HUD */}
      <div className="hud-top">
        {/* Left Identity Pill */}
        <div className="apple-pill">
          <span className={`live-dot ${mode === 'moore' ? 'moore' : ''}`} />
          <div className="brand-stack">
            <div className="brand-headline">
              <span>{mode === 'live' ? telemetry.chipName : `Moore’s Law · ${moore.year}`}</span>
              <span className="brand-spec">
                {mode === 'live' ? `${magText} · ${sizeText}` : moore.nodeLabel}
              </span>
            </div>
            <div className="brand-sub">
              {mode === 'live'
                ? `${telemetry.pCoreCount}P + ${telemetry.eCoreCount}E Cores · ${telemetry.memUsedGB}/${telemetry.memTotalGB} GB RAM`
                : `${moore.era.chip} · ${moore.era.transistorsTotal} transistors`}
            </div>
          </div>
        </div>

        {/* Center Mode Switcher */}
        <div className="mode-switcher">
          <button
            className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => {
              setMoorePlaying(false);
              setMode('live');
            }}
          >
            <Activity size={13} />
            Live Mac X-Ray
          </button>
          <button
            className={`mode-btn ${mode === 'moore' ? 'active' : ''}`}
            onClick={() => {
              setMode('moore');
            }}
          >
            <Clock size={13} />
            1971 → 2026 Time Machine
          </button>
        </div>

        {/* Right Controls */}
        <div className="tool-pill">
          {mode === 'live' && (
            <button
              className={`icon-pill-btn burst ${bursting ? 'active' : ''}`}
              onClick={triggerMacBurst}
              title="Run a real 3.5-second multi-core burst on your Mac and watch the 3D cores ignite"
            >
              <Zap size={13} />
              {bursting ? 'Bursting...' : 'Burst Mac'}
            </button>
          )}
          <button
            className={`icon-pill-btn ${thermal ? 'active' : ''}`}
            onClick={() => setThermal((v) => !v)}
            title="Toggle Infrared Thermal Vision"
          >
            <Flame size={13} />
            Thermal
          </button>
          <button
            className={`icon-pill-btn ${autoOrbit ? 'active' : ''}`}
            onClick={() => setAutoOrbit((v) => !v)}
            title="Toggle Smooth 3D Orbit"
          >
            <Rotate3d size={13} />
            Orbit
          </button>
        </div>
      </div>

      {/* Right Floating Live Mac Hardware Telemetry Card (Live Mac X-Ray Mode) */}
      {mode === 'live' && (
        <div className="mac-telemetry-card">
          <div className="card-eyebrow">
            <span>LIVE THIS MAC · {cpuPct}% CPU</span>
            <span style={{ color: telemetry.live ? '#30d158' : '#86868b' }}>
              {telemetry.live ? '● STREAMING' : 'SIM'}
            </span>
          </div>

          {/* Real Per-Core CPU Spark Bars (E-Cores + P-Cores) */}
          <div className="core-bars" title="Live utilization of each physical core on your Mac">
            {telemetry.coreLoads.slice(0, 12).map((load, idx) => {
              const isE = idx < telemetry.eCoreCount;
              const pct = Math.max(8, Math.round(load * 100));
              const col = isE
                ? '#64d2ff'
                : load > 0.65
                  ? '#ff9f0a'
                  : load > 0.3
                    ? '#5ac8fa'
                    : '#3a6ea5';
              return (
                <div key={idx} className="core-col">
                  <div className="core-fill" style={{ height: `${pct}%`, background: col }} />
                  <span className="core-lbl">{isE ? `E${idx}` : `P${idx - telemetry.eCoreCount}`}</span>
                </div>
              );
            })}
          </div>

          <div className="stat-pair">
            <div className="mini-stat">
              <div className="mini-stat-lbl">Unified Memory</div>
              <div className="mini-stat-val">
                {telemetry.memUsedGB} / {telemetry.memTotalGB} GB
              </div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-lbl">Network I/O</div>
              <div className="mini-stat-val">
                {telemetry.netKBps >= 1024
                  ? `${(telemetry.netKBps / 1024).toFixed(1)} MB/s`
                  : `${telemetry.netKBps.toFixed(0)} KB/s`}
              </div>
            </div>
          </div>

          <div className="proc-list">
            <div style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#86868b', marginBottom: 2 }}>
              DRIVING SILICON RIGHT NOW
            </div>
            {telemetry.topProcs.slice(0, 3).map((p, i) => (
              <div key={i} className="proc-row">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 175 }}>
                  {p.name}
                </span>
                <span className="proc-cpu">{p.cpu.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Apple Keynote Dock */}
      <div className="hud-bottom">
        {mode === 'live' ? (
          <div className="story-dock">
            <div className="story-top-line">
              <div className="story-title">
                Live X-Ray of Your {telemetry.chipName} — {activeZoomStop.label}
              </div>
              <span className="density-badge">
                P-Cores {pPct}% · E-Cores {ePct}% · Pinch to zoom 10× → 100M×
              </span>
            </div>
            <div className="story-caption">{activeZoomStop.desc}</div>
            <div className="controls-row">
              <div className="zoom-pills">
                {LIVE_ZOOM_STOPS.map((st, idx) => (
                  <button
                    key={st.label}
                    className={`ch-pill ${activeZoomIdx === idx ? 'active' : ''}`}
                    onClick={() => engineRef.current?.flyToZoom(st.z)}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="story-dock">
            <div className="story-top-line">
              <div className="story-title">{moore.era.headline}</div>
              <span className="density-badge">
                {moore.densityLabel}× inside one 1971 switch
              </span>
            </div>
            <div className="story-caption">{moore.era.caption}</div>

            <div className="controls-row">
              <button
                className={`t-btn ${moorePlaying ? 'white' : ''}`}
                onClick={() => {
                  if (!moorePlaying && year >= 2025.5) setYear(1971);
                  setMoorePlaying((p) => !p);
                }}
              >
                {moorePlaying ? <Pause size={12} /> : <Play size={12} />}
                {moorePlaying ? 'Playing 55 yrs' : 'Play 1971 → 2026'}
              </button>

              <input
                type="range"
                className="moore-slider"
                min={1971}
                max={2026}
                step={0.1}
                value={year}
                onChange={(e) => {
                  setMoorePlaying(false);
                  setYear(parseFloat(e.target.value));
                }}
              />
            </div>

            <div className="era-pills">
              {MOORES_ERAS.map((e) => (
                <button
                  key={e.year}
                  className={`ch-pill ${moore.era.year === e.year ? 'active' : ''}`}
                  onClick={() => {
                    setMoorePlaying(false);
                    setYear(e.year);
                  }}
                >
                  {e.year} · {e.nodeNm >= 1000 ? `${e.nodeNm / 1000}µm` : `${e.nodeNm}nm`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
