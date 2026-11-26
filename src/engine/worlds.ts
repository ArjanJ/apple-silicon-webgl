/**
 * Physically & Scientifically Accurate Instance Buffers for All 10 Nested Worlds:
 *   0: Die (10x · 21 mm)          -- Live telemetry-accurate Apple Silicon floorplan + 1:1 US Quarter
 *   1: Power Grid (1K× · 120 µm)  -- Top BEOL Global Metal M12–M16 VDD/VSS Power & Clock Mesh
 *   2: Routing (100K× · 1.2 µm)   -- Intermediate BEOL Copper Damascene M4–M9 + Dual-Damascene Vias
 *   3: Rows (1M× · 120 nm)        -- FEOL Standard-Cell Rows (VDD/VSS rails, PMOS/NMOS, STI, local M0/M1)
 *   4: GAA Cell (5M× · 24 nm)     -- Pure Uniform GAA Nanosheet CMOS Standard Cell (TiN/W, SiN spacers, SiGe/Si:P)
 *   5: Gate (25M× · 12 nm)        -- Single 12 nm GAA Gate Stack (5 nm flat Si ribbon, SiO2/HfO2, TiN/W, SiN spacers)
 *   6: Lattice (250M× · 0.543 nm) -- Undoped (100) Silicon Diamond-Cubic Crystal + Amorphous SiO2/HfO2 + Bloch waves
 *   7: Atom (1.2B× · 111 pm)      -- Pure Quantum 1s2 + 2s2/2p6 + 3sp3 Wavefunctions + Stochastic |ψ|² Mist
 *   8: Nucleus (40T× · 3.1 fm)    -- Oblate-Deformed 28Si Nucleus (14P + 14N + Pion Exchange Field) -- 1800x void plunge!
 *   9: Quarks (150T× · 0.84 fm)   -- Single Proton (uud RGB Color-Charge Valence Quarks + Y-Shaped Gluon Flux Tubes)
 *
 * Material IDs:
 *   0  = Dark organic package substrate / recessed STI / SiN trench floor
 *   1  = Iridescent thin-film SiO2 silicon wafer / die blocks
 *   2  = Brushed Titanium / Silicon crystal / Tungsten-silver metal
 *   3  = Copper Damascene (BEOL) / Bronze-Slate TiN work-function metal / 28Si Neutrons
 *   4  = Dark gunmetal Tungsten (W) fill / covalent crystal bonds / SMD ceramic
 *   5  = Crystalline granular SEM silicon wafer substrate
 *   6  = Emissive electric-cyan live signal / active inversion wave / gluon energy
 *   7  = Matte charcoal Unified Memory (LPDDR5) package / SiN Dielectric Spacer
 *   8  = Luminous Translucent Quantum Cloud (1s2 / 2sp / 3sp3 orbitals, pion halo, QCD bag)
 *   9  = Sapphire-Blue High-k HfO2 / 28Si Protons / Oxygen atoms
 *   10 = Photorealistic 1:1 US Quarter Dollar (cupronickel + 119 milled reeds + copper core)
 *   11 = QCD Red Up Quark (u)
 *   12 = QCD Green Up Quark (u)
 *   13 = QCD Blue Down Quark (d)
 *   14 = Translucent Interfacial SiO2 / Silicon Nitride (SiN) Dielectric Spacer
 */

export const STAGE_RATIOS = [16.0, 9.0, 9.0, 8.0, 8.0, 6.0, 5.0, 1800.0, 10.0] as const;

export interface DieFloorplanSpec {
  pCores: number;
  eCores: number;
  gpuCores: number;
}

export const DEFAULT_DIE_SPEC: DieFloorplanSpec = {
  pCores: 8,
  eCores: 2,
  gpuCores: 24,
};

export interface LatticeAtomSite {
  x: number;
  y: number;
  z: number;
  parity: 1 | -1;
}

export interface WorldInstances {
  boxes: Float32Array;
  boxCount: number;
  cylinders: Float32Array;
  cylinderCount: number;
  spheres: Float32Array;
  sphereCount: number;
  translucentSpheres: Float32Array;
  translucentSphereCount: number;
  bonds: Float32Array;
  bondCount: number;
  atomSites?: LatticeAtomSite[];
}

class InstanceBuilder {
  private boxData: number[] = [];
  private cylData: number[] = [];
  private sphereData: number[] = [];
  private transSphereData: number[] = [];
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

  public addTranslucentSphere(
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
    this.transSphereData.push(cx, cy, cz, paramR, rx, ry, rz, matId, chType, chParam, extraA, extraB);
  }

  public addBond(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    radius: number,
    matId: number,
    chParam = 0,
    chType = 16
  ): void {
    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const mz = (z1 + z2) * 0.5;
    const dx = (x2 - x1) * 0.5;
    const dy = (y2 - y1) * 0.5;
    const dz = (z2 - z1) * 0.5;
    this.bondData.push(mx, my, mz, radius, dx, dy, dz, matId, chType, chParam, 0, 0);
  }

