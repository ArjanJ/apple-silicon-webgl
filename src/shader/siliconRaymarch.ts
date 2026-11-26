/**
 * 2-Pass Photorealistic GPU WebGL2 Raymarching Engine for Silicon Microscopy.
 *
 * Pass 1 (FRAGMENT_SHADER):
 *   - True asymmetric Apple Silicon M-series die floorplan (P-Cores, E-Cores,
 *     16-Core GPU, Neural Engine, segmented SLC SRAM vaults, gold bond-pad ring,
 *     routed PCB traces & satin LPDDR5X Unified Memory)
 *   - 3-tier procedural micro-lithography bump/roughness detail on every block
 *   - Real 1-bounce raymarched metallic reflections + studio softbox HDRI dome
 *   - Physical thin-film SiO2 spectral interference optics -> SEM silver-titanium
 *   - True 5-tap raymarched Ambient Occlusion + soft key shadows
 *   - 3-layer staggered SEM Metal Canyons with ringed recessed circular vias
 *   - 8-bit binary Nanometer Cell Fortresses + 3-sheet stacked 3nm GAA Fin Arrays
 *
 * Pass 2 (POST_FRAGMENT_SHADER):
 *   - Multi-tap optical glow bloom on high-luminance speculars & electric signals
 *   - Optical microscope radial shallow Depth-of-Field & subtle chromatic dispersion
 *   - Subtle photographic SEM micro-grain + ACES Filmic tone mapping
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uZoom;
uniform float uYaw;
uniform float uPitch;
uniform float uKeyBits;
uniform float uGateOn;
uniform float uPulsePhase;
uniform float uThermal;
uniform float uChapter;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmGrain(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.18;
    a *= 0.5;
  }
  return v;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCylinderY(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float repLim(float x, float pitch, float limMin, float limMax) {
  return x - pitch * clamp(round(x / pitch), limMin, limMax);
}

vec2 opMin(vec2 a, vec2 b) {
  return (a.x < b.x) ? a : b;
}

// Material IDs:
//   0 = dark obsidian fiberglass substrate / deep trench floor
//   1 = iridescent macro silicon die (P-Cores / E-Cores / GPU / NPU)
//   2 = bright brushed silver-titanium power rails / SEM metal traces / 3nm fins
//   3 = warm brushed champagne-gold SMD caps / vias / 3nm metal gate bridge
//   4 = dark recessed charcoal SRAM cache vault / sub-layer SEM metal / OFF cell
//   5 = granular crystalline SEM silicon substrate
//   6 = razor-sharp Apple-ice electric signal plasma / active '1' bit cell
//   7 = satin space-black Unified Memory (LPDDR5X) monolith

// ---------- WORLD 0: Asymmetric Photorealistic Apple Silicon SoC Package (10x · 12 mm) ----------
vec2 mapWorld0(vec3 p) {
  // Multi-tiered beveled dark organic package substrate floating over studio floor
  float subBase = sdRoundBox(p - vec3(0.0, -0.21, 0.0), vec3(5.42, 0.13, 3.38), 0.055);
  float subRim = sdRoundBox(p - vec3(0.0, -0.32, 0.0), vec3(5.52, 0.04, 3.48), 0.02);
  vec2 res = vec2(min(p.y + 0.37, min(subBase, subRim)), 0.0);

  // Twin Unified Memory (LPDDR5X) sleek satin space-black packages with chamfered bevels
  vec3 ramP = vec3(abs(p.x) - 4.22, p.y - 0.03, p.z);
  float ramSlab = sdRoundBox(ramP, vec3(0.76, 0.165, 2.42), 0.045);
  res = opMin(res, vec2(ramSlab, 7.0));

  // Realistic SMD Ceramic Decoupling Capacitors (dark brown ceramic body + bright gold solder caps!)
  vec3 capTBP = vec3(repLim(p.x, 0.22, -13.0, 13.0), p.y + 0.015, abs(p.z) - 2.78);
  float capTBEnd = sdRoundBox(vec3(abs(capTBP.x) - 0.046, capTBP.y, capTBP.z), vec3(0.024, 0.046, 0.046), 0.008);
  float capTBBody = sdRoundBox(capTBP, vec3(0.048, 0.044, 0.044), 0.008);

  vec3 capLRP = vec3(abs(p.x) - 3.32, p.y + 0.015, repLim(p.z, 0.22, -10.0, 10.0));
  float capLREnd = sdRoundBox(vec3(capLRP.x, capLRP.y, abs(capLRP.z) - 0.046), vec3(0.046, 0.046, 0.024), 0.008);
  float capLRBody = sdRoundBox(capLRP, vec3(0.044, 0.044, 0.048), 0.008);

  res = opMin(res, vec2(min(capTBEnd, capLREnd), 3.0));
  res = opMin(res, vec2(min(capTBBody, capLRBody), 4.0));

  // Main Beveled Iridescent Silicon Die Wafer (3.08 x 2.42 half-size) + Metallic Seal Ring
  float dieSlab = sdRoundBox(p - vec3(0.0, 0.035, 0.0), vec3(3.06, 0.135, 2.40), 0.026);
  res = opMin(res, vec2(dieSlab, 1.0));

  // Asymmetric Architectural Zones sculpted cleanly onto the silicon die!
  // 1) Top-Left: 8x Performance Core Cluster (4x2 tight high-perf blocks)
  {
    vec3 lp = p - vec3(-1.52, 0.185, -1.04);
    vec3 cp = vec3(repLim(lp.x, 0.64, -1.5, 1.5), lp.y, repLim(lp.z, 0.86, -0.5, 0.5));
    // Clamp repetition cleanly using symmetric fold for even counts!
    float px = abs(abs(lp.x) - 0.64) - 0.32;
    float pz = abs(lp.z) - 0.43;
    float pCore = sdRoundBox(vec3(px, lp.y, pz), vec3(0.285, 0.028, 0.385), 0.014);
    res = opMin(res, vec2(pCore, 1.0));
  }

  // 2) Mid-Left: 4x Efficiency Core Cluster (4 sleek compact blocks)
  {
    vec3 lp = p - vec3(-1.52, 0.185, 0.52);
    float px = abs(abs(lp.x) - 0.64) - 0.32;
    float eCore = sdRoundBox(vec3(px, lp.y, lp.z), vec3(0.285, 0.026, 0.46), 0.014);
    res = opMin(res, vec2(eCore, 1.0));
  }

  // 3) Bottom-Left: USB / HID I/O & PHY Controller Strip (6 narrow high-speed PHY blocks)
  {
    vec3 lp = p - vec3(-1.52, 0.182, 1.66);
    float px = repLim(lp.x, 0.42, -2.0, 2.0);
    float ioBlk = sdRoundBox(vec3(px, lp.y, lp.z), vec3(0.18, 0.024, 0.38), 0.012);
    res = opMin(res, vec2(ioBlk, 3.0));
  }

  // 4) Center Vertical Spine: Segmented 24MB System-Level Cache (dark charcoal SRAM vaults!)
  {
    vec3 lp = p - vec3(0.06, 0.188, -0.10);
    float pz = repLim(lp.z, 0.46, -4.0, 4.0);
    float slc = sdRoundBox(vec3(lp.x, lp.y, pz), vec3(0.22, 0.028, 0.19), 0.012);
    res = opMin(res, vec2(slc, 4.0));
  }

  // 5) Top-Right: 16-Core GPU Cluster (dense 4x4 square shader array!)
  {
    vec3 lp = p - vec3(1.66, 0.185, -0.78);
    float px = abs(abs(lp.x) - 0.56) - 0.28;
    float pz = abs(abs(lp.z) - 0.54) - 0.27;
    float gpuTile = sdRoundBox(vec3(px, lp.y, pz), vec3(0.245, 0.026, 0.235), 0.012);
    res = opMin(res, vec2(gpuTile, 1.0));
  }

  // 6) Mid-Right: 16-Core Neural Engine (ultra-dense 8x2 systolic matrix tiles)
  {
    vec3 lp = p - vec3(1.66, 0.185, 0.92);
    float px = abs(abs(abs(lp.x) - 0.56) - 0.28) - 0.14;
    float pz = abs(lp.z) - 0.24;
    float npuTile = sdRoundBox(vec3(px, lp.y, pz), vec3(0.115, 0.026, 0.20), 0.010);
    res = opMin(res, vec2(npuTile, 4.0));
  }

  // 7) Bottom-Right: Display & Media Engine (4 crisp horizontal scanout blocks)
  {
    vec3 lp = p - vec3(1.66, 0.182, 1.82);
    float px = abs(abs(lp.x) - 0.56) - 0.28;
    float dispBlk = sdRoundBox(vec3(px, lp.y, lp.z), vec3(0.245, 0.024, 0.24), 0.012);
    res = opMin(res, vec2(dispBlk, 1.0));
  }

  // Hairline gleaming silver-white power & interconnect spines between regions
  float railV1 = sdRoundBox(p - vec3(-0.22, 0.205, -0.05), vec3(0.022, 0.014, 2.22), 0.006);
  float railV2 = sdRoundBox(p - vec3(0.34, 0.205, -0.05), vec3(0.022, 0.014, 2.22), 0.006);
  float railH1 = sdRoundBox(p - vec3(-1.52, 0.205, -0.04), vec3(1.26, 0.014, 0.022), 0.006);
  float railH2 = sdRoundBox(p - vec3(1.66, 0.205, 0.36), vec3(1.22, 0.014, 0.022), 0.006);
  res = opMin(res, vec2(min(min(railV1, railV2), min(railH1, railH2)), 2.0));

  // Razor-thin electric keystroke signal pulse racing from USB I/O (bottom-left) -> E-Core -> Cache Spine!
  float pulseZ = mix(2.25, -1.6, uPulsePhase);
  float sigTrace = sdRoundBox(p - vec3(-0.22, 0.222, pulseZ), vec3(0.026, 0.014, 0.38), 0.008);
  res = opMin(res, vec2(sigTrace, 6.0));

  return res;
}

// ---------- WORLD 1: Frosted Micro-Striations & Cache Vaults (2.5K× · 60 µm) ----------
vec2 mapWorld1(vec3 p) {
  vec2 res = vec2(p.y + 0.22, 0.0);

  vec2 tileId = floor(p.xz / 2.25 + 0.5);
  vec2 lc = p.xz - tileId * 2.25;
  float h = hash12(tileId + 19.3);

  float blockH = 0.10 + h * 0.055;
  float block = sdRoundBox(vec3(lc.x, p.y - blockH * 0.5, lc.y), vec3(0.99, blockH * 0.5, 0.99), 0.022);
  res = opMin(res, vec2(block, (h > 0.72) ? 4.0 : 1.0));

  // Ultra-fine hair-thin 3D parallel micro-striation banks (17 ridges per block!)
  bool horiz = fract(h * 7.3) > 0.45;
  float a1 = horiz ? lc.y : lc.x;
  float a2 = horiz ? lc.x : lc.y;
  float ribA1 = repLim(a1, 0.098, -8.0, 8.0);
  float rib = sdRoundBox(vec3(a2, p.y - blockH - 0.022, ribA1), vec3(0.89, 0.024, 0.026), 0.007);
  float mat = (h > 0.68) ? 3.0 : (h > 0.28 ? 2.0 : 1.0);
  res = opMin(res, vec2(rib, mat));

  // Razor-sharp silver-white power distribution rails framing the deep dark valleys
  float railX = sdRoundBox(vec3(lc.x, p.y - 0.15, abs(lc.y) - 1.125), vec3(1.14, 0.038, 0.028), 0.009);
  float railZ = sdRoundBox(vec3(abs(lc.x) - 1.125, p.y - 0.15, lc.y), vec3(0.028, 0.038, 1.14), 0.009);
  res = opMin(res, vec2(min(railX, railZ), 2.0));

  // Focused live cyan signal pulsing down the center bus canyon
  float pulseZ = mix(-4.2, 4.2, uPulsePhase);
  float sig = sdRoundBox(p - vec3(0.0, 0.178, pulseZ), vec3(0.032, 0.032, 0.82), 0.012);
  res = opMin(res, vec2(sig, 6.0));

  return res;
}

// ---------- WORLD 2: Sculpted 3D SEM Metallic Routing Canyons & Ringed Vias (250K× · 800 nm) ----------
vec2 mapWorld2(vec3 p) {
  vec2 res = vec2(p.y + 0.54, 0.0);

  // Layer 1 (Deepest recessed metallic sub-traces dimly glinting inside dark trenches at y = -0.36)
  {
    float gx = mod(p.x + 0.30, 0.60) - 0.30;
    float gz = mod(p.z + 0.30, 0.60) - 0.30;
    float dDeep = min(
      sdRoundBox(vec3(gx, p.y + 0.36, 0.0), vec3(0.062, 0.044, 12.0), 0.012),
      sdRoundBox(vec3(0.0, p.y + 0.36, gz), vec3(12.0, 0.044, 0.062), 0.012)
    );
    res = opMin(res, vec2(dDeep, 4.0));
  }

  // Layer 2 (Mid-level champagne-copper differential pair buses at y = -0.10)
  {
    float gx = mod(p.x + 0.56, 1.12) - 0.56;
    float gz = mod(p.z + 0.78, 1.56) - 0.78;
    // Paired parallel traces (signature high-speed silicon routing look!)
    float pairZ = abs(gz) - 0.14;
    float busX = sdRoundBox(vec3(0.0, p.y + 0.10, pairZ), vec3(12.0, 0.062, 0.058), 0.018);
    float busZ = sdRoundBox(vec3(gx, p.y + 0.10, 0.0), vec3(0.095, 0.062, 12.0), 0.020);
    float jPad = sdCylinderY(vec3(gx, p.y + 0.10, gz), 0.17, 0.068);
    res = opMin(res, vec2(min(min(busX, busZ), jPad), 3.0));
  }

  // Layer 3 (Hero Upper Sculpted Silver-Titanium Bus Highways & Ringed Circular Vias at y = +0.20)
  {
    float px = 1.68;
    float pz = 1.68;
    vec2 cell = floor(p.xz / vec2(px, pz) + 0.5);
    vec2 lc = p.xz - cell * vec2(px, pz);

    // Continuous gleaming silver-titanium main highways (zero cut-end artifacts!)
    float mainX = sdRoundBox(vec3(0.0, p.y - 0.20, lc.y), vec3(12.0, 0.082, 0.13), 0.026);
    // Flanking thinner parallel signal lines beside main highway
    float sideX = sdRoundBox(vec3(0.0, p.y - 0.185, abs(lc.y) - 0.34), vec3(12.0, 0.065, 0.052), 0.018);
    float mainZ = sdRoundBox(vec3(lc.x, p.y - 0.20, 0.0), vec3(0.115, 0.082, 12.0), 0.024);

    // Beveled circular metallic contact pad with realistic concave via borehole!
    float topPad = sdCylinderY(vec3(lc.x, p.y - 0.205, lc.y), 0.24, 0.088);
    float viaBore = sdCylinderY(vec3(lc.x, p.y - 0.245, lc.y), 0.105, 0.075);
    float viaPillar = sdCylinderY(vec3(lc.x, p.y + 0.04, lc.y), 0.115, 0.27);

    float dTop = min(min(mainX, sideX), min(mainZ, topPad));
    dTop = max(dTop, -viaBore);
    res = opMin(res, vec2(dTop, 2.0));
    res = opMin(res, vec2(viaPillar, 3.0));
  }

  // HERO KEYSTROKE SIGNAL: Crisp electric-ice pulse riding along z=0 highway & plunging down (0,0) Via!
  float pulseX = mix(-4.6, 4.6, uPulsePhase);
  float sigSeg = sdRoundBox(p - vec3(pulseX, 0.23, 0.0), vec3(0.62, 0.068, 0.138), 0.024);
  float viaGlow = exp(-pow((0.5 - uPulsePhase) * 5.5, 2.0));
  float centerVia = sdCylinderY(p - vec3(0.0, -0.05, 0.0), 0.145, 0.34);
  res = opMin(res, vec2(sigSeg, 6.0));
  if (viaGlow > 0.25) res = opMin(res, vec2(centerVia, 6.0));

  return res;
}

// ---------- WORLD 3: Repeating Nanometer Cell Fortresses + Live 8-Bit Binary Row (8M× · 25 nm) ----------
vec2 mapWorld3(vec3 p) {
  float grain = fbmGrain(p.xz * 9.0) * 0.018;
  vec2 res = vec2(p.y + 0.22 - grain, 5.0);

  // Tightly packed repeating square nanometer modules (pitch = 0.58 -> ALL 8 binary bits fit inside lens!)
  float pitch = 0.58;
  vec2 cellId = floor(p.xz / pitch + 0.5);
  vec2 lc = p.xz - cellId * pitch;

  float outerBox = sdRoundBox(vec3(lc.x, p.y - 0.04, lc.y), vec3(0.252, 0.098, 0.252), 0.016);
  float innerCut = sdBox(vec3(lc.x, p.y - 0.088, lc.y), vec3(0.192, 0.098, 0.192));
  float wall = max(outerBox, -innerCut);

  float finX = repLim(lc.x, 0.072, -2.0, 2.0);
  float fins = sdRoundBox(vec3(finX, p.y - 0.012, lc.y), vec3(0.016, 0.056, 0.16), 0.006);

  vec2 cp = abs(lc) - vec2(0.236);
  float pin = sdCylinderY(vec3(cp.x, p.y - 0.102, cp.y), 0.018, 0.042);

  float wallMat = 2.0;
  float finMat = 3.0;
  float floorPad = 1e5;
  if (abs(cellId.y) < 0.1 && cellId.x >= -4.0 && cellId.x <= 3.0) {
    int bitPos = 7 - int(cellId.x + 4.0);
    int bits = int(uKeyBits + 0.5);
    int bitVal = (bits >> bitPos) & 1;
    if (bitVal == 1) {
      wallMat = 6.0;
      finMat = 6.0;
      floorPad = sdRoundBox(vec3(lc.x, p.y + 0.04, lc.y), vec3(0.18, 0.032, 0.18), 0.008);
    } else {
      wallMat = 4.0;
      finMat = 4.0;
    }
  }

  res = opMin(res, vec2(wall, wallMat));
  res = opMin(res, vec2(fins, finMat));
  res = opMin(res, vec2(pin, 2.0));
  if (floorPad < 1e4) res = opMin(res, vec2(floorPad, 6.0));

  return res;
}

// ---------- WORLD 4: Peak 3nm Stacked GAA Fin / Nanosheet Array on Crystalline Silicon (100M× · 3 nm) ----------
vec2 mapWorld4(vec3 p) {
  // High-detail granular silvery-grey crystalline/atomic SEM substrate floor
  float crystal = fbmGrain(p.xz * 7.0) * 0.062 + noise2D(p.xz * 30.0) * 0.014;
  vec2 res = vec2(p.y + 0.28 - crystal, 5.0);

  float pitch = 4.55;
  vec2 cellId = floor(p.xz / pitch + 0.5);
  vec2 lc = p.xz - cellId * pitch;
  bool isHero = (length(cellId) < 0.5);

  // Dark-walled beveled metallic cell fortress
  float frameOuter = sdRoundBox(vec3(lc.x, p.y - 0.10, lc.y), vec3(1.86, 0.26, 1.86), 0.048);
  float frameInner = sdBox(vec3(lc.x, p.y - 0.16, lc.y), vec3(1.64, 0.28, 1.64));
  float frameWall = max(frameOuter, -frameInner);
  res = opMin(res, vec2(frameWall, 2.0));

  float innerFloor = sdBox(vec3(lc.x, p.y + 0.16, lc.y), vec3(1.66, 0.06, 1.66));
  res = opMin(res, vec2(innerFloor, 0.0));

  // UPPER HALF (z = -0.82): 3 Crisp Banks of Vertical 3nm Parallel Fin Ridges + Contact Stubs
  float bankCenterX = repLim(lc.x, 1.06, -1.0, 1.0);
  float finInBankX = repLim(bankCenterX, 0.19, -2.0, 2.0);
  float vFin = sdRoundBox(vec3(finInBankX, p.y - 0.06, lc.y + 0.82), vec3(0.044, 0.18, 0.62), 0.015);
  float vStub = sdCylinderY(vec3(finInBankX, p.y - 0.165, abs(lc.y + 0.82) - 0.56), 0.036, 0.12);

  bool inCenterBank = isHero && abs(lc.x) < 0.52;
  float vFinMat = (inCenterBank && uGateOn > 0.35) ? 6.0 : 2.0;
  res = opMin(res, vec2(vFin, vFinMat));
  res = opMin(res, vec2(vStub, 3.0));

  // Champagne-gold Horizontal Metal Gate Bridge wrapping across the 3 vertical fin banks
  float gateBridge = sdRoundBox(vec3(lc.x, p.y - 0.18, lc.y + 0.82), vec3(1.54, 0.072, 0.16), 0.022);
  res = opMin(res, vec2(gateBridge, (isHero && uGateOn > 0.35) ? 3.0 : 4.0));

  // LOWER HALF (z = +0.82): 2 Symmetric Banks of 2-Tier Vertically Stacked 3nm GAA Nanosheet Ribbons!
  float rowBankZ = abs(lc.y - 0.82) - 0.36;
  float hFinZ = repLim(rowBankZ, 0.19, -1.0, 1.0);
  // Vertically stack 2 distinct nanosheet ribbons (visible gap when orbiting at low angle!)
  float sheetY = abs(p.y - 0.055) - 0.068;
  float hFin = sdRoundBox(vec3(lc.x, sheetY, hFinZ), vec3(1.48, 0.036, 0.044), 0.012);
  // Wrap-around vertical Gate-All-Around metallic collars straddling the stacked nanosheets
  float gPillarX = repLim(lc.x, 0.52, -2.0, 2.0);
  float gPillar = sdRoundBox(vec3(gPillarX, p.y - 0.11, hFinZ), vec3(0.056, 0.17, 0.078), 0.016);

  float waveX = mix(-1.45, 1.45, fract(uPulsePhase * 1.35 + (lc.y > 0.82 ? 0.38 : 0.0)));
  bool hitWave = isHero && uGateOn > 0.35 && abs(lc.x - waveX) < 0.25;
  res = opMin(res, vec2(hFin, hitWave ? 6.0 : 2.0));
  res = opMin(res, vec2(gPillar, (isHero && uGateOn > 0.35) ? 3.0 : 4.0));

  return res;
}

vec2 mapScene(vec3 p) {
  float z = clamp(uZoom, 0.0, 4.0);
  int idx = int(floor(z));
  float f = fract(z);

  float s0 = pow(2.5, f);
  float s1 = pow(2.5, f - 1.0);

  vec2 d0, d1;
  if (idx == 0) {
    d0 = mapWorld0(p / s0); d0.x *= s0;
    if (f < 0.02) return d0;
    d1 = mapWorld1(p / s1); d1.x *= s1;
  } else if (idx == 1) {
    d0 = mapWorld1(p / s0); d0.x *= s0;
    if (f < 0.02) return d0;
    d1 = mapWorld2(p / s1); d1.x *= s1;
  } else if (idx == 2) {
    d0 = mapWorld2(p / s0); d0.x *= s0;
    if (f < 0.02) return d0;
    d1 = mapWorld3(p / s1); d1.x *= s1;
  } else if (idx == 3) {
    d0 = mapWorld3(p / s0); d0.x *= s0;
    if (f < 0.02) return d0;
    d1 = mapWorld4(p / s1); d1.x *= s1;
  } else {
    return mapWorld4(p);
  }

  float blend = smoothstep(0.18, 0.82, f);
  float dist = mix(d0.x, d1.x, blend);
  float mat = (blend < 0.5) ? d0.y : d1.y;
  return vec2(dist, mat);
}

vec3 calcNormal(vec3 p) {
  const float e = 0.0018;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapScene(p + k.xyy * e).x +
    k.yyx * mapScene(p + k.yyx * e).x +
    k.yxy * mapScene(p + k.yxy * e).x +
    k.xxx * mapScene(p + k.xxx * e).x
  );
}

float calcAO(vec3 pos, vec3 nor) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.020 + 0.13 * float(i) / 4.0;
    float d = mapScene(pos + h * nor).x;
    occ += (h - d) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.4 * occ, 0.06, 1.0);
}

float calcSoftShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 24; i++) {
    float h = mapScene(ro + rd * t).x;
    if (h < 0.0012) return 0.06;
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.24);
    if (t > maxt) break;
  }
  return clamp(res, 0.10, 1.0);
}

// Physical Studio Softbox HDRI Dome (creates razor-sharp Apple Keynote metallic reflections!)
vec3 sampleStudioEnv(vec3 dir) {
  float y = clamp(dir.y, -1.0, 1.0);
  vec3 env = mix(vec3(0.01, 0.014, 0.022), vec3(0.04, 0.055, 0.085), smoothstep(-0.2, 0.8, y));

  // Overhead rectangular Apple studio softbox light-card
  vec3 dTop = normalize(vec3(0.32, 0.90, 0.28));
  float softbox1 = smoothstep(0.84, 0.96, dot(dir, dTop));
  env += vec3(1.65, 1.62, 1.58) * softbox1;

  // Cool sapphire side rim strip light-card
  vec3 dRim = normalize(vec3(-0.78, 0.45, -0.42));
  float softbox2 = smoothstep(0.80, 0.95, dot(dir, dRim));
  env += vec3(0.55, 0.92, 1.45) * softbox2;

  // Subtle warm champagne-gold accent strip on right
  vec3 dGold = normalize(vec3(0.76, 0.36, -0.54));
  float softbox3 = smoothstep(0.85, 0.97, dot(dir, dGold));
  env += vec3(1.25, 0.92, 0.52) * softbox3 * 0.65;

  return env;
}

// Physical SiO2 Thin-Film Optical Spectral Interference
vec3 thinFilmSpectral(float ndotv, vec2 pos) {
  float thickness = 2.15 + sin(pos.x * 0.65 - pos.y * 0.45) * 0.48 + hash12(floor(pos * 1.4)) * 0.35;
  float phase = thickness * (0.65 + 0.55 * ndotv);
  vec3 spectral = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.00, 0.33, 0.67)));
  // Rich deep Apple-silicon sapphire / emerald / bronze balance (never garish pastel!)
  return mix(vec3(0.04, 0.08, 0.16), spectral * vec3(0.52, 0.68, 0.92), 0.58);
}

// Evaluate base material color, roughness, metalness & emission
void getMaterial(
  float matId, vec3 p, vec3 n, float ndotv, float semFactor,
  out vec3 baseCol, out float rough, out float metal, out vec3 emissive
) {
  baseCol = vec3(0.03, 0.036, 0.048);
  rough = 0.38;
  metal = 0.45;
  emissive = vec3(0.0);

  if (matId < 0.5) {
    // 0: Dark obsidian fiberglass substrate with etched copper micro-traces fanning to RAM!
    float trace = smoothstep(0.75, 0.95, abs(sin(p.z * 32.0))) * step(2.9, abs(p.x)) * step(abs(p.x), 3.6) * step(abs(p.z), 2.2);
    float weave = noise2D(p.xz * 48.0) * 0.012;
    baseCol = vec3(0.020, 0.028, 0.032) + vec3(0.05, 0.09, 0.07) * trace * (1.0 - semFactor) + weave;
    rough = 0.44 - trace * 0.15;
    metal = 0.25 + trace * 0.45;
  } else if (matId < 1.5) {
    // 1: Iridescent thin-film macro silicon wafer with 3-tier micro-lithography!
    vec3 irid = thinFilmSpectral(ndotv, p.xz);
    float fineGrid = smoothstep(0.6, 0.95, abs(sin(p.x * 58.0))) * 0.14 + smoothstep(0.6, 0.95, abs(sin(p.z * 58.0))) * 0.10;
    float sramBank = step(0.5, fract(p.x * 3.1)) * smoothstep(0.3, 0.8, sin(p.z * 96.0)) * 0.12;
    vec3 macroCol = irid * (0.72 + fineGrid + sramBank);
    baseCol = mix(macroCol, vec3(0.22, 0.27, 0.34) * (0.85 + fineGrid), semFactor);
    rough = mix(0.14, 0.22, semFactor) + fineGrid * 0.08;
    metal = 0.93;
  } else if (matId < 2.5) {
    // 2: Brushed Silver-Titanium traces, walls & 3nm fins with fine anisotropic micro-grain
    float brush = (noise2D(vec2(p.x * 90.0, p.z * 14.0)) - 0.5) * 0.06;
    baseCol = vec3(0.66, 0.72, 0.80) + brush;
    rough = 0.17 + abs(brush);
    metal = 0.96;
  } else if (matId < 3.5) {
    // 3: Warm Brushed Champagne-Gold caps, vias & 3nm Gate Bridge
    float brush = (noise2D(vec2(p.x * 70.0, p.z * 18.0)) - 0.5) * 0.05;
    baseCol = mix(vec3(0.80, 0.63, 0.34), vec3(0.66, 0.57, 0.42), semFactor * 0.35) + brush;
    rough = 0.20;
    metal = 0.95;
    if (uZoom > 3.2 && uGateOn > 0.35) {
      emissive = vec3(0.95, 0.62, 0.20) * (0.34 * uGateOn);
    }
  } else if (matId < 4.5) {
    // 4: Dark Charcoal SRAM Cache Vaults / Recessed sub-layer SEM metal / OFF cell
    float stripe = smoothstep(0.2, 0.85, sin(p.z * 110.0)) * 0.05;
    baseCol = vec3(0.09, 0.11, 0.15) + stripe * (1.0 - semFactor);
    rough = 0.28;
    metal = 0.86;
  } else if (matId < 5.5) {
    // 5: Granular silvery-grey crystalline/atomic SEM silicon substrate
    float g = fbmGrain(p.xz * 13.0);
    float sparkle = pow(noise2D(p.xz * 64.0), 6.0) * 0.35;
    baseCol = vec3(0.18, 0.21, 0.25) * (0.62 + g * 0.85) + vec3(0.4, 0.46, 0.55) * sparkle;
    rough = 0.52;
    metal = 0.42;
  } else if (matId < 6.5) {
    // 6: Razor-sharp Apple-ice electric signal plasma / active '1' cell (triggers Pass 2 Optical Bloom!)
    baseCol = vec3(0.65, 0.96, 1.0);
    rough = 0.10;
    metal = 0.4;
    emissive = vec3(0.24, 0.86, 1.15) * (1.85 + 0.35 * sin(uTime * 8.0));
  } else {
    // 7: Satin Space-Black Unified Memory (LPDDR5X) monolith with subtle brushed grain
    float g = (noise2D(p.xz * 80.0) - 0.5) * 0.015;
    baseCol = vec3(0.055, 0.068, 0.095) + g;
    rough = 0.26;
    metal = 0.78;
  }

  if (uThermal > 0.5) {
    float heat = clamp(0.16 + (matId > 5.5 && matId < 6.5 ? 0.78 : 0.0) + (matId > 2.5 && matId < 3.5 ? 0.3 : 0.0) + (matId > 0.5 && matId < 1.5 ? 0.22 : 0.0), 0.0, 1.0);
    vec3 cCold = vec3(0.04, 0.03, 0.18);
    vec3 cMid = vec3(0.78, 0.10, 0.35);
    vec3 cHot = vec3(1.0, 0.82, 0.24);
    baseCol = heat < 0.5 ? mix(cCold, cMid, heat * 2.0) : mix(cMid, cHot, (heat - 0.5) * 2.0);
    emissive *= 1.4;
  }
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  float dist = mix(10.5, 5.2, smoothstep(0.0, 1.1, uZoom));
  dist = mix(dist, 4.85, smoothstep(2.0, 4.0, uZoom));

  float cp = cos(uPitch);
  vec3 ro = vec3(sin(uYaw) * cp * dist, sin(uPitch) * dist, cos(uYaw) * cp * dist);
  vec3 ta = vec3(0.0, 0.0, 0.0);

  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.68 * ww);

  vec3 col = mix(vec3(0.010, 0.014, 0.022), vec3(0.001, 0.002, 0.004), length(uv) * 1.15);

  float t = 0.0;
  float matId = -1.0;
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    vec3 p = ro + rd * t;
    vec2 h = mapScene(p);
    if (h.x < 0.0011 * (1.0 + t * 0.11)) {
      hit = true;
      matId = h.y;
      break;
    }
    t += h.x * 0.72;
    if (t > 26.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);

    // Crisp multi-scale surface micro-lithography normal relief on top die faces!
    if (uZoom < 0.9 && (matId > 0.5 && matId < 1.5 || matId > 3.5 && matId < 4.5) && n.y > 0.85) {
      float nx = cos(p.x * 74.0) * 0.065 + cos(p.x * 185.0) * 0.025;
      float nz = cos(p.z * 74.0) * 0.055 + cos(p.z * 185.0) * 0.025;
      n = normalize(n + vec3(nx, 0.0, nz));
    }

    vec3 v = -rd;
    float ndotv = max(dot(n, v), 0.0);
    float ao = calcAO(p, n);
    float semFactor = smoothstep(0.9, 2.1, uZoom);

    vec3 baseCol, emissive;
    float rough, metal;
    getMaterial(matId, p, n, ndotv, semFactor, baseCol, rough, metal, emissive);

    vec3 keyDir = normalize(vec3(0.52, 0.84, 0.40));
    vec3 rimDir = normalize(vec3(-0.74, 0.46, -0.55));
    vec3 fillDir = normalize(vec3(0.22, 0.52, -0.78));
    float sh = calcSoftShadow(p + n * 0.008, keyDir, 0.028, 4.5, 16.0);

    vec3 f0 = mix(vec3(0.04), baseCol, metal);
    float fresnel = pow(1.0 - ndotv, 5.0);
    vec3 F = f0 + (1.0 - f0) * fresnel;

    // REAL 1-BOUNCE RAYMARCHED METALLIC REFLECTION + STUDIO SOFTBOX HDRI!
    vec3 reflDir = reflect(rd, n);
    vec3 reflCol = sampleStudioEnv(reflDir);
    if (metal > 0.55) {
      float rt = 0.04;
      for (int j = 0; j < 20; j++) {
        vec3 rp = p + n * 0.012 + reflDir * rt;
        vec2 rh = mapScene(rp);
        if (rh.x < 0.004) {
          // Hit a neighboring 3D metallic wall or glowing electric signal!
          vec3 rBase, rEmis;
          float rRough, rMetal;
          getMaterial(rh.y, rp, n, 0.5, semFactor, rBase, rRough, rMetal, rEmis);
          reflCol = rBase * 0.45 + rEmis * 1.15;
          break;
        }
        rt += rh.x * 0.85;
        if (rt > 3.2) break;
      }
    }

    // Direct specular + diffuse lighting
    float ndotlK = max(dot(n, keyDir), 0.0);
    vec3 hK = normalize(keyDir + v);
    float specPow = mix(160.0, 18.0, rough);
    float specK = pow(max(dot(n, hK), 0.0), specPow) * (specPow * 0.022 + 0.45);

    float ndotlR = max(dot(n, rimDir), 0.0);
    vec3 hR = normalize(rimDir + v);
    float specR = pow(max(dot(n, hR), 0.0), specPow * 0.55) * 0.72;

    float ndotlF = max(dot(n, fillDir), 0.0);

    vec3 diff = baseCol * (1.0 - metal * 0.82);
    vec3 direct = vec3(0.0);
    direct += (diff * ndotlK + F * specK) * vec3(1.04, 1.01, 0.97) * sh * 1.38;
    direct += (diff * ndotlR + F * specR) * vec3(0.45, 0.78, 1.12) * 0.92;
    direct += diff * ndotlF * vec3(0.28, 0.34, 0.44) * 0.42;

    // Combine real 1-bounce reflections modulated by Fresnel & roughness!
    vec3 envReflection = reflCol * F * (1.0 - rough * 0.72) * (0.48 + 0.35 * metal) * ao;

    // Subtle SEM grazing-angle edge luminescence (real scanning electron microscope look!)
    vec3 semRim = vec3(0.56, 0.74, 0.96) * pow(1.0 - ndotv, 3.4) * (0.10 + 0.42 * semFactor) * ao;

    vec3 ambient = baseCol * vec3(0.11, 0.14, 0.20) * ao;

    col = ambient + direct * ao + envReflection + semRim + emissive;

    float fog = 1.0 - exp(-0.0055 * t * t);
    col = mix(col, vec3(0.003, 0.005, 0.009), fog);
  }

  // Output linear HDR (tone-mapped + bloomed in Pass 2!)
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

/**
 * Pass 2: Optical Microscope Post-Processing Shader
 * - Multi-tap HDR Optical Glow Bloom around active electric signals & metallic specular glints
 * - Subtle radial microscope lens edge Depth-of-Field blur & delicate chromatic dispersion
 * - Subtle SEM micro-sensor photographic grain + ACES Filmic tone mapping
 */
