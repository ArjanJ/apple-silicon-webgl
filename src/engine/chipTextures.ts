import copperImgUrl from '../assets/mat-copper-macro.jpg';
import epoxyImgUrl from '../assets/mat-epoxy-macro.jpg';
import semSiliconImgUrl from '../assets/mat-sem-silicon.jpg';
import titaniumImgUrl from '../assets/mat-titanium-macro.jpg';

/**
 * Hybrid Photographic + Vector-Baked WebGL2 PBR Texture Pipeline for Apple Silicon Microscope.
 *
 * Combines:
 *   1) Seamless 512x512 Macro Photographic PBR Material Array (4 layers in TEXTURE_2D_ARRAY):
 *        - Layer 0: Silica-filled matte-black IC epoxy mold compound (LPDDR5 packages)
 *        - Layer 1: CMP-polished electroplated polycrystalline copper damascene (BEOL)
 *        - Layer 2: Precision brushed titanium & sputtered tungsten metal
 *        - Layer 3: Cleanroom SEM etched crystalline silicon wafer substrate
 *   2) Vector-Baked 2048x1024 Architectural Die Lithography Atlas (8 tiles x 512x512):
 *        - Per-block high-res SRAM banks, out-of-order ALU/decode seas, GPU TBDR quads,
 *          Neural Engine systolic arrays, Media codecs, SerDes spirals, and die seal ring
 *        - Encodes Sobel micro-relief normals, cavity AO, roughness, Bragg grating pitch & axis
 *   3) Vector-Baked 1024x1024 ABF Organic Package Substrate Map:
 *        - Woven fiberglass, buried copper hatch, 45-degree differential escape routing traces
 *          aligned directly to World 0 die, LPDDR5 packages & SMD capacitors, plus ENIG micro-vias
 *   4) Vector-Baked 512x512 LPDDR5 Laser-Etch Decal Map (clean IC markings, Pin-1 recess, DataMatrix)
 *   5) Custom 512x256 RGBM HDR Studio Softbox + Negative-Fill Environment Mipmap Pyramid (7 mips)
 */

export interface TextureBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PbrTexturePair {
  albedo: TextureBuffer;
  relief: TextureBuffer;
}

export interface MaterialArrayLayerUpdate {
  layer: number;
  albedo: TextureBuffer;
  relief: TextureBuffer;
}

export interface ChipTexturePack {
  /** Initial instant placeholder 4-layer 512x512 array data (layers concatenated) */
  matArraySize: number;
  matArrayLayers: number;
  matAlbedoInit: Uint8Array;
  matReliefInit: Uint8Array;
  /** 2048x1024 architectural die lithography atlas (feature/grating + normal/AO/rough) */
  dieLitho: TextureBuffer;
  dieNorm: TextureBuffer;
  /** 1024x1024 World 0 ABF organic interposer routing + relief normal */
  abfMap: TextureBuffer;
  abfNorm: TextureBuffer;
  /** 512x512 LPDDR5 laser-etched marking decal */
  ramDecal: TextureBuffer;
  /** 512x256 RGBM HDR studio environment map with prefiltered roughness mip levels */
  envMips: TextureBuffer[];
}

export const MAT_ARRAY_SIZE = 512;
export const MAT_ARRAY_LAYERS = 4;
export const ENV_RGBM_RANGE = 8.0;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

/**
 * Derive wrapped Sobel multi-scale tangent normals + cavity AO from a scalar height buffer.
 * Supports both seamless toroidal wrap (for tileable macro textures) and clamped edges (for atlases).
 */
function buildReliefFromHeight(
  height: Float32Array,
  w: number,
  h: number,
  fineGain: number,
  broadGain: number,
  wrap: boolean,
  roughOut?: Float32Array
): Uint8Array {
  const blurH = new Float32Array(w * h);
  const blurV = new Float32Array(w * h);

  const idxX = (x: number) => (wrap ? ((x % w) + w) % w : clamp(x, 0, w - 1));
  const idxY = (y: number) => (wrap ? ((y % h) + h) % h : clamp(y, 0, h - 1));

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += height[row + idxX(x + k)];
      blurH[row + x] = s * 0.2;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += blurH[idxY(y + k) * w + x];
      blurV[y * w + x] = s * 0.2;
    }
  }

  const out = new Uint8Array(w * h * 4);
  const sample = (buf: Float32Array, x: number, y: number) => buf[idxY(y) * w + idxX(x)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p4 = i * 4;

      const gxFine =
        sample(height, x + 1, y - 1) +
        2 * sample(height, x + 1, y) +
        sample(height, x + 1, y + 1) -
        (sample(height, x - 1, y - 1) + 2 * sample(height, x - 1, y) + sample(height, x - 1, y + 1));
      const gzFine =
        sample(height, x - 1, y + 1) +
        2 * sample(height, x, y + 1) +
        sample(height, x + 1, y + 1) -
        (sample(height, x - 1, y - 1) + 2 * sample(height, x, y - 1) + sample(height, x + 1, y - 1));

      const gxBroad = sample(blurV, x + 2, y) - sample(blurV, x - 2, y);
      const gzBroad = sample(blurV, x, y + 2) - sample(blurV, x, y - 2);

      const nx = clamp(-(gxFine * fineGain + gxBroad * broadGain), -1, 1);
      const nz = clamp(-(gzFine * fineGain + gzBroad * broadGain), -1, 1);
      const slopeMag = Math.hypot(nx, nz);

      const val = height[i];
      const localDiff = val - blurV[i];
      const cavity = clamp(0.90 + localDiff * 1.45 - slopeMag * 0.14, 0.42, 1.0);

      out[p4] = clampByte(nx * 127 + 128);
      out[p4 + 1] = clampByte(nz * 127 + 128);
      out[p4 + 2] = clampByte(cavity * 255);
      out[p4 + 3] = roughOut ? clampByte(roughOut[i] * 255) : clampByte(val * 255);
    }
  }
  return out;
}

/**
 * Process a loaded macro surface photograph into a seamless 512x512 tileable PBR layer
 * (albedo+roughness + wrapped Sobel normal+cavity-AO).
 */
