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
precision highp sampler2DArray;

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
uniform sampler2DArray uMatTex;
uniform sampler2DArray uMatNormTex;
uniform sampler2D uDieLithoTex;
uniform sampler2D uDieNormTex;
uniform sampler2D uAbfTex;
uniform sampler2D uAbfNormTex;
uniform sampler2D uRamDecalTex;
uniform sampler2D uEnvTex;
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
uniform vec4 uIntroLight; // (lightSweep 0..1, keyIntensity 0..1, rimBoost 1..2.5, wakePulse 0..1)

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

// Roughness-attenuated Fresnel for IBL so matte dielectrics never wash out at grazing angles
vec3 F_SchlickRoughness(float cosTheta, vec3 F0, float rough) {
  return F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Triplanar hardware-mipmapped PBR micro-material sampler (albedo+rough + world-space bump + cavity AO)
void sampleTriplanarMat(
  float layer, vec3 wp, vec3 wn, float scale,
  out vec4 albRough, out vec3 bumpDelta, out float cavAO
) {
  vec3 bw = pow(abs(wn), vec3(4.0));
  bw /= max(bw.x + bw.y + bw.z, 0.0001);

  vec2 uvY = wp.xz * scale;
  vec2 uvX = wp.zy * scale;
  vec2 uvZ = wp.xy * scale;

  vec4 aY = texture(uMatTex, vec3(uvY, layer));
  vec4 aX = texture(uMatTex, vec3(uvX, layer));
  vec4 aZ = texture(uMatTex, vec3(uvZ, layer));
  albRough = aY * bw.y + aX * bw.x + aZ * bw.z;

  vec4 rY = texture(uMatNormTex, vec3(uvY, layer));
  vec4 rX = texture(uMatNormTex, vec3(uvX, layer));
  vec4 rZ = texture(uMatNormTex, vec3(uvZ, layer));

  vec2 tY = rY.rg * 2.0 - 1.0;
  vec2 tX = rX.rg * 2.0 - 1.0;
  vec2 tZ = rZ.rg * 2.0 - 1.0;

  bumpDelta = vec3(tY.x, 0.0, tY.y) * bw.y
            + vec3(0.0, tX.y, tX.x) * bw.x
            + vec3(tZ.x, tZ.y, 0.0) * bw.z;
  cavAO = rY.b * bw.y + rX.b * bw.x + rZ.b * bw.z;
}

// Prefiltered RGBM HDR Studio Softbox + Negative-Fill Environment IBL
vec3 sampleStudioEnv(vec3 dir, float rough, float semMix) {
  vec3 d = normalize(dir);
  float phi = atan(d.z, d.x);
  float theta = acos(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(phi / (2.0 * PI) + 0.5, clamp(theta / PI, 0.002, 0.998));
  float mip = clamp(rough * 5.8, 0.0, 6.0);
  vec4 rgbm = textureLod(uEnvTex, uv, mip);
  vec3 env = rgbm.rgb * (rgbm.a * 8.0);
  // Subtle cool platinum-cyan cleanroom shift in deep SEM scales
  return mix(env, env * vec3(0.90, 0.99, 1.12), semMix * 0.48);
}

// Physically inspired anisotropic Bragg diffraction + thin-film SiO2 interference on bare silicon
vec3 braggDiffraction(vec3 n, vec3 v, vec3 l, float pitchVal, float orientVal, vec2 pos) {
  vec3 h = normalize(l + v);
  float ndotv = max(dot(n, v), 0.0);
  vec2 gAxis = (orientVal < 0.35) ? vec2(1.0, 0.0) : ((orientVal > 0.65) ? vec2(0.0, 1.0) : vec2(0.707, 0.707));
  float gratingShift = abs(dot(h.xz, gAxis)) * 1.45;
  float macroDrift = sin(pos.x * 0.42 - pos.y * 0.34) * 0.18;
  float phase = 1.65 + pitchVal * 1.35 + gratingShift * (0.75 + pitchVal * 0.55) + ndotv * 0.55 + macroDrift;
  vec3 spectral = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.00, 0.31, 0.64)));
  // Real bare silicon stays dark metallic charcoal-slate with crisp sapphire/steel/violet-amber diffraction!
  vec3 bareSi = vec3(0.075, 0.088, 0.112);
  vec3 diffTint = mix(vec3(0.09, 0.16, 0.28), spectral * vec3(0.28, 0.42, 0.62), 0.72);
  return mix(bareSi, diffTint, 0.62);
}

