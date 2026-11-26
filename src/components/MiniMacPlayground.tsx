import React, { useEffect, useRef, useState } from 'react';
import { Brain, Cpu, Keyboard, MousePointer2, Music, Sparkles } from 'lucide-react';
import { BlockId, CHIP_BLOCKS, ChipSimulator } from '../sim/chipSim';

interface MiniMacPlaygroundProps {
  sim: ChipSimulator;
  uiTick: number;
}

function playSynthChord(): void {
  try {
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const notes = [261.63, 329.63, 392.0, 493.88, 587.33]; // Lush Cmaj9 chime
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.035);
      gain.gain.setValueAtTime(0.0001, now + i * 0.035);
      gain.gain.exponentialRampToValueAtTime(0.035, now + i * 0.035 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.035 + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.035);
      osc.stop(now + i * 0.035 + 0.75);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // ignore audio restrictions
  }
}

export const MiniMacPlayground: React.FC<MiniMacPlaygroundProps> = ({ sim }) => {
  const [noteText, setNoteText] = useState('Try typing here!');
  const [lastKeyInfo, setLastKeyInfo] = useState<{ char: string; bin: string } | null>(null);
  const [aiFlash, setAiFlash] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const hueRef = useRef(175);

  const clearPad = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
  }, []);

  const handlePadPointer = (e: React.PointerEvent<HTMLCanvasElement>, isDraw: boolean) => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const px = nx * c.width;
    const py = ny * c.height;

    if (isDraw) {
      const ctx = c.getContext('2d');
      if (ctx) {
        hueRef.current = (hueRef.current + 2.5) % 360;
        ctx.strokeStyle = `hsl(${hueRef.current}, 95%, 64%)`;
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 12;
        ctx.shadowColor = `hsl(${hueRef.current}, 95%, 60%)`;
        ctx.beginPath();
        if (lastPtRef.current) {
          ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
          ctx.lineTo(px, py);
        } else {
          ctx.moveTo(px, py);
          ctx.lineTo(px + 0.5, py + 0.5);
        }
        ctx.stroke();
      }
      lastPtRef.current = { x: px, y: py };
      sim.triggerGpuDraw(nx, ny);
    } else {
      sim.triggerCursorMove(nx, ny);
    }
  };

  const meters: { id: BlockId; label: string }[] = [
    { id: 'pCores', label: 'P-Cores' },
    { id: 'eCores', label: 'E-Cores' },
    { id: 'gpu', label: '16× GPU' },
    { id: 'npu', label: 'Neural AI' },
    { id: 'ramL', label: 'Unified RAM' },
    { id: 'io', label: 'USB / I/O' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-row">
          <div className="logo-badge">3nm</div>
          <div>
            <div className="logo-title">SILICON // 3NM</div>
            <div className="logo-sub">Interact here → watch the 3D chip react</div>
          </div>
        </div>
      </div>

      {/* 1. Mini Notes App (Keyboard -> I/O -> E-Core -> RAM -> GPU) */}
      <div className="mac-win">
        <div className="mac-win-bar">
          <div className="mac-dots">
            <span className="dot r" />
            <span className="dot y" />
            <span className="dot g" />
          </div>
          <div className="mac-win-title">
            <Keyboard size={12} color="#4eff9b" />
            Notes (Type Anything)
          </div>
          <span className="mac-win-badge">I/O → E-Core</span>
        </div>
        <textarea
          className="notes-area"
          value={noteText}
          placeholder="Type a word to watch binary bits travel into the chip..."
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') {
              const ch = e.key.length === 1 ? e.key : e.key === 'Enter' ? 'ENTER' : 'DEL';
              const code = e.key.length === 1 ? e.key.charCodeAt(0) : e.key === 'Enter' ? 13 : 8;
              setLastKeyInfo({
                char: ch === ' ' ? 'SPACE' : ch,
                bin: (code & 0xff).toString(2).padStart(8, '0'),
              });
              sim.triggerKeypress(e.key.length === 1 ? e.key : ch);
            }
          }}
        />
        <div className="binary-strip">
          <span>{lastKeyInfo ? `Last Key: ${lastKeyInfo.char}` : 'Type to send live binary'}</span>
          <strong>{lastKeyInfo ? lastKeyInfo.bin : '01001000'}</strong>
        </div>
      </div>

      {/* 2. Mini Trackpad & GPU Brush Canvas */}
      <div className="mac-win">
        <div className="mac-win-bar">
          <div className="mac-dots">
            <span className="dot r" />
            <span className="dot y" />
            <span className="dot g" />
          </div>
          <div className="mac-win-title">
            <MousePointer2 size={12} color="#29f2d8" />
            Cursor &amp; GPU Canvas
          </div>
          <span className="mac-win-badge">E-Core / GPU</span>
        </div>
        <div className="pad-wrap">
          <canvas
            ref={canvasRef}
            className="pad-canvas"
            onPointerDown={(e) => {
              drawingRef.current = true;
              lastPtRef.current = null;
              e.currentTarget.setPointerCapture(e.pointerId);
              handlePadPointer(e, true);
            }}
            onPointerMove={(e) => handlePadPointer(e, drawingRef.current)}
            onPointerUp={() => {
              drawingRef.current = false;
              lastPtRef.current = null;
            }}
          />
          <button className="pad-clear" onClick={clearPad}>
            Clear
          </button>
          <span className="pad-hint">Hover = move cursor (E-Core) · Drag = paint (16× GPU)</span>
        </div>
      </div>

      {/* 3. One-Click Hardware Workload Triggers */}
      <div className="action-grid">
        <button
          className="action-btn"
          onClick={() => {
            setAiFlash(true);
            sim.triggerNeuralAI();
            setTimeout(() => setAiFlash(false), 550);
          }}
          style={aiFlash ? { borderColor: '#c96bff', boxShadow: '0 0 16px rgba(201,107,255,0.3)' } : undefined}
        >
          <div className="action-left">
            <div className="action-icon" style={{ background: 'rgba(201,107,255,0.16)', color: '#c96bff' }}>
              <Brain size={15} />
            </div>
            <div>
              <div className="action-name">Run AI Vision Model</div>
              <div className="action-desc">Matrix multiply on 16-Core NPU</div>
            </div>
          </div>
          <span className="action-tag" style={{ color: '#dfa4ff' }}>
            NPU + RAM
          </span>
        </button>

        <button className="action-btn" onClick={() => sim.triggerHeavyCompute()}>
          <div className="action-left">
            <div className="action-icon" style={{ background: 'rgba(255,179,71,0.16)', color: '#ffb347' }}>
              <Cpu size={15} />
            </div>
            <div>
              <div className="action-name">Heavy Math / Compile Burst</div>
              <div className="action-desc">Turbo all 8 Performance Cores</div>
            </div>
          </div>
          <span className="action-tag" style={{ color: '#ffd38d' }}>
            8× P-Cores
          </span>
        </button>

        <button
          className="action-btn"
          onClick={() => {
            playSynthChord();
            sim.triggerAudioSynth();
          }}
        >
          <div className="action-left">
            <div className="action-icon" style={{ background: 'rgba(255,110,130,0.16)', color: '#ff6e82' }}>
              <Music size={15} />
            </div>
            <div>
              <div className="action-name">Play Audio Synth Chord</div>
              <div className="action-desc">48 kHz waveform via Audio Engine</div>
            </div>
          </div>
          <span className="action-tag" style={{ color: '#ff9aa8' }}>
            Audio DSP
          </span>
        </button>
      </div>

      {/* 4. Live Silicon Telemetry & Per-Unit Activity Meters */}
      <div className="telemetry-card">
        <div className="stat-row">
          <div className="stat-box">
            <div className="stat-lbl">Power</div>
            <div className="stat-val" style={{ color: sim.powerW > 12 ? '#ffb347' : '#29f2d8' }}>
              {sim.powerW.toFixed(1)}W
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-lbl">Die Temp</div>
            <div className="stat-val" style={{ color: sim.tempC > 55 ? '#ff7c6e' : '#e6f0ff' }}>
              {Math.round(sim.tempC)}°C
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-lbl">Clock</div>
            <div className="stat-val">{sim.clockGHz.toFixed(1)}G</div>
          </div>
        </div>

        <div className="meter-list">
          {meters.map((m) => {
            const pct = Math.round(sim.load[m.id] * 100);
            const col = CHIP_BLOCKS[m.id].color;
            return (
              <div key={m.id} className="meter-row">
                <span className="meter-name">{m.label}</span>
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${Math.max(4, pct)}%`, background: col }} />
                </div>
                <span className="meter-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          marginTop: 'auto',
          fontSize: 10.5,
          color: '#7385a3',
          lineHeight: 1.4,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 2px 0 2px',
        }}
      >
        <Sparkles size={13} color="#4cc9ff" style={{ flexShrink: 0 }} />
        <span>
          Scroll on the 3D chip to zoom from <strong>28 mm</strong> down to <strong>3 nm</strong> transistors &amp;
          silicon atoms.
        </span>
      </div>
    </aside>
  );
};