function processMacroMaterialImage(img: HTMLImageElement, layer: number): PbrTexturePair {
  const S = MAT_ARRAY_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, S, S);
  const raw = ctx.getImageData(0, 0, S, S).data;

  // Compute global mean RGB so we can remove any macro lighting tilt and ensure clean seam-free tiling
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  const total = S * S;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    meanR += raw[p];
    meanG += raw[p + 1];
    meanB += raw[p + 2];
  }
  meanR /= total;
  meanG /= total;
  meanB /= total;

  // Soft 6% toroidal edge feather so repeated tiling across long rails has zero seam lines
  const feather = Math.floor(S * 0.06);
  const smoothRgb = new Float32Array(total * 3);
  const height = new Float32Array(total);

  for (let y = 0; y < S; y++) {
    const dyEdge = Math.min(y, S - 1 - y);
    const wy = dyEdge < feather ? 0.5 - 0.5 * Math.cos((Math.PI * dyEdge) / feather) : 1.0;
    const my = (y + (S >> 1)) % S;
    for (let x = 0; x < S; x++) {
      const dxEdge = Math.min(x, S - 1 - x);
      const wx = dxEdge < feather ? 0.5 - 0.5 * Math.cos((Math.PI * dxEdge) / feather) : 1.0;
      const w = wx * wy;
      const mx = (x + (S >> 1)) % S;

      const pA = (y * S + x) * 4;
      const pB = (my * S + mx) * 4;

      const r = raw[pA] * w + raw[pB] * (1 - w);
      const g = raw[pA + 1] * w + raw[pB + 1] * (1 - w);
      const b = raw[pA + 2] * w + raw[pB + 2] * (1 - w);

      const d3 = (y * S + x) * 3;
      smoothRgb[d3] = r;
      smoothRgb[d3 + 1] = g;
      smoothRgb[d3 + 2] = b;
      height[y * S + x] = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0;
    }
  }

  // Per-material Sobel gains & roughness calibration
  const fineGain = layer === 0 ? 0.72 : layer === 1 ? 0.42 : layer === 2 ? 0.52 : 0.68;
  const broadGain = layer === 0 ? 0.55 : layer === 1 ? 0.95 : layer === 2 ? 0.35 : 0.85;
  const reliefData = buildReliefFromHeight(height, S, S, fineGain, broadGain, true);

  const albedoData = new Uint8Array(total * 4);
  const meanLum = (meanR * 0.299 + meanG * 0.587 + meanB * 0.114) / 255.0;

  for (let i = 0; i < total; i++) {
    const p4 = i * 4;
    const p3 = i * 3;
    const r = smoothRgb[p3] / 255.0;
    const g = smoothRgb[p3 + 1] / 255.0;
    const b = smoothRgb[p3 + 2] / 255.0;
    const lum = height[i];
    const cav = reliefData[p4 + 2] / 255.0;

    let outR = r;
    let outG = g;
    let outB = b;
    let rough = 0.25;

    if (layer === 0) {
      // Silica-filled matte-black IC epoxy: charcoal binder + bright mineral silica flecks
      const fleck = clamp((lum - meanLum - 0.08) * 3.8, 0, 1);
      outR = clamp(r * 0.85 + fleck * 0.18, 0, 1);
      outG = clamp(g * 0.86 + fleck * 0.18, 0, 1);
      outB = clamp(b * 0.90 + fleck * 0.20, 0, 1);
      // Gritty matte binder (0.56..0.72), crystalline silica flecks glint slightly sharper (0.34)
      rough = clamp(0.62 + (1.0 - cav) * 0.18 - fleck * 0.26, 0.30, 0.78);
    } else if (layer === 1) {
      // Polycrystalline CMP copper: normalized grain modulation (centered ~0.82 so shader tints cleanly)
      const normScale = 0.82 / Math.max(meanLum, 0.15);
      outR = clamp(0.82 + (r * normScale - 0.82) * 0.92, 0.45, 1.0);
      outG = clamp(0.82 + (g * normScale - 0.82) * 0.92, 0.45, 1.0);
      outB = clamp(0.82 + (b * normScale - 0.82) * 0.92, 0.45, 1.0);
      // Each copper grain has slightly distinct specular polish; grain boundaries are rougher
      const grainVar = clamp((lum - meanLum) * 1.4, -0.07, 0.07);
      rough = clamp(0.18 - grainVar + (1.0 - cav) * 0.22, 0.10, 0.38);
    } else if (layer === 2) {
      // Brushed titanium / sputtered tungsten: neutral high-contrast linear streaks
      const normScale = 0.80 / Math.max(meanLum, 0.15);
      const v = clamp(0.80 + (lum * normScale - 0.80) * 0.85, 0.42, 1.0);
      outR = v;
      outG = v;
      outB = clamp(v * 1.02, 0, 1);
      rough = clamp(0.20 + (1.0 - lum) * 0.12 + (1.0 - cav) * 0.16, 0.11, 0.38);
    } else {
      // Cleanroom SEM etched crystalline silicon wafer
      const normScale = 0.72 / Math.max(meanLum, 0.15);
      const v = clamp(0.72 + (lum * normScale - 0.72) * 1.12, 0.20, 1.0);
      outR = v * 0.95;
      outG = v * 0.98;
      outB = clamp(v * 1.04, 0, 1);
      rough = clamp(0.46 + (1.0 - cav) * 0.24 - Math.max(0, lum - meanLum) * 0.22, 0.28, 0.76);
    }

    albedoData[p4] = clampByte(outR * 255);
    albedoData[p4 + 1] = clampByte(outG * 255);
    albedoData[p4 + 2] = clampByte(outB * 255);
    albedoData[p4 + 3] = clampByte(rough * 255);
  }

  return {
    albedo: { width: S, height: S, data: albedoData },
    relief: { width: S, height: S, data: reliefData },
  };
}

/** Instant synchronous procedural placeholders for the 4-layer array while the 4 JPGs decode (~5 ms). */
function buildPlaceholderMaterialArray(): { albedo: Uint8Array; relief: Uint8Array } {
  const S = MAT_ARRAY_SIZE;
  const layerBytes = S * S * 4;
  const albedo = new Uint8Array(layerBytes * MAT_ARRAY_LAYERS);
  const relief = new Uint8Array(layerBytes * MAT_ARRAY_LAYERS);
  const rng = mulberry32(42071);

  for (let layer = 0; layer < MAT_ARRAY_LAYERS; layer++) {
    const baseOff = layer * layerBytes;
    const baseRough = layer === 0 ? 158 : layer === 1 ? 48 : layer === 2 ? 56 : 124;
    const baseVal = layer === 0 ? 44 : layer === 1 ? 208 : layer === 2 ? 204 : 178;
    for (let i = 0; i < S * S; i++) {
      const p = baseOff + i * 4;
      const n = (rng() - 0.5) * 18;
      albedo[p] = clampByte(baseVal + n);
      albedo[p + 1] = clampByte(baseVal + n);
      albedo[p + 2] = clampByte(baseVal + n);
      albedo[p + 3] = baseRough;

      relief[p] = 128;
      relief[p + 1] = 128;
      relief[p + 2] = 235;
      relief[p + 3] = 128;
    }
  }
  return { albedo, relief };
}

