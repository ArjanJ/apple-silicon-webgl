/**
 * Pre-Built Instance Buffers for All 5 Apple Silicon Zoom Worlds.
 *
 * Each instance packs 12 floats (3 vec4 attributes = 48 bytes):
 *   aInstA = (cx, cy, cz, bevelRadius)
 *   aInstB = (hx, hy, hz, matId)
 *   aInstC = (channelType, channelParam, extraA, extraB)
 *
 * Material IDs (matching our photorealistic Apple Silicon PBR palette):
 *   0 = Dark fiberglass substrate / recessed canyon base
 *   1 = Iridescent thin-film SiO2 silicon wafer / die blocks
 *   2 = Brushed silver-titanium metal lines, rails, walls, fins
 *   3 = Brushed copper-gold interconnects, gate bridges, SMD terminals, vias
 *   4 = Dark gunmetal / tungsten deep layer / SRAM vaults / SMD ceramic body
 *   5 = Crystalline granular SEM silicon wafer substrate
 *   6 = Emissive cyan-white live signal / electron channel wave
 *   7 = Matte charcoal Unified Memory (LPDDR5) package
 *
 * Channel Types (evaluated 100% on GPU — zero CPU buffer updates per frame!):
 *   0  = Static energy = channelParam
 *   1  = Live P-Core [0..7] (channelParam = core index; also subtly elevates height)
 *   2  = Live E-Core avg
 *   3  = Live Network / I/O load
 *   4  = System-Level Cache load
 *   5  = GPU Array wave (uMacLoads.z * wave)
 *   6  = Neural Engine load
 *   7  = Display & Media Engine load
 *   8  = Unified RAM slab (edge bus glow proportional to uMacLoads.w)
 *   9  = Animated Signal Pulse (channelParam: 0=Die Z, 1=Die X, 2=World1 Z, 3=World2 X)
 *   10 = World 1 Live Tile (channelParam = tile hash, extraA = weight)
 *   11 = World 2 Center Via Pulse (flashes cyan when signal crosses center)
 *   12 = World 3 Live Nanometer Cell (extraA/extraB = cellId.xz, channelParam = baseMat)
 *   13 = World 4 Hero 3nm Center Fin Bank (channelParam = isHeroCenter 0/1)
 *   14 = World 4 Hero 3nm Nanosheet Electron Wave (channelParam = isHero, extraA = rowPhase)
 */

export interface WorldInstances {
  boxes: Float32Array;
  boxCount: number;
  cylinders: Float32Array;
  cylinderCount: number;
}

class InstanceBuilder {
  private boxData: number[] = [];
  private cylData: number[] = [];

  public addBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    bevel: number,
    matId: number,
    chType = 0,
    chParam = 0,
    extraA = 0,
    extraB = 0
  ): void {
    this.boxData.push(cx, cy, cz, bevel, hx, hy, hz, matId, chType, chParam, extraA, extraB);
  }

  public addCyl(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    hy: number,
    bevel: number,
    matId: number,
    chType = 0,
    chParam = 0,
    extraA = 0,
    extraB = 0
  ): void {
    this.cylData.push(cx, cy, cz, bevel, radius, hy, radius, matId, chType, chParam, extraA, extraB);
  }

  public finish(): WorldInstances {
    return {
      boxes: new Float32Array(this.boxData),
      boxCount: this.boxData.length / 12,
      cylinders: new Float32Array(this.cylData),
      cylinderCount: this.cylData.length / 12,
    };
  }
}

function hash12(x: number, y: number): number {
  let px = (x * 0.1031) % 1;
  let py = (y * 0.1031) % 1;
  let pz = (x * 0.1031) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  if (pz < 0) pz += 1;
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d;
  py += d;
  pz += d;
  const v = ((px + py) * pz) % 1;
  return v < 0 ? v + 1 : v;
}

/**
 * WORLD 0: Live Mac Asymmetric Silicon Die + Unified Memory + SMD Caps (10x · 12 mm)
 */
