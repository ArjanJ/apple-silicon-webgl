/**
 * High-Speed Hardware-Instanced WebGL2 PBR Shaders for Apple Silicon Microscope.
 *
 * Unified Multi-Scale Single-Object Pipeline (ZERO 2D cross-fading!):
 *   Pass 0:  2048px Hardware-PCF Directional Shadow Map (all active nested scales together)
 *   Pass 1A: 4x MSAA HDR (RGBA16F) Opaque Instanced Cook-Torrance GGX PBR + Clearcoat Pass
 *            (packs analytical optical Circle-of-Confusion into alpha for zero-overhead DOF!)
 *   Pass 1B: 4x MSAA HDR Translucent Volumetric Quantum Orbital Pass (preserves opaque CoC alpha)
 *   Pass 2:  Dual-Kawase HDR Bloom (Downsample 1/2 -> 1/4 -> 1/8, Upsample 1/4 -> 1/2)
 *   Pass 3:  Optical Composite (depth-aware bokeh DOF, velocity radial zoom-blur, subtle chromatic
 *            dispersion, creamy Dual-Kawase bloom, void-plunge atmosphere, ACES Filmic tone map, SEM grain)
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
    halfSize.y += load * 0.006;
    center.y += load * 0.003;
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
    liveEnergy = 0.45 + 0.55 * max(uMacLoads.x, max(uMacLoads.z, uNetLoad));
  } else if (ch == 10) {
    float h = param;
    liveEnergy = (h < uMacLoads.x * 0.85 + 0.12) ? (uMacLoads.x * 0.65 * instC.z) : 0.0;
  } else if (ch == 11) {
    liveEnergy = 0.45 + 0.55 * max(uMacLoads.x, max(uMacLoads.z, uNetLoad));
  } else if (ch == 12) {
    // Authentic complementary CMOS dynamic switching current (P = alpha * C * V^2 * f):
    // PMOS (param < 2.25) conducts a brief capacitive pull-up transient on 0->1;
    // NMOS (param >= 2.25) conducts a brief capacitive pull-down transient on 1->0!
    float rate = 1.8 + uMacLoads.x * 4.2;
    float tCell = uTime * rate + hash12(instC.zw * 1.73) * 10.0;
    float tick0 = floor(tCell);
    float f = fract(tCell);
    float thresh = 0.22 + uMacLoads.x * 0.42 + uNetLoad * 0.14;
    float a0 = step(hash12(instC.zw + tick0 * 0.17), thresh);
    float a1 = step(hash12(instC.zw + (tick0 + 1.0) * 0.17), thresh);
    bool isNmos = param >= 2.25;
    float rising = max(0.0, a1 - a0);
    float falling = max(0.0, a0 - a1);
    float switched = isNmos ? falling : rising;
    // Crisp RC charging/discharging current spike at the clock edge + tiny sub-threshold bias
    float spike = switched * smoothstep(0.0, 0.06, f) * exp(-max(f - 0.06, 0.0) * 4.6);
    float hold = (isNmos ? (1.0 - a1) : a1) * 0.06 * uMacLoads.x;
    matId = 2.0;
    liveEnergy = (spike * 0.95 + hold) * (0.55 + 0.45 * uMacLoads.x);
  } else if (ch == 13) {
    float gateActive = clamp(0.22 + uMacLoads.x * 0.95, 0.0, 1.0);
    liveEnergy = (param > 1.5) ? gateActive : (param > 0.5 ? gateActive * 0.22 : 0.0);
  } else if (ch == 14) {
    float gateActive = clamp(0.25 + uMacLoads.x * 1.15, 0.0, 1.0);
    liveEnergy = (param > 0.5) ? gateActive : 0.0;
  } else if (ch == 15) {
    // Silicon Lattice / HfO2 atom: REAL thermal phonon vibration driven by live Mac die temp (uSocTemp)!
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
    float speed = 0.35 + uMacLoads.x * 1.15;
    float prog = fract(uTime * speed + instC.z);
    center.x = mix(-2.25, 2.25, prog);
    center.y += sin(prog * 18.84 + instC.w * 6.28) * 0.11;
    center.z += cos(prog * 12.56 + instC.z * 6.28) * 0.10;
    liveEnergy = 0.75 + uMacLoads.x * 0.5;
  } else if (ch == 19) {
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
    float ph = instC.z;
    float amp = 0.022 + uMacLoads.x * 0.015;
    center.x += sin(uTime * 11.5 + ph * 3.7) * amp;
    center.y += cos(uTime * 13.1 + ph * 5.1) * amp;
    center.z += sin(uTime * 9.7 + ph * 2.9) * amp;
    liveEnergy = param;
  } else if (ch == 22) {
    float phase = instC.z * 6.28318 + instC.w * 4.7;
    float wave = 0.5 + 0.5 * sin(uTime * (2.6 + instC.z * 3.2) + phase);
    float pulse = pow(wave, 2.2);
    halfSize *= (0.28 + 0.92 * pulse);
    center.x += sin(uTime * 4.3 + phase) * 0.014;
    center.y += cos(uTime * 3.9 + phase * 1.3) * 0.014;
    center.z += sin(uTime * 4.7 + phase * 0.7) * 0.014;
    liveEnergy = param * (0.35 + 0.95 * pulse);
  } else if (ch == 23) {
    liveEnergy = param * (0.85 + 0.25 * sin(uTime * 9.5 + length(center) * 5.0));
  }
}

void buildLocalPosAndNorm(
  vec3 aAnchor, vec3 aNorm, vec3 center, vec3 halfSize, float bevelR, int ch,
  out vec3 worldPos, out vec3 worldNorm
) {
  if (ch == 16 || ch == 23) {
    vec3 dir = halfSize;
    float halfLen = length(dir);
    vec3 up = dir / max(halfLen, 0.0001);
    vec3 ref = (abs(up.y) < 0.95) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(ref, up));
    vec3 fwd = cross(right, up);
    float tubeR = bevelR;
    if (ch == 23) {
      tubeR *= 0.82 + 0.34 * sin(aAnchor.y * 6.28318 - uTime * 11.0 + halfLen * 8.0);
    }
    vec3 lp = vec3(aAnchor.x * tubeR, aAnchor.y * halfLen, aAnchor.z * tubeR);
    worldPos = center + right * lp.x + up * lp.y + fwd * lp.z;
    worldNorm = normalize(right * aNorm.x + up * aNorm.y + fwd * aNorm.z);
  } else if (ch == 17) {
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
  if (uHoleBox.z > 0.001) {
    bool isTiledCull = (uHoleMode > 0.5 && uHoleMode < 1.5 && center.y > uHoleMinY);
    bool isRibbonCull = (uHoleMode > 3.5 && abs(center.y) < 0.26 && ch != 18);
    if (isTiledCull || isRibbonCull) {
      float margin = (ch == 16) ? -0.025 : 0.003;
      vec2 d = abs(center.xz - uHoleBox.xy) - (uHoleBox.zw + margin);
      if (max(d.x, d.y) < 0.0) {
        halfSize = vec3(0.0);
        bevelR = 0.0;
      }
    }
  }
  if (uAtomHole.w > 0.001 && (ch == 16 || halfSize.x < 0.60)) {
    float dAtom = length(center - uAtomHole.xyz);
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

${COMMON_INSTANCE_GLSL}

void main() {
  vec3 center, halfSize;
  float bevelR, matId, liveEnergy;
  int ch = int(aInstC.x + 0.5);
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);
  if (matId > 5.5 && matId < 6.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  applyDynamicCutouts(ch, center, halfSize, bevelR);

  if (uYExtrude < 0.999) {
    float ext = max(uYExtrude, 0.001);
    center.y *= ext;
    halfSize.y *= ext;
    bevelR = min(bevelR, halfSize.y * 0.45);
  }

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
out vec3 vLocalAnchor;
flat out float vMatId;
flat out float vLiveEnergy;
flat out float vChanType;
flat out float vParam;
flat out float vExtraA;
flat out float vExtraB;

${COMMON_INSTANCE_GLSL}

void main() {
  vec3 center, halfSize;
  float bevelR, matId, liveEnergy;
  int ch = int(aInstC.x + 0.5);
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);
  applyDynamicCutouts(ch, center, halfSize, bevelR);

  if (uYExtrude < 0.999) {
    float ext = max(uYExtrude, 0.001);
    center.y *= ext;
    halfSize.y *= ext;
    bevelR = min(bevelR, halfSize.y * 0.45);
  }

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
  // Signed local anchor interpolates [-1..+1] across every flat face -> free per-block UVs!
  vLocalAnchor = aAnchor;
  vMatId = matId;
  vLiveEnergy = liveEnergy;
  vChanType = aInstC.x;
  vParam = aInstC.y;
  vExtraA = aInstC.z;
  vExtraB = aInstC.w;

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
in vec3 vLocalAnchor;
flat in float vMatId;
flat in float vLiveEnergy;
flat in float vChanType;
flat in float vParam;
flat in float vExtraA;
flat in float vExtraB;

uniform sampler2DShadow uShadowMap;
uniform sampler2D uCoinTex;
uniform sampler2D uCoinNormTex;
uniform vec4 uCoinSpec; // (cx, cz, radius, hy)
uniform vec2 uFocusXZ;
uniform float uFocusDist;
uniform float uDofStrength;
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
uniform vec4 uHoverBox;   // (cx, cz, hx, hz); subtle hover preview on World 0
uniform vec4 uHoleBox;    // Dynamic recessed aperture (cx, cz, hx, hz)
uniform float uHoleMinY;
uniform float uHoleMode;

out vec4 fragColor;

const float PI = 3.14159265359;

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

// Cook-Torrance GGX Microfacet BRDF helpers
float D_GGX(float ndoth, float rough) {
  float a = max(rough * rough, 0.0025);
  float a2 = a * a;
  float denom = ndoth * ndoth * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom + 0.0001);
}

float G_SchlickGGX(float ndotv, float ndotl, float rough) {
  float r = rough + 1.0;
  float k = (r * r) * 0.125;
  float gv = ndotv / (ndotv * (1.0 - k) + k + 0.0001);
  float gl = ndotl / (ndotl * (1.0 - k) + k + 0.0001);
  return gv * gl;
}

vec3 F_Schlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Roughness-aware Apple Dark-Studio / Dark-Field SEM Environment IBL
vec3 sampleStudioEnv(vec3 dir, float rough, float semMix) {
  float y = clamp(dir.y, -1.0, 1.0);
  float sharp = mix(1.0, 0.18, clamp(rough * 1.15, 0.0, 1.0));
  float widen = mix(0.0, 0.24, rough);

  // Obsidian studio cyclorama gradient
  vec3 horizonCol = mix(vec3(0.006, 0.009, 0.016), vec3(0.012, 0.017, 0.026), semMix);
  vec3 zenithCol = mix(vec3(0.022, 0.032, 0.052), vec3(0.032, 0.044, 0.068), semMix);
  vec3 env = mix(vec3(0.003, 0.004, 0.008), mix(horizonCol, zenithCol, smoothstep(0.0, 0.85, y)), smoothstep(-0.18, 0.45, y));

  // Primary overhead studio softbox (crisp specular band on polished silicon, smooth fill on matte)
  float dKey = dot(dir, normalize(vec3(0.28, 0.92, 0.26)));
  float keyBox = smoothstep(0.84 - widen, 0.985, dKey) * (0.45 + 0.95 * sharp);
  env += vec3(1.22, 1.18, 1.12) * keyBox;

  // Dual elongated Apple-keynote architectural lightbars overhead
  float barCoord1 = abs(dir.x * 0.62 - dir.z * 0.78 - 0.14);
  float bar1 = smoothstep(0.095 + widen * 0.65, 0.012, barCoord1) * smoothstep(0.30, 0.78, y);
  float barCoord2 = abs(dir.x * 0.62 - dir.z * 0.78 + 0.46);
  float bar2 = smoothstep(0.065 + widen * 0.55, 0.010, barCoord2) * smoothstep(0.36, 0.82, y);
  env += vec3(0.82, 0.90, 1.02) * bar1 * (0.28 + 0.58 * sharp);
  env += vec3(0.46, 0.68, 0.98) * bar2 * (0.18 + 0.36 * sharp);

  // Cool platinum-cyan architectural rim reflector (amplified subtly in dark-field SEM depths)
  float dRim = dot(dir, normalize(vec3(-0.78, 0.44, -0.44)));
  float rimBox = smoothstep(0.76 - widen, 0.965, dRim) * (0.45 + 0.65 * sharp);
  env += vec3(0.34, 0.68, 1.24) * rimBox * mix(0.82, 1.18, semMix);

  // Warm tungsten-copper counter-fill softbox
  float dWarm = dot(dir, normalize(vec3(0.76, 0.34, -0.55)));
  float warmBox = smoothstep(0.82 - widen, 0.975, dWarm) * (0.35 + 0.55 * sharp);
  env += vec3(1.02, 0.64, 0.30) * warmBox * mix(0.54, 0.36, semMix);

  return env;
}

vec3 thinFilmSpectral(float ndotv, vec2 pos) {
  float thickness = 2.15 + sin(pos.x * 0.58 - pos.y * 0.42) * 0.44 + hash12(floor(pos * 1.4)) * 0.28;
  float phase = thickness * (0.64 + 0.56 * ndotv);
  vec3 spectral = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.00, 0.33, 0.67)));
  return mix(vec3(0.022, 0.052, 0.115), spectral * vec3(0.36, 0.55, 0.82), 0.64);
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

// RC-filtered 3-bit digital transaction burst along finite conductor [-1..+1] (soft endpoint fades)
float evalBurstLocal(float s, float headPos, float dir, float bitSpacing, float bitWidth) {
  float burst = 0.0;
  for (int b = 0; b < 3; b++) {
    float off = float(b) * bitSpacing;
    float d = (headPos - s) * dir - off;
    float ahead = exp(-pow(max(-d, 0.0) / (bitWidth * 0.48), 2.0));
    float behind = exp(-max(d, 0.0) / bitWidth);
    float bitAmp = (b == 0) ? 1.0 : ((b == 1) ? 0.58 : 0.84);
    burst = max(burst, ((d < 0.0) ? ahead : behind) * bitAmp);
  }
  return burst * smoothstep(1.0, 0.80, abs(s));
}

// Seamless periodic RC-filtered 3-bit digital burst along long BEOL Manhattan signal buses
float evalDigitalBurst(float coord, float wPos, float dir, float period, float bitSpacing, float bitWidth) {
  float phase = fract((wPos - coord * dir) / period) * period;
  float burst = 0.0;
  for (int b = 0; b < 3; b++) {
    float off = float(b) * bitSpacing;
    float d = phase - off;
    float dAhead = (d < 0.0) ? -d : max(0.0, period - d);
    float dBehind = (d >= 0.0) ? d : 99.0;
    float bitAmp = (b == 0) ? 1.0 : ((b == 1) ? 0.60 : 0.84);
    float bitPkt = max(exp(-pow(dAhead / (bitWidth * 0.46), 2.0)), exp(-dBehind / bitWidth));
    burst = max(burst, bitPkt * bitAmp);
  }
  return burst;
}

// Shared complementary CMOS gate voltage V_G in [0..1] for any of the 3 GAA gates in a World 4 cell
float evalGaaGateVoltage(vec3 p, float cpuLoad) {
  vec2 cellId = floor((p.xz + 2.56) / 5.12);
  float localX = mod(p.x + 2.56, 5.12) - 2.56;
  float gIdx = clamp(floor((localX + 1.56) / 1.04), 0.0, 2.0);
  float ph = hash12(cellId * 3.17 + vec2(gIdx * 5.71, 2.31)) * 6.28318;
  float spd = 1.15 + cpuLoad * 2.15 + fract(ph * 1.7) * 0.45;
  return 0.5 + 0.5 * sin(uTime * spd + ph);
}

// Subtle Apple-keynote electric signal palette: sapphire tail -> cyan body -> razor-thin bright core
vec3 keynoteSignalColor(float pkt) {
  vec3 body = mix(vec3(0.05, 0.34, 0.94), vec3(0.24, 0.78, 1.12), pow(pkt, 1.25));
  return body + vec3(0.32, 0.46, 0.58) * pow(pkt, 5.0);
}

void main() {
  vec3 p = vWorldPos;

  // Dynamic recessed aperture discard for nested layers
  if (uHoleBox.z > 0.001 && uHoleMode > 0.5 && uHoleMode < 3.5 && p.y > uHoleMinY) {
    vec2 dHole = abs(p.xz - uHoleBox.xy) - uHoleBox.zw;
    if (max(dHole.x, dHole.y) < 0.0) discard;
  }

  // Machined chamfer edge detector: interpolated normals shorten specifically along 45-degree bevel strips!
  float rawNormLen = length(vNormal);
  vec3 n = vNormal / max(rawNormLen, 0.0001);
  float bevelMask = clamp((0.992 - rawNormLen) * 3.8, 0.0, 1.0);

  vec3 toCam = uCamPos - vScaledPos;
  float camDist = length(toCam);
  vec3 v = toCam / max(camDist, 0.0001);
  float ndotv = max(dot(n, v), 0.0);

  // Translucent Volumetric Quantum Probability Cloud Pass (sp3 lobes, 1s2 core, pion field, QCD bag)
  if (uTranslucent > 0.5) {
    float qWave = 0.5 + 0.5 * sin(length(p) * 8.5 - uTime * 3.8 + vExtraA * 6.28);
    float harmonic = 0.5 + 0.5 * cos(p.x * 6.5 - p.y * 5.2 + p.z * 6.0 + uTime * 2.4);
    float rim = pow(1.0 - ndotv, 1.85);
    float outerCrest = pow(1.0 - ndotv, 4.2);

    // Rich sapphire -> electric ice-cyan -> delicate quantum violet crest
    vec3 cloudHue = mix(vec3(0.05, 0.36, 0.96), vec3(0.32, 0.92, 1.12), rim * 0.74 + qWave * 0.26);
    cloudHue += vec3(0.28, 0.18, 0.65) * outerCrest * (0.45 + 0.55 * harmonic);
    if (uThermal > 0.5) {
      cloudHue = mix(vec3(0.85, 0.22, 0.42), vec3(1.0, 0.78, 0.24), rim * 0.7 + qWave * 0.3);
    }
    float energy = 0.55 + vLiveEnergy * 0.45;
    vec3 glow = cloudHue * (0.09 + rim * 0.98 + qWave * 0.14 + outerCrest * 0.28) * energy;
    float fogDist = length(vScaledPos);
    float fog = exp(-0.015 * fogDist * fogDist);
    float nearCam = smoothstep(0.9, 3.2, camDist);
    float fade = fog * nearCam;
    float alpha = clamp((0.11 + rim * 0.58 + qWave * 0.06) * fade, 0.0, 0.85);
    fragColor = vec4(max(glow * fade, 0.0), alpha);
    return;
  }

  float matId = vMatId;
  float liveEnergy = vLiveEnergy;
  int ch = int(vChanType + 0.5);
  vec2 locUV = vLocalAnchor.xz; // [-1..+1] exact local coordinates across any flat top box face!
  float locBorder = max(abs(locUV.x), abs(locUV.y));

  // Per-pixel Unified RAM inner edge bus glow (Channel 8)
  if (ch == 8) {
    liveEnergy = uMacLoads.w * smoothstep(3.75, 3.44, abs(p.x));
  }

  // Per-pixel Conductor Signal, Clock Mesh & DC Power Delivery directly inside real metal rails (Channel 9)
  vec3 railEmissive = vec3(0.0);
  if (ch == 9) {
    float dir = (vExtraB >= 0.0) ? 1.0 : -1.0;
    float amp = abs(vExtraB);
    if (vParam < 1.5) {
      // World 0 Coherent Fabric Spines: clustered 3-bit cache-line transaction bursts inside silver spines
      bool isX = vParam > 0.5;
      float s = isX ? locUV.x : locUV.y;
      float cCross = isX ? locUV.y : locUV.x;
      float rate = 0.42 + fract(vExtraA * 3.7) * 0.12;
      float cyc = fract(uPulsePhase * rate + vExtraA);
      float head = mix(-1.25, 2.35, cyc) * dir;
      float pkt = evalBurstLocal(s, head, dir, 0.15, 0.085);
      float crossFocus = 0.48 + 0.52 * smoothstep(1.0, 0.0, abs(cCross));
      float faceWeight = 0.42 + 0.58 * smoothstep(0.2, 0.9, n.y);
      railEmissive = keynoteSignalColor(pkt) * pkt * crossFocus * faceWeight * amp * liveEnergy * 1.08;
    } else if (vParam < 3.5) {
      // World 2 BEOL Manhattan Signal Buses (M4-M9): RC-filtered 3-bit digital burst trains
      bool isX = vParam > 2.5;
      float coord = isX ? p.x : p.z;
      float sLocal = isX ? locUV.x : locUV.y;
      float cCross = isX ? locUV.y : locUV.x;
      float period = 11.5;
      float speed = 2.45 * (0.82 + fract(vExtraA * 5.3) * 0.36);
      float wPos = uPulsePhase * speed + vExtraA * period;
      float pkt = evalDigitalBurst(coord, wPos, dir, period, 0.46, 0.21);
      float endFade = smoothstep(1.0, 0.90, abs(sLocal));
      float crossFocus = 0.48 + 0.52 * smoothstep(1.0, 0.0, abs(cCross));
      float faceWeight = 0.40 + 0.60 * smoothstep(0.2, 0.9, n.y);
      railEmissive = keynoteSignalColor(pkt) * pkt * endFade * crossFocus * faceWeight * amp * liveEnergy * 0.98;
    } else if (vParam < 5.5) {
      // DC Power Delivery Rails (VDD/VSS on Worlds 1 & 3): calm ohmic DC sheen + broad IR-drop swell (no fake comets!)
      bool isX = vParam > 4.5;
      float coord = isX ? p.x : p.z;
      float cCross = isX ? locUV.y : locUV.x;
      float swell = 0.68 + 0.32 * sin(coord * 0.52 - uTime * 0.85 + vExtraA * 6.283);
      float dcLevel = (0.14 + 0.28 * max(uMacLoads.x, uMacLoads.z)) * swell;
      float crossFocus = 0.65 + 0.35 * smoothstep(1.0, 0.0, abs(cCross));
      vec3 dcCol = (vExtraB >= 0.0) ? vec3(0.86, 0.44, 0.14) : vec3(0.14, 0.42, 0.78);
      railEmissive = dcCol * dcLevel * crossFocus * amp;
    } else {
      // World 1 M15/M16 Global Synchronous Clock Mesh: symmetric resonant wavefront radiating from center!
      bool isX = vParam > 6.5;
      float coord = isX ? p.x : p.z;
      float sLocal = isX ? locUV.x : locUV.y;
      float cCross = isX ? locUV.y : locUV.x;
      float period = 9.6;
      float wPos = uPulsePhase * 2.25;
      // Symmetric outward propagation from center (abs(coord)) -> authentic H-tree / resonant clock mesh!
      float phase = fract((wPos - abs(coord)) / period) * period;
      float dAhead = max(0.0, period - phase);
      float clkPkt = max(exp(-pow(dAhead / 0.16, 2.0)), exp(-phase / 0.52));
      float endFade = smoothstep(1.0, 0.88, abs(sLocal));
      float crossFocus = 0.48 + 0.52 * smoothstep(1.0, 0.0, abs(cCross));
      float faceWeight = 0.42 + 0.58 * smoothstep(0.2, 0.9, n.y);
      railEmissive = keynoteSignalColor(clkPkt) * clkPkt * endFade * crossFocus * faceWeight * amp * liveEnergy * 0.88;
    }
  }

  // Per-pixel World 4 Complementary GAA-FET Physics:
  // Shared gate voltage V_G inverts all 3 NMOS nanosheets when HIGH, and PMOS nanosheets when LOW!
  float gaaWave = 0.0;
  float gaaIsPmos = 0.0;
  float gaaGateField = 0.0;
  if (ch == 14 && liveEnergy > 0.01) {
    float vGate = evalGaaGateVoltage(p, uMacLoads.x);
    float localX = mod(p.x + 2.56, 5.12) - 2.56;
    float gCenter = clamp(floor((localX + 1.56) / 1.04), 0.0, 2.0) * 1.04 - 1.04;
    // Inversion layer is strongest right under the gate stack and tapers gently toward S/D spacers
    float underGate = smoothstep(0.52, 0.14, abs(localX - gCenter));
    bool isPmos = vParam > 1.5;
    gaaIsPmos = isPmos ? 1.0 : 0.0;
    float cond = isPmos ? smoothstep(0.54, 0.22, vGate) : smoothstep(0.46, 0.78, vGate);
    // Continuous Source->Drain electron drift (NMOS) or Drain->Source hole drift (PMOS) while inverted!
    float driftDir = isPmos ? -1.0 : 1.0;
    float drift = 0.62 + 0.38 * sin(localX * 15.0 * driftDir - uTime * (6.0 + uMacLoads.x * 7.5));
    gaaWave = cond * underGate * drift * liveEnergy;
  } else if (ch == 13 && vParam > 1.5) {
    float vGateSingle = 0.5 + 0.5 * sin(uTime * (1.25 + uMacLoads.x * 2.0));
    float vG = (vParam > 2.5) ? vGateSingle : evalGaaGateVoltage(p, uMacLoads.x);
    gaaGateField = vG * liveEnergy;
  }

  // Delocalized Bloch Electron Wavepacket Interference propagating through Silicon covalent bonds
  float blochGlow = 0.0;
  if (ch == 16 && vLiveEnergy > 0.85) {
    float kSpeed = 4.2 + uMacLoads.x * 6.5;
    float wave1 = sin(p.x * 2.6 - uTime * kSpeed + p.z * 0.9);
    float wave2 = cos(p.x * 5.2 - uTime * kSpeed * 1.35 - p.y * 1.6);
    float env = pow(max(0.0, 0.5 + 0.5 * wave1) * (0.55 + 0.45 * wave2), 2.4);
    blochGlow = env * (0.28 + uMacLoads.x * 0.95);
  }

  // Analytical micro-relief normal perturbation (die lithography lines matching World 1's 0.095 grid)
  float dieLithoPattern = 0.0;
  float dieTraceGlow = 0.0;
  if (uZoom < 0.95 && ((matId > 0.5 && matId < 1.5) || (matId > 3.5 && matId < 4.5)) && n.y > 0.85) {
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

    // Architecture-specific procedural die-shot photolithography per functional block!
    float dieMask = clamp(1.0 - uSemFactor * 1.15, 0.0, 1.0);
    if (dieMask > 0.01 && ch >= 1 && ch <= 7) {
      float guardRail = smoothstep(0.87, 0.94, locBorder);
      if (ch == 1) {
        // P-Core: Split L1 SRAM bank striations (left) + out-of-order ALU/Decode execution sub-tiles (right)
        float isCacheHalf = smoothstep(-0.08, 0.04, -locUV.x);
        float sramCols = smoothstep(0.42, 0.92, abs(sin(locUV.y * 42.0))) * smoothstep(0.15, 0.85, abs(sin(locUV.x * 16.0)));
        float aluGrid = max(
          smoothstep(0.76, 0.96, abs(sin(locUV.x * 22.0))),
          smoothstep(0.76, 0.96, abs(sin(locUV.y * 18.0)))
        );
        float splitSeam = smoothstep(0.06, 0.01, abs(locUV.x + 0.04));
        dieLithoPattern = (mix(aluGrid * 0.72, sramCols * 1.05, isCacheHalf) - splitSeam * 0.35) * dieMask;
        // Restrained live telemetry: glow travels along core perimeter ring + active internal bus lanes
        float coreBus = max(guardRail * 0.85, splitSeam * 0.65 + (1.0 - isCacheHalf) * aluGrid * 0.38);
        dieTraceGlow = coreBus * dieMask;
      } else if (ch == 2) {
        // E-Core: Ultra-dense compact execution sub-cells
        float eCells = smoothstep(0.55, 0.95, abs(sin(locUV.x * 28.0))) * 0.55 +
                       smoothstep(0.65, 0.96, abs(sin(locUV.y * 24.0))) * 0.45;
        dieLithoPattern = eCells * dieMask;
        dieTraceGlow = (guardRail * 0.75 + eCells * 0.25) * dieMask;
      } else if (ch == 4) {
        // System-Level Cache (SLC): Iconic dense parallel 6T SRAM macro bank columns + central wordline
        float bitCols = smoothstep(0.35, 0.92, abs(sin(locUV.x * 36.0)));
        float subBanks = smoothstep(0.10, 0.02, abs(locUV.y));
        float bankRows = smoothstep(0.65, 0.96, abs(sin(locUV.y * 28.0)));
        dieLithoPattern = (bitCols * 0.88 + bankRows * 0.32 - subBanks * 0.40) * dieMask;
        dieTraceGlow = (guardRail * 0.6 + subBanks * 0.7) * dieMask;
      } else if (ch == 5) {
        // GPU Core Array: Symmetric 4-quad TBDR shader execution tiles
        float quadCross = max(smoothstep(0.07, 0.015, abs(locUV.x)), smoothstep(0.07, 0.015, abs(locUV.y)));
        float simdLines = smoothstep(0.50, 0.94, abs(sin(locUV.x * 26.0))) * 0.5 +
                          smoothstep(0.50, 0.94, abs(sin(locUV.y * 26.0))) * 0.5;
        dieLithoPattern = (simdLines * 0.82 - quadCross * 0.35) * dieMask;
        dieTraceGlow = (guardRail * 0.78 + quadCross * 0.45) * dieMask;
      } else if (ch == 6) {
        // 16-Core Neural Engine: Crisp geometric systolic-array matrix dots
        vec2 mac = abs(fract(locUV * 4.5 + 0.5) - 0.5);
        float macTile = 1.0 - smoothstep(0.30, 0.42, max(mac.x, mac.y));
        dieLithoPattern = macTile * 0.85 * dieMask;
        dieTraceGlow = (guardRail * 0.55 + macTile * 0.35) * dieMask;
      } else if (ch == 7) {
        // Display & ProRes Media Engine: Dual structured video codec pipes
        float pipeSplit = smoothstep(0.07, 0.015, abs(locUV.y));
        float codecGrid = smoothstep(0.55, 0.94, abs(sin(locUV.x * 30.0)));
        dieLithoPattern = (codecGrid * 0.70 - pipeSplit * 0.3) * dieMask;
        dieTraceGlow = (guardRail * 0.65 + pipeSplit * 0.45) * dieMask;
      }
    }
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
  float clearcoat = 0.0;
  vec3 emissive = vec3(0.0);
  float studioContactAO = 1.0;

  if (matId < 0.5) {
    // Organic Interposer Substrate + Infinite Anodized Obsidian Studio Plinth
    float isInterposerTop = step(-0.42, p.y) * step(0.8, n.y);
    // Fine copper micro-via fan-out escape traces from die perimeter -> LPDDR5 memory packages
    float fanX = step(2.96, abs(p.x)) * step(abs(p.x), 3.68) * step(abs(p.z), 2.38);
    float fanZ = step(2.42, abs(p.z)) * step(abs(p.z), 2.98) * step(abs(p.x), 3.15);
    float traceX = smoothstep(0.70, 0.94, abs(sin(p.z * 38.0))) * fanX;
    float traceZ = smoothstep(0.70, 0.94, abs(sin(p.x * 38.0))) * fanZ;
    float trace = max(traceX, traceZ) * isInterposerTop * (1.0 - uSemFactor);

    // Subtle organic BGA solder-mask micro-weave on interposer
    float weave = (noise2D(p.xz * 65.0) - 0.5) * 0.008 * isInterposerTop * (1.0 - uSemFactor);
    baseCol = vec3(0.011, 0.016, 0.021) + weave + vec3(0.046, 0.068, 0.052) * trace;
    rough = 0.44 - trace * 0.16;
    metal = 0.24 + trace * 0.48;

    // Parallel 8-lane LPDDR5 memory bursts (fanX) & calm DC decoupling power sheen (fanZ)
    if (trace > 0.04) {
      if (fanX > 0.5) {
        float lane = floor(p.z * 38.0 / PI);
        float busGroup = floor(lane / 8.0);
        float gh = hash12(vec2(busGroup, sign(p.x) * 7.3 + 1.9));
        if (gh < 0.62) {
          float sTrace = clamp(((abs(p.x) - 2.96) / 0.72) * 2.0 - 1.0, -1.0, 1.0);
          float dir = (fract(gh * 17.3) > 0.5) ? 1.0 : -1.0;
          float tBus = uPulsePhase * (0.68 + gh * 0.35) + gh * 3.1;
          float epoch = floor(tBus);
          float cyc = fract(tBus);
          // Synchronized parallel byte-lane burst across 8 adjacent traces, with per-lane 0/1 data bits!
          float bitMask = 0.28 + 0.72 * step(0.36, hash12(vec2(lane, epoch * 1.37 + gh * 9.1)));
          float head = mix(-1.25, 2.25, cyc) * dir;
          float pkt = evalBurstLocal(sTrace, head, dir, 0.26, 0.16);
          emissive += keynoteSignalColor(pkt) * pkt * bitMask * trace * (0.24 + uMacLoads.w * 0.46);
        }
      } else if (fanZ > 0.5) {
        // Real MLCC decoupling capacitors sit on the DC power plane: calm warm ohmic sheen, no racing comets
        float dcSwell = 0.72 + 0.28 * sin(p.x * 1.4 - uTime * 1.1);
        emissive += vec3(0.76, 0.38, 0.12) * trace * dcSwell * (0.08 + max(uMacLoads.x, uMacLoads.z) * 0.16);
      }
    }

    // Infinite Dark-Studio Plinth beneath package & US Quarter (p.y < -0.50)
    if (p.y < -0.50 && n.y > 0.8 && uZoom < 0.65) {
      float plinthMask = smoothstep(0.65, -0.05, uZoom);
      // Soft analytical contact ambient occlusion beneath the package and US Quarter
      vec2 dPkg = max(abs(p.xz) - vec2(5.48, 3.50), vec2(0.0));
      float pkgDist = length(dPkg);
      float pkgAO = smoothstep(0.0, 1.35, pkgDist);

      float coinDist = max(0.0, length(p.xz - uCoinSpec.xy) - uCoinSpec.z);
      float coinAO = smoothstep(0.0, 0.95, coinDist);

      studioContactAO = mix(1.0, 0.24 + 0.76 * (pkgAO * coinAO), plinthMask);

      // Subtle anodized slate micro-texture & sleek dark-mirror sheen around hero objects
      float slateGrain = (noise2D(p.xz * 22.0) - 0.5) * 0.004;
      float heroGlow = exp(-0.022 * dot(p.xz, p.xz)) * 0.009 + exp(-0.045 * dot(p.xz - uCoinSpec.xy, p.xz - uCoinSpec.xy)) * 0.007;
      baseCol = vec3(0.009, 0.012, 0.017) + slateGrain + vec3(0.012, 0.018, 0.026) * heroGlow * plinthMask;
      rough = mix(0.42, 0.25, plinthMask * (0.45 + 0.55 * exp(-0.018 * dot(p.xz, p.xz))));
      metal = mix(0.24, 0.42, plinthMask);

      // Ultra-subtle architectural 10 mm / 50 mm studio scale mat hairlines when zoomed out past Die
      if (uZoom < -0.15) {
        float macroVis = smoothstep(-0.15, -0.95, uZoom);
        vec2 g10 = abs(fract(p.xz / 2.85714 + 0.5) - 0.5) * 2.85714;
        float line10 = 1.0 - smoothstep(0.010, 0.042, min(g10.x, g10.y));
        vec2 g50 = abs(fract(p.xz / 14.2857 + 0.5) - 0.5) * 14.2857;
        float line50 = 1.0 - smoothstep(0.016, 0.058, min(g50.x, g50.y));
        float matFade = exp(-0.00055 * dot(p.xz - uFocusXZ, p.xz - uFocusXZ));
        float grid = (line10 * 0.30 + line50 * 0.72) * macroVis * matFade * pkgAO * coinAO;
        baseCol += vec3(0.026, 0.034, 0.046) * grid;
        rough = mix(rough, 0.22, grid * 0.5);
      }
    }
  } else if (matId < 1.5) {
    // Iridescent Mirror-Polished Thin-Film Silicon Die + Optical SiO2 Clearcoat
    vec3 irid = thinFilmSpectral(ndotv, p.xz + vec2(dieLithoPattern * 0.16, -dieLithoPattern * 0.11));
    float fineGrid = smoothstep(0.6, 0.95, abs(sin(p.x * 58.0))) * 0.12 + smoothstep(0.6, 0.95, abs(sin(p.z * 58.0))) * 0.08;
    float sramBank = step(0.5, fract(p.x * 3.1)) * smoothstep(0.3, 0.8, sin(p.z * 96.0)) * 0.10;
    float lithoBoost = 0.72 + fineGrid + sramBank + dieLithoPattern * 0.34;
    vec3 macroCol = irid * lithoBoost;
    baseCol = mix(macroCol, vec3(0.11, 0.14, 0.19) * (0.85 + fineGrid), uSemFactor);
    rough = clamp(mix(0.12, 0.23, uSemFactor) + fineGrid * 0.07 + abs(dieLithoPattern) * 0.05, 0.08, 0.42);
    metal = 0.93;
    clearcoat = (1.0 - uSemFactor) * 0.82;

    if (liveEnergy > 0.05) {
      vec3 glowHue = mix(vec3(0.09, 0.62, 1.02), vec3(0.98, 0.54, 0.16), smoothstep(0.38, 0.88, liveEnergy));
      // Restrained editorial telemetry: concentrate glow into architectural bus traces & subtle core warmth
      float traceFactor = (dieTraceGlow > 0.001) ? mix(0.24, 1.28, clamp(dieTraceGlow, 0.0, 1.0)) : 0.88;
      emissive = glowHue * pow(liveEnergy, 1.38) * 0.76 * traceFactor;
    }
  } else if (matId < 2.5) {
    // Brushed Titanium / Silicon Crystal / Tungsten-Silver Metal
    float brush = (noise2D(vec2(p.x * 92.0, p.z * 14.0)) - 0.5) * 0.036;
    baseCol = vec3(0.25, 0.29, 0.36) + brush;
    rough = clamp(0.19 + abs(brush) * 1.1, 0.12, 0.34);
    metal = 0.95;
    if (ch == 9) {
      emissive = railEmissive;
    } else if (ch == 12 && liveEnergy > 0.01) {
      emissive = keynoteSignalColor(liveEnergy) * pow(liveEnergy, 1.15) * 0.74;
    } else if (gaaWave > 0.01) {
      vec3 gaaCol = mix(keynoteSignalColor(gaaWave), vec3(0.22, 0.44, 1.15) * (0.7 + 0.5 * gaaWave), gaaIsPmos * 0.55);
      emissive = gaaCol * gaaWave * 0.86;
    }
  } else if (matId < 3.5) {
    // Copper Damascene (BEOL) / Bronze-Slate TiN Work-Function Metal / 28Si Neutrons
    float brush = (noise2D(vec2(p.x * 74.0, p.z * 18.0)) - 0.5) * 0.032;
    // SerDes serpentine copper micro-traces on World 0 I/O PHY strip (ch == 3)
    float serdes = (ch == 3 && uZoom < 0.95 && n.y > 0.8)
      ? smoothstep(0.48, 0.92, abs(sin(locUV.x * 26.0 + sin(locUV.y * 8.0) * 0.8))) * 0.12
      : 0.0;
    baseCol = mix(vec3(0.50, 0.30, 0.12), vec3(0.38, 0.25, 0.12), uSemFactor * 0.32) + brush + serdes;
    rough = 0.20;
    metal = 0.95;
    if (ch == 9) {
      emissive = railEmissive;
    } else if (ch == 11 && liveEnergy > 0.02) {
      // Physically coupled to the M8/M9 X-bus directly overhead: burst descends vertically down the copper via!
      float period = 11.5;
      float speed = 2.45 * (0.82 + fract(vExtraA * 5.3) * 0.36);
      float wPos = uPulsePhase * speed + vExtraA * period;
      float dir = (vExtraB >= 0.0) ? 1.0 : -1.0;
      float vertDelay = (1.0 - vLocalAnchor.y) * 0.32;
      float vPkt = evalDigitalBurst(p.x, wPos - vertDelay, dir, period, 0.46, 0.24);
      emissive = keynoteSignalColor(vPkt) * vPkt * liveEnergy * 1.12;
    } else if (liveEnergy > 0.14) {
      float serdesBoost = (ch == 3) ? (0.45 + serdes * 6.0) : 1.0;
      emissive = vec3(0.92, 0.50, 0.14) * liveEnergy * 0.24 * serdesBoost;
    }
  } else if (matId < 4.5) {
    // Dark Gunmetal Tungsten (W) / SLC SRAM Spine / Neural Engine / Covalent Bonds
    float stripe = smoothstep(0.2, 0.85, sin(p.z * 110.0)) * 0.028;
    vec3 regionTint = uRegionKind > 1.5
      ? vec3(0.012, 0.018, 0.032)
      : (uRegionKind > 0.5 ? vec3(0.008, 0.022, 0.024) : vec3(0.0));
    baseCol = vec3(0.048, 0.062, 0.088) + regionTint + (stripe + dieLithoPattern * 0.055) * (1.0 - uSemFactor);
    rough = clamp(0.26 - dieLithoPattern * 0.06, 0.16, 0.36);
    metal = 0.89;
    clearcoat = (dieLithoPattern > 0.01) ? (1.0 - uSemFactor) * 0.45 : 0.0;
    if (blochGlow > 0.02) {
      emissive = vec3(0.10, 0.62, 1.08) * blochGlow * 1.22;
    } else if (gaaGateField > 0.02) {
      // Restrained gate electric-field glow on active TiN/W GAA collars synchronized with channel inversion
      float fieldRim = 0.35 + 0.65 * (bevelMask + pow(1.0 - ndotv, 2.2) * 0.5);
      emissive = vec3(0.12, 0.50, 1.02) * gaaGateField * 0.34 * fieldRim;
    } else if (liveEnergy > 0.08 && ch < 15) {
      float tBoost = (dieTraceGlow > 0.001) ? mix(0.25, 1.25, clamp(dieTraceGlow, 0.0, 1.0)) : 1.0;
      emissive = vec3(0.18, 0.52, 0.96) * liveEnergy * 0.36 * tBoost;
    }
  } else if (matId < 5.5) {
    // Crystalline Granular SEM Silicon Wafer Substrate
    float g = fbmGrain(p.xz * 12.0);
    float sparkle = pow(noise2D(p.xz * 56.0), 6.0) * 0.24;
    baseCol = vec3(0.085, 0.105, 0.135) * (0.55 + g * 0.85) + vec3(0.25, 0.31, 0.40) * sparkle;
    rough = 0.54;
    metal = 0.38;
  } else if (matId < 6.5) {
    // Emissive Electric-Cyan Signal / Inversion Wave / QCD Gluon Flux
    baseCol = vec3(0.14, 0.54, 0.76);
    rough = 0.15;
    metal = 0.35;
    emissive = vec3(0.09, 0.66, 1.04) * (0.72 + liveEnergy * 0.62 + 0.12 * sin(uTime * 8.0));
  } else if (matId < 7.5) {
    // Matte Satin-Charcoal Unified Memory (LPDDR5) Package with Precision Laser Border & Fiducial
    float epoxyGrain = (noise2D(p.xz * 82.0) - 0.5) * 0.010;
    float laserRim = (n.y > 0.85) ? smoothstep(0.86, 0.895, locBorder) * (1.0 - smoothstep(0.915, 0.945, locBorder)) : 0.0;
    float pin1Dot = (n.y > 0.85) ? (1.0 - smoothstep(0.05, 0.09, length(locUV - vec2(-0.76, -0.78)))) : 0.0;
    float microRows = (n.y > 0.85) ? smoothstep(0.7, 0.96, abs(sin(locUV.y * 24.0))) * 0.008 : 0.0;
    baseCol = vec3(0.026, 0.032, 0.044) + epoxyGrain + microRows + vec3(0.045, 0.056, 0.072) * (laserRim * 0.55 + pin1Dot * 0.95);
    rough = clamp(0.32 - laserRim * 0.10 + abs(epoxyGrain) * 2.0, 0.18, 0.42);
    metal = 0.68 + laserRim * 0.22;
    if (liveEnergy > 0.05) {
      emissive = vec3(0.12, 0.48, 0.98) * liveEnergy * (0.65 + laserRim * 0.45);
    }
  } else if (matId < 8.5) {
    float qWave = 0.5 + 0.5 * sin(length(p) * 8.5 - uTime * 3.8 + vExtraA * 6.28);
    float rim = pow(1.0 - ndotv, 1.65);
    baseCol = vec3(0.03, 0.14, 0.28);
    rough = 0.12;
    metal = 0.20;
    vec3 cloudHue = mix(vec3(0.06, 0.45, 0.96), vec3(0.32, 0.88, 1.05), rim * 0.75 + qWave * 0.25);
    emissive = cloudHue * (0.16 + rim * 1.05 + qWave * 0.16) * (0.65 + liveEnergy * 0.45);
  } else if (matId < 9.5) {
    // Sapphire-Blue High-k HfO2 / 28Si Protons / Bridging Oxygen
    float quark = 0.5 + 0.5 * sin(p.x * 14.0 + uTime * 4.5) * cos(p.y * 14.0 - uTime * 3.7) * sin(p.z * 14.0 + uTime * 4.1);
    float rim = pow(1.0 - ndotv, 2.2);
    baseCol = vec3(0.06, 0.24, 0.54) + vec3(0.08, 0.22, 0.34) * quark;
    rough = 0.16;
    metal = 0.78;
    clearcoat = 0.35;
    emissive = vec3(0.08, 0.46, 1.02) * (0.18 + rim * 0.58 + quark * 0.28) * max(0.25, liveEnergy);
  } else if (matId < 10.5) {
    // Mat 10: Photorealistic US Quarter Dollar (24.26 mm cupronickel clad + 119 milled reeds + copper core)
    vec2 coinD = (p.xz - uCoinSpec.xy) / max(uCoinSpec.z, 0.001);
    float coinAng = atan(coinD.y, coinD.x);
    if (n.y > 0.55) {
      vec2 coinUv = clamp(coinD * 0.5 + 0.5, 0.002, 0.998);
      vec4 cAlbedoRough = texture(uCoinTex, coinUv);
      vec4 cRelief = texture(uCoinNormTex, coinUv);

      vec2 tn = cRelief.rg * 2.0 - 1.0;
      float bumpStrength = 1.72;
      n = normalize(n + vec3(tn.x * bumpStrength, 0.0, tn.y * bumpStrength));
      ndotv = max(dot(n, v), 0.0);

      vec3 linearPhoto = pow(max(cAlbedoRough.rgb, vec3(0.001)), vec3(2.15));
      float texRough = cAlbedoRough.a;
      float cavityAO = cRelief.b;

      vec2 viewXZ = normalize(v.xz + vec2(0.0001));
      vec2 radDir = normalize(coinD + vec2(0.0001));
      float cartwheel = pow(abs(dot(radDir, viewXZ)), 3.4) * (1.0 - texRough * 1.15);

      baseCol = linearPhoto * vec3(1.06, 1.03, 0.97) * (0.86 + cartwheel * 0.26) * mix(0.66, 1.04, cavityAO);
      rough = clamp(texRough * 0.88, 0.13, 0.44);
      metal = mix(0.94, 0.78, texRough);
    } else {
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
      rough = mix(0.19, 0.29, copperCore);
      metal = 0.94;
    }
  } else if (matId < 11.5) {
    // Mat 11: QCD Red Up Quark (u)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.75, 0.14, 0.10);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(1.18, 0.24, 0.12) * (0.55 + rim * 0.88) * max(0.4, liveEnergy);
  } else if (matId < 12.5) {
    // Mat 12: QCD Green Up Quark (u)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.10, 0.68, 0.34);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(0.14, 1.08, 0.52) * (0.55 + rim * 0.88) * max(0.4, liveEnergy);
  } else if (matId < 13.5) {
    // Mat 13: QCD Blue Down Quark (d)
    float rim = pow(1.0 - ndotv, 1.8);
    baseCol = vec3(0.18, 0.28, 0.88);
    rough = 0.14;
    metal = 0.30;
    emissive = vec3(0.28, 0.46, 1.28) * (0.55 + rim * 0.88) * max(0.4, liveEnergy);
  } else {
    // Mat 14: Silicon Nitride (SiN) Dielectric Inner Spacer / Interfacial SiO2 Glassy Liner
    float sheen = pow(1.0 - ndotv, 2.6);
    baseCol = vec3(0.055, 0.088, 0.115) + vec3(0.055, 0.095, 0.13) * sheen;
    rough = 0.20;
    metal = 0.18;
    clearcoat = 0.65;
  }

  // Machined micro-chamfer edge polish: slightly crisper specular & subtle metallic gleam on bevels!
  rough = mix(rough, max(0.08, rough * 0.58), bevelMask * 0.72);

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
    clearcoat *= 0.25;
  }

  // Analytical Height, Crevice & Plinth Contact Ambient Occlusion
  float hAboveFloor = p.y - uFloorY;
  float floorAO = mix(mix(0.28, 0.18, uSemFactor), 1.0, smoothstep(-0.04, 0.42, hAboveFloor));
  float wallAO = mix(mix(0.68, 0.56, uSemFactor), 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float ao = clamp(floorAO * wallAO * studioContactAO, 0.14, 1.0);

  // Studio 3-Point Key / Rim / Fill Lighting + 5-Tap Hardware PCF Soft Shadows
  vec3 keyDir = normalize(vec3(0.52, 0.84, 0.40));
  vec3 rimDir = normalize(vec3(-0.74, 0.46, -0.55));
  vec3 fillDir = normalize(vec3(0.22, 0.52, -0.78));

  float ndotlK = max(dot(n, keyDir), 0.0);
  float sh = sampleShadow(vShadowCoord, ndotlK);

  vec3 F0 = mix(vec3(0.04), baseCol, metal);
  vec3 diffAlbedo = baseCol * (1.0 - metal) / PI;

  // Key light (Cook-Torrance GGX)
  vec3 hK = normalize(keyDir + v);
  float ndothK = max(dot(n, hK), 0.0);
  float vdothK = max(dot(v, hK), 0.0);
  vec3 Fk = F_Schlick(vdothK, F0);
  float Dk = D_GGX(ndothK, rough);
  float Gk = G_SchlickGGX(ndotv, ndotlK, rough);
  vec3 specK = (Dk * Gk * Fk) / max(4.0 * ndotv * ndotlK, 0.001);
  vec3 kDk = (vec3(1.0) - Fk);

  // Optional Optical SiO2 Clearcoat Lobe on key light
  float ccSpecK = clearcoat > 0.01 ? (D_GGX(ndothK, 0.09) * 0.25 * F_Schlick(vdothK, vec3(0.04)).r * clearcoat) : 0.0;

  // Rim light (Cook-Torrance GGX — crisp dark-field metallic edge separation!)
  float ndotlR = max(dot(n, rimDir), 0.0);
  vec3 hR = normalize(rimDir + v);
  float ndothR = max(dot(n, hR), 0.0);
  float vdothR = max(dot(v, hR), 0.0);
  vec3 Fr = F_Schlick(vdothR, F0);
  float Dr = D_GGX(ndothR, max(rough * 0.92, 0.08));
  float Gr = G_SchlickGGX(ndotv, ndotlR, rough);
  vec3 specR = (Dr * Gr * Fr) / max(4.0 * ndotv * ndotlR, 0.001);

  float ndotlF = max(dot(n, fillDir), 0.0);

  vec3 keyTint = mix(vec3(1.05, 1.01, 0.95), vec3(0.96, 1.00, 1.06), uSemFactor * 0.5);
  vec3 rimTint = mix(vec3(0.42, 0.72, 1.18), vec3(0.56, 0.82, 1.24), uSemFactor);

  vec3 direct = vec3(0.0);
  direct += (kDk * diffAlbedo + specK + vec3(ccSpecK)) * keyTint * (ndotlK * 2.85) * sh;
  direct += ((vec3(1.0) - Fr) * diffAlbedo * 0.65 + specR * 0.88) * rimTint * (ndotlR * mix(1.45, 2.05, uSemFactor));
  direct += diffAlbedo * ndotlF * vec3(0.24, 0.30, 0.42) * 1.15;

  // Roughness-modulated Studio Environment Reflection + Clearcoat Reflection
  vec3 reflDir = reflect(-v, n);
  vec3 reflCol = sampleStudioEnv(reflDir, rough, uSemFactor);
  vec3 Fenv = F_Schlick(ndotv, F0);
  vec3 envReflection = reflCol * Fenv * mix(1.0, 0.28, rough * rough) * (0.58 + 0.42 * metal) * ao;
  if (clearcoat > 0.01) {
    vec3 ccEnv = sampleStudioEnv(reflDir, 0.07, uSemFactor);
    float ccF = 0.04 + 0.96 * pow(1.0 - ndotv, 5.0);
    envReflection += ccEnv * ccF * clearcoat * 0.85 * ao;
  }

  // Subtle machined chamfer glint catching the overhead softbox
  vec3 bevelGlint = vec3(0.76, 0.86, 1.02) * bevelMask * pow(1.0 - ndotv, 2.0) * (0.08 + 0.22 * metal) * (0.45 + 0.55 * sh) * ao;

  // Dark-Field / SEM Grazing Rim Light
  vec3 semRim = vec3(0.46, 0.68, 0.96) * pow(1.0 - ndotv, 3.4) * (0.06 + 0.34 * uSemFactor) * ao;
  vec3 ambient = baseCol * vec3(0.055, 0.075, 0.115) * ao;

  vec3 col = ambient + direct * ao + envReflection + bevelGlint + semRim + emissive;

  // Whisper-thin Platinum Hover Frame on World 0 die blocks / US Quarter (before clicking!)
  if (uHoverBox.z > 0.001 && uZoom < 0.85) {
    float hoverVis = clamp(1.0 - max(uZoom, 0.0) * 1.15, 0.0, 1.0);
    float sdfH;
    if (uHoverBox.w < 0.0) {
      sdfH = length(p.xz - uHoverBox.xy) - abs(uHoverBox.w);
    } else {
      vec2 dH = abs(p.xz - uHoverBox.xy) - uHoverBox.zw;
      sdfH = max(dH.x, dH.y);
    }
    float rimH = smoothstep(0.036, 0.006, abs(sdfH)) * (1.0 - smoothstep(0.0, 0.22, sdfH));
    float insideH = step(sdfH, 0.01);
    col += vec3(0.72, 0.84, 0.98) * rimH * 0.42 * hoverVis;
    col += vec3(0.04, 0.06, 0.10) * insideH * 0.28 * hoverVis;
  }

  // Razor-sharp 3D Selection Frame when user clicks a die block or the US Quarter to inspect
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
    float rim = smoothstep(0.046, 0.006, edgeDist) * (1.0 - smoothstep(0.0, 0.25, sdf));
    float pulse = 0.80 + 0.20 * sin(uTime * 4.5);
    col += vec3(0.45, 0.90, 1.28) * rim * pulse * inspectVis;
    col += vec3(0.04, 0.12, 0.22) * inside * 0.42 * inspectVis;
  }

  // Smooth infinite studio fog matching our obsidian backdrop
  float fogDist = length(vScaledPos.xz - uFocusXZ);
  float fog = 1.0 - exp(-uFogDensity * fogDist * fogDist);
  col = mix(col, vec3(0.003, 0.005, 0.009), clamp(fog, 0.0, 1.0));

  // Pack analytical optical microscope Circle-of-Confusion (CoC) into alpha for zero-overhead DOF!
  float focalDelta = abs(camDist - uFocusDist) / max(uFocusDist * 0.56, 0.5);
  float coc = clamp(smoothstep(0.18, 1.15, focalDelta) * uDofStrength, 0.0, 1.0);

  fragColor = vec4(max(col, 0.0), coc);
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
  float soft = smoothstep(0.76, 1.52, lum);
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
 *   - True depth-aware optical microscope bokeh DOF (using CoC packed in HDR alpha!)
 *   - Subtle velocity-driven radial zoom-blur during rapid dives
 *   - Subtle microscope edge chromatic dispersion
 *   - Creamy Dual-Kawase bloom + subtle 1,800x void-plunge atmosphere
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
uniform float uVoidPlunge;

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

const vec2 BOKEH_TAPS[8] = vec2[8](
  vec2( 1.000,  0.000),
  vec2( 0.707,  0.707),
  vec2( 0.000,  1.000),
  vec2(-0.707,  0.707),
  vec2(-1.000,  0.000),
  vec2(-0.707, -0.707),
  vec2( 0.000, -1.000),
  vec2( 0.707, -0.707)
);

void main() {
  vec2 invRes = 1.0 / max(uResolution, vec2(1.0));
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rDist = length(centered);
  vec2 dir = normalize(centered + vec2(0.0001));

  // Subtle microscope edge chromatic dispersion
  float ca = smoothstep(0.42, 1.02, rDist) * (0.0010 + uMotion * 0.0018);
  vec4 centerTex = texture(uTex, vUv);
  vec3 base;
  base.r = texture(uTex, vUv + dir * ca).r;
  base.g = centerTex.g;
  base.b = texture(uTex, vUv - dir * ca).b;

  // Depth-aware Leica / Zeiss macro optical Depth-of-Field (zero cost on sharp center pixels!)
  float coc = centerTex.a;
  if (coc > 0.04) {
    float radiusPx = coc * 4.4;
    vec3 dofAcc = base;
    float wSum = 1.0;
    for (int i = 0; i < 8; i++) {
      float ringScale = (i % 2 == 0) ? 1.0 : 0.58;
      vec2 off = BOKEH_TAPS[i] * (radiusPx * ringScale) * invRes;
      vec4 tap = texture(uTex, clamp(vUv + off, vec2(0.001), vec2(0.999)));
      // Weight by neighbor CoC so razor-sharp foreground subjects never bleed into soft background!
      float w = smoothstep(0.02, 0.25, tap.a) * (0.45 + 0.55 * ringScale);
      dofAcc += tap.rgb * w;
      wSum += w;
    }
    base = mix(base, dofAcc / wSum, smoothstep(0.04, 0.26, coc));
  }

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
  vec3 col = base + bloom * 0.40;

  // Subtle luminous optical halation around the central nuclear pinpoint during the 1,800x empty-space plunge
  if (uVoidPlunge > 0.01) {
    float coreHalo = exp(-rDist * rDist * 18.0);
    float outerSweep = exp(-rDist * rDist * 2.8) * (0.5 + 0.5 * sin(rDist * 28.0 - uTime * 7.5));
    col += (vec3(0.14, 0.56, 1.05) * coreHalo * 0.22 + vec3(0.04, 0.16, 0.36) * outerSweep * 0.08) * uVoidPlunge;
  }

  // Studio optical lens vignette
  float vig = smoothstep(1.24, 0.32, rDist);
  col *= (0.46 + 0.54 * vig);

  // ACES Filmic Tone Map & Gamma
  col = acesToneMap(col * 0.98);
  col = pow(col, vec3(1.0 / 2.2));

  // Subtle SEM micro-grain (eliminates dark banding)
  float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.011;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;
