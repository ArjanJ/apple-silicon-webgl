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
 *   2 = Brushed silver-titanium metal lines, rails, walls, fins, Si atoms
 *   3 = Brushed copper-gold interconnects, gate bridges, SMD terminals, HfO2 / dopants / neutrons
 *   4 = Dark gunmetal / tungsten deep layer / SRAM vaults / SMD ceramic body
 *   5 = Crystalline granular SEM silicon wafer substrate
 *   6 = Emissive cyan-white live signal / electron channel wave / conduction electrons
 *   7 = Matte charcoal Unified Memory (LPDDR5) package / Oxygen atoms
 *   8 = Luminous quantum sp3 electron orbital cloud (Fresnel probability shimmer)
 *   9 = Radiant sapphire-cyan Silicon-28 Proton with subtle quark-gluon iridescence
 *
 * Channel Types (evaluated 100% on GPU — zero CPU buffer updates per frame!):
 *   0..14 = Macro Die -> 3nm GAA worlds
 *   15 = Silicon Crystal Atom with REAL Thermal Phonon Vibration driven by live uSocTemp!
 *   16 = Arbitrary 3D Oriented Covalent Bond / Strong-Force Flux Tube (aInstB.xyz = half-vector, aInstA.w = radius)
 *   17 = 3D Oriented sp3 Quantum Hybridized Orbital Lobe (aInstB.xyz = lobe axis, aInstA.w = lobe radius)
 *   18 = Drifting Conduction Electron streaming through the 0.54nm Silicon Lattice (extraA = lane, extraB = phase)
 *   19 = Orbiting Quantum Probability Density Packet around 110pm Si atom (chParam = shellR, extraA/B = angles)
 *   20 = Quantum Tunneling Wave Ripple across the HfO2 gate dielectric
 *   21 = 28Si Nucleon (Proton/Neutron) with zero-point strong-force nuclear jitter
 */

export interface WorldInstances {
  boxes: Float32Array;
  boxCount: number;
  cylinders: Float32Array;
  cylinderCount: number;
  spheres: Float32Array;
  sphereCount: number;
  bonds: Float32Array;
  bondCount: number;
}

class InstanceBuilder {
  private boxData: number[] = [];
  private cylData: number[] = [];
  private sphereData: number[] = [];
  private bondData: number[] = [];

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

  public addSphere(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    paramR: number,
    matId: number,
    chType = 0,
    chParam = 0,
    extraA = 0,
    extraB = 0
  ): void {
    this.sphereData.push(cx, cy, cz, paramR, rx, ry, rz, matId, chType, chParam, extraA, extraB);
  }

  /** Arbitrary 3D bond between p1 and p2 (stores midpoint + half-vector in aInstB.xyz) */
  public addBond(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    radius: number,
    matId: number,
    chParam = 0
  ): void {
    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const mz = (z1 + z2) * 0.5;
    const dx = (x2 - x1) * 0.5;
    const dy = (y2 - y1) * 0.5;
    const dz = (z2 - z1) * 0.5;
    this.bondData.push(mx, my, mz, radius, dx, dy, dz, matId, 16, chParam, 0, 0);
  }