/**
 * Vector-Bake a crisp 2048x1024 Architectural Die Photolithography Atlas (4x2 tiles of 512x512).
 *
 * Tile mapping (col, row):
 *   (0,0) = P-Core (split L1 SRAM bank columns + OoO decode/ALU logic sea + central bus)
 *   (1,0) = E-Core (compact high-density execution sub-cells + tight L1 SRAM)
 *   (2,0) = System-Level Cache (SLC — iconic regular 6T SRAM macro bank columns + decoders)
 *   (3,0) = Apple GPU Core (symmetric 4-quad TBDR shader array + tile memory strips)
 *   (0,1) = 16-Core Neural Engine (crisp systolic MAC matrix array + weight buses)
 *   (1,1) = Display & ProRes Media Engine (dual structured video codec pipelines + FIFOs)
 *   (2,1) = Thunderbolt / USB4 I/O PHY (SerDes transceivers + octagonal planar spiral inductors)
 *   (3,1) = Main Silicon Die Slab (metallic seal ring, corner alignment verniers, CMP dummy fill)
 */
function bakeDieLithographyAtlas(): { litho: TextureBuffer; norm: TextureBuffer } {
  const W = 2048;
  const H = 1024;
  const T = 512;

  // Height canvas (grayscale -> Sobel normal + cavity AO)
  const hCanvas = document.createElement('canvas');
  hCanvas.width = W;
  hCanvas.height = H;
  const hCtx = hCanvas.getContext('2d')!;
  hCtx.fillStyle = '#585858';
  hCtx.fillRect(0, 0, W, H);

  // Feature canvas (R = grating pitch/oxide thickness, G = grating orientation, B = reflectivity, A = bus glow mask)
  const fCanvas = document.createElement('canvas');
  fCanvas.width = W;
  fCanvas.height = H;
  const fCtx = fCanvas.getContext('2d')!;
  fCtx.fillStyle = 'rgba(110, 128, 120, 0)';
  fCtx.fillRect(0, 0, W, H);

  const rng = mulberry32(1337901);

  const fillBlock = (
    ox: number,
    oy: number,
    x: number,
    y: number,
    w: number,
    h: number,
    hVal: number,
    pitch: number,
    orient: number,
    refl: number,
    busAlpha = 0
  ) => {
    const hv = clampByte(hVal);
    hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hCtx.fillRect(ox + x, oy + y, w, h);

    fCtx.fillStyle = `rgba(${clampByte(pitch)},${clampByte(orient)},${clampByte(refl)},${clamp(busAlpha, 0, 1).toFixed(3)})`;
    fCtx.fillRect(ox + x, oy + y, w, h);
  };

  /** Draw a realistic 6T SRAM macro array with bitline columns, wordline straps, and sense amps */
  const drawSramArray = (
    ox: number,
    oy: number,
    x: number,
    y: number,
    w: number,
    h: number,
    cols: number,
    rows: number,
    pitchBase: number,
    vertical = true
  ) => {
    // Recessed moat around SRAM macro
    fillBlock(ox, oy, x, y, w, h, 46, pitchBase - 18, 128, 95, 0.05);
    const pad = 4;
    const cw = (w - pad * 2) / cols;
    const rh = (h - pad * 2) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = x + pad + c * cw + 1.5;
        const by = y + pad + r * rh + 1.5;
        const bw = Math.max(2, cw - 3);
        const bh = Math.max(2, rh - 3);
        const pJitter = (rng() - 0.5) * 14;
        fillBlock(ox, oy, bx, by, bw, bh, 178 + (rng() - 0.5) * 24, pitchBase + pJitter, vertical ? 24 : 232, 212, 0.12);

        // Ultra-fine bitline / wordline striations inside each sub-bank
        const stride = 4;
        hCtx.fillStyle = '#e8e8e8';
        if (vertical) {
          for (let lx = bx + 2; lx < bx + bw - 2; lx += stride) {
            hCtx.fillRect(ox + lx, oy + by + 1, 1.5, bh - 2);
          }
        } else {
          for (let ly = by + 2; ly < by + bh - 2; ly += stride) {
            hCtx.fillRect(ox + bx + 1, oy + ly, bw - 2, 1.5);
          }
        }
      }
    }
    // Central wordline decoder spine
    if (vertical) {
      fillBlock(ox, oy, x + w * 0.5 - 3, y + 2, 6, h - 4, 224, pitchBase + 28, 128, 238, 0.65);
    } else {
      fillBlock(ox, oy, x + 2, y + h * 0.5 - 3, w - 4, 6, 224, pitchBase + 28, 128, 238, 0.65);
    }
  };

  /** Draw a realistic irregular "sea of gates" synthesized logic / ALU region */
  const drawLogicSea = (
    ox: number,
    oy: number,
    x: number,
    y: number,
    w: number,
    h: number,
    pitchBase: number
  ) => {
    fillBlock(ox, oy, x, y, w, h, 72, pitchBase, 128, 130, 0.15);
    // Horizontal standard-cell power-rail rows + packed variable-width gate clusters
    const rowStep = 10;
    for (let ry = y + 3; ry < y + h - 4; ry += rowStep) {
      // Thin horizontal power strap
      fillBlock(ox, oy, x + 2, ry, w - 4, 1.5, 198, pitchBase + 22, 220, 210, 0.35);
      let rx = x + 3;
      while (rx < x + w - 8) {
        const cw = 6 + Math.floor(rng() * 18);
        const clampedW = Math.min(cw, x + w - 3 - rx);
        if (clampedW > 3) {
          const dense = rng();
          const hv = dense > 0.35 ? 132 + rng() * 68 : 88 + rng() * 30;
          const orient = rng() > 0.5 ? 42 : 210;
          fillBlock(ox, oy, rx, ry + 2.5, clampedW - 1.5, rowStep - 4, hv, pitchBase + (rng() - 0.5) * 46, orient, 140 + dense * 75, dense > 0.72 ? 0.38 : 0.08);
        }
        rx += cw + 1;
      }
    }
    // Cross-cutting vertical M6/M7 routing bus bundles
    for (let bx = x + 24; bx < x + w - 16; bx += 38) {
      fillBlock(ox, oy, bx, y + 2, 3, h - 4, 212, pitchBase + 34, 28, 228, 0.45);
      fillBlock(ox, oy, bx + 5, y + 2, 1.5, h - 4, 196, pitchBase + 26, 28, 215, 0.30);
    }
  };

  /** Guard ring frame around a functional die block */
  const drawGuardRing = (ox: number, oy: number, pitchBase: number) => {
    const m = 12;
    fillBlock(ox, oy, m, m, T - m * 2, 5, 232, pitchBase + 40, 235, 245, 0.88);
    fillBlock(ox, oy, m, T - m - 5, T - m * 2, 5, 232, pitchBase + 40, 235, 245, 0.88);
    fillBlock(ox, oy, m, m, 5, T - m * 2, 232, pitchBase + 40, 20, 245, 0.88);
    fillBlock(ox, oy, T - m - 5, m, 5, T - m * 2, 232, pitchBase + 40, 20, 245, 0.88);
    // Secondary inner power ring
    const m2 = 22;
    fillBlock(ox, oy, m2, m2, T - m2 * 2, 2, 185, pitchBase + 15, 220, 205, 0.42);
    fillBlock(ox, oy, m2, T - m2 - 2, T - m2 * 2, 2, 185, pitchBase + 15, 220, 205, 0.42);
    fillBlock(ox, oy, m2, m2, 2, T - m2 * 2, 185, pitchBase + 15, 35, 205, 0.42);
    fillBlock(ox, oy, T - m2 - 2, m2, 2, T - m2 * 2, 185, pitchBase + 15, 35, 205, 0.42);
  };

  // === TILE (0,0): P-CORE (Split L1I/L1D SRAM banks on left + OoO Decode/ALU/FP execution on right) ===
  {
    const ox = 0;
    const oy = 0;
    drawGuardRing(ox, oy, 118);
    drawSramArray(ox, oy, 30, 30, 198, 214, 4, 4, 88, true);   // 192 KB L1I Cache
    drawSramArray(ox, oy, 30, 256, 198, 226, 4, 4, 102, true); // 128 KB L1D Cache
    // Central high-speed L1/LSU crossbar bus
    fillBlock(ox, oy, 234, 28, 12, 456, 228, 168, 20, 240, 0.78);
    // Out-of-order Integer ALU, Branch Predictor, & 4x FP/NEON Vector Pipes
    drawLogicSea(ox, oy, 252, 30, 230, 148, 148);
    drawLogicSea(ox, oy, 252, 186, 230, 146, 166);
    drawSramArray(ox, oy, 252, 340, 112, 142, 3, 2, 126, false); // Physical Register File
    drawLogicSea(ox, oy, 370, 340, 112, 142, 138);               // AMX / Load-Store Queue
  }

  // === TILE (1,0): E-CORE (Compact dual-cluster execution + dense L1 SRAM) ===
  {
    const ox = 512;
    const oy = 0;
    drawGuardRing(ox, oy, 132);
    drawSramArray(ox, oy, 30, 30, 452, 152, 8, 2, 96, true);
    fillBlock(ox, oy, 28, 188, 456, 8, 222, 162, 235, 235, 0.72);
    drawLogicSea(ox, oy, 30, 204, 220, 278, 154);
    drawLogicSea(ox, oy, 262, 204, 220, 278, 140);
    fillBlock(ox, oy, 252, 204, 8, 278, 218, 170, 20, 230, 0.62);
  }

  // === TILE (2,0): SYSTEM-LEVEL CACHE (SLC — iconic uniform 6T SRAM banks) ===
  {
    const ox = 1024;
    const oy = 0;
    drawGuardRing(ox, oy, 84);
    drawSramArray(ox, oy, 30, 30, 452, 214, 8, 3, 76, true);
    fillBlock(ox, oy, 28, 250, 456, 12, 235, 145, 235, 245, 0.80);
    drawSramArray(ox, oy, 30, 268, 452, 214, 8, 3, 92, true);
  }

  // === TILE (3,0): APPLE GPU CORE (Symmetric 4-Quad TBDR Shader Array + Tile Memory) ===
  {
    const ox = 1536;
    const oy = 0;
    drawGuardRing(ox, oy, 156);
    // 4 symmetric shader quadrants
    const qs: [number, number][] = [
      [30, 30],
      [264, 30],
      [30, 264],
      [264, 264],
    ];
    for (let qi = 0; qi < qs.length; qi++) {
      const [qx, qy] = qs[qi];
      drawLogicSea(ox, oy, qx, qy, 218, 134, 152 + qi * 10);
      drawSramArray(ox, oy, qx, qy + 140, 218, 78, 4, 2, 108 + qi * 8, false);
    }
    // Crisp cross-quad TBDR coherent bus
    fillBlock(ox, oy, 250, 28, 10, 456, 232, 185, 20, 242, 0.72);
    fillBlock(ox, oy, 28, 250, 456, 10, 232, 185, 235, 242, 0.72);
  }

  // === TILE (0,1): 16-CORE NEURAL ENGINE (Crisp Systolic MAC Matrix Grid) ===
  {
    const ox = 0;
    const oy = 512;
    drawGuardRing(ox, oy, 174);
    const grid = 8;
    const pad = 32;
    const step = (T - pad * 2) / grid;
    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        const cx = pad + c * step;
        const cy = pad + r * step;
        fillBlock(ox, oy, cx + 4, cy + 4, step - 8, step - 8, 188 + ((r + c) % 2) * 18, 168 + ((r * 3 + c) % 4) * 10, (r & 1) ? 35 : 220, 218, 0.34);
        // Inner MAC accumulator sub-tile
        fillBlock(ox, oy, cx + 12, cy + 12, step - 24, step - 24, 224, 198, 128, 236, 0.52);
      }
      // Weight-broadcast horizontal & vertical systolic bus hairlines
      fillBlock(ox, oy, pad, pad + r * step, T - pad * 2, 2, 210, 140, 235, 225, 0.48);
      fillBlock(ox, oy, pad + r * step, pad, 2, T - pad * 2, 210, 140, 20, 225, 0.48);
    }
  }

  // === TILE (1,1): DISPLAY & PRORES MEDIA ENGINE (Dual Codec Pipelines + Buffers) ===
  {
    const ox = 512;
    const oy = 512;
    drawGuardRing(ox, oy, 112);
    drawSramArray(ox, oy, 30, 30, 160, 212, 3, 4, 94, true);
    drawLogicSea(ox, oy, 198, 30, 284, 212, 134);
    fillBlock(ox, oy, 28, 250, 456, 10, 228, 164, 235, 238, 0.72);
    drawLogicSea(ox, oy, 30, 268, 284, 214, 146);
    drawSramArray(ox, oy, 322, 268, 160, 214, 3, 4, 108, true);
  }

  // === TILE (2,1): THUNDERBOLT / USB4 I/O PHY (SerDes Lanes + Planar Spiral Inductors) ===
  {
    const ox = 1024;
    const oy = 512;
    drawGuardRing(ox, oy, 188);
    // Serpentine high-speed differential SerDes lanes on bottom half
    for (let i = 0; i < 18; i++) {
      const lx = 34 + i * 25;
      fillBlock(ox, oy, lx, 258, 7, 222, 208, 192, 20, 232, 0.55);
      fillBlock(ox, oy, lx + 11, 258, 7, 222, 182, 176, 20, 210, 0.32);
    }
    // 4 Planar Octagonal LC-Tank Spiral Inductors (iconic on real RF/SerDes die shots!)
    const drawSpiral = (cx: number, cy: number, maxR: number) => {
      hCtx.strokeStyle = '#ececec';
      hCtx.lineWidth = 4.5;
      fCtx.strokeStyle = 'rgba(218, 128, 245, 0.65)';
      fCtx.lineWidth = 4.5;
      for (let ring = maxR; ring >= 16; ring -= 11) {
        for (const ctx of [hCtx, fCtx]) {
          ctx.beginPath();
          for (let s = 0; s <= 8; s++) {
            const ang = (s / 8) * Math.PI * 2 + Math.PI / 8;
            const px = ox + cx + Math.cos(ang) * ring;
            const py = oy + cy + Math.sin(ang) * ring;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
    };
    drawSpiral(108, 136, 62);
    drawSpiral(256, 136, 62);
    drawSpiral(404, 136, 62);
    fillBlock(ox, oy, 30, 226, 452, 14, 216, 158, 235, 228, 0.60);
  }

  // === TILE (3,1): MAIN DIE SLAB (Sleek Mirror Bare Silicon + Metallic Seal Ring & Corner Verniers) ===
  {
    const ox = 1536;
    const oy = 512;
    // Ultra-subtle microscopic CMP metal-fill shimmer (flat mirror bare silicon, zero chunky dots!)
    fillBlock(ox, oy, 20, 20, T - 40, T - 40, 88, 108, 128, 118, 0.0);
    for (let y = 26; y < T - 26; y += 8) {
      for (let x = 26; x < T - 26; x += 8) {
        if (((x + y) & 8) === 0) {
          fillBlock(ox, oy, x, y, 2, 2, 95 + (rng() - 0.5) * 6, 110 + (rng() - 0.5) * 8, 128, 128, 0.0);
        }
      }
    }
    // Razor-sharp metallic perimeter seal ring & dicing street border
    fillBlock(ox, oy, 4, 4, T - 8, 7, 236, 210, 235, 248, 0.12);
    fillBlock(ox, oy, 4, T - 11, T - 8, 7, 236, 210, 235, 248, 0.12);
    fillBlock(ox, oy, 4, 4, 7, T - 8, 236, 210, 20, 248, 0.12);
    fillBlock(ox, oy, T - 11, 4, 7, T - 8, 236, 210, 20, 248, 0.12);
    // Secondary inner seal moat + litho alignment crosses at 4 corners
    fillBlock(ox, oy, 15, 15, T - 30, 2.5, 204, 190, 235, 228, 0.06);
    fillBlock(ox, oy, 15, T - 17.5, T - 30, 2.5, 204, 190, 235, 228, 0.06);
    fillBlock(ox, oy, 15, 15, 2.5, T - 30, 204, 190, 20, 228, 0.06);
    fillBlock(ox, oy, T - 17.5, 15, 2.5, T - 30, 204, 190, 20, 228, 0.06);

    const corners: [number, number][] = [
      [32, 32],
      [T - 32, 32],
      [32, T - 32],
      [T - 32, T - 32],
    ];
    for (const [cx, cy] of corners) {
      fillBlock(ox, oy, cx - 9, cy - 1.5, 18, 3, 228, 218, 235, 245, 0.10);
      fillBlock(ox, oy, cx - 1.5, cy - 9, 3, 18, 228, 218, 20, 245, 0.10);
    }
  }

  // Extract height & feature buffers and derive crisp Sobel normals + cavity AO + roughness
  const hPixels = hCtx.getImageData(0, 0, W, H).data;
  const fPixels = fCtx.getImageData(0, 0, W, H).data;
  const height = new Float32Array(W * H);
  const roughBuf = new Float32Array(W * H);

  for (let i = 0; i < W * H; i++) {
    const hv = hPixels[i * 4] / 255.0;
    const refl = fPixels[i * 4 + 2] / 255.0;
    height[i] = hv;
    // Mirror silicon base is ultra-smooth (~0.06), dense etched logic regions slightly satin (~0.18)
    roughBuf[i] = clamp(0.055 + (1.0 - refl) * 0.10 + Math.abs(hv - 0.5) * 0.08, 0.045, 0.26);
  }

  const normData = buildReliefFromHeight(height, W, H, 0.62, 0.45, false, roughBuf);

  return {
    litho: { width: W, height: H, data: new Uint8Array(fPixels.buffer) },
    norm: { width: W, height: H, data: normData },
  };
}

/**
 * Vector-Bake 1024x1024 World 0 ABF Organic Package Substrate Map
 * aligned 1:1 with the interposer box (halfSize = [5.42, 3.44]):
 *   - Woven fiberglass cloth micro-texture
 *   - Buried copper ground-plane crosshatch
 *   - Authentic 45-degree differential escape fan-out traces (Die -> 4x LPDDR5 + SMD Caps)
 *   - ENIG gold micro-via annular rings & test pads
 */
function bakeAbfSubstrateMaps(): { map: TextureBuffer; norm: TextureBuffer } {
  const S = 1024;
  const HALF_X = 5.42;
  const HALF_Z = 3.44;
  const toPxX = (wx: number) => ((wx / HALF_X) * 0.5 + 0.5) * S;
  const toPxZ = (wz: number) => ((wz / HALF_Z) * 0.5 + 0.5) * S;

  // Trace + ENIG pad vector canvas
  const tCanvas = document.createElement('canvas');
  tCanvas.width = S;
  tCanvas.height = S;
  const tCtx = tCanvas.getContext('2d')!;
  tCtx.fillStyle = '#000000';
  tCtx.fillRect(0, 0, S, S);

  // 1) Buried copper ground-plane mesh hatch (subtle blue-channel-like low-amplitude relief)
  tCtx.strokeStyle = 'rgb(42, 0, 0)';
  tCtx.lineWidth = 1.0;
  for (let i = -S; i < S * 2; i += 14) {
    tCtx.beginPath();
    tCtx.moveTo(i, 0);
    tCtx.lineTo(i + S, S);
    tCtx.stroke();
    tCtx.beginPath();
    tCtx.moveTo(i, S);
    tCtx.lineTo(i + S, 0);
    tCtx.stroke();
  }

  // 2) Authentic 45-degree differential escape traces from Die (±3.06) -> 4x LPDDR5 (±3.46..±4.98)
  tCtx.lineCap = 'round';
  tCtx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const xDie = toPxX(side * 3.00);
    const xJog1 = toPxX(side * 3.24);
    const xJog2 = toPxX(side * 3.40);
    const xRam = toPxX(side * 3.74);

    for (const row of [-1, 1]) {
      const zCenter = row * 1.28;
      // 32 dense parallel memory byte-lane traces per LPDDR5 package with 45-degree fan-out!
      for (let i = 0; i < 32; i++) {
        const t = i / 31 - 0.5; // [-0.5 .. +0.5]
        const zStart = toPxZ(zCenter + t * 1.92);
        const zEnd = toPxZ(zCenter + t * 2.18);
        const isPairA = (i & 1) === 0;
        tCtx.strokeStyle = isPairA ? 'rgb(235, 0, 230)' : 'rgb(205, 0, 195)';
        tCtx.lineWidth = 1.7;
        tCtx.beginPath();
        tCtx.moveTo(xDie, zStart);
        tCtx.lineTo(xJog1, zStart);
        tCtx.lineTo(xJog2, zEnd);
        tCtx.lineTo(xRam, zEnd);
        tCtx.stroke();
      }
    }
  }

  // 3) Top & bottom power/decoupling fan-out traces from Die (±2.48) -> SMD capacitors (±2.86)
  for (const side of [-1, 1]) {
    const zDie = toPxZ(side * 2.44);
    const zMid = toPxZ(side * 2.66);
    const zCap = toPxZ(side * 2.94);
    for (let i = -26; i <= 26; i++) {
      const wx = i * 0.11;
      const px = toPxX(wx);
      const pxEnd = toPxX(wx * 1.03);
      tCtx.strokeStyle = 'rgb(215, 0, 95)';
      tCtx.lineWidth = 2.0;
      tCtx.beginPath();
      tCtx.moveTo(px, zDie);
      tCtx.lineTo(px, zMid);
      tCtx.lineTo(pxEnd, zCap);
      tCtx.stroke();
    }
  }

  // 4) ENIG Gold micro-via annular rings & perimeter test pads (stored in Green channel!)
  const drawViaRing = (wx: number, wz: number, rOuter: number, rInner: number) => {
    const px = toPxX(wx);
    const py = toPxZ(wz);
    tCtx.fillStyle = 'rgb(180, 245, 0)';
    tCtx.beginPath();
    tCtx.arc(px, py, rOuter, 0, Math.PI * 2);
    tCtx.fill();
    tCtx.fillStyle = 'rgb(24, 30, 0)';
    tCtx.beginPath();
    tCtx.arc(px, py, rInner, 0, Math.PI * 2);
    tCtx.fill();
  };

  // Perimeter via rows + corner test pad clusters
  for (let i = -18; i <= 18; i++) {
    const wx = i * 0.27;
    drawViaRing(wx, -3.14, 3.2, 1.4);
    drawViaRing(wx, 3.14, 3.2, 1.4);
  }
  for (let i = -9; i <= 9; i++) {
    const wz = i * 0.31;
    drawViaRing(-5.16, wz, 3.2, 1.4);
    drawViaRing(5.16, wz, 3.2, 1.4);
  }
  // Subtle perimeter copper ground-guard border around interposer edge
  tCtx.strokeStyle = 'rgb(155, 110, 0)';
  tCtx.lineWidth = 3.0;
  tCtx.strokeRect(14, 14, S - 28, S - 28);

  // 5) Crisp matte silver-white ABF substrate silkscreen markings (encoded as R=0, G=235 so shader separates silkscreen from ENIG gold!)
  tCtx.fillStyle = 'rgb(0, 238, 0)';
  tCtx.font = '600 13px "SF Mono", "JetBrains Mono", Menlo, monospace';
  tCtx.textBaseline = 'middle';
  tCtx.textAlign = 'left';
  tCtx.fillText('APL1105  TSMC N3E', toPxX(-4.65), toPxZ(-2.86));
  tCtx.textAlign = 'right';
  tCtx.fillText('REV 2.1   2442-TW', toPxX(4.65), toPxZ(2.86));
  // Pin-1 silkscreen orientation chevron next to corner gold marker
  tCtx.beginPath();
  tCtx.moveTo(toPxX(-4.84), toPxZ(-3.16));
  tCtx.lineTo(toPxX(-4.70), toPxZ(-3.16));
  tCtx.lineTo(toPxX(-4.84), toPxZ(-3.00));
  tCtx.closePath();
  tCtx.fill();

  const tPixels = tCtx.getImageData(0, 0, S, S).data;
  const mapData = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const p4 = i * 4;
      const trace = tPixels[p4] / 255.0;
      const enig = tPixels[p4 + 1] / 255.0;
      const busMask = tPixels[p4 + 2] / 255.0;

      // Fine fiberglass cloth micro-weave (authentic ABF resin laminate pattern)
      const wx = Math.sin(x * 0.78) * 0.5 + 0.5;
      const wy = Math.sin(y * 0.78) * 0.5 + 0.5;
      const checker = ((Math.floor(x * 0.25) + Math.floor(y * 0.25)) & 1) === 0 ? wx : wy;
      const weave = 0.35 + 0.65 * checker;

      mapData[p4] = clampByte(trace * 255);
      mapData[p4 + 1] = clampByte(enig * 255);
      mapData[p4 + 2] = clampByte(weave * 255);
      mapData[p4 + 3] = clampByte(busMask * 255);

      // Embossed height: copper traces subtly raise the solder mask; ENIG rings stand crisp
      height[i] = clamp(0.28 + weave * 0.08 + trace * 0.44 + enig * 0.24, 0, 1);
    }
  }

  const normData = buildReliefFromHeight(height, S, S, 0.72, 0.58, false);
  return {
    map: { width: S, height: S, data: mapData },
    norm: { width: S, height: S, data: normData },
  };
}

