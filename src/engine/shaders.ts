/**
 * High-Speed Hardware-Instanced WebGL2 PBR Shaders for Apple Silicon Microscope.
 *
 * Unified Multi-Scale Single-Object Pipeline (ZERO 2D cross-fading!):
 *   Pass 0: 2048px Hardware-PCF Directional Shadow Map (all active nested scales together)
 *   Pass 1A: 4x MSAA HDR (RGBA16F) Opaque Instanced PBR Pass (shared 3D depth buffer across scales!)
 *   Pass 1B: 4x MSAA HDR Translucent Quantum Orbital Cloud Pass (depth-tested, additive Fresnel glow)
 *   Pass 2: Dual-Kawase HDR Bloom (Downsample 1/2 -> 1/4 -> 1/8, Upsample 1/4 -> 1/2)
 *   Pass 3: Optical Composite (velocity radial zoom-blur, subtle chromatic dispersion,
 *           creamy Dual-Kawase bloom, studio vignette, ACES Filmic tone map, SEM grain)
 */

const COMMON_INSTANCE_GLSL = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float getPCoreLoad(int idx) {
  if (idx == 0) return uCoreA.x;
  if (idx == 1) return uCoreA.y;
  if (idx == 2) return uCoreA.z;
  if (idx == 3) return uCoreA.w;
  if (idx == 4) return uCoreB.x;
  if (idx == 5) return uCoreB.y;
  if (idx == 6) return uCoreB.z;
  return uCoreB.w;
}

void evalInstance(
  vec4 instA, vec4 instB, vec4 instC,
  out vec3 center, out vec3 halfSize, out float bevelR,
  out float matId, out float liveEnergy
) {
  center = instA.xyz;
  bevelR = instA.w;
  halfSize = instB.xyz;
  matId = instB.w;
  liveEnergy = 0.0;

  int ch = int(instC.x + 0.5);
  float param = instC.y;

  if (ch == 0) {
    liveEnergy = param;
  } else if (ch == 1) {
    float load = getPCoreLoad(int(param + 0.5));
    liveEnergy = load;
    halfSize.y += load * 0.008;
    center.y += load * 0.004;
  } else if (ch == 2) {
    liveEnergy = uMacLoads.y * 0.95;
  } else if (ch == 3) {
    liveEnergy = uNetLoad * 0.9;
  } else if (ch == 4) {
    liveEnergy = (uMacLoads.x + uMacLoads.z + uMacLoads.w) * 0.25;
  } else if (ch == 5) {
    float gpuWave = 0.55 + 0.45 * sin(uTime * 3.5 + (center.x - 1.68) * 2.2 + (center.z + 0.78) * 2.2);
    liveEnergy = uMacLoads.z * gpuWave;
  } else if (ch == 6) {
    liveEnergy = uMacLoads.x * 0.35;
  } else if (ch == 7) {
    liveEnergy = 0.22 + uMacLoads.z * 0.45;
  } else if (ch == 8) {
    liveEnergy = uMacLoads.w;
  } else if (ch == 9) {
    if (param < 0.5) {
      center.z = mix(2.15, -1.75, uPulsePhase);
      halfSize.z = 0.28 + uMacLoads.x * 0.42;
      liveEnergy = 0.5 + 0.5 * max(uMacLoads.x, uNetLoad);
    } else if (param < 1.5) {
      center.x = mix(-2.7, 2.7, fract(uPulsePhase * 1.3 + 0.4));
      halfSize.x = 0.24 + uMacLoads.w * 0.34;
      liveEnergy = 0.5 + 0.5 * max(uMacLoads.x, uNetLoad);
    } else if (param < 2.5) {
      center.z = mix(-4.5, 4.5, uPulsePhase);
      liveEnergy = 0.7 + uMacLoads.x * 0.4;
    } else {
      center.x = mix(-4.8, 4.8, uPulsePhase);
      liveEnergy = 0.6 + uMacLoads.x * 0.5;
    }
  } else if (ch == 10) {
    float h = param;
    liveEnergy = (h < uMacLoads.x * 0.85 + 0.12) ? (uMacLoads.x * 0.65 * instC.z) : 0.0;
  } else if (ch == 11) {
    float viaGlow = exp(-pow((0.5 - uPulsePhase) * 5.5, 2.0));
    if (viaGlow > 0.22) {
      matId = 6.0;
      liveEnergy = 0.85 * viaGlow;
      halfSize.xz += 0.018 * viaGlow;
    }
  } else if (ch == 12) {
    float cellHash = hash12(instC.zw + floor(uTime * (2.5 + uMacLoads.x * 7.0)) * 0.13);
    bool activeCell = cellHash < (0.10 + uMacLoads.x * 0.58 + uNetLoad * 0.2);
    if (activeCell) {
      matId = 6.0;
      liveEnergy = (param > 2.5) ? 0.95 : 0.85;
    } else {
      matId = param;
      liveEnergy = 0.0;
    }
  } else if (ch == 13) {
    float gateActive = clamp(0.25 + uMacLoads.x * 1.15, 0.0, 1.0);
    if (param > 1.5) {
      liveEnergy = gateActive;
    } else if (param > 0.5) {
      if (gateActive > 0.3) matId = 6.0;
      liveEnergy = gateActive;
    }
  } else if (ch == 14) {
    float gateActive = clamp(0.25 + uMacLoads.x * 1.15, 0.0, 1.0);
    liveEnergy = (param > 0.5) ? gateActive : 0.0;
  } else if (ch == 15) {
    // Silicon Lattice / HfO2 atom: REAL thermal phonon vibration driven by live Mac die temp (uSocTemp)!
    // 4.6188 = 1 / (0.125 * sqrt(3)) keeps exact physical vibration parity across World 5 (1:6) and World 6!
    // Lock the 4 immediate tetrahedral neighbors of the chosen atom site (uAtomHole) so World 7 stays welded!
    float lockDamp = (uAtomHole.w > 0.01 && length(center - uAtomHole.xyz) < 0.60) ? 0.0 : 1.0;
    float ph = instC.z;
    float amp = (0.008 + uSocTemp * 0.024 + uMacLoads.x * 0.012) * min(1.0, length(halfSize) * 4.6188) * lockDamp;
    float freq = 5.5 + uSocTemp * 6.5;
    center.x += sin(uTime * freq + ph * 3.1) * amp;
    center.y += cos(uTime * (freq * 1.13) + ph * 4.7) * amp;
    center.z += sin(uTime * (freq * 0.89) + ph * 2.3) * amp;
    liveEnergy = param;
  } else if (ch == 16 || ch == 17) {
    liveEnergy = param;
  } else if (ch == 18) {
    // Drifting conduction electrons streaming through Silicon Crystal channels
    float speed = 0.35 + uMacLoads.x * 1.15;
    float prog = fract(uTime * speed + instC.z);
    center.x = mix(-2.25, 2.25, prog);
    center.y += sin(prog * 18.84 + instC.w * 6.28) * 0.11;
    center.z += cos(prog * 12.56 + instC.z * 6.28) * 0.10;
    liveEnergy = 0.75 + uMacLoads.x * 0.5;
  } else if (ch == 19) {
    // Orbiting Quantum Probability Density Packet around 111pm Silicon Atom / 28Si Nucleus
    float rad = instA.x;
    float inc = instA.y;
    float theta0 = instA.z;
    float speed = param * (0.75 + uMacLoads.x * 0.85);
    float ang = theta0 + uTime * speed;
    float precess = instC.z + uTime * 0.28;
    vec3 pOrb = vec3(cos(ang) * rad, sin(ang) * sin(inc) * rad, sin(ang) * cos(inc) * rad);
    float cp = cos(precess), sp = sin(precess);
    center = vec3(pOrb.x * cp - pOrb.z * sp, pOrb.y, pOrb.x * sp + pOrb.z * cp);
    liveEnergy = 0.72 + 0.28 * sin(uTime * 5.0 + instC.z * 9.0);
  } else if (ch == 21) {
    // 28Si Nucleon / Valence Quark zero-point strong-force jitter
    float ph = instC.z;
    float amp = 0.022 + uMacLoads.x * 0.015;
    center.x += sin(uTime * 11.5 + ph * 3.7) * amp;
    center.y += cos(uTime * 13.1 + ph * 5.1) * amp;
    center.z += sin(uTime * 9.7 + ph * 2.9) * amp;
    liveEnergy = param;
  } else if (ch == 22) {
    // Stochastic Quantum |ψ|² Measurement Mist / Virtual Pion & Quark-Antiquark Sea
    // Shimmers in-place (NO circular Kepler planetary rings!)
    float phase = instC.z * 6.28318 + instC.w * 4.7;
    float wave = 0.5 + 0.5 * sin(uTime * (2.6 + instC.z * 3.2) + phase);
    float pulse = pow(wave, 2.2);
    halfSize *= (0.28 + 0.92 * pulse);
    center.x += sin(uTime * 4.3 + phase) * 0.014;
    center.y += cos(uTime * 3.9 + phase * 1.3) * 0.014;
    center.z += sin(uTime * 4.7 + phase * 0.7) * 0.014;
    liveEnergy = param * (0.35 + 0.95 * pulse);
  } else if (ch == 23) {
    // Undulating QCD Gluon Color-Flux Tube between Valence Quarks
    liveEnergy = param * (0.85 + 0.25 * sin(uTime * 9.5 + length(center) * 5.0));
  }
}

