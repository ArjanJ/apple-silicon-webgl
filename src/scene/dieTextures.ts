import * as THREE from 'three';

export interface DiePBRMaps {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

/**
 * Generates ultra-detailed 2048×1600 procedural micro-photograph PBR textures
 * of a real modern 3nm SoC silicon die (repeating SRAM cache arrays, symmetric
 * CPU/GPU datapath grids, iridescent wafer sheen, and perimeter bond-pad ring).
 */
export function createSiliconDiePBR(): DiePBRMaps {
  const W = 2048;
  const H = 1600;

  const colCanvas = document.createElement('canvas');
  colCanvas.width = W;
  colCanvas.height = H;
  const ctx = colCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = W;
  bumpCanvas.height = H;
  const bCtx = bumpCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = W;
  roughCanvas.height = H;
  const rCtx = roughCanvas.getContext('2d')!;

  // 1. Base polished silicon wafer with subtle diagonal iridescent diffraction gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0.0, '#131824');
  bg.addColorStop(0.25, '#192233');
  bg.addColorStop(0.5, '#1c182c');
  bg.addColorStop(0.75, '#13252c');
  bg.addColorStop(1.0, '#121722');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  bCtx.fillStyle = '#303030';
  bCtx.fillRect(0, 0, W, H);

  rCtx.fillStyle = '#404040';
  rCtx.fillRect(0, 0, W, H);

  // 2. Global ultra-fine lithography grid across the entire wafer
  ctx.strokeStyle = 'rgba(130, 170, 225, 0.06)';
  ctx.lineWidth = 1;
  bCtx.strokeStyle = '#585858';
  bCtx.lineWidth = 1;
  for (let x = 0; x < W; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    if (x % 32 === 0) {
      bCtx.beginPath();
      bCtx.moveTo(x, 0);
      bCtx.lineTo(x, H);
      bCtx.stroke();
    }
  }
  for (let y = 0; y < H; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Helper: Draw a hyper-detailed SRAM / logic macro sub-array (looks like real die photography!)
  const drawMacroBlock = (
    x: number,
    y: number,
    w: number,
    h: number,
    cols: number,
    rows: number,
    baseHue: string,
    stripeHue: string,
    sramDensity = 12
  ) => {
    const pad = 12;
    const cw = (w - pad * (cols + 1)) / cols;
    const ch = (h - pad * (rows + 1)) / rows;

    // Outer recessed moat
    ctx.fillStyle = 'rgba(5, 8, 14, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stripeHue;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    ctx.globalAlpha = 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = x + pad + c * (cw + pad);
        const cy = y + pad + r * (ch + pad);

        // Cell metallic base
        ctx.fillStyle = baseHue;
        ctx.fillRect(cx, cy, cw, ch);

        bCtx.fillStyle = '#9a9a9a';
        bCtx.fillRect(cx, cy, cw, ch);
        rCtx.fillStyle = '#2a2a2a';
        rCtx.fillRect(cx, cy, cw, ch);

        // Micro-SRAM dense parallel stripes (left 40% of each core = L1 cache banks!)
        const sramW = cw * 0.42;
        const bankStep = Math.max(4, ch / sramDensity);
        ctx.fillStyle = stripeHue;
        ctx.globalAlpha = 0.28;
        bCtx.fillStyle = '#e0e0e0';
        for (let sy = cy + 4; sy < cy + ch - 4; sy += bankStep) {
          ctx.fillRect(cx + 4, sy, sramW - 8, bankStep * 0.45);
          bCtx.fillRect(cx + 4, sy, sramW - 8, bankStep * 0.45);
        }

        // Right 55% of each core = intricate ALU / datapath logic sub-blocks
        const logX = cx + sramW + 4;
        const logW = cw - sramW - 8;
        const subCols = 6;
        const subRows = 5;
        const sw = logW / subCols;
        const sh = (ch - 8) / subRows;
        for (let sr = 0; sr < subRows; sr++) {
          for (let sc = 0; sc < subCols; sc++) {
            const hash = Math.sin((c * 13 + sc) * 19.1 + (r * 7 + sr) * 31.7) * 43758.5453;
            const f = hash - Math.floor(hash);
            ctx.globalAlpha = 0.12 + f * 0.28;
            ctx.fillStyle = f > 0.55 ? stripeHue : '#9ec5ff';
            ctx.fillRect(logX + sc * sw + 1, cy + 4 + sr * sh + 1, sw - 2, sh - 2);
            bCtx.fillStyle = f > 0.5 ? '#d4d4d4' : '#707070';
            bCtx.fillRect(logX + sc * sw + 1, cy + 4 + sr * sh + 1, sw - 2, sh - 2);
          }
        }
        ctx.globalAlpha = 1;

        // Crisp micro-bezel around every core
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx, cy, cw, ch);
      }
    }
  };

  // Map our die neighborhoods onto UV space [0..W] x [0..H] matching die bounds [-3.325..3.325] x [-2.625..2.625]
  const mapX = (wx: number) => ((wx + 3.325) / 6.65) * W;
  const mapZ = (wz: number) => ((wz + 2.625) / 5.25) * H;
  const mapW = (ww: number) => (ww / 6.65) * W;
  const mapH = (wh: number) => (wh / 5.25) * H;

  // P-Cores (8x) — golden-amber micro-architecture
  drawMacroBlock(mapX(-2.9), mapZ(-1.98), mapW(2.7), mapH(1.85), 4, 2, '#221c18', '#ffb347', 16);
  // E-Cores (4x) — sapphire-cyan micro-architecture
  drawMacroBlock(mapX(-2.9), mapZ(0.22), mapW(2.7), mapH(1.35), 4, 1, '#14202c', '#4cc9ff', 14);
  // System Level Cache (24 MB) — dense vertical SRAM stripes!
  drawMacroBlock(mapX(-0.12), mapZ(-1.98), mapW(0.55), mapH(3.65), 1, 8, '#262218', '#ffe299', 20);
  // 16-Core GPU — gleaming emerald-teal shader arrays
  drawMacroBlock(mapX(0.6), mapZ(-1.98), mapW(2.5), mapH(2.38), 4, 4, '#112628', '#29f2d8', 12);
  // 16-Core Neural Engine — luminous violet systolic arrays
  drawMacroBlock(mapX(0.6), mapZ(0.62), mapW(2.5), mapH(1.25), 8, 2, '#1f152e', '#c96bff', 10);
  // USB / HID I/O Controller
  drawMacroBlock(mapX(-2.9), mapZ(1.72), mapW(2.7), mapH(0.6), 6, 1, '#12261e', '#4eff9b', 8);
  // Display & Media Engine
  drawMacroBlock(mapX(0.6), mapZ(1.98), mapW(2.5), mapH(0.44), 5, 1, '#29151d', '#ff6e82', 8);

  // 3. Perimeter Die Seal Ring & Microscopic Gold Bond Pads
  ctx.strokeStyle = 'rgba(230, 190, 105, 0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  bCtx.strokeStyle = '#ffffff';
  bCtx.lineWidth = 8;
  bCtx.strokeRect(18, 18, W - 36, H - 36);

  ctx.fillStyle = 'rgba(235, 198, 118, 0.72)';
  bCtx.fillStyle = '#ffffff';
  for (let x = 44; x < W - 44; x += 28) {
    ctx.fillRect(x, 26, 12, 18);
    ctx.fillRect(x, H - 44, 12, 18);
    bCtx.fillRect(x, 26, 12, 18);
    bCtx.fillRect(x, H - 44, 12, 18);
  }
  for (let y = 44; y < H - 44; y += 28) {
    ctx.fillRect(26, y, 18, 12);
    ctx.fillRect(W - 44, y, 18, 12);
    bCtx.fillRect(26, y, 18, 12);
    bCtx.fillRect(W - 44, y, 18, 12);
  }

  const albedo = new THREE.CanvasTexture(colCanvas);
  albedo.anisotropy = 16;
  albedo.colorSpace = THREE.SRGBColorSpace;

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.anisotropy = 8;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.anisotropy = 8;

  return { albedo, bump, roughness };
}