  public finish(): WorldInstances {
    return {
      boxes: new Float32Array(this.boxData),
      boxCount: this.boxData.length / 12,
      cylinders: new Float32Array(this.cylData),
      cylinderCount: this.cylData.length / 12,
      spheres: new Float32Array(this.sphereData),
      sphereCount: this.sphereData.length / 12,
      bonds: new Float32Array(this.bondData),
      bondCount: this.bondData.length / 12,
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

      // Bottom Half (z = +0.58): 2 rows x 3 horizontal 3nm GAA stacked nanosheets (2 vertical sheet layers!)
      // Centered close to origin so diving into World 5 (Single 3nm Gate) flows straight into the glowing nanosheet!
      const rowOffsets = [-0.36, 0.36];
      const sheetYs = [0.055 - 0.068, 0.055 + 0.068];
      for (let ri = 0; ri < 2; ri++) {
        const rowBaseZ = cz + 0.58 + rowOffsets[ri];
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

/**
 * WORLD 5 (NEW BRIDGE): Single 3.0 nm GAA Nanosheet Gate Cross-Section (40M×)
 *   - Physically bridges World 4 (24nm Transistor Cell) and World 6 (0.54nm Silicon Crystal Lattice)!
 *   - Shows ONE single 3 nm Silicon nanosheet ribbon running along X right through a cutaway
 *     Gold/Tungsten Gate-All-Around metal collar + razor-thin HfO2 high-k gate dielectric liner.
 *   - Inside the cutaway of the 3 nm ribbon, you can ALREADY see the ~11-atom-wide rows of
 *     Silicon atoms lined up in crystal order, with glowing cyan electrons tunneling under the gate!
 */
export function buildWorldGate3nm(): WorldInstances {
  const b = new InstanceBuilder();

  // Flanking stacked sibling nanosheets (faintly above & below in the GAA stack, establishing 3D context)
  for (const sibY of [-1.22, 1.22]) {
    b.addBox(0, sibY, 0, 5.2, 0.16, 0.38, 0.045, 2);
    // Thin HfO2 sleeve around sibling sheets
    b.addBox(0, sibY, 0, 0.92, 0.22, 0.44, 0.04, 4);
  }

  // Left & Right Silicon Source/Drain Epitaxial Pads feeding the central 3nm nanosheet ribbon
  b.addBox(-3.65, 0.0, 0.0, 1.65, 0.34, 0.62, 0.06, 2);
  b.addBox(3.65, 0.0, 0.0, 1.65, 0.34, 0.62, 0.06, 2);

  // Outer unbroken Silicon Nanosheet shoulders entering & leaving the gate (cut open in center [-1.85..+1.85] to reveal atoms!)
  b.addBox(-2.05, 0.0, 0.0, 0.38, 0.28, 0.52, 0.04, 2);
  b.addBox(2.05, 0.0, 0.0, 0.38, 0.28, 0.52, 0.04, 2);

  // Cutaway C-Shaped Gold/Tungsten Metal Gate-All-Around Sleeve wrapping top, bottom, and back of the 3nm ribbon
  // (Front face cut open so you peer straight into the HfO2 oxide + atomic Silicon channel!)
  b.addBox(0, 0.64, -0.06, 1.18, 0.15, 0.72, 0.042, 3, 13, 2);   // Top metal gate cap
  b.addBox(0, -0.64, -0.06, 1.18, 0.15, 0.72, 0.042, 3, 13, 2);  // Bottom metal gate wrap
  b.addBox(0, 0.0, -0.66, 1.18, 0.64, 0.14, 0.040, 3, 13, 2);    // Back gate bridge connecting top & bottom
  // Vertical gate sidewall risers connecting the sibling sheets in the GAA stack
  b.addBox(-1.12, 0.0, -0.58, 0.12, 1.42, 0.22, 0.032, 3, 13, 2);
  b.addBox(1.12, 0.0, -0.58, 0.12, 1.42, 0.22, 0.032, 3, 13, 2);

  // High-k HfO2 (Hafnium Dioxide) Gate Insulator Liner (~1.2 nm dielectric jacket between metal gate and Si channel)
  b.addBox(0, 0.44, -0.02, 1.12, 0.055, 0.58, 0.018, 9, 0, 0.35);  // Top HfO2 dielectric film
  b.addBox(0, -0.44, -0.02, 1.12, 0.055, 0.58, 0.018, 9, 0, 0.35); // Bottom HfO2 dielectric film
  b.addBox(0, 0.0, -0.50, 1.12, 0.44, 0.055, 0.018, 9, 0, 0.35);   // Back HfO2 dielectric film

  // Exposed Atomic Silicon Crystal Core inside the 3 nm nanosheet ribbon (11 atoms long x 3 layers tall x 4 rows deep!)
  // Directly previews World 6 (0.543 nm Silicon Crystal Lattice) right inside the glowing 3nm ribbon!
  const stepX = 0.33;
  const stepY = 0.22;
  const stepZ = 0.26;
  const ribbonAtoms: { x: number; y: number; z: number }[] = [];

  for (let ix = -5; ix <= 5; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      for (let iz = -1; iz <= 1; iz++) {
        // Stagger diamond-cubic sublattice rows so it already reads as crystalline silicon
        const staggerX = ((iy + iz) & 1) ? stepX * 0.28 : 0;
        const ax = ix * stepX + staggerX;
        const ay = iy * stepY;
        const az = iz * stepZ;
        const isDopant = ix === -3 && iy === 0 && iz === 1;
        b.addSphere(ax, ay, az, isDopant ? 0.092 : 0.074, isDopant ? 0.092 : 0.074, isDopant ? 0.092 : 0.074, 0, isDopant ? 3 : 2, 15, isDopant ? 0.6 : 0.1, ix * 1.3 + iy * 2.7 + iz, 0);
        ribbonAtoms.push({ x: ax, y: ay, z: az });
      }
    }
  }

  // Crystalline covalent lattice bonds linking nearest silicon atoms inside the cutaway ribbon
  for (let i = 0; i < ribbonAtoms.length; i++) {
    const p1 = ribbonAtoms[i];
    for (let j = i + 1; j < ribbonAtoms.length; j++) {
      const p2 = ribbonAtoms[j];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
      if (d > 0.10 && d < 0.37) {
        b.addBond(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, 0.016, 4, 0);
      }
    }
  }

  // Translucent cyan quantum inversion channel glow + 18 streaming electrons racing through the 3nm gate under voltage!
  for (let e = 0; e < 18; e++) {
    const ly = -0.20 + (e % 3) * 0.20;
    const lz = -0.24 + (Math.floor(e / 3) % 3) * 0.24;
    const ph = (e * 0.193) % 1.0;
    b.addSphere(0, ly, lz, 0.048, 0.048, 0.048, 0, 6, 18, 0.95, ph, (e % 3) * 0.3);
  }

  return b.finish();
}

/**
 * WORLD 6: 0.543 nm Silicon Diamond-Cubic Crystal Lattice + HfO2 High-K Gate Oxide (250M×)
 *   - Authentic 8-atom diamond-cubic unit cell (a = 0.543 nm, Si-Si bond = 0.235 nm, 109.5 deg tetrahedral)
 *   - Spatially aligned with World 5's 3nm Gate cutaway: Silicon crystal along X, HfO2 dielectric directly overhead!
 *   - Every Si atom vibrates in 3D with real thermal phonon amplitude driven by live Mac die temp (uSocTemp)!
 */
export function buildWorldLattice(): WorldInstances {
  const b = new InstanceBuilder();

  const a = 1.24; // Rescaled cleanly for steady camera dist = 5.4 (zero camera pullback!)
  const basis: [number, number, number][] = [
    [0, 0, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 0],
    [0.25, 0.25, 0.25],
    [0.25, 0.75, 0.75],
    [0.75, 0.25, 0.75],
    [0.75, 0.75, 0.25],
  ];

  const atoms: { x: number; y: number; z: number; dopant: boolean }[] = [];
  const nx = 3, ny = 2, nz = 3;

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        for (let bi = 0; bi < basis.length; bi++) {
          const [bx, by, bz] = basis[bi];
          const wx = (ix + bx - nx * 0.5) * a;
          const wy = (iy + by - ny * 0.5) * a - 0.28;
          const wz = (iz + bz - nz * 0.5) * a;
          if (wx * wx + wz * wz > 4.6) continue;
          const isDopant = hash12(wx * 3.1 + 7.2, wz * 4.7 + wy * 2.1) > 0.93 && Math.abs(wx) < 1.35 && Math.abs(wz) < 1.35;
          atoms.push({ x: wx, y: wy, z: wz, dopant: isDopant });
        }
      }
    }
  }

