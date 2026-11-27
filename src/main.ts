import './styles.css';
import {
  BGM_LEVEL_OPTIONS,
  BgmLevelId,
  MUSIC_VIBES,
  MusicVibeId,
  SiliconAudio,
} from './audio/SiliconAudio';
import { DieInspectHit } from './engine/inspect';
import { SiliconEngine } from './engine/SiliconEngine';
import { BrowserTelemetrySource } from './sim/browserTelemetry';
import { BrowserWorkloadRunner, WORKLOAD_OPTIONS, WorkloadKind } from './sim/browserWorkloads';
import { applyChipPreset, CHIP_PRESETS, ChipPresetId } from './sim/chipPresets';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';
import { RECORDED_TRACES, RecordedTracePlayer, TraceCaptureId } from './sim/recordedTraces';

/**
 * Zero-Overhead Vanilla DOM Controller for Apple Silicon 3D Microscope.
 *   - No React reconciliation or virtual DOM during 120 FPS zoom
 *   - Breathing optical reticle & continuously gliding VisionOS rail indicator
 *   - Whisper-quiet hover preview + click-to-inspect
 *   - Live Native Mach/IOKit telemetry (real GPU %, VRAM, SoC Die Temp, per-core CPU + sparkline)
 */

type RealmId = 'macro' | 'beol' | 'feol' | 'quantum';

interface ZoomStopMeta {
  z: number;
  label: string;
  size: string;
  mag: string;
  realm: RealmId;
}

const ZOOM_STOPS: readonly ZoomStopMeta[] = [
  { z: -1.0, label: 'Package', size: '72 mm', mag: '1×', realm: 'macro' },
  { z: 0.0, label: 'Die', size: '21 mm', mag: '4×', realm: 'macro' },
  { z: 1.0, label: 'Grid', size: '120 µm', mag: '1K×', realm: 'beol' },
  { z: 2.0, label: 'Routing', size: '3.0 µm', mag: '40K×', realm: 'beol' },
  { z: 3.0, label: 'Logic', size: '600 nm', mag: '200K×', realm: 'feol' },
  { z: 4.0, label: 'Cell', size: '120 nm', mag: '1M×', realm: 'feol' },
  { z: 5.0, label: 'Gate', size: '12 nm', mag: '10M×', realm: 'feol' },
  { z: 6.0, label: 'Lattice', size: '0.54 nm', mag: '220M×', realm: 'quantum' },
  { z: 7.0, label: 'Atom', size: '111 pm', mag: '1.1B×', realm: 'quantum' },
  { z: 8.0, label: 'Nucleus', size: '3.1 fm', mag: '40T×', realm: 'quantum' },
  { z: 9.0, label: 'Proton', size: '0.84 fm', mag: '150T×', realm: 'quantum' },
];

const DEPTH_REALMS: readonly { id: RealmId; title: string; range: string }[] = [
  { id: 'macro', title: 'MACRO', range: 'mm' },
  { id: 'beol', title: 'INTERCONNECT', range: 'µm' },
  { id: 'feol', title: 'TRANSISTOR', range: 'nm' },
  { id: 'quantum', title: 'ATOMIC & QUANTUM', range: 'Å → fm' },
];

const VERNIER_MIN_Z = -2.4;
const VERNIER_MAX_Z = 9.0;
const VERNIER_SUBDIVS = 5; // 5 intervals per stop => micro-ticks every 0.2 zoom units

const REALM_ACCENTS: Record<RealmId, { color: string; glow: string }> = {
  macro: { color: '#dce6f5', glow: 'rgba(220, 230, 245, 0.55)' },
  beol: { color: '#f3b172', glow: 'rgba(243, 177, 114, 0.58)' },
  feol: { color: '#7fe2ff', glow: 'rgba(127, 226, 255, 0.62)' },
  quantum: { color: '#c4a1ff', glow: 'rgba(196, 161, 255, 0.65)' },
};

function realmForZoom(z: number): RealmId {
  if (z < 0.5) return 'macro';
  if (z < 2.5) return 'beol';
  if (z < 5.5) return 'feol';
  return 'quantum';
}

const DIAL_TICKS = [
  { deg: -144, label: '1×' },
  { deg: -115, label: '4×' },
  { deg: -86, label: '1K×' },
  { deg: -58, label: '40K×' },
  { deg: -29, label: '200K×' },
  { deg: 0, label: '1M×' },
  { deg: 29, label: '10M×' },
  { deg: 58, label: '220M×' },
  { deg: 86, label: '1.1B×' },
  { deg: 115, label: '40T×' },
  { deg: 144, label: '150T×' },
];

const ICONS = {
  activity: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  zap: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  eyeOff: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
  eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  volumeOn: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  volumeOff: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`,
  music: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  replay: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  power: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>`,
  chevronUp: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
  play: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  stop: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>`,
};

function buildDepthSheetHtml(): string {
  return DEPTH_REALMS.map((realm) => {
    const stops = ZOOM_STOPS.filter((s) => s.realm === realm.id);
    return `
      <div class="depth-realm realm-${realm.id}">
        <div class="depth-realm-head">
          <span class="depth-realm-dot" aria-hidden="true"></span>
          <span class="depth-realm-title">${realm.title}</span>
          <span class="depth-realm-range">${realm.range}</span>
        </div>
        <div class="depth-grid cols-${stops.length}">
          ${stops
            .map(
              (st) => `
              <button type="button" class="depth-tile realm-${st.realm} ${st.z === 0 ? 'active' : ''}" data-z="${st.z}">
                <span class="depth-tile-name">${st.label}</span>
                <span class="depth-tile-meta">${st.size} · ${st.mag}</span>
              </button>`
            )
            .join('')}
        </div>
      </div>
    `;
  }).join('');
}

function buildReticleSvg(): string {
  const r = 242;
  const circ = 2 * Math.PI * r;
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    const r1 = r - (isMajor ? 7 : 3.5);
    const x1 = (270 + Math.cos(ang) * r1).toFixed(2);
    const y1 = (270 + Math.sin(ang) * r1).toFixed(2);
    const x2 = (270 + Math.cos(ang) * r).toFixed(2);
    const y2 = (270 + Math.sin(ang) * r).toFixed(2);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${
      isMajor ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.08)'
    }" stroke-width="${isMajor ? '0.9' : '0.5'}"/>`;
  }

  let labels = '';
  for (const tk of DIAL_TICKS) {
    const rad = ((tk.deg - 90) * Math.PI) / 180;
    const tx = (270 + Math.cos(rad) * (r + 16)).toFixed(2);
    const ty = (270 + Math.sin(rad) * (r + 16)).toFixed(2);
    labels += `<text x="${tx}" y="${ty}" fill="rgba(245, 245, 247, 0.32)" font-size="7" font-family="'JetBrains Mono', monospace" font-weight="500" text-anchor="middle" dominant-baseline="middle">${tk.label}</text>`;
  }

  return `
    <svg class="reticle-svg" viewBox="0 0 540 540">
      <circle cx="270" cy="270" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.75" />
      <circle
        id="reticle-arc"
        cx="270"
        cy="270"
        r="${r}"
        fill="none"
        stroke="rgba(245, 245, 247, 0.38)"
        stroke-width="1.25"
        stroke-dasharray="${(circ * 0.04).toFixed(2)} ${circ.toFixed(2)}"
        stroke-linecap="round"
        transform="rotate(-234 270 270)"
      />
      <g id="reticle-dial">${ticks}</g>
      <line x1="259" y1="270" x2="265" y2="270" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" />
      <line x1="275" y1="270" x2="281" y2="270" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" />
      <line x1="270" y1="259" x2="270" y2="265" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" />
      <line x1="270" y1="275" x2="270" y2="281" stroke="rgba(255,255,255,0.18)" stroke-width="0.7" />
      ${labels}
    </svg>
  `;
}

function conciseHoverMetric(hit: DieInspectHit, t: LiveMacTelemetry): string {
  if (hit.id.startsWith('pcore-')) {
    const idx = Number(hit.id.slice(6)) || 0;
    const pCount = Math.max(2, Math.min(12, t.pCoreCount || 8));
    const eOff = Math.min(t.eCoreCount, Math.max(0, t.coreLoads.length - pCount));
    const load = t.coreLoads[eOff + idx] ?? t.pCoreAvg;
    return `${Math.round(load * 100)}%`;
  }
  if (hit.id === 'ecores') return `${Math.round(t.eCoreAvg * 100)}%`;
  if (hit.id === 'gpu') return `${Math.round(t.gpuEst * 100)}%`;
  if (hit.id === 'slc') return `${t.slcMB ?? 48} MB SRAM`;
  if (hit.id === 'ane') return '16C Matrix';
  if (hit.id === 'media') return 'ProRes';
  if (hit.id === 'io-phy') return t.netKBps >= 1024 ? `${(t.netKBps / 1024).toFixed(1)} MB/s` : `${t.netKBps.toFixed(0)} KB/s`;
  if (hit.id.startsWith('ram-')) return `${t.memUsedGB.toFixed(0)}/${t.memTotalGB} GB`;
  if (hit.id === 'us-quarter') return '24.26 mm · 1:1';
  if (hit.id === 'smd-caps') return '0.72 V';
  return '';
}

