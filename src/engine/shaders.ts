/**
 * High-Speed Hardware-Instanced WebGL2 PBR Shaders for Apple Silicon Microscope.
 *
 * Pipeline:
 *   Pass 0: 2048px Hardware-PCF Directional Shadow Map
 *   Pass 1: 4x MSAA HDR (RGBA16F) Instanced PBR Scene Pass
 *           - Parametric undistorted beveled boxes & cylinders
 *           - Thin-film SiO2 spectral iridescence + brushed metal + crystalline SEM grain
 *           - 3-point Apple studio softbox HDRI + 5-tap hardware PCF shadows + analytical cavity AO
 *           - 100% GPU-driven live Mac telemetry & animated signal waves (zero buffer uploads)
 *   Pass 2: Dual-Kawase HDR Bloom (Downsample 1/2 -> 1/4 -> 1/8, Upsample 1/4 -> 1/2)
 *   Pass 3: Optical Composite (seamless dual-stage dissolve, velocity radial zoom-blur,
 *           subtle chromatic dispersion, studio vignette, ACES Filmic tone map, SEM grain)
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
    float gpuWave = 0.55 + 0.45 * sin(uTime * 3.5 + (center.x - 1.66) * 2.2 + (center.z + 0.78) * 2.2);
    liveEnergy = uMacLoads.z * gpuWave;
  } else if (ch == 6) {
    liveEnergy = uMacLoads.x * 0.35;
  } else if (ch == 7) {
    liveEnergy = 0.22 + uMacLoads.z * 0.45;
  } else if (ch == 8) {
    liveEnergy = uMacLoads.w;
  } else if (ch == 9) {
    if (param < 0.5) {
      center.z = mix(2.25, -1.75, uPulsePhase);
      halfSize.z = 0.28 + uMacLoads.x * 0.45;
      liveEnergy = 0.5 + 0.5 * max(uMacLoads.x, uNetLoad);
    } else if (param < 1.5) {
      center.x = mix(-2.8, 2.8, fract(uPulsePhase * 1.3 + 0.4));
      halfSize.x = 0.24 + uMacLoads.w * 0.35;
      liveEnergy = 0.5 + 0.5 * max(uMacLoads.x, uNetLoad);
    } else if (param < 2.5) {
      center.z = mix(-4.2, 4.2, uPulsePhase);
      liveEnergy = 0.7 + uMacLoads.x * 0.4;
    } else {
      center.x = mix(-4.6, 4.6, uPulsePhase);
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
      halfSize.xz += 0.02 * viaGlow;
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
      // Hero gold gate bridge / gate pillar
      liveEnergy = gateActive;
    } else if (param > 0.5) {
      // Hero center fin bank
      if (gateActive > 0.3) matId = 6.0;
      liveEnergy = gateActive;
    }
  } else if (ch == 14) {
    float gateActive = clamp(0.25 + uMacLoads.x * 1.15, 0.0, 1.0);
    liveEnergy = (param > 0.5) ? gateActive : 0.0;
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
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uPulsePhase;

${COMMON_INSTANCE_GLSL}

void main() {
  vec3 center, halfSize;
  float bevelR, matId, liveEnergy;
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);

  float r = min(bevelR, min(halfSize.x, min(halfSize.y, halfSize.z)) * 0.46);
  vec3 inner = max(halfSize - vec3(r), vec3(0.0));
  vec3 worldPos = center + aAnchor * inner + aNorm * r;

  gl_Position = uLightVP * vec4(worldPos * uWorldScale, 1.0);
}
`;

export const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}
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
uniform float uTime;
uniform vec4 uMacLoads;
uniform vec4 uCoreA;
uniform vec4 uCoreB;
uniform float uNetLoad;
uniform float uPulsePhase;

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
  evalInstance(aInstA, aInstB, aInstC, center, halfSize, bevelR, matId, liveEnergy);

  float r = min(bevelR, min(halfSize.x, min(halfSize.y, halfSize.z)) * 0.46);
  vec3 inner = max(halfSize - vec3(r), vec3(0.0));
  vec3 localPos = aAnchor * inner + aNorm * r;
  vec3 worldPos = center + localPos;
  vec3 scaledPos = worldPos * uWorldScale;

  vWorldPos = worldPos;
  vScaledPos = scaledPos;
  vNormal = aNorm;
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
uniform vec3 uCamPos;
uniform float uTime;
uniform float uZoom;
uniform float uSemFactor;
uniform float uFloorY;
uniform float uThermal;
uniform vec4 uMacLoads;
uniform float uPulsePhase;
uniform vec4 uInspectBox; // (cx, cz, hx, hz); hx <= 0 means inactive

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
  // Deep dark obsidian Apple studio dome so metallic surfaces stay rich & high-contrast
  vec3 env = mix(vec3(0.004, 0.006, 0.011), vec3(0.022, 0.032, 0.052), smoothstep(-0.15, 0.85, y));
  // Tight overhead studio softbox key reflection
  env += vec3(1.15, 1.12, 1.08) * smoothstep(0.88, 0.98, dot(dir, normalize(vec3(0.32, 0.90, 0.28))));
  // Cool rim cyan strip light
  env += vec3(0.38, 0.72, 1.25) * smoothstep(0.84, 0.97, dot(dir, normalize(vec3(-0.78, 0.45, -0.42))));
  // Warm subtle copper-gold right accent strip
  env += vec3(0.95, 0.64, 0.30) * smoothstep(0.88, 0.98, dot(dir, normalize(vec3(0.76, 0.36, -0.54)))) * 0.55;
  // Razor-crisp linear studio product-shot light strip
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

// 5-tap Hardware Bilinear PCF Soft Shadow (10x faster than raymarch shadows & sharper!)
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
  vec3 n = normalize(vNormal);
  vec3 toCam = uCamPos - vScaledPos;
  float camDist = length(toCam);
  vec3 v = toCam / max(camDist, 0.0001);

  float matId = vMatId;
  float liveEnergy = vLiveEnergy;

  // Per-pixel Unified RAM inner edge bus glow (Channel 8)
  if (vChanType > 7.5 && vChanType < 8.5) {
    liveEnergy = uMacLoads.w * smoothstep(3.75, 3.44, abs(p.x));
  }

  // Per-pixel 3nm GAA Nanosheet sweeping cyan electron wave (Channel 14)
  if (vChanType > 13.5 && vChanType < 14.5 && liveEnergy > 0.01) {
    float waveX = mix(-1.45, 1.45, fract(uPulsePhase * 1.4 + vExtraA));
    float hitWave = smoothstep(0.32, 0.07, abs(p.x - waveX));
    if (hitWave > 0.35) {
      matId = 6.0;
      liveEnergy = mix(liveEnergy, 1.15, hitWave);
    }
  }

  // Analytical micro-relief normal perturbation (die lithography lines & crystalline SEM grain)
  if (uZoom < 0.9 && ((matId > 0.5 && matId < 1.5) || (matId > 3.5 && matId < 4.5)) && n.y > 0.85) {
    float nx = cos(p.x * 74.0) * 0.06 + cos(p.x * 185.0) * 0.022;
    float nz = cos(p.z * 74.0) * 0.05 + cos(p.z * 185.0) * 0.022;
    n = normalize(n + vec3(nx, 0.0, nz));
  } else if (matId > 4.5 && matId < 5.5) {
    float g0 = fbmGrain(p.xz * 12.0);
    float gx = fbmGrain((p.xz + vec2(0.03, 0.0)) * 12.0);
    float gz = fbmGrain((p.xz + vec2(0.0, 0.03)) * 12.0);
    n = normalize(n + vec3((g0 - gx) * 2.2, 0.0, (g0 - gz) * 2.2));
  }

  float ndotv = max(dot(n, v), 0.0);

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
    // Rich brushed Apple Space-Titanium / Electron-Microscope Silver-Slate
    float brush = (noise2D(vec2(p.x * 90.0, p.z * 14.0)) - 0.5) * 0.035;
    baseCol = vec3(0.24, 0.28, 0.35) + brush;
    rough = 0.20 + abs(brush);
    metal = 0.95;
  } else if (matId < 3.5) {
    // Deep luxurious damascene Copper-Gold (linear space!)
    float brush = (noise2D(vec2(p.x * 70.0, p.z * 18.0)) - 0.5) * 0.03;
    baseCol = mix(vec3(0.46, 0.28, 0.11), vec3(0.36, 0.24, 0.12), uSemFactor * 0.35) + brush;
    rough = 0.22;
    metal = 0.94;
    if (liveEnergy > 0.15) emissive = vec3(0.85, 0.48, 0.12) * liveEnergy * 0.24;
  } else if (matId < 4.5) {
    float stripe = smoothstep(0.2, 0.85, sin(p.z * 110.0)) * 0.03;
    baseCol = vec3(0.045, 0.058, 0.082) + stripe * (1.0 - uSemFactor);
    rough = 0.30;
    metal = 0.85;
    if (liveEnergy > 0.1) emissive = vec3(0.18, 0.48, 0.92) * liveEnergy * 0.35;
  } else if (matId < 5.5) {
    float g = fbmGrain(p.xz * 12.0);
    float sparkle = pow(noise2D(p.xz * 56.0), 6.0) * 0.24;
    baseCol = vec3(0.085, 0.105, 0.135) * (0.55 + g * 0.85) + vec3(0.25, 0.31, 0.40) * sparkle;
    rough = 0.56;
    metal = 0.38;
  } else if (matId < 6.5) {
    // Saturated electric-cyan signal / 3nm electron channel (no white clipping!)
    baseCol = vec3(0.14, 0.52, 0.72);
    rough = 0.16;
    metal = 0.35;
    emissive = vec3(0.08, 0.62, 0.98) * (0.68 + liveEnergy * 0.58 + 0.12 * sin(uTime * 8.0));
  } else {
    baseCol = vec3(0.028, 0.036, 0.052);
    rough = 0.28;
    metal = 0.78;
    if (liveEnergy > 0.05) emissive = vec3(0.14, 0.46, 0.95) * liveEnergy * 0.75;
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

  // Analytical Height & Crevice Ambient Occlusion (sculptural canyon & 3nm fin depth)
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

  // Studio HDRI Reflections (modulated by AO so crevices stay moody)
  vec3 reflDir = reflect(-v, n);
  vec3 reflCol = sampleStudioEnv(reflDir);
  vec3 envReflection = reflCol * F * (1.0 - rough * 0.68) * (0.42 + 0.32 * metal) * ao;

  // SEM Electron-Microscope Grazing Edge Glow
  vec3 semRim = vec3(0.44, 0.64, 0.92) * pow(1.0 - ndotv, 3.6) * (0.08 + 0.34 * uSemFactor) * ao;
  vec3 ambient = baseCol * vec3(0.06, 0.08, 0.12) * ao;

  vec3 col = ambient + direct * ao + envReflection + semRim + emissive;

  // Razor-sharp 3D silicon selection frame when user clicks a die block to inspect
  if (uInspectBox.z > 0.001 && uZoom < 0.85) {
    vec2 dBox = abs(p.xz - uInspectBox.xy) - uInspectBox.zw;
    float edgeDist = abs(max(dBox.x, dBox.y));
    float inside = step(max(dBox.x, dBox.y), 0.02);
    float rim = smoothstep(0.036, 0.006, edgeDist) * (1.0 - smoothstep(0.0, 0.25, max(dBox.x, dBox.y)));
    float pulse = 0.78 + 0.22 * sin(uTime * 5.0);
    col += vec3(0.45, 0.88, 1.25) * rim * pulse * (1.0 - uZoom * 1.1);
    col += vec3(0.04, 0.12, 0.22) * inside * 0.45 * (1.0 - uZoom * 1.1);
  }

  // Smooth infinite studio fog matching our obsidian backdrop
  float fogDist = length(vScaledPos.xz);
  float fog = 1.0 - exp(-0.0085 * fogDist * fogDist);
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

/** Extract HDR highlights above threshold (and blend two stages if mid-transition) */
export const BLOOM_PREFILTER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uBlend;
uniform vec2 uTexelSize;

