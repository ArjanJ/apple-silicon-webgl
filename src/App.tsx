import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Pause,
  Play,
  Rotate3d,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { MicroscopeReticle } from './components/MicroscopeReticle';
import { RaymarchEngine } from './shader/RaymarchEngine';
import { formatMagnification, MICRO_CHAPTERS, MicroJourneyState } from './sim/microJourney';

function playAppleTap(freq = 480, muted = false): void {
  if (muted) return;
  try {
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.12, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.025, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
    setTimeout(() => ctx.close().catch(() => {}), 200);
  } catch {
    // ignore
  }
}

const SAMPLE_KEYS = ['A', 'H', 'S', 'Z', '7'];

export function App() {
  const journeyRef = useRef<MicroJourneyState | null>(null);
  if (!journeyRef.current) journeyRef.current = new MicroJourneyState();
  const journey = journeyRef.current;

  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaymarchEngine | null>(null);

  const [zoom, setZoom] = useState(0.0);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [thermal, setThermal] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [muted, setMuted] = useState(false);
  const [manualGate, setManualGate] = useState<boolean | null>(null);
  const [, setTick] = useState(0);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = new RaymarchEngine(mount, journey, {
      onZoomChange: (z) => setZoom(z),
      onChapterChange: (idx) => {
        setChapterIdx(idx);
        playAppleTap(340 + idx * 55, mutedRef.current);
      },
    });
    engineRef.current = engine;

    const timer = window.setInterval(() => {
      setTick((t) => t + 1);
      setPlaying(journey.playing);
    }, 80);

    return () => {
      window.clearInterval(timer);
      engine.dispose();
      engineRef.current = null;
    };
  }, [journey]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.thermal = thermal;
  }, [thermal]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.autoOrbit = autoOrbit;
  }, [autoOrbit]);

  useEffect(() => {
    journey.manualGate = manualGate;
  }, [journey, manualGate]);

  // Press ANY physical key on keyboard to immediately trace that exact letter!
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        journey.playing = false;
        journey.jumpTo(Math.min(MICRO_CHAPTERS.length - 1, journey.chapterIdx + 1));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        journey.playing = false;
        journey.jumpTo(Math.max(0, journey.chapterIdx - 1));
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        journey.playing = !journey.playing;
        setPlaying(journey.playing);
        return;
      }
      if (e.key.length === 1 && /^[a-zA-Z0-9!?]$/.test(e.key)) {
        e.preventDefault();
        playAppleTap(580, mutedRef.current);
        journey.setKey(e.key);
        setPlaying(true);
        setTick((t) => t + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [journey]);

  const chapter = MICRO_CHAPTERS[chapterIdx] ?? MICRO_CHAPTERS[0];
  const { magText, sizeText, dialDeg } = formatMagnification(zoom);
  const progressPct = Math.min(100, (journey.elapsed / Math.max(0.1, chapter.durationSec)) * 100);
  const show3nmCard = zoom >= 3.45;
  const showOutputCard = chapterIdx === 5 && zoom < 0.7;
  const gateIsOn = journey.gateOn > 0.35;

  // Progressive pixel reveal during Chapter 6
  const litCutoff = Math.floor(Math.min(1, journey.elapsed / 1.8) * 38);

  return (
    <div className="apple-stage">
      {/* Full-Bleed GPU 3D Raymarched Microscopic Silicon Viewport */}
      <div ref={mountRef} className="raymarch-mount" />

      {/* Circular Optical / Electron Microscope Reticle + 3nm Dimension Bracket */}
      <MicroscopeReticle zoom={zoom} magText={magText} sizeText={sizeText} dialDeg={dialDeg} />

      {/* Top Apple Frosted-Glass Pills */}
      <div className="hud-top">
        <div className="apple-pill">
          <div className="apple-keycap" title="Press any letter on your keyboard">
            {journey.char}
          </div>
          <div className="brand-stack">
            <div className="brand-headline">
              <span>Silicon Microscope</span>
              <span className="brand-spec">
                {magText} · {sizeText}
              </span>
            </div>
            <div className="brand-sub">
              <span>Press any key to trace</span>
              <div className="key-selector">
                {SAMPLE_KEYS.map((k) => (
                  <button
                    key={k}
                    className={`key-dot ${journey.char === k ? 'active' : ''}`}
                    onClick={() => {
                      playAppleTap(580, muted);
                      journey.setKey(k);
                      setPlaying(true);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="tool-pill">
          <button
            className={`icon-pill-btn ${thermal ? 'active' : ''}`}
            onClick={() => setThermal((v) => !v)}
            title="Toggle Thermal Infrared Vision"
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
          <button
            className="icon-pill-btn"
            onClick={() => setMuted((m) => !m)}
            title={muted ? 'Unmute Sound' : 'Mute Sound'}
            style={{ padding: '6px 9px' }}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
      </div>

      {/* Peak 3nm Magnification: Minimal Apple Gate Voltage Switch Card */}
      {show3nmCard && (
        <div className="floating-glass-card">
          <div className="fg-eyebrow">3 nm GAA Fin Switch · Bit {7 - journey.activeBitIdx}</div>
          <div className="fg-title">
            {(journey.gateOn * 0.72).toFixed(2)}V — {gateIsOn ? 'Conducting (1)' : 'Blocked (0)'}
          </div>
          <div className="fg-body">
            Live binary bits of <strong>'{journey.char}'</strong> ({journey.binary}) switch the gold metal gate
            bridge across the 3 nm channels.
          </div>
          <div className="seg-switch">
            <button className={`seg-opt ${manualGate === null ? 'active' : ''}`} onClick={() => setManualGate(null)}>
              Live
            </button>
            <button className={`seg-opt ${manualGate === true ? 'active' : ''}`} onClick={() => setManualGate(true)}>
              0.72V ON
            </button>
            <button className={`seg-opt ${manualGate === false ? 'active' : ''}`} onClick={() => setManualGate(false)}>
              0V OFF
            </button>
          </div>
        </div>
      )}

      {/* Chapter 6: Optical Display Output Card showing exact pixel matrix of pressed key */}
      {showOutputCard && (
        <div className="floating-glass-card">
          <div className="fg-eyebrow">Display Engine · T+400 µs</div>
          <div className="fg-title">Pixel Output: '{journey.char}'</div>
          <div className="glyph-matrix">
            {journey.glyph.map((row, r) =>
              row.map((val, c) => {
                const idx = r * 5 + c;
                const lit = val === 1 && idx <= litCutoff;
                return <div key={`${r}-${c}`} className={`glyph-px ${lit ? 'lit' : ''}`} />;
              })
            )}
          </div>
          <div className="fg-body" style={{ textAlign: 'center' }}>
            ASCII {journey.ascii} ({journey.binary}) rendered in <strong>0.0004 s</strong>
          </div>
        </div>
      )}

      {/* Bottom Apple Keynote Story Dock */}
      <div className="hud-bottom">
        <div className="story-dock">
          <div className="story-top-line">
            <div className="story-title">{chapter.headline(journey.char, journey.binary)}</div>
            <div className="story-right-meta">
              <span className="time-tag">T+{chapter.timeUs}</span>
              <div className="bin-strip" title={`ASCII ${journey.ascii} = ${journey.binary}`}>
                {journey.binary.split('').map((b, i) => (
                  <span
                    key={i}
                    className={`bin-cell ${b === '1' ? 'one' : ''} ${journey.activeBitIdx === i ? 'active' : ''}`}
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="story-caption">{chapter.caption(journey.char, journey.binary, journey.ascii)}</div>

          <div className="controls-row">
            <div className="transport">
              <button
                className={`t-btn ${playing ? 'white' : ''}`}
                onClick={() => {
                  if (!journey.playing && journey.chapterIdx === MICRO_CHAPTERS.length - 1) {
                    journey.jumpTo(0);
                  }
                  journey.playing = !journey.playing;
                  setPlaying(journey.playing);
                }}
              >
                {playing ? <Pause size={12} /> : <Play size={12} />}
                {playing ? 'Playing' : 'Play'}
              </button>
              <button
                className="t-btn icon"
                onClick={() => {
                  journey.playing = false;
                  setPlaying(false);
                  journey.jumpTo(Math.max(0, chapterIdx - 1));
                }}
                title="Previous Chapter (←)"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="t-btn icon"
                onClick={() => {
                  journey.playing = false;
                  setPlaying(false);
                  journey.jumpTo(Math.min(MICRO_CHAPTERS.length - 1, chapterIdx + 1));
                }}
                title="Next Chapter (→)"
              >
                <ChevronRight size={14} />
              </button>
              <button
                className="t-btn icon"
                onClick={() => {
                  journey.playing = true;
                  setPlaying(true);
                  journey.jumpTo(0);
                }}
                title="Replay Journey"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            <div className="chapter-pills">
              {MICRO_CHAPTERS.map((ch) => {
                const isActive = ch.index === chapterIdx;
                const isDone = ch.index < chapterIdx;
                return (
                  <button
                    key={ch.id}
                    className={`ch-pill ${isActive ? 'active' : isDone ? 'done' : ''}`}
                    onClick={() => journey.jumpTo(ch.index)}
                    title={`${ch.shortLabel} (${ch.magLabel} · ${ch.featureSize})`}
                  >
                    {ch.shortLabel}
                    {isActive && <span className="ch-bar" style={{ width: `${progressPct}%` }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
