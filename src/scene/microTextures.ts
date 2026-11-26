import * as THREE from 'three';

export interface MacroDieTextures {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

/**
 * Generates an ultra-dense 2048×2048 optical-microscope silicon die texture inspired by
 * real thin-film iridescent wafer photography: deep cobalt, emerald, warm champagne-gold,
 * and violet interference gradients packed with hundreds of crisp SRAM vaults, bus rails,
 * fine parallel trace arrays, and glistening metallic pad rows.
 */
export function createMicroscopeDieTextures(): MacroDieTextures {
  const W = 2048;
  const H = 2048;

  const colC = document.createElement('canvas');
  colC.width = W;
  colC.height = H;
  const ctx = colC.getContext('2d')!;

  const bumpC = document.createElement('canvas');
  bumpC.width = W;
  bumpC.height = H;
  const bCtx = bumpC.getContext('2d')!;

  const roughC = document.createElement('canvas');
  roughC.width = W;
  roughC.height = H;
  const rCtx = roughC.getContext('2d')!;

  // 1. Rich thin-film optical interference sweep across the silicon wafer
  const baseGrad = ctx.createLinearGradient(0, 0, W, H);
  baseGrad.addColorStop(0.0, '#182c26'); // emerald-bronze left
  baseGrad.addColorStop(0.22, '#2d291a'); // warm gold sheen
  baseGrad.addColorStop(0.45, '#122a40'); // deep sapphire
  baseGrad.addColorStop(0.72, '#0e1f4a'); // rich cobalt blue
  baseGrad.addColorStop(0.88, '#1e163b'); // thin-film violet edge
  baseGrad.addColorStop(1.0, '#0d1a33');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, W, H);

  bCtx.fillStyle = '#242424';
  bCtx.fillRect(0, 0, W, H);
  rCtx.fillStyle = '#383838';
  rCtx.fillRect(0, 0, W, H);

