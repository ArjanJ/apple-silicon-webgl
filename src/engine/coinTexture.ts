import quarterImgUrl from '../assets/us-quarter-obverse.jpg';

/**
 * Photorealistic 1024x1024 US Quarter Dollar PBR Texture Pipeline.
 *
 * Loads the high-resolution orthographic studio macro photograph of a real 2024-P
 * US Quarter obverse, auto-crops its circular rim pixel-perfectly edge-to-edge (with
 * radial rim clamping so zero dark fringe bleeds onto the 3D beveled edge), and derives:
 *   1) Albedo + Roughness (RGBA8): calibrated cupronickel albedo + micro-roughness mask
 *   2) Multi-Scale Relief Normal + Cavity AO (RGBA8): tangent-space normals combining
 *      1-px fine lettering/micro-scratch detail with 3-px sculptural bas-relief depth.
 */

export interface QuarterTextureBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface QuarterPbrTextures {
  albedo: QuarterTextureBuffer;
  relief: QuarterTextureBuffer;
}

const TEX_SIZE = 1024;

/** Instant synchronous brushed cupronickel placeholder shown for the first ~3 ms while the JPG decodes. */
export function createPlaceholderQuarterTextures(): QuarterPbrTextures {
  const w = 64;
  const h = 64;
  const albedo = new Uint8Array(w * h * 4);
  const relief = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    albedo[p] = 186;
    albedo[p + 1] = 183;
    albedo[p + 2] = 176;
    albedo[p + 3] = 72;

    relief[p] = 128;
    relief[p + 1] = 128;
    relief[p + 2] = 255;
    relief[p + 3] = 128;
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    relief: { width: w, height: h, data: relief },
  };
}

/**
 * Loads the orthographic US Quarter image and derives crisp PBR Albedo/Roughness
 * and multi-scale Normal/Cavity-AO maps on an offscreen canvas.
 */