/**
 * Vector-Bake 512x512 LPDDR5 Top Laser-Etch Marking Decal:
 *   R = laser-ablated matte contrast mask (0..1)
 *   G = Pin-1 recessed dimple depth mask (0..1)
 *   B = tangent normal X (0..255, 128 = flat)
 *   A = tangent normal Z (0..255, 128 = flat)
 */
function bakeRamDecalMap(): TextureBuffer {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, S, S);

  // Subtle precision laser perimeter border
  ctx.strokeStyle = 'rgba(205, 0, 0, 1)';
  ctx.lineWidth = 3.0;
  ctx.strokeRect(24, 24, S - 48, S - 48);

  // Minimalist Apple-style clean laser-etched IC typography
  ctx.fillStyle = 'rgb(218, 0, 0)';
  ctx.font = '600 28px "SF Mono", "JetBrains Mono", Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('LPDDR5', 56, 178);

  ctx.fillStyle = 'rgb(168, 0, 0)';
  ctx.font = '500 17px "SF Mono", "JetBrains Mono", Menlo, monospace';
  ctx.fillText('H9JCNNNFA5MLYR', 56, 214);
  ctx.fillText('NEE  6400  2442', 56, 240);

  // Crisp 2D laser DataMatrix fiducial code in lower-right corner
  const rng = mulberry32(99104);
  const dmX = 356;
  const dmY = 342;
  const dmCell = 8;
  const dmN = 12;
  ctx.fillStyle = 'rgb(198, 0, 0)';
  for (let r = 0; r < dmN; r++) {
    for (let col = 0; col < dmN; col++) {
      const isBorder = r === dmN - 1 || col === 0 || (r === 0 && (col & 1) === 0) || (col === dmN - 1 && (r & 1) === 1);
      if (isBorder || rng() > 0.48) {
        ctx.fillRect(dmX + col * dmCell, dmY + r * dmCell, dmCell - 1, dmCell - 1);
      }
    }
  }

  // Pin-1 circular laser-milled recessed dimple in top-left corner (stored in Green channel!)
  const p1X = 76;
  const p1Y = 76;
  const p1R = 22;
  const grad = ctx.createRadialGradient(p1X, p1Y, 2, p1X, p1Y, p1R);
  grad.addColorStop(0.0, 'rgba(120, 255, 0, 1)');
  grad.addColorStop(0.72, 'rgba(90, 210, 0, 1)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p1X, p1Y, p1R, 0, Math.PI * 2);
  ctx.fill();

  const raw = ctx.getImageData(0, 0, S, S).data;
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const laser = raw[i * 4] / 255.0;
    const dimple = raw[i * 4 + 1] / 255.0;
    height[i] = clamp(0.8 - laser * 0.14 - dimple * 0.62, 0, 1);
  }
  const relief = buildReliefFromHeight(height, S, S, 0.78, 0.95, false);

  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const p4 = i * 4;
    out[p4] = raw[p4];         // laser-etch albedo/roughness mask
    out[p4 + 1] = raw[p4 + 1]; // Pin-1 dimple mask
    out[p4 + 2] = relief[p4];     // normal X
    out[p4 + 3] = relief[p4 + 1]; // normal Z
  }
  return { width: S, height: S, data: out };
}