void buildLocalPosAndNorm(
  vec3 aAnchor, vec3 aNorm, vec3 center, vec3 halfSize, float bevelR, int ch,
  out vec3 worldPos, out vec3 worldNorm
) {
  if (ch == 16 || ch == 23) {
    // Arbitrary 3D oriented covalent bond / undulating QCD gluon flux tube
    vec3 dir = halfSize;
    float halfLen = length(dir);
    vec3 up = dir / max(halfLen, 0.0001);
    vec3 ref = (abs(up.y) < 0.95) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(ref, up));
    vec3 fwd = cross(right, up);
    float tubeR = bevelR;
    if (ch == 23) {
      // Energetic gluon flux pinch/swell harmonic along tube axis
      tubeR *= 0.82 + 0.34 * sin(aAnchor.y * 6.28318 - uTime * 11.0 + halfLen * 8.0);
    }
    vec3 lp = vec3(aAnchor.x * tubeR, aAnchor.y * halfLen, aAnchor.z * tubeR);
    worldPos = center + right * lp.x + up * lp.y + fwd * lp.z;
    worldNorm = normalize(right * aNorm.x + up * aNorm.y + fwd * aNorm.z);
  } else if (ch == 17) {
    // 3D oriented teardrop sp3 quantum hybridized orbital lobe
    vec3 dir = halfSize;
    float lobeLen = length(dir);
    vec3 up = dir / max(lobeLen, 0.0001);
    vec3 ref = (abs(up.y) < 0.95) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(ref, up));
    vec3 fwd = cross(right, up);
    float t = clamp(aAnchor.y * 0.5 + 0.5, 0.0, 1.0);
    float breath = 1.0 + 0.035 * sin(uTime * 3.2 + lobeLen * 4.0);
    float profile = pow(t, 0.65) * sin(t * 3.14159265) * 1.45 * breath;
    float rad = bevelR * profile;
    vec3 lp = vec3(aAnchor.x * rad, t * lobeLen * breath, aAnchor.z * rad);
    worldPos = center + right * lp.x + up * lp.y + fwd * lp.z;
    worldNorm = normalize(right * aNorm.x + up * (aNorm.y * 0.65) + fwd * aNorm.z);
  } else {
    float r = min(bevelR, min(halfSize.x, min(halfSize.y, halfSize.z)) * 0.46);
    vec3 inner = max(halfSize - vec3(r), vec3(0.0));
    worldPos = center + aAnchor * inner + aNorm * r;
    worldNorm = aNorm;
  }
}
void applyDynamicCutouts(
  int ch, vec3 center, inout vec3 halfSize, inout float bevelR
) {
  // 1) Dynamic XZ instance culling inside uHoleBox (cx, cz, hx, hz)
  //    Mode 1 = tiled stages (World 1, 3, 4) above uHoleMinY
  //    Mode 4 = World 5 3nm crystal ribbon patch ONLY (|center.y| < 0.26, leaves gold gate/HfO2 untouched!)
  if (uHoleBox.z > 0.001) {
    bool isTiledCull = (uHoleMode > 0.5 && uHoleMode < 1.5 && center.y > uHoleMinY);
    bool isRibbonCull = (uHoleMode > 3.5 && abs(center.y) < 0.26 && ch != 18);
    if (isTiledCull || isRibbonCull) {
      // For bonds (ch == 16), use a slightly tighter inner box so seam-crossing bonds bridge cleanly!
      float margin = (ch == 16) ? -0.025 : 0.003;
      vec2 d = abs(center.xz - uHoleBox.xy) - (uHoleBox.zw + margin);
      if (max(d.x, d.y) < 0.0) {
        halfSize = vec3(0.0);
        bevelR = 0.0;
      }
    }
  }
  // 2) Dynamic 3D spherical atom/bond/proton cutout around uAtomHole (cx, cy, cz, radius) in World 6 & World 8
  //    Skip giant enveloping translucent halos (halfSize.x >= 0.60) so pion aura expands & fades organically!
  if (uAtomHole.w > 0.001 && (ch == 16 || halfSize.x < 0.60)) {
    float dAtom = length(center - uAtomHole.xyz);
    // Collapse the exact chosen Silicon atom / Proton sphere (< 0.06) and its 4 immediate covalent bonds (< uAtomHole.w)
    float cutR = (ch == 16) ? uAtomHole.w : 0.06;
    if (dAtom < cutR) {
      halfSize = vec3(0.0);
      bevelR = 0.0;
    }
  }
}
`;

export const SHADOW_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aAnchor;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec4 aInstA;
layout(location = 3) in vec4 aInstB;
layout(location = 4) in vec4 aInstC;

uniform mat4 uLightVP;
uniform float uWorldScale;
uniform float uYExtrude;
uniform vec3 uStageOffset;
uniform float uAtomRotY;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode; // 0 = off, 1 = VS instance + FS slab discard, 2 = FS-only slab discard, 4 = VS ribbon
uniform vec4 uAtomHole;
uniform vec3 uCamPos;
uniform float uLensClearance;
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uPulsePhase;
uniform float uSocTemp;

out vec3 vWorldPos;

${COMMON_INSTANCE_GLSL}

void main() {
  vec3 center, halfSize;
  float bevelR, matId, liveEnergy;
  int ch = int(aInstC.x + 0.5);
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);
  applyDynamicCutouts(ch, center, halfSize, bevelR);

  // Smooth physical 3D relief extrusion from surface (y = 0) when diving into micro-geometry
  if (uYExtrude < 0.999) {
    float ext = max(uYExtrude, 0.001);
    center.y *= ext;
    halfSize.y *= ext;
    bevelR = min(bevelR, halfSize.y * 0.45);
  }

  // Match SCENE_VS near-lens clearance so cleared foreground atoms/nucleons never cast invisible shadows
  if (uLensClearance > 0.01 && length(center - uStageOffset) > 0.45) {
    vec3 sc = (center - uStageOffset) * uWorldScale;
    vec3 toInst = sc - uCamPos;
    float camR = length(uCamPos);
    vec3 camDir = -uCamPos / max(camR, 0.0001);
    float along = dot(toInst, camDir);
    if (along < camR - 1.1) {
      float dCam = length(toInst);
      float perp = length(toInst - camDir * max(0.0, along));
      float keep = smoothstep(uLensClearance * 0.65, uLensClearance * 1.25, dCam)
                 * smoothstep(uLensClearance * 0.35, uLensClearance * 0.72, perp);
      halfSize *= keep;
      bevelR *= keep;
    }
  }

  vec3 worldPos, worldNorm;
  buildLocalPosAndNorm(aAnchor, aNorm, center, halfSize, bevelR, ch, worldPos, worldNorm);
  if (uAtomRotY > 0.5) {
    worldPos = vec3(worldPos.z, worldPos.y, -worldPos.x);
  }
  vWorldPos = worldPos;
  vec3 scaledPos = (worldPos - uStageOffset) * uWorldScale;

  gl_Position = uLightVP * vec4(scaledPos, 1.0);
}
`;

