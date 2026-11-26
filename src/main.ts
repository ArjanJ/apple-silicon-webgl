import './styles.css';
import { DieInspectHit } from './engine/inspect';
import { SiliconEngine } from './engine/SiliconEngine';
import { BrowserTelemetrySource } from './sim/browserTelemetry';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';

/**
 * Zero-Overhead Vanilla DOM Controller for Apple Silicon 3D Microscope.
 *   - No React reconciliation or virtual DOM during 120 FPS zoom
 *   - Live Native Mach/IOKit telemetry (real GPU %, VRAM, SoC Die Temp, per-core CPU)
 *   - Interactive click-to-inspect on any silicon die block with 3D surface highlight
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
      isMajor ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'
    }" stroke-width="${isMajor ? '0.9' : '0.5'}"/>`;
  }

  let labels = '';
  for (const tk of DIAL_TICKS) {
    const rad = ((tk.deg - 90) * Math.PI) / 180;
    const tx = (270 + Math.cos(rad) * (r + 16)).toFixed(2);
    const ty = (270 + Math.sin(rad) * (r + 16)).toFixed(2);
    labels += `<text x="${tx}" y="${ty}" fill="rgba(245, 245, 247, 0.28)" font-size="7" font-family="'JetBrains Mono', monospace" font-weight="500" text-anchor="middle" dominant-baseline="middle">${tk.label}</text>`;
  }

  return `
    <svg class="reticle-svg" viewBox="0 0 540 540">
      <circle cx="270" cy="270" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.75" />
      <circle
        id="reticle-arc"
        cx="270"
        cy="270"
        r="${r}"
        fill="none"
        stroke="rgba(245, 245, 247, 0.34)"
        stroke-width="1.25"
        stroke-dasharray="${(circ * 0.04).toFixed(2)} ${circ.toFixed(2)}"
        stroke-linecap="round"
        transform="rotate(-234 270 270)"
      />
      <g id="reticle-dial">${ticks}</g>
      <line x1="259" y1="270" x2="265" y2="270" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" />
      <line x1="275" y1="270" x2="281" y2="270" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" />
      <line x1="270" y1="259" x2="270" y2="265" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" />
      <line x1="270" y1="275" x2="270" y2="281" stroke="rgba(255,255,255,0.16)" stroke-width="0.7" />
      ${labels}
    </svg>
  `;
}

function mountApp(): void {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `
    <div class="apple-stage">
      <div id="gpu-mount" class="raymarch-mount"></div>

      <div class="reticle-layer" aria-hidden="true">
        ${buildReticleSvg()}
        <div id="nm-bracket" class="nm-bracket" style="opacity:0;pointer-events:none;display:none;">
          <div class="nm-line"></div>
          <div id="nm-label" class="nm-label">12 nm Gate · 5 nm GAA Ribbon</div>
          <div class="nm-line"></div>
        </div>
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
          <div id="scale-caption" class="floating-scale-caption">21 mm · 10×</div>
          <div id="zoom-rail" class="zoom-rail obsidian-glass">
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
  const reticleArc = document.getElementById('reticle-arc')!;
  const reticleDial = document.getElementById('reticle-dial')!;
  const nmBracket = document.getElementById('nm-bracket')!;
  const nmLabel = document.getElementById('nm-label')!;
  const scaleCaption = document.getElementById('scale-caption')!;
  const railButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#zoom-rail .rail-stop'));

  const livePulseEl = document.getElementById('live-pulse')!;
  const chipNameEl = document.getElementById('chip-name')!;
  const editorialMetaEl = document.getElementById('editorial-meta')!;
  const hudChromeEl = document.getElementById('hud-chrome')!;
  const restoreHudBtn = document.getElementById('restore-hud-btn')!;

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
  let showActivity = false;
  let pureView = false;
  let bursting = false;
  let lastZoomRendered = -99;
  let lastActiveStop = 1;
  let lastCaption = '';
  let lastFpsUpdate = 0;
  let currentFps = 120;

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

  const telemetryModeBadge = () =>
    telemetry.nativeTelemetry
      ? 'IOKIT'
      : telemetry.live
        ? 'LIVE'
        : telemetry.pressureState
          ? 'PRESSURE'
          : 'WEB SIM';

  const engine = new SiliconEngine(gpuMount, {
    onZoomFrame: (z, fps) => {
      currentFps = fps;
      const now = performance.now();
      if (showActivity && now - lastFpsUpdate > 350) {
        lastFpsUpdate = now;
        sheetFpsEl.textContent = `${currentFps} FPS · ${telemetryModeBadge()}`;
      }

      if (Math.abs(z - lastZoomRendered) < 0.0005) return;
      lastZoomRendered = z;

      const { magText, sizeText, dialDeg, bracketText, bracketOpacity } = formatMagnification(z);
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

      const stopIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, Math.round(z) + 1));
      if (stopIdx !== lastActiveStop) {
        railButtons[lastActiveStop]?.classList.remove('active');
        railButtons[stopIdx]?.classList.add('active');
        lastActiveStop = stopIdx;
      }
    },
    onInspect: (hit) => {
      activeInspect = hit;
      renderInspectCard();
    },
  });

  inspectClose.addEventListener('click', () => engine.clearInspect());
  inspectDive.addEventListener('click', () => {
    if (!activeInspect) return;
    const z = activeInspect.diveZoom;
    // Dive directly into the inspected die block's exact physical (cx, cz) coordinates!
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

  // Render Activity Sheet bars, real GPU/Thermal metrics & process list only when open
  let tickCols: { fill: HTMLDivElement; lbl: HTMLSpanElement }[] = [];
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
  };

  btnPure.addEventListener('click', () => setPure(true));
  restoreHudBtn.addEventListener('click', () => setPure(false));

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') {
      setPure(!pureView);
    } else if (e.key === 'Escape' && activeInspect) {
      engine.clearInspect();
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

  // Use native Mach/IOKit middleware when running locally (npm run dev);
  // automatically fall back to zero-install hybrid browser telemetry on static hosts (GitHub Pages / preview).
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