  // Subtle diagonal wafer diffraction wave bands
  for (let i = -10; i < 20; i++) {
    const g = ctx.createLinearGradient(i * 180, 0, i * 180 + 260, H);
    g.addColorStop(0, 'rgba(60, 180, 255, 0)');
    g.addColorStop(0.5, i % 2 === 0 ? 'rgba(85, 220, 190, 0.065)' : 'rgba(255, 200, 95, 0.055)');
    g.addColorStop(1, 'rgba(160, 90, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Deterministic PRNG for dense, crisp, authentic semiconductor layouts
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Helper: densely striated SRAM / Cache / Logic tile (authentic microscope texture!)
  const drawDenseTile = (
    x: number,
    y: number,
    w: number,
    h: number,
    palette: { fill: string; stripe: string; border: string; accent: string },
    orientation: 'h' | 'v' | 'grid'
  ) => {
    // Dark recessed moat
    ctx.fillStyle = '#070b12';
    ctx.fillRect(x, y, w, h);
    bCtx.fillStyle = '#101010';
    bCtx.fillRect(x, y, w, h);

    const pad = 4;
    const ix = x + pad;
    const iy = y + pad;
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    if (iw <= 4 || ih <= 4) return;

    ctx.fillStyle = palette.fill;
    ctx.fillRect(ix, iy, iw, ih);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(ix, iy, iw, ih);
    rCtx.fillStyle = '#262626';
    rCtx.fillRect(ix, iy, iw, ih);

    // Ultra-fine hair-thin parallel striations (makes it look like real silicon!)
    ctx.fillStyle = palette.stripe;
    bCtx.fillStyle = '#d4d4d4';
    if (orientation === 'h') {
      const step = Math.max(3, Math.floor(ih / 36));
      for (let sy = iy + 2; sy < iy + ih - 2; sy += step) {
        ctx.globalAlpha = 0.22 + rand() * 0.25;
        ctx.fillRect(ix + 2, sy, iw - 4, Math.max(1, step * 0.45));
        bCtx.fillRect(ix + 2, sy, iw - 4, Math.max(1, step * 0.45));
      }
    } else if (orientation === 'v') {
      const step = Math.max(3, Math.floor(iw / 36));
      for (let sx = ix + 2; sx < ix + iw - 2; sx += step) {
        ctx.globalAlpha = 0.22 + rand() * 0.25;
        ctx.fillRect(sx, iy + 2, Math.max(1, step * 0.45), ih - 4);
        bCtx.fillRect(sx, iy + 2, Math.max(1, step * 0.45), ih - 4);
      }
    } else {
      // Nested micro-block tessellation
      const cols = Math.max(2, Math.floor(iw / 18));
      const rows = Math.max(2, Math.floor(ih / 18));
      const cw = iw / cols;
      const ch = ih / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = rand();
          ctx.globalAlpha = 0.14 + v * 0.34;
          ctx.fillStyle = v > 0.72 ? palette.accent : palette.stripe;
          ctx.fillRect(ix + c * cw + 1, iy + r * ch + 1, cw - 2, ch - 2);
          bCtx.fillStyle = v > 0.5 ? '#e4e4e4' : '#646464';
          bCtx.fillRect(ix + c * cw + 1, iy + r * ch + 1, cw - 2, ch - 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Bright silver-white thin-film perimeter rail
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(ix, iy, iw, ih);
    bCtx.strokeStyle = '#ffffff';
    bCtx.lineWidth = 2;
    bCtx.strokeRect(ix, iy, iw, ih);
  };

  // Recursive architectural subdivision across the entire 2048×2048 die!
  const palettes = [
    { fill: '#1a2738', stripe: '#88c4ff', border: 'rgba(220,238,255,0.6)', accent: '#e8c468' }, // Cobalt/Silver
    { fill: '#26241b', stripe: '#ebd18a', border: 'rgba(248,232,180,0.65)', accent: '#62e0c8' }, // Champagne Gold
    { fill: '#162825', stripe: '#66d9ba', border: 'rgba(180,248,230,0.55)', accent: '#d8b8ff' }, // Emerald Teal
    { fill: '#1d1c2e', stripe: '#b8a6f0', border: 'rgba(218,210,255,0.5)', accent: '#7ce2ff' }, // Thin-Film Violet
    { fill: '#171c24', stripe: '#b8c7d9', border: 'rgba(235,244,255,0.68)', accent: '#ffd37a' }, // Dark Charcoal Cache
  ];

  // Major silicon functional quadrants separated by bright silver-white power bus canyons
  const margin = 88;
  const regions: { x: number; y: number; w: number; h: number; cols: number; rows: number; palIdx: number; mode: 'h' | 'v' | 'grid' }[] = [
    // Top-left: 8× Performance Core Cluster (rich bronze-gold & charcoal SRAM)
    { x: margin, y: margin, w: 860, h: 720, cols: 4, rows: 2, palIdx: 1, mode: 'grid' },
    // Center-left: 4× Efficiency Core Cluster (gleaming cobalt-sapphire + cyan!)
    { x: margin, y: 840, w: 860, h: 520, cols: 4, rows: 2, palIdx: 0, mode: 'h' },
    // Bottom-left: USB / HID I/O + PHY Controller (emerald-gold pad arrays)
    { x: margin, y: 1396, w: 860, h: 564, cols: 6, rows: 3, palIdx: 2, mode: 'v' },
    // Center Spine: System Level Cache 24MB (ultra-dense vertical charcoal/silver SRAM banks!)
    { x: 976, y: margin, w: 176, h: 1872, cols: 2, rows: 16, palIdx: 4, mode: 'h' },
    // Top-right: 16-Core GPU Cluster (iridescent emerald/cyan shader grid)
    { x: 1180, y: margin, w: 780, h: 980, cols: 4, rows: 4, palIdx: 2, mode: 'grid' },
    // Mid-right: 16-Core Neural Engine (violet/silver systolic array)
    { x: 1180, y: 1096, w: 780, h: 460, cols: 8, rows: 2, palIdx: 3, mode: 'v' },
    // Bottom-right: Display & Media Engine (cobalt/gold high-speed scanout)
    { x: 1180, y: 1588, w: 780, h: 372, cols: 5, rows: 2, palIdx: 0, mode: 'h' },
  ];

  for (const reg of regions) {
    const cw = reg.w / reg.cols;
    const ch = reg.h / reg.rows;
    for (let r = 0; r < reg.rows; r++) {
      for (let c = 0; c < reg.cols; c++) {
        const x = reg.x + c * cw;
        const y = reg.y + r * ch;
        const pal = palettes[(reg.palIdx + ((r + c) % 2 === 0 ? 0 : 4)) % palettes.length];
        // Split each macro core into 2 internal sub-blocks (L1 SRAM bank + Datapath logic)
        if (cw > 110 && ch > 110) {
          drawDenseTile(x, y, cw * 0.44, ch, palettes[4], 'h');
          drawDenseTile(x + cw * 0.44, y, cw * 0.56, ch, pal, reg.mode);
        } else {
          drawDenseTile(x, y, cw, ch, pal, reg.mode);
        }
      }
    }
  }

  // Gleaming silver-white power bus canyons between major regions
  ctx.fillStyle = 'rgba(225, 238, 255, 0.48)';
  bCtx.fillStyle = '#ffffff';
  const busLines: [number, number, number, number][] = [
    [956, margin, 14, 1872],
    [1158, margin, 14, 1872],
    [margin, 818, 860, 14],
    [margin, 1372, 860, 14],
    [1180, 1074, 780, 14],
    [1180, 1564, 780, 14],
  ];
  for (const [bx, by, bw, bh] of busLines) {
    ctx.fillRect(bx, by, bw, bh);
    bCtx.fillRect(bx, by, bw, bh);
  }

  // Perimeter Scribe-Line & Dual-Row Metallic Bond-Pad Ring (just like 0:05 of the video!)
  ctx.strokeStyle = 'rgba(235, 208, 136, 0.85)';
  ctx.lineWidth = 5;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  bCtx.strokeStyle = '#ffffff';
  bCtx.lineWidth = 6;
  bCtx.strokeRect(22, 22, W - 44, H - 44);

  const padColors = ['#f0d07a', '#78f0d4', '#86c8ff', '#dce6f5'];
  for (let i = 0; i < 82; i++) {
    const pos = 66 + (i / 81) * (W - 132);
    const col = padColors[i % padColors.length];
    ctx.fillStyle = col;
    bCtx.fillStyle = '#f0f0f0';
    // Top, Bottom, Left, Right micro-pads
    ctx.fillRect(pos - 6, 36, 12, 26);
    ctx.fillRect(pos - 6, H - 62, 12, 26);
    ctx.fillRect(36, pos - 6, 26, 12);
    ctx.fillRect(W - 62, pos - 6, 26, 12);
    bCtx.fillRect(pos - 6, 36, 12, 26);
    bCtx.fillRect(pos - 6, H - 62, 12, 26);
    bCtx.fillRect(36, pos - 6, 26, 12);
    bCtx.fillRect(W - 62, pos - 6, 26, 12);
  }

  const albedo = new THREE.CanvasTexture(colC);
  albedo.anisotropy = 16;
  albedo.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bumpC);
  bump.anisotropy = 8;
  const roughness = new THREE.CanvasTexture(roughC);
  roughness.anisotropy = 8;

  return { albedo, bump, roughness };
}

/**
 * Generates the granular, mottled silvery-grey crystalline/atomic SEM substrate
 * texture seen at peak 3nm–5nm magnification (`0:44–0:47` in the reference video!).
 */
export function createCrystallineSemTexture(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const b = document.createElement('canvas');
  b.width = S;
  b.height = S;
  const bCtx = b.getContext('2d')!;
  const bImg = bCtx.createImageData(S, S);

  let s = 918273;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  // Multi-octave cellular crystalline silicon grain (looks genuinely like an SEM micrograph!)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const idx = (y * S + x) * 4;
      const wave =
        Math.sin(x * 0.28 + Math.cos(y * 0.24) * 2.2) * 0.25 +
        Math.cos(y * 0.31 - Math.sin(x * 0.19) * 2.0) * 0.25;
      const grain = (rnd() - 0.5) * 0.55;
      const v = Math.max(0, Math.min(1, 0.34 + wave * 0.28 + grain * 0.36));

      // Cool SEM metallic silver-blue tint
      img.data[idx] = Math.round(v * 145);
      img.data[idx + 1] = Math.round(v * 158);
      img.data[idx + 2] = Math.round(v * 176);
      img.data[idx + 3] = 255;

      const bv = Math.round(v * 255);
      bImg.data[idx] = bv;
      bImg.data[idx + 1] = bv;
      bImg.data[idx + 2] = bv;
      bImg.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 6);
  map.colorSpace = THREE.SRGBColorSpace;

  const bump = new THREE.CanvasTexture(b);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(6, 6);

  return { map, bump };
}