  for (let i = 0; i < atoms.length; i++) {
    const at = atoms[i];
    const r = at.dopant ? 0.19 : 0.16;
    const mat = at.dopant ? 3 : 2;
    const energy = at.dopant ? 0.65 : 0.0;
    b.addSphere(at.x, at.y, at.z, r, r, r, 0, mat, 15, energy, i * 0.73, at.dopant ? 1 : 0);
  }

  const bondMax = a * 0.433 * 1.12;
  const bondMax2 = bondMax * bondMax;
  for (let i = 0; i < atoms.length; i++) {
    const p1 = atoms[i];
    for (let j = i + 1; j < atoms.length; j++) {
      const p2 = atoms[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.04 && d2 <= bondMax2) {
        const nearDopant = p1.dopant || p2.dopant;
        b.addBond(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, 0.034, nearDopant ? 6 : 4, nearDopant ? 0.45 : 0.0);
      }
    }
  }

  // High-k HfO2 (Hafnium Dioxide) Gate Oxide atomic canopy hovering cleanly above the silicon channel
  const oxideY = 1.24;
  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = -3; gz <= 3; gz++) {
      const ox = gx * 0.66;
      const oz = gz * 0.66;
      if (ox * ox + oz * oz > 4.4) continue;
      b.addSphere(ox, oxideY, oz, 0.112, 0.112, 0.112, 0, 3, 15, 0.15, gx * 1.9 + gz * 3.1, 0);
      if (gx < 3) {
        b.addSphere(ox + 0.33, oxideY - 0.12, oz, 0.068, 0.068, 0.068, 0, 9, 15, 0.22, gx * 2.7 - gz, 0);
        b.addBond(ox, oxideY, oz, ox + 0.33, oxideY - 0.12, oz, 0.017, 4, 0);
      }
      if (gz < 3) {
        b.addSphere(ox, oxideY + 0.12, oz + 0.33, 0.068, 0.068, 0.068, 0, 9, 15, 0.22, gz * 3.3 + gx, 0);
        b.addBond(ox, oxideY, oz, ox, oxideY + 0.12, oz + 0.33, 0.017, 4, 0);
      }
    }
  }

  // 24 Live Conduction Electrons streaming through the crystal channels
  for (let e = 0; e < 24; e++) {
    const laneY = -0.68 + (e % 4) * 0.40;
    const laneZ = -1.25 + (Math.floor(e / 4) - 2.5) * 0.48;
    const phase = (e * 0.173) % 1.0;
    b.addSphere(0, laneY, laneZ, 0.064, 0.064, 0.064, 0, 6, 18, 0.95, phase, (e % 3) * 0.35);
  }

  return b.finish();
}