export const POST_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSceneTex;
uniform vec2 uResolution;
uniform float uTime;

vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 px = 1.0 / uResolution;
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rDist = length(centered);

  // 1. Delicate optical microscope edge chromatic dispersion (only near lens outer rim!)
  float ca = smoothstep(0.32, 0.92, rDist) * 0.0018;
  vec2 dir = normalize(centered + vec2(0.0001));
  float cr = texture(uSceneTex, vUv + dir * ca).r;
  float cg = texture(uSceneTex, vUv).g;
  float cb = texture(uSceneTex, vUv - dir * ca).b;
  vec3 base = vec3(cr, cg, cb);

  // 2. Subtle optical shallow Depth-of-Field near outer lens perimeter + 12-tap HDR Optical Bloom!
  float dof = smoothstep(0.42, 0.95, rDist) * 2.2;
  vec3 dofAcc = base;
  vec3 bloom = vec3(0.0);

  const vec2 OFFSETS[8] = vec2[8](
    vec2( 1.0,  0.0), vec2(-1.0,  0.0), vec2( 0.0,  1.0), vec2( 0.0, -1.0),
    vec2( 0.707,  0.707), vec2(-0.707,  0.707), vec2( 0.707, -0.707), vec2(-0.707, -0.707)
  );

  for (int i = 0; i < 8; i++) {
    vec2 o = OFFSETS[i];
    // Wide optical bloom tap
    vec3 s1 = texture(uSceneTex, vUv + o * px * 5.0).rgb;
    vec3 s2 = texture(uSceneTex, vUv + o * px * 11.0).rgb;
    bloom += max(s1 - vec3(0.75), 0.0) * 0.09;
    bloom += max(s2 - vec3(0.75), 0.0) * 0.055;

    // Subtle edge microscope lens focus softening
    if (dof > 0.05) {
      dofAcc += texture(uSceneTex, vUv + o * px * dof).rgb;
    }
  }
  if (dof > 0.05) {
    base = mix(base, dofAcc / 9.0, clamp(dof * 0.28, 0.0, 0.55));
  }

  vec3 col = base + bloom * 0.82;

  // 3. Subtle circular optical lens vignette + whisper-soft sapphire ring glint
  float vig = smoothstep(1.15, 0.34, rDist);
  col *= (0.44 + 0.56 * vig);
  float ringGlint = exp(-pow((rDist - 0.455) * 18.0, 2.0)) * 0.045;
  col += vec3(0.22, 0.68, 1.0) * ringGlint;

  // 4. ACES Filmic Tone Mapping + Gamma
  col = acesToneMap(col * 1.15);
  col = pow(col, vec3(1.0 / 2.2));

  // 5. Ultra-fine photographic SEM micro-grain (eliminates dark gradient banding!)
  float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.016;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;