vec3 sampleScene(vec2 uv) {
  vec3 a = texture(uTexA, uv).rgb;
  if (uBlend <= 0.001) return a;
  if (uBlend >= 0.999) return texture(uTexB, uv).rgb;
  return mix(a, texture(uTexB, uv).rgb, uBlend);
}

void main() {
  // 4-tap box downsample to prevent specular firefly shimmering in bloom
  vec2 o = uTexelSize * 0.5;
  vec3 c = (
    sampleScene(vUv + vec2(-o.x, -o.y)) +
    sampleScene(vUv + vec2( o.x, -o.y)) +
    sampleScene(vUv + vec2(-o.x,  o.y)) +
    sampleScene(vUv + vec2( o.x,  o.y))
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
 * Final Optical Composite:
 *   - Clean dual-stage optical cross-dissolve during scale transitions
 *   - Velocity-driven radial zoom-blur (silky Apple cinema dive feel when zooming fast!)
 *   - Subtle microscope edge chromatic dispersion
 *   - Creamy Dual-Kawase bloom
 *   - Studio vignette + ACES Filmic tone mapping + fine SEM film grain
 */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uBloomTex;
uniform vec2 uResolution;
uniform float uBlend;
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

vec3 sampleMerged(vec2 uv) {
  vec3 a = texture(uTexA, uv).rgb;
  if (uBlend <= 0.001) return a;
  if (uBlend >= 0.999) return texture(uTexB, uv).rgb;
  return mix(a, texture(uTexB, uv).rgb, uBlend);
}

void main() {
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rDist = length(centered);
  vec2 dir = normalize(centered + vec2(0.0001));

  // Subtle microscope edge chromatic dispersion
  float ca = smoothstep(0.38, 0.98, rDist) * (0.0014 + uMotion * 0.0022);
  vec3 base;
  base.r = sampleMerged(vUv + dir * ca).r;
  base.g = sampleMerged(vUv).g;
  base.b = sampleMerged(vUv - dir * ca).b;

  // Optical radial zoom-blur ONLY when actively zooming fast (keeps dives buttery!)
  if (uMotion > 0.015) {
    vec2 radial = (vUv - 0.5) * (0.018 * uMotion * smoothstep(0.06, 0.85, rDist));
    vec3 acc = base * 0.44;
    acc += sampleMerged(vUv - radial * 0.45) * 0.24;
    acc += sampleMerged(vUv - radial * 0.95) * 0.18;
    acc += sampleMerged(vUv - radial * 1.50) * 0.14;
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