/**
 * Bake a high-contrast 512x256 RGBM HDR Dark-Studio Softbox + Negative-Fill Environment Map
 * with 7 roughness-prefiltered mip levels (512x256 -> 8x4).
 *
 * Crisp softbox edges bordered by black negative-fill cards give mirror silicon and bare metals
 * razor-sharp dark-to-bright specular transitions that soft math blobs cannot match.
 */
function bakeStudioEnvMipmaps(): TextureBuffer[] {
  const W0 = 512;
  const H0 = 256;
  const hdr0 = new Float32Array(W0 * H0 * 3);

  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Helper: evaluate sharp rectangular studio softbox projected onto unit direction
  const rectSoftbox = (
    dx: number,
    dy: number,
    dz: number,
    cx: number,
    cy: number,
    cz: number,
    ux: number,
    uy: number,
    uz: number,
    vx: number,
    vy: number,
    vz: number,
    hw: number,
    hh: number,
    edge: number
  ): number => {
    const dotC = dx * cx + dy * cy + dz * cz;
    if (dotC <= 0.12) return 0;
    const px = (dx * ux + dy * uy + dz * uz) / dotC;
    const py = (dx * vx + dy * vy + dz * vz) / dotC;
    const mx = 1.0 - smoothstep(hw - edge, hw + edge, Math.abs(px));
    const my = 1.0 - smoothstep(hh - edge, hh + edge, Math.abs(py));
    // Subtle authentic softbox diffuser center hotspot
    const centerFalloff = 0.78 + 0.22 * (1.0 - clamp((px * px) / (hw * hw + 0.01) * 0.4 + (py * py) / (hh * hh + 0.01) * 0.4, 0, 1));
    return mx * my * centerFalloff;
  };

  for (let y = 0; y < H0; y++) {
    const v = (y + 0.5) / H0;
    const theta = v * Math.PI; // 0 = +Y zenith, PI = -Y nadir
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let x = 0; x < W0; x++) {
      const u = (x + 0.5) / W0;
      const phi = (u - 0.5) * Math.PI * 2;
      const dx = sinT * Math.cos(phi);
      const dy = cosT;
      const dz = sinT * Math.sin(phi);

      // Base dark obsidian studio cyclorama gradient
      const upMix = smoothstep(-0.14, 0.55, dy);
      const zenMix = smoothstep(0.0, 0.88, dy);
      let r = 0.005 + upMix * (0.010 + zenMix * 0.018);
      let g = 0.007 + upMix * (0.014 + zenMix * 0.026);
      let b = 0.012 + upMix * (0.024 + zenMix * 0.044);

      // 1) Crisp overhead key softbox (warm-neutral studio daylight, HDR peak ~4.8)
      const kLen = Math.hypot(0.28, 0.92, 0.26);
      const key = rectSoftbox(
        dx, dy, dz,
        0.28 / kLen, 0.92 / kLen, 0.26 / kLen,
        0.74, -0.14, -0.66,
        -0.55, 0.36, -0.75,
        0.34, 0.20, 0.022
      );
      r += 4.6 * key;
      g += 4.45 * key;
      b += 4.25 * key;

      // 2) Dual razor-sharp Apple-keynote architectural lightbars separated by a black negative-fill gap!
      const barAxis = dx * 0.62 - dz * 0.78;
      const barMaskY = smoothstep(0.26, 0.34, dy) * (1.0 - smoothstep(0.84, 0.90, dy));
      const bar1 = (1.0 - smoothstep(0.048, 0.062, Math.abs(barAxis - 0.16))) * barMaskY;
      const bar2 = (1.0 - smoothstep(0.032, 0.044, Math.abs(barAxis + 0.42))) * barMaskY;
      // Negative fill black flag right between bar1 and bar2 for knife-edge metallic contrast!
      const negFlag = (1.0 - smoothstep(0.10, 0.14, Math.abs(barAxis + 0.12))) * smoothstep(0.12, 0.32, dy);
      r *= 1.0 - negFlag * 0.82;
      g *= 1.0 - negFlag * 0.82;
      b *= 1.0 - negFlag * 0.82;

      r += 2.65 * bar1 + 1.35 * bar2;
      g += 2.85 * bar1 + 1.95 * bar2;
      b += 3.20 * bar1 + 2.85 * bar2;

      // 3) Crisp cool platinum-sapphire side rim reflector (left-back)
      const rLen = Math.hypot(-0.78, 0.44, -0.44);
      const rim = rectSoftbox(
        dx, dy, dz,
        -0.78 / rLen, 0.44 / rLen, -0.44 / rLen,
        -0.49, 0.0, 0.87,
        0.38, 0.90, 0.21,
        0.42, 0.24, 0.028
      );
      r += 1.05 * rim;
      g += 1.95 * rim;
      b += 3.45 * rim;

      // 4) Warm tungsten-copper counter-fill strip (right-back)
      const wLen = Math.hypot(0.76, 0.34, -0.55);
      const warm = rectSoftbox(
        dx, dy, dz,
        0.76 / wLen, 0.34 / wLen, -0.55 / wLen,
        0.59, 0.0, 0.81,
        -0.28, 0.94, 0.20,
        0.34, 0.18, 0.028
      );
      r += 2.95 * warm;
      g += 1.78 * warm;
      b += 0.85 * warm;

      // 5) Subtle horizon silver studio fill band (catches vertical chamfers and chip sidewalls!)
      const horizBand = Math.exp(-Math.pow((dy - 0.09) / 0.055, 2.0)) * (0.45 + 0.55 * Math.cos(phi * 2.0 + 0.6));
      r += 0.34 * horizBand;
      g += 0.40 * horizBand;
      b += 0.50 * horizBand;

      const idx = (y * W0 + x) * 3;
      hdr0[idx] = r;
      hdr0[idx + 1] = g;
      hdr0[idx + 2] = b;
    }
  }

  const encodeRgbM = (hdr: Float32Array, w: number, h: number): TextureBuffer => {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const r = hdr[i * 3] / ENV_RGBM_RANGE;
      const g = hdr[i * 3 + 1] / ENV_RGBM_RANGE;
      const b = hdr[i * 3 + 2] / ENV_RGBM_RANGE;
      let m = Math.max(r, g, b, 1e-6);
      m = clamp(Math.ceil(m * 255) / 255, 1 / 255, 1.0);
      const p4 = i * 4;
      out[p4] = clampByte((r / m) * 255);
      out[p4 + 1] = clampByte((g / m) * 255);
      out[p4 + 2] = clampByte((b / m) * 255);
      out[p4 + 3] = clampByte(m * 255);
    }
    return { width: w, height: h, data: out };
  };

  // Downsample + separable Gaussian prefilter per mip level (simulates progressive GGX lobe widening!)
  const blurPass = (src: Float32Array, w: number, h: number, radius: number): Float32Array => {
    const tmp = new Float32Array(w * h * 3);
    const dst = new Float32Array(w * h * 3);
    const sigma = Math.max(0.65, radius * 0.52);
    const weights: number[] = [];
    let wSum = 0;
    for (let k = -radius; k <= radius; k++) {
      const wt = Math.exp(-(k * k) / (2 * sigma * sigma));
      weights.push(wt);
      wSum += wt;
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= wSum;

    // Horizontal (toroidal azimuth wrap)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = ((x + k) % w + w) % w;
          const wt = weights[k + radius];
          const si = (y * w + sx) * 3;
          r += src[si] * wt;
          g += src[si + 1] * wt;
          b += src[si + 2] * wt;
        }
        const di = (y * w + x) * 3;
        tmp[di] = r;
        tmp[di + 1] = g;
        tmp[di + 2] = b;
      }
    }
    // Vertical (clamped pole)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = clamp(y + k, 0, h - 1);
          const wt = weights[k + radius];
          const si = (sy * w + x) * 3;
          r += tmp[si] * wt;
          g += tmp[si + 1] * wt;
          b += tmp[si + 2] * wt;
        }
        const di = (y * w + x) * 3;
        dst[di] = r;
        dst[di + 1] = g;
        dst[di + 2] = b;
      }
    }
    return dst;
  };

  const mips: TextureBuffer[] = [];
  let cur: Float32Array = hdr0;
  let cw = W0;
  let ch = H0;
  // 7 mip levels: 512x256, 256x128, 128x64, 64x32, 32x16, 16x8, 8x4
  for (let level = 0; level < 7; level++) {
    mips.push(encodeRgbM(cur, cw, ch));
    if (level === 6) break;
    const nw = Math.max(1, cw >> 1);
    const nh = Math.max(1, ch >> 1);
    const down = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const i00 = (y * 2 * cw + x * 2) * 3;
        const i10 = (y * 2 * cw + x * 2 + 1) * 3;
        const i01 = ((y * 2 + 1) * cw + x * 2) * 3;
        const i11 = ((y * 2 + 1) * cw + x * 2 + 1) * 3;
        const di = (y * nw + x) * 3;
        down[di] = (cur[i00] + cur[i10] + cur[i01] + cur[i11]) * 0.25;
        down[di + 1] = (cur[i00 + 1] + cur[i10 + 1] + cur[i01 + 1] + cur[i11 + 1]) * 0.25;
        down[di + 2] = (cur[i00 + 2] + cur[i10 + 2] + cur[i01 + 2] + cur[i11 + 2]) * 0.25;
      }
    }
    cur = blurPass(down, nw, nh, level < 2 ? 2 : 3);
    cw = nw;
    ch = nh;
  }

  return mips;
}