export function buildWorld0(): WorldInstances {
  const b = new InstanceBuilder();

  // Infinite dark studio ground plane beneath package
  b.addBox(0, -0.52, 0, 26.0, 0.15, 26.0, 0.005, 0);

  // Dark package substrate & stepped rim
  b.addBox(0, -0.21, 0, 5.42, 0.13, 3.38, 0.055, 0);
  b.addBox(0, -0.32, 0, 5.52, 0.04, 3.48, 0.02, 0);

  // Dual Unified Memory (LPDDR5) Slabs flanking the silicon die
  for (const side of [-1, 1]) {
    b.addBox(side * 4.22, 0.03, 0, 0.76, 0.165, 2.42, 0.045, 7, 8, 1.0);
  }

  // Dual-end SMD Ceramic + Gold Decoupling Capacitors (top/bottom & left/right)
  for (let i = -13; i <= 13; i++) {
    const x = i * 0.22;
    for (const side of [-1, 1]) {
      const z = side * 2.78;
      b.addBox(x, -0.015, z, 0.048, 0.044, 0.044, 0.008, 4);
      b.addBox(x - 0.046, -0.015, z, 0.024, 0.046, 0.046, 0.008, 3);
      b.addBox(x + 0.046, -0.015, z, 0.024, 0.046, 0.046, 0.008, 3);
    }
  }
  for (let i = -10; i <= 10; i++) {
    const z = i * 0.22;
    for (const side of [-1, 1]) {
      const x = side * 3.32;
      b.addBox(x, -0.015, z, 0.044, 0.044, 0.048, 0.008, 4);
      b.addBox(x, -0.015, z - 0.046, 0.046, 0.046, 0.024, 0.008, 3);
      b.addBox(x, -0.015, z + 0.046, 0.046, 0.046, 0.024, 0.008, 3);
    }
  }

  // Main Mirror-Finished Iridescent Silicon Die Slab
  b.addBox(0, 0.035, 0, 3.06, 0.135, 2.40, 0.026, 1);

  // 1) Top-Left: 8x Performance Core Cluster (4 cols x 2 rows) wired to P-Cores 0..7
  const pCols = [-0.96, -0.32, 0.32, 0.96];
  const pRows = [-0.43, 0.43];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const idx = r * 4 + c;
      b.addBox(-1.52 + pCols[c], 0.185, -1.04 + pRows[r], 0.285, 0.028, 0.385, 0.014, 1, 1, idx);
    }
  }

  // 2) Mid-Left: 4x Efficiency Core Cluster
  for (let c = 0; c < 4; c++) {
    b.addBox(-1.52 + pCols[c], 0.185, 0.52, 0.285, 0.026, 0.46, 0.014, 1, 2, 0);
  }

  // 3) Bottom-Left: 5x USB / Network / I/O PHY Strip
  for (let i = -2; i <= 2; i++) {
    b.addBox(-1.52 + i * 0.42, 0.182, 1.66, 0.18, 0.024, 0.38, 0.012, 3, 3, 0);
  }

  // 4) Center Spine: Segmented 24MB System-Level Cache (9 segments)
  for (let i = -4; i <= 4; i++) {
    b.addBox(0.06, 0.188, -0.10 + i * 0.46, 0.22, 0.028, 0.19, 0.012, 4, 4, 0);
  }

  // 5) Top-Right: 16-Core GPU Array (4x4)
  const gCols = [-0.84, -0.28, 0.28, 0.84];
  const gRows = [-0.81, -0.27, 0.27, 0.81];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      b.addBox(1.66 + gCols[c], 0.185, -0.78 + gRows[r], 0.245, 0.026, 0.235, 0.012, 1, 5, 0);
    }
  }

  // 6) Mid-Right: 16-Core Neural Engine (8x2)
  const nCols = [-0.98, -0.70, -0.42, -0.14, 0.14, 0.42, 0.70, 0.98];
  const nRows = [-0.24, 0.24];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 8; c++) {
      b.addBox(1.66 + nCols[c], 0.185, 0.92 + nRows[r], 0.115, 0.026, 0.20, 0.010, 4, 6, 0);
    }
  }

  // 7) Bottom-Right: Display & Media Engine (4 blocks)
  for (let c = 0; c < 4; c++) {
    b.addBox(1.66 + gCols[c], 0.182, 1.82, 0.245, 0.024, 0.24, 0.012, 1, 7, 0);
  }

  // Brushed Silver Power Distribution Rails
  b.addBox(-0.22, 0.205, -0.05, 0.022, 0.014, 2.22, 0.006, 2);
  b.addBox(0.34, 0.205, -0.05, 0.022, 0.014, 2.22, 0.006, 2);
  b.addBox(-1.52, 0.205, -0.04, 1.26, 0.014, 0.022, 0.006, 2);
  b.addBox(1.66, 0.205, 0.36, 1.22, 0.014, 0.022, 0.006, 2);

  // Live Animated Signal Pulses (animated in vertex shader via channelType 9)
  b.addBox(-0.22, 0.222, 0.0, 0.026, 0.014, 0.32, 0.008, 6, 9, 0); // Vertical die spine pulse
  b.addBox(0.0, 0.222, 0.36, 0.28, 0.014, 0.024, 0.008, 6, 9, 1);  // Horizontal RAM bus pulse

  return b.finish();
}