/**
 * WORLD 7: 111 pm Single Silicon-28 Atom & Quantum sp3 Hybridized Orbitals (1.2B×)
 *   - Sized cleanly for steady camera dist = 5.4 so all 4 outer neighbor Si atoms frame inside the viewport!
 */
export function buildWorldAtom(): WorldInstances {
  const b = new InstanceBuilder();

  // Central blazing 28Si nucleus core pinpoint
  b.addSphere(0, 0, 0, 0.085, 0.085, 0.085, 0, 6, 21, 1.35, 0, 0);
  // Inner 1s2 core electron cloud halo
  b.addSphere(0, 0, 0, 0.24, 0.24, 0.24, 0, 8, 15, 0.65, 1.1, 0);

  const invSqrt3 = 1 / Math.sqrt(3);
  const tetDirs: [number, number, number][] = [
    [ invSqrt3,  invSqrt3,  invSqrt3],
    [ invSqrt3, -invSqrt3, -invSqrt3],
    [-invSqrt3,  invSqrt3, -invSqrt3],
    [-invSqrt3, -invSqrt3,  invSqrt3],
  ];

  for (let i = 0; i < 4; i++) {
    const [dx, dy, dz] = tetDirs[i];
    // Primary glowing sp3 orbital lobe
    b.addSphere(0, 0, 0, dx * 1.42, dy * 1.42, dz * 1.42, 0.44, 8, 17, 0.85, i * 0.25, 0);
    // Subtle opposite anti-bonding back-lobe
    b.addSphere(0, 0, 0, -dx * 0.48, -dy * 0.48, -dz * 0.48, 0.17, 8, 17, 0.38, i * 0.25 + 0.5, 0);

    // Neighboring Silicon atom at tetrahedral bond distance (fits cleanly at dist = 5.4!)
    const nx = dx * 2.28;
    const ny = dy * 2.28;
    const nz = dz * 2.28;
    b.addSphere(nx, ny, nz, 0.22, 0.22, 0.22, 0, 2, 15, 0.15, i * 2.1, 0);
    b.addBond(dx * 0.16, dy * 0.16, dz * 0.16, nx * 0.90, ny * 0.90, nz * 0.90, 0.019, 6, 0.5);
  }

  // 220 Orbiting Quantum Probability Density Packets (1s, 2p, 3sp3 valence shells)
  for (let i = 0; i < 220; i++) {
    const shell = i < 36 ? 0 : i < 110 ? 1 : 2;
    const shellR = shell === 0 ? 0.52 : shell === 1 ? 0.98 : 1.58;
    const jitter = (hash12(i * 1.37, shell * 7.13) - 0.5) * (shell === 2 ? 0.36 : 0.18);
    const radius = shellR + jitter;
    const theta = hash12(i * 2.91, 13.7) * Math.PI * 2;
    const inc = (hash12(i * 5.13, 3.1) - 0.5) * Math.PI;
    const size = shell === 0 ? 0.032 : shell === 1 ? 0.028 : 0.024;
    const mat = shell === 2 && i % 5 === 0 ? 3 : 6;
    const speed = shell === 0 ? 1.85 : shell === 1 ? 1.15 : 0.68;
    b.addSphere(radius, inc, theta, size, size, size, 0, mat, 19, speed, i * 0.31, shell);
  }

  return b.finish();
}

