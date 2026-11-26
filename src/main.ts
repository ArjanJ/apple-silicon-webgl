import './styles.css';
import { SiliconEngine } from './engine/SiliconEngine';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from './sim/macTelemetry';
import { formatMagnification } from './sim/microJourney';

/**
 * Zero-Overhead Vanilla DOM Controller for Apple Silicon 3D Microscope.
 *   - No React reconciliation or virtual DOM during 120 FPS zoom
 *   - Direct SVG & text node updates only when values actually change
 *   - Crisp obsidian-glass HUD with zero CSS backdrop-filter compositor overhead
 */

const ZOOM_STOPS = [
  { z: 0.0, label: 'Die' },
  { z: 1.0, label: 'Striations' },
  { z: 2.0, label: 'Canyons' },
  { z: 3.0, label: 'Grid' },
  { z: 4.0, label: '3 nm' },
];

const DIAL_TICKS = [
  { deg: -136, label: '10×' },
  { deg: -68, label: '2.5K×' },
  { deg: 0, label: '250K×' },
  { deg: 68, label: '8M×' },
  { deg: 136, label: '100M×' },
];

const ICONS = {
  activity: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  zap: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  flame: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  orbit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 13.707 3.814 1.86-1.86 3.814"/><path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"/></svg>`,
  eyeOff: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
  eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
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
        transform="rotate(-226 270 270)"
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
          <div class="nm-label">3 nm · ~11 Silicon Atoms</div>
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
              <span class="live-pulse"></span>
              <span id="chip-name" class="editorial-name">Apple Silicon</span>
            </div>
            <div id="editorial-meta" class="editorial-meta">17% CPU · 14.2/32 GB · 12 KB/s</div>
          </div>

          <div class="tool-capsule obsidian-glass">
            <button id="btn-activity" class="glass-btn" title="Inspect live per-core activity and top processes">
              ${ICONS.activity}<span>Activity</span>
            </button>
            <button id="btn-burst" class="glass-btn" title="Run a 3.5-second multi-core burst on your Mac">
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
            <span id="sheet-fps">60 FPS · LIVE</span>
          </div>
          <div id="tick-meter" class="tick-meter" title="Live per-core CPU utilization"></div>
          <div id="proc-list" class="proc-list"></div>
        </div>

        <div class="hud-bottom">
          <div id="scale-caption" class="floating-scale-caption">12.0 mm · 10×</div>
          <div id="zoom-rail" class="zoom-rail obsidian-glass">
            ${ZOOM_STOPS.map(
              (st, idx) =>
                `<button class="rail-stop ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-z="${st.z}">${st.label}</button>`
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
  const scaleCaption = document.getElementById('scale-caption')!;
  const railButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#zoom-rail .rail-stop'));

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
  const procListEl = document.getElementById('proc-list')!;

  let telemetry: LiveMacTelemetry = { ...DEFAULT_TELEMETRY };
  let showActivity = false;
  let pureView = false;
  let bursting = false;
  let lastZoomRendered = -1;
  let lastActiveStop = 0;
  let lastCaption = '';
  let lastFpsUpdate = 0;
  let currentFps = 60;

  const r = 242;
  const circ = 2 * Math.PI * r;

  const engine = new SiliconEngine(gpuMount, {
    onZoomFrame: (z, fps) => {
      currentFps = fps;
      const now = performance.now();
      if (showActivity && now - lastFpsUpdate > 350) {
        lastFpsUpdate = now;
        sheetFpsEl.textContent = `${currentFps} FPS · ${telemetry.live ? 'LIVE' : 'SIM'}`;
      }

      if (Math.abs(z - lastZoomRendered) < 0.0005) return;
      lastZoomRendered = z;

      const { magText, sizeText, dialDeg } = formatMagnification(z);
      const frac = Math.max(0.03, Math.min(1, (z / 4) * 0.78 + 0.04));
      reticleArc.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`);
      reticleDial.setAttribute('transform', `rotate(${(-dialDeg * 0.55).toFixed(2)} 270 270)`);

      if (z >= 3.55) {
        const op = Math.max(0, Math.min(1, (z - 3.55) / 0.35));
        nmBracket.style.display = 'flex';
        nmBracket.style.opacity = op.toFixed(3);
      } else if (nmBracket.style.display !== 'none') {
        nmBracket.style.display = 'none';
      }

      const cap = `${sizeText} · ${magText}`;
      if (cap !== lastCaption) {
        lastCaption = cap;
        scaleCaption.textContent = cap;
      }

      const stopIdx = Math.round(z);
      if (stopIdx !== lastActiveStop) {
        railButtons[lastActiveStop]?.classList.remove('active');
        railButtons[stopIdx]?.classList.add('active');
        lastActiveStop = stopIdx;
      }
    },
  });

  // Wire zoom rail clicks
  for (const btn of railButtons) {
    btn.addEventListener('click', () => {
      const z = Number(btn.dataset.z ?? 0);
      engine.flyToZoom(z);
    });
  }

  // Render Activity Sheet bars & process list only when open
  let tickCols: { fill: HTMLDivElement; lbl: HTMLSpanElement }[] = [];
  const renderActivitySheet = () => {
    if (!showActivity) return;
    sheetCoresEl.textContent = `${telemetry.pCoreCount}P + ${telemetry.eCoreCount}E CORES`;
    sheetFpsEl.textContent = `${currentFps} FPS · ${telemetry.live ? 'LIVE' : 'SIM'}`;

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
    }
  });

  btnBurst.addEventListener('click', () => {
    if (bursting) return;
    bursting = true;
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
      btnBurst.classList.remove('active');
      btnBurstLbl.textContent = 'Burst';
    }, 3600);
  });

  // Poll real live Mac hardware telemetry every 850ms
  const pollTelemetry = async () => {
    try {
      const res = await fetch('/api/telemetry', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as LiveMacTelemetry;
      telemetry = data;
      engine.setTelemetry(data);

      chipNameEl.textContent = data.chipName;
      const cpuPct = Math.round(data.cpuTotal * 100);
      const netLabel =
        data.netKBps >= 1024 ? `${(data.netKBps / 1024).toFixed(1)} MB/s` : `${data.netKBps.toFixed(0)} KB/s`;
      editorialMetaEl.textContent = `${cpuPct}% CPU · ${data.memUsedGB}/${data.memTotalGB} GB · ${netLabel}`;
      renderActivitySheet();
    } catch {
      // ignore in static preview
    }
  };

  pollTelemetry();
  window.setInterval(pollTelemetry, 850);
}

mountApp();
