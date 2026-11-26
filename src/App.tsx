import React, { useEffect, useRef, useState } from 'react';
import { Activity, Eye, EyeOff, Flame, Rotate3d, Zap } from 'lucide-react';
import { MicroscopeReticle } from './components/MicroscopeReticle';
import { RaymarchEngine } from './shader/RaymarchEngine';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';

const ZOOM_STOPS = [
  { z: 0.0, label: 'Die' },
  { z: 1.0, label: 'Striations' },
  { z: 2.0, label: 'Canyons' },
  { z: 3.0, label: 'Grid' },
  { z: 4.0, label: '3 nm' },
];

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaymarchEngine | null>(null);

  const [zoom, setZoom] = useState(0.0);
  const [telemetry, setTelemetry] = useState<LiveMacTelemetry>(DEFAULT_TELEMETRY);
  const [thermal, setThermal] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [bursting, setBursting] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [pureView, setPureView] = useState(false);

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

  // Poll real live Mac hardware telemetry every 850ms
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
        // ignore in static preview
      }
    };
    poll();
    const id = window.setInterval(poll, 850);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // 'H' keyboard shortcut toggles Pure View (zero chrome!)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'h' || e.key === 'H') {
        setPureView((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.thermal = thermal;
  }, [thermal]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.autoOrbit = autoOrbit;
  }, [autoOrbit]);

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
  const activeZoomIdx = Math.round(zoom);
  const cpuPct = Math.round(telemetry.cpuTotal * 100);
  const netLabel =
    telemetry.netKBps >= 1024 ? `${(telemetry.netKBps / 1024).toFixed(1)} MB/s` : `${telemetry.netKBps.toFixed(0)} KB/s`;

  return (
    <div className="apple-stage">
      {/* Full-Bleed 2-Pass WebGL2 GPU Raymarched Viewport */}
      <div ref={mountRef} className="raymarch-mount" />

      {/* Whisper-Thin Platinum Microscope Reticle */}
      <MicroscopeReticle zoom={zoom} dialDeg={dialDeg} />

      {/* Pure View Restore Pill */}
      {pureView && (
        <button
          className="restore-hud-btn liquid-glass"
          onClick={() => setPureView(false)}
          title="Show Interface (H)"
        >
          <Eye size={13} />
          Show UI
        </button>
      )}

      {/* Minimalist Liquid-Glass Chrome */}
      <div className={`hud-chrome ${pureView ? 'hidden' : ''}`}>
        {/* Top Bar: Bare Editorial Identity + Sleek Monochrome Tool Capsule */}
        <div className="hud-top">
          <div className="editorial-brand">
            <div className="editorial-title-row">
              <span className="live-pulse" />
              <span className="editorial-name">{telemetry.chipName}</span>
            </div>
            <div className="editorial-meta">
              {cpuPct}% CPU · {telemetry.memUsedGB}/{telemetry.memTotalGB} GB · {netLabel}
            </div>
          </div>

          <div className="tool-capsule liquid-glass">
            <button
              className={`glass-btn ${showActivity ? 'active' : ''}`}
              onClick={() => setShowActivity((v) => !v)}
              title="Inspect live per-core activity and top processes"
            >
              <Activity size={13} />
              Activity
            </button>
            <button
              className={`glass-btn ${bursting ? 'active' : ''}`}
              onClick={triggerMacBurst}
              title="Run a 3.5-second multi-core burst on your Mac"
            >
              <Zap size={13} />
              {bursting ? 'Bursting' : 'Burst'}
            </button>
            <div className="capsule-divider" />
            <button
              className={`glass-btn ${thermal ? 'active' : ''}`}
              onClick={() => setThermal((v) => !v)}
              title="Infrared Thermal Vision"
            >
              <Flame size={13} />
              Thermal
            </button>
            <button
              className={`glass-btn ${autoOrbit ? 'active' : ''}`}
              onClick={() => setAutoOrbit((v) => !v)}
              title="Toggle 3D Orbit"
            >
              <Rotate3d size={13} />
              Orbit
            </button>
            <button
              className="glass-btn icon-only"
              onClick={() => setPureView(true)}
              title="Pure View — Hide UI (H)"
            >
              <EyeOff size={13} />
            </button>
          </div>
        </div>

        {/* On-Demand Monochrome Activity Sheet (Closed by Default!) */}
        {showActivity && (
          <div className="activity-sheet liquid-glass">
            <div className="sheet-header">
              <span>
                {telemetry.pCoreCount}P + {telemetry.eCoreCount}E CORES
              </span>
              <span>{telemetry.live ? 'LIVE' : 'SIM'}</span>
            </div>

            <div className="tick-meter" title="Live per-core CPU utilization">
              {telemetry.coreLoads.slice(0, 12).map((load, idx) => {
                const isE = idx < telemetry.eCoreCount;
                const pct = Math.max(10, Math.round(load * 100));
                return (
                  <div key={idx} className="tick-col">
                    <div className="tick-bar-track">
                      <div
                        className="tick-bar-fill"
                        style={{
                          height: `${pct}%`,
                          opacity: 0.35 + load * 0.65,
                        }}
                      />
                    </div>
                    <span className="tick-lbl">{isE ? `E${idx}` : `P${idx - telemetry.eCoreCount}`}</span>
                  </div>
                );
              })}
            </div>

            <div className="proc-list">
              {telemetry.topProcs.slice(0, 3).map((p, i) => (
                <div key={i} className="proc-row">
                  <span className="proc-name">{p.name}</span>
                  <span className="proc-cpu">{p.cpu.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Single-Row 44px Floating VisionOS Rail */}
        <div className="hud-bottom">
          <div className="floating-scale-caption">
            {sizeText} · {magText}
          </div>
          <div className="zoom-rail liquid-glass">
            {ZOOM_STOPS.map((st, idx) => (
              <button
                key={st.label}
                className={`rail-stop ${activeZoomIdx === idx ? 'active' : ''}`}
                onClick={() => engineRef.current?.flyToZoom(st.z)}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
