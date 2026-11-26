/**
 * Procedural Parametric Beveled Geometry for Hardware-Instanced WebGL2 Rendering.
 *
 * Key trick: Instead of baking a fixed bevel that distorts under non-uniform scaling,
 * every vertex stores (corner/anchor, unit bevel normal, flags) so the vertex shader
 * expands any instance (hx, hy, hz, bevelRadius) into an EXACT, undistorted analytical
 * chamfered/beveled box or cylinder with flat faces and smooth metallic edge highlights.
 */

export interface MeshBuffers {
  /** Interleaved float data: [aAnchor.xyz (3), aNorm.xyz (3)] = 6 floats per vertex */
  vertices: Float32Array;
  indices: Uint16Array;
  indexCount: number;
}

/**
 * Watertight parametric beveled box: 24 vertices, 44 triangles (132 indices).
 * Vertex attributes:
 *   aAnchor = octant sign (±1, ±1, ±1)
 *   aNorm   = axis normal ((sx,0,0), (0,sy,0), or (0,0,sz))
 * Vertex shader computes:
 *   r = min(bevelR, min(hx, min(hy, hz)) * 0.46)
 *   localPos = aAnchor * max(halfSize - r, 0) + aNorm * r
 */
export function createParametricBeveledBox(): MeshBuffers {
  // 8 octants: bit0 = +x, bit1 = +y, bit2 = +z
  // Each octant has 3 vertices:
  //   base + 0 => X-face vertex (norm = (sx, 0, 0))
  //   base + 1 => Y-face vertex (norm = (0, sy, 0))
  //   base + 2 => Z-face vertex (norm = (0, 0, sz))
  const verts: number[] = [];
  for (let oct = 0; oct < 8; oct++) {
    const sx = oct & 1 ? 1 : -1;
    const sy = oct & 2 ? 1 : -1;
    const sz = oct & 4 ? 1 : -1;
    // +0: X normal
    verts.push(sx, sy, sz, sx, 0, 0);
    // +1: Y normal
    verts.push(sx, sy, sz, 0, sy, 0);
    // +2: Z normal
    verts.push(sx, sy, sz, 0, 0, sz);
  }

  const vIdx = (x: number, y: number, z: number, axis: 0 | 1 | 2): number => {
    const oct = (x > 0 ? 1 : 0) | (y > 0 ? 2 : 0) | (z > 0 ? 4 : 0);
    return oct * 3 + axis;
  };

  const idx: number[] = [];
  const pushQuad = (a: number, b: number, c: number, d: number) => {
    idx.push(a, b, c, a, c, d);
  };

  // Helper to ensure CCW winding relative to outward reference direction
  const pushTriCCW = (a: number, b: number, c: number, nx: number, ny: number, nz: number) => {
    const ax = verts[a * 6] * 0.7 + verts[a * 6 + 3] * 0.3;
    const ay = verts[a * 6 + 1] * 0.7 + verts[a * 6 + 4] * 0.3;
    const az = verts[a * 6 + 2] * 0.7 + verts[a * 6 + 5] * 0.3;
    const bx = verts[b * 6] * 0.7 + verts[b * 6 + 3] * 0.3;
    const by = verts[b * 6 + 1] * 0.7 + verts[b * 6 + 4] * 0.3;
    const bz = verts[b * 6 + 2] * 0.7 + verts[b * 6 + 5] * 0.3;
    const cx = verts[c * 6] * 0.7 + verts[c * 6 + 3] * 0.3;
    const cy = verts[c * 6 + 1] * 0.7 + verts[c * 6 + 4] * 0.3;
    const cz = verts[c * 6 + 2] * 0.7 + verts[c * 6 + 5] * 0.3;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    if (crx * nx + cry * ny + crz * nz >= 0) {
      idx.push(a, b, c);
    } else {
      idx.push(a, c, b);
    }
  };

  const pushQuadCCW = (a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) => {
    pushTriCCW(a, b, c, nx, ny, nz);
    pushTriCCW(a, c, d, nx, ny, nz);
  };

  // 1) 6 Flat Faces
  // +X, -X
  for (const sx of [-1, 1]) {
    pushQuadCCW(
      vIdx(sx, -1, -1, 0),
      vIdx(sx, 1, -1, 0),
      vIdx(sx, 1, 1, 0),
      vIdx(sx, -1, 1, 0),
      sx, 0, 0
    );
  }
  // +Y, -Y
  for (const sy of [-1, 1]) {
    pushQuadCCW(
      vIdx(-1, sy, -1, 1),
      vIdx(-1, sy, 1, 1),
      vIdx(1, sy, 1, 1),
      vIdx(1, sy, -1, 1),
      0, sy, 0
    );
  }
  // +Z, -Z
  for (const sz of [-1, 1]) {
    pushQuadCCW(
      vIdx(-1, -1, sz, 2),
      vIdx(1, -1, sz, 2),
      vIdx(1, 1, sz, 2),
      vIdx(-1, 1, sz, 2),
      0, 0, sz
    );
  }

  // 2) 12 Beveled Edge Strips
  // Edges parallel to X (varying sx, fixed sy, sz)
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushQuadCCW(
        vIdx(-1, sy, sz, 1),
        vIdx(1, sy, sz, 1),
        vIdx(1, sy, sz, 2),
        vIdx(-1, sy, sz, 2),
        0, sy, sz
      );
    }
  }
  // Edges parallel to Y (varying sy, fixed sx, sz)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushQuadCCW(
        vIdx(sx, -1, sz, 0),
        vIdx(sx, 1, sz, 0),
        vIdx(sx, 1, sz, 2),
        vIdx(sx, -1, sz, 2),
        sx, 0, sz
      );
    }
  }
  // Edges parallel to Z (varying sz, fixed sx, sy)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      pushQuadCCW(
        vIdx(sx, sy, -1, 0),
        vIdx(sx, sy, 1, 0),
        vIdx(sx, sy, 1, 1),
        vIdx(sx, sy, -1, 1),
        sx, sy, 0
      );
    }
  }

  // 3) 8 Corner Bevel Triangles
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pushTriCCW(
          vIdx(sx, sy, sz, 0),
          vIdx(sx, sy, sz, 1),
          vIdx(sx, sy, sz, 2),
          sx, sy, sz
        );
      }
    }
  }

  // Silence unused helper warning
  void pushQuad;

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(idx),
    indexCount: idx.length,
  };
}