  public finish(atomSites?: LatticeAtomSite[]): WorldInstances {
    return {
      boxes: new Float32Array(this.boxData),
      boxCount: this.boxData.length / 12,
      cylinders: new Float32Array(this.cylData),
      cylinderCount: this.cylData.length / 12,
      spheres: new Float32Array(this.sphereData),
      sphereCount: this.sphereData.length / 12,
      translucentSpheres: new Float32Array(this.transSphereData),
      translucentSphereCount: this.transSphereData.length / 12,
      bonds: new Float32Array(this.bondData),
      bondCount: this.bondData.length / 12,
      atomSites,
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
 * Physical 1:1 scale reference: US Quarter Dollar (24.26 mm diameter x 1.75 mm thick)
 * at World 0 scale (1 unit = 3.5 mm; Apple Silicon Max die ~21.4 mm, package ~38 mm).
 */
export const QUARTER_X = 11.15;
export const QUARTER_Z = 0.05;
export const QUARTER_RADIUS = 3.465;
export const QUARTER_HY = 0.25;
export const QUARTER_CENTER_Y = -0.348; // Flush on World 0 ground plane (-0.598 + 0.25)

/** Exact nesting aperture half-sizes & snap pitches used by SiliconEngine */
export const WORLD0_DIE_CLAMP_X = 2.66;
export const WORLD0_DIE_CLAMP_Z = 2.04;
export const WORLD1_PITCH = 1.52;
export const WORLD1_HOLE_HALF = 0.64;
export const WORLD2_PITCH = 1.84;
export const WORLD2_HOLE_HALF = 0.64;
export const WORLD3_PITCH_X = 0.64;
export const WORLD3_PITCH_Z = 0.64;
export const WORLD3_HOLE_HALF = 0.96; // 3x3 standard cells = 1.5 * 0.64 = 0.96 => x8 = 7.68!
export const WORLD4_CELL_PITCH = 5.12; // 0.64 * 8.0 = 5.12 exact match!
export const WORLD4_GATE_XS = [-1.04, 0.0, 1.04] as const;
export const WORLD4_GATE_Z = 0.72; // NMOS hero nanosheet row (unobstructed +Z toward VSS rail!)
export const WORLD4_HOLE_HX = 0.48;
export const WORLD4_HOLE_HZ = 0.24;
export const WORLD6_LATTICE_A = 1.12;
export const WORLD5_LATTICE_A = WORLD6_LATTICE_A / STAGE_RATIOS[5]; // 0.186667

/**
 * WORLD 0: Telemetry-Accurate Apple Silicon Package + Die + 4x LPDDR5 + 1:1 US Quarter (10× · 21 mm)
 *   - Dynamically reflects live Mac P-Core, E-Core, and GPU core counts!
 *   - 4 flanking LPDDR5 Unified Memory packages (2 per side on Max/Pro-class packages)
 *   - 100% solid and unbroken (top blocks <= -0.003 so World 1's BEOL mesh extrudes cleanly above!)
 */
export function buildWorld0(spec: DieFloorplanSpec = DEFAULT_DIE_SPEC): WorldInstances {
  const b = new InstanceBuilder();
  const yOff = -0.228;

  // Infinite dark studio ground plane centered beneath package & US Quarter (top at y = -0.598)
  b.addBox(0, -0.52 + yOff, 0, 180.0, 0.15, 180.0, 0.005, 0);

  // 1:1 Physical Scale Reference: US Quarter Dollar (24.26 mm dia x 1.75 mm thick)
  b.addCyl(QUARTER_X, QUARTER_CENTER_Y, QUARTER_Z, QUARTER_RADIUS, QUARTER_HY, 0.020, 10);

  // Dark organic interposer substrate & stepped rim
  b.addBox(0, -0.21 + yOff, 0, 5.42, 0.13, 3.44, 0.055, 0);
  b.addBox(0, -0.32 + yOff, 0, 5.52, 0.04, 3.54, 0.02, 0);

  // 4x Unified Memory (LPDDR5) Packages flanking the silicon die (2 stacked per side, authentic M-Max layout!)
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      b.addBox(side * 4.22, 0.03 + yOff, row * 1.28, 0.76, 0.165, 1.14, 0.045, 7, 8, 1.0);
    }
  }

  // Dual-end SMD Ceramic + Copper/Gold Decoupling Capacitors around die perimeter
  for (let i = -13; i <= 13; i++) {
    const x = i * 0.22;
    for (const side of [-1, 1]) {
      const z = side * 2.86;
      b.addBox(x, -0.015 + yOff, z, 0.048, 0.044, 0.044, 0.008, 4);
      b.addBox(x - 0.046, -0.015 + yOff, z, 0.024, 0.046, 0.046, 0.008, 3);
      b.addBox(x + 0.046, -0.015 + yOff, z, 0.024, 0.046, 0.046, 0.008, 3);
    }
  }
  for (let i = -11; i <= 11; i++) {
    const z = i * 0.22;
    for (const side of [-1, 1]) {
      const x = side * 3.32;
      b.addBox(x, -0.015 + yOff, z, 0.044, 0.044, 0.048, 0.008, 4);
      b.addBox(x, -0.015 + yOff, z - 0.046, 0.046, 0.046, 0.024, 0.008, 3);
      b.addBox(x, -0.015 + yOff, z + 0.046, 0.046, 0.046, 0.024, 0.008, 3);
    }
  }

  // Main Mirror-Finished Iridescent Silicon Die Slab (~21.4 x 17.6 mm, 100% solid & unbroken)
  b.addBox(0, 0.035 + yOff, 0, 3.06, 0.135, 2.48, 0.024, 1);

  // 1) Top-Left: Performance Core Cluster (dynamically adapts to 4..12 P-Cores; M1 Max = 8P in 4x2!)
  const pCount = Math.max(2, Math.min(12, spec.pCores || 8));
  const pRowsN = pCount <= 4 ? 1 : 2;
  const pColsN = Math.ceil(pCount / pRowsN);
  const pSpanX = 2.48;
  const pSpanZ = 1.68;
  const pStepX = pSpanX / pColsN;
  const pStepZ = pSpanZ / pRowsN;
  let pIdx = 0;
  for (let r = 0; r < pRowsN; r++) {
    for (let c = 0; c < pColsN && pIdx < pCount; c++) {
      const cx = -1.68 + (c - (pColsN - 1) * 0.5) * pStepX;
      const cz = -1.04 + (r - (pRowsN - 1) * 0.5) * pStepZ;
      b.addBox(cx, 0.185 + yOff, cz, pStepX * 0.44, 0.028, pStepZ * 0.45, 0.014, 1, 1, pIdx % 8);
      pIdx++;
    }
  }

  // 2) Mid-Left: Efficiency Core Cluster (dynamically adapts to 2..6 E-Cores; M1 Max = 2E!)
  const eCount = Math.max(2, Math.min(6, spec.eCores || 2));
  const eStepX = 2.48 / eCount;
  for (let c = 0; c < eCount; c++) {
    const cx = -1.68 + (c - (eCount - 1) * 0.5) * eStepX;
    b.addBox(cx, 0.185 + yOff, 0.52, eStepX * 0.45, 0.026, 0.46, 0.014, 1, 2, 0);
  }

  // 3) Bottom-Left: 5x Thunderbolt / USB4 / I/O PHY Strip
  for (let i = -2; i <= 2; i++) {
    b.addBox(-1.68 + i * 0.44, 0.182 + yOff, 1.70, 0.185, 0.024, 0.40, 0.012, 3, 3, 0);
  }

  // 4) Center Spine: Segmented 48 MB System-Level Cache (SLC — 9 SRAM banks)
  for (let i = -4; i <= 4; i++) {
    b.addBox(0.0, 0.188 + yOff, i * 0.47, 0.30, 0.028, 0.195, 0.012, 4, 4, 0);
  }

  // 5) Top-Right: GPU Core Array (dynamically adapts to 8..40 GPU cores; M1 Max = 24C in 6x4 or 32C in 8x4!)
  const gpuCount = Math.max(8, Math.min(40, spec.gpuCores || 24));
  const gRowsN = gpuCount <= 12 ? 2 : 4;
  const gColsN = Math.ceil(gpuCount / gRowsN);
  const gSpanX = 2.34;
  const gSpanZ = 2.16;
  const gStepX = gSpanX / gColsN;
  const gStepZ = gSpanZ / gRowsN;
  let gIdx = 0;
  for (let r = 0; r < gRowsN; r++) {
    for (let c = 0; c < gColsN && gIdx < gpuCount; c++) {
      const cx = 1.68 + (c - (gColsN - 1) * 0.5) * gStepX;
      const cz = -0.78 + (r - (gRowsN - 1) * 0.5) * gStepZ;
      b.addBox(cx, 0.185 + yOff, cz, gStepX * 0.43, 0.026, gStepZ * 0.43, 0.010, 1, 5, 0);
      gIdx++;
    }
  }

  // 6) Mid-Right: 16-Core Neural Engine (8x2)
  const nCols = [-0.98, -0.70, -0.42, -0.14, 0.14, 0.42, 0.70, 0.98];
  const nRows = [-0.24, 0.24];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 8; c++) {
      b.addBox(1.68 + nCols[c], 0.185 + yOff, 0.94 + nRows[r], 0.115, 0.026, 0.20, 0.010, 4, 6, 0);
    }
  }

  // 7) Bottom-Right: Display & ProRes Media Engine (4 blocks)
  for (let c = 0; c < 4; c++) {
    const cx = 1.68 + (c - 1.5) * 0.58;
    b.addBox(cx, 0.182 + yOff, 1.86, 0.245, 0.024, 0.24, 0.012, 1, 7, 0);
  }

  // Brushed Silver Global Power Distribution Spine Rails
  b.addBox(-0.40, 0.205 + yOff, 0.0, 0.022, 0.014, 2.28, 0.006, 2);
  b.addBox( 0.40, 0.205 + yOff, 0.0, 0.022, 0.014, 2.28, 0.006, 2);
  b.addBox(-1.68, 0.205 + yOff, -0.04, 1.24, 0.014, 0.022, 0.006, 2);
  b.addBox( 1.68, 0.205 + yOff,  0.38, 1.22, 0.014, 0.022, 0.006, 2);

  // Live Animated Coherent Fabric Pulses
  b.addBox(-0.40, 0.222 + yOff, 0.0, 0.026, 0.014, 0.32, 0.008, 6, 9, 0);
  b.addBox(0.0,   0.222 + yOff, 0.42, 0.28, 0.014, 0.024, 0.008, 6, 9, 1);

  return b.finish();
}