/**
 * WORLD 8: 3.1 fm Silicon-28 Atomic Nucleus (40T×)
 *   - 28 densely packed nucleons (14 Protons + 14 Neutrons), cleanly framed at steady camera dist = 5.4!
 */
export function buildWorldNucleus(): WorldInstances {
  const b = new InstanceBuilder();

  const nucleons: { x: number; y: number; z: number; isProton: boolean }[] = [];

  const coreR = 0.34;
  const s = coreR / Math.sqrt(3);
  const coreCoords: [number, number, number][] = [
    [ s,  s,  s],
    [ s, -s, -s],
    [-s,  s, -s],
    [-s, -s,  s],
  ];
  for (let i = 0; i < 4; i++) {
    nucleons.push({ x: coreCoords[i][0], y: coreCoords[i][1], z: coreCoords[i][2], isProton: i % 2 === 0 });
  }

  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 10; i++) {
    const y = 1 - (i / 9) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const R = 0.72;
    nucleons.push({ x: Math.cos(th) * rad * R, y: y * R, z: Math.sin(th) * rad * R, isProton: i % 2 === 0 });
  }

  for (let i = 0; i < 14; i++) {
    const y = 1 - (i / 13) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * (i + 17.5);
    const R = 1.10;
    nucleons.push({ x: Math.cos(th) * rad * R, y: y * R, z: Math.sin(th) * rad * R, isProton: i % 2 === 1 });
  }

  for (let i = 0; i < nucleons.length; i++) {
    const n = nucleons[i];
    const r = 0.335;
    b.addSphere(n.x, n.y, n.z, r, r, r, 0, n.isProton ? 9 : 3, 21, n.isProton ? 0.95 : 0.35, i * 1.17, n.isProton ? 1 : 0);
  }

  for (let i = 0; i < nucleons.length; i++) {
    const a1 = nucleons[i];
    for (let j = i + 1; j < nucleons.length; j++) {
      const a2 = nucleons[j];
      const d = Math.hypot(a2.x - a1.x, a2.y - a1.y, a2.z - a1.z);
      if (d < 0.90) {
        b.addBond(a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, 0.038, 6, 0.72);
      }
    }
  }

  for (let k = 0; k < 48; k++) {
    const rad = 1.44 + (hash12(k * 3.1, 9.7) - 0.5) * 0.42;
    const theta = hash12(k * 7.3, 2.1) * Math.PI * 2;
    const inc = (hash12(k * 4.9, 5.5) - 0.5) * Math.PI;
    b.addSphere(rad, inc, theta, 0.028, 0.028, 0.028, 0, k % 3 === 0 ? 3 : 6, 19, 1.65, k * 0.42, 0);
  }

  return b.finish();
}