/** Build all synchronous vector-baked chip textures + initial material-array placeholders. */
export function createChipTexturePack(): ChipTexturePack {
  const placeholders = buildPlaceholderMaterialArray();
  const die = bakeDieLithographyAtlas();
  const abf = bakeAbfSubstrateMaps();
  const ramDecal = bakeRamDecalMap();
  const envMips = bakeStudioEnvMipmaps();

  return {
    matArraySize: MAT_ARRAY_SIZE,
    matArrayLayers: MAT_ARRAY_LAYERS,
    matAlbedoInit: placeholders.albedo,
    matReliefInit: placeholders.relief,
    dieLitho: die.litho,
    dieNorm: die.norm,
    abfMap: abf.map,
    abfNorm: abf.norm,
    ramDecal,
    envMips,
  };
}

/** Asynchronously decode and process all 4 seamless macro material photographs (1 per frame for zero stutter). */
export function loadMacroMaterialLayers(onLayerReady: (update: MaterialArrayLayerUpdate) => void): void {
  const sources: readonly [number, string][] = [
    [0, epoxyImgUrl],
    [1, copperImgUrl],
    [2, titaniumImgUrl],
    [3, semSiliconImgUrl],
  ];

  const queue: { layer: number; img: HTMLImageElement }[] = [];
  let draining = false;

  const drainNext = () => {
    const item = queue.shift();
    if (!item) {
      draining = false;
      return;
    }
    const pbr = processMacroMaterialImage(item.img, item.layer);
    onLayerReady({ layer: item.layer, albedo: pbr.albedo, relief: pbr.relief });
    if (queue.length > 0) {
      window.setTimeout(() => requestAnimationFrame(drainNext), 16);
    } else {
      draining = false;
    }
  };

  for (const [layer, url] of sources) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if ((img.naturalWidth || img.width) < 32) return;
      queue.push({ layer, img });
      if (!draining) {
        draining = true;
        requestAnimationFrame(drainNext);
      }
    };
    img.src = url;
  }
}