/**
 * WORLD 1 (FIXED BEOL TOP!): Global BEOL Power & Clock Distribution Mesh (M12–M16 · 1K× · 120 µm)
 *   - Physically ACCURATE stack order: heavy top-level aluminum/copper VDD & VSS power grids
 *     sit ON TOP of the intermediate routing canyons (World 2) and transistors (World 3/4)!
 *   - 13x13 grid cells (pitch = 1.52, span ±9.88) so it fills 100% of the viewport edge-to-edge
 *     when extruding out of whichever core/GPU/SLC block you zoom into!
 */
export function buildWorld1(): WorldInstances {
  const b = new InstanceBuilder();

  const pitch = WORLD1_PITCH; // 1.52
  const R = 6; // 13x13 global power grid cells => ±9.88
  const span = 9.88;

  // Deep ILD oxide base well (stays intact underneath whichever cell opens into World 2)
  b.addBox(0, -0.22, 0, span, 0.04, span, 0.004, 0);
  // Lower inter-layer dielectric floor (top at y = -0.02)
  b.addBox(0, -0.11, 0, span, 0.09, span, 0.005, 0);

  // M12–M13 Sub-Global Copper Distribution Stripes inside each grid bay (y = +0.04..+0.09)
  for (let tz = -R; tz <= R; tz++) {
    for (let tx = -R; tx <= R; tx++) {
      const cx = tx * pitch;
      const cz = tz * pitch;
      const h = hash12(tx + 19.3, tz + 19.3);
      const dist2 = tx * tx + tz * tz;

      // Translucent-dark low-k SiCOH dielectric sub-tile
      b.addBox(cx, 0.015, cz, 0.63, 0.032, 0.63, 0.010, 4, 10, h, 0.65);

      // Alternating orthogonal M12/M13 copper & tungsten clock/power trunks
      const horiz = (h * 7.3) % 1 > 0.45;
      const step = dist2 <= 9 ? 1 : dist2 <= 25 ? 2 : 3;
      for (let k = -5; k <= 5; k += step) {
        const off = k * 0.105;
        const isVdd = (k & 1) === 0;
        const mat = isVdd ? 3 : 2; // Alternating Copper VDD & Titanium-Silver VSS power stripes!
        const thick = 0.026 * (step === 1 ? 1.0 : step === 2 ? 1.45 : 2.0);
        if (horiz) {
          b.addBox(cx, 0.072, cz + off, 0.59, 0.024, thick, 0.007, mat, 10, h, 0.55);
        } else {
          b.addBox(cx + off, 0.072, cz, thick, 0.024, 0.59, 0.007, mat, 10, h, 0.55);
        }
      }

      // Corner stacked via clusters connecting M15/M16 global rails down to M12/M13
      if (dist2 <= 16) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            b.addCyl(cx + sx * 0.56, 0.095, cz + sz * 0.56, 0.034, 0.055, 0.008, 3);
          }
        }
      }
    }
  }

  // Top-level M15/M16 Heavy Global Power Delivery Rails along EVERY cell border (±0.76 around every cell!)
  for (let i = -R; i <= R + 1; i++) {
    const pos = (i - 0.5) * pitch;
    const isVddRail = (i & 1) === 0;
    // M16 Wide Top Power Rail (X) + M15 Orthogonal Global Trunk (Z)
    b.addBox(0, 0.145, pos, span - 0.04, 0.040, 0.058, 0.012, isVddRail ? 2 : 3);
    b.addBox(pos, 0.132, 0, 0.052, 0.034, span - 0.04, 0.010, isVddRail ? 3 : 2);
  }

  // Heavy circular power-delivery via arrays at M15/M16 rail intersections
  for (let iz = -4; iz <= 5; iz++) {
    for (let ix = -4; ix <= 5; ix++) {
      const vx = (ix - 0.5) * pitch;
      const vz = (iz - 0.5) * pitch;
      b.addCyl(vx, 0.155, vz, 0.088, 0.048, 0.012, 2);
      b.addCyl(vx, 0.188, vz, 0.042, 0.020, 0.006, 3);
    }
  }

  // Live glowing clock/power surge sweeping along the global trunk x = -0.76
  b.addBox(-0.76, 0.185, 0, 0.044, 0.026, 0.72, 0.010, 6, 9, 2);

  return b.finish();
}

/**
 * WORLD 2 (BEOL MID!): Intermediate Copper Damascene Routing (M4–M9) & Dual-Damascene Vias (100K× · 1.2 µm)
 *   - Fits 1:9 inside ANY bay of World 1's global power grid!
 *   - Authentic orthogonal Manhattan metal layers (alternating X and Z per layer, Cu damascene + Co/W lower M2/M3)
 *     framing 25 clean courtyards looking straight down toward the FEOL Standard-Cell Rows (World 3)!
 */
export function buildWorld2(): WorldInstances {
  const b = new InstanceBuilder();

  const span = 5.76;

  // Sub-floor well below World 3's silicon wafer
  b.addBox(0, -0.13, 0, span, 0.03, span, 0.004, 0);
  // Recessed low-k dielectric trench floor
  b.addBox(0, -0.08, 0, span, 0.06, span, 0.005, 0);

  // Layer M2/M3: Fine Cobalt/Tungsten Local Interconnect Grid (y = +0.06, pitch = 0.64)
  for (let i = -8; i <= 8; i++) {
    const p = i * 0.64;
    if (Math.abs(p) > span - 0.1) continue;
    b.addBox(p, 0.06, 0, 0.044, 0.030, span, 0.008, 4);
    b.addBox(0, 0.06, p, span, 0.030, 0.044, 0.008, 4);
  }

  // Layer M4/M5: Rich Manhattan Copper Damascene Signal Routing Tracks (y = +0.16, fine 0.46 pitch!)
  for (let i = -11; i <= 11; i++) {
    const p = i * 0.46;
    if (Math.abs(p) > span - 0.15) continue;
    // Skip dead center of courtyard openings so you can still look down into FEOL World 3
    const mod = Math.abs(((p + 0.92) % 1.84 + 1.84) % 1.84 - 0.92);
    if (mod < 0.24) continue;
    const isCopper = (i & 1) === 0;
    b.addBox(p, 0.155, 0, 0.038, 0.034, span, 0.008, isCopper ? 3 : 2);
    b.addBox(0, 0.195, p, span, 0.034, 0.038, 0.008, isCopper ? 2 : 3);
  }

  // Layer M6/M7: Mid Copper Damascene Signal Buses (y = +0.26, pitch = 1.84 half-offset!)
  const pitch = WORLD2_PITCH;
  for (let i = -3; i <= 2; i++) {
    const g = (i + 0.5) * pitch; // ±0.92, ±2.76, ±4.60
    b.addBox(0, 0.26, g - 0.14, span, 0.044, 0.044, 0.012, 3);
    b.addBox(0, 0.26, g + 0.14, span, 0.044, 0.044, 0.012, 3);
    b.addBox(g, 0.26, 0,        0.072, 0.044, span, 0.014, 3);
  }
  for (let iz = -3; iz <= 2; iz++) {
    for (let ix = -3; ix <= 2; ix++) {
      const gx = (ix + 0.5) * pitch;
      const gz = (iz + 0.5) * pitch;
      b.addCyl(gx, 0.26, gz, 0.14, 0.050, 0.014, 3);
    }
  }

  // Layer M8/M9: Upper Semi-Global Brushed-Silver/Copper Damascene Canyons + Dual-Damascene Vias (y = +0.43)
  for (let i = -3; i <= 2; i++) {
    const pos = (i + 0.5) * pitch;
    b.addBox(0, 0.43,  pos,        span, 0.062, 0.088, 0.018, 2);
    b.addBox(0, 0.415, pos - 0.19, span, 0.048, 0.034, 0.012, 3);
    b.addBox(0, 0.415, pos + 0.19, span, 0.048, 0.034, 0.012, 3);
    b.addBox(pos, 0.43, 0,         0.084, 0.062, span, 0.018, 2);
  }

  // Dual-Damascene Circular Vias & Vertical Copper Pillars at every M8/M9 junction
  for (let iz = -3; iz <= 2; iz++) {
    for (let ix = -3; ix <= 2; ix++) {
      const cx = (ix + 0.5) * pitch;
      const cz = (iz + 0.5) * pitch;
      const isLiveVia = ((ix + iz) & 1) === 0;
      b.addCyl(cx, 0.435, cz, 0.185, 0.068, 0.018, 2);
      b.addCyl(cx, 0.485, cz, 0.088, 0.024, 0.008, 3);
      b.addCyl(cx, 0.22, cz, isLiveVia ? 0.105 : 0.094, 0.23, 0.014, 3, isLiveVia ? 11 : 0, 0);
    }
  }

  // Live glowing signal wave racing across top bus rail z = +0.92
  b.addBox(0, 0.46, 0.92, 0.62, 0.052, 0.098, 0.018, 6, 9, 3);

  return b.finish();
}