export function loadQuarterPbrTextures(onReady: (textures: QuarterPbrTextures) => void): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW < 64 || srcH < 64) return;

    // 1) Read source pixels and auto-detect exact circular coin bounds against the pure-black backdrop
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.drawImage(img, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

    let minX = srcW;
    let maxX = 0;
    let minY = srcH;
    let maxY = 0;
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const idx = (y * srcW + x) * 4;
        const lum = srcData[idx] * 0.299 + srcData[idx + 1] * 0.587 + srcData[idx + 2] * 0.114;
        if (lum > 30) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Inset slightly by 2px so the outer metallic rim sits 100% flush with zero black edge bleed
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const rad = Math.max(10, Math.min(maxX - minX, maxY - minY) * 0.5 - 2.0);

    // 2) Draw tightly cropped & centered onto 1024x1024 working canvas
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = TEX_SIZE;
    dstCanvas.height = TEX_SIZE;
    const dstCtx = dstCanvas.getContext('2d')!;
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(img, cx - rad, cy - rad, rad * 2, rad * 2, 0, 0, TEX_SIZE, TEX_SIZE);

    const raw = dstCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;

    // 3) Radially clamp outer corners outside r = 0.988 to the clean metallic rim color (eliminates black mipmap bleed!)
    const half = TEX_SIZE * 0.5;
    const lumBuf = new Float32Array(TEX_SIZE * TEX_SIZE);
    const cleanRgb = new Uint8Array(TEX_SIZE * TEX_SIZE * 3);

    for (let y = 0; y < TEX_SIZE; y++) {
      const dy = (y + 0.5 - half) / half;
      for (let x = 0; x < TEX_SIZE; x++) {
        const dx = (x + 0.5 - half) / half;
        const r = Math.hypot(dx, dy);
        let sx = x;
        let sy = y;
        if (r > 0.985) {
          const scale = 0.982 / Math.max(r, 0.0001);
          sx = Math.max(0, Math.min(TEX_SIZE - 1, Math.round(half + dx * scale * half)));
          sy = Math.max(0, Math.min(TEX_SIZE - 1, Math.round(half + dy * scale * half)));
        }
        const sIdx = (sy * TEX_SIZE + sx) * 4;
        const d3 = (y * TEX_SIZE + x) * 3;
        const R = raw[sIdx];
        const G = raw[sIdx + 1];
        const B = raw[sIdx + 2];
        cleanRgb[d3] = R;
        cleanRgb[d3 + 1] = G;
        cleanRgb[d3 + 2] = B;
        lumBuf[y * TEX_SIZE + x] = (R * 0.299 + G * 0.587 + B * 0.114) / 255.0;
      }
    }

    // 4) Build smoothed height buffer (3x3 separable box blur) for broad sculptural relief & cavity AO
    const blurH = new Float32Array(TEX_SIZE * TEX_SIZE);
    const blurV = new Float32Array(TEX_SIZE * TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
      const row = y * TEX_SIZE;
      for (let x = 0; x < TEX_SIZE; x++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const xx = Math.max(0, Math.min(TEX_SIZE - 1, x + k));
          sum += lumBuf[row + xx];
        }
        blurH[row + x] = sum * 0.2;
      }
    }
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const yy = Math.max(0, Math.min(TEX_SIZE - 1, y + k));
          sum += blurH[yy * TEX_SIZE + x];
        }
        blurV[y * TEX_SIZE + x] = sum * 0.2;
      }
    }

    // 5) Pack Albedo+Roughness and Multi-Scale Tangent Normal+Cavity AO
    const albedoData = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
    const reliefData = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);

    const sampleLum = (buf: Float32Array, x: number, y: number): number => {
      const cx2 = Math.max(0, Math.min(TEX_SIZE - 1, x));
      const cy2 = Math.max(0, Math.min(TEX_SIZE - 1, y));
      return buf[cy2 * TEX_SIZE + cx2];
    };

    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const i = y * TEX_SIZE + x;
        const p4 = i * 4;
        const p3 = i * 3;

        // Multi-scale Sobel gradient (fine 1-px micro-detail + broad 3-px bas-relief)
        const gxFine =
          sampleLum(lumBuf, x + 1, y - 1) +
          2 * sampleLum(lumBuf, x + 1, y) +
          sampleLum(lumBuf, x + 1, y + 1) -
          (sampleLum(lumBuf, x - 1, y - 1) +
            2 * sampleLum(lumBuf, x - 1, y) +
            sampleLum(lumBuf, x - 1, y + 1));
        const gzFine =
          sampleLum(lumBuf, x - 1, y + 1) +
          2 * sampleLum(lumBuf, x, y + 1) +
          sampleLum(lumBuf, x + 1, y + 1) -
          (sampleLum(lumBuf, x - 1, y - 1) +
            2 * sampleLum(lumBuf, x, y - 1) +
            sampleLum(lumBuf, x + 1, y - 1));

        const gxBroad =
          sampleLum(blurV, x + 3, y) - sampleLum(blurV, x - 3, y);
        const gzBroad =
          sampleLum(blurV, x, y + 3) - sampleLum(blurV, x, y - 3);

        // Combine gradients (outward normal tilts away from rising height)
        const nx = Math.max(-1, Math.min(1, -(gxFine * 0.55 + gxBroad * 1.65)));
        const nz = Math.max(-1, Math.min(1, -(gzFine * 0.55 + gzBroad * 1.65)));
        const slopeMag = Math.hypot(nx, nz);

        // Local cavity AO: crevices darker than neighborhood get subtle metallic patina darkening
        const lum = lumBuf[i];
        const localDiff = lum - blurV[i];
        const cavity = Math.max(0.42, Math.min(1.0, 0.88 + localDiff * 1.35 - slopeMag * 0.16));

        // Roughness: gleaming metallic field & smooth highlights = lower rough, frosted relief & recessed grime = higher rough
        const rough = Math.max(
          0.14,
          Math.min(0.55, 0.22 + (1.0 - lum) * 0.18 + slopeMag * 0.22 + Math.max(0, localDiff) * 0.12)
        );

        // Lift deep shadow lows slightly in albedo so real-time 3D lighting doesn't double-crush crevices
        const lift = (v: number) => Math.min(255, Math.round(v * 0.86 + 34));
        albedoData[p4] = lift(cleanRgb[p3]);
        albedoData[p4 + 1] = lift(cleanRgb[p3 + 1]);
        albedoData[p4 + 2] = lift(cleanRgb[p3 + 2]);
        albedoData[p4 + 3] = Math.round(rough * 255);

        reliefData[p4] = Math.round(nx * 127 + 128);
        reliefData[p4 + 1] = Math.round(nz * 127 + 128);
        reliefData[p4 + 2] = Math.round(cavity * 255);
        reliefData[p4 + 3] = Math.round(lum * 255);
      }
    }

    onReady({
      albedo: { width: TEX_SIZE, height: TEX_SIZE, data: albedoData },
      relief: { width: TEX_SIZE, height: TEX_SIZE, data: reliefData },
    });
  };
  img.src = quarterImgUrl;
}