/**
 * WORLD 1: Frosted Micro-Striations & SRAM Cache Vaults (2.5K× · 60 µm)
 */
export function buildWorld1(): WorldInstances {
  const b = new InstanceBuilder();

  // Deep silicon base floor
  b.addBox(0, -0.37, 0, 28.0, 0.15, 28.0, 0.005, 0);

  const pitch = 2.25;
  const R = 5; // 11x11 tiles covering +/-12.4 units out into dark fog

  for (let tz = -R; tz <= R; tz++) {
    for (let tx = -R; tx <= R; tx++) {
      const cx = tx * pitch;
      const cz = tz * pitch;
      const h = hash12(tx + 19.3, tz + 19.3);
      const blockH = 0.10 + h * 0.055;

      // Base SRAM/logic block
      b.addBox(cx, blockH * 0.5, cz, 0.99, blockH * 0.5, 0.99, 0.022, h > 0.72 ? 4 : 1, 10, h, 1.0);

      // Parallel micro-striation ribs (17 ribs for central tiles, 9 for far periphery)
      const horiz = (h * 7.3) % 1 > 0.45;
      const mat = h > 0.68 ? 3 : h > 0.28 ? 2 : 1;
      const dist2 = tx * tx + tz * tz;
      const ribStep = dist2 <= 8 ? 1 : 2;

      for (let k = -8; k <= 8; k += ribStep) {
        const off = k * 0.098;
        if (horiz) {
          b.addBox(cx, blockH + 0.022, cz + off, 0.89, 0.024, 0.026 * (ribStep === 2 ? 1.5 : 1.0), 0.007, mat, 10, h, 0.5);
        } else {
          b.addBox(cx + off, blockH + 0.022, cz, 0.026 * (ribStep === 2 ? 1.5 : 1.0), 0.024, 0.89, 0.007, mat, 10, h, 0.5);
        }
      }
    }
  }

  // Long continuous framing bus rails (drawn as clean single beams instead of per-tile duplicates!)
  const span = (R + 0.5) * pitch;
  for (let i = -R; i <= R + 1; i++) {
    const pos = (i - 0.5) * pitch;
    b.addBox(0, 0.15, pos, span, 0.038, 0.028, 0.009, 2);
    b.addBox(pos, 0.15, 0, 0.028, 0.038, span, 0.009, 2);
  }

  // Live glowing signal wave sweeping down center spine
  b.addBox(0, 0.178, 0, 0.036, 0.034, 0.82, 0.012, 6, 9, 2);

  return b.finish();
}

/**
 * WORLD 2: 3D SEM Metal Canyons & Ringed Circular Vias (250K× · 800 nm)
 */