/**
 * WORLD 3 (REAL FEOL STANDARD-CELL ROWS!): Continuous CMOS Rows with VDD/VSS Rails & PMOS/NMOS (1M× · 120 nm)
 *   - NO cartoon fortress walls! Authentic horizontal VDD/VSS power rails (pitch = 0.64) bordering
 *     continuous rows of abutting standard cells, split into PMOS (top half) and NMOS (bottom half),
 *     crossed by regular vertical gate stripes (Contacted Poly Pitch) and local M0/M1 contact bars!
 *   - Fits 1:9 inside ANY World 2 canyon courtyard (±5.76 / 9 = ±0.64)!
 */
export function buildWorld3(): WorldInstances {
  const b = new InstanceBuilder();

  const pitchX = WORLD3_PITCH_X; // 0.64
  const pitchZ = WORLD3_PITCH_Z; // 0.64
  const R = 8; // 17x17 cell slots => outer edge 8.5 * 0.64 = 5.44 (cleanly inside ±5.76)
  const span = 5.76;

  // Deep bulk silicon wafer sub-base
  b.addBox(0, -0.11, 0, span, 0.02, span, 0.003, 0);
  // Shallow Trench Isolation (STI) granular SEM silicon wafer floor (top at y = -0.030, matches World 4 -0.24 / 8!)
  b.addBox(0, -0.075, 0, span, 0.045, span, 0.004, 5);

  // Continuous horizontal M0/M1 VDD & VSS Power Rails along EVERY standard-cell row boundary!
  // Row boundaries sit at (rz - 0.5) * 0.64 = ±0.32, ±0.96, ±1.60... (matches World 4's ±2.56 / 8 = ±0.32!)
  for (let rz = -R; rz <= R + 1; rz++) {
    const railZ = (rz - 0.5) * pitchZ;
    const isVdd = (rz & 1) === 0;
    // Alternating Copper-Bronze VDD and Titanium-Silver VSS power rails
    b.addBox(0, 0.024, railZ, span - 0.04, 0.022, 0.032, 0.006, isVdd ? 3 : 2);
  }

  for (let iz = -R; iz <= R; iz++) {
    for (let ix = -R; ix <= R; ix++) {
      const cx = ix * pitchX;
      const cz = iz * pitchZ;
      const dist2 = ix * ix + iz * iz;

      // Subtle vertical STI cell-boundary isolation notch (not a fortress wall!)
      b.addBox(cx - 0.31, -0.015, cz, 0.012, 0.014, 0.27, 0.003, 0);

      // PMOS active nanosheet strip (upper half of row: cz - 0.13)
      b.addBox(cx, 0.002, cz - 0.13, 0.26, 0.018, 0.058, 0.004, 2, 12, 2, ix, iz);
      // NMOS active nanosheet strip (lower half of row: cz + 0.09)
      b.addBox(cx, 0.002, cz + 0.09, 0.26, 0.018, 0.058, 0.004, 2, 12, 2, ix, iz);

      // 3 Vertical TiN/W Gate Stripes (Contacted Poly Pitch = 0.13) spanning PMOS & NMOS!
      // Keep the metal gates dark gunmetal so active cyan nanosheet strips read cleanly underneath!
      const gateStep = dist2 <= 42 ? 1 : 2;
      for (let g = -1; g <= 1; g += gateStep) {
        b.addBox(cx + g * 0.13, 0.017, cz - 0.02, 0.018, 0.022, 0.23, 0.004, 4);
      }

      // Local M0 Tungsten/Cobalt contact bar bridging PMOS/NMOS or power taps
      if (dist2 <= 50) {
        const h = hash12(ix * 3.7 + 11.1, iz * 5.3 + 2.9);
        const barX = cx + (h > 0.5 ? 0.065 : -0.065);
        b.addBox(barX, 0.034, cz - 0.02, 0.022, 0.010, 0.18, 0.003, 3);
      }
    }
  }

  return b.finish();
}

/**
 * WORLD 4 (PURE UNIFORM GAA NANOSHEET CMOS CELL!): 24 nm / 2 nm-class Standard Cell (5M× · 24 nm)
 *   - 3x3 abutting CMOS standard cells (pitch = 5.12, extent ±7.68 => fits 1:8 into World 3's ±0.96 3x3 bay!)
 *   - ZERO mixed FinFETs, ZERO cartoon fortress walls!
 *   - Authentic top VDD & bottom VSS rails (±2.56 = ±0.32 * 8), PMOS 3-stack GAA nanosheets (upper half)
 *     + NMOS 3-stack GAA nanosheets (lower half), TiN/W work-function gates (NO gold!), SiN inner spacers,
 *     and faceted SiGe (PMOS) / Si:P (NMOS) epitaxial Source/Drain pads!
 */
