/**
 * Smooth logarithmic magnification & physical scale formatter across zoom [0..4]:
 *   0.0 => 10x        · 12.0 mm  (Die)
 *   1.0 => 2.5K x     · 60 um    (Striations)
 *   2.0 => 250K x     · 800 nm   (Canyons)
 *   3.0 => 8M x       · 25 nm    (Grid)
 *   4.0 => 100M x     · 3.0 nm   (3 nm GAA)
 */
export function formatMagnification(uZoom: number): { magText: string; sizeText: string; dialDeg: number } {
  const z = Math.max(0, Math.min(4, uZoom));
  const magKnots = [10, 2500, 250_000, 8_000_000, 100_000_000];
  const nmKnots = [12_000_000, 60_000, 800, 25, 3];

  const i0 = Math.min(3, Math.floor(z));
  const f = z - i0;
  const mag = Math.exp(Math.log(magKnots[i0]) * (1 - f) + Math.log(magKnots[i0 + 1]) * f);
  const nm = Math.exp(Math.log(nmKnots[i0]) * (1 - f) + Math.log(nmKnots[i0 + 1]) * f);

  let magText: string;
  if (mag >= 1_000_000) magText = `${(mag / 1_000_000).toFixed(mag >= 10_000_000 ? 0 : 1)}M×`;
  else if (mag >= 1_000) magText = `${(mag / 1_000).toFixed(mag >= 10_000 ? 0 : 1)}K×`;
  else magText = `${Math.round(mag)}×`;

  let sizeText: string;
  if (nm >= 1_000_000) sizeText = `${(nm / 1_000_000).toFixed(1)} mm`;
  else if (nm >= 1_000) sizeText = `${Math.round(nm / 1_000)} µm`;
  else if (nm >= 10) sizeText = `${Math.round(nm)} nm`;
  else sizeText = `${nm.toFixed(1)} nm`;

  const dialDeg = z * 68;
  return { magText, sizeText, dialDeg };
}
