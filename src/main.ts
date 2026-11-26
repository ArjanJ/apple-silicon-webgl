import './styles.css';
import { DieInspectHit } from './engine/inspect';
import { SiliconEngine } from './engine/SiliconEngine';
import { BrowserTelemetrySource } from './sim/browserTelemetry';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';

/**
 * Zero-Overhead Vanilla DOM Controller for Apple Silicon 3D Microscope.
 *   - No React reconciliation or virtual DOM during 120 FPS zoom
 *   - Breathing optical reticle, continuously gliding VisionOS rail indicator, & calibrated scale bar
 *   - Whisper-quiet hover preview + click-to-inspect + one-click Cinematic Dive (Space)
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
  play: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  stop: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>`,
  activity: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  zap: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  flame: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  orbit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 13.707 3.814 1.86-1.86 3.814"/><path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"/></svg>`,
  eyeOff: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
  eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
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
  if (hit.id === 'slc') return '48 MB SRAM';
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

      <div id="reticle-layer" class="reticle-layer" aria-hidden="true">
        ${buildReticleSvg()}
        <div id="nm-bracket" class="nm-bracket" style="opacity:0;pointer-events:none;display:none;">
          <div class="nm-line"></div>
          <div id="nm-label" class="nm-label">12 nm Gate · 5 nm GAA Ribbon</div>
          <div class="nm-line"></div>
        </div>
      </div>

      <!-- Whisper-Quiet Hover Preview Pill -->
      <div id="hover-pill" class="hover-pill" aria-hidden="true">
        <span id="hover-title" class="hover-title"></span>
        <span class="hover-sep">·</span>
        <span id="hover-val" class="hover-val"></span>
      </div>

      <button id="restore-hud-btn" class="restore-hud-btn obsidian-glass" title="Show Interface (H)" style="display:none;">
        ${ICONS.eye}
        <span>Show UI</span>
      </button>

      <div id="hud-chrome" class="hud-chrome">
        <div class="hud-top">
          <div class="editorial-brand">
            <div class="editorial-title-row">
              <span id="live-pulse" class="live-pulse"></span>
              <span id="chip-name" class="editorial-name">Apple Silicon</span>
            </div>
            <div id="editorial-meta" class="editorial-meta">Initializing silicon telemetry…</div>
          </div>

          <div class="tool-capsule obsidian-glass">
            <button id="btn-tour" class="glass-btn" title="Cinematic Dive from US Quarter down to Quarks (Space)">
              <span id="btn-tour-icon">${ICONS.play}</span><span id="btn-tour-lbl">Dive</span>
            </button>
            <div class="capsule-divider"></div>
            <button id="btn-activity" class="glass-btn" title="Inspect per-core CPU, GPU, and die thermal telemetry">
              ${ICONS.activity}<span>Activity</span>
            </button>
            <button id="btn-burst" class="glass-btn" title="Run a 3.5-second multi-core Web Worker burst">
              ${ICONS.zap}<span id="btn-burst-lbl">Burst</span>
            </button>
            <div class="capsule-divider"></div>
            <button id="btn-thermal" class="glass-btn" title="Infrared Thermal Vision">
              ${ICONS.flame}<span>Thermal</span>
            </button>
            <button id="btn-orbit" class="glass-btn" title="Toggle 3D Orbit">
              ${ICONS.orbit}<span>Orbit</span>
            </button>
            <button id="btn-pure" class="glass-btn icon-only" title="Pure View — Hide UI (H)">
              ${ICONS.eyeOff}
            </button>
          </div>
        </div>

        <div id="activity-sheet" class="activity-sheet obsidian-glass" style="display:none;">
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
        </div>

        <!-- Interactive Die Block Inspector Card (Appears on Click) -->
        <div id="inspect-card" class="inspect-card obsidian-glass" style="display:none;">
          <div class="inspect-head">
            <div>
              <div id="inspect-title" class="inspect-title">Performance Core P0</div>
              <div id="inspect-sub" class="inspect-sub">Apple M1 Max</div>
            </div>
            <button id="inspect-close" class="inspect-close" title="Close (Esc)">${ICONS.close}</button>
          </div>
          <div id="inspect-metric" class="inspect-metric">—</div>
          <p id="inspect-detail" class="inspect-detail"></p>
          <button id="inspect-dive" class="inspect-dive-btn">Dive Inside →</button>
        </div>

        <div class="hud-bottom">
          <div class="scale-hud-row">
            <div class="scale-bar-wrap" title="Calibrated physical optical scale bar">
              <div id="scale-bar-rule" class="scale-bar-rule"></div>
              <span id="scale-bar-label" class="scale-bar-label">5 mm</span>
            </div>
            <div class="scale-sep"></div>
            <div id="scale-caption" class="floating-scale-caption">21 mm · 10×</div>
          </div>
          <div id="zoom-rail" class="zoom-rail obsidian-glass">
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
  const scaleCaption = document.getElementById('scale-caption')!;
  const scaleBarRule = document.getElementById('scale-bar-rule')!;
  const scaleBarLabel = document.getElementById('scale-bar-label')!;
  const railIndicator = document.getElementById('rail-indicator')!;
  const railButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#zoom-rail .rail-stop'));

  const hoverPill = document.getElementById('hover-pill')!;
  const hoverTitleEl = document.getElementById('hover-title')!;
  const hoverValEl = document.getElementById('hover-val')!;

  const livePulseEl = document.getElementById('live-pulse')!;
  const chipNameEl = document.getElementById('chip-name')!;
  const editorialMetaEl = document.getElementById('editorial-meta')!;
  const hudChromeEl = document.getElementById('hud-chrome')!;
  const restoreHudBtn = document.getElementById('restore-hud-btn')!;

  const btnTour = document.getElementById('btn-tour')!;
  const btnTourIcon = document.getElementById('btn-tour-icon')!;
  const btnTourLbl = document.getElementById('btn-tour-lbl')!;
  const btnActivity = document.getElementById('btn-activity')!;
  const btnBurst = document.getElementById('btn-burst')!;
  const btnBurstLbl = document.getElementById('btn-burst-lbl')!;
  const btnThermal = document.getElementById('btn-thermal')!;
  const btnOrbit = document.getElementById('btn-orbit')!;
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

  const inspectCard = document.getElementById('inspect-card')!;
  const inspectTitle = document.getElementById('inspect-title')!;
  const inspectSub = document.getElementById('inspect-sub')!;
  const inspectMetric = document.getElementById('inspect-metric')!;
  const inspectDetail = document.getElementById('inspect-detail')!;
  const inspectClose = document.getElementById('inspect-close')!;
  const inspectDive = document.getElementById('inspect-dive')!;

  let telemetry: LiveMacTelemetry = { ...DEFAULT_TELEMETRY };
  let activeInspect: DieInspectHit | null = null;
  let activeHover: DieInspectHit | null = null;
  let showActivity = false;
  let pureView = false;
  let bursting = false;
  let lastZoomRendered = -99;
  let lastActiveStop = 1;
  let lastCaption = '';
  let lastScaleBarLabel = '';
  let lastScaleBarPx = -1;
  let lastFpsUpdate = 0;
  let currentFps = 120;

  // Rolling 32-sample telemetry history for crisp Activity micro-sparkline
  const SPARK_MAX = 32;
  const cpuHistory: number[] = Array(SPARK_MAX).fill(0.16);
  const gpuHistory: number[] = Array(SPARK_MAX).fill(0.18);

  // Cached button layout geometry for zero-reflow continuously gliding rail indicator
  let railMetrics: { x: number; w: number }[] = [];
  const measureRail = () => {
    railMetrics = railButtons.map((btn) => ({ x: btn.offsetLeft, w: btn.offsetWidth }));
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
  };

  window.addEventListener('resize', measureRail);
  if (document.fonts && document.fonts.ready) {
    void document.fonts.ready.then(measureRail);
  }
  measureRail();

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

  const renderInspectCard = () => {
    if (!activeInspect) {
      inspectCard.style.display = 'none';
      return;
    }
    inspectCard.style.display = 'flex';
    inspectTitle.textContent = activeInspect.title(telemetry);
    inspectSub.textContent = activeInspect.subtitle(telemetry);
    inspectMetric.textContent = activeInspect.metric(telemetry);
    inspectDetail.textContent = activeInspect.detail(telemetry);
    const stopName = ZOOM_STOPS.find((s) => Math.abs(s.z - activeInspect!.diveZoom) < 0.01)?.label ?? 'Die';
    inspectDive.textContent = `Dive to ${stopName} →`;
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
    telemetry.nativeTelemetry
      ? 'IOKIT'
      : telemetry.live
        ? 'LIVE'
        : telemetry.pressureState
          ? 'PRESSURE'
          : 'WEB SIM';

  const engine = new SiliconEngine(gpuMount, {
    onZoomFrame: (z, fps, motion, interacting) => {
      currentFps = fps;
      const now = performance.now();
      if (showActivity && now - lastFpsUpdate > 350) {
        lastFpsUpdate = now;
        sheetFpsEl.textContent = `${currentFps} FPS · ${telemetryModeBadge()}`;
      }

      if (interacting || motion > 0.03) {
        engageReticle(interacting);
      }

      if (Math.abs(z - lastZoomRendered) < 0.0005) return;
      lastZoomRendered = z;

      const { magText, sizeText, dialDeg, bracketText, bracketOpacity, scaleBarLabel: barLbl, scaleBarPx } =
        formatMagnification(z);
      const frac = Math.max(0.015, Math.min(0.8, ((z + 1) / 10) * 0.8));
      reticleArc.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`);
      reticleDial.setAttribute('transform', `rotate(${(-dialDeg * 0.55).toFixed(2)} 270 270)`);

      if (bracketText && bracketOpacity > 0.01) {
        nmBracket.style.display = 'flex';
        nmBracket.style.opacity = bracketOpacity.toFixed(3);
        if (nmLabel.textContent !== bracketText) {
          nmLabel.textContent = bracketText;
        }
      } else if (nmBracket.style.display !== 'none') {
        nmBracket.style.display = 'none';
      }

      const cap = `${sizeText} · ${magText}`;
      if (cap !== lastCaption) {
        lastCaption = cap;
        scaleCaption.textContent = cap;
      }

      if (barLbl !== lastScaleBarLabel) {
        lastScaleBarLabel = barLbl;
        scaleBarLabel.textContent = barLbl;
      }
      const roundedPx = Math.round(scaleBarPx * 2) / 2;
      if (roundedPx !== lastScaleBarPx) {
        lastScaleBarPx = roundedPx;
        scaleBarRule.style.width = `${roundedPx.toFixed(1)}px`;
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
      activeInspect = hit;
      if (hit && activeHover && activeHover.id === hit.id) {
        hoverPill.classList.remove('visible');
      }
      renderInspectCard();
    },
    onHover: (hit, clientX, clientY) => {
      renderHoverPill(hit, clientX, clientY);
    },
    onTourChange: (active) => {
      btnTour.classList.toggle('active', active);
      btnTourIcon.innerHTML = active ? ICONS.stop : ICONS.play;
      btnTourLbl.textContent = active ? 'Stop' : 'Dive';
      if (!active && reticleEngaged) {
        engageReticle(false);
      }
    },
  });

  inspectClose.addEventListener('click', () => engine.clearInspect());
  inspectDive.addEventListener('click', () => {
    if (!activeInspect) return;
    const z = activeInspect.diveZoom;
    const targetXZ: [number, number] | undefined =
      activeInspect.id !== 'us-quarter' ? [activeInspect.box[0], activeInspect.box[1]] : undefined;
    engine.clearInspect();
    engine.flyToZoom(z, targetXZ);
  });

  // Wire zoom rail clicks
  for (const btn of railButtons) {
    btn.addEventListener('click', () => {
      const z = Number(btn.dataset.z ?? 0);
      engine.flyToZoom(z);
    });
  }

  // Render Activity Sheet bars, micro-sparkline, real GPU/Thermal metrics & process list only when open
  let tickCols: { fill: HTMLDivElement; lbl: HTMLSpanElement }[] = [];
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

  const renderActivitySheet = () => {
    if (!showActivity) return;
    sheetCoresEl.textContent = `${telemetry.pCoreCount}P + ${telemetry.eCoreCount}E CORES`;
    sheetFpsEl.textContent = `${currentFps} FPS · ${telemetryModeBadge()}`;

    hwGpuLbl.textContent = `${telemetry.gpuCores}C GPU`;
    hwGpuVal.textContent = `${Math.round(telemetry.gpuEst * 100)}%`;
    hwVramVal.textContent = `${telemetry.gpuMemGB.toFixed(2)} GB`;
    hwTempVal.textContent =
      telemetry.socTempC !== null ? `${telemetry.socTempC.toFixed(1)}°C` : telemetry.thermalState;

    const loads = telemetry.coreLoads.slice(0, 12);
    if (tickCols.length !== loads.length) {
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

    const procs = telemetry.topProcs.slice(0, 3);
    procListEl.innerHTML = procs
      .map(
        (p) =>
          `<div class="proc-row"><span class="proc-name">${p.name.replace(/</g, '&lt;')}</span><span class="proc-cpu">${p.cpu.toFixed(1)}%</span></div>`
      )
      .join('');
  };

  // Wire top-right tool capsule controls
  btnTour.addEventListener('click', () => {
    engine.toggleTour();
    btnTour.blur();
  });

  btnActivity.addEventListener('click', () => {
    showActivity = !showActivity;
    btnActivity.classList.toggle('active', showActivity);
    activitySheet.style.display = showActivity ? 'flex' : 'none';
    if (showActivity) renderActivitySheet();
  });

  btnThermal.addEventListener('click', () => {
    engine.thermal = !engine.thermal;
    btnThermal.classList.toggle('active', engine.thermal);
  });

  btnOrbit.addEventListener('click', () => {
    engine.autoOrbit = !engine.autoOrbit;
    btnOrbit.classList.toggle('active', engine.autoOrbit);
  });

  const setPure = (next: boolean) => {
    pureView = next;
    hudChromeEl.classList.toggle('hidden', pureView);
    restoreHudBtn.style.display = pureView ? 'inline-flex' : 'none';
    if (pureView) hoverPill.classList.remove('visible');
  };

  btnPure.addEventListener('click', () => setPure(true));
  restoreHudBtn.addEventListener('click', () => setPure(false));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') {
      setPure(!pureView);
    } else if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      engine.toggleTour();
    } else if (e.key === 'Escape') {
      if (engine.isTourActive) engine.stopTour();
      if (activeInspect) engine.clearInspect();
    }
  });

  const browserTelemetry = new BrowserTelemetrySource(engine.getGpuRenderer());

  btnBurst.addEventListener('click', () => {
    if (bursting) return;
    bursting = true;
    browserTelemetry.setBurst(true);
    btnBurst.classList.add('active');
    btnBurstLbl.textContent = 'Bursting';

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
    for (let i = 0; i < count; i++) workers.push(new Worker(url));

    window.setTimeout(() => {
      workers.forEach((w) => w.terminate());
      URL.revokeObjectURL(url);
      bursting = false;
      browserTelemetry.setBurst(false);
      btnBurst.classList.remove('active');
      btnBurstLbl.textContent = 'Burst';
    }, 3600);
  });

  const applyTelemetry = (data: LiveMacTelemetry) => {
    telemetry = data;
    engine.setTelemetry(data);

    cpuHistory.push(data.cpuTotal);
    if (cpuHistory.length > SPARK_MAX) cpuHistory.shift();
    gpuHistory.push(data.gpuEst);
    if (gpuHistory.length > SPARK_MAX) gpuHistory.shift();

    livePulseEl.classList.toggle('sim', !data.live);
    chipNameEl.textContent = data.chipName;
    const cpuPct = Math.round(data.cpuTotal * 100);
    const gpuPct = Math.round(data.gpuEst * 100);
    const tempPart = data.socTempC !== null ? `${data.socTempC.toFixed(0)}°C · ` : '';
    if (data.live) {
      editorialMetaEl.textContent = `${tempPart}${cpuPct}% CPU · ${gpuPct}% GPU · ${data.memUsedGB}/${data.memTotalGB} GB`;
    } else {
      const modeTag = data.pressureState ? `PRESSURE ${data.thermalState.toUpperCase()}` : 'WEB SIM';
      editorialMetaEl.textContent = `${tempPart}${cpuPct}% CPU · ${gpuPct}% GPU · ${data.totalCores}C · ${modeTag}`;
    }
    renderActivitySheet();
    if (activeInspect) renderInspectCard();
    if (activeHover && hoverPill.classList.contains('visible')) {
      hoverValEl.textContent = conciseHoverMetric(activeHover, telemetry);
    }
  };

  let useBrowserMode = false;
  let pollTimer: number | null = null;

  const startBrowserTelemetry = () => {
    if (useBrowserMode) return;
    useBrowserMode = true;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    const tick = () => applyTelemetry(browserTelemetry.sample(engine.getFrameActivity()));
    tick();
    pollTimer = window.setInterval(tick, 450);
  };

  const isLocalHost =
    import.meta.env.DEV ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost';

  if (!isLocalHost) {
    startBrowserTelemetry();
  } else {
    let liveFailures = 0;
    const pollTelemetry = async () => {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
          throw new Error('No local telemetry API');
        }
        const data = (await res.json()) as LiveMacTelemetry;
        if (!data || !Array.isArray(data.coreLoads)) {
          throw new Error('Invalid telemetry payload');
        }
        liveFailures = 0;
        applyTelemetry(data);
      } catch {
        liveFailures++;
        if (liveFailures >= 1 && !telemetry.live) {
          startBrowserTelemetry();
        }
      }
    };

    void pollTelemetry();
    pollTimer = window.setInterval(pollTelemetry, 650);
  }
}

mountApp();