export function buildWorld4(): WorldInstances {
  const b = new InstanceBuilder();

  const pitch = WORLD4_CELL_PITCH; // 5.12
  const span = 7.68; // 1.5 * 5.12 = 7.68 => 7.68 / 8 = 0.96 exact match to World 3!

  // Granular crystalline SEM silicon substrate (top at y = -0.24, exact match to World 3 -0.030 * 8!)
  b.addBox(0, -0.35, 0, span, 0.11, span, 0.005, 5);

  // Continuous horizontal VDD & VSS Power Rails along EVERY cell row boundary (z = ±2.56, ±7.68)!
  // Exact scaled match to World 3's rails (y = 0.024 * 8 = +0.192, hy = 0.022 * 8 = 0.176, hz = 0.032 * 8 = 0.256)!
  const railZs = [-7.68, -2.56, 2.56, 7.68];
  for (let i = 0; i < railZs.length; i++) {
    const isVdd = (i & 1) === 0;
    b.addBox(0, 0.19, railZs[i], span, 0.175, 0.25, 0.042, isVdd ? 3 : 2);
  }

  // 3 vertically stacked wide flat GAA silicon nanosheets (matches World 5 ±1.12 / 8 = ±0.14!)
  const sheetYs = [-0.14, 0.0, 0.14];

  for (let iz = -1; iz <= 1; iz++) {
    for (let ix = -1; ix <= 1; ix++) {
      const cx = ix * pitch;
      const cz = iz * pitch;

      // Subtle STI Shallow Trench Isolation oxide well between VDD & VSS rails (no fortress walls!)
      b.addBox(cx, -0.22, cz, 2.48, 0.022, 2.24, 0.01, 0);

      // Subtle vertical STI diffusion-break divider between adjacent cells in the row
      b.addBox(cx - 2.52, -0.14, cz, 0.06, 0.08, 2.22, 0.015, 14);

      // === UPPER HALF: PMOS GAA NANOSHEET TRANSISTOR BANK (z = cz - 1.04) ===
      // Wide flat silicon nanosheets + strained SiGe Source/Drain epi pads + 3 TiN/W GAA gates
      const pmosZ = cz - 1.04;
      for (const sy of sheetYs) {
        b.addBox(cx, sy, pmosZ, 1.92, 0.026, 0.115, 0.008, 2, 14, 1, 0.55);
      }
      // Faceted SiGe Epitaxial Source/Drain pads between gates (x = ±0.52, ±1.56)
      for (const sdx of [-1.56, -0.52, 0.52, 1.56]) {
        b.addBox(cx + sdx, 0.0, pmosZ, 0.20, 0.19, 0.16, 0.032, 1, 13, 1);
        // Vertical tungsten M0 source/drain contact via rising to VDD rail
        if (Math.abs(sdx) > 1.0) {
          b.addBox(cx + sdx, 0.22, pmosZ - 0.62, 0.075, 0.055, 0.62, 0.016, 4);
        }
      }
      // 3 Vertical TiN/Tungsten GAA Gate Pillars + SiN Inner Spacers across PMOS
      for (const gx of WORLD4_GATE_XS) {
        b.addBox(cx + gx, 0.02, pmosZ, 0.155, 0.20, 0.175, 0.022, 4, 13, 2); // Gunmetal Tungsten gate fill
        b.addBox(cx + gx, 0.02, pmosZ, 0.185, 0.18, 0.155, 0.016, 14);       // Translucent SiN spacer collar
      }

      // === CENTRAL GATE-CONNECT BRIDGE: Shared TiN/W vertical gate straps linking PMOS & NMOS ===
      for (const gx of WORLD4_GATE_XS) {
        b.addBox(cx + gx, 0.12, cz - 0.16, 0.095, 0.065, 0.72, 0.018, 4);
      }

      // === LOWER HALF: SELECTABLE NMOS HERO GAA NANOSHEET BANK (z = cz + WORLD4_GATE_Z = +0.72) ===
      // Wide unobstructed +Z trench between +0.72 and VSS rail (+2.56 => Δz = 1.84 => ×8 = +14.7 > dist 5.4!)
      // Split cleanly into 3 selectable gate segments (each ±0.48) so ANY of the 27 gates swaps cleanly for World 5!
      const nmosZ = cz + WORLD4_GATE_Z;
      for (const gx of WORLD4_GATE_XS) {
        // 3 wide flat stacked silicon nanosheets (wider in Z than thick in Y!)
        for (const sy of sheetYs) {
          const isMid = sy === 0.0;
          b.addBox(
            cx + gx,
            sy,
            nmosZ,
            WORLD4_HOLE_HX,
            isMid ? 0.034 : 0.022,
            isMid ? 0.115 : 0.095,
            0.008,
            2,
            14,
            isMid ? 1 : 0,
            0.18
          );
        }
        // SiN dielectric inner spacers flanking each gate collar
        b.addBox(cx + gx - 0.20, 0.0, nmosZ, 0.042, 0.175, 0.145, 0.010, 14);
        b.addBox(cx + gx + 0.20, 0.0, nmosZ, 0.042, 0.175, 0.145, 0.010, 14);
        // TiN work-function liner + Tungsten (W) Gate-All-Around Metal Collar (NO banned gold!)
        b.addBox(cx + gx, 0.0, nmosZ, 0.165, 0.185, 0.165, 0.022, 4, 13, 2);
        // Subtle TiN bronze-slate work-function cap stripe
        b.addBox(cx + gx, 0.185, nmosZ, 0.145, 0.022, 0.145, 0.008, 3);
      }

      // Si:P Epitaxial Source/Drain Pads between & flanking the 3 NMOS gates (outside ±0.48 hole!)
      for (const sdx of [-1.66, 1.66]) {
        b.addBox(cx + sdx, 0.0, nmosZ, 0.20, 0.19, 0.16, 0.032, 2);
        // Vertical tungsten contact tap connecting NMOS Source/Drain to bottom VSS rail
        b.addBox(cx + sdx, 0.22, nmosZ + 0.88, 0.075, 0.055, 0.84, 0.016, 4);
      }
    }
  }

  return b.finish();
}

/**
 * WORLD 5 (ACCURATE 12 nm GAA GATE STACK!): Single Cutaway Gate-All-Around Nanosheet (25M× · 12 nm)
 *   - Fits 1:8 cleanly into ANY of the 27 NMOS gates of World 4 (±3.84 / 8 = ±0.48)!
 *   - Real materials & structure:
 *       * Wide flat 5 nm-thick silicon nanosheet ribbon (wider in Z than thick in Y!)
 *       * Faceted Si:P Source/Drain epitaxial shoulders at ±2.6..±3.84
 *       * Matte SiN (Silicon Nitride) inner dielectric spacers at ±1.52 insulating gate from S/D!
 *       * Cutaway TiN work-function metal liner + dense Tungsten (W) gate fill (NO gold!)
 *       * Dual-layer gate oxide: ultra-thin interfacial SiO2 (~0.5 nm) + high-k sapphire HfO2 (~1.2 nm)
 *       * Pure UNDOPED diamond-cubic Silicon crystal channel (zero bogus 7% dopants, Bloch waves on bonds!)
 */