float sampleShadow(vec4 sc, float ndotl) {
  vec3 proj = sc.xyz / sc.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.01 || proj.x > 0.99 || proj.y < 0.01 || proj.y > 0.99 || proj.z > 0.998) {
    return 1.0;
  }
  float bias = max(0.0010 * (1.0 - ndotl), 0.00045);
  float z = proj.z - bias;
  float tx = 1.0 / 2048.0;
  float s = 0.0;
  s += texture(uShadowMap, vec3(proj.xy, z)) * 0.36;
  s += texture(uShadowMap, vec3(proj.xy + vec2( tx * 0.95,  tx * 0.52), z)) * 0.16;
  s += texture(uShadowMap, vec3(proj.xy + vec2(-tx * 0.95, -tx * 0.52), z)) * 0.16;
  s += texture(uShadowMap, vec3(proj.xy + vec2(-tx * 0.52,  tx * 0.95), z)) * 0.16;
  s += texture(uShadowMap, vec3(proj.xy + vec2( tx * 0.52, -tx * 0.95), z)) * 0.16;
  return mix(0.05, 1.0, s);
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

  // Vector-baked 2048x1024 Architectural Die Lithography Atlas sampling (World 0 top faces)
  // During the "First Light" intro, the overhead studio softbox sweeps diagonally across the bare silicon die!
  vec3 steadyKeyDir = normalize(vec3(0.52, 0.84, 0.40));
  vec3 introStartKeyDir = normalize(vec3(-0.82, 0.30, -0.49));
  vec3 keyDir = normalize(mix(introStartKeyDir, steadyKeyDir, clamp(uIntroLight.x, 0.0, 1.0)));
  vec3 rimDir = normalize(vec3(-0.74, 0.46, -0.55));
  vec3 fillDir = normalize(vec3(0.22, 0.52, -0.78));

  vec4 dieFeat = vec4(0.45, 0.50, 0.50, 0.0);
  float dieCavAO = 1.0;
  float dieRoughTex = 0.10;
  float hasDieAtlas = 0.0;
  float matCavAO = 1.0;
  float anisoStrength = 0.0;
  vec3 anisoDir = vec3(1.0, 0.0, 0.0);

  if (
    uZoom < 0.98 &&
    n.y > 0.82 &&
    ((matId > 0.5 && matId < 1.5) ||
      (matId > 3.5 && matId < 4.5 && (ch == 4 || ch == 6)) ||
      (matId > 2.5 && matId < 3.5 && ch == 3))
  ) {
    float dieMask = clamp(1.0 - uSemFactor * 1.15, 0.0, 1.0);
    if (dieMask > 0.01) {
      vec2 tileIdx = vec2(3.0, 1.0); // Base die slab: seal ring + CMP dummy fill
      if (ch == 1) tileIdx = vec2(0.0, 0.0);
      else if (ch == 2) tileIdx = vec2(1.0, 0.0);
      else if (ch == 4) tileIdx = vec2(2.0, 0.0);
      else if (ch == 5) tileIdx = vec2(3.0, 0.0);
      else if (ch == 6) tileIdx = vec2(0.0, 1.0);
      else if (ch == 7) tileIdx = vec2(1.0, 1.0);
      else if (ch == 3) tileIdx = vec2(2.0, 1.0);

      vec2 tileUv = clamp(locUV * 0.5 + 0.5, vec2(0.008), vec2(0.992));
      vec2 atlasUv = (tileIdx + tileUv) * vec2(0.25, 0.50);
      dieFeat = texture(uDieLithoTex, atlasUv);
      vec4 dieN = texture(uDieNormTex, atlasUv);
      vec2 dn = (dieN.rg * 2.0 - 1.0) * 0.58 * dieMask;
      n = normalize(n + vec3(dn.x, 0.0, dn.y));
      dieCavAO = mix(1.0, dieN.b, dieMask);
      dieRoughTex = dieN.a;
      hasDieAtlas = dieMask;
    }
  }

  ndotv = max(dot(n, v), 0.0);

  // Material Evaluation (Physically Calibrated Hybrid Photographic + Vector-Baked PBR Palette)
  vec3 baseCol = vec3(0.018, 0.022, 0.030);
  float rough = 0.38;
  float metal = 0.45;
  float clearcoat = 0.0;
  vec3 emissive = vec3(0.0);
  float studioContactAO = 1.0;

  if (matId < 0.5) {
    // Mat 0: ABF Organic Package Substrate (dielectric green-slate solder mask + 45° copper traces + ENIG vias)
    //        & Infinite Anodized Obsidian Studio Plinth
    float isInterposerTop = step(-0.42, p.y) * step(0.8, n.y);
    float interposerMask = isInterposerTop * (1.0 - uSemFactor) * step(uZoom, 1.05);

    if (interposerMask > 0.01 && abs(p.x) < 5.44 && abs(p.z) < 3.46) {
      vec2 abfUv = clamp((p.xz / vec2(5.42, 3.44)) * 0.5 + 0.5, vec2(0.002), vec2(0.998));
      vec4 abf = texture(uAbfTex, abfUv);
      vec4 abfN = texture(uAbfNormTex, abfUv);
      vec2 an = (abfN.rg * 2.0 - 1.0) * 0.62 * interposerMask;
      n = normalize(n + vec3(an.x, 0.0, an.y));
      ndotv = max(dot(n, v), 0.0);
      matCavAO = mix(1.0, abfN.b, interposerMask * 0.85);

      float trace = abf.r;
      float enig = abf.g;
      float weave = abf.b;
      float busMask = abf.a;

      // Deep dark emerald-slate ABF solder mask (dielectric!) with raised translucent copper traces + gold ENIG rings
      vec3 solderMaskCol = vec3(0.008, 0.021, 0.019) * (0.82 + weave * 0.36);
      vec3 coveredCopper = vec3(0.024, 0.062, 0.044);
      vec3 enigGold = vec3(0.76, 0.56, 0.22);

      baseCol = mix(solderMaskCol, coveredCopper, trace * 0.85);
      baseCol = mix(baseCol, enigGold, enig);
      rough = mix(0.28 - trace * 0.06, 0.16, enig);
      metal = mix(0.02, 0.94, enig);
      clearcoat = (1.0 - enig) * 0.52 * interposerMask;

      // Subtle contact AO hugging the die perimeter, 4x LPDDR5 packages & SMD capacitors on the substrate
      vec2 dDie = max(abs(p.xz) - vec2(3.08, 2.50), vec2(0.0));
      float dieContact = smoothstep(0.0, 0.18, length(dDie));
      vec2 dRam = max(abs(vec2(abs(p.x) - 4.22, abs(p.z) - 1.28)) - vec2(0.78, 1.16), vec2(0.0));
      float ramContact = smoothstep(0.0, 0.18, length(dRam));
      studioContactAO = mix(1.0, 0.38 + 0.62 * min(dieContact, ramContact), interposerMask);

      // Parallel 8-lane LPDDR5 memory bursts along real 45° escape traces & calm DC sheen to SMD caps
      if (busMask > 0.08) {
        if (abs(p.x) > 2.94 && abs(p.z) < 2.42) {
          float lane = floor(p.z * 34.0 / PI);
          float busGroup = floor(lane / 8.0);
          float gh = hash12(vec2(busGroup, sign(p.x) * 7.3 + 1.9));
          if (gh < 0.65) {
            float sTrace = clamp(((abs(p.x) - 2.96) / 0.78) * 2.0 - 1.0, -1.0, 1.0);
            float dir = (fract(gh * 17.3) > 0.5) ? 1.0 : -1.0;
            float tBus = uPulsePhase * (0.68 + gh * 0.35) + gh * 3.1;
            float epoch = floor(tBus);
            float cyc = fract(tBus);
            float bitMask = 0.28 + 0.72 * step(0.36, hash12(vec2(lane, epoch * 1.37 + gh * 9.1)));
            float head = mix(-1.25, 2.25, cyc) * dir;
            float pkt = evalBurstLocal(sTrace, head, dir, 0.26, 0.16);
            emissive += keynoteSignalColor(pkt) * pkt * bitMask * busMask * (0.24 + uMacLoads.w * 0.44);
          }
        } else if (abs(p.z) > 2.40) {
          float dcSwell = 0.72 + 0.28 * sin(p.x * 1.4 - uTime * 1.1);
          emissive += vec3(0.76, 0.38, 0.12) * busMask * dcSwell * (0.08 + max(uMacLoads.x, uMacLoads.z) * 0.16);
        }
      }
    } else {
      // Interposer bevels/sidewalls & deep dielectric wells
      baseCol = vec3(0.010, 0.015, 0.018);
      rough = 0.42;
      metal = 0.04;
      clearcoat = 0.16 * (1.0 - uSemFactor);
    }

    // Infinite Dark-Studio Plinth beneath package & US Quarter (p.y < -0.50)
    if (p.y < -0.50 && n.y > 0.8 && uZoom < 0.65) {
      float plinthMask = smoothstep(0.65, -0.05, uZoom);
      vec2 dPkg = max(abs(p.xz) - vec2(5.48, 3.50), vec2(0.0));
      float pkgDist = length(dPkg);
      float pkgAO = smoothstep(0.0, 1.35, pkgDist);

      float coinDist = max(0.0, length(p.xz - uCoinSpec.xy) - uCoinSpec.z);
      float coinAO = smoothstep(0.0, 0.95, coinDist);

      studioContactAO = mix(1.0, 0.22 + 0.78 * (pkgAO * coinAO), plinthMask);

      // Subtle anodized slate micro-texture & sleek dark-mirror sheen around hero objects
      vec4 plTex = texture(uMatTex, vec3(p.xz * 0.18, 0.0));
      float slateGrain = (plTex.r - 0.18) * 0.012;
      float heroGlow = exp(-0.022 * dot(p.xz, p.xz)) * 0.008 + exp(-0.045 * dot(p.xz - uCoinSpec.xy, p.xz - uCoinSpec.xy)) * 0.006;
      baseCol = vec3(0.008, 0.011, 0.015) + slateGrain + vec3(0.011, 0.016, 0.024) * heroGlow * plinthMask;
      rough = mix(0.42, 0.24, plinthMask * (0.45 + 0.55 * exp(-0.018 * dot(p.xz, p.xz))));
      metal = mix(0.18, 0.34, plinthMask);
      clearcoat = 0.0;

      // Ultra-subtle architectural 10 mm / 50 mm studio scale mat hairlines when zoomed out past Die
      if (uZoom < -0.15) {
        float macroVis = smoothstep(-0.15, -0.95, uZoom);
        vec2 g10 = abs(fract(p.xz / 2.85714 + 0.5) - 0.5) * 2.85714;
        float line10 = 1.0 - smoothstep(0.010, 0.038, min(g10.x, g10.y));
        vec2 g50 = abs(fract(p.xz / 14.2857 + 0.5) - 0.5) * 14.2857;
        float line50 = 1.0 - smoothstep(0.015, 0.052, min(g50.x, g50.y));
        float matFade = exp(-0.00055 * dot(p.xz - uFocusXZ, p.xz - uFocusXZ));
        float grid = (line10 * 0.30 + line50 * 0.72) * macroVis * matFade * pkgAO * coinAO;
        baseCol += vec3(0.026, 0.034, 0.046) * grid;
        rough = mix(rough, 0.22, grid * 0.5);
      }
    }
  } else if (matId < 1.5) {
    // Mat 1: Mirror-Polished Bare Silicon Die + Anisotropic Bragg Diffraction + Optical SiO2 Clearcoat
    vec3 diffCol = braggDiffraction(n, v, keyDir, dieFeat.r, dieFeat.g, p.xz);
    float metalDens = mix(0.82, 0.58 + dieFeat.b * 0.76, hasDieAtlas);
    vec3 macroCol = diffCol * metalDens;
    // Razor-crisp metallic perimeter seal ring on main die slab (ch == 0)
    if (ch == 0 && hasDieAtlas > 0.01 && locBorder > 0.955) {
      macroCol = mix(macroCol, vec3(0.42, 0.46, 0.52), smoothstep(0.955, 0.975, locBorder) * hasDieAtlas);
    }
    baseCol = mix(macroCol, vec3(0.11, 0.14, 0.19) * metalDens, uSemFactor);
    rough = clamp(mix(mix(0.09, dieRoughTex, hasDieAtlas), 0.22, uSemFactor), 0.045, 0.36);
    metal = 0.94;
    clearcoat = (1.0 - uSemFactor) * 0.86;
    matCavAO = dieCavAO;

    if (liveEnergy > 0.05) {
      vec3 glowHue = mix(vec3(0.09, 0.62, 1.02), vec3(0.98, 0.54, 0.16), smoothstep(0.38, 0.88, liveEnergy));
      float traceFactor = (hasDieAtlas > 0.01) ? mix(0.18, 1.32, dieFeat.a) : 0.82;
      emissive = glowHue * pow(liveEnergy, 1.42) * 0.72 * traceFactor;
    }
  } else if (matId < 2.5) {
    // Mat 2: Precision Brushed Titanium / Silicon Crystal / Tungsten-Silver Metal (Layer 2 Macro PBR)
    vec4 tAlb;
    vec3 tBump;
    float tCav;
    sampleTriplanarMat(2.0, p, n, 1.45, tAlb, tBump, tCav);
    n = normalize(n + tBump * 0.44);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = tCav;

    baseCol = vec3(0.34, 0.38, 0.44) * tAlb.rgb;
    rough = clamp(tAlb.a * 0.92, 0.11, 0.34);
    metal = 0.96;
    anisoStrength = 0.55;
    anisoDir = abs(n.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);

    if (ch == 9) {
      emissive = railEmissive;
    } else if (ch == 12 && liveEnergy > 0.01) {
      emissive = keynoteSignalColor(liveEnergy) * pow(liveEnergy, 1.15) * 0.74;
    } else if (gaaWave > 0.01) {
      vec3 gaaCol = mix(keynoteSignalColor(gaaWave), vec3(0.22, 0.44, 1.15) * (0.7 + 0.5 * gaaWave), gaaIsPmos * 0.55);
      emissive = gaaCol * gaaWave * 0.86;
    }
  } else if (matId < 3.5) {
    // Mat 3: Electroplated Polycrystalline Copper Damascene (Layer 1 Macro PBR) / TiN / I/O PHY
    if (ch == 3 && hasDieAtlas > 0.01) {
      // World 0 I/O PHY: planar octagonal spiral inductors & SerDes lanes
      vec3 cuSerdes = mix(vec3(0.46, 0.28, 0.15), vec3(0.76, 0.48, 0.26), dieFeat.b);
      baseCol = cuSerdes;
      rough = clamp(dieRoughTex * 1.15, 0.09, 0.28);
      metal = 0.95;
      clearcoat = 0.45 * hasDieAtlas;
      matCavAO = dieCavAO;
    } else {
      vec4 cAlb;
      vec3 cBump;
      float cCav;
      sampleTriplanarMat(1.0, p, n, 1.35, cAlb, cBump, cCav);
      // Subtle CMP dishing across top of wide damascene copper rails
      vec3 dishBump = (n.y > 0.85 && uZoom > 0.5) ? vec3(-locUV.x * 0.06, 0.0, -locUV.y * 0.06) : vec3(0.0);
      n = normalize(n + cBump * 0.42 + dishBump);
      ndotv = max(dot(n, v), 0.0);
      matCavAO = cCav;

      // Physically calibrated linear rose-copper F0 modulated by real polycrystalline grain texture
      vec3 cuBase = mix(vec3(0.92, 0.54, 0.34), vec3(0.72, 0.44, 0.26), uSemFactor * 0.25);
      // Darker TaN/TiN diffusion barrier liner along metal trench edges
      float linerEdge = smoothstep(0.86, 0.98, locBorder) * smoothstep(0.6, 1.4, uZoom);
      baseCol = mix(cuBase * cAlb.rgb, vec3(0.24, 0.22, 0.24), linerEdge * 0.42);
      rough = clamp(cAlb.a * 0.84 + linerEdge * 0.08, 0.09, 0.34);
      metal = 0.96;
      anisoStrength = 0.35;
      anisoDir = abs(n.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    }

    if (ch == 9) {
      emissive = railEmissive;
    } else if (ch == 11 && liveEnergy > 0.02) {
      float period = 11.5;
      float speed = 2.45 * (0.82 + fract(vExtraA * 5.3) * 0.36);
      float wPos = uPulsePhase * speed + vExtraA * period;
      float dir = (vExtraB >= 0.0) ? 1.0 : -1.0;
      float vertDelay = (1.0 - vLocalAnchor.y) * 0.32;
      float vPkt = evalDigitalBurst(p.x, wPos - vertDelay, dir, period, 0.46, 0.24);
      emissive = keynoteSignalColor(vPkt) * vPkt * liveEnergy * 1.12;
    } else if (liveEnergy > 0.14) {
      float serdesBoost = (ch == 3 && hasDieAtlas > 0.01) ? mix(0.28, 1.35, dieFeat.a) : 1.0;
      emissive = vec3(0.92, 0.50, 0.14) * liveEnergy * 0.24 * serdesBoost;
    }
  } else if (matId < 4.5) {
    // Mat 4: Sputtered Gunmetal Tungsten (W) / SLC SRAM Spine / Neural Engine / Covalent Bonds
    vec3 regionTint = uRegionKind > 1.5
      ? vec3(0.012, 0.018, 0.032)
      : (uRegionKind > 0.5 ? vec3(0.008, 0.022, 0.024) : vec3(0.0));

    if (hasDieAtlas > 0.01) {
      // World 0 SLC 6T SRAM & Neural Engine systolic arrays with crisp Sobel relief & dark Bragg tint
      vec3 darkDiff = braggDiffraction(n, v, keyDir, dieFeat.r, dieFeat.g, p.xz) * 0.62;
      baseCol = mix(vec3(0.055, 0.070, 0.095), darkDiff + vec3(0.05, 0.068, 0.092), 0.72) * (0.58 + dieFeat.b * 0.72) + regionTint;
      rough = clamp(dieRoughTex * 1.15, 0.08, 0.30);
      metal = 0.91;
      clearcoat = 0.68 * hasDieAtlas;
      matCavAO = dieCavAO;
    } else {
      // BEOL/FEOL sputtered tungsten metal fill & GAA gates (Layer 2 micro-grain)
      vec4 wAlb;
      vec3 wBump;
      float wCav;
      sampleTriplanarMat(2.0, p, n, 1.85, wAlb, wBump, wCav);
      n = normalize(n + wBump * 0.38);
      ndotv = max(dot(n, v), 0.0);
      matCavAO = wCav;

      baseCol = (vec3(0.095, 0.112, 0.142) + regionTint) * wAlb.rgb;
      rough = clamp(wAlb.a * 1.12, 0.16, 0.38);
      metal = 0.90;
      anisoStrength = 0.30;
    }

    if (blochGlow > 0.02) {
      emissive = vec3(0.10, 0.62, 1.08) * blochGlow * 1.22;
    } else if (gaaGateField > 0.02) {
      float fieldRim = 0.35 + 0.65 * (bevelMask + pow(1.0 - ndotv, 2.2) * 0.5);
      emissive = vec3(0.12, 0.50, 1.02) * gaaGateField * 0.34 * fieldRim;
    } else if (liveEnergy > 0.08 && ch < 15) {
      float tBoost = (hasDieAtlas > 0.01) ? mix(0.20, 1.25, dieFeat.a) : 1.0;
      emissive = vec3(0.18, 0.52, 0.96) * liveEnergy * 0.34 * tBoost;
    }
  } else if (matId < 5.5) {
    // Mat 5: Cleanroom SEM Etched Crystalline Silicon Wafer Substrate (Dual-Scale Layer 3 Macro PBR)
    vec4 sAlbA, sAlbB;
    vec3 sBumpA, sBumpB;
    float sCavA, sCavB;
    sampleTriplanarMat(3.0, p, n, 0.72, sAlbA, sBumpA, sCavA);
    sampleTriplanarMat(3.0, p, n, 3.10, sAlbB, sBumpB, sCavB);
    n = normalize(n + sBumpA * 0.52 + sBumpB * 0.38);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = mix(sCavA, sCavB, 0.45);

    vec3 semAl = mix(sAlbA.rgb, sAlbB.rgb, 0.42);
    float glint = pow(clamp(semAl.r * 1.15, 0.0, 1.0), 5.0) * 0.14;
    baseCol = vec3(0.105, 0.125, 0.155) * semAl + vec3(0.24, 0.29, 0.38) * glint;
    rough = clamp(mix(sAlbA.a, sAlbB.a, 0.45), 0.30, 0.68);
    metal = 0.36;
  } else if (matId < 6.5) {
    // Mat 6: Emissive Electric-Cyan Signal / Inversion Wave / QCD Gluon Flux
    baseCol = vec3(0.14, 0.54, 0.76);
    rough = 0.15;
    metal = 0.35;
    emissive = vec3(0.09, 0.66, 1.04) * (0.72 + liveEnergy * 0.62 + 0.12 * sin(uTime * 8.0));
  } else if (matId < 7.5) {
    // Mat 7: Silica-Filled Matte-Black LPDDR5 Epoxy Mold Compound (Dielectric! Layer 0 Macro PBR + Laser-Etch Decal)
    vec4 eAlb;
    vec3 eBump;
    float eCav;
    sampleTriplanarMat(0.0, p, n, 1.65, eAlb, eBump, eCav);
    vec3 epBump = eBump * 0.68;

    float laserMask = 0.0;
    float dimpleMask = 0.0;
    if (n.y > 0.82 && uZoom < 1.05) {
      vec2 ramUv = clamp(locUV * 0.5 + 0.5, vec2(0.004), vec2(0.996));
      vec4 dec = texture(uRamDecalTex, ramUv);
      laserMask = dec.r;
      dimpleMask = dec.g;
      vec2 dn = (dec.ba * 2.0 - 1.0) * 0.82;
      epBump += vec3(dn.x, 0.0, dn.y);
    }

    n = normalize(n + epBump);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = eCav * (1.0 - dimpleMask * 0.35);

    // Authentic gritty silica-filled dark charcoal epoxy polymer (metal ~ 0.03, NOT metallic steel!)
    vec3 epoxyCol = vec3(0.016, 0.018, 0.022) + eAlb.rgb * vec3(0.052, 0.056, 0.064);
    // Subtle laser-ablated pale slate-grey IC markings (slightly rougher matte groove!)
    vec3 laserCol = vec3(0.115, 0.124, 0.138);
    baseCol = mix(epoxyCol, laserCol, laserMask * 0.72);
    rough = clamp(mix(eAlb.a, 0.76, laserMask * 0.65), 0.32, 0.82);
    metal = 0.03;

    if (liveEnergy > 0.05) {
      // Whisper-subtle under-package bus reflection along the bottom inner fillet only (keeps epoxy body 100% physical!)
      float baseFillet = smoothstep(-0.18, -0.35, p.y);
      emissive = vec3(0.10, 0.44, 0.94) * liveEnergy * (0.04 + 0.34 * baseFillet);
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
    // Mat 9: Sapphire-Blue High-k HfO2 / 28Si Protons / Bridging Oxygen
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
  } else if (matId < 14.5) {
    // Mat 14: Silicon Nitride (SiN) Dielectric Inner Spacer / Interfacial SiO2 Glassy Liner
    float sheen = pow(1.0 - ndotv, 2.6);
    baseCol = vec3(0.048, 0.082, 0.112) + vec3(0.052, 0.092, 0.128) * sheen;
    rough = 0.18;
    metal = 0.04;
    clearcoat = 0.72;
  } else if (matId < 15.5) {
    // Mat 15: Glossy Warm Tan Barium-Titanate MLCC Ceramic Capacitor Body
    vec4 cerAlb;
    vec3 cerBump;
    float cerCav;
    sampleTriplanarMat(0.0, p, n, 4.5, cerAlb, cerBump, cerCav);
    n = normalize(n + cerBump * 0.18);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = mix(1.0, cerCav, 0.4);
    baseCol = vec3(0.32, 0.19, 0.085) * (0.86 + cerAlb.r * 0.42);
    rough = 0.19;
    metal = 0.0;
    clearcoat = 0.74;
  } else {
    // Mat 16: Bright Silver-Tin (Sn/Ni) Soldered SMD End Termination
    vec4 snAlb;
    vec3 snBump;
    float snCav;
    sampleTriplanarMat(2.0, p, n, 3.2, snAlb, snBump, snCav);
    n = normalize(n + snBump * 0.22);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = mix(1.0, snCav, 0.45);
    baseCol = vec3(0.76, 0.78, 0.81) * (0.78 + snAlb.r * 0.28);
    rough = 0.13;
    metal = 0.96;
  }

  // Machined micro-chamfer edge polish: crisper specular gleam specifically along machined bevels!
  rough = mix(rough, max(0.06, rough * 0.52), bevelMask * 0.76);

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

  // Analytical Height, Crevice, Micro-Cavity & Plinth Contact Ambient Occlusion
  float hAboveFloor = p.y - uFloorY;
  float floorAO = mix(mix(0.26, 0.18, uSemFactor), 1.0, smoothstep(-0.04, 0.40, hAboveFloor));
  float wallAO = mix(mix(0.66, 0.54, uSemFactor), 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float ao = clamp(floorAO * wallAO * studioContactAO * matCavAO, 0.12, 1.0);

  // Studio 3-Point Key / Rim / Fill Lighting + Tight 5-Tap Hardware PCF Soft Shadows
  float ndotlK = max(dot(n, keyDir), 0.0);
  float sh = sampleShadow(vShadowCoord, ndotlK);

  vec3 F0 = mix(vec3(0.04), baseCol, metal);
  vec3 diffAlbedo = baseCol * (1.0 - metal) / PI;

  // Key light (Cook-Torrance GGX + subtle anisotropic stretch on brushed metals)
  vec3 hK = normalize(keyDir + v);
  float ndothK = max(dot(n, hK), 0.0);
  float vdothK = max(dot(v, hK), 0.0);
  vec3 Fk = F_Schlick(vdothK, F0);
  float effRoughK = rough;
  if (anisoStrength > 0.01) {
    vec3 tA = normalize(anisoDir - n * dot(anisoDir, n) + vec3(0.0001));
    float hdotT = dot(hK, tA);
    effRoughK = clamp(rough * mix(1.0, 0.72 + 0.56 * abs(hdotT), anisoStrength), 0.06, 0.5);
  }
  float Dk = D_GGX(ndothK, effRoughK);
  float Gk = G_SchlickGGX(ndotv, ndotlK, effRoughK);
  vec3 specK = (Dk * Gk * Fk) / max(4.0 * ndotv * ndotlK, 0.001);
  vec3 kDk = (vec3(1.0) - Fk);

  // Optional Optical SiO2 / ABF / MLCC Clearcoat Lobe on key light
  float ccSpecK = clearcoat > 0.01 ? (D_GGX(ndothK, 0.07) * 0.28 * F_Schlick(vdothK, vec3(0.04)).r * clearcoat) : 0.0;

  // Rim light (Cook-Torrance GGX — crisp dark-field metallic edge separation!)
  float ndotlR = max(dot(n, rimDir), 0.0);
  vec3 hR = normalize(rimDir + v);
  float ndothR = max(dot(n, hR), 0.0);
  float vdothR = max(dot(v, hR), 0.0);
  vec3 Fr = F_Schlick(vdothR, F0);
  float Dr = D_GGX(ndothR, max(rough * 0.90, 0.06));
  float Gr = G_SchlickGGX(ndotv, ndotlR, rough);
  vec3 specR = (Dr * Gr * Fr) / max(4.0 * ndotv * ndotlR, 0.001);

  float ndotlF = max(dot(n, fillDir), 0.0);

  vec3 keyTint = mix(vec3(1.05, 1.01, 0.96), vec3(0.96, 1.00, 1.06), uSemFactor * 0.5);
  vec3 rimTint = mix(vec3(0.42, 0.72, 1.18), vec3(0.56, 0.82, 1.24), uSemFactor);

  float introKey = clamp(uIntroLight.y, 0.0, 1.0);
  float introRim = max(uIntroLight.z, 1.0);

  vec3 direct = vec3(0.0);
  direct += (kDk * diffAlbedo + specK + vec3(ccSpecK)) * keyTint * (ndotlK * 2.65) * sh * introKey;
  direct += ((vec3(1.0) - Fr) * diffAlbedo * 0.60 + specR * 0.82) * rimTint * (ndotlR * mix(1.38, 1.95, uSemFactor)) * introRim;
  direct += diffAlbedo * ndotlF * vec3(0.24, 0.30, 0.42) * 1.10 * introKey;

  // Prefiltered HDR Studio Softbox + Negative-Fill Environment Reflection + Clearcoat Reflection
  vec3 reflDir = reflect(-v, n);
  vec3 reflCol = sampleStudioEnv(reflDir, rough, uSemFactor);
  vec3 Fenv = F_SchlickRoughness(ndotv, F0, rough);
  float envLift = mix(0.14, 1.0, introKey);
  vec3 envReflection = reflCol * Fenv * mix(0.82, 0.32, rough * rough) * (0.48 + 0.52 * metal) * ao * envLift;
  if (clearcoat > 0.01) {
    vec3 ccEnv = sampleStudioEnv(reflDir, 0.04, uSemFactor);
    float ccF = 0.04 + 0.96 * pow(1.0 - ndotv, 5.0);
    envReflection += ccEnv * ccF * clearcoat * 0.68 * ao * envLift;
  }

  // Subtle machined chamfer glint catching the overhead studio lightbars (accentuated during obsidian opening!)
  vec3 bevelGlint = vec3(0.80, 0.89, 1.04) * bevelMask * pow(1.0 - ndotv, 1.85) * (0.06 + 0.24 * metal) * (0.42 + 0.58 * sh) * ao * mix(introRim * 1.25, 1.0, introKey);

  // Dark-Field / SEM Grazing Rim Light
  vec3 semRim = vec3(0.46, 0.68, 0.96) * pow(1.0 - ndotv, 3.4) * (0.04 + 0.32 * uSemFactor) * ao * introRim;
  vec3 envDiff = sampleStudioEnv(n, 0.95, uSemFactor);
  vec3 ambient = baseCol * (vec3(0.042, 0.056, 0.084) + envDiff * (1.0 - metal) * 0.16) * ao * mix(0.10, 1.0, introKey);

  // First Light silicon ignition wavefront radiating cleanly across the bare die & package substrate
  vec3 wakeGlow = vec3(0.0);
  if (uIntroLight.w > 0.001 && uZoom < 0.75 && p.y > -0.48) {
    float wp = uIntroLight.w;
    float radialR = length(p.xz * vec2(0.84, 1.0));
    float front = wp * 5.8;
    float dWave = radialR - front;
    float crest = exp(-pow(dWave / 0.24, 2.0));
    float tail = exp(-max(-dWave, 0.0) / 0.85) * step(dWave, 0.18);
    float envFade = smoothstep(0.0, 0.10, wp) * (1.0 - smoothstep(0.72, 1.0, wp));
    float dieMaskW = smoothstep(5.6, 2.8, radialR);
    float traceBoost = (hasDieAtlas > 0.01) ? mix(0.28, 1.55, dieFeat.a) : (0.35 + bevelMask * 0.95);
    float pkt = clamp(crest + tail * 0.42, 0.0, 1.0);
    wakeGlow = keynoteSignalColor(pkt) * (crest * 0.78 + tail * 0.24) * traceBoost * dieMaskW * envFade;
  }

  vec3 col = ambient + direct * ao + envReflection + bevelGlint + semRim + emissive * mix(0.12, 1.0, introKey) + wakeGlow;

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
  float focalDelta = abs(camDist - uFocusDist) / max(uFocusDist * 0.62, 0.5);
  float coc = clamp(smoothstep(0.32, 1.32, focalDelta) * uDofStrength, 0.0, 1.0);

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
  float soft = smoothstep(1.12, 2.15, lum);
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
uniform float uIntroExposure;

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

  // Subtle microscope edge chromatic dispersion (kept razor-clean across center 55%)
  float ca = smoothstep(0.52, 1.08, rDist) * (0.0007 + uMotion * 0.0015);
  vec4 centerTex = texture(uTex, vUv);
  vec3 base;
  base.r = texture(uTex, vUv + dir * ca).r;
  base.g = centerTex.g;
  base.b = texture(uTex, vUv - dir * ca).b;

  // Depth-aware Leica / Zeiss macro optical Depth-of-Field (zero cost on sharp center pixels!)
  float coc = centerTex.a;
  if (coc > 0.04) {
    float radiusPx = coc * 3.8;
    vec3 dofAcc = base;
    float wSum = 1.0;
    for (int i = 0; i < 8; i++) {
      float ringScale = (i % 2 == 0) ? 1.0 : 0.58;
      vec2 off = BOKEH_TAPS[i] * (radiusPx * ringScale) * invRes;
      vec4 tap = texture(uTex, clamp(vUv + off, vec2(0.001), vec2(0.999)));
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

  // 5-Tap Contrast-Adaptive Sharpening (CAS) on in-focus pixels for razor-crisp lithography & metallic micro-grain!
  float casAmt = (1.0 - smoothstep(0.04, 0.28, coc)) * (1.0 - smoothstep(0.04, 0.25, uMotion)) * 0.42;
  if (casAmt > 0.01) {
    vec3 nN = texture(uTex, clamp(vUv + vec2(0.0, invRes.y), vec2(0.001), vec2(0.999))).rgb;
    vec3 nS = texture(uTex, clamp(vUv - vec2(0.0, invRes.y), vec2(0.001), vec2(0.999))).rgb;
    vec3 nE = texture(uTex, clamp(vUv + vec2(invRes.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
    vec3 nW = texture(uTex, clamp(vUv - vec2(invRes.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
    vec3 minC = min(base, min(min(nN, nS), min(nE, nW)));
    vec3 maxC = max(base, max(max(nN, nS), max(nE, nW)));
    vec3 amp = clamp(min(minC, 2.0 - maxC) / max(maxC, vec3(0.001)), 0.0, 1.0);
    vec3 wCas = -sqrt(amp) * (0.125 * casAmt);
    base = max((base + (nN + nS + nE + nW) * wCas) / (1.0 + 4.0 * wCas), vec3(0.0));
  }

  vec3 bloom = texture(uBloomTex, vUv).rgb;
  vec3 col = base + bloom * 0.24;

  // Subtle luminous optical halation around the central nuclear pinpoint during the 1,800x empty-space plunge
  if (uVoidPlunge > 0.01) {
    float coreHalo = exp(-rDist * rDist * 18.0);
    float outerSweep = exp(-rDist * rDist * 2.8) * (0.5 + 0.5 * sin(rDist * 28.0 - uTime * 7.5));
    col += (vec3(0.14, 0.56, 1.05) * coreHalo * 0.22 + vec3(0.04, 0.16, 0.36) * outerSweep * 0.08) * uVoidPlunge;
  }

  // Studio optical lens vignette (slightly tighter obsidian framing during opening silhouette)
  float vigOuter = mix(0.92, 1.26, clamp(uIntroExposure, 0.0, 1.0));
  float vig = smoothstep(vigOuter, 0.34, rDist);
  col *= (mix(0.28, 0.50, clamp(uIntroExposure, 0.0, 1.0)) + mix(0.72, 0.50, clamp(uIntroExposure, 0.0, 1.0)) * vig);

  // ACES Filmic Tone Map & Gamma (with silky fade-in from pure #000 on launch)
  col = acesToneMap(col * 1.02 * clamp(uIntroExposure, 0.0, 1.0));
  col = pow(col, vec3(1.0 / 2.2));

  // Fine SEM micro-grain (eliminates dark banding without muddying crisp micro-detail)
  float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.0065;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

/**
 * True sRGB Liquid Glass Optical Pass (ported directly from naughtyduk/liquidGL):
 *   - Runs in display sRGB space AFTER ACES tonemapping so glass clarity & speculars never wash out
 *   - Exact liquidGL two-term bevel optics: offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth
 *   - Exact liquidGL cornerNormal, centreBlend, optical lens magnification, RGB chromatic aberration
 *   - Smooth 16-tap Golden-Angle Vogel disk frost (artifact-free) + 5-tap micro-AA clear droplet mode
 *   - True two-stage stacked lenses (Pass 0 = base capsules/sheets, Pass 1 = elevated droplets refracting Pass 0)
 *   - Fluid pointer surface interaction + drifting liquidGL dual studio specular sheen
 */
export const LIQUID_GL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uResolution;
uniform vec2 uCssSize;
uniform float uTime;
uniform int uPassStage; // 0 = base capsules & sheets (style 0,1), 1 = elevated stacked lenses (style 2)
uniform int uGlassCount;
uniform vec4 uGlassRect[16];   // (cx, cy, halfW, halfH) in DOM CSS px (top-left origin)
uniform vec4 uGlassParams[16]; // (radius, bevelWidthFrac, frost, style*4.0 + alpha)
uniform vec4 uPointerFluid;    // (ptrX, ptrY, velX, velY) in DOM CSS px

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}

float udRoundBox(vec2 p, vec2 b, float r) {
  float rr = min(r, min(b.x, b.y));
  return length(max(abs(p) - b + rr, 0.0)) - rr;
}

vec2 cornerNormal(vec2 p, vec2 b, float r, vec2 fallback) {
  float rr = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + rr;
  vec2 m = max(q, 0.0);
  float l = length(m);
  if (l <= 0.0) return fallback;
  float w = smoothstep(0.0, max(rr * 0.5, 1.0), min(m.x, m.y));
  if (w <= 0.0) return fallback;
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  return normalize(mix(fallback, s * (m / l), w));
}

float edgeFactor(vec2 p_px, vec2 b_px, float r, float bevelWidth, vec2 boxSize) {
  float d = -udRoundBox(p_px, b_px, r);
  float bevel_px = bevelWidth * min(boxSize.x, boxSize.y);
  return 1.0 - smoothstep(0.0, max(bevel_px, 1.0), d);
}

vec3 saturateSrgb(vec3 c, float sat) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(l), c, sat), 0.0, 1.0);
}

vec3 evalLiquidGL(vec3 bgCol, vec2 pGl, vec2 cssSize, vec4 rect, vec4 params) {
  float rawStyle = floor(params.w * 0.25);
  int style = int(rawStyle + 0.5);

  // Stage filtering: pass 0 draws base capsules/sheets, pass 1 draws elevated stacked droplets
  if (uPassStage == 0 && style == 2) return bgCol;
  if (uPassStage == 1 && style != 2) return bgCol;

  float alpha = clamp(params.w - rawStyle * 4.0, 0.0, 1.0);
  if (alpha < 0.005) return bgCol;

  // Convert DOM top-down center to WebGL Y-up CSS pixels
  vec2 centerGl = vec2(rect.x, cssSize.y - rect.y);
  vec2 b_px = max(rect.zw, vec2(1.0));
  vec2 boxSize = b_px * 2.0;
  vec2 originalPoint = pGl - centerGl;
  float radius = min(params.x, min(b_px.x, b_px.y));
  float shadowPad = (style == 2) ? 16.0 : 30.0;

  // Fast AABB rejection
  if (abs(originalPoint.x) > b_px.x + shadowPad || abs(originalPoint.y) > b_px.y + shadowPad) {
    return bgCol;
  }

  // Fluid viscosity pointer deformation (liquidGL deformPoint)
  vec2 p_px = originalPoint;
  vec2 ptrGl = vec2(uPointerFluid.x, cssSize.y - uPointerFluid.y);
  vec2 ptrVelGl = vec2(uPointerFluid.z, -uPointerFluid.w);
  float velMag = length(ptrVelGl);
  if (velMag > 0.0005) {
    float reach = max(min(boxSize.x, boxSize.y) * 1.15, 48.0);
    float infl = 1.0 - smoothstep(0.0, reach, length(pGl - ptrGl));
    p_px -= clamp(ptrVelGl * 0.35, vec2(-10.0), vec2(10.0)) * infl;
  }

  float dmask = udRoundBox(p_px, b_px, radius);
  float inShape = 1.0 - smoothstep(-0.55, 0.55, dmask);
  vec3 col = bgCol;

  // Soft liquidGL elevation shadow outside glass boundary
  if (inShape < 1.0) {
    float shD = udRoundBox(originalPoint - vec2(0.0, (style == 2) ? -2.0 : -6.0), b_px, radius);
    float amb = exp(-max(shD, 0.0) * ((style == 2) ? 0.22 : 0.095));
    float contact = exp(-max(dmask, 0.0) * 0.55);
    float shA = (amb * ((style == 2) ? 0.22 : 0.32) + contact * 0.14) * (1.0 - inShape) * alpha;
    col *= (1.0 - shA);
  }

  if (inShape <= 0.002) {
    return col;
  }

  // Preset optical parameters tuned to naughtyduk/liquidGL demos (menu-bar, frost-specular, audio-player)
  float refraction = (style == 2) ? 0.022 : (style == 1 ? 0.015 : 0.014);
  float bevelDepth = (style == 2) ? 0.062 : (style == 1 ? 0.088 : 0.068);
  float bevelWidth = params.y; // normalized fraction of min(boxSize.x, boxSize.y)
  float aberration = (style == 2) ? 0.95  : (style == 1 ? 0.65  : 0.72);
  float magnify    = (style == 2) ? 1.10  : (style == 1 ? 1.03  : 1.045);
  float frost      = params.z;

  vec2 lensUV = (p_px + b_px) / boxSize; // 0..1 inside lens
  vec2 pNorm = p_px / max(boxSize.y, 1.0);

  // Exact liquidGL two-term optical bevel refraction (gentle lens + sharp pow(edge, 10) crystal rim!)
  float edge = edgeFactor(p_px, b_px, radius, bevelWidth, boxSize);
  float offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth;
  float centreBlend = smoothstep(0.12, 0.44, length(pNorm));
  vec2 refractDir = cornerNormal(p_px, b_px, radius, normalize(pNorm + vec2(1e-6)));
  vec2 offset = refractDir * offsetAmt * centreBlend;

  // Aspect-normalized UV displacement + optical magnification
  vec2 aspectScale = vec2(min(cssSize.x, cssSize.y)) / cssSize;
  vec2 offsetUv = offset * aspectScale;
  vec2 localUV = (lensUV - 0.5) / magnify + 0.5;
  vec2 mapped = (centerGl + (localUV - 0.5) * boxSize) / cssSize;
  vec2 refracted = mapped + offsetUv;
  float oob = max(max(-refracted.x, refracted.x - 1.0), max(-refracted.y, refracted.y - 1.0));
  float blendOob = 1.0 - smoothstep(0.0, 0.01, oob);
  vec2 sampleUV = mix(mapped, refracted, blendOob);

  vec2 chroma = offsetUv * aberration;
  vec3 refrCol;

  if (frost > 0.05) {
    // Smooth 16-tap Golden-Angle Vogel disk frost (zero harsh grain!)
    float radiusCss = frost * 3.0;
    vec2 radUv = vec2(radiusCss) / cssSize;
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    vec3 acc = vec3(0.0);
    const float GOLDEN_ANGLE = 2.39996323;
    for (int i = 0; i < 16; i++) {
      float fi = (float(i) + 0.5) / 16.0;
      float rTap = sqrt(fi);
      float ang = float(i) * GOLDEN_ANGLE + rot;
      vec2 foff = vec2(cos(ang), sin(ang)) * rTap * radUv;
      acc.r += texture(uTex, clamp(sampleUV + foff - chroma, vec2(0.001), vec2(0.999))).r;
      acc.g += texture(uTex, clamp(sampleUV + foff,          vec2(0.001), vec2(0.999))).g;
      acc.b += texture(uTex, clamp(sampleUV + foff + chroma, vec2(0.001), vec2(0.999))).b;
    }
    refrCol = acc / 16.0;
  } else {
    // Pure crystal-clear liquidGL droplet lens (5-tap micro-AA + razor-sharp RGB dispersion!)
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    refrCol = texture(uTex, clamp(sampleUV, vec2(0.001), vec2(0.999))).rgb;
    refrCol += texture(uTex, clamp(sampleUV + vec2( texel.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
    refrCol += texture(uTex, clamp(sampleUV + vec2(-texel.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
    refrCol += texture(uTex, clamp(sampleUV + vec2(0.0,  texel.y), vec2(0.001), vec2(0.999))).rgb;
    refrCol += texture(uTex, clamp(sampleUV + vec2(0.0, -texel.y), vec2(0.001), vec2(0.999))).rgb;
    refrCol /= 5.0;
    refrCol.r = texture(uTex, clamp(sampleUV - chroma, vec2(0.001), vec2(0.999))).r;
    refrCol.b = texture(uTex, clamp(sampleUV + chroma, vec2(0.001), vec2(0.999))).b;
  }

  // Subtle glass vibrancy in true sRGB
  refrCol = saturateSrgb(refrCol, (style == 2) ? 1.18 : 1.15);

  // Clean optical tinting in sRGB (adaptive only for bright highlights so white text stays crisp!)
  float luma = dot(refrCol, vec3(0.2126, 0.7152, 0.0722));
  if (style == 2) {
    // Stacked crystal water droplet (menu-bar lens style): clear + subtle luminous lift
    float brightTame = mix(1.04, 0.74, smoothstep(0.45, 0.95, luma));
    refrCol = refrCol * brightTame + vec3(0.075, 0.082, 0.098) * (1.0 - 0.55 * luma);
  } else if (style == 1) {
    // Translucent dark-glass sheet (Activity / Inspect): clear refracted glass with crisp legibility
    float tintStrength = mix(0.28, 0.56, smoothstep(0.18, 0.85, luma));
    refrCol = mix(refrCol, refrCol * vec3(0.46, 0.50, 0.60), tintStrength) + vec3(0.025, 0.029, 0.038);
  } else {
    // Ultra-clear glass capsule (Toolbar / Zoom Rail / Brand): pure optical clarity!
    float tintStrength = mix(0.14, 0.46, smoothstep(0.25, 0.88, luma));
    refrCol = mix(refrCol, refrCol * vec3(0.55, 0.60, 0.70), tintStrength) + vec3(0.022, 0.026, 0.036);
  }

  // Exact liquidGL drifting dual studio specular sheen (subtle, organic, alive!)
  vec2 lp1 = vec2(sin(uTime * 0.20), cos(uTime * 0.30)) * 0.6 + 0.5;
  vec2 lp2 = vec2(sin(uTime * -0.40 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
  float sheen = 0.0;
  sheen += smoothstep(0.42, 0.0, distance(lensUV, lp1)) * ((style == 2) ? 0.085 : 0.055);
  sheen += smoothstep(0.52, 0.0, distance(lensUV, lp2)) * ((style == 2) ? 0.065 : 0.042);
  refrCol += vec3(sheen);

  // Whisper-thin 0.9px physical glass lip catch-light (true sRGB: crisp specular, zero milky halo!)
  float distIn = max(-dmask, 0.0);
  float rimLine = exp(-pow(distIn / 0.88, 2.0));
  float keyCatch = pow(max(dot(refractDir, normalize(vec2(-0.55, 0.84))), 0.0), 1.9);
  float bncCatch = pow(max(dot(refractDir, normalize(vec2( 0.55,-0.84))), 0.0), 2.1);
  float rimAmt = (0.10 + 0.68 * keyCatch + 0.36 * bncCatch) * ((style == 2) ? 0.58 : 0.38);

  // Subtle interactive cursor catch on the razor edge
  float ptrDist = length(pGl - ptrGl);
  float ptrEdge = exp(-(ptrDist * ptrDist) / (115.0 * 115.0)) * rimLine * 0.28;

  refrCol += vec3(0.95, 0.98, 1.0) * (rimLine * rimAmt + ptrEdge);

  return mix(col, clamp(refrCol, 0.0, 1.0), inShape * alpha);
}

void main() {
  vec3 col = texture(uTex, vUv).rgb;
  if (uGlassCount > 0) {
    vec2 cssSize = max(uCssSize, vec2(1.0));
    vec2 pGl = vUv * cssSize;
    for (int i = 0; i < 16; i++) {
      if (i >= uGlassCount) break;
      col = evalLiquidGL(col, pGl, cssSize, uGlassRect[i], uGlassParams[i]);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;