export const SHADOW_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode;

void main() {
  if (uHoleBox.z > 0.001 && uHoleMode > 0.5 && uHoleMode < 3.5 && vWorldPos.y > uHoleMinY) {
    vec2 d = abs(vWorldPos.xz - uHoleBox.xy) - uHoleBox.zw;
    if (max(d.x, d.y) < 0.0) discard;
  }
}
`;

export const SCENE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aAnchor;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec4 aInstA;
layout(location = 3) in vec4 aInstB;
layout(location = 4) in vec4 aInstC;

uniform mat4 uViewProj;
uniform mat4 uLightVP;
uniform float uWorldScale;
uniform float uYExtrude;
uniform vec3 uStageOffset;
uniform float uAtomRotY;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode;
uniform vec4 uAtomHole;
uniform vec3 uCamPos;
uniform float uLensClearance;
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uPulsePhase;
uniform float uSocTemp;

out vec3 vWorldPos;
out vec3 vScaledPos;
out vec3 vNormal;
out vec4 vShadowCoord;
out vec3 vEdgeFactor;
flat out float vMatId;
flat out float vLiveEnergy;
flat out float vChanType;
flat out float vExtraA;

${COMMON_INSTANCE_GLSL}

void main() {
  vec3 center, halfSize;
  float bevelR, matId, liveEnergy;
  int ch = int(aInstC.x + 0.5);
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);
  applyDynamicCutouts(ch, center, halfSize, bevelR);

  // Smooth physical 3D relief extrusion from surface (y = 0) when diving into micro-geometry
  if (uYExtrude < 0.999) {
    float ext = max(uYExtrude, 0.001);
    center.y *= ext;
    halfSize.y *= ext;
    bevelR = min(bevelR, halfSize.y * 0.45);
  }

  // Subtle physical optical objective clearance when flying inside the 3D crystal lattice or atomic nucleus
  if (uLensClearance > 0.01 && length(center - uStageOffset) > 0.45) {
    vec3 sc = (center - uStageOffset) * uWorldScale;
    vec3 toInst = sc - uCamPos;
    float camR = length(uCamPos);
    vec3 camDir = -uCamPos / max(camR, 0.0001);
    float along = dot(toInst, camDir);
    if (along < camR - 1.1) {
      float dCam = length(toInst);
      float perp = length(toInst - camDir * max(0.0, along));
      float clearCam = smoothstep(uLensClearance * 0.65, uLensClearance * 1.25, dCam);
      float clearRay = smoothstep(uLensClearance * 0.35, uLensClearance * 0.72, perp);
      float keep = clearCam * clearRay;
      halfSize *= keep;
      bevelR *= keep;
    }
  }

  vec3 worldPos, worldNorm;
  buildLocalPosAndNorm(aAnchor, aNorm, center, halfSize, bevelR, ch, worldPos, worldNorm);
  if (uAtomRotY > 0.5) {
    worldPos = vec3(worldPos.z, worldPos.y, -worldPos.x);
    worldNorm = vec3(worldNorm.z, worldNorm.y, -worldNorm.x);
  }
  vec3 scaledPos = (worldPos - uStageOffset) * uWorldScale;

  vWorldPos = worldPos;
  vScaledPos = scaledPos;
  vNormal = worldNorm;
  vShadowCoord = uLightVP * vec4(scaledPos, 1.0);
  vEdgeFactor = abs(aAnchor);
  vMatId = matId;
  vLiveEnergy = liveEnergy;
  vChanType = aInstC.x;
  vExtraA = aInstC.z;

  gl_Position = uViewProj * vec4(scaledPos, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vWorldPos;
in vec3 vScaledPos;
in vec3 vNormal;
in vec4 vShadowCoord;
in vec3 vEdgeFactor;
flat in float vMatId;
flat in float vLiveEnergy;
flat in float vChanType;
flat in float vExtraA;

uniform sampler2DShadow uShadowMap;
uniform sampler2D uCoinTex;
uniform sampler2D uCoinNormTex;
uniform vec4 uCoinSpec; // (cx, cz, radius, hy)
uniform vec2 uFocusXZ;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uZoom;
uniform float uSemFactor;
uniform float uFloorY;
uniform float uThermal;
uniform float uTranslucent;
uniform float uRegionKind; // 0 = Logic/CPU, 1 = SRAM/SLC, 2 = GPU
uniform vec4 uMacLoads;
uniform float uPulsePhase;
uniform vec4 uInspectBox; // (cx, cz, hx, hz); hx <= 0 means inactive
uniform vec4 uHoleBox;    // Dynamic recessed aperture (cx, cz, hx, hz)
uniform float uHoleMinY;  // Only discard fragments above this Y (keeps deep sub-floor intact)
uniform float uHoleMode;  // 0 = off, 1 = tiled slab discard, 2 = continuous die/canyon discard, 3 = die with bezel

out vec4 fragColor;

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
  for (int i = 0; i < 3; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.15;
    a *= 0.5;
  }
  return v;
}

vec3 sampleStudioEnv(vec3 dir) {
  float y = clamp(dir.y, -1.0, 1.0);
  vec3 env = mix(vec3(0.004, 0.006, 0.011), vec3(0.022, 0.032, 0.052), smoothstep(-0.15, 0.85, y));
  env += vec3(1.15, 1.12, 1.08) * smoothstep(0.88, 0.98, dot(dir, normalize(vec3(0.32, 0.90, 0.28))));
  env += vec3(0.38, 0.72, 1.25) * smoothstep(0.84, 0.97, dot(dir, normalize(vec3(-0.78, 0.45, -0.42))));
  env += vec3(0.95, 0.64, 0.30) * smoothstep(0.88, 0.98, dot(dir, normalize(vec3(0.76, 0.36, -0.54)))) * 0.55;
  float strip = smoothstep(0.972, 0.996, 1.0 - abs(dir.x * 0.55 - dir.z * 0.83)) * smoothstep(0.28, 0.78, dir.y);
  env += vec3(0.65, 0.74, 0.86) * strip * 0.48;
  return env;
}

vec3 thinFilmSpectral(float ndotv, vec2 pos) {
  float thickness = 2.15 + sin(pos.x * 0.65 - pos.y * 0.45) * 0.48 + hash12(floor(pos * 1.4)) * 0.35;
  float phase = thickness * (0.65 + 0.55 * ndotv);
  vec3 spectral = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.00, 0.33, 0.67)));
  return mix(vec3(0.025, 0.055, 0.12), spectral * vec3(0.38, 0.54, 0.78), 0.62);
}

float sampleShadow(vec4 sc, float ndotl) {
  vec3 proj = sc.xyz / sc.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.01 || proj.x > 0.99 || proj.y < 0.01 || proj.y > 0.99 || proj.z > 0.998) {
    return 1.0;
  }
  float bias = max(0.0012 * (1.0 - ndotl), 0.00055);
  float z = proj.z - bias;
  float tx = 1.0 / 2048.0;
  float s = 0.0;
  s += texture(uShadowMap, vec3(proj.xy, z)) * 0.28;
  s += texture(uShadowMap, vec3(proj.xy + vec2( tx * 1.35,  tx * 0.75), z)) * 0.18;
  s += texture(uShadowMap, vec3(proj.xy + vec2(-tx * 1.35, -tx * 0.75), z)) * 0.18;
  s += texture(uShadowMap, vec3(proj.xy + vec2(-tx * 0.75,  tx * 1.35), z)) * 0.18;
  s += texture(uShadowMap, vec3(proj.xy + vec2( tx * 0.75, -tx * 1.35), z)) * 0.18;
  return mix(0.06, 1.0, s);
}

void main() {
  vec3 p = vWorldPos;

  // Dynamic recessed aperture discard for nested layers (active ONLY after diving into that feature!)
  if (uHoleBox.z > 0.001 && uHoleMode > 0.5 && uHoleMode < 3.5 && p.y > uHoleMinY) {
    vec2 dHole = abs(p.xz - uHoleBox.xy) - uHoleBox.zw;
    if (max(dHole.x, dHole.y) < 0.0) discard;
  }

  vec3 n = normalize(vNormal);
  vec3 toCam = uCamPos - vScaledPos;
  float camDist = length(toCam);
  vec3 v = toCam / max(camDist, 0.0001);
  float ndotv = max(dot(n, v), 0.0);

  // Translucent Volumetric Quantum Probability Cloud Pass (sp3 lobes & 1s2 core halo)
  if (uTranslucent > 0.5) {
    float qWave = 0.5 + 0.5 * sin(length(p) * 8.5 - uTime * 3.8 + vExtraA * 6.28);
    float rim = pow(1.0 - ndotv, 1.85);
    vec3 cloudHue = mix(vec3(0.06, 0.44, 0.98), vec3(0.36, 0.92, 1.10), rim * 0.75 + qWave * 0.25);
    if (uThermal > 0.5) {
      cloudHue = mix(vec3(0.85, 0.22, 0.42), vec3(1.0, 0.78, 0.24), rim * 0.7 + qWave * 0.3);
    }
    float energy = 0.55 + vLiveEnergy * 0.45;
    vec3 glow = cloudHue * (0.10 + rim * 0.95 + qWave * 0.14) * energy;
    float fogDist = length(vScaledPos);
    // Keep orbitals vivid at Atom scale (r <= 2.2) while softly receding into deep space at Nucleus scale (r >= 6.5)
    float fog = exp(-0.016 * fogDist * fogDist);
    // Smooth near-camera volumetric clearance prevents hard near-plane polygon slices when flying through shells
    float nearCam = smoothstep(0.9, 3.2, camDist);
    float fade = fog * nearCam;
    float alpha = clamp((0.12 + rim * 0.58 + qWave * 0.06) * fade, 0.0, 0.85);
    fragColor = vec4(max(glow * fade, 0.0), alpha);
    return;
  }

  float matId = vMatId;
  float liveEnergy = vLiveEnergy;

  // Per-pixel Unified RAM inner edge bus glow (Channel 8)
  if (vChanType > 7.5 && vChanType < 8.5) {
    liveEnergy = uMacLoads.w * smoothstep(3.75, 3.44, abs(p.x));
  }

  // Per-pixel GAA Nanosheet sweeping cyan inversion-channel wave (Channel 14, tiled per 5.12 cell!)
  if (vChanType > 13.5 && vChanType < 14.5 && liveEnergy > 0.01) {
    float localX = mod(p.x + 2.56, 5.12) - 2.56;
    float waveX = mix(-1.85, 1.85, fract(uPulsePhase * 1.4 + vExtraA));
    float hitWave = smoothstep(0.38, 0.08, abs(localX - waveX));
    if (hitWave > 0.35) {
      matId = 6.0;
      liveEnergy = mix(liveEnergy, 1.15, hitWave);
    }
  }

  // Delocalized Bloch Electron Wavepacket Interference propagating through Silicon covalent bonds!
  // (Replaces cartoon flying marble spheres with real wavepacket conduction along the crystal lattice!)
  float blochGlow = 0.0;
  if (vChanType > 15.5 && vChanType < 16.5 && vLiveEnergy > 0.85) {
    float kSpeed = 4.2 + uMacLoads.x * 6.5;
    float wave1 = sin(p.x * 2.6 - uTime * kSpeed + p.z * 0.9);
    float wave2 = cos(p.x * 5.2 - uTime * kSpeed * 1.35 - p.y * 1.6);
    float env = pow(max(0.0, 0.5 + 0.5 * wave1) * (0.55 + 0.45 * wave2), 2.4);
    blochGlow = env * (0.28 + uMacLoads.x * 0.95);
  }

  // Analytical micro-relief normal perturbation (die lithography lines matching World 1's exact 0.095 grid!)
  if (uZoom < 0.9 && ((matId > 0.5 && matId < 1.5) || (matId > 3.5 && matId < 4.5)) && n.y > 0.85) {
    // 0.095 = 1.52 / 16.0 (exact scaled pitch of World 1's SRAM tile grid!)
    vec2 tileCoord = p.xz / 0.095;
    vec2 tileId = floor(tileCoord + 0.5);
    vec2 tileF = fract(tileCoord + 0.5) - 0.5;
    float th = hash12(tileId + vec2(19.3));
    float horiz = step(0.45, fract(th * 7.3));
    float ribAxis = mix(tileF.x, tileF.y, horiz);
    float ribSlope = cos(ribAxis * 6.28318 * 13.0) * 0.085;
    float railX = smoothstep(0.42, 0.49, abs(tileF.x)) * sign(tileF.x) * 0.14;
    float railZ = smoothstep(0.42, 0.49, abs(tileF.y)) * sign(tileF.y) * 0.14;
    n = normalize(n + vec3(mix(ribSlope, 0.0, horiz) + railX, 0.0, mix(0.0, ribSlope, horiz) + railZ));
  } else if (matId > 4.5 && matId < 5.5) {
    float g0 = fbmGrain(p.xz * 12.0);
    float gx = fbmGrain((p.xz + vec2(0.03, 0.0)) * 12.0);
    float gz = fbmGrain((p.xz + vec2(0.0, 0.03)) * 12.0);
    n = normalize(n + vec3((g0 - gx) * 2.2, 0.0, (g0 - gz) * 2.2));
  }

  ndotv = max(dot(n, v), 0.0);

  // Material Evaluation (Physically Calibrated Linear-Space Apple Dark-Studio PBR Palette)
  vec3 baseCol = vec3(0.018, 0.022, 0.030);
  float rough = 0.38;
  float metal = 0.45;
  vec3 emissive = vec3(0.0);

  if (matId < 0.5) {
    float trace = smoothstep(0.75, 0.95, abs(sin(p.z * 32.0))) * step(2.9, abs(p.x)) * step(abs(p.x), 3.6) * step(abs(p.z), 2.2);
    baseCol = vec3(0.012, 0.017, 0.021) + vec3(0.035, 0.065, 0.050) * trace * (1.0 - uSemFactor);
    rough = 0.46 - trace * 0.15;
    metal = 0.25 + trace * 0.45;
    // Ultra-subtle architectural 10 mm studio scale mat hairlines when zoomed out past Die
    if (uZoom < -0.15 && p.y < -0.50 && n.y > 0.8) {
      float macroVis = smoothstep(-0.15, -0.95, uZoom);
      // 1 unit = 3.5 mm => 10 mm = 2.85714 units; 50 mm major lines = 14.2857 units
      vec2 g10 = abs(fract(p.xz / 2.85714 + 0.5) - 0.5) * 2.85714;
      float line10 = 1.0 - smoothstep(0.012, 0.048, min(g10.x, g10.y));
      vec2 g50 = abs(fract(p.xz / 14.2857 + 0.5) - 0.5) * 14.2857;
      float line50 = 1.0 - smoothstep(0.018, 0.065, min(g50.x, g50.y));
      float matFade = exp(-0.00055 * dot(p.xz - uFocusXZ, p.xz - uFocusXZ));
      float grid = (line10 * 0.35 + line50 * 0.75) * macroVis * matFade;
      baseCol += vec3(0.028, 0.034, 0.044) * grid;
      rough = mix(rough, 0.32, grid * 0.5);
    }
  } else if (matId < 1.5) {
    vec3 irid = thinFilmSpectral(ndotv, p.xz);
    float fineGrid = smoothstep(0.6, 0.95, abs(sin(p.x * 58.0))) * 0.14 + smoothstep(0.6, 0.95, abs(sin(p.z * 58.0))) * 0.10;
    float sramBank = step(0.5, fract(p.x * 3.1)) * smoothstep(0.3, 0.8, sin(p.z * 96.0)) * 0.12;
    vec3 macroCol = irid * (0.72 + fineGrid + sramBank);
    baseCol = mix(macroCol, vec3(0.11, 0.14, 0.19) * (0.85 + fineGrid), uSemFactor);
    rough = mix(0.15, 0.24, uSemFactor) + fineGrid * 0.08;
    metal = 0.92;
    if (liveEnergy > 0.06) {
      vec3 glowHue = mix(vec3(0.08, 0.58, 0.98), vec3(0.95, 0.52, 0.14), smoothstep(0.35, 0.85, liveEnergy));
      emissive = glowHue * pow(liveEnergy, 1.35) * 0.88;
    }
  } else if (matId < 2.5) {
    float brush = (noise2D(vec2(p.x * 90.0, p.z * 14.0)) - 0.5) * 0.035;
    baseCol = vec3(0.24, 0.28, 0.35) + brush;
    rough = 0.20 + abs(brush);
    metal = 0.95;
  } else if (matId < 3.5) {
    float brush = (noise2D(vec2(p.x * 70.0, p.z * 18.0)) - 0.5) * 0.03;
    baseCol = mix(vec3(0.46, 0.28, 0.11), vec3(0.36, 0.24, 0.12), uSemFactor * 0.35) + brush;
    rough = 0.22;
    metal = 0.94;
    if (liveEnergy > 0.15) emissive = vec3(0.85, 0.48, 0.12) * liveEnergy * 0.24;
  } else if (matId < 4.5) {
    float stripe = smoothstep(0.2, 0.85, sin(p.z * 110.0)) * 0.03;
    // Subtle region-aware tint for SRAM/SLC vs GPU vs Logic routing/contacts
    vec3 regionTint = uRegionKind > 1.5 ? vec3(0.012, 0.018, 0.032) : (uRegionKind > 0.5 ? vec3(0.008, 0.022, 0.024) : vec3(0.0));
    baseCol = vec3(0.045, 0.058, 0.082) + regionTint + stripe * (1.0 - uSemFactor);
    rough = 0.28;
    metal = 0.88;
    if (blochGlow > 0.02) {
      emissive = vec3(0.09, 0.58, 1.02) * blochGlow * 1.15;
    } else if (liveEnergy > 0.1 && vChanType < 15.5) {
      emissive = vec3(0.18, 0.48, 0.92) * liveEnergy * 0.35;
    }
  } else if (matId < 5.5) {
    float g = fbmGrain(p.xz * 12.0);
    float sparkle = pow(noise2D(p.xz * 56.0), 6.0) * 0.24;
    baseCol = vec3(0.085, 0.105, 0.135) * (0.55 + g * 0.85) + vec3(0.25, 0.31, 0.40) * sparkle;
    rough = 0.56;
    metal = 0.38;
  } else if (matId < 6.5) {
    baseCol = vec3(0.14, 0.52, 0.72);
    rough = 0.16;
    metal = 0.35;
    emissive = vec3(0.08, 0.62, 0.98) * (0.68 + liveEnergy * 0.58 + 0.12 * sin(uTime * 8.0));
  } else if (matId < 7.5) {
    baseCol = vec3(0.028, 0.036, 0.052);
    rough = 0.28;
    metal = 0.78;
    if (liveEnergy > 0.05) emissive = vec3(0.14, 0.46, 0.95) * liveEnergy * 0.75;
  } else if (matId < 8.5) {
    float qWave = 0.5 + 0.5 * sin(length(p) * 8.5 - uTime * 3.8 + vExtraA * 6.28);
    float rim = pow(1.0 - ndotv, 1.65);
    baseCol = vec3(0.03, 0.14, 0.28);
    rough = 0.12;
    metal = 0.20;
    vec3 cloudHue = mix(vec3(0.06, 0.45, 0.96), vec3(0.32, 0.88, 1.05), rim * 0.75 + qWave * 0.25);
    emissive = cloudHue * (0.16 + rim * 1.05 + qWave * 0.16) * (0.65 + liveEnergy * 0.45);
  } else if (matId < 9.5) {
    float quark = 0.5 + 0.5 * sin(p.x * 14.0 + uTime * 4.5) * cos(p.y * 14.0 - uTime * 3.7) * sin(p.z * 14.0 + uTime * 4.1);
    float rim = pow(1.0 - ndotv, 2.2);
    baseCol = vec3(0.06, 0.24, 0.52) + vec3(0.08, 0.20, 0.32) * quark;
    rough = 0.18;
    metal = 0.78;
    emissive = vec3(0.08, 0.44, 0.98) * (0.18 + rim * 0.55 + quark * 0.28) * max(0.25, liveEnergy);
  } else if (matId < 10.5) {
    // Mat 10: Photorealistic US Quarter Dollar (24.26 mm cupronickel clad over copper core + 119 milled reeds)
    vec2 coinD = (p.xz - uCoinSpec.xy) / max(uCoinSpec.z, 0.001);
    float coinAng = atan(coinD.y, coinD.x);
    if (n.y > 0.55) {
      vec2 coinUv = clamp(coinD * 0.5 + 0.5, 0.002, 0.998);
      vec4 cAlbedoRough = texture(uCoinTex, coinUv);
      vec4 cRelief = texture(uCoinNormTex, coinUv);

      // Multi-scale tangent-space normal perturbation from photographic bas-relief
      vec2 tn = cRelief.rg * 2.0 - 1.0;
      float bumpStrength = 1.65;
      n = normalize(n + vec3(tn.x * bumpStrength, 0.0, tn.y * bumpStrength));
      ndotv = max(dot(n, v), 0.0);

      // Convert sRGB photographic albedo to linear space with warm authentic cupronickel tint
      vec3 linearPhoto = pow(max(cAlbedoRough.rgb, vec3(0.001)), vec3(2.15));
      float texRough = cAlbedoRough.a;
      float cavityAO = cRelief.b;

      // Subtle radial "cartwheel" mint luster that rotates realistically as you orbit in 3D
      vec2 viewXZ = normalize(v.xz + vec2(0.0001));
      vec2 radDir = normalize(coinD + vec2(0.0001));
      float cartwheel = pow(abs(dot(radDir, viewXZ)), 3.4) * (1.0 - texRough * 1.15);

      baseCol = linearPhoto * vec3(1.06, 1.03, 0.97) * (0.86 + cartwheel * 0.24) * mix(0.68, 1.04, cavityAO);
      rough = clamp(texRough * 0.92, 0.14, 0.46);
      metal = mix(0.93, 0.78, texRough);
    } else {
      // Milled edge: 119 sharpened vertical reeds + authentic copper core sandwich between cupronickel clad
      vec3 tang = normalize(vec3(-coinD.y, 0.0, coinD.x) + vec3(0.0001));
      float reedRaw = sin(coinAng * 119.0);
      float reedTooth = smoothstep(-0.75, 0.75, reedRaw);
      float reedSlope = cos(coinAng * 119.0);
      n = normalize(n + tang * reedSlope * 0.58);
      ndotv = max(dot(n, v), 0.0);

      float edgeY = abs((p.y - (uFloorY + uCoinSpec.w)) / max(uCoinSpec.w, 0.001));
      float copperCore = 1.0 - smoothstep(0.42, 0.58, edgeY);
      float wearNoise = noise2D(vec2(coinAng * 24.0, p.y * 40.0)) * 0.14;
      vec3 cladCol = vec3(0.56, 0.545, 0.515) * (0.92 + wearNoise);
      vec3 copperCol = vec3(0.56, 0.21, 0.095) * (0.88 + wearNoise);
      baseCol = mix(cladCol, copperCol, copperCore) * (0.52 + 0.48 * reedTooth);
      rough = mix(0.20, 0.30, copperCore);
      metal = 0.93;
    }
  } else if (matId < 11.5) {
    // Mat 11: QCD Red Up Quark (u)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.75, 0.14, 0.10);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(1.15, 0.24, 0.12) * (0.55 + rim * 0.85) * max(0.4, liveEnergy);
  } else if (matId < 12.5) {
    // Mat 12: QCD Green Up Quark (u)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.10, 0.68, 0.34);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(0.14, 1.05, 0.52) * (0.55 + rim * 0.85) * max(0.4, liveEnergy);
  } else if (matId < 13.5) {
    // Mat 13: QCD Blue Down Quark (d)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.18, 0.28, 0.88);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(0.28, 0.44, 1.25) * (0.55 + rim * 0.85) * max(0.4, liveEnergy);
  } else {
    // Mat 14: Silicon Nitride (SiN) Dielectric Inner Spacer / Interfacial SiO2 Glassy Liner
    float sheen = pow(1.0 - ndotv, 2.6);
    baseCol = vec3(0.055, 0.088, 0.112) + vec3(0.05, 0.09, 0.12) * sheen;
    rough = 0.24;
    metal = 0.18;
  }

  if (uThermal > 0.5) {
    float heat = clamp(
      0.14 + liveEnergy * 0.85 + (matId > 5.5 && matId < 6.5 ? 0.65 : 0.0) + (matId > 2.5 && matId < 3.5 ? 0.22 : 0.0),
      0.0,
      1.0
    );
    vec3 cCold = vec3(0.03, 0.02, 0.14);
    vec3 cMid = vec3(0.68, 0.08, 0.28);
    vec3 cHot = vec3(1.0, 0.72, 0.16);
    baseCol = heat < 0.5 ? mix(cCold, cMid, heat * 2.0) : mix(cMid, cHot, (heat - 0.5) * 2.0);
    emissive *= 1.15;
  }

  // Analytical Height & Crevice Ambient Occlusion
  float hAboveFloor = p.y - uFloorY;
  float floorAO = mix(0.26, 1.0, smoothstep(-0.04, 0.42, hAboveFloor));
  float wallAO = mix(0.68, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float ao = clamp(floorAO * wallAO, 0.18, 1.0);

  // Studio 3-Point Key / Rim / Fill Lighting + 5-Tap Hardware PCF Soft Shadows
  vec3 keyDir = normalize(vec3(0.52, 0.84, 0.40));
  vec3 rimDir = normalize(vec3(-0.74, 0.46, -0.55));
  vec3 fillDir = normalize(vec3(0.22, 0.52, -0.78));

  float ndotlK = max(dot(n, keyDir), 0.0);
  float sh = sampleShadow(vShadowCoord, ndotlK);

  vec3 f0 = mix(vec3(0.04), baseCol, metal);
  float fresnel = pow(1.0 - ndotv, 5.0);
  vec3 F = f0 + (1.0 - f0) * fresnel;

  vec3 hK = normalize(keyDir + v);
  float specPow = mix(180.0, 22.0, rough);
  float specK = pow(max(dot(n, hK), 0.0), specPow) * (specPow * 0.018 + 0.36);

  float ndotlR = max(dot(n, rimDir), 0.0);
  vec3 hR = normalize(rimDir + v);
  float specR = pow(max(dot(n, hR), 0.0), specPow * 0.55) * 0.62;

  float ndotlF = max(dot(n, fillDir), 0.0);

  vec3 diff = baseCol * (1.0 - metal * 0.84);
  vec3 direct = vec3(0.0);
  direct += (diff * ndotlK + F * specK) * vec3(1.04, 1.01, 0.96) * sh * 1.12;
  direct += (diff * ndotlR + F * specR) * vec3(0.36, 0.68, 1.08) * 0.72;
  direct += diff * ndotlF * vec3(0.20, 0.26, 0.36) * 0.32;

  vec3 reflDir = reflect(-v, n);
  vec3 reflCol = sampleStudioEnv(reflDir);
  vec3 envReflection = reflCol * F * (1.0 - rough * 0.68) * (0.42 + 0.32 * metal) * ao;

  vec3 semRim = vec3(0.44, 0.64, 0.92) * pow(1.0 - ndotv, 3.6) * (0.08 + 0.34 * uSemFactor) * ao;
  vec3 ambient = baseCol * vec3(0.06, 0.08, 0.12) * ao;

  vec3 col = ambient + direct * ao + envReflection + semRim + emissive;

  // Razor-sharp 3D selection frame when user clicks a die block or the US Quarter to inspect
  if (uInspectBox.z > 0.001 && uZoom < 0.85) {
    float inspectVis = clamp(1.0 - max(uZoom, 0.0) * 1.1, 0.0, 1.0);
    float sdf;
    if (uInspectBox.w < 0.0) {
      sdf = length(p.xz - uInspectBox.xy) - abs(uInspectBox.w);
    } else {
      vec2 dBox = abs(p.xz - uInspectBox.xy) - uInspectBox.zw;
      sdf = max(dBox.x, dBox.y);
    }
    float edgeDist = abs(sdf);
    float inside = step(sdf, 0.02);
    float rim = smoothstep(0.048, 0.007, edgeDist) * (1.0 - smoothstep(0.0, 0.25, sdf));
    float pulse = 0.78 + 0.22 * sin(uTime * 5.0);
    col += vec3(0.45, 0.88, 1.25) * rim * pulse * inspectVis;
    col += vec3(0.04, 0.12, 0.22) * inside * 0.45 * inspectVis;
  }

  // Smooth infinite studio fog matching our obsidian backdrop
  float fogDist = length(vScaledPos.xz - uFocusXZ);
  float fog = 1.0 - exp(-uFogDensity * fogDist * fogDist);
  col = mix(col, vec3(0.003, 0.005, 0.009), clamp(fog, 0.0, 1.0));

  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

export const FULLSCREEN_VS = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

/** Extract HDR highlights above threshold from single unified HDR scene buffer */
export const BLOOM_PREFILTER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uTexelSize;

void main() {
  vec2 o = uTexelSize * 0.5;
  vec3 c = (
    texture(uTex, vUv + vec2(-o.x, -o.y)).rgb +
    texture(uTex, vUv + vec2( o.x, -o.y)).rgb +
    texture(uTex, vUv + vec2(-o.x,  o.y)).rgb +
    texture(uTex, vUv + vec2( o.x,  o.y)).rgb
  ) * 0.25;
  float lum = max(c.r, max(c.g, c.b));
  float soft = smoothstep(0.72, 1.45, lum);
  fragColor = vec4(c * soft, 1.0);
}
`;