export function buildWorldGate3nm(): WorldInstances {
  const b = new InstanceBuilder();

  // Flanking stacked wide-flat sibling nanosheets above & below (y = ±1.12, meeting World 4 at x = ±3.84)
  for (const sibY of [-1.12, 1.12]) {
    b.addBox(0, sibY, 0, 3.84, 0.15, 0.76, 0.036, 2);
    // HfO2 + TiN wrap sleeve around sibling sheets
    b.addBox(0, sibY, 0, 1.26, 0.21, 0.84, 0.034, 4);
  }

  // Left & Right Strained Si:P Source/Drain Epitaxial Shoulders (meeting World 4 flush at x = ±3.84!)
  b.addBox(-2.82, 0.0, 0.0, 1.02, 0.34, 0.94, 0.060, 2); // [-3.84 .. -1.80]
  b.addBox( 2.82, 0.0, 0.0, 1.02, 0.34, 0.94, 0.060, 2); // [+1.80 .. +3.84]

  // Silicon Nitride (SiN) Inner Dielectric Spacers insulating the metal gate from Source/Drain epi pads!
  b.addBox(-1.62, 0.0, -0.08, 0.18, 0.88, 0.96, 0.028, 14);
  b.addBox( 1.62, 0.0, -0.08, 0.18, 0.88, 0.96, 0.028, 14);

  // Cutaway C-Shaped Tungsten (W) Gate Fill + Thin TiN Work-Function Liner (NO banned gold!)
  // Back wall sits at z = -1.04 (-6.24 at 6x scale > camera dist 5.4!)
  b.addBox(0,  0.76, -0.14, 1.32, 0.16, 0.96, 0.042, 4, 13, 2); // Top Tungsten (W) gate fill
  b.addBox(0, -0.76, -0.14, 1.32, 0.16, 0.96, 0.042, 4, 13, 2); // Bottom Tungsten (W) gate fill
  b.addBox(0,  0.0,  -1.04, 1.32, 0.76, 0.14, 0.040, 4, 13, 2); // Back Tungsten gate bridge
  // Thin TiN (Titanium Nitride) bronze-slate work-function metal liner right inside the Tungsten fill
  b.addBox(0,  0.58, -0.10, 1.30, 0.042, 0.86, 0.014, 3);
  b.addBox(0, -0.58, -0.10, 1.30, 0.042, 0.86, 0.014, 3);
  b.addBox(0,  0.0,  -0.88, 1.30, 0.58,  0.042, 0.014, 3);
  // Vertical Tungsten gate sidewall risers linking the GAA stack
  b.addBox(-1.26, 0.0, -0.92, 0.12, 1.32, 0.22, 0.030, 4);
  b.addBox( 1.26, 0.0, -0.92, 0.12, 1.32, 0.22, 0.030, 4);

  // Dual-Layer Gate Dielectric:
  //   1) Amorphous Sapphire-Blue High-k HfO2 (~1.2 nm)
  b.addBox(0,  0.46, -0.08, 1.28, 0.052, 0.78, 0.016, 9, 0, 0.32);
  b.addBox(0, -0.46, -0.08, 1.28, 0.052, 0.78, 0.016, 9, 0, 0.32);
  b.addBox(0,  0.0,  -0.78, 1.28, 0.46,  0.052, 0.016, 9, 0, 0.32);
  //   2) Ultra-thin Interfacial SiO2 (~0.5 nm) right between HfO2 and the Silicon channel!
  b.addBox(0,  0.38, -0.06, 1.26, 0.024, 0.74, 0.008, 14);
  b.addBox(0, -0.38, -0.06, 1.26, 0.024, 0.74, 0.008, 14);

  // Pure UNDOPED Diamond-Cubic Silicon Channel inside the cutaway 5 nm nanosheet ribbon!
  // Exact scaled match to World 6: a5 = 1.12 / 6.0 = 0.186667!
  const R5 = STAGE_RATIOS[5];
  const a5 = WORLD5_LATTICE_A;
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

  const ribbonAtoms: { x: number; y: number; z: number }[] = [];
  const ribbonMaxX = 1.48;
  const ribbonMaxY = 1.40 / R5; // 0.2333
  const ribbonMaxZ = 1.75 / R5; // 0.2917 (wide flat ribbon!)

  for (let ix = -8; ix <= 8; ix++) {
    for (let iy = -2; iy <= 1; iy++) {
      for (let iz = -2; iz <= 2; iz++) {
        for (let bi = 0; bi < basis.length; bi++) {
          const [bx, by, bz] = basis[bi];
          const ax = (ix + bx) * a5;
          const ay = (iy + by) * a5;
          const az = (iz + bz) * a5;
          if (Math.abs(ax) > ribbonMaxX || Math.abs(ay) > ribbonMaxY + 0.002 || Math.abs(az) > ribbonMaxZ + 0.002) {
            continue;
          }
          ribbonAtoms.push({ x: ax, y: ay, z: az });
          // Channel is pure undoped silicon; only rare ~0.5% P-dopant near the S/D spacer edge (|ax| > 1.25)!
          const isEdgeDopant = Math.abs(ax) > 1.28 && hash12(ax * 23.1, az * 31.7 + ay * 9.3) > 0.94;
          const r = (isEdgeDopant ? 0.15 : 0.125) / R5;
          b.addSphere(
            ax,
            ay,
            az,
            r,
            r,
            r,
            0,
            isEdgeDopant ? 3 : 2,
            15,
            isEdgeDopant ? 0.45 : 0.0,
            (ax * 7.3 + ay * 13.1 + az * 17.9) * 1.1,
            0
          );
        }
      }
    }
  }

  // Covalent lattice bonds carrying delocalized Bloch electron wavepackets (NO flying marbles!)
  const bondMax = a5 * 0.4330127 * 1.12;
  const bondMax2 = bondMax * bondMax;
  const bondRad = 0.026 / R5;
  for (let i = 0; i < ribbonAtoms.length; i++) {
    const p1 = ribbonAtoms[i];
    for (let j = i + 1; j < ribbonAtoms.length; j++) {
      const p2 = ribbonAtoms[j];
      const dx = p2.x - p1.x;
      if (Math.abs(dx) > bondMax) continue;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.001 && d2 <= bondMax2) {
        // chParam = 1.0 marks Silicon channel covalent bonds for live Bloch wave-interference glow!
        b.addBond(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, bondRad, 4, 1.0);
      }
    }
  }

  return b.finish();
}

/**
 * WORLD 6 (AUTHENTIC CRYSTAL + AMORPHOUS GATE OXIDE + BLOCH WAVES!): 0.543 nm Silicon (100) Lattice (250M×)
 *   - Pure UNDOPED diamond-cubic Silicon channel (a = 0.543 nm, 109.5 deg tetrahedral covalent bonds)
 *   - Realistic DISORDERED AMORPHOUS ~0.5 nm SiO2 interfacial layer + AMORPHOUS HfO2 high-k dielectric overhead!
 *   - Delocalized Bloch electron wave-interference ripples propagating directly along the covalent bonds (NO marbles!)
 */
export function buildWorldLattice(): WorldInstances {
  const b = new InstanceBuilder();

  const a = WORLD6_LATTICE_A;
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

  const halfX = 2.45;
  const halfY = 1.40;
  const halfZ = 1.75;
  const nearestDist = a * 0.4330127;

  const atoms: { x: number; y: number; z: number; parity: 1 | -1 }[] = [];
  const selectableSites: LatticeAtomSite[] = [];

  for (let ix = -3; ix <= 2; ix++) {
    for (let iy = -2; iy <= 1; iy++) {
      for (let iz = -2; iz <= 2; iz++) {
        for (let bi = 0; bi < basis.length; bi++) {
          const [bx, by, bz] = basis[bi];
          const wx = (ix + bx) * a;
          const wy = (iy + by) * a;
          const wz = (iz + bz) * a;
          if (Math.abs(wx) > halfX + 0.01 || Math.abs(wy) > halfY + 0.01 || Math.abs(wz) > halfZ + 0.01) {
            continue;
          }
          const parity: 1 | -1 = bi < 4 ? 1 : -1;
          atoms.push({ x: wx, y: wy, z: wz, parity });
          if (Math.abs(wx) <= 1.72 && Math.abs(wy) <= 0.88 && Math.abs(wz) <= 1.15) {
            selectableSites.push({ x: wx, y: wy, z: wz, parity });
          }
        }
      }
    }
  }

  // Pure undoped Silicon channel atoms (thermal phonon vibration driven by live Mac die temperature!)
  for (let i = 0; i < atoms.length; i++) {
    const at = atoms[i];
    const r = 0.125;
    b.addSphere(at.x, at.y, at.z, r, r, r, 0, 2, 15, 0.0, i * 0.73, 0);
  }

  // Tetrahedral Si-Si covalent bonds carrying delocalized Bloch electron wavepackets (chParam = 1.0!)
  const bondMax = nearestDist * 1.12;
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
        b.addBond(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, 0.026, 4, 1.0);
      }
    }
  }

  // Amorphous ~0.5 nm Interfacial SiO2 Layer (y ≈ +1.68..+1.98) + Amorphous High-k HfO2 Layer (y ≈ +2.14..+2.52)
  // Built as a disordered random-network oxide (NOT an unrealistic crystalline square grid!)
  const oxideNodes: { x: number; y: number; z: number; isHf: boolean; isO: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const h1 = hash12(i * 1.73 + 3.1, 7.9);
    const h2 = hash12(i * 2.91 + 5.7, 13.3);
    const h3 = hash12(i * 4.17 + 1.3, 19.7);
    const ox = (h1 - 0.5) * 4.5;
    const oz = (h2 - 0.5) * 3.1;
    const isHfLayer = i >= 16;
    const oy = isHfLayer ? 2.16 + h3 * 0.34 : 1.72 + h3 * 0.24;
    oxideNodes.push({ x: ox, y: oy, z: oz, isHf: isHfLayer, isO: false });
    // Metal cation: Hafnium (mat 3 bronze-slate) in upper HfO2, Silicon (mat 2) in lower SiO2
    const r = isHfLayer ? 0.112 : 0.095;
    b.addSphere(ox, oy, oz, r, r, r, 0, isHfLayer ? 3 : 2, 15, isHfLayer ? 0.12 : 0.0, i * 1.37, 0);
  }
  // Bridging Oxygen anions (mat 9 sapphire-blue) linking nearby disordered SiO2 & HfO2 cations
  for (let i = 0; i < oxideNodes.length; i++) {
    const a1 = oxideNodes[i];
    let links = 0;
    for (let j = i + 1; j < oxideNodes.length && links < 3; j++) {
      const a2 = oxideNodes[j];
      const d = Math.hypot(a2.x - a1.x, a2.y - a1.y, a2.z - a1.z);
      if (d > 0.42 && d < 0.96) {
        const mx = (a1.x + a2.x) * 0.5 + (hash12(i * 3.1, j * 5.7) - 0.5) * 0.08;
        const my = (a1.y + a2.y) * 0.5 + (hash12(j * 2.3, i * 4.1) - 0.5) * 0.08;
        const mz = (a1.z + a2.z) * 0.5 + (hash12(i * 7.1, j * 1.9) - 0.5) * 0.08;
        b.addSphere(mx, my, mz, 0.062, 0.062, 0.062, 0, 9, 15, 0.20, (i + j) * 0.91, 0);
        b.addBond(a1.x, a1.y, a1.z, mx, my, mz, 0.015, 4, 0.0);
        b.addBond(mx, my, mz, a2.x, a2.y, a2.z, 0.015, 4, 0.0);
        links++;
      }
    }
  }

  return b.finish(selectableSites);
}