/**
 * Watertight parametric beveled cylinder (Y-axis aligned).
 * Uses the exact same vertex shader formula as BeveledBox:
 *   r = min(bevelR, min(hx, min(hy, hz)) * 0.45)
 *   localPos = aAnchor * max(halfSize - r, 0) + aNorm * r
 *
 * Notice that for a cylinder with hx = hz = R, hy = H:
 *   - Top center:      aAnchor = (0,  1, 0), aNorm = (0, 1, 0)  => (0, H, 0)
 *   - Top cap rim:     aAnchor = (c,  1, s), aNorm = (0, 1, 0)  => ((R-r)c, H, (R-r)s)
 *   - Top wall rim:    aAnchor = (c,  1, s), aNorm = (c, 0, s)  => (R*c, H-r, R*s)
 *   - Bottom wall rim: aAnchor = (c, -1, s), aNorm = (c, 0, s)  => (R*c, -(H-r), R*s)
 *   - Bottom cap rim:  aAnchor = (c, -1, s), aNorm = (0,-1, 0)  => ((R-r)c, -H, (R-r)s)
 *   - Bottom center:   aAnchor = (0, -1, 0), aNorm = (0,-1, 0)  => (0, -H, 0)
 *
 * ZERO extra shader branch needed — Box and Cylinder share the exact same vertex shader!
 */