export function buildWorld2(): WorldInstances {
  const b = new InstanceBuilder();

  // Deep trench floor
  b.addBox(0, -0.69, 0, 26.0, 0.15, 26.0, 0.005, 0);

  // Layer 0 (Deep Tungsten Grid, y = -0.36, pitch = 0.60)
  const deepSpan = 12.6;
  for (let i = -20; i <= 20; i++) {
    const p = i * 0.60;
    b.addBox(p, -0.36, 0, 0.062, 0.044, deepSpan, 0.012, 4);
    b.addBox(0, -0.36, p, deepSpan, 0.044, 0.062, 0.012, 4);
  }

  // Layer 1 (Mid Copper/Gold Damascene Buses + Circular Junction Pads, y = -0.10)
  const midSpan = 12.6;
  for (let i = -8; i <= 8; i++) {
    const gz = i * 1.56;
    b.addBox(0, -0.10, gz - 0.14, midSpan, 0.062, 0.058, 0.018, 3);
    b.addBox(0, -0.10, gz + 0.14, midSpan, 0.062, 0.058, 0.018, 3);
  }
  for (let i = -11; i <= 11; i++) {
    const gx = i * 1.12;
    b.addBox(gx, -0.10, 0, 0.095, 0.062, midSpan, 0.020, 3);
  }
  for (let iz = -7; iz <= 7; iz++) {
    for (let ix = -9; ix <= 9; ix++) {
      b.addCyl(ix * 1.12, -0.10, iz * 1.56, 0.17, 0.068, 0.018, 3);
    }
  }

  // Layer 2 (Top Sculpted Brushed Silver-Titanium Canyons + Ringed Vias, y = +0.20, pitch = 1.68)
  const topSpan = 12.6;
  for (let i = -7; i <= 7; i++) {
    const pos = i * 1.68;
    // Main X rail + flanking twin side rails
    b.addBox(0, 0.20, pos, topSpan, 0.082, 0.13, 0.026, 2);
    b.addBox(0, 0.185, pos - 0.34, topSpan, 0.065, 0.052, 0.018, 2);
    b.addBox(0, 0.185, pos + 0.34, topSpan, 0.065, 0.052, 0.018, 2);
    // Main Z rail
    b.addBox(pos, 0.20, 0, 0.115, 0.082, topSpan, 0.024, 2);
  }

  // Ringed Circular Vias & Vertical Copper Pillars at every top-layer junction
  for (let iz = -6; iz <= 6; iz++) {
    for (let ix = -6; ix <= 6; ix++) {
      const cx = ix * 1.68;
      const cz = iz * 1.68;
      const isCenter = ix === 0 && iz === 0;
      // Outer silver pad ring
      b.addCyl(cx, 0.205, cz, 0.24, 0.088, 0.022, 2);
      // Dark recessed via bore cap on top
      b.addCyl(cx, 0.268, cz, 0.112, 0.032, 0.008, 0);
      // Vertical copper via pillar dropping down through the canyon
      b.addCyl(cx, -0.04, cz, isCenter ? 0.132 : 0.115, 0.27, 0.016, 3, isCenter ? 11 : 0, 0);
    }
  }

  // Live glowing cyan signal beam racing across the top canyon rail
  b.addBox(0, 0.23, 0, 0.68, 0.068, 0.142, 0.024, 6, 9, 3);

  return b.finish();
}

/**
 * WORLD 3: Repeating Nanometer Cell Fortresses (8M× · 25 nm)
 */
export function buildWorld3(): WorldInstances {
  const b = new InstanceBuilder();

  // Granular crystalline SEM silicon wafer floor
  b.addBox(0, -0.36, 0, 22.0, 0.15, 22.0, 0.005, 5);

  const pitch = 0.58;
  const R = 13; // 27x27 = 729 nanometer fortress cells covering +/-7.8 units

  for (let iz = -R; iz <= R; iz++) {
    for (let ix = -R; ix <= R; ix++) {
      const cx = ix * pitch;
      const cz = iz * pitch;
      const dist2 = ix * ix + iz * iz;

      // 4 beveled fortress walls enclosing hollow inner cell (exact match to outerBox - innerCut!)
      // Outer = 0.252, inner = 0.192 => wall thickness = 0.060 (half = 0.030), center offset = 0.222
      b.addBox(cx, 0.04, cz - 0.222, 0.252, 0.098, 0.030, 0.011, 2, 12, 2, ix, iz);
      b.addBox(cx, 0.04, cz + 0.222, 0.252, 0.098, 0.030, 0.011, 2, 12, 2, ix, iz);
      b.addBox(cx - 0.222, 0.04, cz, 0.030, 0.098, 0.194, 0.011, 2, 12, 2, ix, iz);
      b.addBox(cx + 0.222, 0.04, cz, 0.030, 0.098, 0.194, 0.011, 2, 12, 2, ix, iz);

      // Internal nanometer fins (5 fins for inner cells, 3 for outer edge)
      const finRange = dist2 <= 85 ? 2 : 1;
      for (let f = -finRange; f <= finRange; f++) {
        b.addBox(cx + f * 0.072, 0.012, cz, 0.016, 0.056, 0.16, 0.006, 3, 12, 3, ix, iz);
      }

      // Active glowing cell floor pad (only lights up when activeCell is true in shader!)
      b.addBox(cx, -0.04, cz, 0.18, 0.032, 0.18, 0.008, 0, 12, 0, ix, iz);

      // 4 corner vertical cylindrical micro-pins (for central/mid cells where visible)
      if (dist2 <= 100) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            b.addCyl(cx + sx * 0.236, 0.102, cz + sz * 0.236, 0.018, 0.042, 0.005, 2);
          }
        }
      }
    }
  }

  return b.finish();
}