/**
 * WORLD 7 (PURE QUANTUM WAVEFUNCTION ATOM!): 111 pm Single Silicon-28 Atom (1.2B×)
 *   - NO Kepler planetary rings, NO cartoonish solid bond pipes!
 *   - Layered translucent 1s2 core cloud (r = 0.28) + 2s2/2p6 radial-noded shell (r = 0.62)
 *     + 4 lush 3sp3 hybridized bonding orbital clouds that ARE the covalent bonds meeting the 4 real Si neighbors!
 *   - 260 stochastic quantum |ψ|² probability-density sparkles shimmering in-place inside the sp3 lobes (ch == 22)
 *   - Tiny blazing central nuclear pinpoint (r = 0.018) previews the TRUE 1800x empty-space plunge to World 8!
 */
export function buildWorldAtom(): WorldInstances {
  const b = new InstanceBuilder();

  // Inner 1s2 core electron wavefunction (r = 0.28) + subtle 2s2/2p6 shell (r = 0.62)
  b.addTranslucentSphere(0, 0, 0, 0.28, 0.28, 0.28, 0, 8, 0, 0.82, 0.4, 0);
  b.addTranslucentSphere(0, 0, 0, 0.62, 0.62, 0.62, 0, 8, 0, 0.26, 1.7, 0);

  const invSqrt3 = 1 / Math.sqrt(3);
  const tetDirs: [number, number, number][] = [
    [ invSqrt3,  invSqrt3,  invSqrt3],
    [ invSqrt3, -invSqrt3, -invSqrt3],
    [-invSqrt3,  invSqrt3, -invSqrt3],
    [-invSqrt3, -invSqrt3,  invSqrt3],
  ];

  for (let i = 0; i < 4; i++) {
    const [dx, dy, dz] = tetDirs[i];
    // Outer translucent 3sp3 hybridized bonding orbital lobe (stretches from 1s2 edge 0.28 -> neighbor surface 1.92!)
    b.addTranslucentSphere(
      dx * 0.28,
      dy * 0.28,
      dz * 0.28,
      dx * 1.66,
      dy * 1.66,
      dz * 1.66,
      0.52,
      8,
      17,
      0.92,
      i * 0.25,
      0
    );
    // Inner high-density bonding probability core inside each sp3 lobe (replaces rigid cyan bond pipes!)
    b.addTranslucentSphere(
      dx * 0.30,
      dy * 0.30,
      dz * 0.30,
      dx * 1.62,
      dy * 1.62,
      dz * 1.62,
      0.20,
      8,
      17,
      1.25,
      i * 0.25 + 0.15,
      0
    );
    // Opposite minor sp3 anti-bonding back-lobe
    b.addTranslucentSphere(
      -dx * 0.28,
      -dy * 0.28,
      -dz * 0.28,
      -dx * 0.38,
      -dy * 0.38,
      -dz * 0.38,
      0.18,
      8,
      17,
      0.38,
      i * 0.25 + 0.5,
      0
    );
  }

  // 260 Stochastic Quantum |ψ|² Measurement Sparkles distributed inside the actual 3sp3 lobes & 2s/2p shell
  // (Stationary shimmering quantum fluctuations — NOT circular planetary orbits! Channel 22)
  for (let i = 0; i < 260; i++) {
    const h1 = hash12(i * 1.37 + 1.1, 7.13);
    const h2 = hash12(i * 2.91 + 4.3, 13.7);
    const h3 = hash12(i * 5.13 + 2.7, 3.1);
    const h4 = hash12(i * 7.73 + 9.1, 17.3);

    let px: number, py: number, pz: number;
    if (i < 52) {
      // 2s2/2p6 inner radial shell mist (r in [0.42..0.76])
      const rad = 0.44 + h1 * 0.32;
      const th = h2 * Math.PI * 2;
      const cz = h3 * 2 - 1;
      const sr = Math.sqrt(Math.max(0, 1 - cz * cz));
      px = Math.cos(th) * sr * rad;
      py = cz * rad;
      pz = Math.sin(th) * sr * rad;
    } else {
      // Sampled inside one of the 4 tetrahedral 3sp3 bonding orbital lobes!
      const lobe = i % 4;
      const [dx, dy, dz] = tetDirs[lobe];
      // Build orthonormal frame around tetDir
      const rx = Math.abs(dy) < 0.9 ? -dz : 0;
      const ry = Math.abs(dy) < 0.9 ? 0 : -dz;
      const rz = Math.abs(dy) < 0.9 ? dx : dy;
      const rLen = Math.hypot(rx, ry, rz) || 1;
      const ux = rx / rLen, uy = ry / rLen, uz = rz / rLen;
      const vx = dy * uz - dz * uy;
      const vy = dz * ux - dx * uz;
      const vz = dx * uy - dy * ux;

      const t = 0.14 + Math.pow(h1, 0.85) * 0.82; // Along lobe axis [0.14..0.96]
      const env = Math.pow(t, 0.65) * Math.sin(t * Math.PI) * 0.44;
      const rad = Math.sqrt(h2) * env;
      const ang = h3 * Math.PI * 2;
      const distAlong = 0.30 + t * 1.58;
      px = dx * distAlong + (ux * Math.cos(ang) + vx * Math.sin(ang)) * rad;
      py = dy * distAlong + (uy * Math.cos(ang) + vy * Math.sin(ang)) * rad;
      pz = dz * distAlong + (uz * Math.cos(ang) + vz * Math.sin(ang)) * rad;
    }
    const sz = 0.015 + h4 * 0.016;
    b.addSphere(px, py, pz, sz, sz, sz, 0, 6, 22, 0.85, h4, i * 0.17);
  }

  return b.finish();
}

/**
 * WORLD 8 (OBLATE 28Si NUCLEUS + PION FIELD!): 3.1 fm Silicon-28 Atomic Nucleus (40T×)
 *   - Reached after a dramatic 1,800x empty-space plunge through the dark vacuum of the atom!
 *   - Authentic OBLATE-DEFORMED (flattened disc, ~1.28:1.28:0.78 aspect ratio!) 14P + 14N structure!
 *   - NO rigid sticks between nucleons! Bound by a shimmering translucent residual strong-force pion aura!
 *   - Center Proton sits right at (0, 0, 0) so diving 10x deeper enters World 9 (Single Proton & 3 Quarks)!
 */