function mountApp(): void {
  const root = document.getElementById('root');
  if (!root) return;

  const isTouchDevice =
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window;
  const isMacPlatform = /Mac|Macintosh/i.test(navigator.platform || navigator.userAgent);

  root.innerHTML = `
    <div class="apple-stage">
      <div id="gpu-mount" class="raymarch-mount"></div>

      <div id="reticle-layer" class="reticle-layer intro-hidden" aria-hidden="true">
        ${buildReticleSvg()}
        <div id="nm-bracket" class="nm-bracket" style="opacity:0;pointer-events:none;display:none;">
          <div class="nm-line"></div>
          <div class="nm-stack">
            <div id="nm-label" class="nm-label">12 nm Gate · 5 nm GAA Ribbon</div>
            <div id="nm-analogy" class="nm-analogy"></div>
          </div>
          <div class="nm-line"></div>
        </div>
      </div>

      <!-- "First Light" Mysterious Whisper Title (Emerges out of darkness, dissolves before full reveal) -->
      <div id="intro-title" class="intro-title" aria-hidden="true">
        <div id="intro-eyebrow" class="intro-eyebrow">${isMacPlatform ? 'INSIDE YOUR MAC' : 'SILICON ARCHITECTURE'}</div>
        <div id="intro-chip-name" class="intro-chip-name">Apple Silicon</div>
        <div id="intro-boot-cue" class="intro-boot-cue">
          <div class="boot-pill">
            <span class="boot-pill-icon">${ICONS.power}</span>
            <span class="boot-pill-label">Power On</span>
          </div>
          <div class="boot-subhint">${isTouchDevice ? 'Tap anywhere to begin' : 'Click anywhere or press any key'}</div>
        </div>
      </div>

      <!-- Whisper-Quiet Hover Preview Pill -->
      <div id="hover-pill" class="hover-pill" aria-hidden="true">
        <span id="hover-title" class="hover-title"></span>
        <span class="hover-sep">·</span>
        <span id="hover-val" class="hover-val"></span>
      </div>

      <button id="restore-hud-btn" class="restore-hud-btn liquid-glass" title="Show Interface (H)" aria-label="Show Interface" style="display:none;">
        ${ICONS.eye}
        <span>Show UI</span>
      </button>

      <div id="hud-chrome" class="hud-chrome intro-staging">
        <div class="hud-top">
          <div id="editorial-brand" class="editorial-brand" title="Replay Power-On (R)">
            <span id="chip-name" class="editorial-name">Apple Silicon</span>
            <div id="editorial-meta" class="editorial-meta">Initializing…</div>
          </div>

          <div class="tool-capsule liquid-glass">
            <button id="btn-dive" class="glass-btn" title="Powers of Ten Auto-Dive: Package to Proton (Space)" aria-label="Auto-Dive">
              <span id="btn-dive-icon" class="btn-icon">${ICONS.play}</span><span id="btn-dive-lbl" class="btn-label">Dive</span>
            </button>
            <button id="btn-activity" class="glass-btn" title="Inspect per-core CPU, GPU, and die thermal telemetry" aria-label="Activity Telemetry">
              ${ICONS.activity}<span class="btn-label">Activity</span>
            </button>
            <button id="btn-burst" class="glass-btn" title="Run a 3.5-second multi-core Web Worker burst" aria-label="Hardware Burst">
              ${ICONS.zap}<span id="btn-burst-lbl" class="btn-label">Burst</span>
            </button>
            <div class="capsule-divider"></div>
            <button id="btn-vibe" class="glass-btn icon-only" title="Soundtrack Vibes (V)" aria-label="Soundtrack Vibes">
              ${ICONS.music}
            </button>
            <button id="btn-sound" class="glass-btn icon-only" title="Sound (M)" aria-label="Toggle Sound">
              ${ICONS.volumeOn}
            </button>
            <button id="btn-pure" class="glass-btn icon-only" title="Pure View — Hide UI (H)" aria-label="Pure View">
              ${ICONS.eyeOff}
            </button>
          </div>
        </div>

        <div id="sound-sheet" class="sound-sheet liquid-glass liquid-glass-sheet" style="display:none;">
          <div class="sheet-header">
            <span>SOUNDTRACK</span>
            <span id="sound-vibe-badge">F DORIAN · 100 BPM</span>
          </div>
          <div id="vibe-list" class="vibe-list" role="radiogroup" aria-label="Soundtrack Vibe">
            ${MUSIC_VIBES.map(
              (v) => `
                <button class="vibe-row" data-vibe="${v.id}" role="radio" aria-checked="false">
                  <div class="vibe-row-top">
                    <span class="vibe-row-name">${v.name}</span>
                    <span class="vibe-dot" aria-hidden="true"></span>
                  </div>
                  <div class="vibe-row-sub">${v.tagline}</div>
                </button>`
            ).join('')}
          </div>
          <div class="sheet-controls">
            <div class="sheet-control-row">
              <div class="sheet-control-lbl">
                <span>BACKGROUND LOOP</span>
                <span id="bgm-level-hint" class="sheet-control-hint">Quiet</span>
              </div>
              <div id="bgm-level-seg" class="seg-group" role="tablist" aria-label="Background Music Loop Level">
                ${BGM_LEVEL_OPTIONS.map(
                  (opt) =>
                    `<button class="seg-btn" data-bgm="${opt.id}" title="Background music loop: ${opt.label}">${opt.label}</button>`
                ).join('')}
              </div>
            </div>
          </div>
          <button id="btn-replay-intro" class="sound-replay-btn" title="Watch & hear the Cold Boot intro with this vibe (R)">
            ${ICONS.replay}
            <span>Replay Cold Boot Intro</span>
          </button>
        </div>

        <div id="activity-sheet" class="activity-sheet liquid-glass liquid-glass-sheet" style="display:none;">
          <div class="sheet-header">
            <span id="sheet-cores">8P + 2E CORES</span>
            <span id="sheet-fps">120 FPS · LIVE</span>
          </div>
          <div id="tick-meter" class="tick-meter" title="Live per-core CPU utilization"></div>
          <div class="sparkline-box">
            <div class="sparkline-legend">
              <span>CPU / GPU TREND</span>
              <span id="spark-readout">—</span>
            </div>
            <svg class="sparkline-svg" viewBox="0 0 220 28" preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgba(245, 245, 247, 0.22)" />
                  <stop offset="100%" stop-color="rgba(245, 245, 247, 0.0)" />
                </linearGradient>
              </defs>
              <polygon id="spark-cpu-area" fill="url(#sparkFill)" points="" />
              <polyline id="spark-gpu-line" fill="none" stroke="rgba(125, 212, 255, 0.52)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" points="" />
              <polyline id="spark-cpu-line" fill="none" stroke="rgba(245, 245, 247, 0.88)" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" points="" />
            </svg>
          </div>
          <div id="gpu-thermal-row" class="sheet-hw-row">
            <div class="hw-metric">
              <span class="hw-lbl" id="hw-gpu-lbl">GPU</span>
              <span class="hw-val" id="hw-gpu-val">—</span>
            </div>
            <div class="hw-metric">
              <span class="hw-lbl">VRAM</span>
              <span class="hw-val" id="hw-vram-val">—</span>
            </div>
            <div class="hw-metric">
              <span class="hw-lbl">DIE TEMP</span>
              <span class="hw-val" id="hw-temp-val">—</span>
            </div>
          </div>
          <div id="proc-list" class="proc-list"></div>
          <div class="sheet-controls">
            <div class="sheet-control-row">
              <div class="sheet-control-lbl">
                <span>TELEMETRY</span>
                <span id="source-hint" class="sheet-control-hint">Live Device</span>
              </div>
              <div id="source-seg" class="seg-group" role="tablist" aria-label="Telemetry Source">
                <button class="seg-btn active" data-source="live" title="Live telemetry from this device">Live</button>
                ${RECORDED_TRACES.map(
                  (tr) =>
                    `<button class="seg-btn" data-source="${tr.id}" title="Recorded real Apple M1 Max IOKit capture: ${tr.captureName}">${tr.shortLabel}</button>`
                ).join('')}
              </div>
            </div>
            <div class="sheet-control-row">
              <div class="sheet-control-lbl">
                <span>SILICON DIE</span>
                <span id="chip-spec-hint" class="sheet-control-hint">Auto</span>
              </div>
              <div id="chip-seg" class="seg-group" role="tablist" aria-label="Apple Silicon Floorplan">
                ${CHIP_PRESETS.map(
                  (cp) =>
                    `<button class="seg-btn ${cp.id === 'auto' ? 'active' : ''}" data-chip="${cp.id}" title="${
                      cp.id === 'auto'
                        ? 'Match detected hardware or active trace'
                        : `${cp.chipName} · ${cp.pCoreCount}P+${cp.eCoreCount}E · ${cp.gpuCores}C GPU · ${cp.memTotalGB} GB`
                    }">${cp.shortLabel}</button>`
                ).join('')}
              </div>
            </div>
            <div class="sheet-control-row">
              <div class="sheet-control-lbl">
                <span>BURST WORKLOAD</span>
                <span id="workload-hint" class="sheet-control-hint">Ready</span>
              </div>
              <div id="workload-seg" class="seg-group" role="tablist" aria-label="Hardware Burst Workload">
                ${WORKLOAD_OPTIONS.map(
                  (wl) =>
                    `<button class="seg-btn ${wl.id === 'compute' ? 'active' : ''}" data-workload="${wl.id}" title="${wl.title}">${wl.shortLabel}</button>`
                ).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Interactive Die Block Inspector Card (Appears on Click) -->
        <div id="inspect-card" class="inspect-card liquid-glass liquid-glass-sheet" style="display:none;">
          <div class="inspect-head">
            <div>
              <div id="inspect-title" class="inspect-title">Performance Core P0</div>
              <div id="inspect-sub" class="inspect-sub">Apple M1 Max</div>
            </div>
            <button id="inspect-close" class="inspect-close" title="Close (Esc)">${ICONS.close}</button>
          </div>
          <div id="inspect-metric" class="inspect-metric">—</div>
          <p id="inspect-detail" class="inspect-detail"></p>
          <div class="inspect-actions">
            <button id="inspect-dive" class="inspect-dive-btn">Dive Inside →</button>
            <button id="inspect-wake" class="inspect-wake-btn" style="display:none;">${ICONS.zap}<span id="inspect-wake-lbl">Wake Core</span></button>
          </div>
        </div>

        <!-- 1-Tap Liquid Glass Depth Map Sheet (Opens from Vernier Readout) -->
        <div id="depth-sheet" class="depth-sheet liquid-glass liquid-glass-sheet" style="display:none;" role="dialog" aria-label="Microscope Depth Map">
          <div class="sheet-header">
            <span>DEPTH MAP</span>
            <span>72 mm → 0.84 fm</span>
          </div>
          <div class="depth-realms">
            ${buildDepthSheetHtml()}
          </div>
        </div>

        <!-- Calibrated Zeiss/FEI Optical Scale Bar (Desktop bottom-right) -->
        <div id="zeiss-scale" class="zeiss-scale" aria-hidden="true">
          <div id="zeiss-scale-lbl" class="zeiss-scale-lbl">10 mm</div>
          <div id="zeiss-scale-bar" class="zeiss-scale-bar" style="width:84px;"></div>
        </div>

        <div class="hud-bottom">
          <div id="vernier-dock" class="vernier-dock" data-realm="macro">
            <button
              id="vernier-readout"
              class="vernier-readout"
              type="button"
              aria-expanded="false"
              aria-controls="depth-sheet"
              title="Open 1-tap Depth Map (G)"
            >
              <span class="vernier-realm-dot" aria-hidden="true"></span>
              <span id="vernier-mag" class="vernier-mag">4×</span>
              <span class="vernier-sep" aria-hidden="true">·</span>
              <span id="vernier-size" class="vernier-size">21 mm</span>
              <span class="vernier-chev" aria-hidden="true">${ICONS.chevronUp}</span>
            </button>

            <div
              id="vernier-capsule"
              class="vernier-capsule"
              role="slider"
              aria-label="Microscope Magnification Dial"
              aria-valuemin="${VERNIER_MIN_Z}"
              aria-valuemax="${VERNIER_MAX_Z}"
              aria-valuenow="0"
              tabindex="0"
            >
              <div id="vernier-loupe" class="vernier-loupe" aria-hidden="true"></div>
              <div class="vernier-hairline" aria-hidden="true">
                <span class="vernier-pip"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Direct DOM references (zero virtual DOM overhead!)
  const gpuMount = document.getElementById('gpu-mount')!;
  const reticleLayer = document.getElementById('reticle-layer')!;
  const reticleArc = document.getElementById('reticle-arc')!;
  const reticleDial = document.getElementById('reticle-dial')!;
  const nmBracket = document.getElementById('nm-bracket')!;
  const nmLabel = document.getElementById('nm-label')!;
  const nmAnalogy = document.getElementById('nm-analogy')!;

  const vernierDockEl = document.getElementById('vernier-dock')!;
  const vernierReadoutBtn = document.getElementById('vernier-readout') as HTMLButtonElement;
  const vernierMagEl = document.getElementById('vernier-mag')!;
  const vernierSizeEl = document.getElementById('vernier-size')!;
  const vernierCapsuleEl = document.getElementById('vernier-capsule')!;
  const vernierLoupeEl = document.getElementById('vernier-loupe')!;
  const depthSheet = document.getElementById('depth-sheet')!;
  const depthTileButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#depth-sheet .depth-tile'));
  const zeissScaleBarEl = document.getElementById('zeiss-scale-bar')!;
  const zeissScaleLblEl = document.getElementById('zeiss-scale-lbl')!;

  const toolCapsuleEl = document.querySelector<HTMLElement>('.tool-capsule')!;
  const toolButtons = Array.from(toolCapsuleEl.querySelectorAll<HTMLButtonElement>('.glass-btn'));

  const hoverPill = document.getElementById('hover-pill')!;
  const hoverTitleEl = document.getElementById('hover-title')!;
  const hoverValEl = document.getElementById('hover-val')!;

  const editorialBrandEl = document.getElementById('editorial-brand')!;
  const chipNameEl = document.getElementById('chip-name')!;
  const appleStageEl = document.querySelector<HTMLElement>('.apple-stage')!;
  const introTitleEl = document.getElementById('intro-title')!;
  const introEyebrowEl = document.getElementById('intro-eyebrow')!;
  const introChipNameEl = document.getElementById('intro-chip-name')!;
  const introBootCueEl = document.getElementById('intro-boot-cue')!;
  const editorialMetaEl = document.getElementById('editorial-meta')!;
  const hudChromeEl = document.getElementById('hud-chrome')!;
  const restoreHudBtn = document.getElementById('restore-hud-btn')!;

  const btnDive = document.getElementById('btn-dive')!;
  const btnDiveIcon = document.getElementById('btn-dive-icon')!;
  const btnDiveLbl = document.getElementById('btn-dive-lbl')!;
  const btnActivity = document.getElementById('btn-activity')!;
  const btnBurst = document.getElementById('btn-burst')!;
  const btnBurstLbl = document.getElementById('btn-burst-lbl')!;
  const btnVibe = document.getElementById('btn-vibe')!;
  const btnSound = document.getElementById('btn-sound')!;
  const btnPure = document.getElementById('btn-pure')!;

  const soundSheet = document.getElementById('sound-sheet')!;
  const soundVibeBadge = document.getElementById('sound-vibe-badge')!;
  const bgmLevelHint = document.getElementById('bgm-level-hint')!;
  const btnReplayIntro = document.getElementById('btn-replay-intro')!;
  const vibeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#vibe-list .vibe-row'));
  const bgmLevelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#bgm-level-seg .seg-btn'));

  const activitySheet = document.getElementById('activity-sheet')!;
  const sheetCoresEl = document.getElementById('sheet-cores')!;
  const sheetFpsEl = document.getElementById('sheet-fps')!;
  const tickMeterEl = document.getElementById('tick-meter')!;
  const sparkReadoutEl = document.getElementById('spark-readout')!;
  const sparkCpuLine = document.getElementById('spark-cpu-line')!;
  const sparkCpuArea = document.getElementById('spark-cpu-area')!;
  const sparkGpuLine = document.getElementById('spark-gpu-line')!;
  const hwGpuLbl = document.getElementById('hw-gpu-lbl')!;
  const hwGpuVal = document.getElementById('hw-gpu-val')!;
  const hwVramVal = document.getElementById('hw-vram-val')!;
  const hwTempVal = document.getElementById('hw-temp-val')!;
  const procListEl = document.getElementById('proc-list')!;
  const sourceHintEl = document.getElementById('source-hint')!;
  const chipSpecHintEl = document.getElementById('chip-spec-hint')!;
  const workloadHintEl = document.getElementById('workload-hint')!;
  const sourceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#source-seg .seg-btn'));
  const chipButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#chip-seg .seg-btn'));
  const workloadButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#workload-seg .seg-btn'));

  const inspectCard = document.getElementById('inspect-card')!;
  const inspectTitle = document.getElementById('inspect-title')!;
  const inspectSub = document.getElementById('inspect-sub')!;
  const inspectMetric = document.getElementById('inspect-metric')!;
  const inspectDetail = document.getElementById('inspect-detail')!;
  const inspectClose = document.getElementById('inspect-close')!;
  const inspectDive = document.getElementById('inspect-dive')!;
  const inspectWake = document.getElementById('inspect-wake')!;
  const inspectWakeLbl = document.getElementById('inspect-wake-lbl')!;

  let telemetry: LiveMacTelemetry = { ...DEFAULT_TELEMETRY };
  let activeInspect: DieInspectHit | null = null;
  let activeHover: DieInspectHit | null = null;
  let showActivity = false;
  let showSoundSheet = false;
  let showDepthSheet = false;
  let pureView = false;
  let tourActive = false;
  let bursting = false;
  let activeSource: 'live' | TraceCaptureId = 'live';
  let activeChipPreset: ChipPresetId = 'auto';
  let selectedWorkload: WorkloadKind = 'compute';
  let activePinnedPCore: number | null = null;
  let lastRawSample: LiveMacTelemetry | null = null;
  let lastZoomRendered = -99;
  let lastActiveStop = 1;
  let lastActiveRealm: RealmId = 'macro';
  let lastFpsUpdate = 0;
  let currentFps = 120;

  // Rolling 32-sample telemetry history for crisp Activity micro-sparkline
  const SPARK_MAX = 32;
  const cpuHistory: number[] = Array(SPARK_MAX).fill(0.16);
  const gpuHistory: number[] = Array(SPARK_MAX).fill(0.18);

  // Optical Vernier Dial state (Retina WebGL2 text strip composited directly UNDER the rounded Liquid Glass magnifier!)
  let vernierPitch = 90;
  let vernierCoastRaf = 0;
  let vernierScrubbing = false;
  let vernierCanvas: HTMLCanvasElement | null = null;
  let vernierStopPillWidths: number[] = ZOOM_STOPS.map(() => 64);
  let vernierStripBox = { cx: 0, cy: 0, hw: 0, hh: 27 };
  let loupeAnchor = { cx: 0, cy: 0, baseH: 34 };
  let loupeGlassBox = { cx: 0, cy: 0, hw: 0, hh: 17 };
  let lastLoupeW = 0;
  let lastLoupeH = 0;

  type GlassReg = {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
    radius: number;
    bevel: number;
    frost: number;
    style: 0 | 1 | 2 | 3;
    alpha: number;
  };
  let staticGlassBase: GlassReg[] = [];
  let staticGlassElevated: GlassReg[] = [];
  let pushGlassToEngine: () => void = () => {};
  let refreshGlassLayout: () => void = () => {};
  let refreshSoundSheetUi: () => void = () => {};

  const syncSoundButton = (active: boolean, muted: boolean) => {
    btnSound.innerHTML = muted ? ICONS.volumeOff : ICONS.volumeOn;
    btnSound.classList.toggle('active', active);
    btnSound.title = active ? 'Mute Sound (M)' : muted ? 'Unmute Sound (M)' : 'Enable Sound (M)';
    refreshSoundSheetUi();
    refreshGlassLayout();
  };

  const audio = new SiliconAudio(syncSoundButton);
  let suppressNextInspectCloseAudio = false;

  const setDepthSheetOpen = (open: boolean, playSound = true) => {
    if (showDepthSheet === open) return;
    showDepthSheet = open;
    if (open) {
      if (showActivity) {
        showActivity = false;
        btnActivity.classList.remove('active');
        activitySheet.style.display = 'none';
      }
      if (showSoundSheet) {
        showSoundSheet = false;
        btnVibe.classList.remove('active');
        soundSheet.style.display = 'none';
      }
      if (activeInspect && window.innerWidth <= 1080) {
        suppressNextInspectCloseAudio = true;
        engine.clearInspect();
      }
    }
    depthSheet.style.display = showDepthSheet ? 'flex' : 'none';
    vernierReadoutBtn.classList.toggle('open', showDepthSheet);
    vernierReadoutBtn.setAttribute('aria-expanded', showDepthSheet ? 'true' : 'false');
    reticleLayer.classList.toggle('depth-open', showDepthSheet);
    if (playSound) audio.playUiTap(showDepthSheet);
    refreshGlassLayout();
  };

  const computeVernierPitch = (): number => {
    if (window.innerHeight <= 500) return 76;
    if (window.innerWidth <= 720) return 82;
    return 90;
  };

  const computeMorphingLoupeSize = (clampedZ: number): { w: number; h: number } => {
    const pos = Math.max(0, Math.min(ZOOM_STOPS.length - 1, clampedZ + 1));
    const i0 = Math.floor(pos);
    const i1 = Math.min(ZOOM_STOPS.length - 1, i0 + 1);
    const f = pos - i0;
    const s = f * f * (3 - 2 * f);
    const w0 = vernierStopPillWidths[i0] ?? 64;
    const w1 = vernierStopPillWidths[i1] ?? 64;
    // Subtle liquid surface-tension swell while bridging between words or actively scrubbing
    const midBridge = Math.sin(f * Math.PI);
    const scrubBoost = vernierScrubbing ? 1.0 : 0.0;
    const w = w0 + (w1 - w0) * s + midBridge * 4.0 + scrubBoost * 4.0;
    const h = loupeAnchor.baseH + scrubBoost * 2.0 + midBridge * 0.8;
    return { w, h };
  };

  const updateVernierDial = (z: number, magText?: string, sizeText?: string, scaleBarLabel?: string, scaleBarPx?: number) => {
    const clampedZ = Math.max(VERNIER_MIN_Z, Math.min(VERNIER_MAX_Z, z));

    const realm = realmForZoom(clampedZ);
    if (realm !== lastActiveRealm) {
      lastActiveRealm = realm;
      vernierDockEl.dataset.realm = realm;
      const accent = REALM_ACCENTS[realm];
      vernierDockEl.style.setProperty('--realm-accent', accent.color);
      vernierDockEl.style.setProperty('--realm-glow', accent.glow);
    }

    // Morph the single floating center Liquid Glass magnifier pill smoothly to hug the current word
    const { w: loupeW, h: loupeH } = computeMorphingLoupeSize(clampedZ);
    if (Math.abs(loupeW - lastLoupeW) > 0.15 || Math.abs(loupeH - lastLoupeH) > 0.15) {
      lastLoupeW = loupeW;
      lastLoupeH = loupeH;
      vernierLoupeEl.style.width = `${loupeW.toFixed(1)}px`;
      vernierLoupeEl.style.height = `${loupeH.toFixed(1)}px`;
      if (loupeAnchor.cx > 1) {
        loupeGlassBox = {
          cx: loupeAnchor.cx,
          cy: loupeAnchor.cy,
          hw: loupeW * 0.5,
          hh: loupeH * 0.5,
        };
        pushGlassToEngine();
      }
    }

    const stopIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, Math.round(clampedZ) + 1));
    if (stopIdx !== lastActiveStop) {
      depthTileButtons[lastActiveStop]?.classList.remove('active');
      depthTileButtons[stopIdx]?.classList.add('active');
      lastActiveStop = stopIdx;
      vernierCapsuleEl.setAttribute('aria-valuetext', `${ZOOM_STOPS[stopIdx].label} (${ZOOM_STOPS[stopIdx].mag})`);
    }
    vernierCapsuleEl.setAttribute('aria-valuenow', clampedZ.toFixed(2));

    if (magText !== undefined && vernierMagEl.textContent !== magText) {
      vernierMagEl.textContent = magText;
    }
    if (sizeText !== undefined && vernierSizeEl.textContent !== sizeText) {
      vernierSizeEl.textContent = sizeText;
    }
    if (scaleBarLabel !== undefined && zeissScaleLblEl.textContent !== scaleBarLabel) {
      zeissScaleLblEl.textContent = scaleBarLabel;
    }
    if (scaleBarPx !== undefined) {
      zeissScaleBarEl.style.width = `${scaleBarPx.toFixed(1)}px`;
    }
  };

  let uploadVernierStripToEngine: (canvas: HTMLCanvasElement, originCss: number, texWidthCss: number) => void =
    () => {};

  const paintVernierStripTexture = (stripH: number, baseH: number) => {
    const padStops = 1.6;
    const minTexZ = VERNIER_MIN_Z - padStops; // -4.0
    const maxTexZ = VERNIER_MAX_Z + padStops; // 10.6
    const texWidthCss = (maxTexZ - minTexZ) * vernierPitch;
    const originCss = -minTexZ * vernierPitch; // pixel X for z = 0.0

    const maxDpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const dpr = Math.max(1.0, Math.min(maxDpr, 4096 / Math.max(1, texWidthCss)));
    const cw = Math.max(1, Math.round(texWidthCss * dpr));
    const ch = Math.max(1, Math.round(stripH * dpr));

    if (!vernierCanvas) {
      vernierCanvas = document.createElement('canvas');
    }
    vernierCanvas.width = cw;
    vernierCanvas.height = ch;

    const ctx = vernierCanvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, texWidthCss, stripH);

    // 1. Engraved logarithmic ticks along the top band (z = -2.4 .. 9.0 in steps of 0.2)
    const startStep = Math.round(VERNIER_MIN_Z * VERNIER_SUBDIVS);
    const endStep = Math.round(VERNIER_MAX_Z * VERNIER_SUBDIVS);
    const realmTickColors: Record<RealmId, string> = {
      macro: 'rgba(220, 230, 245, 0.78)',
      beol: 'rgba(243, 177, 114, 0.88)',
      feol: 'rgba(127, 226, 255, 0.90)',
      quantum: 'rgba(196, 161, 255, 0.92)',
    };

    for (let s = startStep; s <= endStep; s++) {
      const zVal = s / VERNIER_SUBDIVS;
      const x = originCss + zVal * vernierPitch;
      const isMajor = s % VERNIER_SUBDIVS === 0 && zVal >= -1.0;
      const isHalf = Math.abs(s % VERNIER_SUBDIVS) === 2 || Math.abs(s % VERNIER_SUBDIVS) === 3;
      const realm = realmForZoom(zVal);

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.78)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      if (isMajor) {
        ctx.fillStyle = realmTickColors[realm];
        ctx.fillRect(x - 0.8, 5, 1.6, 8.5);
      } else if (isHalf) {
        ctx.fillStyle = 'rgba(242, 246, 255, 0.38)';
        ctx.fillRect(x - 0.5, 6, 1.0, 6.5);
      } else {
        ctx.fillStyle = 'rgba(242, 246, 255, 0.24)';
        ctx.fillRect(x - 0.5, 7, 1.0, 5.0);
      }
      ctx.restore();
    }

    // 2. Crisp Retina landmark typography centered vertically inside the exact Liquid Glass pill band
    const fontSize = window.innerHeight <= 500 ? 11.5 : window.innerWidth <= 720 ? 13 : 12.5;
    const wordCenterY = stripH - 2 - baseH * 0.5 + 0.5;
    const padX = window.innerWidth <= 720 ? 32 : 34;
    const minPillW = window.innerWidth <= 720 ? 58 : 56;

    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.90)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 1;

    const nextWidths: number[] = [];
    for (let i = 0; i < ZOOM_STOPS.length; i++) {
      const st = ZOOM_STOPS[i];
      const x = originCss + st.z * vernierPitch;
      const textW = ctx.measureText(st.label).width;
      // Extra margin accounts for 1.15x convex magnification inside the rounded Liquid Glass pill!
      nextWidths.push(Math.max(minPillW, textW * 1.15 + padX));
      ctx.fillText(st.label, x, wordCenterY);
    }
    vernierStopPillWidths = nextWidths;

    uploadVernierStripToEngine(vernierCanvas, originCss, texWidthCss);
  };

  const measureVernier = () => {
    vernierPitch = computeVernierPitch();
    vernierCapsuleEl.style.setProperty('--vernier-pitch', `${vernierPitch}px`);

    const baseH = window.innerHeight <= 500 ? 30 : window.innerWidth <= 720 ? 38 : 34;
    vernierLoupeEl.style.height = `${baseH}px`;

    const cr = vernierCapsuleEl.getBoundingClientRect();
    const stripH = Math.max(36, cr.height || (window.innerHeight <= 500 ? 46 : window.innerWidth <= 720 ? 58 : 54));
    vernierStripBox = {
      cx: cr.left + cr.width * 0.5,
      cy: cr.top + cr.height * 0.5,
      hw: cr.width * 0.5,
      hh: cr.height * 0.5,
    };

    const lr = vernierLoupeEl.getBoundingClientRect();
    loupeAnchor = {
      cx: lr.left + lr.width * 0.5,
      cy: lr.top + lr.height * 0.5,
      baseH,
    };

    paintVernierStripTexture(stripH, baseH);

    lastLoupeW = 0;
    lastLoupeH = 0;
    const z = lastZoomRendered === -99 ? 0 : lastZoomRendered;
    const fmt = formatMagnification(z);
    updateVernierDial(z, fmt.magText, fmt.sizeText, fmt.scaleBarLabel, fmt.scaleBarPx);
  };

  const cancelVernierCoast = () => {
    if (vernierCoastRaf) {
      cancelAnimationFrame(vernierCoastRaf);
      vernierCoastRaf = 0;
    }
  };

  // Breathing reticle engagement controller (whisper-quiet at rest, crisp during zoom/drag/dive)
  let reticleEngaged = false;
  let reticleRestTimer: number | null = null;
  const engageReticle = (sustained: boolean) => {
    if (!reticleEngaged) {
      reticleEngaged = true;
      reticleLayer.classList.add('engaged');
    }
    if (reticleRestTimer !== null) {
      window.clearTimeout(reticleRestTimer);
      reticleRestTimer = null;
    }
    if (!sustained) {
      reticleRestTimer = window.setTimeout(() => {
        reticleEngaged = false;
        reticleLayer.classList.remove('engaged');
        reticleRestTimer = null;
      }, 1050);
    }
  };

  const r = 242;
  const circ = 2 * Math.PI * r;

  const getInspectWakeAction = (
    hit: DieInspectHit
  ): { label: string; active: boolean; run: () => void } | null => {
    if (hit.id.startsWith('pcore-')) {
      const idx = Number(hit.id.slice(6)) || 0;
      const isThisPinned = bursting && activePinnedPCore === idx;
      return {
        label: isThisPinned ? `Running P${idx}` : `Wake P${idx}`,
        active: isThisPinned,
        run: () => triggerPinnedCoreWorkload(idx),
      };
    }
    if (hit.id === 'gpu') {
      const isActive = bursting && selectedWorkload === 'gpu' && activePinnedPCore === null;
      return {
        label: isActive ? 'GPU Active' : 'Stress GPU',
        active: isActive,
        run: () => (isActive ? stopActiveWorkload() : triggerWorkload('gpu')),
      };
    }
    if (hit.id === 'ane') {
      const isActive = bursting && selectedWorkload === 'matrix' && activePinnedPCore === null;
      return {
        label: isActive ? 'Matrix Active' : 'Run Matrix',
        active: isActive,
        run: () => (isActive ? stopActiveWorkload() : triggerWorkload('matrix')),
      };
    }
    if (hit.id.startsWith('ram-') || hit.id === 'slc') {
      const isActive = bursting && selectedWorkload === 'memory' && activePinnedPCore === null;
      return {
        label: isActive ? 'Sweeping Bus' : 'Sweep Bus',
        active: isActive,
        run: () => (isActive ? stopActiveWorkload() : triggerWorkload('memory')),
      };
    }
    return null;
  };

  let triggerWorkload: (kind: WorkloadKind) => void = () => {};
  let triggerPinnedCoreWorkload: (coreIdx: number) => void = () => {};
  let stopActiveWorkload: () => void = () => {};

  const renderInspectCard = (syncGlass = true) => {
    if (!activeInspect) {
      if (inspectCard.style.display !== 'none') {
        inspectCard.style.display = 'none';
        syncGlassLayout();
      }
      return;
    }
    const wasHidden = inspectCard.style.display === 'none';
    inspectCard.style.display = 'flex';
    inspectTitle.textContent = activeInspect.title(telemetry);
    inspectSub.textContent = activeInspect.subtitle(telemetry);
    inspectMetric.textContent = activeInspect.metric(telemetry);
    inspectDetail.textContent = activeInspect.detail(telemetry);
    const stopName = ZOOM_STOPS.find((s) => Math.abs(s.z - activeInspect!.diveZoom) < 0.01)?.label ?? 'Die';
    inspectDive.textContent = `Dive to ${stopName} →`;

    const wakeAction = getInspectWakeAction(activeInspect);
    const prevWakeVisible = inspectWake.style.display !== 'none';
    if (wakeAction) {
      inspectWake.style.display = 'inline-flex';
      inspectWakeLbl.textContent = wakeAction.label;
      inspectWake.classList.toggle('active', wakeAction.active);
    } else {
      inspectWake.style.display = 'none';
      inspectWake.classList.remove('active');
    }

    if (syncGlass || wasHidden || prevWakeVisible !== Boolean(wakeAction)) {
      syncGlassLayout();
    }
  };

  const renderHoverPill = (hit: DieInspectHit | null, cx: number, cy: number) => {
    activeHover = hit;
    if (!hit || pureView || (activeInspect && activeInspect.id === hit.id)) {
      hoverPill.classList.remove('visible');
      return;
    }
    hoverTitleEl.textContent = hit.title(telemetry);
    hoverValEl.textContent = conciseHoverMetric(hit, telemetry);
    const clampedX = Math.max(16, Math.min(window.innerWidth - 220, cx + 16));
    const clampedY = Math.max(16, Math.min(window.innerHeight - 54, cy - 32));
    hoverPill.style.transform = `translate3d(${clampedX.toFixed(0)}px, ${clampedY.toFixed(0)}px, 0)`;
    hoverPill.classList.add('visible');
  };

  const telemetryModeBadge = () =>
    telemetry.source === 'capture'
      ? 'CAPTURE'
      : telemetry.nativeTelemetry
        ? 'IOKIT'
        : telemetry.live
          ? 'LIVE'
          : telemetry.gpuTimed
            ? 'GPU TIMED'
            : telemetry.pressureState
              ? 'PRESSURE'
              : 'WEB LIVE';

  let introActive = false;
  let awaitingPowerOn = false;
  let introHudAlpha = 1.0;
  let introPhase: 'idle' | 'black' | 'title' | 'dissolve' | 'boot' | 'lock' | 'hud' | 'settle' | 'done' = 'idle';

  const setAwaitingPowerOn = (waiting: boolean) => {
    awaitingPowerOn = waiting;
    appleStageEl.classList.toggle('awaiting-boot', waiting);
    introBootCueEl.classList.toggle('visible', waiting);
    if (waiting) {
      introTitleEl.classList.remove('exiting', 'skipped');
      introTitleEl.classList.add('visible');
    }
  };

  const syncIntroUi = (active: boolean, elapsed: number) => {
    introActive = active;
    const cues = audio.getVibe().introCues;
    if (awaitingPowerOn && active) {
      introHudAlpha = 0.0;
      reticleLayer.classList.remove('intro-lock', 'engaged');
      reticleLayer.classList.add('intro-hidden');
      hudChromeEl.classList.add('intro-staging');
      nmBracket.style.display = 'none';
      pushGlassToEngine();
      return;
    }
    if (!active) {
      setAwaitingPowerOn(false);
      if (introPhase === 'done' && introHudAlpha >= 0.999) return;
      const wasEarlySkip =
        introPhase === 'black' ||
        introPhase === 'title' ||
        introPhase === 'dissolve' ||
        introPhase === 'boot';
      if (wasEarlySkip || elapsed < cues.durationSec - 0.15) {
        audio.stopIntroScore(0.32);
      }
      introPhase = 'done';
      introHudAlpha = 1.0;
      introTitleEl.classList.remove('visible');
      introTitleEl.classList.add('exiting');
      introTitleEl.classList.toggle('skipped', wasEarlySkip);
      reticleLayer.classList.remove('intro-hidden', 'intro-lock');
      hudChromeEl.classList.remove('intro-staging');
      syncGlassLayout();
      return;
    }

    if (introPhase === 'idle') {
      audio.startIntroScore(elapsed);
    }

    const rawHudU = elapsed < cues.hudSec ? 0.0 : Math.min(1.0, (elapsed - cues.hudSec) / 0.78);
    // Cubic ease-out matches CSS `.hud-chrome` transition so Liquid Glass & DOM text emerge as one object!
    const nextHudAlpha = 1.0 - Math.pow(1.0 - rawHudU, 3);
    const alphaChanged = Math.abs(nextHudAlpha - introHudAlpha) > 0.005;
    introHudAlpha = nextHudAlpha;

    const titleDissolveSec = Math.max(0.85, cues.revealSec - 0.18);
    const settleSec = Math.min(cues.durationSec - 0.18, cues.hudSec + 0.62);

    if (elapsed < 0.06) {
      if (introPhase !== 'black') {
        introPhase = 'black';
        introTitleEl.classList.remove('visible', 'exiting', 'skipped');
        reticleLayer.classList.remove('intro-lock', 'engaged');
        reticleLayer.classList.add('intro-hidden');
        hudChromeEl.classList.add('intro-staging');
        nmBracket.style.display = 'none';
        pushGlassToEngine();
      }
    } else if (elapsed < titleDissolveSec) {
      if (introPhase !== 'title') {
        introPhase = 'title';
        introTitleEl.classList.remove('exiting', 'skipped');
        introTitleEl.classList.add('visible');
        reticleLayer.classList.remove('intro-lock', 'engaged');
        reticleLayer.classList.add('intro-hidden');
        hudChromeEl.classList.add('intro-staging');
        nmBracket.style.display = 'none';
        pushGlassToEngine();
      }
    } else if (elapsed < cues.dropSec) {
      if (introPhase !== 'dissolve') {
        introPhase = 'dissolve';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
      }
    } else if (elapsed < cues.lockSec) {
      if (introPhase !== 'boot') {
        introPhase = 'boot';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
      }
    } else if (elapsed < cues.hudSec) {
      if (introPhase !== 'lock') {
        introPhase = 'lock';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
        reticleLayer.classList.remove('intro-hidden');
        reticleLayer.classList.add('intro-lock');
      }
    } else if (elapsed < settleSec) {
      if (introPhase !== 'hud') {
        introPhase = 'hud';
        reticleLayer.classList.remove('intro-hidden');
        reticleLayer.classList.add('intro-lock');
        hudChromeEl.classList.remove('intro-staging');
        syncGlassLayout();
      }
    } else if (introPhase !== 'settle') {
      introPhase = 'settle';
      reticleLayer.classList.remove('intro-hidden', 'intro-lock');
      hudChromeEl.classList.remove('intro-staging');
      syncGlassLayout();
    }

    if (alphaChanged) {
      pushGlassToEngine();
    }
  };

  const engine = new SiliconEngine(gpuMount, {
    deferIntroStart: true,
    introCues: audio.getVibe().introCues,
    getIntroClockSec: () => audio.getIntroClockSec(),
    onIntroFrame: ({ active, elapsed }) => {
      syncIntroUi(active, elapsed);
    },
    onTourChange: (active) => {
      tourActive = active;
      btnDive.classList.toggle('active', active);
      btnDiveIcon.innerHTML = active ? ICONS.stop : ICONS.play;
      btnDiveLbl.textContent = active ? 'Stop' : 'Dive';
      btnDive.title = active
        ? 'Stop Auto-Dive (Space)'
        : 'Powers of Ten Auto-Dive: Package to Proton (Space)';
      reticleLayer.classList.toggle('diving', active);
      if (!active) {
        engageReticle(false);
      }
      syncGlassLayout();
    },
    onZoomFrame: (z, fps, motion, interacting, yawVel, regionKind) => {
      currentFps = fps;
      audio.updateFrame(z, motion, interacting, yawVel, regionKind, introActive);

      const now = performance.now();
      if (showActivity && now - lastFpsUpdate > 350) {
        lastFpsUpdate = now;
        sheetFpsEl.textContent = `${currentFps} FPS · ${telemetryModeBadge()}`;
      }

      if (!introActive && (interacting || motion > 0.03)) {
        engageReticle(interacting);
      }

      if (Math.abs(z - lastZoomRendered) < 0.0005) return;
      lastZoomRendered = z;

      const { dialDeg, bracketText, bracketAnalogy, bracketOpacity, magText, sizeText, scaleBarLabel, scaleBarPx } =
        formatMagnification(z);
      const frac = Math.max(0.015, Math.min(0.8, ((z + 1) / 10) * 0.8));
      reticleArc.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`);
      reticleDial.setAttribute('transform', `rotate(${(-dialDeg * 0.55).toFixed(2)} 270 270)`);

      if (!introActive && bracketText && bracketOpacity > 0.01) {
        nmBracket.style.display = 'flex';
        nmBracket.style.opacity = bracketOpacity.toFixed(3);
        if (nmLabel.textContent !== bracketText) {
          nmLabel.textContent = bracketText;
        }
        if (bracketAnalogy) {
          if (nmAnalogy.textContent !== bracketAnalogy) {
            nmAnalogy.textContent = bracketAnalogy;
          }
          if (nmAnalogy.style.display === 'none') {
            nmAnalogy.style.display = 'block';
          }
        } else if (nmAnalogy.style.display !== 'none') {
          nmAnalogy.style.display = 'none';
        }
      } else if (nmBracket.style.display !== 'none') {
        nmBracket.style.display = 'none';
      }

      updateVernierDial(z, magText, sizeText, scaleBarLabel, scaleBarPx);
    },
    onInspect: (hit) => {
      const prevId = activeInspect?.id ?? null;
      const nextId = hit?.id ?? null;
      activeInspect = hit;
      // Close colliding sheets when opening an Inspect Card on compact screens
      if (hit && window.innerWidth <= 1080 && showDepthSheet) {
        setDepthSheetOpen(false, false);
      }
      if (hit && window.innerWidth <= 720) {
        if (showActivity) {
          showActivity = false;
          btnActivity.classList.remove('active');
          activitySheet.style.display = 'none';
        }
        if (showSoundSheet) {
          showSoundSheet = false;
          btnVibe.classList.remove('active');
          soundSheet.style.display = 'none';
        }
      }
      if (hit && activeHover && activeHover.id === hit.id) {
        hoverPill.classList.remove('visible');
      }
      if (prevId !== nextId) {
        if (!hit && suppressNextInspectCloseAudio) {
          suppressNextInspectCloseAudio = false;
        } else {
          audio.playInspect(Boolean(hit), nextId ?? undefined);
        }
      }
      renderInspectCard();
    },
    onHover: (hit, clientX, clientY) => {
      renderHoverPill(hit, clientX, clientY);
      const suppressHover = !hit || pureView || (activeInspect && activeInspect.id === hit.id);
      audio.playHover(suppressHover ? null : hit.id, clientX);
    },
  });

  // Sync DOM Liquid Glass bounds to the WebGL2 HDR Refraction Shader (zero CSS backdrop-filter tax!)
  const rectToGlass = (
    el: HTMLElement,
    radius: number,
    bevel: number,
    frost: number,
    style: 0 | 1 | 2,
    alpha = 1.0
  ): GlassReg | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return {
      cx: r.left + r.width * 0.5,
      cy: r.top + r.height * 0.5,
      hw: r.width * 0.5,
      hh: r.height * 0.5,
      radius: Math.min(radius, Math.min(r.width, r.height) * 0.5),
      bevel,
      frost,
      style,
      alpha,
    };
  };

  uploadVernierStripToEngine = (canvas, originCss, texWidthCss) => {
    engine.uploadVernierTexture(canvas, originCss, texWidthCss);
  };

  pushGlassToEngine = () => {
    const hudAlpha = pureView ? 1.0 : introHudAlpha;
    const vernierAlpha = pureView ? 0.0 : introHudAlpha;
    engine.setVernierStrip(
      vernierStripBox.cx,
      vernierStripBox.cy,
      vernierStripBox.hw,
      vernierStripBox.hh,
      vernierPitch,
      loupeGlassBox.hw || 30,
      vernierAlpha
    );

    if (hudAlpha < 0.005) {
      engine.setLiquidGlassRegions([]);
      return;
    }
    const out: GlassReg[] = [];
    for (let i = 0; i < staticGlassBase.length; i++) {
      const g = staticGlassBase[i];
      out.push(hudAlpha < 0.999 ? { ...g, alpha: g.alpha * hudAlpha } : g);
    }
    // Style-3 Rounded Optical Magnifier Glass Pill: genuinely refracts & bends the Retina Vernier text + 3D silicon underneath!
    if (!pureView && loupeGlassBox.hw > 1) {
      out.push({
        cx: loupeGlassBox.cx,
        cy: loupeGlassBox.cy,
        hw: loupeGlassBox.hw,
        hh: loupeGlassBox.hh,
        radius: loupeGlassBox.hh,
        bevel: 0.44,
        frost: 0.0,
        style: 3,
        alpha: hudAlpha,
      });
    }
    for (let i = 0; i < staticGlassElevated.length; i++) {
      const g = staticGlassElevated[i];
      out.push(hudAlpha < 0.999 ? { ...g, alpha: g.alpha * hudAlpha } : g);
    }
    engine.setLiquidGlassRegions(out);
  };

  const syncGlassLayout = () => {
    const base: GlassReg[] = [];
    const elevated: GlassReg[] = [];

    if (pureView) {
      const restore = rectToGlass(restoreHudBtn, 999, 0.24, 1.3, 0, 1.0);
      if (restore) base.push(restore);
    } else {
      const tools = rectToGlass(toolCapsuleEl, 999, 0.25, 1.3, 0, 1.0);
      if (tools) base.push(tools);

      if (showDepthSheet) {
        const sheet = rectToGlass(depthSheet, 24, 0.14, 3.0, 1, 1.0);
        if (sheet) base.push(sheet);
      }
      if (showActivity) {
        const sheet = rectToGlass(activitySheet, 26, 0.14, 3.0, 1, 1.0);
        if (sheet) base.push(sheet);
      }
      if (showSoundSheet) {
        const sheet = rectToGlass(soundSheet, 26, 0.14, 3.0, 1, 1.0);
        if (sheet) base.push(sheet);
      }
      if (activeInspect) {
        const card = rectToGlass(inspectCard, 26, 0.14, 3.0, 1, 1.0);
        if (card) base.push(card);
        const diveBtn = rectToGlass(inspectDive, 999, 0.28, 0.0, 2, 1.0);
        if (diveBtn) elevated.push(diveBtn);
      }
      for (const btn of toolButtons) {
        if (btn.classList.contains('active')) {
          const activeLens = rectToGlass(btn, 999, 0.28, 0.0, 2, 1.0);
          if (activeLens) elevated.push(activeLens);
        }
      }
    }

    staticGlassBase = base;
    staticGlassElevated = elevated;
    pushGlassToEngine();
  };
  refreshGlassLayout = syncGlassLayout;

  const syncViewportLayout = () => {
    measureVernier();
    syncGlassLayout();
  };

  // Re-sync automatically whenever text width, orientation, or mobile visualViewport changes
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncViewportLayout);
    ro.observe(toolCapsuleEl);
    ro.observe(vernierCapsuleEl);
    ro.observe(depthSheet);
    ro.observe(activitySheet);
    ro.observe(soundSheet);
    ro.observe(inspectCard);
  }
  window.addEventListener('resize', syncViewportLayout);
  window.visualViewport?.addEventListener('resize', syncViewportLayout);
  window.addEventListener('orientationchange', () => {
    syncViewportLayout();
    window.setTimeout(syncViewportLayout, 140);
  });
  if (document.fonts && document.fonts.ready) {
    void document.fonts.ready.then(syncViewportLayout);
  }
  syncViewportLayout();

  // Global pointer tracking for dynamic specular rim highlights on curved Liquid Glass edges (desktop pointers only)
  window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    engine.setGlassPointer(ev.clientX, ev.clientY, true);
  });
  window.addEventListener('pointerleave', () => {
    engine.setGlassPointer(0, 0, false);
  });

  // Autoplay-adaptive Cold Boot launch:
  //   - If browser allows unmuted autoplay, starts immediately from 0.0s with full audio
  //   - If browser blocks autoplay (e.g. mobile / aside browser), holds on the title card until first tap/click/key
  //     so the entire Cold Boot light + music sequence plays in perfect sync!
  let powerOnGuardUntil = 0;
  const launchHeldPowerOn = () => {
    if (!awaitingPowerOn) return;
    powerOnGuardUntil = performance.now() + 420;
    setAwaitingPowerOn(false);
    introPhase = 'idle';
    const cues = audio.getVibe().introCues;
    engine.setIntroCues(cues);
    audio.unlockFromGesture();
    // Title is already centered & crisp: cue melts away smoothly and Beat 1 hits immediately (~20ms)!
    engine.releaseIntroHold(cues.heldStartSec);
  };

  if (engine.isIntroHeld) {
    audio.probeAutoplay(
      () => {
        if (!engine.isIntroHeld) return;
        setAwaitingPowerOn(false);
        introPhase = 'idle';
        engine.releaseIntroHold(0.0);
      },
      () => {
        if (!engine.isIntroHeld) return;
        setAwaitingPowerOn(true);
      }
    );
  }

  // Unlock procedural Web Audio smoothly on the first user interaction (unless explicitly muted)
  // Guard prevents paired touchstart -> pointerdown -> click from immediately skipping the Cold Boot intro on mobile!
  const unlockAudioOnGesture = (ev: Event) => {
    if (awaitingPowerOn) {
      if (ev instanceof KeyboardEvent) {
        if (ev.key === 'Escape') {
          setAwaitingPowerOn(false);
          engine.skipIntro();
          return;
        }
        if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.key === 'Shift' || ev.key === 'Meta' || ev.key === 'Control' || ev.key === 'Alt') {
          return;
        }
      }
      ev.stopPropagation();
      launchHeldPowerOn();
      return;
    }
    if (performance.now() < powerOnGuardUntil) {
      if (ev.type === 'pointerdown' || ev.type === 'touchstart') {
        ev.stopPropagation();
      }
      audio.unlockFromGesture();
      return;
    }
    const target = ev.target as HTMLElement | null;
    if (target && (target === btnSound || btnSound.contains(target))) return;
    if (ev instanceof KeyboardEvent && (ev.key === 'm' || ev.key === 'M' || ev.key === 'v' || ev.key === 'V')) return;
    audio.unlockFromGesture();
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { capture: true, passive: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { capture: true, passive: true });
  window.addEventListener('touchend', unlockAudioOnGesture, { capture: true, passive: true });
  window.addEventListener('click', unlockAudioOnGesture, { capture: true });
  window.addEventListener('keydown', unlockAudioOnGesture, { capture: true });

  inspectClose.addEventListener('click', () => engine.clearInspect());
  inspectDive.addEventListener('click', () => {
    if (!activeInspect) return;
    const z = activeInspect.diveZoom;
    const fromZ = lastZoomRendered === -99 ? 0 : lastZoomRendered;
    const targetXZ: [number, number] | undefined =
      activeInspect.id !== 'us-quarter' ? [activeInspect.box[0], activeInspect.box[1]] : undefined;
    suppressNextInspectCloseAudio = true;
    engine.clearInspect();
    audio.playDive(fromZ, z);
    engine.flyToZoom(z, targetXZ);
  });
  inspectWake.addEventListener('click', () => {
    if (!activeInspect) return;
    const action = getInspectWakeAction(activeInspect);
    action?.run();
  });

  // Helper to fly cleanly to a zoom stop (used by tap, Depth Map tiles, and keyboard arrows)
  const flyToStop = (z: number) => {
    cancelVernierCoast();
    const fromZ = lastZoomRendered === -99 ? engine.getZoom() : lastZoomRendered;
    audio.playDive(fromZ, z);
    engine.flyToZoom(z);
  };

  // Wire Readout Pill -> 1-Tap Depth Map sheet
  vernierReadoutBtn.addEventListener('click', () => {
    setDepthSheetOpen(!showDepthSheet, true);
  });

  // Wire Depth Map 1-tap tiles
  for (const tile of depthTileButtons) {
    tile.addEventListener('click', () => {
      const z = Number(tile.dataset.z ?? 0);
      setDepthSheetOpen(false, false);
      flyToStop(z);
    });
  }

  // Wire Tactile Optical Vernier Dial: direct 1:1 scrub (touch + mouse), momentum coast, magnetic snap & tap-to-jump
  let scrubPointerId: number | null = null;
  let scrubStartX = 0;
  let scrubStartZ = 0;
  let scrubLastX = 0;
  let scrubLastTime = 0;
  let scrubVelZ = 0;
  let scrubCurrentZ = 0;
  let scrubMoved = false;
  let scrubLastIntStop = 0;

  const launchVernierCoast = (initialZ: number, initialVelZ: number) => {
    cancelVernierCoast();
    let z = initialZ;
    let v = Math.max(-14, Math.min(14, initialVelZ));
    let lastT = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      z = Math.max(VERNIER_MIN_Z, Math.min(VERNIER_MAX_Z, z + v * dt));
      v *= Math.exp(-dt * 6.8);

      // Hit soft bounds cleanly
      if ((z <= VERNIER_MIN_Z + 0.001 && v < 0) || (z >= VERNIER_MAX_Z - 0.001 && v > 0)) {
        v = 0;
      }

      engine.scrubZoom(z, true);

      if (Math.abs(v) > 0.22) {
        vernierCoastRaf = requestAnimationFrame(step);
      } else {
        vernierCoastRaf = 0;
        // Gentle magnetic snap if resting right next to an integer landmark
        if (z >= -1.25) {
          const nearest = Math.max(-1, Math.min(9, Math.round(z)));
          if (Math.abs(z - nearest) <= 0.22) {
            engine.scrubZoom(nearest, true);
          }
        }
      }
    };
    vernierCoastRaf = requestAnimationFrame(step);
  };

  vernierCapsuleEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    cancelVernierCoast();
    scrubPointerId = ev.pointerId;
    scrubStartX = ev.clientX;
    scrubLastX = ev.clientX;
    scrubLastTime = performance.now();
    scrubStartZ = lastZoomRendered === -99 ? engine.getZoom() : lastZoomRendered;
    scrubCurrentZ = scrubStartZ;
    scrubVelZ = 0;
    scrubMoved = false;
    scrubLastIntStop = Math.round(scrubStartZ);
    vernierScrubbing = true;
    updateVernierDial(scrubStartZ);
    engageReticle(true);
    try {
      vernierCapsuleEl.setPointerCapture(ev.pointerId);
    } catch {
      // ignore if unsupported
    }
  });

  vernierCapsuleEl.addEventListener('pointermove', (ev) => {
    if (scrubPointerId === null || ev.pointerId !== scrubPointerId) return;
    const dx = ev.clientX - scrubStartX;
    if (!scrubMoved && Math.abs(dx) >= 6) {
      scrubMoved = true;
      vernierCapsuleEl.classList.add('scrubbing');
      if (showDepthSheet) setDepthSheetOpen(false, false);
    }
    if (!scrubMoved) return;

    const now = performance.now();
    const dt = Math.max(0.004, (now - scrubLastTime) / 1000);
    const stepDx = ev.clientX - scrubLastX;
    const instVelZ = -(stepDx / vernierPitch) / dt;
    scrubVelZ = scrubVelZ * 0.62 + instVelZ * 0.38;
    scrubLastX = ev.clientX;
    scrubLastTime = now;

    // Pull ruler tape left -> dive deeper (+z), pull right -> zoom out (-z)
    scrubCurrentZ = Math.max(VERNIER_MIN_Z, Math.min(VERNIER_MAX_Z, scrubStartZ - dx / vernierPitch));
    engine.scrubZoom(scrubCurrentZ, true);

    const nearestInt = Math.round(scrubCurrentZ);
    if (nearestInt !== scrubLastIntStop && nearestInt >= -1 && nearestInt <= 9) {
      scrubLastIntStop = nearestInt;
      if (ev.pointerType === 'touch' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(4);
        } catch {
          // ignore
        }
      }
    }
  });

  const finishVernierPointer = (ev: PointerEvent, cancelled: boolean) => {
    if (scrubPointerId === null || ev.pointerId !== scrubPointerId) return;
    try {
      if (vernierCapsuleEl.hasPointerCapture(ev.pointerId)) {
        vernierCapsuleEl.releasePointerCapture(ev.pointerId);
      }
    } catch {
      // ignore
    }
    scrubPointerId = null;
    vernierScrubbing = false;
    vernierCapsuleEl.classList.remove('scrubbing');
    updateVernierDial(lastZoomRendered === -99 ? engine.getZoom() : lastZoomRendered);
    engageReticle(false);

    if (cancelled) return;

    if (!scrubMoved) {
      const rect = vernierCapsuleEl.getBoundingClientRect();
      const offsetX = ev.clientX - (rect.left + rect.width * 0.5);
      const centerHitHalfW = Math.max(30, lastLoupeW * 0.48);
      if (Math.abs(offsetX) < centerHitHalfW) {
        setDepthSheetOpen(!showDepthSheet, true);
        return;
      }

      // Compute which visible word along the Vernier strip was tapped and fly straight to it!
      const tappedZ = scrubStartZ + offsetX / vernierPitch;
      const tappedIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, Math.round(tappedZ) + 1));
      if (tappedIdx !== lastActiveStop) {
        flyToStop(ZOOM_STOPS[tappedIdx].z);
      } else {
        const dir = offsetX > 0 ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, lastActiveStop + dir));
        flyToStop(ZOOM_STOPS[nextIdx].z);
      }
      return;
    }

    // If pointer lingered before lifting, zero stale velocity
    if (performance.now() - scrubLastTime > 75) {
      scrubVelZ = 0;
    }

    if (Math.abs(scrubVelZ) > 0.42) {
      launchVernierCoast(scrubCurrentZ, scrubVelZ);
    } else if (scrubCurrentZ >= -1.25) {
      const nearest = Math.max(-1, Math.min(9, Math.round(scrubCurrentZ)));
      if (Math.abs(scrubCurrentZ - nearest) <= 0.19) {
        engine.scrubZoom(nearest, true);
      }
    }
  };

  vernierCapsuleEl.addEventListener('pointerup', (ev) => finishVernierPointer(ev, false));
  vernierCapsuleEl.addEventListener('pointercancel', (ev) => finishVernierPointer(ev, true));

  // Mouse wheel directly over the Vernier Dial scrubs smoothly too!
  vernierCapsuleEl.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      cancelVernierCoast();
      if (showDepthSheet) setDepthSheetOpen(false, false);
      const raw = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      const cur = lastZoomRendered === -99 ? engine.getZoom() : lastZoomRendered;
      const next = Math.max(VERNIER_MIN_Z, Math.min(VERNIER_MAX_Z, cur + raw * 0.0024));
      engageReticle(false);
      engine.scrubZoom(next, true);
    },
    { passive: false }
  );

  // Accessible keyboard stepping when Vernier Dial has focus
  vernierCapsuleEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const nextIdx = Math.min(ZOOM_STOPS.length - 1, lastActiveStop + 1);
      flyToStop(ZOOM_STOPS[nextIdx].z);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const prevIdx = Math.max(0, lastActiveStop - 1);
      flyToStop(ZOOM_STOPS[prevIdx].z);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      setDepthSheetOpen(!showDepthSheet, true);
    }
  });

  // Render Activity Sheet bars, micro-sparkline, real GPU/Thermal metrics & process list only when open
  let tickCols: { fill: HTMLDivElement; lbl: HTMLSpanElement }[] = [];
  let lastTickECount = -1;
  const renderSparkline = () => {
    const w = 220;
    const h = 26;
    const stepX = w / (SPARK_MAX - 1);
    const toPts = (arr: number[]) =>
      arr
        .map((v, i) => `${(i * stepX).toFixed(1)},${(h - Math.max(0.03, Math.min(1, v)) * (h - 3) - 1).toFixed(1)}`)
        .join(' ');
    const cpuPts = toPts(cpuHistory);
    const gpuPts = toPts(gpuHistory);
    sparkCpuLine.setAttribute('points', cpuPts);
    sparkGpuLine.setAttribute('points', gpuPts);
    sparkCpuArea.setAttribute('points', `0,${h} ${cpuPts} ${w},${h}`);
    sparkReadoutEl.textContent = `${Math.round(telemetry.cpuTotal * 100)}% / ${Math.round(telemetry.gpuEst * 100)}%`;
  };

  const syncControlHints = () => {
    if (activeSource !== 'live') {
      sourceHintEl.textContent = telemetry.captureName ?? 'IOKit Capture';
    } else if (telemetry.nativeTelemetry) {
      sourceHintEl.textContent = 'Mac IOKit Live';
    } else if (telemetry.gpuTimed) {
      sourceHintEl.textContent =
        telemetry.gpuFrameMs !== null && telemetry.gpuFrameMs !== undefined
          ? `GPU ${telemetry.gpuFrameMs.toFixed(1)} ms`
          : 'GPU Timed';
    } else {
      sourceHintEl.textContent = 'Live Browser';
    }

    chipSpecHintEl.textContent =
      activeChipPreset === 'auto'
        ? `Auto · ${telemetry.pCoreCount}P+${telemetry.eCoreCount}E`
        : `${telemetry.pCoreCount}P+${telemetry.eCoreCount}E · ${telemetry.gpuCores}C`;

    workloadHintEl.textContent = telemetry.workloadSummary
      ? telemetry.workloadSummary
      : WORKLOAD_OPTIONS.find((w) => w.id === selectedWorkload)?.buttonLabel ?? 'Ready';
  };

  const renderActivitySheet = () => {
    if (!showActivity) return;
    sheetCoresEl.textContent = `${telemetry.pCoreCount}P + ${telemetry.eCoreCount}E CORES`;
    sheetFpsEl.textContent = `${currentFps} FPS · ${telemetryModeBadge()}`;

    hwGpuLbl.textContent = `${telemetry.gpuCores}C GPU`;
    hwGpuVal.textContent = `${Math.round(telemetry.gpuEst * 100)}%`;
    hwVramVal.textContent = `${telemetry.gpuMemGB.toFixed(2)} GB`;
    hwTempVal.textContent =
      telemetry.socTempC !== null ? `${telemetry.socTempC.toFixed(1)}°C` : telemetry.thermalState;

    const loads = telemetry.coreLoads.slice(0, 16);
    tickMeterEl.classList.toggle('compact', loads.length > 10);
    if (tickCols.length !== loads.length || lastTickECount !== telemetry.eCoreCount) {
      lastTickECount = telemetry.eCoreCount;
      tickMeterEl.innerHTML = '';
      tickCols = loads.map((_, idx) => {
        const col = document.createElement('div');
        col.className = 'tick-col';
        const track = document.createElement('div');
        track.className = 'tick-bar-track';
        const fill = document.createElement('div');
        fill.className = 'tick-bar-fill';
        const lbl = document.createElement('span');
        lbl.className = 'tick-lbl';
        lbl.textContent = idx < telemetry.eCoreCount ? `E${idx}` : `P${idx - telemetry.eCoreCount}`;
        track.appendChild(fill);
        col.appendChild(track);
        col.appendChild(lbl);
        tickMeterEl.appendChild(col);
        return { fill, lbl };
      });
    }

    for (let i = 0; i < loads.length; i++) {
      const load = loads[i];
      const pct = Math.max(10, Math.round(load * 100));
      tickCols[i].fill.style.height = `${pct}%`;
      tickCols[i].fill.style.opacity = (0.35 + load * 0.65).toFixed(2);
    }

    renderSparkline();
    syncControlHints();

    const procs = telemetry.topProcs.slice(0, 3);
    procListEl.innerHTML = procs
      .map(
        (p) =>
          `<div class="proc-row"><span class="proc-name">${p.name.replace(/</g, '&lt;')}</span><span class="proc-cpu">${p.cpu.toFixed(1)}%</span></div>`
      )
      .join('');
  };

  // Wire top-right tool capsule controls
  const syncSoundSheetUi = () => {
    const vibe = audio.getVibe();
    const bgmLevel = audio.getBgmLevel();
    soundVibeBadge.textContent = vibe.metaBadge;
    const lvlOpt = BGM_LEVEL_OPTIONS.find((o) => o.id === bgmLevel);
    bgmLevelHint.textContent =
      bgmLevel === 'off' ? 'Off' : audio.isMuted() ? `${lvlOpt?.label ?? 'Quiet'} · Muted` : `Looping · ${lvlOpt?.label ?? 'Quiet'}`;

    for (const btn of vibeButtons) {
      const isAct = btn.dataset.vibe === vibe.id;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-checked', isAct ? 'true' : 'false');
    }
    for (const btn of bgmLevelButtons) {
      btn.classList.toggle('active', btn.dataset.bgm === bgmLevel);
    }
    btnVibe.title = `Soundtrack: ${vibe.name} (V)`;
  };
  refreshSoundSheetUi = syncSoundSheetUi;
  syncSoundSheetUi();

  const toggleAutoDive = () => {
    if (awaitingPowerOn) return;
    cancelVernierCoast();
    if (!tourActive) {
      if (showDepthSheet) setDepthSheetOpen(false, false);
      if (showActivity) {
        showActivity = false;
        btnActivity.classList.remove('active');
        activitySheet.style.display = 'none';
      }
      if (showSoundSheet) {
        showSoundSheet = false;
        btnVibe.classList.remove('active');
        soundSheet.style.display = 'none';
      }
    }
    audio.playUiTap(!tourActive);
    engine.toggleTour();
  };

  btnDive.addEventListener('click', toggleAutoDive);

  btnActivity.addEventListener('click', () => {
    showActivity = !showActivity;
    if (showActivity && showDepthSheet) {
      setDepthSheetOpen(false, false);
    }
    if (showActivity && showSoundSheet) {
      showSoundSheet = false;
      btnVibe.classList.remove('active');
      soundSheet.style.display = 'none';
    }
    if (showActivity && activeInspect && window.innerWidth <= 720) {
      suppressNextInspectCloseAudio = true;
      engine.clearInspect();
    }
    btnActivity.classList.toggle('active', showActivity);
    activitySheet.style.display = showActivity ? 'flex' : 'none';
    if (showActivity) renderActivitySheet();
    audio.playUiTap(showActivity);
    syncGlassLayout();
  });

  btnVibe.addEventListener('click', () => {
    showSoundSheet = !showSoundSheet;
    if (showSoundSheet && showDepthSheet) {
      setDepthSheetOpen(false, false);
    }
    if (showSoundSheet && showActivity) {
      showActivity = false;
      btnActivity.classList.remove('active');
      activitySheet.style.display = 'none';
    }
    if (showSoundSheet && activeInspect && window.innerWidth <= 720) {
      suppressNextInspectCloseAudio = true;
      engine.clearInspect();
    }
    btnVibe.classList.toggle('active', showSoundSheet);
    soundSheet.style.display = showSoundSheet ? 'flex' : 'none';
    if (showSoundSheet) syncSoundSheetUi();
    audio.playUiTap(showSoundSheet);
    syncGlassLayout();
  });

  for (const btn of vibeButtons) {
    btn.addEventListener('click', () => {
      const id = (btn.dataset.vibe ?? 'glass') as MusicVibeId;
      const meta = audio.setVibe(id, true);
      engine.setIntroCues(meta.introCues);
      audio.playUiTap(true);
      syncSoundSheetUi();
    });
  }

  for (const btn of bgmLevelButtons) {
    btn.addEventListener('click', () => {
      const lvl = (btn.dataset.bgm ?? 'quiet') as BgmLevelId;
      audio.setBgmLevel(lvl);
      audio.playUiTap(lvl !== 'off');
      syncSoundSheetUi();
    });
  }

  btnReplayIntro.addEventListener('click', () => {
    if (pureView) setPure(false);
    showSoundSheet = false;
    btnVibe.classList.remove('active');
    soundSheet.style.display = 'none';
    if (audio.isMuted()) {
      audio.toggle();
    }
    syncSoundSheetUi();
    syncGlassLayout();
    introPhase = 'idle';
    engine.setIntroCues(audio.getVibe().introCues);
    engine.startIntro();
  });

  btnSound.addEventListener('click', () => {
    audio.toggle();
    syncSoundSheetUi();
  });

  const setPure = (next: boolean) => {
    if (pureView !== next) {
      audio.playUiTap(!next);
    }
    pureView = next;
    hudChromeEl.classList.toggle('hidden', pureView);
    restoreHudBtn.style.display = pureView ? 'inline-flex' : 'none';
    if (pureView) {
      hoverPill.classList.remove('visible');
      if (showDepthSheet) setDepthSheetOpen(false, false);
    }
    syncGlassLayout();
  };

  btnPure.addEventListener('click', () => setPure(true));
  restoreHudBtn.addEventListener('click', () => setPure(false));

  editorialBrandEl.addEventListener('click', () => {
    if (pureView) setPure(false);
    if (showDepthSheet) setDepthSheetOpen(false, false);
    if (showActivity) {
      showActivity = false;
      btnActivity.classList.remove('active');
      activitySheet.style.display = 'none';
    }
    if (showSoundSheet) {
      showSoundSheet = false;
      btnVibe.classList.remove('active');
      soundSheet.style.display = 'none';
    }
    introPhase = 'idle';
    engine.setIntroCues(audio.getVibe().introCues);
    engine.startIntro();
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (awaitingPowerOn) return;
      const activeEl = document.activeElement;
      if (activeEl === vernierCapsuleEl || activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
        return;
      }
      e.preventDefault();
      toggleAutoDive();
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      audio.toggle();
      syncSoundSheetUi();
    } else if (e.key === 'v' || e.key === 'V') {
      const meta = audio.cycleVibe();
      engine.setIntroCues(meta.introCues);
      syncSoundSheetUi();
    } else if (e.key === 'g' || e.key === 'G') {
      if (!pureView && !introActive) {
        setDepthSheetOpen(!showDepthSheet, true);
      }
    } else if (e.key === 'h' || e.key === 'H') {
      if (engine.isIntroActive) engine.skipIntro();
      setPure(!pureView);
    } else if (e.key === 'r' || e.key === 'R') {
      if (pureView) setPure(false);
      if (showDepthSheet) setDepthSheetOpen(false, false);
      if (showActivity) {
        showActivity = false;
        btnActivity.classList.remove('active');
        activitySheet.style.display = 'none';
      }
      if (showSoundSheet) {
        showSoundSheet = false;
        btnVibe.classList.remove('active');
        soundSheet.style.display = 'none';
      }
      introPhase = 'idle';
      engine.setIntroCues(audio.getVibe().introCues);
      engine.startIntro();
    } else if (e.key === 'Escape') {
      if (engine.isIntroActive) engine.skipIntro();
      if (tourActive) engine.stopTour();
      if (activeInspect) engine.clearInspect();
      if (showDepthSheet) {
        setDepthSheetOpen(false, false);
      }
      if (showSoundSheet) {
        showSoundSheet = false;
        btnVibe.classList.remove('active');
        soundSheet.style.display = 'none';
        syncGlassLayout();
      }
    }
  });

  const browserTelemetry = new BrowserTelemetrySource(engine.getGpuRenderer());
  const tracePlayer = new RecordedTracePlayer('build');

  // Hand-to-silicon causality: route live pointer/zoom/inspect activity into browser telemetry
  gpuMount.addEventListener(
    'wheel',
    () => {
      cancelVernierCoast();
      if (showDepthSheet) setDepthSheetOpen(false, false);
      browserTelemetry.noteInteraction('zoom');
    },
    { passive: true }
  );
  gpuMount.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.buttons !== 0) browserTelemetry.noteInteraction('pointer');
    },
    { passive: true }
  );
  gpuMount.addEventListener(
    'pointerdown',
    () => {
      cancelVernierCoast();
      browserTelemetry.noteInteraction('inspect');
      if (showDepthSheet) {
        setDepthSheetOpen(false, false);
      }
      // On narrow mobile screens, tapping the canvas outside an open sheet dismisses it cleanly
      if (window.innerWidth <= 720 && (showActivity || showSoundSheet)) {
        if (showActivity) {
          showActivity = false;
          btnActivity.classList.remove('active');
          activitySheet.style.display = 'none';
        }
        if (showSoundSheet) {
          showSoundSheet = false;
          btnVibe.classList.remove('active');
          soundSheet.style.display = 'none';
        }
        syncGlassLayout();
      }
    },
    { passive: true }
  );

  const syncBurstButtonUi = () => {
    btnBurst.classList.toggle('active', bursting);
    if (!bursting) {
      btnBurstLbl.textContent = 'Burst';
    } else if (activePinnedPCore !== null) {
      btnBurstLbl.textContent = `Core P${activePinnedPCore}`;
    } else {
      const opt = WORKLOAD_OPTIONS.find((w) => w.id === selectedWorkload);
      btnBurstLbl.textContent = opt ? opt.buttonLabel : 'Bursting';
    }
    syncGlassLayout();
  };

  const syncSegmentedUi = () => {
    for (const btn of sourceButtons) {
      btn.classList.toggle('active', btn.dataset.source === activeSource);
    }
    for (const btn of chipButtons) {
      btn.classList.toggle('active', btn.dataset.chip === activeChipPreset);
    }
    for (const btn of workloadButtons) {
      btn.classList.toggle('active', btn.dataset.workload === selectedWorkload);
    }
  };

  let refreshPollCadence: () => void = () => {};

  const workloadRunner = new BrowserWorkloadRunner((active, _kind, pinnedPCore) => {
    bursting = active;
    activePinnedPCore = pinnedPCore;
    engine.setBurstActive(active);
    syncBurstButtonUi();
    if (activeInspect) renderInspectCard(false);
    refreshPollCadence();
  });

  const setActiveSource = (next: 'live' | TraceCaptureId, silent = false) => {
    if (activeSource === next) return;
    activeSource = next;
    if (next !== 'live') {
      workloadRunner.stop();
      tracePlayer.setTrace(next);
    }
    syncSegmentedUi();
    if (!silent) audio.playUiTap(true);
    refreshPollCadence();
  };

  stopActiveWorkload = () => {
    workloadRunner.stop();
    audio.playUiTap(false);
  };

  triggerWorkload = (kind: WorkloadKind) => {
    selectedWorkload = kind;
    syncSegmentedUi();
    if (activeSource !== 'live') {
      setActiveSource('live', true);
    }
    audio.triggerBurst(4.1);
    workloadRunner.start(kind, telemetry.pCoreCount || 8, 4200);
  };

  triggerPinnedCoreWorkload = (coreIdx: number) => {
    if (bursting && activePinnedPCore === coreIdx) {
      workloadRunner.stop();
      audio.playUiTap(false);
      return;
    }
    if (activeSource !== 'live') {
      setActiveSource('live', true);
    }
    audio.triggerBurst(3.7);
    workloadRunner.startPinnedCore(coreIdx, 3800);
  };

  btnBurst.addEventListener('click', () => {
    if (bursting) {
      workloadRunner.stop();
      audio.playUiTap(false);
      return;
    }
    triggerWorkload(selectedWorkload);
  });

  for (const btn of sourceButtons) {
    btn.addEventListener('click', () => {
      const src = (btn.dataset.source ?? 'live') as 'live' | TraceCaptureId;
      setActiveSource(src);
    });
  }

  for (const btn of chipButtons) {
    btn.addEventListener('click', () => {
      const preset = (btn.dataset.chip ?? 'auto') as ChipPresetId;
      if (preset === activeChipPreset) return;
      activeChipPreset = preset;
      syncSegmentedUi();
      audio.playUiTap(true);
      if (activeInspect && activeInspect.id.startsWith('pcore-')) {
        engine.clearInspect();
      }
      if (lastRawSample) {
        applyTelemetry(lastRawSample);
      }
    });
  }

  for (const btn of workloadButtons) {
    btn.addEventListener('click', () => {
      const wl = (btn.dataset.workload ?? 'compute') as WorkloadKind;
      selectedWorkload = wl;
      syncSegmentedUi();
      if (bursting) {
        triggerWorkload(wl);
      } else {
        audio.playUiTap(true);
        syncControlHints();
      }
    });
  }

  const applyTelemetry = (raw: LiveMacTelemetry) => {
    lastRawSample = raw;
    let data = applyChipPreset(raw, activeChipPreset);
    // Keep Click-a-Core pin locked to the exact clicked P-Core slot without mutating raw samples
    if (bursting && activePinnedPCore !== null && activeSource === 'live') {
      const wl = workloadRunner.getSnapshot();
      const targetIdx = data.eCoreCount + activePinnedPCore;
      if (wl.active && wl.kind === 'pin-core' && targetIdx < data.coreLoads.length) {
        const loads = data.coreLoads.slice();
        const pinVal = wl.workerLoads[0] ?? 0.94;
        for (let p = 0; p < data.pCoreCount; p++) {
          const i = data.eCoreCount + p;
          if (i >= loads.length) break;
          loads[i] = p === activePinnedPCore ? pinVal : Math.min(loads[i], 0.22);
        }
        const pSlice = loads.slice(data.eCoreCount);
        const pCoreAvg = pSlice.reduce((a, b) => a + b, 0) / Math.max(1, pSlice.length);
        const cpuTotal = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
        data = { ...data, coreLoads: loads, pCoreAvg, cpuTotal };
      }
    }
    telemetry = data;
    engine.setTelemetry(data);

    cpuHistory.push(data.cpuTotal);
    if (cpuHistory.length > SPARK_MAX) cpuHistory.shift();
    gpuHistory.push(data.gpuEst);
    if (gpuHistory.length > SPARK_MAX) gpuHistory.shift();

    chipNameEl.textContent = data.chipName;
    introChipNameEl.textContent = data.chipName;
    introEyebrowEl.textContent =
      data.source === 'capture'
        ? 'IOKIT HARDWARE CAPTURE'
        : data.live
          ? 'INSIDE YOUR MAC'
          : 'SILICON ARCHITECTURE';

    const cpuPct = Math.round(data.cpuTotal * 100);
    const gpuPct = Math.round(data.gpuEst * 100);
    const tempPart = data.socTempC !== null ? `${data.socTempC.toFixed(0)}°C · ` : '';
    const extraPart = data.workloadSummary
      ? ` · ${data.workloadSummary}`
      : data.source === 'capture' && data.captureName
        ? ` · ${data.captureName.split('·').pop()?.trim() ?? 'Capture'}`
        : '';
    editorialMetaEl.textContent = `${tempPart}${cpuPct}% CPU · ${gpuPct}% GPU${extraPart}`;

    renderActivitySheet();
    if (activeInspect) renderInspectCard(false);
    if (activeHover && hoverPill.classList.contains('visible')) {
      hoverValEl.textContent = conciseHoverMetric(activeHover, telemetry);
    }
  };

  let localMacAvailable = false;
  let localMacProbedFailed = false;
  let pollTimer: number | null = null;
  let activePollFn: (() => void) | null = null;
  let activePollMs = 1000;

  const startPollLoop = (fn: () => void, intervalMs: number) => {
    activePollFn = fn;
    activePollMs = intervalMs;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (!document.hidden) {
      fn();
      pollTimer = window.setInterval(fn, intervalMs);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (workloadRunner.isActive()) {
        workloadRunner.stop();
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    } else if (activePollFn && pollTimer === null) {
      activePollFn();
      pollTimer = window.setInterval(activePollFn, activePollMs);
    }
  });
  window.addEventListener('pagehide', () => {
    workloadRunner.dispose();
    browserTelemetry.dispose();
  });

  const isLocalHost =
    import.meta.env.DEV ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost';

  let liveFailures = 0;
  const sampleLiveOrFallback = async () => {
    if (document.hidden) return;

    if (activeSource !== 'live') {
      applyTelemetry(tracePlayer.sample());
      return;
    }

    const wlSnap = workloadRunner.getSnapshot();
    const useLocalApi = isLocalHost && !localMacProbedFailed;

    if (useLocalApi) {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
          throw new Error('No local telemetry API');
        }
        const data = (await res.json()) as LiveMacTelemetry;
        if (activeSource !== 'live') return;
        if (!data || !Array.isArray(data.coreLoads)) {
          throw new Error('Invalid telemetry payload');
        }
        liveFailures = 0;
        localMacAvailable = true;
        if (wlSnap.active && wlSnap.metricLabel) {
          data.workloadSummary = wlSnap.metricLabel;
        }
        applyTelemetry(data);
        return;
      } catch {
        if (activeSource !== 'live') return;
        liveFailures++;
        if (liveFailures >= 1 && !localMacAvailable) {
          localMacProbedFailed = true;
          refreshPollCadence();
          return;
        }
      }
    }

    applyTelemetry(browserTelemetry.sample(engine.getFrameActivity(), wlSnap));
  };

  refreshPollCadence = () => {
    const intervalMs =
      activeSource !== 'live'
        ? 550
        : bursting
          ? 320
          : isLocalHost && !localMacProbedFailed
            ? 1000
            : 650;
    startPollLoop(() => {
      void sampleLiveOrFallback();
    }, intervalMs);
  };

  refreshPollCadence();
}

mountApp();