/**
 * WORLD 4: Peak 3nm Stacked GAA Fin / Nanosheet Array (100M× · 3 nm)
 */
export function buildWorld4(): WorldInstances {
  const b = new InstanceBuilder();

  // Granular crystalline SEM silicon substrate
  b.addBox(0, -0.39, 0, 26.0, 0.15, 26.0, 0.005, 5);

  const pitch = 4.55;
  const R = 2; // 5x5 tiled 3nm macro modules covering +/-11.4 units

  for (let iz = -R; iz <= R; iz++) {
    for (let ix = -R; ix <= R; ix++) {
      const cx = ix * pitch;
      const cz = iz * pitch;
      const isHero = ix === 0 && iz === 0 ? 1 : 0;

      // 4 thick beveled titanium outer fortress walls (outer 1.86, inner 1.64 => wall half = 0.11, offset = 1.75)
      b.addBox(cx, 0.10, cz - 1.75, 1.86, 0.26, 0.11, 0.042, 2);
      b.addBox(cx, 0.10, cz + 1.75, 1.86, 0.26, 0.11, 0.042, 2);
      b.addBox(cx - 1.75, 0.10, cz, 0.11, 0.26, 1.65, 0.042, 2);
      b.addBox(cx + 1.75, 0.10, cz, 0.11, 0.26, 1.65, 0.042, 2);

      // Recessed dark silicon inner floor
      b.addBox(cx, -0.16, cz, 1.66, 0.06, 1.66, 0.01, 0);

      // Top Half (z = -0.82): 3 banks x 5 vertical 3nm fins + gold source/drain contact stubs
      for (let bank = -1; bank <= 1; bank++) {
        const bx = cx + bank * 1.06;
        const isHeroCenterBank = isHero === 1 && bank === 0 ? 1 : 0;
        for (let f = -2; f <= 2; f++) {
          const fx = bx + f * 0.19;
          b.addBox(fx, 0.06, cz - 0.82, 0.044, 0.18, 0.62, 0.015, 2, 13, isHeroCenterBank);
          b.addCyl(fx, 0.165, cz - 0.82 - 0.56, 0.036, 0.12, 0.010, 3);
          b.addCyl(fx, 0.165, cz - 0.82 + 0.56, 0.036, 0.12, 0.010, 3);
        }
      }

      // Spanning Gold Gate Bridge across all 3 fin banks
      b.addBox(cx, 0.18, cz - 0.82, 1.54, 0.072, 0.16, 0.022, 3, 13, isHero * 2);

      // Bottom Half (z = +0.82): 2 rows x 3 horizontal 3nm GAA stacked nanosheets (2 vertical sheet layers!)
      const rowOffsets = [-0.36, 0.36];
      const sheetYs = [0.055 - 0.068, 0.055 + 0.068];
      for (let ri = 0; ri < 2; ri++) {
        const rowBaseZ = cz + 0.82 + rowOffsets[ri];
        for (let k = -1; k <= 1; k++) {
          const fz = rowBaseZ + k * 0.19;
          // 2 vertically stacked horizontal 3nm nanosheets
          for (const sy of sheetYs) {
            b.addBox(cx, sy, fz, 1.48, 0.036, 0.044, 0.012, 2, 14, isHero, ri === 1 ? 0.38 : 0.0);
          }
          // 5 vertical gold GAA gate pillars wrapping each nanosheet channel
          for (let g = -2; g <= 2; g++) {
            b.addBox(cx + g * 0.52, 0.11, fz, 0.056, 0.17, 0.078, 0.016, 3, 13, isHero * 2);
          }
        }
      }
    }
  }

  return b.finish();
}