/**
 * Photorealistic High-Density Organic SoC Substrate (dark emerald/slate solder mask
 * with chamfered 45° golden micro-traces, via arrays, and precision fiducials).
 */
export function createSubstratePBR(): { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1536;
  const H = 960;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const b = document.createElement('canvas');
  b.width = W;
  b.height = H;
  const bCtx = b.getContext('2d')!;

  // Deep matte dark-emerald/obsidian Apple-Silicon substrate
  const grad = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.65);
  grad.addColorStop(0, '#101d19');
  grad.addColorStop(1, '#09110e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  bCtx.fillStyle = '#383838';
  bCtx.fillRect(0, 0, W, H);

  // Fine fiberglass weave
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 1, H);

  // High-speed differential copper traces fanning from central die to left/right Unified RAM!
  ctx.strokeStyle = 'rgba(84, 152, 118, 0.32)';
  bCtx.strokeStyle = '#757575';
  ctx.lineWidth = 2;
  bCtx.lineWidth = 2;
  for (let i = 0; i < 42; i++) {
    const y = 140 + (i / 41) * 680;
    const jog = ((i % 7) - 3) * 8;
    // Left bus fanout
    ctx.beginPath();
    ctx.moveTo(220, y);
    ctx.lineTo(340, y);
    ctx.lineTo(365, y + jog);
    ctx.lineTo(500, y + jog);
    ctx.stroke();
    // Right bus fanout
    ctx.beginPath();
    ctx.moveTo(W - 220, y);
    ctx.lineTo(W - 340, y);
    ctx.lineTo(W - 365, y + jog);
    ctx.lineTo(W - 500, y + jog);
    ctx.stroke();
  }

  // Gold edge chamfer trim & corner optical fiducial targets
  ctx.strokeStyle = 'rgba(218, 178, 92, 0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  const fiducials: [number, number][] = [
    [52, 52],
    [W - 52, 52],
    [52, H - 52],
    [W - 52, H - 52],
  ];
  for (const [fx, fy] of fiducials) {
    ctx.beginPath();
    ctx.arc(fx, fy, 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 194, 108, 0.72)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fx, fy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c26c';
    ctx.fill();
  }

  // Precision silkscreen serial
  ctx.fillStyle = 'rgba(218, 198, 152, 0.42)';
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText('M-3NM-PRO  //  3nm GAA PROCESS  //  28B TRANSISTORS', 96, 56);

  const albedo = new THREE.CanvasTexture(c);
  albedo.anisotropy = 16;
  albedo.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(b);
  return { albedo, bump };
}