export function createParametricBeveledCylinder(segments = 20): MeshBuffers {
  const verts: number[] = [];
  const idx: number[] = [];

  // Ring offsets:
  // 0: top center
  // 1..segments: top cap rim
  // 1+S..2S: top wall rim
  // 1+2S..3S: bottom wall rim
  // 1+3S..4S: bottom cap rim
  // 1+4S: bottom center
  const S = segments;
  verts.push(0, 1, 0, 0, 1, 0); // 0: top center

  const cosA: number[] = [];
  const sinA: number[] = [];
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2;
    cosA.push(Math.cos(a));
    sinA.push(Math.sin(a));
  }

  // Ring 1: top cap rim
  for (let i = 0; i < S; i++) verts.push(cosA[i], 1, sinA[i], 0, 1, 0);
  // Ring 2: top wall rim
  for (let i = 0; i < S; i++) verts.push(cosA[i], 1, sinA[i], cosA[i], 0, sinA[i]);
  // Ring 3: bottom wall rim
  for (let i = 0; i < S; i++) verts.push(cosA[i], -1, sinA[i], cosA[i], 0, sinA[i]);
  // Ring 4: bottom cap rim
  for (let i = 0; i < S; i++) verts.push(cosA[i], -1, sinA[i], 0, -1, 0);

  const botCenter = 1 + 4 * S;
  verts.push(0, -1, 0, 0, -1, 0);

  const r1 = 1;
  const r2 = 1 + S;
  const r3 = 1 + 2 * S;
  const r4 = 1 + 3 * S;

  for (let i = 0; i < S; i++) {
    const j = (i + 1) % S;
    // Top cap (CCW looking from +Y: angle increases from +X toward +Z which is CW from +Y, so reverse i/j)
    idx.push(0, r1 + j, r1 + i);
    // Top bevel strip
    idx.push(r1 + i, r1 + j, r2 + j);
    idx.push(r1 + i, r2 + j, r2 + i);
    // Side wall
    idx.push(r2 + i, r2 + j, r3 + j);
    idx.push(r2 + i, r3 + j, r3 + i);
    // Bottom bevel strip
    idx.push(r3 + i, r3 + j, r4 + j);
    idx.push(r3 + i, r4 + j, r4 + i);
    // Bottom cap
    idx.push(botCenter, r4 + i, r4 + j);
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(idx),
    indexCount: idx.length,
  };
}

/**
 * Watertight unit sphere (radius = 1).
 * aAnchor = unit sphere position, aNorm = outward unit normal.
 * Works seamlessly with both standard scaling (spheres/ellipsoids) and oriented orbital lobes!
 */
export function createUnitSphere(latSegs = 14, lonSegs = 20): MeshBuffers {
  const verts: number[] = [];
  const idx: number[] = [];

  for (let lat = 0; lat <= latSegs; lat++) {
    const theta = (lat / latSegs) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2;
      const nx = sinT * Math.cos(phi);
      const ny = cosT;
      const nz = sinT * Math.sin(phi);
      verts.push(nx, ny, nz, nx, ny, nz);
    }
  }

  const row = lonSegs + 1;
  for (let lat = 0; lat < latSegs; lat++) {
    for (let lon = 0; lon < lonSegs; lon++) {
      const a = lat * row + lon;
      const b = a + row;
      // Reverse winding so normals face outward (CCW from outside)
      idx.push(a, a + 1, b);
      idx.push(a + 1, b + 1, b);
    }
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(idx),
    indexCount: idx.length,
  };
}

/**
 * Unit Y-axis cylinder (radius = 1, y in [-1, 1]) for arbitrary 3D oriented bonds & strong-force flux tubes.
 */
export function createUnitBondCylinder(segments = 10): MeshBuffers {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    verts.push(c, 1, s, c, 0, s);
    verts.push(c, -1, s, c, 0, s);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const t0 = i * 2;
    const b0 = t0 + 1;
    const t1 = j * 2;
    const b1 = t1 + 1;
    idx.push(t0, t1, b1);
    idx.push(t0, b1, b0);
  }
  // Watertight top & bottom end caps so bonds never look like hollow pipes end-on
  const topCenter = segments * 2;
  verts.push(0, 1, 0, 0, 1, 0);
  const topRingStart = topCenter + 1;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    verts.push(Math.cos(a), 1, Math.sin(a), 0, 1, 0);
  }
  const botCenter = topRingStart + segments;
  verts.push(0, -1, 0, 0, -1, 0);
  const botRingStart = botCenter + 1;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    verts.push(Math.cos(a), -1, Math.sin(a), 0, -1, 0);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(topCenter, topRingStart + j, topRingStart + i);
    idx.push(botCenter, botRingStart + i, botRingStart + j);
  }
  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(idx),
    indexCount: idx.length,
  };
}
