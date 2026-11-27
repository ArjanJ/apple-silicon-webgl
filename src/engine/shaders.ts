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
    liveEnergy = (h < uLocalLoad * 0.85 + 0.12) ? (uLocalLoad * 0.65 * instC.z) : 0.0;
  } else if (ch == 11) {
    liveEnergy = 0.45 + 0.55 * max(uLocalLoad, max(uMacLoads.z, uNetLoad));
  } else if (ch == 12) {
    // Authentic complementary CMOS / SRAM / DRAM dynamic switching current (P = alpha * C * V^2 * f):
    // Driven by the exact local block's live telemetry (uLocalLoad)!
    float rate = 1.8 + uLocalLoad * 4.2;
    float tCell = uTime * rate + hash12(instC.zw * 1.73) * 10.0;
    float tick0 = floor(tCell);
    float f = fract(tCell);
    float thresh = 0.22 + uLocalLoad * 0.42 + uNetLoad * 0.14;
    float a0 = step(hash12(instC.zw + tick0 * 0.17), thresh);
    float a1 = step(hash12(instC.zw + (tick0 + 1.0) * 0.17), thresh);
    bool isNmos = param >= 2.25;
    float rising = max(0.0, a1 - a0);
    float falling = max(0.0, a0 - a1);
    float switched = isNmos ? falling : rising;
    // Crisp RC charging/discharging current spike at the clock edge + tiny sub-threshold bias
    float spike = switched * smoothstep(0.0, 0.06, f) * exp(-max(f - 0.06, 0.0) * 4.6);
    float hold = (isNmos ? (1.0 - a1) : a1) * 0.06 * uLocalLoad;
    if (matId < 2.5) matId = 2.0;
    liveEnergy = (spike * 0.95 + hold) * (0.55 + 0.45 * uLocalLoad);
  } else if (ch == 13) {
    float gateActive = clamp(0.22 + uLocalLoad * 0.95, 0.0, 1.0);
    liveEnergy = (param > 1.5) ? gateActive : (param > 0.5 ? gateActive * 0.22 : 0.0);
  } else if (ch == 14) {
    float gateActive = clamp(0.25 + uLocalLoad * 1.15, 0.0, 1.0);
    liveEnergy = (param > 0.5) ? gateActive : 0.0;
  } else if (ch == 15) {
    // Silicon Lattice / HfO2 atom: Correlated 3D acoustic phonon plane waves + local zero-point jitter driven by live Mac die temp!
    float lockDamp = (uAtomHole.w > 0.01 && length(center - uAtomHole.xyz) < 0.60) ? 0.0 : 1.0;
    float ph = instC.z;
    float amp = (0.008 + uSocTemp * 0.025 + uLocalLoad * 0.013) * min(1.0, length(halfSize) * 4.6188) * lockDamp;
    float freq = 5.2 + uSocTemp * 6.4;
    // 3 traveling 3D acoustic phonon modes propagating coherently across the (100) silicon crystal
    float w1 = sin(dot(center, vec3(2.15, 0.72, -0.58)) - uTime * freq);
    float w2 = cos(dot(center, vec3(-0.65, 2.35, 1.15)) - uTime * (freq * 1.17) + 1.4);
    float w3 = sin(dot(center, vec3(0.95, -0.82, 2.20)) - uTime * (freq * 0.87) + 2.8);
    vec3 phonon = vec3(w1 * 0.72 + w3 * 0.28, w2 * 0.74 - w1 * 0.26, w3 * 0.72 + w2 * 0.28);
    // Small uncorrelated optical-mode thermal jitter (~24%)
    vec3 optMode = vec3(
      sin(uTime * (freq * 1.42) + ph * 3.1),
      cos(uTime * (freq * 1.57) + ph * 4.7),
      sin(uTime * (freq * 1.31) + ph * 2.3)
    );
    center += (phonon * 0.76 + optMode * 0.24) * amp;
    liveEnergy = param;
  } else if (ch == 16 || ch == 17) {
    liveEnergy = param;
  } else if (ch == 18) {
    float speed = 0.35 + uLocalLoad * 1.15;
    float prog = fract(uTime * speed + instC.z);
    center.x = mix(-2.25, 2.25, prog);
    center.y += sin(prog * 18.84 + instC.w * 6.28) * 0.11;
    center.z += cos(prog * 12.56 + instC.z * 6.28) * 0.10;
    liveEnergy = 0.75 + uLocalLoad * 0.5;
  } else if (ch == 19) {
    float rad = instA.x;
    float inc = instA.y;
    float theta0 = instA.z;
    float speed = param * (0.75 + uLocalLoad * 0.85);
    float ang = theta0 + uTime * speed;
    float precess = instC.z + uTime * 0.28;
    vec3 pOrb = vec3(cos(ang) * rad, sin(ang) * sin(inc) * rad, sin(ang) * cos(inc) * rad);
    float cp = cos(precess), sp = sin(precess);
    center = vec3(pOrb.x * cp - pOrb.z * sp, pOrb.y, pOrb.x * sp + pOrb.z * cp);
    liveEnergy = 0.72 + 0.28 * sin(uTime * 5.0 + instC.z * 9.0);
  } else if (ch == 21) {
    float lockDamp = (uAtomHole.w > 0.01 && length(center - uAtomHole.xyz) < 0.48) ? 0.0 : 1.0;
    float ph = instC.z;
    float amp = (0.022 + uLocalLoad * 0.015) * lockDamp;
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
  float keepCut = 1.0 - clamp(uHoleOpen, 0.0, 1.0);
  if (uHoleBox.z > 0.001 && uHoleOpen > 0.001) {
    bool isTiledCull = (uHoleMode > 0.5 && uHoleMode < 1.5 && center.y > uHoleMinY);
    bool isRibbonCull = (uHoleMode > 3.5 && abs(center.y) < 0.26 && ch != 18);
    if (isTiledCull || isRibbonCull) {
      float margin = (ch == 16) ? -0.025 : 0.003;
      vec2 d = abs(center.xz - uHoleBox.xy) - (uHoleBox.zw + margin);
      if (max(d.x, d.y) < 0.0) {
        halfSize *= keepCut;
        bevelR *= keepCut;
      }
    }
  }
  if (uAtomHole.w > 0.001 && uHoleOpen > 0.001 && (ch == 16 || halfSize.x < 0.60)) {
    float dAtom = length(center - uAtomHole.xyz);
    float cutR = (ch == 16) ? uAtomHole.w : 0.06;
    if (dAtom < cutR) {
      halfSize *= keepCut;
      bevelR *= keepCut;
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
uniform float uStageReveal;
uniform vec3 uStageOffset;
uniform float uAtomRotY;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode;
uniform float uHoleOpen;
uniform vec4 uAtomHole;
uniform vec3 uCamPos;
uniform float uLensClearance;
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uLocalLoad;
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
  if (uStageReveal < 0.999) {
    float rev = clamp(uStageReveal, 0.0, 1.0);
    halfSize *= rev;
    bevelR *= rev;
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
void main() {}
`;

export const SHADOW_CUTOUT_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode;
uniform float uHoleOpen;

void main() {
  if (uHoleBox.z > 0.001 && uHoleOpen > 0.01 && uHoleMode > 0.5 && uHoleMode < 3.5 && vWorldPos.y > uHoleMinY) {
    vec2 openHalf = uHoleBox.zw * smoothstep(0.0, 0.85, uHoleOpen);
    vec2 d = abs(vWorldPos.xz - uHoleBox.xy) - openHalf;
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
uniform float uStageReveal;
uniform vec3 uStageOffset;
uniform float uAtomRotY;
uniform vec4 uHoleBox;
uniform float uHoleMinY;
uniform float uHoleMode;
uniform float uHoleOpen;
uniform vec4 uAtomHole;
uniform vec3 uCamPos;
uniform float uLensClearance;
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uLocalLoad;
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
  if (uStageReveal < 0.999) {
    float rev = clamp(uStageReveal, 0.0, 1.0);
    halfSize *= rev;
    bevelR *= rev;
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

function buildSceneFs(enableHoleDiscard: boolean): string {
  const holeDiscardBlock = enableHoleDiscard
    ? `
  // Planar reflection clip plane (skips studio plinth & anything below mirror plane during reflection pass)
  if (uClipPlane.y > 0.5 && vScaledPos.y < uClipPlane.x) discard;
  // Smooth iris-expanding recessed aperture discard for nested layers
  if (uHoleBox.z > 0.001 && uHoleOpen > 0.01 && uHoleMode > 0.5 && uHoleMode < 3.5 && p.y > uHoleMinY) {
    vec2 openHalf = uHoleBox.zw * smoothstep(0.0, 0.85, uHoleOpen);
    vec2 dHole = abs(p.xz - uHoleBox.xy) - openHalf;
    if (max(dHole.x, dHole.y) < 0.0) discard;
  }`
    : '';
  return `#version 300 es
precision highp float;
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

uniform sampler2D uShadowMap;
uniform float uShadowTexel;
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
uniform sampler2D uPlanarReflTex;
uniform sampler2D uPlanarReflBlurTex;
uniform mat4 uReflViewProj;
uniform float uPlanarReflActive;
uniform vec4 uClipPlane; // (planeY, enabled, 0, 0)
uniform vec4 uCoinSpec; // (cx, cz, radius, hy)
uniform vec2 uDieGridOrigin; // World 0 anchor aligned to World 1 BEOL M12-M16 grid
uniform float uStage0Ratio;  // Exact World 0 -> World 1 physical scale ratio (STAGE_RATIOS[0])
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
uniform float uRegionKind; // 0 = Logic/CPU, 1 = SRAM/SLC, 2 = GPU, 3 = LPDDR5 DRAM
uniform vec4 uMacLoads;
uniform float uLocalLoad;
uniform float uPulsePhase;
uniform vec4 uInspectBox;    // (cx, cz, hx, hz); hx <= 0 means inactive (hz < 0 = circle)
uniform vec4 uHoverBox;      // (cx, cz, hx, hz); smooth studio-light hover focus on World 0
uniform vec4 uHighlightFade; // (hoverAlpha, inspectAlpha, hoverIsRing, inspectIsRing)
uniform vec4 uHoleBox;    // Dynamic recessed aperture (cx, cz, hx, hz)
uniform float uHoleMinY;
uniform float uHoleMode;
uniform float uHoleOpen;
uniform float uStageReveal;
uniform vec4 uIntroLight; // (lightSweep 0..1, keyIntensity 0..1, rimBoost 0.15..2.5, beatPulse 0..1.5)
uniform vec4 uBootA;      // (pwrRails, fabricLock, memTrain, ecoreWake) — all 1.0 when steady
uniform vec4 uBootB;      // (pcoreWake, gpuWake, auxWake, bootActive)   — (1,1,1,0) when steady

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 gbufColor;

const float PI = 3.14159265359;

float ignNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}

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

// True Burley / Heitz Anisotropic GGX NDF for brushed titanium, tungsten & CMP copper
float D_GGX_Anisotropic(float ndoth, float hdotT, float hdotB, float at, float ab) {
  vec3 v = vec3(ab * hdotT, at * hdotB, (at * ab) * ndoth);
  float v2 = dot(v, v);
  float w2 = (at * ab) / max(v2, 1e-6);
  return (at * ab) * w2 * w2 * (1.0 / PI);
}

float G_SchlickGGX(float ndotv, float ndotl, float rough) {
  float r = rough + 1.0;
  float k = (r * r) * 0.125;
  float gv = ndotv / (ndotv * (1.0 - k) + k + 0.0001);
  float gl = ndotl / (ndotl * (1.0 - k) + k + 0.0001);
  return gv * gl;
}

vec3 F_Schlick(float cosTheta, vec3 F0) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return F0 + (1.0 - F0) * (m2 * m2 * m);
}

// Lazanyi / Gulbrandsen F82 Conductor Fresnel (preserves rich rose-copper & ENIG gold edge tint at grazing angles)
vec3 F_ConductorF82(float cosTheta, vec3 F0, vec3 f82Tint) {
  float c = clamp(cosTheta, 0.0, 1.0);
  float m = 1.0 - c;
  float m2 = m * m;
  float m5 = m2 * m2 * m;
  vec3 schlick = F0 + (1.0 - F0) * m5;
  // Dip term peaks at cosTheta = 1/7 (~82 deg) where a = (1 - 1/7)^6 * (1/7) = 0.05669
  float m6 = m5 * m;
  vec3 dip = (1.0 - f82Tint) * (c * m6 * 17.64);
  return max(schlick - dip * F0, vec3(0.0));
}

// Roughness-attenuated Fresnel for IBL so matte dielectrics never wash out at grazing angles
vec3 F_SchlickRoughness(float cosTheta, vec3 F0, float rough) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return F0 + (max(vec3(1.0 - rough), F0) - F0) * (m2 * m2 * m);
}

// Fast 2D Cellular Voronoi for polycrystalline electroplated copper damascene grain facets & boundaries
void voronoiCopperGrain(vec2 p, out vec2 facetTilt, out float grainEdge, out float grainId) {
  vec2 nCell = floor(p);
  vec2 fCell = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 bestId = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = nCell + g;
      vec2 rnd = vec2(hash12(cell + vec2(1.7, 9.2)), hash12(cell + vec2(8.3, 2.8)));
      vec2 diff = g + (0.14 + 0.72 * rnd) - fCell;
      float d = dot(diff, diff);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        bestId = cell;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  grainId = hash12(bestId * 3.17 + vec2(4.1, 11.7));
  facetTilt = vec2(hash12(bestId + vec2(19.3, 7.1)), hash12(bestId + vec2(3.7, 23.9))) * 2.0 - 1.0;
  float borderDist = sqrt(d2) - sqrt(d1);
  grainEdge = 1.0 - smoothstep(0.02, 0.14, borderDist);
}

// Axis-selective Triplanar hardware-mipmapped PBR micro-material sampler (2 fetches on flat faces vs 6!)
void sampleTriplanarMat(
  float layer, vec3 wp, vec3 wn, float scale,
  out vec4 albRough, out vec3 bumpDelta, out float cavAO
) {
  vec3 bw = abs(wn);
  bw = bw * bw;
  bw = bw * bw;
  bw /= max(bw.x + bw.y + bw.z, 0.0001);

  vec3 wps = wp * scale;
  vec3 ddx = dFdx(wps);
  vec3 ddy = dFdy(wps);

  albRough = vec4(0.0);
  bumpDelta = vec3(0.0);
  cavAO = 0.0;

  if (bw.y > 0.005) {
    vec4 aY = textureGrad(uMatTex, vec3(wps.xz, layer), ddx.xz, ddy.xz);
    vec4 rY = textureGrad(uMatNormTex, vec3(wps.xz, layer), ddx.xz, ddy.xz);
    vec2 tY = rY.rg * 2.0 - 1.0;
    albRough += aY * bw.y;
    bumpDelta += vec3(tY.x, 0.0, tY.y) * bw.y;
    cavAO += rY.b * bw.y;
  }
  if (bw.x > 0.005) {
    vec4 aX = textureGrad(uMatTex, vec3(wps.zy, layer), ddx.zy, ddy.zy);
    vec4 rX = textureGrad(uMatNormTex, vec3(wps.zy, layer), ddx.zy, ddy.zy);
    vec2 tX = rX.rg * 2.0 - 1.0;
    albRough += aX * bw.x;
    bumpDelta += vec3(0.0, tX.y, tX.x) * bw.x;
    cavAO += rX.b * bw.x;
  }
  if (bw.z > 0.005) {
    vec4 aZ = textureGrad(uMatTex, vec3(wps.xy, layer), ddx.xy, ddy.xy);
    vec4 rZ = textureGrad(uMatNormTex, vec3(wps.xy, layer), ddx.xy, ddy.xy);
    vec2 tZ = rZ.rg * 2.0 - 1.0;
    albRough += aZ * bw.z;
    bumpDelta += vec3(tZ.x, tZ.y, 0.0) * bw.z;
    cavAO += rZ.b * bw.z;
  }
}

vec2 envDirToUv(vec3 dir) {
  vec3 d = normalize(dir);
  float phi = atan(d.z, d.x);
  float theta = acos(clamp(d.y, -1.0, 1.0));
  return vec2(phi * (0.5 / PI) + 0.5, clamp(theta * (1.0 / PI), 0.002, 0.998));
}

// Prefiltered RGBM HDR Studio Softbox + Negative-Fill Environment IBL
vec3 sampleStudioEnvUv(vec2 uv, float rough, float semMix) {
  float mip = clamp(rough * 5.8, 0.0, 6.0);
  vec4 rgbm = textureLod(uEnvTex, uv, mip);
  vec3 env = rgbm.rgb * (rgbm.a * 8.0);
  // Subtle cool platinum-cyan cleanroom shift in deep SEM scales
  return mix(env, env * vec3(0.90, 0.99, 1.12), semMix * 0.48);
}

// Smooth Gaussian CIE spectral wavelength (380..720 nm) -> linear sRGB (mul-based, zero pow!)
vec3 spectralWavelengthToRgb(float lambdaNm) {
  float dr = (lambdaNm - 605.0) * (1.0 / 48.0);
  float dr2 = (lambdaNm - 442.0) * (1.0 / 26.0);
  float dg = (lambdaNm - 538.0) * (1.0 / 42.0);
  float db = (lambdaNm - 455.0) * (1.0 / 36.0);
  float r = exp(-(dr * dr)) + 0.24 * exp(-(dr2 * dr2));
  float g = exp(-(dg * dg));
  float b = exp(-(db * db));
  float visWindow = smoothstep(375.0, 415.0, lambdaNm) * (1.0 - smoothstep(665.0, 725.0, lambdaNm));
  return vec3(r, g, b) * visWindow;
}

// Physical Airy thin-film interference for SiO2 passivation (n = 1.46) over bare silicon
vec3 airyThinFilmSiO2(float cosThetaI, float thicknessNm) {
  const float invN2 = 1.0 / (1.46 * 1.46);
  float sin2I = max(0.0, 1.0 - cosThetaI * cosThetaI);
  float cosT = sqrt(max(0.001, 1.0 - sin2I * invN2));
  float opd = (2.0 * 1.46) * thicknessNm * cosT;
  vec3 phase = (2.0 * PI * opd) * vec3(1.0 / 630.0, 1.0 / 532.0, 1.0 / 465.0);
  // Half-wave phase shift at SiO2/Si interface -> constructive interference peaks at (m + 0.5)*lambda
  return 0.5 - 0.5 * cos(phase);
}

// Physical 1st/2nd-order optical grating diffraction + Airy SiO2 thin-film interference on delidded silicon
vec3 braggDiffraction(vec3 n, vec3 v, vec3 l, float pitchVal, float orientVal, vec2 pos) {
  vec3 h = normalize(l + v);
  float ndotv = max(dot(n, v), 0.0);
  float ndoth = max(dot(n, h), 0.0);

  // Per-block lithography grating vector (X, Z, or 45-degree diagonal) & sub-micron pitch (540..1180 nm)
  vec2 gAxis = (orientVal < 0.35) ? vec2(1.0, 0.0) : ((orientVal > 0.65) ? vec2(0.0, 1.0) : vec2(0.7071, 0.7071));
  float dPitchNm = mix(540.0, 1180.0, pitchVal);
  float macroFilmDrift = sin(pos.x * 0.42 - pos.y * 0.34) * 18.0;

  // Grating equation: m * lambda = d * |dot(L + V, gAxis)| — skip out-of-band higher orders!
  float gratingProj = abs(dot(l.xz + v.xz, gAxis));
  float opdGrating = dPitchNm * (0.28 + gratingProj * 0.85);
  vec3 gratingSpectrum = vec3(0.0);
  if (opdGrating > 375.0 && opdGrating < 725.0) {
    gratingSpectrum += spectralWavelengthToRgb(opdGrating);
  }
  float opd2 = opdGrating * 0.5;
  if (opd2 > 375.0 && opd2 < 725.0) {
    gratingSpectrum += spectralWavelengthToRgb(opd2) * 0.72;
  }
  float opd3 = opdGrating * 0.333333;
  if (opd3 > 375.0 && opd3 < 725.0) {
    gratingSpectrum += spectralWavelengthToRgb(opd3) * 0.35;
  }
  gratingSpectrum = min(gratingSpectrum, vec3(1.35));

  // Grating flashes strongly near Bragg specular alignment, stays dark mirror-charcoal off-axis!
  float braggLobe = (ndoth * ndoth * sqrt(ndoth)) * (0.35 + 0.65 * smoothstep(0.08, 0.65, gratingProj));
  vec3 thinFilm = airyThinFilmSiO2(ndotv, 155.0 + pitchVal * 115.0 + macroFilmDrift);

  vec3 bareSi = vec3(0.068, 0.078, 0.098);
  vec3 filmTint = mix(bareSi, bareSi * 0.72 + thinFilm * vec3(0.11, 0.16, 0.25), 0.52);
  vec3 diffBounce = gratingSpectrum * vec3(0.32, 0.40, 0.54) * braggLobe;
  return filmTint + diffBounce;
}

// 2-Stage PCSS Variable-Penumbra Soft Shadows (6-tap blocker search + 8-tap IGN-rotated Vogel PCF; 1-tap in planar refl!)
float sampleShadow(vec4 sc, float ndotl) {
  vec3 proj = sc.xyz / sc.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.01 || proj.x > 0.99 || proj.y < 0.01 || proj.y > 0.99 || proj.z > 0.998) {
    return 1.0;
  }
  float bias = max(0.0014 * (1.0 - ndotl), 0.00045);
  float receiverZ = proj.z - bias;
  // Fast 1-tap shadow test during blurred half-res planar reflection pass
  if (uClipPlane.y > 0.5) {
    return mix(0.08, 1.0, step(receiverZ, texture(uShadowMap, proj.xy).r));
  }
  float tx = uShadowTexel;
  float rot = ignNoise(gl_FragCoord.xy) * 6.2831853;
  const float GOLDEN_ANGLE = 2.39996323;

  // Stage 1: Blocker search (6 Vogel taps)
  float blockerSum = 0.0;
  float blockerCount = 0.0;
  float searchRadius = 11.5 * tx;
  for (int i = 0; i < 6; i++) {
    float r = sqrt((float(i) + 0.5) * (1.0 / 6.0)) * searchRadius;
    float a = float(i) * GOLDEN_ANGLE + rot;
    float d = texture(uShadowMap, proj.xy + vec2(cos(a), sin(a)) * r).r;
    if (d < receiverZ) {
      blockerSum += d;
      blockerCount += 1.0;
    }
  }
  if (blockerCount < 0.5) {
    return 1.0;
  }

  // Stage 2: Contact-hardening variable penumbra PCF (8 IGN-rotated Vogel taps)
  float avgBlocker = blockerSum / blockerCount;
  float penumbra = clamp((receiverZ - avgBlocker) * 145.0, 1.05, 10.5) * tx;
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    float r = sqrt((float(i) + 0.5) * 0.125) * penumbra;
    float a = float(i) * GOLDEN_ANGLE + rot + 0.5;
    float d = texture(uShadowMap, proj.xy + vec2(cos(a), sin(a)) * r).r;
    lit += step(receiverZ, d);
  }
  return mix(0.05, 1.0, lit * 0.125);
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
${holeDiscardBlock}

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
    float fade = fog * nearCam * clamp(uStageReveal, 0.0, 1.0);
    float alpha = clamp((0.11 + rim * 0.58 + qWave * 0.06) * fade, 0.0, 0.85);
    fragColor = vec4(max(glow * fade, 0.0), alpha);
    gbufColor = vec4(0.0);
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
      float fabP = uBootA.y;
      float fabGate = 1.0;
      float fabWave = 0.0;
      if (uBootB.w > 0.001) {
        // Outward clock-lock wavefront propagating from the die center along both vertical & horizontal spines
        float radialS = isX ? clamp((abs(p.x) - 0.36) / 2.55, 0.0, 1.0) : clamp(abs(p.z) / 2.28, 0.0, 1.0);
        float front = fabP * 1.28;
        fabGate = smoothstep(radialS - 0.04, radialS + 0.16, front) * smoothstep(0.0, 0.12, fabP);
        float dFront = radialS - (front - 0.10);
        float lockCrest = exp(-pow(dFront / 0.10, 2.0));
        float lockTail = exp(-max(-dFront, 0.0) / 0.36) * step(dFront, 0.06);
        float envF = smoothstep(0.0, 0.08, fabP) * (1.0 - smoothstep(0.84, 1.0, fabP));
        fabWave = (lockCrest * 2.15 + lockTail * 0.55) * envF * uBootB.w;
      }
      railEmissive = keynoteSignalColor(pkt) * pkt * crossFocus * faceWeight * amp * liveEnergy * 1.08 * fabGate * (1.0 - smoothstep(0.36, 0.78, uZoom));
      if (fabWave > 0.001) {
        vec3 lockCol = keynoteSignalColor(clamp(fabWave * 0.72, 0.0, 1.0)) + vec3(0.42, 0.65, 0.85) * smoothstep(0.8, 1.8, fabWave);
        railEmissive += lockCol * fabWave * crossFocus * faceWeight * 1.25;
      }
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
      float dcLevel = (0.14 + 0.28 * max(uLocalLoad, uMacLoads.z)) * swell;
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
    float vGate = evalGaaGateVoltage(p, uLocalLoad);
    float localX = mod(p.x + 2.56, 5.12) - 2.56;
    float gCenter = clamp(floor((localX + 1.56) / 1.04), 0.0, 2.0) * 1.04 - 1.04;
    // Inversion layer is strongest right under the gate stack and tapers gently toward S/D spacers
    float underGate = smoothstep(0.52, 0.14, abs(localX - gCenter));
    bool isPmos = vParam > 1.5;
    gaaIsPmos = isPmos ? 1.0 : 0.0;
    float cond = isPmos ? smoothstep(0.54, 0.22, vGate) : smoothstep(0.46, 0.78, vGate);
    // Continuous Source->Drain electron drift (NMOS) or Drain->Source hole drift (PMOS) while inverted!
    float driftDir = isPmos ? -1.0 : 1.0;
    float drift = 0.62 + 0.38 * sin(localX * 15.0 * driftDir - uTime * (6.0 + uLocalLoad * 7.5));
    gaaWave = cond * underGate * drift * liveEnergy;
  } else if (ch == 13 && vParam > 1.5) {
    float vGateSingle = 0.5 + 0.5 * sin(uTime * (1.25 + uLocalLoad * 2.0));
    float vG = (vParam > 2.5) ? vGateSingle : evalGaaGateVoltage(p, uLocalLoad);
    gaaGateField = vG * liveEnergy;
  }

  // Delocalized Bloch Electron Wavepacket Interference propagating through Silicon covalent bonds
  float blochGlow = 0.0;
  if (ch == 16 && vLiveEnergy > 0.85) {
    float kSpeed = 4.2 + uLocalLoad * 6.5;
    float wave1 = sin(p.x * 2.6 - uTime * kSpeed + p.z * 0.9);
    float wave2 = cos(p.x * 5.2 - uTime * kSpeed * 1.35 - p.y * 1.6);
    float env = pow(max(0.0, 0.5 + 0.5 * wave1) * (0.55 + 0.45 * wave2), 2.4);
    blochGlow = env * (0.28 + uLocalLoad * 0.95);
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
  vec3 conductorF82 = vec3(1.0);
  vec3 nSurf = n; // Unperturbed top surface normal (for mirror-flat SiO2 passivation clearcoat!)

  if (
    uZoom < 1.12 &&
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
      // Sub-surface Snell-refracted SiO2 passivation parallax (n = 1.46):
      // Circuits sit optically beneath the mirror-flat glass passivation layer and shift subtly as you orbit!
      float parallaxFade = (1.0 - smoothstep(0.24, 0.48, uZoom)) * dieMask * smoothstep(0.94, 0.86, locBorder);
      if (parallaxFade > 0.005) {
        vec3 refrV = refract(-v, vec3(0.0, 1.0, 0.0), 1.0 / 1.46);
        vec2 pDir = refrV.xz / max(-refrV.y, 0.35);
        float baseDepth = (ch == 0) ? 0.0035 : 0.0115;
        vec2 uvStep1 = clamp(tileUv + pDir * (baseDepth * 0.55 * parallaxFade), vec2(0.008), vec2(0.992));
        float hEst = texture(uDieNormTex, (tileIdx + uvStep1) * vec2(0.25, 0.50)).b;
        tileUv = clamp(tileUv + pDir * (baseDepth * (1.25 - hEst * 0.65) * parallaxFade), vec2(0.008), vec2(0.992));
      }
      vec2 atlasUv = (tileIdx + tileUv) * vec2(0.25, 0.50);
      dieFeat = texture(uDieLithoTex, atlasUv);
      vec4 dieN = texture(uDieNormTex, atlasUv);
      float macroReliefFade = 1.0 - smoothstep(0.36, 0.66, uZoom);
      vec2 dn = (dieN.rg * 2.0 - 1.0) * 0.62 * dieMask * macroReliefFade;
      n = normalize(n + vec3(dn.x, 0.0, dn.y));
      dieCavAO = mix(1.0, dieN.b, dieMask * macroReliefFade);
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
      float isSilk = step(trace, 0.10) * smoothstep(0.18, 0.55, abf.g);
      float enig = smoothstep(0.25, 0.45, trace) * abf.g;
      float weave = abf.b;
      float busMask = abf.a;

      // Deep dark emerald-slate ABF solder mask (dielectric!) with raised translucent copper traces, gold ENIG rings & matte silkscreen
      vec3 solderMaskCol = vec3(0.008, 0.021, 0.019) * (0.82 + weave * 0.36);
      vec3 coveredCopper = vec3(0.024, 0.062, 0.044);
      vec3 enigGold = vec3(0.76, 0.56, 0.22);
      vec3 silkInk = vec3(0.56, 0.59, 0.63);

      baseCol = mix(solderMaskCol, coveredCopper, trace * 0.85);
      baseCol = mix(baseCol, enigGold, enig);
      baseCol = mix(baseCol, silkInk, isSilk * 0.82);
      // Whisper-subtle glossy no-clean reflow flux sheen halo right around SMD MLCC land zones
      float fluxBandZ = smoothstep(0.24, 0.04, abs(abs(p.z) - 2.86)) * smoothstep(3.15, 2.90, abs(p.x));
      float fluxBandX = smoothstep(0.22, 0.04, abs(abs(p.x) - 3.32)) * smoothstep(2.65, 2.40, abs(p.z));
      float fluxHalo = max(fluxBandZ, fluxBandX) * (0.55 + 0.45 * noise2D(p.xz * 7.5)) * (1.0 - enig);
      rough = mix(mix(0.28 - trace * 0.06 - fluxHalo * 0.09, 0.16, enig), 0.54, isSilk);
      metal = mix(mix(0.02, 0.94, enig), 0.04, isSilk);
      clearcoat = clamp(((1.0 - enig) * (1.0 - isSilk * 0.85) * 0.54 + fluxHalo * 0.24) * interposerMask, 0.0, 0.85);
      conductorF82 = mix(vec3(1.0), vec3(0.92, 0.82, 0.58), enig);

      // Subtle contact AO hugging the die perimeter, 4x LPDDR5 packages & SMD capacitors on the substrate
      vec2 dDie = max(abs(p.xz) - vec2(3.08, 2.50), vec2(0.0));
      float dieContact = smoothstep(0.0, 0.18, length(dDie));
      vec2 dRam = max(abs(vec2(abs(p.x) - 4.22, abs(p.z) - 1.28)) - vec2(0.78, 1.16), vec2(0.0));
      float ramContact = smoothstep(0.0, 0.18, length(dRam));
      studioContactAO = mix(1.0, 0.38 + 0.62 * min(dieContact, ramContact), interposerMask);

      // Parallel 8-lane LPDDR5 memory bursts along real 45° escape traces & calm DC sheen to SMD caps
      if (busMask > 0.08) {
        if (abs(p.x) > 2.94 && abs(p.z) < 2.42) {
          float memP = uBootA.z;
          float memGate = smoothstep(0.10, 0.85, memP);
          float lane = floor(p.z * 34.0 / PI);
          float busGroup = floor(lane / 8.0);
          float gh = hash12(vec2(busGroup, sign(p.x) * 7.3 + 1.9));
          float sTrace = clamp(((abs(p.x) - 2.96) / 0.78) * 2.0 - 1.0, -1.0, 1.0);
          if (gh < 0.65 && memGate > 0.002) {
            float dir = (fract(gh * 17.3) > 0.5) ? 1.0 : -1.0;
            float tBus = uPulsePhase * (0.68 + gh * 0.35) + gh * 3.1;
            float epoch = floor(tBus);
            float cyc = fract(tBus);
            float bitMask = 0.28 + 0.72 * step(0.36, hash12(vec2(lane, epoch * 1.37 + gh * 9.1)));
            float head = mix(-1.25, 2.25, cyc) * dir;
            float pkt = evalBurstLocal(sTrace, head, dir, 0.26, 0.16);
            emissive += keynoteSignalColor(pkt) * pkt * bitMask * busMask * (0.24 + uMacLoads.w * 0.44) * memGate;
          }
          // Cold Boot Stage 3: High-speed parallel LPDDR5 link-training double burst along 45° escape lanes
          if (uBootB.w > 0.001 && memP > 0.001 && memP < 0.999) {
            float trainEnv = smoothstep(0.0, 0.10, memP) * (1.0 - smoothstep(0.76, 1.0, memP));
            float tNorm = sTrace * 0.5 + 0.5;
            float headOut = memP * 1.45;
            float waveOut = exp(-pow((tNorm - headOut) / 0.16, 2.0));
            float headAck = (memP - 0.34) * 1.55;
            float waveAck = exp(-pow(((1.0 - tNorm) - headAck) / 0.16, 2.0)) * step(0.30, memP);
            float laneStagger = 0.55 + 0.45 * hash12(vec2(lane, 4.13));
            float trainPkt = max(waveOut, waveAck * 0.90) * laneStagger;
            emissive += keynoteSignalColor(trainPkt) * trainPkt * busMask * trainEnv * uBootB.w * 1.85;
          }
        } else if (abs(p.z) > 2.40) {
          float pwrP = uBootA.x;
          float pwrGate = smoothstep(0.08, 0.72, pwrP);
          float dcSwell = 0.72 + 0.28 * sin(p.x * 1.4 - uTime * 1.1);
          emissive += vec3(0.76, 0.38, 0.12) * busMask * dcSwell * (0.08 + max(uMacLoads.x, uMacLoads.z) * 0.16) * pwrGate;
          // Cold Boot Stage 1: Dramatic warm amber-gold V_DD inrush charging perimeter power rails in the dark
          if (uBootB.w > 0.001 && pwrP > 0.001 && pwrP < 0.999) {
            float edgeDist = clamp((3.10 - abs(p.x)) / 3.10, 0.0, 1.0);
            float front = pwrP * 1.25;
            float surge = exp(-pow((edgeDist - front) / 0.20, 2.0));
            float pwrEnv = smoothstep(0.0, 0.10, pwrP) * (1.0 - smoothstep(0.70, 1.0, pwrP));
            vec3 amberHot = mix(vec3(1.18, 0.48, 0.10), vec3(1.85, 1.08, 0.42), surge);
            emissive += amberHot * busMask * (surge * 1.55 + 0.24 * pwrGate) * pwrEnv * uBootB.w;
          }
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
      rough = mix(0.42, 0.20, plinthMask * (0.48 + 0.52 * exp(-0.018 * dot(p.xz, p.xz))));
      metal = mix(0.18, 0.34, plinthMask);
      clearcoat = 0.28 * plinthMask;

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

      // True World 0 Planar Reflection of the Apple Silicon package, LPDDR5, MLCC caps & US Quarter!
      if (uPlanarReflActive > 0.01 && uClipPlane.y < 0.5) {
        vec4 rp = uReflViewProj * vec4(vScaledPos, 1.0);
        if (rp.w > 0.001) {
          vec2 reflUv = (rp.xy / rp.w) * 0.5 + 0.5;
          // Subtle anodized obsidian micro-ripple from slate grain
          reflUv += vec2(slateGrain * 0.85, slateGrain * 0.65);
          if (reflUv.x > 0.002 && reflUv.x < 0.998 && reflUv.y > 0.002 && reflUv.y < 0.998) {
            float nearObjDist = min(pkgDist, coinDist);
            float blurMix = clamp(smoothstep(0.0, 2.2, nearObjDist) * 0.74 + rough * 0.45, 0.0, 1.0);
            vec4 reflSharp = texture(uPlanarReflTex, reflUv);
            vec4 reflSoft = texture(uPlanarReflBlurTex, reflUv);
            vec3 planarCol = mix(reflSharp.rgb, reflSoft.rgb, blurMix);
            float planarCov = mix(reflSharp.a, reflSoft.a, blurMix);
            float edgeFade = smoothstep(0.002, 0.06, min(min(reflUv.x, 1.0 - reflUv.x), min(reflUv.y, 1.0 - reflUv.y)));
            float distFade = exp(-0.16 * nearObjDist);
            float fresnelPlinth = 0.16 + 0.52 * pow(1.0 - ndotv, 2.4);
            emissive += planarCol * planarCov * fresnelPlinth * distFade * edgeFade * plinthMask * uPlanarReflActive * 1.35;
          }
        }
      }
    }
  } else if (matId < 1.5) {
    // Mat 1: Mirror-Polished Bare Silicon Die + Anisotropic Bragg Diffraction + Optical SiO2 Clearcoat
    // Vertical diced die sidewalls show authentic matte-crystalline laser-scribed dicing striations!
    if (abs(nSurf.y) < 0.55 && uZoom < 1.05) {
      float grooveY = sin(p.y * 195.0) * 0.5 + 0.5;
      float chipTex = noise2D(vec2((p.x + p.z) * 34.0, p.y * 78.0));
      float microChip = smoothstep(0.68, 0.92, noise2D(vec2((p.x - p.z) * 18.0, p.y * 16.0)));
      vec3 diceBump = vec3(
        (chipTex - 0.5) * 0.22 * (1.0 - abs(n.x)),
        (grooveY - 0.5) * 0.30,
        (chipTex - 0.5) * 0.22 * (1.0 - abs(n.z))
      );
      n = normalize(n + diceBump);
      ndotv = max(dot(n, v), 0.0);
      baseCol = vec3(0.115, 0.128, 0.148) * (0.76 + grooveY * 0.24 + microChip * 0.22);
      rough = clamp(0.36 - microChip * 0.14 + (1.0 - grooveY) * 0.08, 0.18, 0.48);
      metal = 0.78;
      clearcoat = 0.0;
    } else {
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
      clearcoat = (1.0 - uSemFactor) * 0.88;
      matCavAO = dieCavAO;
    }

    float bootGate = 1.0;
    float bootFlash = 0.0;
    if (uBootB.w > 0.001 && uZoom < 0.85) {
      if (ch == 2) {
        // Stage 4A: Efficiency Cores wake first (Boot ROM / iBoot)
        float eP = uBootA.w;
        bootGate = smoothstep(0.06, 0.56, eP);
        bootFlash = exp(-pow((eP - 0.26) / 0.17, 2.0)) * smoothstep(0.0, 0.07, eP) * uBootB.w * 1.28;
      } else if (ch == 1) {
        // Stage 4B: Performance Cores stagger online one by one (P0..P7)
        float pIdxN = clamp(vParam, 0.0, 7.0);
        float cLocal = clamp((uBootB.x - pIdxN * 0.078) / 0.36, 0.0, 1.0);
        bootGate = smoothstep(0.05, 0.52, cLocal);
        bootFlash = exp(-pow((cLocal - 0.26) / 0.18, 2.0)) * smoothstep(0.0, 0.07, cLocal) * uBootB.w * 1.45;
      } else if (ch == 5) {
        // Stage 4C: GPU Core Array sweeps diagonally alive from center fabric outward
        float gDiag = clamp(((p.x - 0.55) * 0.42 + (0.28 - p.z) * 0.30) * 0.62, 0.0, 0.68);
        float gLocal = clamp((uBootB.y - gDiag) / 0.34, 0.0, 1.0);
        bootGate = smoothstep(0.05, 0.52, gLocal);
        bootFlash = exp(-pow((gLocal - 0.28) / 0.18, 2.0)) * smoothstep(0.0, 0.07, gLocal) * uBootB.w * 1.38;
      } else if (ch == 7) {
        // Stage 4D: Display & ProRes Media Engine
        float mLocal = clamp((uBootB.z - 0.22) / 0.52, 0.0, 1.0);
        bootGate = smoothstep(0.05, 0.55, mLocal);
        bootFlash = exp(-pow((mLocal - 0.28) / 0.18, 2.0)) * smoothstep(0.0, 0.07, mLocal) * uBootB.w * 1.15;
      } else if (ch == 0) {
        // Main die seal ring catches a crisp perimeter power-good pulse strictly after fabric ignition begins
        float fabP = uBootA.y;
        float ringWave = exp(-pow((fabP - 0.45) / 0.22, 2.0)) * smoothstep(0.0, 0.08, fabP) * smoothstep(0.935, 0.985, locBorder);
        bootFlash = ringWave * uBootB.w * 1.15;
      }
    }

    float traceFactor = (hasDieAtlas > 0.01) ? mix(0.18, 1.32, dieFeat.a) : 0.82;
    if (liveEnergy > 0.05 && bootGate > 0.002) {
      vec3 glowHue = mix(vec3(0.09, 0.62, 1.02), vec3(0.98, 0.54, 0.16), smoothstep(0.38, 0.88, liveEnergy));
      emissive = glowHue * pow(liveEnergy, 1.42) * 0.72 * traceFactor * bootGate;
    }
    if (bootFlash > 0.002) {
      float sel = (hasDieAtlas > 0.01) ? (pow(dieFeat.a, 1.15) * 1.48 + bevelMask * 0.62) : (0.50 + bevelMask * 0.78);
      vec3 flashCol = mix(vec3(0.10, 0.58, 1.08), vec3(0.72, 0.96, 1.32), clamp(bootFlash * 0.75, 0.0, 1.0));
      emissive += flashCol * bootFlash * sel * 0.92;
    }
  } else if (matId < 2.5) {
    // Mat 2: Precision Brushed Titanium / Tungsten-Silver Metal (Layer 2 Macro PBR)
    //        OR Smooth Quantum Core-Electron Silicon Atom Potential when ch == 15 (zero brushed CNC marks on atoms!)
    if (ch == 15) {
      float atomRim = pow(1.0 - ndotv, 2.4);
      baseCol = mix(vec3(0.11, 0.15, 0.22), vec3(0.26, 0.42, 0.64), atomRim * 0.72);
      rough = 0.14;
      metal = 0.76;
      clearcoat = 0.58;
      emissive = vec3(0.06, 0.24, 0.48) * atomRim * (0.28 + uLocalLoad * 0.24);
    } else {
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
    }

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
      // Polycrystalline Voronoi copper grain facet tilts + directional CMP slurry polish hairlines on BEOL rails!
      float beolZoom = smoothstep(0.55, 1.25, uZoom) * (1.0 - smoothstep(4.8, 5.8, uZoom));
      vec3 grainBump = vec3(0.0);
      float grainRough = 0.0;
      float grainTint = 1.0;
      if (beolZoom > 0.01) {
        vec2 gCoord = (abs(n.y) > 0.5) ? p.xz : ((abs(n.x) > 0.5) ? p.zy : p.xy);
        vec2 fTilt;
        float gEdge, gId;
        voronoiCopperGrain(gCoord * 3.8, fTilt, gEdge, gId);
        // Each electroplated copper crystal facet has a distinct micro-normal orientation
        if (abs(n.y) > 0.5) grainBump = vec3(fTilt.x, 0.0, fTilt.y) * (0.068 * beolZoom);
        else if (abs(n.x) > 0.5) grainBump = vec3(0.0, fTilt.y, fTilt.x) * (0.068 * beolZoom);
        else grainBump = vec3(fTilt.x, fTilt.y, 0.0) * (0.068 * beolZoom);
        // Ultra-fine diagonal CMP slurry micro-scratches across top damascene faces
        if (n.y > 0.85) {
          float scratch = noise2D(vec2(p.x * 26.0 + p.z * 26.0, (p.x - p.z) * 1.6));
          float scratchLine = smoothstep(0.84, 0.97, scratch) * beolZoom;
          grainBump += vec3(0.045, 0.0, -0.045) * scratchLine;
          grainRough += scratchLine * 0.06;
        }
        grainRough += gEdge * 0.11 * beolZoom + (gId - 0.5) * 0.05 * beolZoom;
        grainTint = 1.0 - gEdge * 0.14 * beolZoom + (gId - 0.5) * 0.08 * beolZoom;
        cCav *= (1.0 - gEdge * 0.22 * beolZoom);
      }
      // Subtle CMP dishing across top of wide damascene copper rails
      vec3 dishBump = (n.y > 0.85 && uZoom > 0.5) ? vec3(-locUV.x * 0.065, 0.0, -locUV.y * 0.065) : vec3(0.0);
      n = normalize(n + cBump * 0.42 + grainBump + dishBump);
      ndotv = max(dot(n, v), 0.0);
      matCavAO = cCav;

      // Physically calibrated linear rose-copper F0 modulated by real polycrystalline grain texture + Lazanyi F82 tint
      vec3 cuBase = mix(vec3(0.94, 0.55, 0.35), vec3(0.74, 0.45, 0.27), uSemFactor * 0.25) * grainTint;
      // Darker TaN/TiN diffusion barrier liner along metal trench edges
      float linerEdge = smoothstep(0.86, 0.98, locBorder) * smoothstep(0.6, 1.4, uZoom);
      baseCol = mix(cuBase * cAlb.rgb, vec3(0.24, 0.22, 0.24), linerEdge * 0.42);
      rough = clamp(cAlb.a * 0.84 + linerEdge * 0.08 + grainRough, 0.09, 0.38);
      metal = 0.96;
      anisoStrength = 0.42;
      anisoDir = abs(n.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
      conductorF82 = mix(vec3(0.86, 0.78, 0.72), vec3(1.0), linerEdge * 0.7);
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
    } else if (liveEnergy > 0.14 || (ch == 3 && uBootB.w > 0.001)) {
      float serdesBoost = (ch == 3 && hasDieAtlas > 0.01) ? mix(0.28, 1.35, dieFeat.a) : 1.0;
      float ioGate = 1.0;
      float ioFlash = 0.0;
      if (ch == 3 && uBootB.w > 0.001 && uZoom < 0.85) {
        float ioLocal = clamp((uBootB.z - 0.42) / 0.54, 0.0, 1.0);
        ioGate = smoothstep(0.05, 0.58, ioLocal);
        ioFlash = exp(-pow((ioLocal - 0.30) / 0.20, 2.0)) * smoothstep(0.0, 0.08, ioLocal) * uBootB.w * 0.78;
      }
      if (liveEnergy > 0.14 && ioGate > 0.002) {
        emissive = vec3(0.92, 0.50, 0.14) * liveEnergy * 0.24 * serdesBoost * ioGate;
      }
      if (ioFlash > 0.002) {
        emissive += vec3(1.25, 0.72, 0.26) * ioFlash * serdesBoost * 0.95;
      }
    }
  } else if (matId < 4.5) {
    // Mat 4: Sputtered Gunmetal Tungsten (W) / SLC SRAM Spine / Neural Engine / Covalent Bonds
    vec3 regionTint = uRegionKind > 2.5
      ? vec3(0.014, 0.022, 0.044)
      : (uRegionKind > 1.5
        ? vec3(0.012, 0.018, 0.032)
        : (uRegionKind > 0.5 ? vec3(0.008, 0.022, 0.024) : vec3(0.0)));

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

    if (blochGlow > 0.02 || (ch == 16 && uZoom > 5.2 && vLiveEnergy > 0.85)) {
      // Soft tetrahedral sp3 covalent electron-density bridge peaking midway between Si atoms!
      float bondBridge = smoothstep(5.2, 6.2, uZoom);
      float midPeak = clamp(1.0 - vLocalAnchor.y * vLocalAnchor.y, 0.0, 1.0);
      float covRim = pow(1.0 - ndotv, 1.8);
      if (bondBridge > 0.01) {
        baseCol = mix(baseCol, vec3(0.06, 0.18, 0.34), bondBridge * 0.72);
        rough = mix(rough, 0.14, bondBridge * 0.65);
        metal = mix(metal, 0.35, bondBridge * 0.65);
      }
      vec3 sp3Glow = vec3(0.08, 0.48, 0.98) * (0.12 + midPeak * 0.28 + covRim * 0.36) * bondBridge;
      emissive = sp3Glow + vec3(0.10, 0.66, 1.12) * blochGlow * (1.18 + midPeak * 0.34);
    } else if (gaaGateField > 0.02) {
      float fieldRim = 0.35 + 0.65 * (bevelMask + pow(1.0 - ndotv, 2.2) * 0.5);
      emissive = vec3(0.12, 0.50, 1.02) * gaaGateField * 0.34 * fieldRim;
    } else if ((liveEnergy > 0.08 && ch < 15) || ((ch == 4 || ch == 6) && uBootB.w > 0.001)) {
      float tBoost = (hasDieAtlas > 0.01) ? mix(0.20, 1.25, dieFeat.a) : 1.0;
      float blkGate = 1.0;
      float blkFlash = 0.0;
      if (uBootB.w > 0.001 && uZoom < 0.85) {
        if (ch == 4) {
          // Stage 2: 48 MB SLC SRAM banks lock symmetrically outward from center (z = 0)
          float slcR = clamp(abs(p.z) / 2.20, 0.0, 1.0);
          float sLocal = clamp((uBootA.y - slcR * 0.45) / 0.48, 0.0, 1.0);
          blkGate = smoothstep(0.06, 0.58, sLocal);
          blkFlash = exp(-pow((sLocal - 0.30) / 0.20, 2.0)) * smoothstep(0.0, 0.08, sLocal) * uBootB.w * 0.86;
        } else if (ch == 6) {
          // Stage 4D: 16-Core Neural Engine sweeps alive left-to-right across systolic columns
          float nCol = clamp((p.x - 0.62) / 2.15, 0.0, 1.0);
          float nLocal = clamp((uBootB.z - nCol * 0.28) / 0.44, 0.0, 1.0);
          blkGate = smoothstep(0.06, 0.58, nLocal);
          blkFlash = exp(-pow((nLocal - 0.30) / 0.20, 2.0)) * smoothstep(0.0, 0.08, nLocal) * uBootB.w * 0.82;
        }
      }
      if (liveEnergy > 0.08 && ch < 15 && blkGate > 0.002) {
        emissive = vec3(0.18, 0.52, 0.96) * liveEnergy * 0.34 * tBoost * blkGate;
      }
      if (blkFlash > 0.002) {
        emissive += vec3(0.22, 0.76, 1.24) * blkFlash * (tBoost + bevelMask * 0.55) * 0.98;
      }
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

    if (liveEnergy > 0.05 || (ch == 8 && uBootB.w > 0.001)) {
      // Whisper-subtle under-package bus reflection along the bottom inner fillet only (keeps epoxy body 100% physical!)
      float baseFillet = smoothstep(-0.18, -0.35, p.y);
      float ramGate = 1.0;
      float ramFlash = 0.0;
      if (ch == 8 && uBootB.w > 0.001 && uZoom < 0.85) {
        float memP = uBootA.z;
        ramGate = smoothstep(0.22, 0.82, memP);
        if (memP > 0.001) {
          // Subtle twin link-training pulse strictly along the inner bottom fillet facing the die
          float innerEdge = smoothstep(3.85, 3.45, abs(p.x));
          float pulseA = exp(-pow((memP - 0.36) / 0.11, 2.0));
          float pulseB = exp(-pow((memP - 0.60) / 0.12, 2.0)) * 0.72;
          ramFlash = (pulseA + pulseB) * smoothstep(0.0, 0.06, memP) * innerEdge * uBootB.w;
        }
      }
      if (liveEnergy > 0.05 && ramGate > 0.002) {
        emissive = vec3(0.10, 0.44, 0.94) * liveEnergy * (0.04 + 0.34 * baseFillet) * ramGate;
      }
      if (ramFlash > 0.002) {
        emissive += vec3(0.26, 0.78, 1.28) * ramFlash * (0.20 + 1.18 * baseFillet);
      }
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
    // Mat 15: Glossy Barium-Titanate MLCC Ceramic Capacitor Body (with per-cap batch tint variation!)
    vec4 cerAlb;
    vec3 cerBump;
    float cerCav;
    sampleTriplanarMat(0.0, p, n, 4.5, cerAlb, cerBump, cerCav);
    n = normalize(n + cerBump * 0.18);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = mix(1.0, cerCav, 0.4);
    float batch = vExtraA;
    vec3 warmTan = vec3(0.36, 0.205, 0.082);
    vec3 coolBeige = vec3(0.27, 0.185, 0.105);
    vec3 darkSiCap = vec3(0.095, 0.102, 0.116);
    vec3 capTint = mix(warmTan, coolBeige, batch);
    // ~7% of perimeter caps are dark high-frequency silicon decoupling capacitors (authentic Apple Silicon package!)
    capTint = mix(capTint, darkSiCap, step(0.93, batch));
    baseCol = capTint * (0.86 + cerAlb.r * 0.42);
    rough = mix(0.17, 0.24, batch);
    metal = 0.0;
    clearcoat = 0.78;
    // Cold Boot Stage 1: Perimeter MLCC decoupling capacitors energize symmetrically (0 V -> 0.72 V)
    if (uBootB.w > 0.001 && uBootA.x > 0.001 && uBootA.x < 0.999 && uZoom < 0.85) {
      float pwrP = uBootA.x;
      float perimNorm = clamp((abs(p.x) * 0.24 + abs(p.z) * 0.14) - 0.25, 0.0, 1.0);
      float chargeWave = exp(-pow((perimNorm - (1.0 - pwrP * 1.18)) / 0.24, 2.0));
      float pwrEnv = smoothstep(0.0, 0.10, pwrP) * (1.0 - smoothstep(0.64, 1.0, pwrP));
      vec3 capGlow = mix(vec3(1.24, 0.52, 0.12), vec3(1.92, 1.12, 0.44), chargeWave);
      emissive += capGlow * (0.18 + chargeWave * 1.32) * pwrEnv * uBootB.w * 1.08;
    }
  } else if (matId < 16.5) {
    // Mat 16: Bright Silver-Tin (Sn/Ni) Soldered SMD End Termination & Concave Reflow Solder Meniscus Fillets
    vec4 snAlb;
    vec3 snBump;
    float snCav;
    sampleTriplanarMat(2.0, p, n, 3.2, snAlb, snBump, snCav);
    // Concave meniscus normal curvature on reflowed solder fillets (vExtraB > 0.5: 1 = X-fillet, 2 = Z-fillet)
    vec3 meniscusTilt = vec3(0.0);
    if (vExtraB > 0.5 && n.y > 0.4) {
      float dirSign = (vExtraA >= 0.0) ? 1.0 : -1.0;
      bool isZFillet = vExtraB > 1.5;
      float sCoord = isZFillet ? (locUV.y * dirSign) : (locUV.x * dirSign); // -1 at cap wall, +1 at outer toe
      float curve = clamp(0.55 - sCoord * 0.45, 0.05, 0.95);
      meniscusTilt = isZFillet ? vec3(0.0, 0.0, dirSign * curve * 0.62) : vec3(dirSign * curve * 0.62, 0.0, 0.0);
    }
    n = normalize(n + snBump * 0.22 + meniscusTilt);
    ndotv = max(dot(n, v), 0.0);
    matCavAO = mix(1.0, snCav, 0.45);
    baseCol = vec3(0.78, 0.80, 0.83) * (0.78 + snAlb.r * 0.28);
    rough = (vExtraB > 0.5) ? 0.105 : 0.135;
    metal = 0.96;
    if (uBootB.w > 0.001 && uBootA.x > 0.001 && uBootA.x < 0.999 && uZoom < 0.85) {
      float pwrP = uBootA.x;
      float perimNorm = clamp((abs(p.x) * 0.24 + abs(p.z) * 0.14) - 0.25, 0.0, 1.0);
      float chargeWave = exp(-pow((perimNorm - (1.0 - pwrP * 1.18)) / 0.24, 2.0));
      float pwrEnv = smoothstep(0.0, 0.10, pwrP) * (1.0 - smoothstep(0.64, 1.0, pwrP));
      emissive += vec3(1.55, 0.88, 0.34) * chargeWave * pwrEnv * uBootB.w * 0.95;
    }
  } else {
    // Mat 17: Glossy Jet-Black Capillary Epoxy Underfill Meniscus (organic flow wave + concave fillet curvature)
    float ufGrain = noise2D(p.xz * 26.0 + p.y * 18.0);
    float ufWaveX = noise2D(p.xz * 4.2 + vec2(3.1, 7.4)) - 0.5;
    float ufWaveZ = noise2D(p.xz * 4.2 + vec2(11.7, 2.3)) - 0.5;
    // Concave meniscus normal curving smoothly outward away from die/LPDDR5 vertical edges
    vec2 outDir = normalize(locUV + vec2(1e-4));
    float filletSlope = smoothstep(0.70, 0.99, locBorder) * smoothstep(0.4, 0.95, n.y);
    n = normalize(n + vec3(outDir.x * filletSlope * 0.44 + ufWaveX * 0.06, 0.0, outDir.y * filletSlope * 0.44 + ufWaveZ * 0.06));
    nSurf = n;
    ndotv = max(dot(n, v), 0.0);
    baseCol = vec3(0.007, 0.008, 0.011) + vec3(0.004, 0.005, 0.006) * ufGrain;
    rough = 0.11 + ufGrain * 0.035;
    metal = 0.02;
    clearcoat = 0.95;
  }

  // Stochastic EUV Line-Edge Roughness (LER/LWR) at nanoscale FEOL & GAA levels (12-120 nm, Worlds 3-5)
  float lerMask = smoothstep(2.2, 3.6, uZoom) * (1.0 - smoothstep(5.2, 5.8, uZoom));
  if (lerMask > 0.01 && matId > 1.5 && matId < 4.5) {
    float sideOrEdge = max(1.0 - abs(n.y), bevelMask);
    if (sideOrEdge > 0.08) {
      float lerA = noise2D(p.xz * 18.5 + vec2(p.y * 29.0, 4.3)) - 0.5;
      float lerB = noise2D(p.xy * 24.0 + vec2(p.z * 21.0, 11.7)) - 0.5;
      float lerGain = 0.16 * lerMask * sideOrEdge;
      n = normalize(n + vec3(lerA, (lerA - lerB) * 0.45, lerB) * lerGain);
      ndotv = max(dot(n, v), 0.0);
      rough = clamp(rough + abs(lerA) * 0.06 * lerMask, 0.08, 0.48);
    }
  }

  // Machined micro-chamfer edge polish: crisper specular gleam specifically along machined bevels!
  rough = mix(rough, max(0.06, rough * 0.52), bevelMask * 0.76);

  // Continuous Optical BEOL M12-M16 Power & Clock Mesh Emergence on World 0 Die (z: 0.28 -> 0.85):
  // Physically resolves the top-level global power grid edge-to-edge across the entire bare silicon die
  // at exact 1:uStage0Ratio pitch & phase alignment with World 1 so 3D rails rise seamlessly out of the die plane!
  if (hasDieAtlas > 0.01 && uZoom > 0.28 && uZoom < 1.08 && uClipPlane.y < 0.5) {
    float gridResolve = smoothstep(0.28, 0.76, uZoom) * hasDieAtlas;
    float bayResolve = smoothstep(0.42, 0.78, uZoom) * hasDieAtlas;
    bevelMask *= (1.0 - bayResolve);
    vec2 gPos = (p.xz - uDieGridOrigin) * uStage0Ratio;
    const float gPitch = 1.52;
    vec2 fw = max(fwidth(gPos), vec2(0.004));

    // Exact M15/M16 rail indices matching buildWorld1(): pos = (i - 0.5) * 1.52
    vec2 railI = floor(gPos / gPitch + 1.0);
    vec2 railCenter = (railI - 0.5) * gPitch;
    vec2 dRailSigned = gPos - railCenter;
    vec2 dRail = abs(dRailSigned);

    // Anti-aliased X-running (constant Z, hz = 0.058) and Z-running (constant X, hx = 0.052) rails
    float maskRailX = 1.0 - smoothstep(0.058 - fw.y * 0.65, 0.058 + fw.y * 0.90, dRail.y);
    float maskRailZ = 1.0 - smoothstep(0.052 - fw.x * 0.65, 0.052 + fw.x * 0.90, dRail.x);
    float dVia = length(dRail);
    float viaFw = max(fw.x, fw.y);
    float maskVia = 1.0 - smoothstep(0.088 - viaFw * 0.65, 0.088 + viaFw * 0.95, dVia);
    float maskViaCap = 1.0 - smoothstep(0.042 - viaFw * 0.65, 0.042 + viaFw * 0.95, dVia);

    // Alternating Silver (even i on X, odd i on Z) & Copper (odd i on X, even i on Z) global rails
    float evenX = 1.0 - mod(abs(railI.y), 2.0);
    float evenZ = 1.0 - mod(abs(railI.x), 2.0);
    vec3 cuCol = vec3(0.64, 0.36, 0.21);
    vec3 agCol = vec3(0.30, 0.34, 0.41);
    vec3 colX = mix(cuCol, agCol, evenX);
    vec3 colZ = mix(agCol, cuCol, evenZ);

    // M12/M13 sub-global copper & silver distribution stripes inside each 1.52 x 1.52 bay
    vec2 cellId = floor(gPos / gPitch + 0.5);
    vec2 cellLoc = gPos - cellId * gPitch;
    float hCell = hash12(cellId + 19.3);
    bool horizSub = fract(hCell * 7.3) > 0.45;
    float subCoord = horizSub ? cellLoc.y : cellLoc.x;
    float subAlong = horizSub ? abs(cellLoc.x) : abs(cellLoc.y);
    float subFw = horizSub ? fw.y : fw.x;
    float inBay = (1.0 - smoothstep(0.58, 0.62, subAlong)) * (1.0 - smoothstep(0.54, 0.58, abs(subCoord)));
    float subDist = abs(fract(subCoord / 0.105 + 0.5) - 0.5) * 0.105;
    float subStripe = (1.0 - smoothstep(0.026 - subFw * 0.6, 0.026 + subFw * 0.95, subDist)) * inBay * smoothstep(0.28, 0.66, uZoom);
    float subIsCu = 1.0 - mod(abs(floor(subCoord / 0.105 + 0.5)), 2.0);
    vec3 subCol = mix(agCol * 0.86, cuCol * 0.88, subIsCu);

    // Recessed low-k SiCOH dielectric bay floor & rail shadow groove
    vec3 bayFloorCol = vec3(0.042, 0.052, 0.068);
    vec3 gridCol = mix(bayFloorCol, subCol, subStripe * 0.85);
    float bayDarken = bayResolve * (1.0 - max(max(maskRailX, maskRailZ), maskVia));
    baseCol = mix(baseCol, gridCol, bayDarken * 0.88);
    rough = mix(rough, mix(0.28, 0.18, subStripe), bayDarken * 0.80);
    clearcoat = mix(clearcoat, 0.14, bayResolve * 0.85);

    // Composite M15/M16 rails & circular via stacks on top (X-rail slightly above Z-rail matching World 1)
    float railMask = max(max(maskRailX, maskRailZ), maskVia);
    vec3 railCol = mix(colZ, colX, smoothstep(0.2, 0.8, maskRailX));
    railCol = mix(railCol, agCol * 1.08, maskVia * 0.85);
    railCol = mix(railCol, cuCol * 1.05, maskViaCap * 0.90);

    float railBlend = railMask * gridResolve;
    baseCol = mix(baseCol, railCol, railBlend * 0.96);
    rough = mix(rough, 0.17, railBlend * 0.88);
    metal = mix(metal, 0.96, railBlend);

    // Analytical metallic bevel normal relief on emerging M15/M16 rails for crisp studio catchlights
    float slopeX = clamp(dRailSigned.x / 0.052, -1.0, 1.0) * maskRailZ * (1.0 - maskRailX * 0.7);
    float slopeZ = clamp(dRailSigned.y / 0.058, -1.0, 1.0) * maskRailX;
    n = normalize(n + vec3(slopeX, 0.0, slopeZ) * (0.28 * gridResolve));
    ndotv = max(dot(n, v), 0.0);

    // Subtle cavity darkening hugging rail edges + gentle macro emissive attenuation as BEOL metal takes over
    float railEdgeAO = 1.0 - 0.34 * bayResolve * (
      (1.0 - smoothstep(0.058, 0.14, dRail.y)) * (1.0 - maskRailX) +
      (1.0 - smoothstep(0.052, 0.13, dRail.x)) * (1.0 - maskRailZ)
    );
    matCavAO *= clamp(railEdgeAO, 0.55, 1.0);
    emissive *= mix(1.0, 0.18, bayResolve);

    // Matching subtle DC power sheen & resonant clock wavefronts on the emerging M15/M16 rails
    float railGlowMix = gridResolve * smoothstep(0.32, 0.72, uZoom);
    if (railGlowMix > 0.01 && railMask > 0.05) {
      float clkWave = exp(-pow(fract((uPulsePhase * 2.25 - abs(gPos.x)) / 9.6) * 9.6 / 0.55, 2.0));
      float isClockRail = maskRailX * evenX + maskRailZ * (1.0 - evenZ);
      vec3 dcSheen = vec3(0.86, 0.44, 0.14) * (0.10 + 0.18 * max(uMacLoads.x, uMacLoads.z)) * (1.0 - clamp(isClockRail, 0.0, 1.0));
      vec3 clkSheen = keynoteSignalColor(clkWave) * clkWave * 0.42 * clamp(isClockRail, 0.0, 1.0);
      emissive += (dcSheen + clkSheen) * railGlowMix * railMask;
    }
  } else if (
    matId > 6.5 &&
    matId < 7.5 &&
    n.y > 0.82 &&
    uRegionKind > 2.5 &&
    uZoom > 0.28 &&
    uZoom < 1.08 &&
    uClipPlane.y < 0.5
  ) {
    // Optical LPDDR5 Decapsulation: RDL DQ Redistribution Grid & Sapphire DRAM Bank Mats emerge seamlessly through epoxy!
    float gridResolve = smoothstep(0.28, 0.76, uZoom);
    float bayResolve = smoothstep(0.42, 0.78, uZoom);
    vec2 gPos = (p.xz - uDieGridOrigin) * uStage0Ratio;
    const float gPitch = 1.52;
    vec2 fw = max(fwidth(gPos), vec2(0.004));

    vec2 railI = floor(gPos / gPitch + 1.0);
    vec2 railCenter = (railI - 0.5) * gPitch;
    vec2 dRailSigned = gPos - railCenter;
    vec2 dRail = abs(dRailSigned);

    float maskRailX = 1.0 - smoothstep(0.070 - fw.y * 0.65, 0.070 + fw.y * 0.90, dRail.y);
    float maskRailZ = 1.0 - smoothstep(0.064 - fw.x * 0.65, 0.064 + fw.x * 0.90, dRail.x);
    float dVia = length(dRail);
    float viaFw = max(fw.x, fw.y);
    float maskVia = 1.0 - smoothstep(0.105 - viaFw * 0.65, 0.105 + viaFw * 0.95, dVia);
    float maskViaCap = 1.0 - smoothstep(0.052 - viaFw * 0.65, 0.052 + viaFw * 0.95, dVia);

    float evenX = 1.0 - mod(abs(railI.y), 2.0);
    vec3 agCol = vec3(0.32, 0.36, 0.44);
    vec3 cuCol = vec3(0.58, 0.34, 0.20);
    vec3 sapphMat = vec3(0.05, 0.16, 0.34);

    vec2 cellId = floor(gPos / gPitch + 0.5);
    vec2 cellLoc = gPos - cellId * gPitch;
    float inMat = (1.0 - smoothstep(0.58, 0.62, abs(cellLoc.x))) * (1.0 - smoothstep(0.58, 0.62, abs(cellLoc.y)));
    float spineMask = (1.0 - smoothstep(0.048 - fw.x, 0.048 + fw.x, abs(cellLoc.x))) * inMat;
    vec3 bayCol = mix(vec3(0.018, 0.026, 0.042), sapphMat, inMat * 0.90);
    bayCol = mix(bayCol, agCol * 0.85, spineMask * 0.85);

    float railMask = max(max(maskRailX, maskRailZ), maskVia);
    vec3 railCol = mix(cuCol, agCol, evenX);
    railCol = mix(railCol, agCol * 1.12, maskVia * 0.85);
    railCol = mix(railCol, vec3(0.10, 0.38, 0.82), maskViaCap * 0.90);

    baseCol = mix(baseCol, bayCol, bayResolve * (1.0 - railMask) * 0.94);
    baseCol = mix(baseCol, railCol, railMask * gridResolve * 0.96);
    rough = mix(rough, mix(0.24, 0.16, railMask), gridResolve * 0.88);
    metal = mix(metal, mix(0.62, 0.95, railMask), gridResolve * 0.92);

    float slopeX = clamp(dRailSigned.x / 0.064, -1.0, 1.0) * maskRailZ * (1.0 - maskRailX * 0.7);
    float slopeZ = clamp(dRailSigned.y / 0.070, -1.0, 1.0) * maskRailX;
    n = normalize(n + vec3(slopeX, 0.0, slopeZ) * (0.28 * gridResolve));
    ndotv = max(dot(n, v), 0.0);

    float dqWave = exp(-pow(fract((uPulsePhase * 2.25 - abs(gPos.x)) / 9.6) * 9.6 / 0.55, 2.0));
    emissive += keynoteSignalColor(dqWave) * dqWave * railMask * gridResolve * (0.25 + uLocalLoad * 0.45);
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
    clearcoat *= 0.25;
  }

  // Analytical Height, Crevice, Micro-Cavity & Plinth Contact Ambient Occlusion
  float hAboveFloor = p.y - uFloorY;
  float floorAO = mix(mix(0.26, 0.18, uSemFactor), 1.0, smoothstep(-0.04, 0.40, hAboveFloor));
  float wallAO = mix(mix(0.66, 0.54, uSemFactor), 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float ao = clamp(floorAO * wallAO * studioContactAO * matCavAO, 0.12, 1.0);

  // Studio 3-Point Key (Representative-Point Rectangular Softbox Area Light) / Rim / Fill + 2-Stage PCSS Soft Shadows
  float ndotlK = max(dot(n, keyDir), 0.0);
  float introKey = clamp(uIntroLight.y, 0.0, 1.0);
  float introRim = clamp(uIntroLight.z, 0.15, 2.5);
  float introPulse = clamp(uIntroLight.w, 0.0, 1.5);

  vec3 F0 = mix(vec3(0.04), baseCol, metal);
  vec3 diffAlbedo = baseCol * (1.0 - metal) / PI;

  // Multi-Scattering GGX Energy Compensation (Turquin / Fdez-Agüera fast analytical E_ss)
  float oneMinusV = 1.0 - ndotv;
  float ess = 1.0 - rough * (0.28 + 0.34 * oneMinusV * oneMinusV);
  vec3 multiScatter = 1.0 + F0 * (1.0 / max(ess, 0.35) - 1.0) * 0.88;

  // Representative-Point Rectangular Studio Softbox Specular (matches overhead softbox in uEnvTex!)
  vec3 reflDir = reflect(-v, n);
  vec3 kUpRef = abs(keyDir.y) < 0.96 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 kRight = normalize(cross(kUpRef, keyDir));
  vec3 kUp = cross(keyDir, kRight);
  float rDotK = max(dot(reflDir, keyDir), 0.12);
  vec3 hitOnPlane = reflDir / rDotK - keyDir;
  float projU = clamp(dot(hitOnPlane, kRight), -0.34, 0.34);
  float projV = clamp(dot(hitOnPlane, kUp), -0.20, 0.20);
  vec3 areaDir = normalize(keyDir + kRight * projU + kUp * projV);
  float ndotlSpecK = max(dot(n, areaDir), 0.0);

  // Early-out 14-tap PCSS on back-facing surfaces and pure-black intro frames!
  float sh = (introKey > 0.005 && (ndotlK > 0.002 || ndotlSpecK > 0.002))
    ? sampleShadow(vShadowCoord, ndotlK)
    : 1.0;

  // Key light (Cook-Torrance GGX area-normalized specular + True Anisotropic GGX + Lazanyi F82 conductor Fresnel)
  vec3 hK = normalize(areaDir + v);
  float ndothK = max(dot(n, hK), 0.0);
  float vdothK = max(dot(v, hK), 0.0);
  vec3 Fk = F_ConductorF82(vdothK, F0, conductorF82);
  float aOrig = max(rough * rough, 0.0025);
  float aArea = clamp(aOrig + 0.085, 0.004, 1.0);
  float areaNorm = (aOrig / aArea) * (aOrig / aArea);
  float effAreaRough = sqrt(aArea);

  vec3 anisoT = vec3(1.0, 0.0, 0.0);
  vec3 anisoB = vec3(0.0, 0.0, 1.0);
  float Dk;
  if (anisoStrength > 0.01) {
    vec3 refA = (abs(dot(anisoDir, n)) < 0.95) ? anisoDir : ((abs(n.y) < 0.95) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    anisoT = normalize(refA - n * dot(refA, n));
    anisoB = cross(n, anisoT);
    float anisoFactor = anisoStrength * 0.58;
    float at = max(aArea * (1.0 + anisoFactor), 0.004);
    float ab = max(aArea * (1.0 - anisoFactor), 0.004);
    Dk = D_GGX_Anisotropic(ndothK, dot(hK, anisoT), dot(hK, anisoB), at, ab) * mix(1.0, areaNorm, 0.42);
  } else {
    Dk = D_GGX(ndothK, effAreaRough) * mix(1.0, areaNorm, 0.42);
  }
  float Gk = G_SchlickGGX(ndotv, max(ndotlSpecK, 0.02), rough);
  vec3 specK = ((Dk * Gk * Fk) / max(4.0 * ndotv * max(ndotlSpecK, 0.02), 0.001)) * multiScatter;
  vec3 kDk = (vec3(1.0) - Fk);

  // Energy-conserving Optical SiO2 / ABF / MLCC / Underfill Clearcoat Lobe (uses mirror-flat nSurf on bare silicon die!)
  vec3 ccNorm = (hasDieAtlas > 0.01) ? nSurf : n;
  float ccNdotv = max(dot(ccNorm, v), 0.0);
  float ccNdothK = max(dot(ccNorm, hK), 0.0);
  float ccFk = F_Schlick(vdothK, vec3(0.04)).r * clearcoat;
  float ccSpecK = clearcoat > 0.01 ? (D_GGX(ccNdothK, 0.095) * 0.36 * ccFk) : 0.0;
  float ccAttenK = 1.0 - ccFk * 0.85;
  // Subtle optical coat depth absorption on coated dielectrics (underfill, ABF solder mask, MLCC)
  float coatDepthAbsorb = mix(1.0, 0.86, clearcoat * (1.0 - metal) * 0.65);

  // Rim light (Cook-Torrance GGX — crisp dark-field metallic edge separation!)
  float ndotlR = max(dot(n, rimDir), 0.0);
  vec3 hR = normalize(rimDir + v);
  float ndothR = max(dot(n, hR), 0.0);
  float vdothR = max(dot(v, hR), 0.0);
  vec3 Fr = F_ConductorF82(vdothR, F0, conductorF82);
  float Dr = D_GGX(ndothR, max(rough * 0.90, 0.06));
  float Gr = G_SchlickGGX(ndotv, ndotlR, rough);
  vec3 specR = ((Dr * Gr * Fr) / max(4.0 * ndotv * ndotlR, 0.001)) * multiScatter;

  float ndotlF = max(dot(n, fillDir), 0.0);

  vec3 keyTint = mix(vec3(1.05, 1.01, 0.96), vec3(0.96, 1.00, 1.06), uSemFactor * 0.5);
  vec3 rimTint = mix(vec3(0.42, 0.72, 1.18), vec3(0.56, 0.82, 1.24), uSemFactor);

  // Deep blackout studio while unpowered: minimal softbox & dark-mirror reflection so chip silhouette whispers out of shadow
  // Musical beatPulse breathes crisp sapphire/platinum grazing light along machined chamfers strictly on bass thumps!
  float localKey = introKey;
  float envLift = mix(0.022 + introPulse * 0.022, 1.0, pow(introKey, 0.88));
  float localRim = mix(introRim + introPulse * 0.82, 1.0 + introPulse * 0.35, introKey);

  vec3 direct = vec3(0.0);
  direct += (kDk * diffAlbedo * coatDepthAbsorb * ndotlK * ccAttenK + (specK * ccAttenK + vec3(ccSpecK)) * max(ndotlSpecK, ndotlK * 0.65)) * keyTint * 2.65 * sh * localKey;
  direct += ((vec3(1.0) - Fr) * diffAlbedo * coatDepthAbsorb * 0.60 + specR * 0.82) * rimTint * (ndotlR * mix(1.38, 1.95, uSemFactor)) * localRim;
  direct += diffAlbedo * coatDepthAbsorb * ndotlF * vec3(0.24, 0.30, 0.42) * 1.10 * mix(0.03, 1.0, introKey);

  // Prefiltered HDR Studio Softbox + Negative-Fill Environment Reflection + Anisotropic Bent-Normal IBL + Lagarde Specular Occlusion
  vec3 iblReflDir = reflDir;
  if (anisoStrength > 0.01) {
    vec3 anisoTan = cross(anisoB, v);
    float tanLen = length(anisoTan);
    if (tanLen > 0.001) {
      vec3 bentN = normalize(cross(anisoTan / tanLen, anisoB));
      float bendAmt = clamp(anisoStrength * clamp(4.5 * rough, 0.0, 1.0), 0.0, 0.62);
      iblReflDir = reflect(-v, normalize(mix(n, bentN, bendAmt)));
    }
  }
  vec2 reflUv = envDirToUv(iblReflDir);
  vec3 reflCol = sampleStudioEnvUv(reflUv, rough, uSemFactor);
  vec3 Fenv = F_SchlickRoughness(ndotv, F0, rough);
  float specAO = clamp(pow(ndotv + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
  vec3 envReflection = reflCol * Fenv * multiScatter * mix(0.84, 0.36, rough * rough) * (0.48 + 0.52 * metal) * specAO * envLift;
  if (clearcoat > 0.01) {
    vec2 ccReflUv = (hasDieAtlas > 0.01) ? envDirToUv(reflect(-v, ccNorm)) : reflUv;
    vec3 ccEnv = sampleStudioEnvUv(ccReflUv, 0.035, uSemFactor);
    float m1 = 1.0 - ccNdotv;
    float m2 = m1 * m1;
    float ccF = (0.04 + 0.96 * (m2 * m2 * m1)) * clearcoat;
    float ccSpecAO = clamp(pow(ccNdotv + ao, exp2(-16.0 * 0.06 - 1.0)) - 1.0 + ao, 0.0, 1.0);
    // Energy conservation: smooth top SiO2/epoxy clearcoat attenuates underlying base reflection!
    envReflection = envReflection * (1.0 - ccF * 0.78) + ccEnv * ccF * 0.74 * ccSpecAO * envLift;
  }

  // Machined chamfer glint along precision beveled silicon & metal edges (pulses with bass thumps & ignition!)
  float bevelPulse = mix(0.24 + introPulse * 0.88, 1.0 + introPulse * 0.38, introKey);
  vec3 bevelGlint = vec3(0.80, 0.89, 1.04) * bevelMask * pow(1.0 - ndotv, 1.85) * (0.06 + 0.24 * metal) * (0.42 + 0.58 * sh) * ao * bevelPulse;

  // Dark-Field / Everhart-Thornley SEM Secondary-Electron Edge Contrast
  float darkBeatRim = introPulse * (1.0 - introKey * 0.72) * 0.18 * (0.35 + 0.65 * metal);
  float seDetector = 0.55 + 0.45 * max(dot(n, normalize(vec3(-0.62, 0.58, -0.52))), 0.0);
  float seEdge = (pow(1.0 - ndotv, 2.75) + bevelMask * 0.42 * pow(1.0 - ndotv, 1.25)) * seDetector;
  vec3 semRim = vec3(0.48, 0.71, 0.98) * mix(pow(1.0 - ndotv, 3.2), seEdge, uSemFactor) * (0.045 + 0.36 * uSemFactor + darkBeatRim) * ao * localRim;
  vec3 envDiff = (metal < 0.92) ? sampleStudioEnvUv(envDirToUv(n), 0.95, uSemFactor) : vec3(0.10);
  vec3 ambient = baseCol * (vec3(0.042, 0.056, 0.084) + envDiff * (1.0 - metal) * 0.16) * ao * mix(0.032, 1.0, introKey);

  // Subtle localized self-illumination bounce in the dark studio as V_DD rails & fabric ignite!
  vec3 bootBounce = vec3(0.0);
  if (uBootB.w > 0.001 && uZoom < 0.85 && p.y > -0.56) {
    float pwrEnvB = smoothstep(0.0, 0.14, uBootA.x) * (1.0 - smoothstep(0.68, 1.0, uBootA.x));
    float nearPerim = smoothstep(1.8, 3.2, max(abs(p.x) * 0.92, abs(p.z) * 1.15)) * smoothstep(5.6, 3.4, max(abs(p.x), abs(p.z) * 1.45));
    bootBounce += vec3(0.42, 0.18, 0.04) * nearPerim * pwrEnvB * (0.14 + bevelMask * 0.52 + pow(1.0 - ndotv, 2.5) * 0.28) * ao;

    float fabEnvB = smoothstep(0.0, 0.16, uBootA.y) * (1.0 - smoothstep(0.75, 1.0, uBootB.y));
    float nearDie = exp(-0.14 * dot(p.xz * vec2(0.75, 1.0), p.xz * vec2(0.75, 1.0)));
    bootBounce += vec3(0.05, 0.24, 0.56) * nearDie * fabEnvB * (0.08 + bevelMask * 0.45 + pow(1.0 - ndotv, 2.4) * 0.26) * ao;
    bootBounce *= uBootB.w * (1.0 - introKey * 0.72);
  }

  vec3 col = ambient + direct * ao + envReflection + bevelGlint + semRim + emissive + bootBounce;

  // Physical Studio-Light Hover Response (zero neon box, zero flat tint: catches light on real 3D surfaces & bevels!)
  if (uHoverBox.z > 0.001 && uHighlightFade.x > 0.004 && uZoom < 0.85) {
    float hoverVis = clamp(1.0 - max(uZoom, 0.0) * 1.15, 0.0, 1.0) * uHighlightFade.x;
    bool isCircleH = uHoverBox.w < 0.0;
    float sdfH = isCircleH
      ? (length(p.xz - uHoverBox.xy) - abs(uHoverBox.w))
      : max(abs(p.x - uHoverBox.x) - uHoverBox.z, abs(p.z - uHoverBox.y) - uHoverBox.w);
    float insideH = 1.0 - smoothstep(-0.014, 0.024, sdfH);
    if (uHighlightFade.z > 0.5) {
      // Hollow perimeter mask for SMD decoupling capacitor ring (keeps inner silicon die untouched)
      float sdfInnerH = max(abs(p.x) - 3.12, abs(p.z) - 2.66);
      insideH *= smoothstep(-0.02, 0.03, sdfInnerH);
    }
    float elevH = isCircleH ? smoothstep(-0.58, -0.50, p.y) : smoothstep(-0.33, -0.27, p.y);
    float hMask = insideH * elevH * hoverVis;
    // Multiplicative clarity lift preserves deep obsidian blacks & specular contrast
    col *= (1.0 + 0.16 * hMask);
    // Subtle overhead studio catchlight strictly along machined 3D chamfers and grazing edges
    col += vec3(0.58, 0.66, 0.78) * bevelMask * (0.045 + 0.14 * metal) * hMask;
    col += vec3(0.14, 0.19, 0.28) * pow(1.0 - ndotv, 2.8) * (0.12 + 0.20 * metal) * hMask;
  }

  // Leica Optical Focus Isolation + Precision Hairline Corner Registration Marks on Click/Inspect
  if (uInspectBox.z > 0.001 && uHighlightFade.y > 0.004 && uZoom < 0.85) {
    float inspectVis = clamp(1.0 - max(uZoom, 0.0) * 1.1, 0.0, 1.0) * uHighlightFade.y;
    bool isCircleI = uInspectBox.w < 0.0;
    vec2 relI = p.xz - uInspectBox.xy;
    float sdfI = isCircleI
      ? (length(relI) - abs(uInspectBox.w))
      : max(abs(relI.x) - uInspectBox.z, abs(relI.y) - uInspectBox.w);
    float insideI = 1.0 - smoothstep(-0.014, 0.024, sdfI);
    if (uHighlightFade.w > 0.5) {
      float sdfInnerI = max(abs(p.x) - 3.12, abs(p.z) - 2.66);
      insideI *= smoothstep(-0.02, 0.03, sdfInnerI);
    }
    float elevI = isCircleI ? smoothstep(-0.58, -0.50, p.y) : smoothstep(-0.33, -0.27, p.y);
    float focusMask = insideI * elevI;

    // Gentle condenser-iris figure-ground separation (softly attenuates surroundings while lifting inspected block)
    col *= mix(1.0 - 0.22 * inspectVis, 1.0 + 0.14 * inspectVis, focusMask);
    col += vec3(0.68, 0.76, 0.88) * bevelMask * (0.05 + 0.16 * metal) * focusMask * inspectVis;

    // Screen-space anti-aliased ~1.1px optical registration corner ticks (strictly sub-bloom, calm & authoritative)
    float px = clamp(length(vec2(dFdx(sdfI), dFdy(sdfI))), 0.0025, 0.032);
    float line = 1.0 - smoothstep(px * 0.55, px * 1.65, abs(sdfI));
    float armMask;
    if (isCircleI) {
      // 4 delicate diagonal quadrant arcs framing the US Quarter
      float ang45 = abs(atan(abs(relI.y), abs(relI.x) + 1e-5) - 0.78539816);
      armMask = 1.0 - smoothstep(0.15, 0.185, ang45);
    } else {
      vec2 bI = uInspectBox.zw;
      float armLen = clamp(min(bI.x, bI.y) * 0.34, 0.075, 0.22);
      float distFromCorner = max(bI.x - abs(relI.x), bI.y - abs(relI.y));
      armMask = 1.0 - smoothstep(armLen - px * 1.3, armLen + px * 0.7, distFromCorner);
    }
    float tickSurf = smoothstep(0.72, 0.94, n.y) * (isCircleI ? 1.0 : smoothstep(-0.35, -0.30, p.y));
    float tick = line * armMask * tickSurf * inspectVis;
    col += vec3(0.42, 0.48, 0.56) * tick;
  }

  // Smooth infinite studio fog matching our obsidian backdrop
  float fogDist = length(vScaledPos.xz - uFocusXZ);
  float fog = 1.0 - exp(-uFogDensity * fogDist * fogDist);
  col = mix(col, vec3(0.003, 0.005, 0.009), clamp(fog, 0.0, 1.0));

  // Pack analytical optical microscope Circle-of-Confusion (CoC) into alpha for zero-overhead DOF!
  // During planar reflection pass (uClipPlane.y > 0.5), alpha = 1.0 marks valid reflected geometry coverage!
  float focalDelta = abs(camDist - uFocusDist) / max(uFocusDist * 0.62, 0.5);
  float coc = clamp(smoothstep(0.32, 1.32, focalDelta) * uDofStrength, 0.0, 1.0);
  float outAlpha = (uClipPlane.y > 0.5) ? (1.0 - clamp(fog, 0.0, 1.0)) : coc;

  fragColor = vec4(max(col, 0.0), outAlpha);

  // Lightweight G-buffer attachment for half-res GTAO, Contact Shadows & Screen-Space Reflections:
  // R = metal (or clearcoat proxy), G = rough, B = emissive protection, A = surface flag (1.0 = geometry, 0.5 = plinth)
  float reflMetal = max(metal, clearcoat * 0.65);
  float reflRough = (clearcoat > 0.4 && metal < 0.25) ? min(rough, 0.18) : rough;
  float emLuma = clamp(max(emissive.r, max(emissive.g, emissive.b)) * 1.15, 0.0, 1.0);
  float isPlinth = (matId < 0.5 && p.y < -0.50 && n.y > 0.8 && uZoom < 0.65) ? 1.0 : 0.0;
  gbufColor = vec4(reflMetal, reflRough, emLuma, isPlinth > 0.5 ? 0.5 : 1.0);
}
`;
}

export const SCENE_FS = buildSceneFs(false);
export const SCENE_CUTOUT_FS = buildSceneFs(true);

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
uniform sampler2D uBounceTex;
uniform vec2 uResolution;
uniform float uMotion;
uniform float uTime;
uniform float uVoidPlunge;
uniform float uIntroExposure;
uniform float uBounceScale;

// Troy Sobotka AgX Punchy Filmic Tone Map (preserves deep electric cyan & rich metallic copper highlights without violet hue shift!)
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5     * x4 * x2
         - 40.14    * x4 * x
         + 31.96    * x4
         - 6.868    * x2 * x
         + 0.4298   * x2
         + 0.1191   * x
         - 0.00232;
}

vec3 agxToneMap(vec3 val) {
  const mat3 agxMat = mat3(
    0.842479062253094,  0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772,  0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
  );
  const mat3 agxMatInv = mat3(
     1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433,  1.15107367264116
  );
  const float minEv = -12.47393;
  const float maxEv = 4.026069;

  vec3 x = agxMat * max(val, vec3(1e-6));
  x = clamp(log2(x), minEv, maxEv);
  x = (x - minEv) / (maxEv - minEv);
  x = agxDefaultContrastApprox(x);

  // Subtle Punchy studio contrast & saturation preservation
  x = pow(max(x, vec3(0.0)), vec3(1.16));
  float luma = dot(x, vec3(0.2126, 0.7152, 0.0722));
  x = max(vec3(luma) + (x - vec3(luma)) * 1.12, vec3(0.0));

  x = agxMatInv * x;
  return clamp(x, 0.0, 1.0);
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

  // Subtle microscope edge chromatic dispersion (zero extra fetches across center 55%)
  float ca = smoothstep(0.52, 1.08, rDist) * (0.0007 + uMotion * 0.0015);
  vec4 centerTex = texture(uTex, vUv);
  vec3 base = centerTex.rgb;
  if (ca > 0.00005) {
    base.r = texture(uTex, vUv + dir * ca).r;
    base.b = texture(uTex, vUv - dir * ca).b;
  }

  // Depth-aware Leica / Zeiss macro optical Depth-of-Field with Karis highlight preservation (zero cost on sharp center pixels!)
  float coc = centerTex.a;
  if (coc > 0.04) {
    float radiusPx = coc * 5.2;
    vec3 dofAcc = base;
    float wSum = 1.0;
    for (int i = 0; i < 8; i++) {
      float ringScale = (i % 2 == 0) ? 1.0 : 0.58;
      vec2 off = BOKEH_TAPS[i] * (radiusPx * ringScale) * invRes;
      vec4 tap = texture(uTex, clamp(vUv + off, vec2(0.001), vec2(0.999)));
      float tapLuma = max(tap.r, max(tap.g, tap.b));
      float bokehHighlight = 1.0 + smoothstep(0.65, 2.2, tapLuma) * 0.55;
      float w = smoothstep(0.02, 0.25, tap.a) * (0.45 + 0.55 * ringScale) * bokehHighlight;
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

  // 5-Tap Contrast-Adaptive Sharpening (CAS) on lit in-focus pixels (skip on dark obsidian void!)
  float casAmt = (1.0 - smoothstep(0.04, 0.28, coc)) * (1.0 - smoothstep(0.04, 0.25, uMotion)) * 0.42;
  if (casAmt > 0.01 && max(base.r, max(base.g, base.b)) > 0.014) {
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
  // Wide localized emissive bounce (dialed back when hierarchical Radiance Cascades GI is active so we never double-dip!)
  vec3 bounce = texture(uBounceTex, vUv).rgb;
  float surfMask = smoothstep(0.008, 0.09, max(base.r, max(base.g, base.b)));
  vec3 col = base + bloom * 0.23 + bounce * (0.085 * surfMask + 0.015) * uBounceScale;

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

  // Subtle dark obsidian bottom floor scrim so the Liquid Glass zoom rail stays crisp even over bright copper/gold layers
  float bottomScrim = mix(0.32, 1.0, smoothstep(0.0, 0.16, vUv.y));
  col *= mix(1.0, bottomScrim, clamp(uIntroExposure, 0.0, 1.0));

  // AgX Filmic Tone Map (output is already display-referred sRGB-encoded!)
  col = agxToneMap(col * 1.18 * clamp(uIntroExposure, 0.0, 1.12));

  // Fine SEM micro-grain (eliminates dark banding without muddying crisp micro-detail)
  float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.0065;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

/**
 * Tight Screen-Space Quad Vertex Shader for Liquid Glass regions:
 * Rasterizes ONLY the ~2% of screen pixels covered by each glass pill/sheet + shadow pad!
 */
export const LIQUID_GL_VS = `#version 300 es
precision highp float;
const vec2 CORNERS[4] = vec2[4](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 1.0)
);
uniform vec2 uCssSize;
uniform vec4 uGlassRect; // (cx, cy, halfW, halfH) in DOM CSS px (top-left origin)
uniform float uQuadPad;
out vec2 vUv;

void main() {
  vec2 cssSize = max(uCssSize, vec2(1.0));
  vec2 centerGl = vec2(uGlassRect.x, cssSize.y - uGlassRect.y);
  vec2 halfExt = max(uGlassRect.zw, vec2(1.0)) + vec2(uQuadPad);
  vec2 minGl = clamp(centerGl - halfExt, vec2(0.0), cssSize);
  vec2 maxGl = clamp(centerGl + halfExt, vec2(0.0), cssSize);
  vec2 pGl = mix(minGl, maxGl, CORNERS[gl_VertexID]);
  vUv = pGl / cssSize;
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * True sRGB Liquid Glass Optical Pass (tight per-region quad — ~50x less fillrate!):
 *   - Runs in display sRGB space AFTER ACES tonemapping so glass clarity & speculars never wash out
 *   - Exact liquidGL two-term bevel optics: offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth
 *   - Exact liquidGL cornerNormal, centreBlend, optical lens magnification, RGB chromatic aberration
 *   - Fast 10-tap Golden-Angle Vogel disk frost (1 RGB fetch/tap in interior, RGB split only on refracting rim!)
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
uniform vec4 uGlassRect;     // (cx, cy, halfW, halfH) in DOM CSS px (top-left origin)
uniform vec4 uGlassParams;   // (radius, bevelWidthFrac, frost, style*4.0 + alpha)
uniform vec4 uPointerFluid;  // (ptrX, ptrY, velX, velY) in DOM CSS px

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

// vgpu.sh physical transmission spectral weighting (continuous 5-band prism dispersion!)
vec3 spectralWeight(float t) {
  return vec3(
    exp(-pow((t - 0.05) / 0.45, 2.0)),
    exp(-pow((t - 0.50) / 0.38, 2.0)),
    exp(-pow((t - 0.95) / 0.45, 2.0))
  );
}

// Physical Schlick dielectric Fresnel for crown glass (IOR = 1.52)
float dielectricFresnel(float ior, float facing) {
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  return f0 + (1.0 - f0) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}

vec3 sampleSpectralPrism(sampler2D tex, vec2 uv, vec2 chroma) {
  vec3 acc = vec3(0.0);
  vec3 wSum = vec3(0.0);
  for (int s = 0; s < 5; s++) {
    float t = float(s) * 0.25; // 0.0 .. 1.0 across visible spectrum
    vec3 w = spectralWeight(t);
    vec2 uvS = clamp(uv + chroma * (t * 2.0 - 1.0), vec2(0.001), vec2(0.999));
    acc += texture(tex, uvS).rgb * w;
    wSum += w;
  }
  return acc / max(wSum, vec3(1e-4));
}

void main() {
  vec3 bgCol = texture(uTex, vUv).rgb;
  vec2 cssSize = max(uCssSize, vec2(1.0));
  vec2 pGl = vUv * cssSize;

  float rawStyle = floor(uGlassParams.w * 0.25);
  int style = int(rawStyle + 0.5);
  float alpha = clamp(uGlassParams.w - rawStyle * 4.0, 0.0, 1.0);
  if (alpha < 0.005) {
    fragColor = vec4(bgCol, 1.0);
    return;
  }

  vec2 centerGl = vec2(uGlassRect.x, cssSize.y - uGlassRect.y);
  vec2 b_px = max(uGlassRect.zw, vec2(1.0));
  vec2 boxSize = b_px * 2.0;
  vec2 originalPoint = pGl - centerGl;
  float radius = min(uGlassParams.x, min(b_px.x, b_px.y));

  // Fluid viscosity pointer deformation (liquidGL deformPoint)
  vec2 p_px = originalPoint;
  vec2 ptrGl = vec2(uPointerFluid.x, cssSize.y - uPointerFluid.y);
  vec2 ptrVelGl = vec2(uPointerFluid.z, -uPointerFluid.w);
  if (dot(ptrVelGl, ptrVelGl) > 1e-6) {
    float reach = max(min(boxSize.x, boxSize.y) * 1.15, 48.0);
    float infl = 1.0 - smoothstep(0.0, reach, length(pGl - ptrGl));
    p_px -= clamp(ptrVelGl * 0.35, vec2(-10.0), vec2(10.0)) * infl;
  }

  float dmask = udRoundBox(p_px, b_px, radius);
  float inShape = 1.0 - smoothstep(-0.55, 0.55, dmask);
  vec3 col = bgCol;

  // Soft liquidGL elevation shadow outside glass boundary
  if (inShape < 1.0) {
    bool isDroplet = (style >= 2);
    float shD = udRoundBox(originalPoint - vec2(0.0, isDroplet ? -2.0 : -6.0), b_px, radius);
    float amb = exp(-max(shD, 0.0) * (isDroplet ? 0.20 : 0.095));
    float contact = exp(-max(dmask, 0.0) * 0.55);
    float shA = (amb * (isDroplet ? 0.24 : 0.32) + contact * 0.14) * (1.0 - inShape) * alpha;
    col *= (1.0 - shA);
  }

  if (inShape <= 0.002) {
    fragColor = vec4(col, 1.0);
    return;
  }

  bool isMagnifier = (style == 3);
  bool isDroplet   = (style >= 2);

  float refraction = (style == 2) ? 0.022 : (style == 1 ? 0.015 : 0.014);
  float bevelDepth = (style == 2) ? 0.062 : (style == 1 ? 0.088 : 0.068);
  float bevelWidth = uGlassParams.y;
  float aberration = isMagnifier ? 0.28  : (style == 2 ? 0.95  : (style == 1 ? 0.65  : 0.72));
  float magnify    = isMagnifier ? 1.14  : (style == 2 ? 1.10  : (style == 1 ? 1.03  : 1.045));
  float frost      = uGlassParams.z;

  vec2 lensUV = (p_px + b_px) / boxSize;
  vec2 pNorm = p_px / max(boxSize.y, 1.0);

  float edge = edgeFactor(p_px, b_px, radius, bevelWidth, boxSize);
  vec2 refractDir;
  vec2 offsetUv;
  if (isMagnifier) {
    // Analytical rounded-capsule SDF normal + pill-radius-calibrated convex edge refraction:
    // crystal-clear 1.14x magnification in the center, smooth rounded-edge optical wrap & refined prism glint on the rim!
    float eps = 0.75;
    float gx = udRoundBox(p_px + vec2(eps, 0.0), b_px, radius) - udRoundBox(p_px - vec2(eps, 0.0), b_px, radius);
    float gy = udRoundBox(p_px + vec2(0.0, eps), b_px, radius) - udRoundBox(p_px - vec2(0.0, eps), b_px, radius);
    refractDir = normalize(vec2(gx, gy) + vec2(1e-6));
    float bevelPx = (pow(edge, 1.9) * 0.22 + pow(edge, 4.5) * 0.46) * radius;
    // Keep full horizontal rounded-end wrap while moderating vertical pull so centered letters never echo on top/bottom rim
    offsetUv = (vec2(-refractDir.x, -refractDir.y * 0.38) * bevelPx) / cssSize;
  } else {
    float offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth;
    float centreBlend = smoothstep(0.12, 0.44, length(pNorm));
    refractDir = cornerNormal(p_px, b_px, radius, normalize(pNorm + vec2(1e-6)));
    vec2 offset = refractDir * offsetAmt * centreBlend;
    vec2 aspectScale = vec2(min(cssSize.x, cssSize.y)) / cssSize;
    offsetUv = offset * aspectScale;
  }

  vec2 localUV = (lensUV - 0.5) / magnify + 0.5;
  vec2 mapped = (centerGl + (localUV - 0.5) * boxSize) / cssSize;
  vec2 refracted = mapped + offsetUv;
  float oob = max(max(-refracted.x, refracted.x - 1.0), max(-refracted.y, refracted.y - 1.0));
  float blendOob = 1.0 - smoothstep(0.0, 0.01, oob);
  vec2 sampleUV = mix(mapped, refracted, blendOob);

  vec2 chroma = offsetUv * aberration;
  vec3 refrCol;

  if (frost > 0.05) {
    // Fast 10-tap Golden-Angle Vogel disk frost: 1 RGB fetch/tap in flat interior, split RGB only on bevel rim!
    float radiusCss = frost * 3.0;
    vec2 radUv = vec2(radiusCss) / cssSize;
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    vec3 acc = vec3(0.0);
    const float GOLDEN_ANGLE = 2.39996323;
    bool hasChroma = dot(chroma, chroma) > 1e-7;
    for (int i = 0; i < 10; i++) {
      float fi = (float(i) + 0.5) * 0.1;
      float rTap = sqrt(fi);
      float ang = float(i) * GOLDEN_ANGLE + rot;
      vec2 foff = vec2(cos(ang), sin(ang)) * rTap * radUv;
      if (hasChroma) {
        acc.r += texture(uTex, clamp(sampleUV + foff - chroma, vec2(0.001), vec2(0.999))).r;
        acc.g += texture(uTex, clamp(sampleUV + foff,          vec2(0.001), vec2(0.999))).g;
        acc.b += texture(uTex, clamp(sampleUV + foff + chroma, vec2(0.001), vec2(0.999))).b;
      } else {
        acc += texture(uTex, clamp(sampleUV + foff, vec2(0.001), vec2(0.999))).rgb;
      }
    }
    refrCol = acc * 0.1;
  } else if (isMagnifier) {
    // Razor-sharp optical magnifier sampling + smooth 5-band continuous spectral prism dispersion on the curved rim!
    if (dot(chroma, chroma) > 1e-7) {
      refrCol = sampleSpectralPrism(uTex, sampleUV, chroma);
    } else {
      vec2 sub = (0.32) / max(uResolution, vec2(1.0));
      vec3 g0 = texture(uTex, clamp(sampleUV, vec2(0.001), vec2(0.999))).rgb;
      vec3 g1 = texture(uTex, clamp(sampleUV + vec2( sub.x,  sub.y), vec2(0.001), vec2(0.999))).rgb;
      vec3 g2 = texture(uTex, clamp(sampleUV + vec2(-sub.x, -sub.y), vec2(0.001), vec2(0.999))).rgb;
      refrCol = g0 * 0.5 + (g1 + g2) * 0.25;
    }
  } else {
    // Pure crystal-clear liquidGL droplet lens with continuous 5-band prism dispersion on refracting bevels!
    if (dot(chroma, chroma) > 1e-7) {
      refrCol = sampleSpectralPrism(uTex, sampleUV, chroma);
    } else {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      refrCol = texture(uTex, clamp(sampleUV, vec2(0.001), vec2(0.999))).rgb;
      refrCol += texture(uTex, clamp(sampleUV + vec2( texel.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
      refrCol += texture(uTex, clamp(sampleUV + vec2(-texel.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
      refrCol += texture(uTex, clamp(sampleUV + vec2(0.0,  texel.y), vec2(0.001), vec2(0.999))).rgb;
      refrCol += texture(uTex, clamp(sampleUV + vec2(0.0, -texel.y), vec2(0.001), vec2(0.999))).rgb;
      refrCol *= 0.2;
    }
  }

  refrCol = saturateSrgb(refrCol, isDroplet ? 1.18 : 1.15);

  float luma = dot(refrCol, vec3(0.2126, 0.7152, 0.0722));
  if (isMagnifier) {
    // Keep white text inside the magnifier pill brilliant & crisp while giving dark backgrounds subtle optical glass body
    float brightPreserve = mix(1.04, 0.99, smoothstep(0.55, 0.98, luma));
    refrCol = refrCol * brightPreserve + vec3(0.068, 0.076, 0.094) * (1.0 - 0.78 * luma);
  } else if (style == 2) {
    float brightTame = mix(1.04, 0.74, smoothstep(0.45, 0.95, luma));
    refrCol = refrCol * brightTame + vec3(0.075, 0.082, 0.098) * (1.0 - 0.55 * luma);
  } else if (style == 1) {
    float tintStrength = mix(0.28, 0.56, smoothstep(0.18, 0.85, luma));
    refrCol = mix(refrCol, refrCol * vec3(0.46, 0.50, 0.60), tintStrength) + vec3(0.025, 0.029, 0.038);
  } else {
    float tintStrength = mix(0.14, 0.46, smoothstep(0.25, 0.88, luma));
    refrCol = mix(refrCol, refrCol * vec3(0.55, 0.60, 0.70), tintStrength) + vec3(0.022, 0.026, 0.036);
  }

  vec2 lp1 = vec2(sin(uTime * 0.20), cos(uTime * 0.30)) * 0.6 + 0.5;
  vec2 lp2 = vec2(sin(uTime * -0.40 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
  float sheen = 0.0;
  sheen += smoothstep(0.42, 0.0, distance(lensUV, lp1)) * (isDroplet ? 0.085 : 0.055);
  sheen += smoothstep(0.52, 0.0, distance(lensUV, lp2)) * (isDroplet ? 0.065 : 0.042);
  refrCol += vec3(sheen);

  float distIn = max(-dmask, 0.0);
  float rimLine = exp(-pow(distIn / 0.88, 2.0));
  float keyCatch = pow(max(dot(refractDir, normalize(vec2(-0.55, 0.84))), 0.0), 1.9);
  float bncCatch = pow(max(dot(refractDir, normalize(vec2( 0.55,-0.84))), 0.0), 2.1);
  // Crown-glass dielectric Fresnel (IOR 1.52) wraps grazing bevel edges with subtle realistic glass glint
  float glassFacing = clamp(1.0 - edge * 0.92, 0.08, 1.0);
  float fresnelRim = dielectricFresnel(1.52, glassFacing) * edge * (isDroplet ? 0.26 : 0.16);
  float rimAmt = (0.10 + 0.68 * keyCatch + 0.36 * bncCatch) * (isDroplet ? 0.60 : 0.38);

  float ptrDist = length(pGl - ptrGl);
  float ptrEdge = exp(-(ptrDist * ptrDist) / (115.0 * 115.0)) * rimLine * 0.28;

  refrCol += vec3(0.94, 0.98, 1.0) * (rimLine * rimAmt + ptrEdge + fresnelRim);

  fragColor = vec4(mix(col, clamp(refrCol, 0.0, 1.0), inShape * alpha), 1.0);
}
`;

export const VERNIER_STRIP_VS = `#version 300 es
precision highp float;

uniform vec2 uCssSize;
uniform vec4 uVernierRect; // (cx, cy, halfW, halfH) in DOM CSS px (top-left origin)

out vec2 vLocalUv;

void main() {
  vec2 c = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec2 cssSize = max(uCssSize, vec2(1.0));
  vec2 centerGl = vec2(uVernierRect.x, cssSize.y - uVernierRect.y);
  vec2 halfExt = max(uVernierRect.zw, vec2(1.0));
  vec2 posGl = centerGl + c * halfExt;
  vec2 uv = posGl / cssSize;
  vLocalUv = c * 0.5 + 0.5;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const VERNIER_STRIP_FS = `#version 300 es
precision highp float;

in vec2 vLocalUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec4 uVernierRect;  // (cx, cy, halfW, halfH) in CSS px
uniform vec4 uTexParams;    // (originCss, pitchCss, texWidthCss, zoom)
uniform vec4 uFadeParams;   // (loupeHalfW, alpha, 0, 0)

void main() {
  float alpha = uFadeParams.y;
  if (alpha < 0.005) discard;

  float halfW = max(uVernierRect.z, 1.0);
  float xLocal = (vLocalUv.x - 0.5) * (halfW * 2.0);
  float texX = uTexParams.x + uTexParams.w * uTexParams.y + xLocal;
  float u = texX / max(uTexParams.z, 1.0);
  if (u <= 0.001 || u >= 0.999) discard;

  float v = 1.0 - vLocalUv.y;
  vec4 texCol = texture(uTex, vec2(u, v));
  if (texCol.a < 0.003) discard;

  // Soft open-air horizontal dissolve at left/right ends
  float edgeFade = smoothstep(0.0, 0.18, vLocalUv.x) * smoothstep(1.0, 0.82, vLocalUv.x);
  // Subtle optical prominence under/inside the center Liquid Glass pill vs whisper-quiet neighboring stops
  float loupeHalfW = max(uFadeParams.x, 22.0);
  float centerFocus = 1.0 - smoothstep(loupeHalfW * 0.78, loupeHalfW * 1.52, abs(xLocal));
  float focusAlpha = mix(0.66, 1.0, centerFocus);

  float mask = edgeFade * focusAlpha * alpha;
  fragColor = texCol * mask; // Premultiplied RGBA -> zero dark halo when magnified!
}
`;

/** Separable 9-tap Gaussian blur for half-res World 0 planar reflection & SSR roughness cone */
export const PLANAR_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uDir; // (texelX, 0) or (0, texelY)

void main() {
  vec4 acc = texture(uTex, vUv) * 0.227027;
  acc += texture(uTex, clamp(vUv + uDir * 1.3846, vec2(0.001), vec2(0.999))) * 0.316216;
  acc += texture(uTex, clamp(vUv - uDir * 1.3846, vec2(0.001), vec2(0.999))) * 0.316216;
  acc += texture(uTex, clamp(vUv + uDir * 3.2308, vec2(0.001), vec2(0.999))) * 0.070270;
  acc += texture(uTex, clamp(vUv - uDir * 3.2308, vec2(0.001), vec2(0.999))) * 0.070270;
  fragColor = acc;
}
`;

/**
 * Half-Res Horizon-Based GTAO + Screen-Space Contact Shadows:
 *   - Uses 4-scalar frustum projection math (uProjParams) instead of mat4*vec4 (~60% less ALU!)
 *   - 3 IGN-rotated horizon slices x 3 steps = smooth omnidirectional crevice occlusion across all 10 scales
 *   - 6-step short-range contact shadow raymarch along key light direction for MLCC caps, vias & GAA spacers
 *   - Outputs vec4(gtao, contactShadow, linearViewZ * 0.02, 1.0)
 */
export const GTAO_CS_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDepthTex;
uniform vec4 uProjParams; // (invP00, invP11, proj10, proj14)
uniform vec2 uProjScale;  // (proj00 * 0.5, proj11 * 0.5)
uniform vec2 uTexelSize;
uniform vec3 uLightDirView;
uniform float uAoStrength;
uniform float uCsStrength;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}

float sampleLinearZ(vec2 uv, out float rawD) {
  rawD = texture(uDepthTex, uv).r;
  float ndcZ = rawD * 2.0 - 1.0;
  return uProjParams.w / (ndcZ + uProjParams.z);
}

float sampleLinearZFast(vec2 uv) {
  float ndcZ = texture(uDepthTex, uv).r * 2.0 - 1.0;
  return uProjParams.w / (ndcZ + uProjParams.z);
}

vec3 reconstructViewPos(vec2 uv, float viewZ) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uProjParams.xy * viewZ, -viewZ);
}

void main() {
  float dC;
  float viewZ = sampleLinearZ(vUv, dC);
  if (dC >= 0.9995 || uAoStrength < 0.01) {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }

  vec3 posC = reconstructViewPos(vUv, viewZ);
  vec2 tx = uTexelSize;

  // Silhouette-preserving view-space normal reconstruction (minimum depth-delta cross product)
  vec2 uvR = clamp(vUv + vec2(tx.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvL = clamp(vUv - vec2(tx.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvU = clamp(vUv + vec2(0.0, tx.y), vec2(0.001), vec2(0.999));
  vec2 uvD = clamp(vUv - vec2(0.0, tx.y), vec2(0.001), vec2(0.999));
  float zR = sampleLinearZFast(uvR);
  float zL = sampleLinearZFast(uvL);
  float zU = sampleLinearZFast(uvU);
  float zD = sampleLinearZFast(uvD);
  vec3 dX = (abs(zR - viewZ) < abs(viewZ - zL))
    ? (reconstructViewPos(uvR, zR) - posC)
    : (posC - reconstructViewPos(uvL, zL));
  vec3 dY = (abs(zU - viewZ) < abs(viewZ - zD))
    ? (reconstructViewPos(uvU, zU) - posC)
    : (posC - reconstructViewPos(uvD, zD));
  vec3 viewN = normalize(cross(dX, dY) + vec3(0.0, 0.0, 1e-5));
  vec3 viewV = normalize(-posC);
  if (dot(viewN, viewV) < 0.0) viewN = -viewN;

  // Adaptive world-space radius scaled to current camera distance (works uniformly across all 10 scales!)
  float worldRad = clamp(viewZ * 0.048, 0.05, 0.55);
  float invMaxDist = 1.0 / (worldRad * 1.85);
  float screenRadUv = clamp((worldRad * uProjScale.y) / max(viewZ, 0.05), 0.004, 0.065);
  float invAspect = uProjParams.x / max(uProjParams.y, 0.001);

  float noiseA = ign(gl_FragCoord.xy);
  float noiseR = ign(gl_FragCoord.xy + vec2(17.0, 31.0));
  const float PI_THIRD = 1.04719755;

  // 3-slice x 3-step Horizon-Based GTAO (IGN-rotated + depth-aware bilateral blur)
  float occSum = 0.0;
  for (int s = 0; s < 3; s++) {
    float phi = (float(s) + noiseA) * PI_THIRD;
    vec2 dir = vec2(cos(phi) / invAspect, sin(phi));
    float maxH1 = -0.15;
    float maxH2 = -0.15;

    for (int st = 1; st <= 3; st++) {
      float frac = (float(st) - 0.5 + 0.45 * noiseR) * (1.0 / 3.0);
      vec2 off = dir * (screenRadUv * frac * frac * 1.15 + tx * 1.1);

      vec2 uv1 = vUv + off;
      if (uv1.x > 0.002 && uv1.x < 0.998 && uv1.y > 0.002 && uv1.y < 0.998) {
        vec3 diff1 = reconstructViewPos(uv1, sampleLinearZFast(uv1)) - posC;
        float len1 = length(diff1);
        if (len1 > 1e-4) {
          float falloff = clamp(1.0 - len1 * invMaxDist, 0.0, 1.0);
          maxH1 = max(maxH1, (dot(diff1, viewN) / len1) * falloff);
        }
      }

      vec2 uv2 = vUv - off;
      if (uv2.x > 0.002 && uv2.x < 0.998 && uv2.y > 0.002 && uv2.y < 0.998) {
        vec3 diff2 = reconstructViewPos(uv2, sampleLinearZFast(uv2)) - posC;
        float len2 = length(diff2);
        if (len2 > 1e-4) {
          float falloff = clamp(1.0 - len2 * invMaxDist, 0.0, 1.0);
          maxH2 = max(maxH2, (dot(diff2, viewN) / len2) * falloff);
        }
      }
    }

    float o1 = clamp(maxH1 - 0.07, 0.0, 1.0);
    float o2 = clamp(maxH2 - 0.07, 0.0, 1.0);
    occSum += (o1 + o2) * 0.5;
  }

  float ao = clamp(1.0 - (occSum * (1.0 / 3.0)) * 1.38 * uAoStrength, 0.16, 1.0);

  // Short-Range Screen-Space Contact Shadows (6 steps along key light in view space)
  float contactSh = 1.0;
  float ndotl = dot(viewN, uLightDirView);
  if (uCsStrength > 0.01 && ndotl > 0.04) {
    float marchDist = clamp(viewZ * 0.022, 0.02, 0.30);
    float thickness = clamp(viewZ * 0.015, 0.015, 0.22);
    float bias = clamp(viewZ * 0.0022, 0.002, 0.028);
    float hit = 0.0;

    for (int i = 1; i <= 6; i++) {
      float t = (float(i) - 0.35 + 0.55 * noiseR) * (1.0 / 6.0);
      vec3 sampleVp = posC + uLightDirView * (marchDist * t);
      float rayZ = -sampleVp.z;
      if (rayZ <= 0.001) break;
      vec2 suv = (sampleVp.xy * uProjScale) / rayZ + 0.5;
      if (suv.x < 0.002 || suv.x > 0.998 || suv.y < 0.002 || suv.y > 0.998) break;
      float delta = rayZ - sampleLinearZFast(suv);
      if (delta > bias && delta < thickness) {
        float fade = (1.0 - t * 0.65) * smoothstep(thickness, thickness * 0.25, delta);
        hit = max(hit, fade);
      }
    }
    contactSh = 1.0 - hit * 0.58 * uCsStrength;
  }

  fragColor = vec4(ao, contactSh, clamp(viewZ * 0.02, 0.0, 1.0), 1.0);
}
`;

/** Depth-aware separable bilateral blur for GTAO & Contact Shadows (preserves crisp geometric silhouettes!) */
export const AO_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAoTex;
uniform vec2 uDir; // (texelX, 0) or (0, texelY)

void main() {
  vec4 c0 = texture(uAoTex, vUv);
  float z0 = c0.b;
  vec2 acc = c0.rg * 0.28;
  float wSum = 0.28;

  const float offs[4] = float[4](-2.0, -1.0, 1.0, 2.0);
  const float kW[4] = float[4](0.12, 0.24, 0.24, 0.12);
  for (int i = 0; i < 4; i++) {
    vec2 suv = clamp(vUv + uDir * offs[i], vec2(0.001), vec2(0.999));
    vec4 s = texture(uAoTex, suv);
    float dz = abs(s.b - z0);
    float depthW = exp(-dz * dz * 1800.0);
    float w = kW[i] * depthW;
    acc += s.rg * w;
    wSum += w;
  }
  fragColor = vec4(acc / max(wSum, 0.001), z0, 1.0);
}
`;

/**
 * Half-Res Screen-Space Reflections (SSR) for Inter-Surface Metallic & Signal Bounce:
 *   - Uses 4-scalar frustum projection math (zero mat4*vec4 in raymarch loop!)
 *   - 12-step quadratic view-space raymarch + 3-step binary refinement
 *   - Skips matte epoxy, sky, and World 0 plinth (which already uses exact planar reflection!)
 */
export const SSR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uHdrTex;
uniform sampler2D uDepthTex;
uniform sampler2D uGbufTex;
uniform vec4 uProjParams; // (invP00, invP11, proj10, proj14)
uniform vec2 uProjScale;  // (proj00 * 0.5, proj11 * 0.5)
uniform vec2 uTexelSize;
uniform float uSsrStrength;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}

float sampleLinearZ(vec2 uv, out float rawD) {
  rawD = texture(uDepthTex, uv).r;
  float ndcZ = rawD * 2.0 - 1.0;
  return uProjParams.w / (ndcZ + uProjParams.z);
}

float sampleLinearZFast(vec2 uv) {
  float ndcZ = texture(uDepthTex, uv).r * 2.0 - 1.0;
  return uProjParams.w / (ndcZ + uProjParams.z);
}

vec3 reconstructViewPos(vec2 uv, float viewZ) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uProjParams.xy * viewZ, -viewZ);
}

void main() {
  if (uSsrStrength < 0.01) {
    fragColor = vec4(0.0);
    return;
  }
  vec4 gbuf = texture(uGbufTex, vUv);
  // Skip background (a < 0.75 skips sky AND World 0 plinth which already uses exact planar reflection!)
  if (gbuf.a < 0.75 || gbuf.r < 0.20 || gbuf.g > 0.46) {
    fragColor = vec4(0.0);
    return;
  }

  float dC;
  float viewZ = sampleLinearZ(vUv, dC);
  if (dC >= 0.9995) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 posC = reconstructViewPos(vUv, viewZ);
  vec2 tx = uTexelSize;
  vec2 uvR = clamp(vUv + vec2(tx.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvL = clamp(vUv - vec2(tx.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvU = clamp(vUv + vec2(0.0, tx.y), vec2(0.001), vec2(0.999));
  vec2 uvD = clamp(vUv - vec2(0.0, tx.y), vec2(0.001), vec2(0.999));
  float zR = sampleLinearZFast(uvR);
  float zL = sampleLinearZFast(uvL);
  float zU = sampleLinearZFast(uvU);
  float zD = sampleLinearZFast(uvD);
  vec3 dX = (abs(zR - viewZ) < abs(viewZ - zL))
    ? (reconstructViewPos(uvR, zR) - posC)
    : (posC - reconstructViewPos(uvL, zL));
  vec3 dY = (abs(zU - viewZ) < abs(viewZ - zD))
    ? (reconstructViewPos(uvU, zU) - posC)
    : (posC - reconstructViewPos(uvD, zD));
  vec3 viewN = normalize(cross(dX, dY) + vec3(0.0, 0.0, 1e-5));
  vec3 viewDir = normalize(posC);
  if (dot(viewN, -viewDir) < 0.0) viewN = -viewN;

  vec3 reflDir = normalize(reflect(viewDir, viewN));
  if (reflDir.z > 0.35) {
    fragColor = vec4(0.0);
    return;
  }

  float maxDist = clamp(viewZ * 0.38, 0.25, 3.6);
  float thickness = clamp(viewZ * 0.032, 0.03, 0.38);
  float jitter = ign(gl_FragCoord.xy);

  vec3 rayOrig = posC + viewN * (viewZ * 0.003);
  vec3 prevPos = rayOrig;
  bool hitFound = false;
  vec2 hitUv = vec2(0.0);
  float hitT = 0.0;

  for (int i = 1; i <= 12; i++) {
    float t = (float(i) - 0.5 + jitter * 0.8) * (1.0 / 12.0);
    vec3 currPos = rayOrig + reflDir * (maxDist * t * t);
    float rayZ = -currPos.z;
    if (rayZ <= 0.001) break;
    vec2 suv = (currPos.xy * uProjScale) / rayZ + 0.5;
    if (suv.x < 0.003 || suv.x > 0.997 || suv.y < 0.003 || suv.y > 0.997) break;

    float delta = rayZ - sampleLinearZFast(suv);
    if (delta > 0.001 && delta < thickness) {
      // 3-step binary refinement between prevPos and currPos
      vec3 lo = prevPos;
      vec3 hi = currPos;
      for (int b = 0; b < 3; b++) {
        vec3 mid = 0.5 * (lo + hi);
        float mRayZ = -mid.z;
        vec2 muv = (mid.xy * uProjScale) / max(mRayZ, 1e-5) + 0.5;
        float mz = sampleLinearZFast(clamp(muv, vec2(0.002), vec2(0.998)));
        if (mRayZ > mz) {
          hi = mid;
          hitUv = muv;
        } else {
          lo = mid;
        }
      }
      hitFound = true;
      hitT = t;
      break;
    }
    prevPos = currPos;
  }

  if (!hitFound) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 hitCol = min(texture(uHdrTex, clamp(hitUv, vec2(0.002), vec2(0.998))).rgb, vec3(3.2));
  float edgeFade = smoothstep(0.0, 0.08, min(min(hitUv.x, 1.0 - hitUv.x), min(hitUv.y, 1.0 - hitUv.y)));
  float distFade = 1.0 - smoothstep(0.45, 1.0, hitT);
  float backFade = 1.0 - smoothstep(0.05, 0.35, reflDir.z);
  float conf = edgeFade * distFade * backFade * uSsrStrength;
  fragColor = vec4(hitCol * conf, conf);
}
`;

/**
 * Screen-Space Radiance Cascades GI (adapted from vgpu.sh radiance-cascades):
 *   Pass A (RC_EMITTER_FS): Extracts HDR emissive sources (active cores, switching gates, pulses,
 *                           electron clouds) + linear view-space depth for wall occlusion.
 *   Pass B (RC_CASCADE_FS): 4-level top-down probe-atlas hierarchy (C3 -> C2 -> C1 -> C0 on 256x256
 *                           RGBA16F ping-pong targets) using probe-space bilinear merge-then-average.
 *   Pass C (RC_RESOLVE_FS): Integrates Cascade 0's 4 angular sectors into a smooth 128x128 GI map.
 */
export const RC_EMITTER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uHdrTex;
uniform sampler2D uGbufTex;
uniform sampler2D uDepthTex;
uniform vec4 uProjParams; // (invP00, invP11, proj10, proj14)

void main() {
  vec3 hdr = texture(uHdrTex, vUv).rgb;
  vec4 gbuf = texture(uGbufTex, vUv);
  float rawD = texture(uDepthTex, vUv).r;
  float linearZ = 0.0;
  if (rawD < 0.9995) {
    float ndcZ = rawD * 2.0 - 1.0;
    linearZ = max(0.01, uProjParams.w / (ndcZ + uProjParams.z));
  }

  float emMask = smoothstep(0.05, 0.34, gbuf.b);
  // Only bounce genuine energized silicon signals (cores, copper pulses, CMOS gates, GAA ribbons, orbitals)
  // — never non-emissive white/grey studio reflections on the bezel, titanium, or quarter!
  float cMax = max(hdr.r, max(hdr.g, hdr.b));
  float cMin = min(hdr.r, min(hdr.g, hdr.b));
  float chroma = (cMax - cMin) / max(cMax, 1e-4);
  float chromaticFocus = 0.28 + 0.72 * smoothstep(0.08, 0.38, chroma);
  vec3 emitter = min(hdr * emMask * chromaticFocus, vec3(3.4));

  fragColor = vec4(emitter, linearZ);
}
`;

export const RC_CASCADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uEmitterTex;
uniform sampler2D uUpperTex;
uniform vec4 uCascadeParams; // (cascadeIdx, hasUpper, atlasSize, aspect)

const float PI2 = 6.28318530718;

float rcIntervalStart(float c) {
  return 1.35 * (pow(4.0, c) - 1.0) / 3.0;
}

float rcIntervalLength(float c) {
  return 1.35 * pow(4.0, c);
}

vec4 rcMerge(vec4 nearR, vec4 farR) {
  return vec4(nearR.rgb + nearR.a * farR.rgb, nearR.a * farR.a);
}

void main() {
  float cascade = uCascadeParams.x;
  float hasUpper = uCascadeParams.y;
  float atlasSize = uCascadeParams.z;
  float aspect = uCascadeParams.w;

  vec2 texel = floor(vUv * atlasSize);
  float block = exp2(cascade + 1.0); // C0=2, C1=4, C2=8, C3=16
  float rays = block * block;        // C0=4, C1=16, C2=64, C3=256
  vec2 probeGrid = vec2(atlasSize / block);

  // Decode interleaved probe & direction index (exact vgpu.sh atlas layout)
  vec2 probe = floor(texel / block);
  vec2 localDir = texel - probe * block;
  float dirIdx = localDir.y * block + localDir.x;

  vec2 originUv = (probe + 0.5) / probeGrid;
  float angle = (dirIdx + 0.5) / rays * PI2;
  vec2 dir = vec2(cos(angle), sin(angle));
  // Aspect-correct UV step so screen-space radiance propagation is isotropic on widescreen displays
  vec2 uvStepScale = vec2(1.0 / max(aspect, 0.5), 1.0) / atlasSize;

  float tStart = rcIntervalStart(cascade);
  float tEnd = tStart + rcIntervalLength(cascade) * 1.04;
  float originZ = texture(uEmitterTex, originUv).a;

  // Energy-normalized raymarch across this cascade's geometric interval with bilateral 3D depth locality
  vec4 rad = vec4(0.0, 0.0, 0.0, 1.0);
  const int STEPS = 6;
  const float INV_STEPS = 1.0 / 6.0;
  float dt = (tEnd - tStart) * INV_STEPS;
  for (int i = 0; i < STEPS; i++) {
    float t = tStart + (float(i) + 0.5) * dt;
    vec2 suv = originUv + dir * t * uvStepScale;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
      break;
    }
    vec4 s = texture(uEmitterTex, suv);
    float emLum = max(s.r, max(s.g, s.b));
    float sZ = s.a;

    // Occlusion test: block light sharply across abrupt depth cliffs / raised walls
    if (originZ > 0.01 && sZ > 0.01 && sZ < originZ * 0.88 && emLum < 0.08) {
      rad.a *= 0.52;
      if (rad.a < 0.02) break;
    }

    if (emLum > 0.01) {
      // Keep bounce light tightly coupled to the emitting 3D depth neighborhood (zero bleed across foreground/background!)
      float depthMatch = (originZ <= 0.01 || sZ <= 0.01)
        ? 0.30
        : exp(-abs(sZ - originZ) / max(originZ * 0.18, 0.06));
      float falloff = 1.0 / (1.0 + t * 0.055 + t * t * 0.0022);
      float contrib = rad.a * depthMatch * falloff * INV_STEPS;
      rad.rgb += s.rgb * contrib * 2.25;
      rad.a *= exp(-emLum * (0.35 + 0.65 * depthMatch) * 0.55);
      if (rad.a < 0.02) break;
    }
  }

  // Top-down cascade merge-then-average with probe-space clamping (prevents direction bleed at borders!)
  if (hasUpper > 0.5) {
    float upperBlock = block * 2.0;
    vec2 upperGrid = vec2(atlasSize / upperBlock);
    vec2 pos = originUv * upperGrid - 0.5;
    vec2 base = floor(pos);
    vec2 f = clamp(pos - base, vec2(0.0), vec2(1.0));
    float w00 = (1.0 - f.x) * (1.0 - f.y);
    float w10 = f.x * (1.0 - f.y);
    float w01 = (1.0 - f.x) * f.y;
    float w11 = f.x * f.y;

    vec2 p00 = clamp(base + vec2(0.0, 0.0), vec2(0.0), upperGrid - 1.0);
    vec2 p10 = clamp(base + vec2(1.0, 0.0), vec2(0.0), upperGrid - 1.0);
    vec2 p01 = clamp(base + vec2(0.0, 1.0), vec2(0.0), upperGrid - 1.0);
    vec2 p11 = clamp(base + vec2(1.0, 1.0), vec2(0.0), upperGrid - 1.0);

    vec4 farAcc = vec4(0.0);
    for (int b = 0; b < 4; b++) {
      float upperDir = dirIdx * 4.0 + float(b);
      vec2 uOff = vec2(mod(upperDir, upperBlock), floor(upperDir / upperBlock));
      vec4 c00 = texelFetch(uUpperTex, ivec2(p00 * upperBlock + uOff), 0);
      vec4 c10 = texelFetch(uUpperTex, ivec2(p10 * upperBlock + uOff), 0);
      vec4 c01 = texelFetch(uUpperTex, ivec2(p01 * upperBlock + uOff), 0);
      vec4 c11 = texelFetch(uUpperTex, ivec2(p11 * upperBlock + uOff), 0);
      farAcc += (c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11) * 0.25;
    }
    rad = rcMerge(rad, farAcc);
  }

  fragColor = rad;
}
`;

export const RC_RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCascade0Tex;
uniform float uAtlasSize;

void main() {
  // Cascade 0 has block=2 (4 angular sectors per probe) over a (atlasSize/2) probe grid
  float probeGrid = uAtlasSize * 0.5;
  vec2 probe = clamp(floor(vUv * probeGrid), vec2(0.0), vec2(probeGrid - 1.0));
  ivec2 base = ivec2(probe * 2.0);

  vec3 sum = (
    texelFetch(uCascade0Tex, base + ivec2(0, 0), 0).rgb +
    texelFetch(uCascade0Tex, base + ivec2(1, 0), 0).rgb +
    texelFetch(uCascade0Tex, base + ivec2(0, 1), 0).rgb +
    texelFetch(uCascade0Tex, base + ivec2(1, 1), 0).rgb
  ) * 0.25;

  fragColor = vec4(min(sum, vec3(3.5)), 1.0);
}
`;

/**
 * Full-Res Scene Lighting Resolve (runs on HDR BEFORE Bloom so Bloom responds to real GTAO, SSR & Radiance Cascades GI!):
 *   - Combines hdrMain + depth-blurred GTAO + Contact Shadows + Screen-Space Inter-Surface Reflections
 *   - Adds hierarchical Screen-Space Radiance Cascades emissive GI (multi-bounce colored glow with wall occlusion!)
 *   - Applies Lagarde Specular Occlusion & protects emissive signals/orbitals cleanly
 *   - Preserves optical CoC in alpha!
 */
export const SCENE_RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uHdrTex;
uniform sampler2D uGbufTex;
uniform sampler2D uAoTex;
uniform sampler2D uSsrTex;
uniform sampler2D uSsrBlurTex;
uniform sampler2D uRcGiTex;
uniform float uAoMix;
uniform float uSsrMix;
uniform float uRcMix;

void main() {
  vec4 hdr = texture(uHdrTex, vUv);
  vec4 gbuf = texture(uGbufTex, vUv);
  vec3 col = hdr.rgb;

  // Only modulate opaque scene geometry (gbuf.a > 0.25); preserve deep void & translucent halos
  if (gbuf.a > 0.25) {
    float metal = gbuf.r;
    float rough = gbuf.g;
    float emMask = gbuf.b;

    vec2 aoCs = texture(uAoTex, vUv).rg;
    float gtao = mix(1.0, aoCs.r, uAoMix);
    float contactSh = mix(1.0, aoCs.g, uAoMix);

    // Protect emissive live pulses/signals from AO & contact shadow darkening
    float shadeProt = 1.0 - smoothstep(0.06, 0.45, emMask);
    // Lagarde-inspired metallic contrast: crevices in metals darken cleanly without crushing flat exposed faces
    float occ = mix(1.0, gtao * mix(1.0, contactSh, 0.72), shadeProt * (0.78 + 0.22 * metal));
    col *= occ;

    // Hierarchical Screen-Space Radiance Cascades GI: localized colored bounce from active silicon signals ONLY!
    // Preserves deep obsidian studio shadows (via gtao^2 & lit-surface coupling) and avoids double-bloom blowouts!
    if (uRcMix > 0.01) {
      vec3 gi = texture(uRcGiTex, vUv).rgb;
      float baseLum = max(col.r, max(col.g, col.b));
      float litSurf = smoothstep(0.008, 0.075, baseLum);
      // Couple strongly to metallic copper/silicon walls & crisp surfaces while keeping deep shadow recesses dark
      float surfResp = (0.32 + 0.68 * metal) * (0.25 + 0.75 * litSurf) * (gtao * gtao) * (0.18 + 0.82 * shadeProt);
      // Enrich chromatic purity of bounced silicon light so it glows jewel-like rather than greying out dark surfaces
      float giLum = dot(gi, vec3(0.2126, 0.7152, 0.0722));
      vec3 giRich = max(vec3(giLum) + (gi - vec3(giLum)) * 1.28, vec3(0.0));
      vec3 bounce = min(giRich * surfResp * uRcMix * 0.58, vec3(0.75));
      col += bounce;
    }

    // Inter-Surface Screen-Space Reflections (skip World 0 plinth where gbuf.a ~ 0.5 already has exact planar reflection)
    if (uSsrMix > 0.01 && gbuf.a > 0.75 && metal > 0.20 && rough < 0.46) {
      vec4 ssrSharp = texture(uSsrTex, vUv);
      vec4 ssrSoft = texture(uSsrBlurTex, vUv);
      float blurW = smoothstep(0.06, 0.36, rough);
      vec4 ssr = mix(ssrSharp, ssrSoft, blurW);
      if (ssr.a > 0.004) {
        vec3 reflRad = ssr.rgb / max(ssr.a, 0.001);
        float gloss = 1.0 - smoothstep(0.06, 0.46, rough);
        float reflWeight = ssr.a * gloss * metal * uSsrMix * 0.44 * (0.45 + 0.55 * gtao);
        col = col * (1.0 - reflWeight * 0.42) + reflRad * reflWeight;
      }
    }
  }

  fragColor = vec4(max(col, 0.0), hdr.a);
}
`;