/** Fast 4-tap Dual-Kawase Downsample */
export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uHalfPixel;
void main() {
  vec3 sum = texture(uTex, vUv).rgb * 4.0;
  sum += texture(uTex, vUv - uHalfPixel).rgb;
  sum += texture(uTex, vUv + uHalfPixel).rgb;
  sum += texture(uTex, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  sum += texture(uTex, vUv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  fragColor = vec4(sum * 0.125, 1.0);
}
`;

/** Fast Dual-Kawase Upsample */
export const BLOOM_UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uHalfPixel;
void main() {
  vec2 h = uHalfPixel;
  vec3 sum = vec3(0.0);
  sum += texture(uTex, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  sum += texture(uTex, vUv + vec2(-h.x,  h.y)).rgb * 2.0;
  sum += texture(uTex, vUv + vec2( 0.0,  h.y * 2.0)).rgb;
  sum += texture(uTex, vUv + vec2( h.x,  h.y)).rgb * 2.0;
  sum += texture(uTex, vUv + vec2( h.x * 2.0, 0.0)).rgb;
  sum += texture(uTex, vUv + vec2( h.x, -h.y)).rgb * 2.0;
  sum += texture(uTex, vUv + vec2( 0.0, -h.y * 2.0)).rgb;
  sum += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  fragColor = vec4(sum / 12.0, 1.0);
}
`;

/**
 * Final Optical Composite (SINGLE unified 3D scene — zero layer cross-fading!):
 *   - Subtle velocity-driven radial zoom-blur during rapid dives
 *   - Subtle microscope edge chromatic dispersion
 *   - Creamy Dual-Kawase bloom
 *   - Studio vignette + ACES Filmic tone mapping + fine SEM film grain
 */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform sampler2D uBloomTex;
uniform vec2 uResolution;
uniform float uMotion;
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
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rDist = length(centered);
  vec2 dir = normalize(centered + vec2(0.0001));

  // Subtle microscope edge chromatic dispersion
  float ca = smoothstep(0.40, 0.98, rDist) * (0.0012 + uMotion * 0.0018);
  vec3 base;
  base.r = texture(uTex, vUv + dir * ca).r;
  base.g = texture(uTex, vUv).g;
  base.b = texture(uTex, vUv - dir * ca).b;

  // Gentle optical radial zoom-blur ONLY when actively zooming fast
  if (uMotion > 0.02) {
    vec2 radial = (vUv - 0.5) * (0.011 * uMotion * smoothstep(0.10, 0.88, rDist));
    vec3 acc = base * 0.50;
    acc += texture(uTex, vUv - radial * 0.45).rgb * 0.22;
    acc += texture(uTex, vUv - radial * 0.95).rgb * 0.16;
    acc += texture(uTex, vUv - radial * 1.50).rgb * 0.12;
    base = acc;
  }

  vec3 bloom = texture(uBloomTex, vUv).rgb;
  vec3 col = base + bloom * 0.42;

  // Studio optical lens vignette
  float vig = smoothstep(1.20, 0.32, rDist);
  col *= (0.44 + 0.56 * vig);

  // ACES Filmic Tone Map & Gamma
  col = acesToneMap(col * 0.96);
  col = pow(col, vec3(1.0 / 2.2));

  // Subtle SEM micro-grain (eliminates dark banding)
  float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.012;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;
