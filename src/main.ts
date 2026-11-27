import './styles.css';
import { SiliconAudio } from './audio/SiliconAudio';
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

const ZOOM_STOPS = [
  { z: -1.0, label: 'Scale' },
  { z: 0.0, label: 'Die' },
  { z: 1.0, label: 'Power' },
  { z: 2.0, label: 'Routing' },
  { z: 3.0, label: 'Rows' },
  { z: 4.0, label: 'Cell' },
  { z: 5.0, label: 'Gate' },
  { z: 6.0, label: 'Lattice' },
  { z: 7.0, label: 'Atom' },
  { z: 8.0, label: 'Nucleus' },
  { z: 9.0, label: 'Quarks' },
];

const DIAL_TICKS = [
  { deg: -144, label: '1×' },
  { deg: -115, label: '10×' },
  { deg: -86, label: '1K×' },
  { deg: -58, label: '100K×' },
  { deg: -29, label: '1M×' },
  { deg: 0, label: '5M×' },
  { deg: 29, label: '25M×' },
  { deg: 58, label: '250M×' },
  { deg: 86, label: '1.2B×' },
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
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  power: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>`,
};

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

  root.innerHTML = `
    <div class="apple-stage">
      <div id="gpu-mount" class="raymarch-mount"></div>

      <div id="reticle-layer" class="reticle-layer intro-hidden" aria-hidden="true">
        ${buildReticleSvg()}
        <div id="nm-bracket" class="nm-bracket" style="opacity:0;pointer-events:none;display:none;">
          <div class="nm-line"></div>
          <div id="nm-label" class="nm-label">12 nm Gate · 5 nm GAA Ribbon</div>
          <div class="nm-line"></div>
        </div>
      </div>

      <!-- "First Light" Mysterious Whisper Title (Emerges out of darkness, dissolves before full reveal) -->
      <div id="intro-title" class="intro-title" aria-hidden="true">
        <div id="intro-eyebrow" class="intro-eyebrow">INSIDE YOUR MAC</div>
        <div id="intro-chip-name" class="intro-chip-name">Apple Silicon</div>
        <div id="intro-boot-cue" class="intro-boot-cue">
          <div class="boot-pill">
            <span class="boot-pill-icon">${ICONS.power}</span>
            <span class="boot-pill-label">Power On</span>
          </div>
          <div class="boot-subhint">Click anywhere or press any key</div>
        </div>
      </div>

      <!-- Whisper-Quiet Hover Preview Pill -->
      <div id="hover-pill" class="hover-pill" aria-hidden="true">
        <span id="hover-title" class="hover-title"></span>
        <span class="hover-sep">·</span>
        <span id="hover-val" class="hover-val"></span>
      </div>

      <button id="restore-hud-btn" class="restore-hud-btn liquid-glass" title="Show Interface (H)" style="display:none;">
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
            <button id="btn-activity" class="glass-btn" title="Inspect per-core CPU, GPU, and die thermal telemetry">
              ${ICONS.activity}<span>Activity</span>
            </button>
            <button id="btn-burst" class="glass-btn" title="Run a 3.5-second multi-core Web Worker burst">
              ${ICONS.zap}<span id="btn-burst-lbl">Burst</span>
            </button>
            <div class="capsule-divider"></div>
            <button id="btn-sound" class="glass-btn icon-only" title="Sound (M)">
              ${ICONS.volumeOn}
            </button>
            <button id="btn-pure" class="glass-btn icon-only" title="Pure View — Hide UI (H)">
              ${ICONS.eyeOff}
            </button>
          </div>
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

        <div class="hud-bottom">
          <div id="zoom-rail" class="zoom-rail liquid-glass">
            <div id="rail-indicator" class="rail-indicator"></div>
            ${ZOOM_STOPS.map(
              (st, idx) =>
                `<button class="rail-stop ${st.z === 0 ? 'active' : ''}" data-idx="${idx}" data-z="${st.z}">${st.label}</button>`
            ).join('')}
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
  const railIndicator = document.getElementById('rail-indicator')!;
  const zoomRailEl = document.getElementById('zoom-rail')!;
  const railButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#zoom-rail .rail-stop'));
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

  const btnActivity = document.getElementById('btn-activity')!;
  const btnBurst = document.getElementById('btn-burst')!;
  const btnBurstLbl = document.getElementById('btn-burst-lbl')!;
  const btnSound = document.getElementById('btn-sound')!;
  const btnPure = document.getElementById('btn-pure')!;

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
  let pureView = false;
  let bursting = false;
  let activeSource: 'live' | TraceCaptureId = 'live';
  let activeChipPreset: ChipPresetId = 'auto';
  let selectedWorkload: WorkloadKind = 'compute';
  let activePinnedPCore: number | null = null;
  let lastRawSample: LiveMacTelemetry | null = null;
  let lastZoomRendered = -99;
  let lastActiveStop = 1;
  let lastFpsUpdate = 0;
  let currentFps = 120;

  // Rolling 32-sample telemetry history for crisp Activity micro-sparkline
  const SPARK_MAX = 32;
  const cpuHistory: number[] = Array(SPARK_MAX).fill(0.16);
  const gpuHistory: number[] = Array(SPARK_MAX).fill(0.18);

  // Cached button layout geometry for zero-reflow continuously gliding rail indicator
  let railMetrics: { x: number; w: number }[] = [];
  let railViewportRect = { left: 0, top: 0 };
  let railIndicatorBox = { cx: 0, cy: 0, hw: 0, hh: 18 };

  type GlassReg = {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
    radius: number;
    bevel: number;
    frost: number;
    style: 0 | 1 | 2;
    alpha: number;
  };
  let staticGlassBase: GlassReg[] = [];
  let staticGlassElevated: GlassReg[] = [];
  let pushGlassToEngine: () => void = () => {};
  let refreshGlassLayout: () => void = () => {};

  const syncSoundButton = (active: boolean, muted: boolean) => {
    btnSound.innerHTML = muted ? ICONS.volumeOff : ICONS.volumeOn;
    btnSound.classList.toggle('active', active);
    btnSound.title = active ? 'Mute Sound (M)' : muted ? 'Unmute Sound (M)' : 'Enable Sound (M)';
    refreshGlassLayout();
  };

  const audio = new SiliconAudio(syncSoundButton);
  let suppressNextInspectCloseAudio = false;

  const measureRail = () => {
    railMetrics = railButtons.map((btn) => ({ x: btn.offsetLeft, w: btn.offsetWidth }));
    const rr = zoomRailEl.getBoundingClientRect();
    railViewportRect = { left: rr.left, top: rr.top };
    updateRailIndicator(lastZoomRendered === -99 ? 0 : lastZoomRendered);
  };

  const updateRailIndicator = (z: number) => {
    if (railMetrics.length !== ZOOM_STOPS.length) return;
    const pos = Math.max(0, Math.min(ZOOM_STOPS.length - 1, z + 1));
    const i0 = Math.floor(pos);
    const i1 = Math.min(ZOOM_STOPS.length - 1, i0 + 1);
    const f = pos - i0;
    const m0 = railMetrics[i0];
    const m1 = railMetrics[i1];
    const x = m0.x + (m1.x - m0.x) * f;
    const w = m0.w + (m1.w - m0.w) * f;
    railIndicator.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    railIndicator.style.width = `${w.toFixed(1)}px`;
    railIndicatorBox = {
      cx: railViewportRect.left + x + w * 0.5,
      cy: railViewportRect.top + 4 + 18,
      hw: w * 0.5,
      hh: 18,
    };
    pushGlassToEngine();
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
      if (wasEarlySkip || elapsed < 6.90) {
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

    const rawHudU = elapsed < 6.08 ? 0.0 : Math.min(1.0, (elapsed - 6.08) / 0.82);
    // Cubic ease-out matches CSS `.hud-chrome` transition so Liquid Glass & DOM text emerge as one object!
    const nextHudAlpha = 1.0 - Math.pow(1.0 - rawHudU, 3);
    const alphaChanged = Math.abs(nextHudAlpha - introHudAlpha) > 0.005;
    introHudAlpha = nextHudAlpha;

    if (elapsed < 0.08) {
      if (introPhase !== 'black') {
        introPhase = 'black';
        audio.startIntroScore(elapsed);
        introTitleEl.classList.remove('visible', 'exiting', 'skipped');
        reticleLayer.classList.remove('intro-lock', 'engaged');
        reticleLayer.classList.add('intro-hidden');
        hudChromeEl.classList.add('intro-staging');
        nmBracket.style.display = 'none';
        pushGlassToEngine();
      }
    } else if (elapsed < 1.22) {
      if (introPhase !== 'title') {
        if (introPhase === 'idle') audio.startIntroScore(elapsed);
        introPhase = 'title';
        introTitleEl.classList.remove('exiting', 'skipped');
        introTitleEl.classList.add('visible');
        reticleLayer.classList.remove('intro-lock', 'engaged');
        reticleLayer.classList.add('intro-hidden');
        hudChromeEl.classList.add('intro-staging');
        nmBracket.style.display = 'none';
        pushGlassToEngine();
      }
    } else if (elapsed < 2.45) {
      if (introPhase !== 'dissolve') {
        introPhase = 'dissolve';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
      }
    } else if (elapsed < 5.78) {
      if (introPhase !== 'boot') {
        introPhase = 'boot';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
      }
    } else if (elapsed < 6.08) {
      if (introPhase !== 'lock') {
        introPhase = 'lock';
        introTitleEl.classList.remove('visible', 'skipped');
        introTitleEl.classList.add('exiting');
        reticleLayer.classList.remove('intro-hidden');
        reticleLayer.classList.add('intro-lock');
      }
    } else if (elapsed < 6.75) {
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
    onIntroFrame: ({ active, elapsed }) => {
      syncIntroUi(active, elapsed);
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

      const { dialDeg, bracketText, bracketOpacity } = formatMagnification(z);
      const frac = Math.max(0.015, Math.min(0.8, ((z + 1) / 10) * 0.8));
      reticleArc.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`);
      reticleDial.setAttribute('transform', `rotate(${(-dialDeg * 0.55).toFixed(2)} 270 270)`);

      if (!introActive && bracketText && bracketOpacity > 0.01) {
        nmBracket.style.display = 'flex';
        nmBracket.style.opacity = bracketOpacity.toFixed(3);
        if (nmLabel.textContent !== bracketText) {
          nmLabel.textContent = bracketText;
        }
      } else if (nmBracket.style.display !== 'none') {
        nmBracket.style.display = 'none';
      }

      updateRailIndicator(z);

      const stopIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, Math.round(z) + 1));
      if (stopIdx !== lastActiveStop) {
        railButtons[lastActiveStop]?.classList.remove('active');
        railButtons[stopIdx]?.classList.add('active');
        lastActiveStop = stopIdx;
      }
    },
    onInspect: (hit) => {
      const prevId = activeInspect?.id ?? null;
      const nextId = hit?.id ?? null;
      activeInspect = hit;
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

  pushGlassToEngine = () => {
    const hudAlpha = pureView ? 1.0 : introHudAlpha;
    if (hudAlpha < 0.005) {
      engine.setLiquidGlassRegions([]);
      return;
    }
    const out: GlassReg[] = [];
    for (let i = 0; i < staticGlassBase.length; i++) {
      const g = staticGlassBase[i];
      out.push(hudAlpha < 0.999 ? { ...g, alpha: g.alpha * hudAlpha } : g);
    }
    // Elevated crystal droplet lenses rendered in Stage 1 so they refract Stage 0 glass + scene!
    if (!pureView && railIndicatorBox.hw > 1) {
      out.push({
        cx: railIndicatorBox.cx,
        cy: railIndicatorBox.cy,
        hw: railIndicatorBox.hw,
        hh: railIndicatorBox.hh,
        radius: 18,
        bevel: 0.28,
        frost: 0.0,
        style: 2,
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
      const rail = rectToGlass(zoomRailEl, 999, 0.25, 1.3, 0, 1.0);
      if (rail) base.push(rail);

      if (showActivity) {
        const sheet = rectToGlass(activitySheet, 26, 0.14, 3.0, 1, 1.0);
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
    const rr = zoomRailEl.getBoundingClientRect();
    railViewportRect = { left: rr.left, top: rr.top };
    pushGlassToEngine();
  };
  refreshGlassLayout = syncGlassLayout;

  // Re-sync automatically whenever text width or viewport changes
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      measureRail();
      syncGlassLayout();
    });
    ro.observe(toolCapsuleEl);
    ro.observe(zoomRailEl);
    ro.observe(activitySheet);
    ro.observe(inspectCard);
  }
  window.addEventListener('resize', () => {
    measureRail();
    syncGlassLayout();
  });
  if (document.fonts && document.fonts.ready) {
    void document.fonts.ready.then(() => {
      measureRail();
      syncGlassLayout();
    });
  }
  measureRail();
  syncGlassLayout();

  // Global pointer tracking for dynamic specular rim highlights on curved Liquid Glass edges
  window.addEventListener('pointermove', (ev) => {
    engine.setGlassPointer(ev.clientX, ev.clientY, true);
  });
  window.addEventListener('pointerleave', () => {
    engine.setGlassPointer(0, 0, false);
  });

  // Autoplay-adaptive Cold Boot launch:
  //   - If browser allows unmuted autoplay, starts immediately from 0.0s with full audio
  //   - If browser blocks autoplay (e.g. aside browser), holds on the title card until first click/key
  //     so the entire Cold Boot light + music sequence plays in perfect sync!
  const launchHeldPowerOn = () => {
    if (!awaitingPowerOn) return;
    setAwaitingPowerOn(false);
    introPhase = 'idle';
    audio.unlockFromGesture();
    // Title is already centered & crisp: cue melts away smoothly, immediate C1 sub-bass -> optical push-through at +0.44s!
    engine.releaseIntroHold(0.78);
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
    const target = ev.target as HTMLElement | null;
    if (target && (target === btnSound || btnSound.contains(target))) return;
    if (ev instanceof KeyboardEvent && (ev.key === 'm' || ev.key === 'M')) return;
    audio.unlockFromGesture();
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { capture: true, passive: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { capture: true, passive: true });
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

  // Wire zoom rail clicks
  for (const btn of railButtons) {
    btn.addEventListener('click', () => {
      const z = Number(btn.dataset.z ?? 0);
      const fromZ = lastZoomRendered === -99 ? 0 : lastZoomRendered;
      audio.playDive(fromZ, z);
      engine.flyToZoom(z);
    });
  }

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
  btnActivity.addEventListener('click', () => {
    showActivity = !showActivity;
    btnActivity.classList.toggle('active', showActivity);
    activitySheet.style.display = showActivity ? 'flex' : 'none';
    if (showActivity) renderActivitySheet();
    audio.playUiTap(showActivity);
    syncGlassLayout();
  });

  btnSound.addEventListener('click', () => {
    audio.toggle();
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
    }
    syncGlassLayout();
  };

  btnPure.addEventListener('click', () => setPure(true));
  restoreHudBtn.addEventListener('click', () => setPure(false));

  editorialBrandEl.addEventListener('click', () => {
    if (pureView) setPure(false);
    if (showActivity) {
      showActivity = false;
      btnActivity.classList.remove('active');
      activitySheet.style.display = 'none';
    }
    introPhase = 'idle';
    engine.startIntro();
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') {
      audio.toggle();
    } else if (e.key === 'h' || e.key === 'H') {
      if (engine.isIntroActive) engine.skipIntro();
      setPure(!pureView);
    } else if (e.key === 'r' || e.key === 'R') {
      if (pureView) setPure(false);
      if (showActivity) {
        showActivity = false;
        btnActivity.classList.remove('active');
        activitySheet.style.display = 'none';
      }
      introPhase = 'idle';
      engine.startIntro();
    } else if (e.key === 'Escape') {
      if (engine.isIntroActive) engine.skipIntro();
      if (activeInspect) engine.clearInspect();
    }
  });

  const browserTelemetry = new BrowserTelemetrySource(engine.getGpuRenderer());
  const tracePlayer = new RecordedTracePlayer('build');

  // Hand-to-silicon causality: route live pointer/zoom/inspect activity into browser telemetry
  gpuMount.addEventListener('wheel', () => browserTelemetry.noteInteraction('zoom'), { passive: true });
  gpuMount.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.buttons !== 0) browserTelemetry.noteInteraction('pointer');
    },
    { passive: true }
  );
  gpuMount.addEventListener('pointerdown', () => browserTelemetry.noteInteraction('inspect'), { passive: true });

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