export function buildWorldNucleus(): WorldInstances {
  const b = new InstanceBuilder();

  const nucleons: { x: number; y: number; z: number; isProton: boolean }[] = [];

  // Central hero Proton at (0, 0, 0) — diving into it (z = 8 -> 9) opens World 9 (uud Quarks & Gluon Flux Tubes!)
  nucleons.push({ x: 0, y: 0, z: 0, isProton: true });

  // Inner oblate core ring (6 nucleons: 3P + 3N around the central proton, flattened in Y!)
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2;
    const R = 0.62;
    const yOff = (i % 2 === 0 ? 1 : -1) * 0.16;
    nucleons.push({
      x: Math.cos(th) * R,
      y: yOff,
      z: Math.sin(th) * R,
      isProton: i % 2 === 1,
    });
  }

  // Outer oblate deformed 28Si shell (21 nucleons: 10P + 11N — characteristic oblate pancake deformation!)
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 21; i++) {
    const u = 1 - ((i + 0.5) / 21) * 2; // (-1..+1)
    const rad = Math.sqrt(Math.max(0, 1 - u * u));
    const th = golden * (i + 3.5);
    // Oblate radii: wider in equatorial XZ (1.32), compressed along polar Y (0.78)!
    const rx = 1.30;
    const ry = 0.78;
    const rz = 1.30;
    nucleons.push({
      x: Math.cos(th) * rad * rx,
      y: u * ry,
      z: Math.sin(th) * rad * rz,
      isProton: i < 10 ? i % 2 === 0 || i === 9 : i % 2 === 0,
    });
  }

  // Ensure exact 14 Protons + 14 Neutrons for Silicon-28!
  let pCount = nucleons.filter((n) => n.isProton).length;
  for (let i = nucleons.length - 1; i >= 1 && pCount !== 14; i--) {
    if (pCount > 14 && nucleons[i].isProton) {
      nucleons[i].isProton = false;
      pCount--;
    } else if (pCount < 14 && !nucleons[i].isProton) {
      nucleons[i].isProton = true;
      pCount++;
    }
  }

  for (let i = 0; i < nucleons.length; i++) {
    const n = nucleons[i];
    const r = 0.34;
    // Keep central hero Proton at (0,0,0) steady so World 9 (Quarks) stays welded to its exact center!
    const chType = i === 0 ? 0 : 21;
    b.addSphere(n.x, n.y, n.z, r, r, r, 0, n.isProton ? 9 : 3, chType, n.isProton ? 0.95 : 0.35, i * 1.17, n.isProton ? 1 : 0);
  }

  // Translucent Oblate Residual Strong-Force Pion-Exchange Aura enveloping the nucleus (replaces rigid sticks!)
  b.addTranslucentSphere(0, 0, 0, 1.72, 1.14, 1.72, 0, 8, 0, 0.58, 0.6, 0);

  // 54 flickering virtual pion-exchange fluctuations around the nuclear surface (ch == 22)
  for (let k = 0; k < 54; k++) {
    const u = 1 - ((k + 0.5) / 54) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - u * u));
    const th = hash12(k * 7.3, 2.1) * Math.PI * 2;
    const j = 1.0 + (hash12(k * 3.1, 9.7) - 0.5) * 0.35;
    b.addSphere(
      Math.cos(th) * rad * 1.55 * j,
      u * 0.98 * j,
      Math.sin(th) * rad * 1.55 * j,
      0.026,
      0.026,
      0.026,
      0,
      k % 3 === 0 ? 3 : 6,
      22,
      1.15,
      hash12(k * 4.9, 5.5),
      k * 0.33
    );
  }

  return b.finish();
}

/**
 * WORLD 9 (QCD PROTON INTERIOR!): 0.84 fm Single Silicon-28 Proton — 3 Valence Quarks (uud) + Gluon Flux Tubes (150T×)
 *   - Fits 1:10 directly inside the central sapphire Proton (r = 0.34 -> r = 3.4) of World 8!
 *   - 3 RGB color-charge valence quarks: Up (Red, mat 11), Up (Green, mat 12), Down (Blue, mat 13)
 *   - Y-shaped QCD Steiner-tree gluon color-flux junction + outer confinement bag + flickering virtual q-q̄ sea!
 */
export function buildWorldQuarks(): WorldInstances {
  const b = new InstanceBuilder();

  // Translucent QCD confinement bag enveloping the 0.84 fm Proton interior
  b.addTranslucentSphere(0, 0, 0, 2.85, 2.85, 2.85, 0, 8, 0, 0.36, 0.9, 0);

  // 3 Valence Quarks (uud) in an equilateral color-neutral triangle inside the 0.84 fm proton
  const qR = 1.18;
  const quarks: { x: number; y: number; z: number; mat: number }[] = [
    { x: qR * Math.cos(0),                   y:  0.16, z: qR * Math.sin(0),                   mat: 11 }, // Up (Red)
    { x: qR * Math.cos((Math.PI * 2) / 3),   y: -0.20, z: qR * Math.sin((Math.PI * 2) / 3),   mat: 12 }, // Up (Green)
    { x: qR * Math.cos((Math.PI * 4) / 3),   y:  0.04, z: qR * Math.sin((Math.PI * 4) / 3),   mat: 13 }, // Down (Blue)
  ];

  for (let i = 0; i < 3; i++) {
    const q = quarks[i];
    // Radiant point-like valence quark dressed in its local gluon cloud
    b.addSphere(q.x, q.y, q.z, 0.22, 0.22, 0.22, 0, q.mat, 21, 1.35, i * 2.1, 1);
    b.addTranslucentSphere(q.x, q.y, q.z, 0.52, 0.52, 0.52, 0, 8, 0, 0.72, i * 0.33, 0);
  }

  // Authentic Y-Shaped Lattice QCD Steiner-Tree Gluon Color-Flux Tubes meeting at the central Fermat junction (0,0,0)!
  for (let i = 0; i < 3; i++) {
    const q = quarks[i];
    b.addBond(0, 0, 0, q.x, q.y, q.z, 0.062, 6, 1.20, 23);
  }
  // Luminous central QCD gluon junction knot
  b.addSphere(0, 0, 0, 0.13, 0.13, 0.13, 0, 6, 21, 1.35, 0.5, 0);
  b.addTranslucentSphere(0, 0, 0, 0.34, 0.34, 0.34, 0, 8, 0, 0.65, 0.2, 0);

  // 140 Virtual Quark-Antiquark (q-q̄) Sea & Gluon Vacuum Fluctuations shimmering inside the confinement volume!
  for (let k = 0; k < 140; k++) {
    const h1 = hash12(k * 1.93 + 2.1, 11.3);
    const h2 = hash12(k * 3.71 + 6.7, 5.9);
    const h3 = hash12(k * 5.29 + 1.7, 17.1);
    const h4 = hash12(k * 8.11 + 4.3, 3.7);
    const rad = Math.cbrt(h1) * 2.25;
    const th = h2 * Math.PI * 2;
    const cz = h3 * 2 - 1;
    const sr = Math.sqrt(Math.max(0, 1 - cz * cz));
    const sx = Math.cos(th) * sr * rad;
    const sy = cz * rad;
    const sz = Math.sin(th) * sr * rad;
    const mat = k % 5 === 0 ? 11 : k % 5 === 1 ? 12 : k % 5 === 2 ? 13 : 6;
    const r = 0.022 + h4 * 0.024;
    b.addSphere(sx, sy, sz, r, r, r, 0, mat, 22, 1.15, h4, k * 0.29);
  }

  return b.finish();
}
