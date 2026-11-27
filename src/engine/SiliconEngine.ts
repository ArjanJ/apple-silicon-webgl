import { getVibeMeta, IntroCueMap } from '../audio/vibes';
import { DEFAULT_TELEMETRY, LiveMacTelemetry } from '../sim/macTelemetry';
import {
  createChipTexturePack,
  loadMacroMaterialLayers,
  MAT_ARRAY_LAYERS,
  MAT_ARRAY_SIZE,
  TextureBuffer,
} from './chipTextures';
import {
  createPlaceholderQuarterTextures,
  loadQuarterPbrTextures,
  QuarterTextureBuffer,
} from './coinTexture';
import {
  createParametricBeveledBox,
  createParametricBeveledCylinder,
  createUnitBondCylinder,
  createUnitSphere,
  MeshBuffers,
} from './geometry';
import { DieInspectHit, getDieRegionKind, pickDieRegion } from './inspect';
import { mat4Invert, mat4LookAt, mat4Multiply, mat4Ortho, mat4Perspective } from './math';
import {
  BLOOM_DOWN_FS,
  BLOOM_PREFILTER_FS,
  BLOOM_UP_FS,
  COMPOSITE_FS,
  FULLSCREEN_VS,
  LIQUID_GL_FS,
  LIQUID_GL_VS,
  SCENE_CUTOUT_FS,
  SCENE_FS,
  SCENE_VS,
  SHADOW_CUTOUT_FS,
  SHADOW_FS,
  SHADOW_VS,
  VERNIER_STRIP_FS,
  VERNIER_STRIP_VS,
} from './shaders';
import {
  buildWorld0,
  buildWorld1,
  buildWorld2,
  buildWorld3,
  buildWorld4,
  buildWorldAtom,
  buildWorldGate3nm,
  buildWorldLattice,
  buildWorldNucleus,
  buildWorldQuarks,
  DEFAULT_DIE_SPEC,
  DieFloorplanSpec,
  LatticeAtomSite,
  QUARTER_HY,
  QUARTER_RADIUS,
  QUARTER_X,
  QUARTER_Z,
  STAGE_RATIOS,
  WORLD0_DIE_CLAMP_X,
  WORLD0_DIE_CLAMP_Z,
  WORLD1_HOLE_HALF,
  WORLD1_PITCH,
  WORLD2_HOLE_HALF,
  WORLD2_PITCH,
  WORLD3_HOLE_HALF,
  WORLD3_PITCH_X,
  WORLD3_PITCH_Z,
  WORLD4_CELL_PITCH,
  WORLD4_GATE_XS,
  WORLD4_GATE_Z,
  WORLD4_HOLE_HX,
  WORLD4_HOLE_HZ,
  WORLD5_LATTICE_A,
  WorldInstances,
} from './worlds';

interface DisjointTimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface FrameActivitySample {
  frameMs: number;
  gpuFrameMs: number | null;
  motion: number;
  zoom: number;
  idlePaced: boolean;
}

export interface IntroFrameState {
  active: boolean;
  progress: number;
  elapsed: number;
}

export interface EngineHooks {
  onZoomFrame: (
    zoom: number,
    fps: number,
    motion: number,
    interacting: boolean,
    yawVel: number,
    regionKind: number
  ) => void;
  onInspect: (hit: DieInspectHit | null) => void;
  onHover?: (hit: DieInspectHit | null, clientX: number, clientY: number) => void;
  onTourChange?: (active: boolean) => void;
  onIntroFrame?: (state: IntroFrameState) => void;
  /** Optional Web Audio hardware clock callback so intro visuals stay sample-locked to the score */
  getIntroClockSec?: () => number | null;
  /** Initial intro beat/cue map from the active soundtrack vibe */
  introCues?: IntroCueMap;
  /** When true, holds the Cold Boot intro paused on black until startIntro() / releaseIntroHold() is called */
  deferIntroStart?: boolean;
}

interface StageDraw {
  boxVao: WebGLVertexArrayObject | null;
  boxCount: number;
  cylVao: WebGLVertexArrayObject | null;
  cylCount: number;
  cylIndexCount: number;
  sphereVao: WebGLVertexArrayObject | null;
  sphereCount: number;
  transSphereVao: WebGLVertexArrayObject | null;
  transSphereCount: number;
  bondVao: WebGLVertexArrayObject | null;
  bondCount: number;
  floorY: number;
  boxBuf: WebGLBuffer | null;
  cylBuf: WebGLBuffer | null;
  sphereBuf: WebGLBuffer | null;
  transSphereBuf: WebGLBuffer | null;
  bondBuf: WebGLBuffer | null;
}

interface FboTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

interface HoleConfig {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  minY: number;
  mode: number; // 0=off, 1=VS+FS tiled, 2=FS-only beams/floor, 3=FS-only die+bezel, 4=VS-only ribbon patch
  open: number; // 0..1 smooth cutout retraction / iris opening
  atomX: number;
  atomY: number;
  atomZ: number;
  atomR: number;
}

const SHADOW_SIZE_DESKTOP = 1536;
const SHADOW_SIZE_MOBILE = 1024;
const MAX_RENDER_PIXELS_DESKTOP = 3_900_000; // Retina-sharp ~1.5x–2.0x DPR without 8M–15M px 5K fillrate overload
const MAX_RENDER_PIXELS_MOBILE = 1_350_000;  // Crisp Retina mobile budget (~1.75x DPR) without overheating mobile GPUs
const IDLE_HOLD_MS = 1600;
const COOLDOWN_END_MS = 2800;
const COOLDOWN_FRAME_MS = 16.5; // Smooth 60 Hz bridge before stepping to calm 30 Hz idle
const IDLE_FRAME_MS = 33.3;     // Smooth 30 Hz ambient signal pulses when calm & focused
const BLURRED_FRAME_MS = 66.7;  // Low-power 15 Hz when window is unfocused
export const MIN_ZOOM = -2.4;
export const MAX_ZOOM = 9.0;
const STAGE_FLOOR_Y = [-0.598, -0.26, -0.14, -0.075, -0.35, -6.0, -6.0, -6.0, -6.0, -6.0];
const WORLD0_GRID_STEP = WORLD1_PITCH / STAGE_RATIOS[0]; // 0.095 (exact World 1 grid pitch on World 0!)

/** "Cold Boot" Centered Title Card -> Dark Silhouette Build -> Major-Beat Ignition & Hero Crane-Up */
const DEFAULT_INTRO_CUES: IntroCueMap = getVibeMeta('orbital').introCues;
const INTRO_START_ZOOM = -0.5;
const INTRO_START_PITCH = 0.18; // ~10.3° sleek sculptural low horizon angle -> cranes up to HERO_PITCH (49°)
const INTRO_START_YAW = 0.0;    // Dead-straight architectural symmetry (zero crookedness!)
const HERO_ZOOM = 0.0;
const HERO_PITCH = 0.86;
const HERO_YAW = 0.0;

/** Keyframed Cinematic Dive choreography: [timeSec, zoom, pitch, yawOffset] */
const TOUR_KEYS: readonly [number, number, number, number][] = [
  [0.0, -1.08, 0.96, 0.0],
  [3.0, 0.0, 0.84, -0.06],
  [5.4, 0.02, 0.78, 0.08],
  [8.4, 1.0, 0.72, 0.22],
  [11.4, 2.0, 0.62, 0.38],
  [14.2, 3.0, 0.56, 0.5],
  [17.0, 4.0, 0.46, 0.64],
  [20.2, 5.0, 0.3, 0.8],
  [23.2, 6.0, 0.28, 0.98],
  [26.2, 7.0, 0.24, 1.22],
  [29.4, 8.0, 0.3, 1.52],
  [32.6, 9.0, 0.32, 1.88],
  [35.2, 9.0, 0.34, 2.18],
];

// Precompute cumulative log-scales for exact physical locking across all 9 nested stages
const LOG_CUM_SCALE: number[] = [0];
for (let i = 0; i < STAGE_RATIOS.length; i++) {
  LOG_CUM_SCALE.push(LOG_CUM_SCALE[i] + Math.log(STAGE_RATIOS[i]));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * High-Speed Hardware-Instanced WebGL2 Unified Multi-Scale PBR Engine
 * with Zoom-Anywhere Floating-Origin Nesting.
 *
 *   - TRUE SINGLE PHYSICAL OBJECT: all visible nested scales render simultaneously into
 *     one unified 4x MSAA HDR framebuffer, shared 24-bit depth buffer, and shared 2048px PCF shadow map!
 *   - ZOOM ANYWHERE: per-level floating origin (effOffset chain) + dynamic GPU cutouts let you
 *     zoom into ANY core on the silicon die, ANY SRAM tile, ANY metal canyon, ANY nanometer cell,
 *     ANY 3nm GAA gate, and ANY Silicon-28 atom — and emerge right back where you entered!
 *   - Controls: scroll/pinch zooms toward cursor; drag orbits 3D; Shift+drag or right-drag pans the stage!
 */
export class SiliconEngine {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  private useFloatHdr = false;
  private msaaSamples = 0;
  private isMobile = false;
  private shadowSize = SHADOW_SIZE_DESKTOP;

  private shadowProg: WebGLProgram;
  private shadowCutoutProg: WebGLProgram;
  private sceneProg: WebGLProgram;
  private sceneCutoutProg: WebGLProgram;
  private prefilterProg: WebGLProgram;
  private bloomDownProg: WebGLProgram;
  private bloomUpProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private liquidGlProg: WebGLProgram;
  private vernierProg: WebGLProgram;

  private boxMesh: MeshBuffers;
  private cylMesh: MeshBuffers;
  private coinCylMesh: MeshBuffers;
  private sphereMesh: MeshBuffers;
  private orbitalSphereMesh: MeshBuffers;
  private bondMesh: MeshBuffers;
  private boxVbo: WebGLBuffer;
  private boxIbo: WebGLBuffer;
  private cylVbo: WebGLBuffer;
  private cylIbo: WebGLBuffer;
  private coinCylVbo: WebGLBuffer;
  private coinCylIbo: WebGLBuffer;
  private sphereVbo: WebGLBuffer;
  private sphereIbo: WebGLBuffer;
  private orbitalSphereVbo: WebGLBuffer;
  private orbitalSphereIbo: WebGLBuffer;
  private bondVbo: WebGLBuffer;
  private bondIbo: WebGLBuffer;
  private stages: StageDraw[] = [];
  private latticeAtoms: LatticeAtomSite[] = [];
  private emptyVao: WebGLVertexArrayObject;

  // Render targets, US Quarter PBR textures & Hybrid Chip PBR textures
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;
  private coinTex: WebGLTexture;
  private coinNormTex: WebGLTexture;
  private matTex: WebGLTexture;
  private matNormTex: WebGLTexture;
  private dieLithoTex: WebGLTexture;
  private dieNormTex: WebGLTexture;
  private abfTex: WebGLTexture;
  private abfNormTex: WebGLTexture;
  private ramDecalTex: WebGLTexture;
  private envTex: WebGLTexture;
  private lastLightLookX = Number.NaN;
  private lastLightLookZ = Number.NaN;
  private lastLightHalf = Number.NaN;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColorRb: WebGLRenderbuffer | null = null;
  private msaaDepthRb: WebGLRenderbuffer | null = null;
  private fallbackDepthRb: WebGLRenderbuffer | null = null;
  private hdrMain!: FboTarget;
  private srgbA!: FboTarget;
  private srgbB!: FboTarget;
  private bloomDown: FboTarget[] = [];
  private bloomUp: FboTarget[] = [];

  private canvasW = 1;
  private canvasH = 1;
  private cssW = 1;
  private cssH = 1;
  private canvasRect = { left: 0, top: 0, width: 1, height: 1 };

  // Shadow map dirty tracking & zero-allocation stage buffers
  private shadowDirty = true;
  private lastShadowMs = 0;
  private lastShadowSmoothP = -1;
  private lastShadowStageSig = '';
  private world0Version = 0;
  private activeStagesBuf: { idx: number; scale: number }[] = Array.from({ length: 10 }, () => ({ idx: 0, scale: 1 }));
  private tmpHole: HoleConfig = { cx: 0, cz: 0, hx: 0, hz: 0, minY: -10, mode: 0, open: 0, atomX: 0, atomY: 0, atomZ: 0, atomR: 0 };

  // GPU liquidGL HUD regions (sRGB two-stage stacked refraction, zero CSS readback tax!)
  private glassCount = 0;
  private glassHasElevated = false;
  private glassRects = new Float32Array(16 * 4);
  private glassParams = new Float32Array(16 * 4);
  private glassPointerX = 0;
  private glassPointerY = 0;
  private glassPointerVelX = 0;
  private glassPointerVelY = 0;
  private glassPointerActive = 0;

  // Retina WebGL2 Vernier Strip (composited into srgbA BEFORE Liquid Glass so the rounded glass pill genuinely refracts the text!)
  private vernierTex: WebGLTexture | null = null;
  private vernierTexOriginCss = 0;
  private vernierTexWidthCss = 1;
  private vernierRect = new Float32Array(4); // (cx, cy, halfW, halfH)
  private vernierPitchCss = 90;
  private vernierLoupeHalfW = 32;
  private vernierAlpha = 0;

  // Cached uniform locations
  private uShadow: Record<string, WebGLUniformLocation | null> = {};
  private uShadowCutout: Record<string, WebGLUniformLocation | null> = {};
  private uScene: Record<string, WebGLUniformLocation | null> = {};
  private uSceneCutout: Record<string, WebGLUniformLocation | null> = {};
  private uPrefilter: Record<string, WebGLUniformLocation | null> = {};
  private uDown: Record<string, WebGLUniformLocation | null> = {};
  private uUp: Record<string, WebGLUniformLocation | null> = {};
  private uComp: Record<string, WebGLUniformLocation | null> = {};
  private uLiquid: Record<string, WebGLUniformLocation | null> = {};
  private uVernier: Record<string, WebGLUniformLocation | null> = {};

  // Reusable matrices (zero GC per frame)
  private projMat = new Float32Array(16);
  private viewMat = new Float32Array(16);
  private viewProjMat = new Float32Array(16);
  private invViewProjMat = new Float32Array(16);
  private lightProjMat = new Float32Array(16);
  private lightViewMat = new Float32Array(16);
  private lightVPMat = new Float32Array(16);
  private world0Scale = 1.0;

  // Per-level zoom-anywhere floating-origin anchors (10 nested worlds: 0..9)!
  private anchors: [number, number, number][] = Array.from({ length: 10 }, () => [0, 0, 0]);
  private targetAnchor0: [number, number] = [0, 0];
  private effOffsets: [number, number, number][] = Array.from({ length: 10 }, () => [0, 0, 0]);
  private stageScales: number[] = new Array(10).fill(1);
  private dieSpec: DieFloorplanSpec = { ...DEFAULT_DIE_SPEC };
  private activeRegionKind = 0;
  // Smooth camera lateral pan offset in camera space so snapping to discrete tiles/cells/atoms glides smoothly!
  private smoothCamShiftX = 0;
  private smoothCamShiftY = 0;
  private smoothCamShiftZ = 0;
  // Parity (+1 or -1) of the currently selected Silicon atom in World 6 (rotates World 7 by 90° Y for B-sublattice!)
  private atomParity: 1 | -1 = 1;

  // Interactive click-to-inspect & whisper-quiet hover preview state (with smooth optical fade)
  private inspectBox: [number, number, number, number] = [0, 0, 0, 0];
  private inspectId: string | null = null;
  private hasInspect = false;
  private renderInspectBox: [number, number, number, number] = [0, 0, 0, 0];
  private renderInspectIsRing = 0;
  private inspectAlpha = 0;
  private hoverBox: [number, number, number, number] = [0, 0, 0, 0];
  private hoverId: string | null = null;
  private hasHover = false;
  private renderHoverBox: [number, number, number, number] = [0, 0, 0, 0];
  private renderHoverIsRing = 0;
  private hoverAlpha = 0;
  private downX = 0;
  private downY = 0;

  // Cinematic Dive (choreographed Scale -> Quarks journey with instant manual handoff)
  private tourActive = false;
  private tourElapsed = 0;
  private tourBaseYaw = -0.14;

  // "Cold Boot" Powered-Off -> Beat-Aligned Major-Drop Silicon Power-On state
  private introCues: IntroCueMap = DEFAULT_INTRO_CUES;
  private introActive = false;
  private introAwaitingBoot = false;
  private introHoldRendered = false;
  private introElapsed = 0;
  private introLightSweep = 1.0;
  private introKeyIntensity = 1.0;
  private introRimBoost = 1.0;
  private introBeatPulse = 0.0;
  private introFogBoost = 0.0;
  private introExposure = 1.0;
  private introDofBoost = 0.0;
  private bootPwrRails = 1.0;
  private bootFabricLock = 1.0;
  private bootMemTrain = 1.0;
  private bootEcoreWake = 1.0;
  private bootPcoreWake = 1.0;
  private bootGpuWake = 1.0;
  private bootAuxWake = 1.0;
  private bootActive = 0.0;
  private deferredTexLoadsStarted = false;
  private pendingTexUploads: (() => void)[] = [];

  // Camera, motorized optical flight & snappy zoom state
  public zoom = HERO_ZOOM;
  private targetZoom = HERO_ZOOM;
  private zoomRate = 15.0;
  private smoothMotion = 0.0;

  private flightActive = false;
  private flightElapsed = 0;
  private flightDuration = 1.0;
  private flightStartZoom = HERO_ZOOM;
  private flightEndZoom = HERO_ZOOM;
  private flightStartPitch = HERO_PITCH;
  private flightEndPitch = HERO_PITCH;
  private flightStartYaw = HERO_YAW;
  private flightEndYaw = HERO_YAW;
  private flightStartAnchorX = 0;
  private flightStartAnchorZ = 0;
  private flightEndAnchorX = 0;
  private flightEndAnchorZ = 0;
  private flightHasAnchor = false;

  private yaw = HERO_YAW;
  private pitch = HERO_PITCH;
  private targetYaw = HERO_YAW;
  private targetPitch = HERO_PITCH;

  // Live Mac telemetry
  private telemetry: LiveMacTelemetry = { ...DEFAULT_TELEMETRY };
  private smoothP = 0.18;
  private smoothE = 0.14;
  private smoothGpu = 0.2;
  private smoothMem = 0.44;
  private smoothNet = 0.15;
  private smoothTemp = 0.45;
  private smoothCores = new Float32Array(8).fill(0.15);
  private pulsePhase = 0;

  public thermal = false;
  public autoOrbit = false;

  // Interaction, multi-touch pinch/pan, visibility & ProMotion-style adaptive frame pacing
  private dragging = false;
  private dragMode: 'orbit' | 'pan' | 'pinch' = 'orbit';
  private activePointers = new Map<number, { x: number; y: number }>();
  private gestureHadMultiTouch = false;
  private prevPinchDist = 0;
  private prevPinchMidX = 0;
  private prevPinchMidY = 0;
  private lastX = 0;
  private lastY = 0;
  private contextLost = false;
  private rafId = 0;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private lastRenderMs = 0;
  private lastActivityMs = performance.now();
  private pageHidden = typeof document !== 'undefined' ? document.hidden : false;
  private windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
  private burstActive = false;
  private isIdlePaced = false;
  private emaFrameMs = 16.0;
  private timerQueryExt: DisjointTimerQueryExt | null = null;
  private pendingGpuQueries: WebGLQuery[] = [];
  private emaGpuFrameMs: number | null = null;
  private disposed = false;

  constructor(container: HTMLElement, private hooks: EngineHooks) {
    this.container = container;
    this.isMobile =
      typeof window !== 'undefined' &&
      ((typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
        /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent));
    this.shadowSize = this.isMobile ? SHADOW_SIZE_MOBILE : SHADOW_SIZE_DESKTOP;

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required');
    }
    this.gl = gl;

    this.useFloatHdr =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    this.timerQueryExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerQueryExt | null;
    const maxSamples = (gl.getParameter(gl.MAX_SAMPLES) as number) || 0;
    this.msaaSamples = this.pickMsaaSamples(maxSamples);

    // Compile shader programs (separate discard-free fast paths to keep Apple Silicon TBDR HSR active!)
    this.shadowProg = this.createProgram(SHADOW_VS, SHADOW_FS);
    this.shadowCutoutProg = this.createProgram(SHADOW_VS, SHADOW_CUTOUT_FS);
    this.sceneProg = this.createProgram(SCENE_VS, SCENE_FS);
    this.sceneCutoutProg = this.createProgram(SCENE_VS, SCENE_CUTOUT_FS);
    this.prefilterProg = this.createProgram(FULLSCREEN_VS, BLOOM_PREFILTER_FS);
    this.bloomDownProg = this.createProgram(FULLSCREEN_VS, BLOOM_DOWN_FS);
    this.bloomUpProg = this.createProgram(FULLSCREEN_VS, BLOOM_UP_FS);
    this.compositeProg = this.createProgram(FULLSCREEN_VS, COMPOSITE_FS);
    this.liquidGlProg = this.createProgram(LIQUID_GL_VS, LIQUID_GL_FS);
    this.vernierProg = this.createProgram(VERNIER_STRIP_VS, VERNIER_STRIP_FS);

    this.cacheUniforms();

    // Shared procedural meshes (14x20 for 1000+ small atoms/sparkles = 3.3x fewer tris; 22x30 for large orbital clouds)
    this.boxMesh = createParametricBeveledBox();
    this.cylMesh = createParametricBeveledCylinder(20);
    this.coinCylMesh = createParametricBeveledCylinder(96);
    this.sphereMesh = createUnitSphere(14, 20);
    this.orbitalSphereMesh = createUnitSphere(22, 30);
    this.bondMesh = createUnitBondCylinder(12);

    this.boxVbo = this.createArrayBuffer(this.boxMesh.vertices);
    this.boxIbo = this.createIndexBuffer(this.boxMesh.indices);
    this.cylVbo = this.createArrayBuffer(this.cylMesh.vertices);
    this.cylIbo = this.createIndexBuffer(this.cylMesh.indices);
    this.coinCylVbo = this.createArrayBuffer(this.coinCylMesh.vertices);
    this.coinCylIbo = this.createIndexBuffer(this.coinCylMesh.indices);
    this.sphereVbo = this.createArrayBuffer(this.sphereMesh.vertices);
    this.sphereIbo = this.createIndexBuffer(this.sphereMesh.indices);
    this.orbitalSphereVbo = this.createArrayBuffer(this.orbitalSphereMesh.vertices);
    this.orbitalSphereIbo = this.createIndexBuffer(this.orbitalSphereMesh.indices);
    this.bondVbo = this.createArrayBuffer(this.bondMesh.vertices);
    this.bondIbo = this.createIndexBuffer(this.bondMesh.indices);
    this.emptyVao = gl.createVertexArray()!;

    // Upload instant placeholder US Quarter & macro PBR textures now;
    // heavy high-res JPG decoding + Sobel/mipmap uploads start right after the intro finishes so intro stays locked at 120fps!
    const placeholder = createPlaceholderQuarterTextures();
    this.coinTex = gl.createTexture()!;
    this.coinNormTex = gl.createTexture()!;
    this.uploadQuarterTexture(this.coinTex, placeholder.albedo);
    this.uploadQuarterTexture(this.coinNormTex, placeholder.relief);

    // Build & upload Hybrid Chip PBR Texture Pack (4-layer TEXTURE_2D_ARRAY + die atlas + ABF + LPDDR5 decal + HDR studio IBL)
    const chipPack = createChipTexturePack();
    this.matTex = gl.createTexture()!;
    this.matNormTex = gl.createTexture()!;
    this.initMaterialArrayTexture(this.matTex, chipPack.matAlbedoInit);
    this.initMaterialArrayTexture(this.matNormTex, chipPack.matReliefInit);

    this.dieLithoTex = gl.createTexture()!;
    this.dieNormTex = gl.createTexture()!;
    this.abfTex = gl.createTexture()!;
    this.abfNormTex = gl.createTexture()!;
    this.ramDecalTex = gl.createTexture()!;
    this.envTex = gl.createTexture()!;
    this.upload2dPbrTexture(this.dieLithoTex, chipPack.dieLitho, gl.CLAMP_TO_EDGE);
    this.upload2dPbrTexture(this.dieNormTex, chipPack.dieNorm, gl.CLAMP_TO_EDGE);
    this.upload2dPbrTexture(this.abfTex, chipPack.abfMap, gl.CLAMP_TO_EDGE);
    this.upload2dPbrTexture(this.abfNormTex, chipPack.abfNorm, gl.CLAMP_TO_EDGE);
    this.upload2dPbrTexture(this.ramDecalTex, chipPack.ramDecal, gl.CLAMP_TO_EDGE);
    this.uploadStudioEnvTexture(this.envTex, chipPack.envMips);

    // Build all 10 physically nested instanced worlds (Die -> BEOL Power -> Routing -> FEOL Rows -> GAA Cell -> 12nm Gate -> Crystal -> Atom -> Nucleus -> Quarks!)
    const latticeWorld = buildWorldLattice();
    this.latticeAtoms = latticeWorld.atomSites ?? [{ x: 0, y: 0, z: 0, parity: 1 }];
    const worlds: WorldInstances[] = [
      buildWorld0(this.dieSpec),
      buildWorld1(),
      buildWorld2(),
      buildWorld3(),
      buildWorld4(),
      buildWorldGate3nm(),
      latticeWorld,
      buildWorldAtom(),
      buildWorldNucleus(),
      buildWorldQuarks(),
    ];
    for (let i = 0; i < worlds.length; i++) {
      this.stages.push(this.uploadStage(worlds[i], STAGE_FLOOR_Y[i], i === 0));
    }

    // Default World 4 anchor sits on the center selectable GAA gate at (0, 0, WORLD4_GATE_Z)
    this.anchors[4] = [0, 0, WORLD4_GATE_Z];
    this.recomputeEffOffsets();

    // Setup Hardware-PCF shadow map (1536px desktop, 1024px mobile)
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      this.shadowSize,
      this.shadowSize,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.updateLightMatrix(0.0, 0.0, 8.8);
    this.resize();
    this.bindEvents();

    if (this.hooks.introCues) {
      this.introCues = this.hooks.introCues;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      this.hooks.onIntroFrame?.({ active: false, progress: 1, elapsed: this.introCues.durationSec });
      this.kickoffDeferredHighResTextures();
    } else if (this.hooks.deferIntroStart) {
      this.holdIntro();
    } else {
      this.startIntro();
    }

    if (!this.pageHidden) {
      this.loop();
    }
  }

  /** Choose crisp 2x MSAA when supported (halves RGBA16F + Depth24 MSAA tile/resolve traffic on Retina!) */
  private pickMsaaSamples(maxSamples: number): number {
    if (maxSamples < 2) return 0;
    const gl = this.gl;
    const internalFmt = this.useFloatHdr ? gl.RGBA16F : gl.RGBA8;
    try {
      const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, internalFmt, gl.SAMPLES) as Int32Array | null;
      if (supported && supported.length > 0) {
        let best = 0;
        for (let i = 0; i < supported.length; i++) {
          const s = supported[i];
          if (s === 2) return 2;
          if (s >= 2 && s <= 4 && (best === 0 || s < best)) best = s;
        }
        if (best > 0) return best;
      }
    } catch {
      // Fallback to conservative default
    }
    return Math.min(2, maxSamples);
  }

  private markActivity(): void {
    this.lastActivityMs = performance.now();
  }

  public notifyActivity(): void {
    this.markActivity();
  }

  public setBurstActive(active: boolean): void {
    this.burstActive = active;
    if (active) this.markActivity();
  }

  /** Decode & upload heavy photographic macro JPGs + 1024px US Quarter maps after the intro so zero frames drop */
  private kickoffDeferredHighResTextures(): void {
    if (this.deferredTexLoadsStarted || this.disposed) return;
    this.deferredTexLoadsStarted = true;
    loadMacroMaterialLayers((upd) => {
      if (this.disposed) return;
      this.pendingTexUploads.push(() => {
        this.updateMaterialArrayLayer(this.matTex, upd.layer, upd.albedo.data);
        this.updateMaterialArrayLayer(this.matNormTex, upd.layer, upd.relief.data);
      });
    });
    loadQuarterPbrTextures((pbr) => {
      if (this.disposed) return;
      this.pendingTexUploads.push(() => {
        this.uploadQuarterTexture(this.coinTex, pbr.albedo);
        this.uploadQuarterTexture(this.coinNormTex, pbr.relief);
      });
    });
  }

  private recomputeEffOffsets(): void {
    const last = this.effOffsets.length - 1;
    this.effOffsets[last][0] = 0;
    this.effOffsets[last][1] = 0;
    this.effOffsets[last][2] = 0;
    for (let k = last - 1; k >= 0; k--) {
      const invR = 1.0 / STAGE_RATIOS[k];
      this.effOffsets[k][0] = this.anchors[k][0] + this.effOffsets[k + 1][0] * invR;
      this.effOffsets[k][1] = this.anchors[k][1] + this.effOffsets[k + 1][1] * invR;
      this.effOffsets[k][2] = this.anchors[k][2] + this.effOffsets[k + 1][2] * invR;
    }
  }

  private getHoleConfig(stageIdx: number): HoleConfig {
    const a = this.anchors[stageIdx];
    const z = this.zoom;
    const h = this.tmpHole;
    h.cx = 0;
    h.cz = 0;
    h.hx = 0;
    h.hz = 0;
    h.minY = -10;
    h.mode = 0.0;
    h.open = 0.0;
    h.atomX = 0;
    h.atomY = 0;
    h.atomZ = 0;
    h.atomR = 0;

    switch (stageIdx) {
      case 0:
        if (z < 0.74) return h;
        h.cx = a[0];
        h.cz = a[2];
        h.hx = 0.62;
        h.hz = 0.62;
        h.minY = -0.35;
        h.mode = 2.0;
        h.open = this.smootherstep(0.74, 1.05, z);
        return h;
      case 1:
        if (z < 1.22) return h;
        h.cx = a[0];
        h.cz = a[2];
        h.hx = WORLD1_HOLE_HALF;
        h.hz = WORLD1_HOLE_HALF;
        h.minY = -0.18;
        h.mode = 1.0;
        h.open = this.smootherstep(1.22, 1.54, z);
        return h;
      case 2:
        if (z < 2.12) return h;
        h.cx = a[0];
        h.cz = a[2];
        h.hx = WORLD2_HOLE_HALF;
        h.hz = WORLD2_HOLE_HALF;
        h.minY = -0.10;
        h.mode = 2.0;
        h.open = this.smootherstep(2.12, 2.48, z);
        return h;
      case 3:
        if (z < 2.94) return h;
        h.cx = a[0];
        h.cz = a[2];
        h.hx = WORLD3_HOLE_HALF;
        h.hz = WORLD3_HOLE_HALF;
        h.minY = -0.09;
        h.mode = 1.0;
        h.open = this.smootherstep(2.94, 3.30, z);
        return h;
      case 4:
        if (z < 4.10) return h;
        h.cx = a[0];
        h.cz = a[2];
        h.hx = WORLD4_HOLE_HX;
        h.hz = WORLD4_HOLE_HZ;
        h.minY = -0.185;
        h.mode = 1.0;
        h.open = this.smootherstep(4.10, 4.44, z);
        return h;
      case 5:
        if (z < 4.96) return h;
        h.cx = a[0];
        h.cz = 0;
        h.hx = 2.45 / STAGE_RATIOS[5];
        h.hz = 1.75 / STAGE_RATIOS[5];
        h.minY = -0.25;
        h.mode = 4.0;
        h.open = this.smootherstep(4.96, 5.28, z);
        return h;
      case 6:
        if (z < 6.12) return h;
        h.atomX = a[0];
        h.atomY = a[1];
        h.atomZ = a[2];
        h.atomR = 0.30;
        h.open = this.smootherstep(6.12, 6.46, z);
        return h;
      case 8:
        if (z < 8.12) return h;
        h.atomR = 0.25;
        h.open = this.smootherstep(8.12, 8.46, z);
        return h;
      default:
        return h;
    }
  }

  /** Minimum zoom before child stage `k` activates (aligned with parent smooth cutout ramp!) */
  private isStageRevealed(k: number, z: number): boolean {
    if (k === 0) return true;
    if (k === 1) return z >= 0.44;
    if (k === 2) return z >= 1.22;
    if (k === 3) return z >= 2.12;
    if (k === 4) return z >= 2.94;
    if (k === 5) return z >= 4.10;
    if (k === 6) return z >= 4.96;
    if (k === 7) return z >= 6.12;
    if (k === 8) return z >= 7.02;
    if (k === 9) return z >= 8.12;
    return true;
  }

  /** Smooth physical 3D relief extrusion factor (0 -> 1) so planar micro-layers rise seamlessly out of their parent */
  private getStageExtrude(k: number, z: number): number {
    if (k === 1) return this.smootherstep(0.44, 0.90, z);
    if (k === 2) return this.smootherstep(1.22, 1.66, z);
    if (k === 3) return this.smootherstep(2.12, 2.58, z);
    if (k === 4) return this.smootherstep(2.94, 3.38, z);
    return 1.0;
  }

  /** Smooth 3D/quantum materialization factor (0 -> 1) so gates, crystals, orbitals, nuclei, and quarks never pop */
  private getStageReveal(k: number, z: number): number {
    if (k === 5) return this.smootherstep(4.10, 4.48, z);
    if (k === 6) return this.smootherstep(4.96, 5.34, z);
    if (k === 7) return this.smootherstep(6.12, 6.52, z);
    if (k === 8) return this.smootherstep(7.02, 7.36, z);
    if (k === 9) return this.smootherstep(8.12, 8.52, z);
    return 1.0;
  }

  /**
   * Snap a candidate local point inside stage `k` to the nearest valid nested feature
   * and compensate camera pan so the visual scene stays silky smooth without popping!
   */
  private setStageAnchorSnapped(k: number, lx: number, ly: number, lz: number, allowSnap = true): void {
    if (k === 0) {
      this.targetAnchor0[0] = clamp(lx, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
      this.targetAnchor0[1] = clamp(lz, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
      return;
    }
    if (!allowSnap) return;

    const prevX = this.effOffsets[k][0];
    const prevY = this.effOffsets[k][1];
    const prevZ = this.effOffsets[k][2];
    let nx = this.anchors[k][0];
    let ny = this.anchors[k][1];
    let nz = this.anchors[k][2];

    if (k === 1) {
      const tx = clamp(Math.round(lx / WORLD1_PITCH), -2, 2);
      const tz = clamp(Math.round(lz / WORLD1_PITCH), -2, 2);
      nx = tx * WORLD1_PITCH;
      ny = 0;
      nz = tz * WORLD1_PITCH;
    } else if (k === 2) {
      const gx = clamp(Math.round(lx / WORLD2_PITCH), -2, 2);
      const gz = clamp(Math.round(lz / WORLD2_PITCH), -2, 2);
      nx = gx * WORLD2_PITCH;
      ny = 0;
      nz = gz * WORLD2_PITCH;
    } else if (k === 3) {
      const ix = clamp(Math.round(lx / WORLD3_PITCH_X), -6, 6);
      const iz = clamp(Math.round(lz / WORLD3_PITCH_Z), -6, 6);
      nx = ix * WORLD3_PITCH_X;
      ny = 0;
      nz = iz * WORLD3_PITCH_Z;
    } else if (k === 4) {
      const cellIx = clamp(Math.round(lx / WORLD4_CELL_PITCH), -1, 1);
      const cellIz = clamp(Math.round(lz / WORLD4_CELL_PITCH), -1, 1);
      const localX = lx - cellIx * WORLD4_CELL_PITCH;
      let bestGx: number = WORLD4_GATE_XS[1];
      let bestD = Infinity;
      for (const gx of WORLD4_GATE_XS) {
        const d = Math.abs(localX - gx);
        if (d < bestD) {
          bestD = d;
          bestGx = gx;
        }
      }
      nx = cellIx * WORLD4_CELL_PITCH + bestGx;
      ny = 0;
      nz = cellIz * WORLD4_CELL_PITCH + WORLD4_GATE_Z;
    } else if (k === 5) {
      const ix = clamp(Math.round(lx / WORLD5_LATTICE_A), -4, 4);
      nx = ix * WORLD5_LATTICE_A;
      ny = 0;
      nz = 0;
    } else if (k === 6) {
      // Find closest selectable 3D Silicon atom in the crystal lattice!
      let best = this.latticeAtoms[0];
      let bestD2 = Infinity;
      for (let i = 0; i < this.latticeAtoms.length; i++) {
        const at = this.latticeAtoms[i];
        const dx = at.x - lx;
        const dy = at.y - ly;
        const dz = at.z - lz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = at;
        }
      }
      nx = best.x;
      ny = best.y;
      nz = best.z;
      this.atomParity = best.parity;
    }

    if (Math.abs(nx - this.anchors[k][0]) > 1e-4 || Math.abs(ny - this.anchors[k][1]) > 1e-4 || Math.abs(nz - this.anchors[k][2]) > 1e-4) {
      this.anchors[k][0] = nx;
      this.anchors[k][1] = ny;
      this.anchors[k][2] = nz;
      this.recomputeEffOffsets();
      // Compensate smooth camera pan by the exact camera-space delta so the view glides smoothly onto the new feature!
      const s = this.stageScales[k];
      this.smoothCamShiftX -= (this.effOffsets[k][0] - prevX) * s;
      this.smoothCamShiftY -= (this.effOffsets[k][1] - prevY) * s;
      this.smoothCamShiftZ -= (this.effOffsets[k][2] - prevZ) * s;
    }
  }

  private uploadQuarterTexture(tex: WebGLTexture, buf: QuarterTextureBuffer): void {
    this.upload2dPbrTexture(tex, buf, this.gl.CLAMP_TO_EDGE);
  }

  private applyAnisotropy(target: number): void {
    const gl = this.gl;
    const anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (anisoExt) {
      const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(target, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso || 1));
    }
  }

  private upload2dPbrTexture(tex: WebGLTexture, buf: TextureBuffer, wrapMode: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, buf.width, buf.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
    this.applyAnisotropy(gl.TEXTURE_2D);
  }

  private initMaterialArrayTexture(tex: WebGLTexture, data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      MAT_ARRAY_SIZE,
      MAT_ARRAY_SIZE,
      MAT_ARRAY_LAYERS,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.applyAnisotropy(gl.TEXTURE_2D_ARRAY);
  }

  private updateMaterialArrayLayer(tex: WebGLTexture, layer: number, data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      MAT_ARRAY_SIZE,
      MAT_ARRAY_SIZE,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  private uploadStudioEnvTexture(tex: WebGLTexture, mips: TextureBuffer[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (let level = 0; level < mips.length; level++) {
      const m = mips[level];
      gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA8, m.width, m.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, mips.length - 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private updateLightMatrix(lookX: number, lookZ: number, halfExtent: number): void {
    if (
      Math.abs(lookX - this.lastLightLookX) < 0.002 &&
      Math.abs(lookZ - this.lastLightLookZ) < 0.002 &&
      Math.abs(halfExtent - this.lastLightHalf) < 0.002
    ) {
      return;
    }
    this.lastLightLookX = lookX;
    this.lastLightLookZ = lookZ;
    this.lastLightHalf = halfExtent;
    const lLen = Math.hypot(0.52, 0.84, 0.4);
    const dist = 14.0 + (halfExtent - 8.8) * 0.65;
    const lx = lookX + (0.52 / lLen) * dist;
    const ly = (0.84 / lLen) * dist;
    const lz = lookZ + (0.4 / lLen) * dist;
    mat4LookAt(this.lightViewMat, lx, ly, lz, lookX, 0, lookZ, 0, 1, 0);
    mat4Ortho(this.lightProjMat, -halfExtent, halfExtent, -halfExtent, halfExtent, 2.0, 44.0);
    mat4Multiply(this.lightVPMat, this.lightProjMat, this.lightViewMat);
    this.shadowDirty = true;
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile error: ${log}`);
    }
    return sh;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error(`Program link error: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  private cacheUniforms(): void {
    const gl = this.gl;
    const grab = (prog: WebGLProgram, names: string[]) => {
      const out: Record<string, WebGLUniformLocation | null> = {};
      for (const n of names) out[n] = gl.getUniformLocation(prog, n);
      return out;
    };

    const shadowNames = [
      'uLightVP',
      'uWorldScale',
      'uYExtrude',
      'uStageReveal',
      'uStageOffset',
      'uAtomRotY',
      'uHoleBox',
      'uHoleMinY',
      'uHoleMode',
      'uHoleOpen',
      'uAtomHole',
      'uCamPos',
      'uLensClearance',
      'uTime',
      'uMacLoads',
      'uCoreA',
      'uCoreB',
      'uNetLoad',
      'uPulsePhase',
      'uSocTemp',
    ];
    this.uShadow = grab(this.shadowProg, shadowNames);
    this.uShadowCutout = grab(this.shadowCutoutProg, shadowNames);

    const sceneNames = [
      'uViewProj',
      'uLightVP',
      'uWorldScale',
      'uYExtrude',
      'uStageReveal',
      'uStageOffset',
      'uAtomRotY',
      'uHoleBox',
      'uHoleMinY',
      'uHoleMode',
      'uHoleOpen',
      'uAtomHole',
      'uCamPos',
      'uLensClearance',
      'uTime',
      'uMacLoads',
      'uCoreA',
      'uCoreB',
      'uNetLoad',
      'uPulsePhase',
      'uSocTemp',
      'uShadowMap',
      'uShadowTexel',
      'uCoinTex',
      'uCoinNormTex',
      'uMatTex',
      'uMatNormTex',
      'uDieLithoTex',
      'uDieNormTex',
      'uAbfTex',
      'uAbfNormTex',
      'uRamDecalTex',
      'uEnvTex',
      'uCoinSpec',
      'uFocusXZ',
      'uFocusDist',
      'uDofStrength',
      'uFogDensity',
      'uZoom',
      'uSemFactor',
      'uFloorY',
      'uThermal',
      'uTranslucent',
      'uRegionKind',
      'uInspectBox',
      'uHoverBox',
      'uHighlightFade',
      'uIntroLight',
      'uBootA',
      'uBootB',
    ];
    this.uScene = grab(this.sceneProg, sceneNames);
    this.uSceneCutout = grab(this.sceneCutoutProg, sceneNames);

    this.uPrefilter = grab(this.prefilterProg, ['uTex', 'uTexelSize']);
    this.uDown = grab(this.bloomDownProg, ['uTex', 'uHalfPixel']);
    this.uUp = grab(this.bloomUpProg, ['uTex', 'uHalfPixel']);
    this.uComp = grab(this.compositeProg, [
      'uTex',
      'uBloomTex',
      'uResolution',
      'uMotion',
      'uTime',
      'uVoidPlunge',
      'uIntroExposure',
    ]);
    this.uLiquid = grab(this.liquidGlProg, [
      'uTex',
      'uResolution',
      'uCssSize',
      'uTime',
      'uGlassRect',
      'uGlassParams',
      'uQuadPad',
      'uPointerFluid',
    ]);
    this.uVernier = grab(this.vernierProg, [
      'uTex',
      'uCssSize',
      'uVernierRect',
      'uTexParams',
      'uFadeParams',
    ]);
  }

  private createArrayBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  private createIndexBuffer(data: Uint16Array): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  private buildInstancedVao(
    meshVbo: WebGLBuffer,
    meshIbo: WebGLBuffer,
    instData: Float32Array
  ): { vao: WebGLVertexArrayObject; instBuf: WebGLBuffer } {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);

    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instData, gl.STATIC_DRAW);

    const stride = 48;
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
    return { vao, instBuf };
  }

  private uploadStage(w: WorldInstances, floorY: number, useHighResCyl = false): StageDraw {
    let boxVao: WebGLVertexArrayObject | null = null;
    let boxBuf: WebGLBuffer | null = null;
    if (w.boxCount > 0) {
      const built = this.buildInstancedVao(this.boxVbo, this.boxIbo, w.boxes);
      boxVao = built.vao;
      boxBuf = built.instBuf;
    }

    let cylVao: WebGLVertexArrayObject | null = null;
    let cylBuf: WebGLBuffer | null = null;
    const cylIndexCount = useHighResCyl ? this.coinCylMesh.indexCount : this.cylMesh.indexCount;
    if (w.cylinderCount > 0) {
      const built = this.buildInstancedVao(
        useHighResCyl ? this.coinCylVbo : this.cylVbo,
        useHighResCyl ? this.coinCylIbo : this.cylIbo,
        w.cylinders
      );
      cylVao = built.vao;
      cylBuf = built.instBuf;
    }

    let sphereVao: WebGLVertexArrayObject | null = null;
    let sphereBuf: WebGLBuffer | null = null;
    if (w.sphereCount > 0) {
      const built = this.buildInstancedVao(this.sphereVbo, this.sphereIbo, w.spheres);
      sphereVao = built.vao;
      sphereBuf = built.instBuf;
    }

    let transSphereVao: WebGLVertexArrayObject | null = null;
    let transSphereBuf: WebGLBuffer | null = null;
    if (w.translucentSphereCount > 0) {
      const built = this.buildInstancedVao(this.orbitalSphereVbo, this.orbitalSphereIbo, w.translucentSpheres);
      transSphereVao = built.vao;
      transSphereBuf = built.instBuf;
    }

    let bondVao: WebGLVertexArrayObject | null = null;
    let bondBuf: WebGLBuffer | null = null;
    if (w.bondCount > 0) {
      const built = this.buildInstancedVao(this.bondVbo, this.bondIbo, w.bonds);
      bondVao = built.vao;
      bondBuf = built.instBuf;
    }

    return {
      boxVao,
      boxCount: w.boxCount,
      cylVao,
      cylCount: w.cylinderCount,
      cylIndexCount,
      sphereVao,
      sphereCount: w.sphereCount,
      transSphereVao,
      transSphereCount: w.translucentSphereCount,
      bondVao,
      bondCount: w.bondCount,
      floorY,
      boxBuf,
      cylBuf,
      sphereBuf,
      transSphereBuf,
      bondBuf,
    };
  }

  private createColorFbo(
    w: number,
    h: number,
    attachDepth: WebGLRenderbuffer | null = null,
    forceLdr = false
  ): FboTarget {
    const gl = this.gl;
    const width = Math.max(1, w);
    const height = Math.max(1, h);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (this.useFloatHdr && !forceLdr) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (attachDepth) {
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, attachDepth);
    }
    if (this.useFloatHdr && !forceLdr && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // Graceful fallback for mobile GPUs that report float extension without full RGBA16F FBO support
      this.useFloatHdr = false;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w: width, h: height };
  }

  private destroyRenderTargets(): void {
    const gl = this.gl;
    const drop = (t?: FboTarget) => {
      if (!t) return;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    };
    drop(this.hdrMain);
    drop(this.srgbA);
    drop(this.srgbB);
    this.bloomDown.forEach(drop);
    this.bloomUp.forEach(drop);
    this.bloomDown = [];
    this.bloomUp = [];
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.msaaColorRb) gl.deleteRenderbuffer(this.msaaColorRb);
    if (this.msaaDepthRb) gl.deleteRenderbuffer(this.msaaDepthRb);
    if (this.fallbackDepthRb) gl.deleteRenderbuffer(this.fallbackDepthRb);
    this.msaaFbo = null;
    this.msaaColorRb = null;
    this.msaaDepthRb = null;
    this.fallbackDepthRb = null;
  }

  private allocRenderTargets(w: number, h: number): void {
    const gl = this.gl;
    for (const q of this.pendingGpuQueries) {
      gl.deleteQuery(q);
    }
    this.pendingGpuQueries = [];
    this.destroyRenderTargets();

    let msaaOk = false;
    if (this.msaaSamples >= 2) {
      const fbo = gl.createFramebuffer()!;
      const colorRb = gl.createRenderbuffer()!;
      const depthRb = gl.createRenderbuffer()!;
      const internalFmt = this.useFloatHdr ? gl.RGBA16F : gl.RGBA8;

      gl.bindRenderbuffer(gl.RENDERBUFFER, colorRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaaSamples, internalFmt, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaaSamples, gl.DEPTH_COMPONENT24, w, h);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        this.msaaFbo = fbo;
        this.msaaColorRb = colorRb;
        this.msaaDepthRb = depthRb;
        msaaOk = true;
      } else {
        gl.deleteFramebuffer(fbo);
        gl.deleteRenderbuffer(colorRb);
        gl.deleteRenderbuffer(depthRb);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (!msaaOk) {
      this.fallbackDepthRb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.fallbackDepthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    }

    this.hdrMain = this.createColorFbo(w, h, msaaOk ? null : this.fallbackDepthRb);
    this.srgbA = this.createColorFbo(w, h, null, true);
    this.srgbB = this.createColorFbo(w, h, null, true);

    const w1 = Math.max(2, Math.floor(w / 4));
    const h1 = Math.max(2, Math.floor(h / 4));
    const w2 = Math.max(2, Math.floor(w / 8));
    const h2 = Math.max(2, Math.floor(h / 8));
    const w3 = Math.max(2, Math.floor(w / 16));
    const h3 = Math.max(2, Math.floor(h / 16));

    this.bloomDown = [
      this.createColorFbo(w1, h1),
      this.createColorFbo(w2, h2),
      this.createColorFbo(w3, h3),
    ];
    this.bloomUp = [this.createColorFbo(w2, h2), this.createColorFbo(w1, h1)];
  }

  public setTelemetry(t: LiveMacTelemetry): void {
    this.telemetry = t;
    const pCores = Math.max(2, Math.min(12, t.pCoreCount || 8));
    const eCores = Math.max(2, Math.min(6, t.eCoreCount || 2));
    const gpuCores = Math.max(8, Math.min(40, t.gpuCores || 24));
    if (
      pCores !== this.dieSpec.pCores ||
      eCores !== this.dieSpec.eCores ||
      gpuCores !== this.dieSpec.gpuCores
    ) {
      this.dieSpec = { pCores, eCores, gpuCores };
      this.rebuildWorld0();
    }
  }

  private rebuildWorld0(): void {
    const gl = this.gl;
    const old = this.stages[0];
    if (old) {
      if (old.boxVao) gl.deleteVertexArray(old.boxVao);
      if (old.cylVao) gl.deleteVertexArray(old.cylVao);
      if (old.sphereVao) gl.deleteVertexArray(old.sphereVao);
      if (old.transSphereVao) gl.deleteVertexArray(old.transSphereVao);
      if (old.bondVao) gl.deleteVertexArray(old.bondVao);
      if (old.boxBuf) gl.deleteBuffer(old.boxBuf);
      if (old.cylBuf) gl.deleteBuffer(old.cylBuf);
      if (old.sphereBuf) gl.deleteBuffer(old.sphereBuf);
      if (old.transSphereBuf) gl.deleteBuffer(old.transSphereBuf);
      if (old.bondBuf) gl.deleteBuffer(old.bondBuf);
    }
    this.stages[0] = this.uploadStage(buildWorld0(this.dieSpec), STAGE_FLOOR_Y[0], true);
    this.world0Version++;
    this.shadowDirty = true;
    this.markActivity();
  }

  public getGpuRenderer(): string | null {
    const ext = this.gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof renderer === 'string' && renderer.trim()) return renderer.trim();
    }
    const fallback = this.gl.getParameter(this.gl.RENDERER);
    return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : null;
  }

  public getFrameActivity(): FrameActivitySample {
    return {
      frameMs: this.emaFrameMs,
      gpuFrameMs: this.emaGpuFrameMs,
      motion: this.smoothMotion,
      zoom: this.zoom,
      idlePaced: this.isIdlePaced,
    };
  }

  private pollGpuTimerQueries(): void {
    const ext = this.timerQueryExt;
    if (!ext || this.pendingGpuQueries.length === 0) return;
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));

    while (this.pendingGpuQueries.length > 0) {
      const q = this.pendingGpuQueries[0];
      const available = Boolean(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE));
      if (!available && !disjoint) break;
      this.pendingGpuQueries.shift();
      if (available && !disjoint) {
        const ns = Number(gl.getQueryParameter(q, gl.QUERY_RESULT));
        const ms = ns / 1_000_000;
        if (Number.isFinite(ms) && ms > 0.02 && ms < 250) {
          this.emaGpuFrameMs = this.emaGpuFrameMs === null ? ms : this.emaGpuFrameMs * 0.84 + ms * 0.16;
        }
      }
      gl.deleteQuery(q);
    }
  }

  public clearInspect(): void {
    if (!this.hasInspect) return;
    this.hasInspect = false;
    this.inspectId = null;
    this.inspectBox = [0, 0, 0, 0];
    this.markActivity();
    this.hooks.onInspect(null);
  }

  public clearHover(): void {
    if (!this.hasHover) return;
    this.hasHover = false;
    this.hoverId = null;
    this.hoverBox = [0, 0, 0, 0];
    this.markActivity();
    this.hooks.onHover?.(null, 0, 0);
  }

  public get isTourActive(): boolean {
    return this.tourActive;
  }

  public get isIntroActive(): boolean {
    return this.introActive;
  }

  public get isIntroHeld(): boolean {
    return this.introAwaitingBoot;
  }

  /** Update the active intro beat/cue map whenever the user switches soundtrack vibes */
  public setIntroCues(cues: IntroCueMap): void {
    this.introCues = cues;
  }

  /** Hold Cold Boot paused at black while checking autoplay or waiting for user power-on gesture */
  public holdIntro(): void {
    this.initIntroState();
    this.introAwaitingBoot = true;
    this.introHoldRendered = false;
  }

  /** Release the Cold Boot hold and launch seamlessly from `startElapsedSec` (0.0 for autoplay, heldStartSec from held title) */
  public releaseIntroHold(startElapsedSec = 0): void {
    if (!this.introAwaitingBoot) return;
    this.introAwaitingBoot = false;
    const dur = this.introCues.durationSec;
    this.introElapsed = clamp(startElapsedSec, 0, dur - 0.1);
    this.lastFrame = performance.now();
    this.lastRenderMs = 0;
    this.markActivity();
    this.hooks.onIntroFrame?.({
      active: true,
      progress: clamp(this.introElapsed / dur, 0, 1),
      elapsed: this.introElapsed,
    });
  }

  private initIntroState(): void {
    this.flightActive = false;
    this.markActivity();
    this.shadowDirty = true;
    this.stopTour();
    this.clearInspect();
    this.clearHover();
    this.targetAnchor0[0] = 0;
    this.targetAnchor0[1] = 0;
    this.anchors[0][0] = 0;
    this.anchors[0][2] = 0;
    for (let k = 1; k < this.anchors.length; k++) {
      this.anchors[k][0] = 0;
      this.anchors[k][1] = 0;
      this.anchors[k][2] = k === 4 ? WORLD4_GATE_Z : 0;
    }
    this.atomParity = 1;
    this.smoothCamShiftX = 0;
    this.smoothCamShiftY = 0;
    this.smoothCamShiftZ = 0;
    this.recomputeEffOffsets();

    this.introActive = true;
    this.introElapsed = 0;
    this.zoom = INTRO_START_ZOOM;
    this.targetZoom = INTRO_START_ZOOM;
    this.pitch = INTRO_START_PITCH;
    this.targetPitch = INTRO_START_PITCH;
    this.yaw = INTRO_START_YAW;
    this.targetYaw = INTRO_START_YAW;

    // Chip emerges from pure black completely powered "off" — stays dark & sculptural until the major beat!
    this.introLightSweep = 0.18;
    this.introKeyIntensity = 0.045;
    this.introRimBoost = 0.48;
    this.introBeatPulse = 0.0;
    this.introFogBoost = 0.032;
    this.introExposure = 0.0;
    this.introDofBoost = 0.0;

    this.bootPwrRails = 0.0;
    this.bootFabricLock = 0.0;
    this.bootMemTrain = 0.0;
    this.bootEcoreWake = 0.0;
    this.bootPcoreWake = 0.0;
    this.bootGpuWake = 0.0;
    this.bootAuxWake = 0.0;
    this.bootActive = 1.0;
  }

  /** Play (or replay) the "Cold Boot" powered-off -> beat-aligned major-drop silicon power-on entrance */
  public startIntro(): void {
    this.introAwaitingBoot = false;
    this.initIntroState();
    this.hooks.onIntroFrame?.({ active: true, progress: 0, elapsed: 0 });
  }

  /** Seamlessly yield control to the user if they scroll, drag, or click during the intro */
  public skipIntro(): void {
    if (!this.introActive) return;
    this.introAwaitingBoot = false;
    this.introActive = false;
    this.targetZoom = this.zoom;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.kickoffDeferredHighResTextures();
    this.hooks.onIntroFrame?.({ active: false, progress: 1, elapsed: this.introCues.durationSec });
  }

  /** Pick the hottest live P-Core on the user's Mac as the hero dive target */
  private getBusiestPCoreXZ(): [number, number] {
    const pCount = Math.max(2, Math.min(12, this.dieSpec.pCores || 8));
    const pRowsN = pCount <= 4 ? 1 : 2;
    const pColsN = Math.ceil(pCount / pRowsN);
    const pStepX = 2.48 / pColsN;
    const pStepZ = 1.68 / pRowsN;
    const eOff = Math.min(this.telemetry.eCoreCount, Math.max(0, this.telemetry.coreLoads.length - pCount));
    let bestIdx = 0;
    let bestLoad = -1;
    for (let i = 0; i < pCount; i++) {
      const l = this.telemetry.coreLoads[eOff + i] ?? 0;
      if (l > bestLoad) {
        bestLoad = l;
        bestIdx = i;
      }
    }
    const r = Math.floor(bestIdx / pColsN);
    const c = bestIdx % pColsN;
    const cx = -1.68 + (c - (pColsN - 1) * 0.5) * pStepX;
    const cz = -1.04 + (r - (pRowsN - 1) * 0.5) * pStepZ;
    return [
      Math.round(cx / WORLD0_GRID_STEP) * WORLD0_GRID_STEP,
      Math.round(cz / WORLD0_GRID_STEP) * WORLD0_GRID_STEP,
    ];
  }

  public startTour(): void {
    if (this.tourActive) return;
    this.flightActive = false;
    this.markActivity();
    this.shadowDirty = true;
    this.skipIntro();
    this.clearInspect();
    this.clearHover();
    this.tourActive = true;
    this.tourElapsed = 0;
    this.tourBaseYaw = -0.16;

    // Reset nested anchors cleanly and lock World 0 onto the hottest live P-Core!
    const [tx, tz] = this.getBusiestPCoreXZ();
    this.targetAnchor0[0] = clamp(tx, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
    this.targetAnchor0[1] = clamp(tz, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
    for (let k = 1; k < this.anchors.length; k++) {
      this.anchors[k][0] = 0;
      this.anchors[k][1] = 0;
      this.anchors[k][2] = k === 4 ? WORLD4_GATE_Z : 0;
    }
    this.atomParity = 1;
    this.recomputeEffOffsets();

    // Start from the Scale landmark if already zoomed deep, or continue cleanly from Scale
    if (this.zoom > 0.35 || this.zoom < -1.4) {
      this.targetZoom = -1.08;
      this.zoomRate = 4.5;
    }
    this.hooks.onTourChange?.(true);
  }

  public stopTour(): void {
    if (!this.tourActive) return;
    this.tourActive = false;
    this.targetZoom = this.zoom;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.hooks.onTourChange?.(false);
  }

  public toggleTour(): void {
    if (this.tourActive) this.stopTour();
    else this.startTour();
  }

  /** Compute camera-space ray (origin + unit direction) for a client pixel */
  private getPointerRay(clientX: number, clientY: number): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } | null {
    const rect = this.canvasRect;
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (!mat4Invert(this.invViewProjMat, this.viewProjMat)) return null;

    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const m = this.invViewProjMat;

    const unproj = (nz: number): [number, number, number] => {
      const x = m[0] * nx + m[4] * ny + m[8] * nz + m[12];
      const y = m[1] * nx + m[5] * ny + m[9] * nz + m[13];
      const z = m[2] * nx + m[6] * ny + m[10] * nz + m[14];
      const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15] || 1;
      return [x / w, y / w, z / w];
    };

    const nearP = unproj(-1);
    const farP = unproj(1);
    const vx = farP[0] - nearP[0];
    const vy = farP[1] - nearP[1];
    const vz = farP[2] - nearP[2];
    const len = Math.hypot(vx, vy, vz) || 1;
    return { ox: nearP[0], oy: nearP[1], oz: nearP[2], dx: vx / len, dy: vy / len, dz: vz / len };
  }

  /** Intersect pointer ray with horizontal camera-space plane y = planeY */
  private unprojectPlaneXZ(clientX: number, clientY: number, planeY = 0.0): [number, number] | null {
    const ray = this.getPointerRay(clientX, clientY);
    if (!ray || Math.abs(ray.dy) < 1e-5) return null;
    const t = (planeY - ray.oy) / ray.dy;
    if (t < 0) return null;
    return [ray.ox + ray.dx * t, ray.oz + ray.dz * t];
  }

  /** Unproject pointer directly into World 0's local (wx, wz) coordinates (functional die top sits at y = 0.0) */
  private unprojectDiePoint(clientX: number, clientY: number): [number, number] | null {
    const planeY = -this.effOffsets[0][1] * this.world0Scale;
    const camHit = this.unprojectPlaneXZ(clientX, clientY, planeY);
    if (!camHit) return null;
    return [
      camHit[0] / this.world0Scale + this.effOffsets[0][0],
      camHit[1] / this.world0Scale + this.effOffsets[0][2],
    ];
  }

  private getCameraPoseForZoom(z: number): [number, number] {
    // Continuous piecewise-linear camera pitch & yaw curve across all 11 stops (zero jarring pitch jumps!)
    const stops: readonly [number, number, number][] = [
      [-1.0, 0.96, 0.0],
      [0.0, HERO_PITCH, HERO_YAW],
      [1.0, 0.76, 0.08],
      [2.0, 0.66, 0.20],
      [3.0, 0.58, 0.24],
      [4.0, 0.48, 0.28],
      [5.0, 0.32, 0.32],
      [6.0, 0.28, 0.38],
      [7.0, 0.26, 0.44],
      [8.0, 0.30, 0.46],
      [9.0, 0.32, 0.50],
    ];
    if (z <= stops[0][0]) return [stops[0][1], stops[0][2]];
    const last = stops[stops.length - 1];
    if (z >= last[0]) return [last[1], last[2]];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (z >= a[0] && z <= b[0]) {
        const t = (z - a[0]) / Math.max(0.001, b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    return [HERO_PITCH, HERO_YAW];
  }

  public flyToZoom(z: number, dieTargetXZ?: [number, number]): void {
    this.markActivity();
    this.skipIntro();
    this.stopTour();
    const destZoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = destZoom;

    let endAnchorX = this.targetAnchor0[0];
    let endAnchorZ = this.targetAnchor0[1];
    let hasAnchor = false;
    if (dieTargetXZ) {
      const gx = Math.round(dieTargetXZ[0] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
      const gz = Math.round(dieTargetXZ[1] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
      endAnchorX = clamp(gx, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
      endAnchorZ = clamp(gz, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
      this.targetAnchor0[0] = endAnchorX;
      this.targetAnchor0[1] = endAnchorZ;
      hasAnchor = true;
    } else if (destZoom <= 0.05) {
      endAnchorX = 0;
      endAnchorZ = 0;
      this.targetAnchor0[0] = 0;
      this.targetAnchor0[1] = 0;
      hasAnchor = true;
      if (this.zoom <= 0.55) {
        for (let k = 1; k < this.anchors.length; k++) {
          this.anchors[k][0] = 0;
          this.anchors[k][1] = 0;
          this.anchors[k][2] = k === 4 ? WORLD4_GATE_Z : 0;
        }
        this.atomParity = 1;
        this.recomputeEffOffsets();
      }
    }

    const [destPitch, rawDestYaw] = this.getCameraPoseForZoom(destZoom);
    // Pick shortest angular path in yaw so the camera never spins the long way around!
    const twoPi = Math.PI * 2;
    let deltaYaw = ((rawDestYaw - this.yaw) % twoPi + Math.PI * 3) % twoPi - Math.PI;
    const destYaw = this.yaw + deltaYaw;

    this.targetPitch = destPitch;
    this.targetYaw = destYaw;

    // Launch velvety quintic-eased optical objective flight (zero initial velocity kick, whisper-soft arrival!)
    const dz = Math.abs(destZoom - this.zoom);
    const dAng = Math.hypot(destPitch - this.pitch, deltaYaw);
    this.flightStartZoom = this.zoom;
    this.flightEndZoom = destZoom;
    this.flightStartPitch = this.pitch;
    this.flightEndPitch = destPitch;
    this.flightStartYaw = this.yaw;
    this.flightEndYaw = destYaw;
    this.flightStartAnchorX = this.anchors[0][0];
    this.flightStartAnchorZ = this.anchors[0][2];
    this.flightEndAnchorX = endAnchorX;
    this.flightEndAnchorZ = endAnchorZ;
    this.flightHasAnchor = hasAnchor;
    this.flightElapsed = 0;
    this.flightDuration = clamp(0.68 + dz * 0.24 + dAng * 0.14, 0.72, 2.40);
    this.flightActive = true;
  }

  public getZoom(): number {
    return this.zoom;
  }

  /**
   * Direct tactile zoom scrubbing (used by the Optical Vernier Dial on both touch and desktop).
   * Cancels any active flight, smoothly tracks the cinematic camera pose for the target depth,
   * and keeps 120 FPS inertia responsive without jarring jumps.
   */
  public scrubZoom(z: number, followPose = true): void {
    if (this.introAwaitingBoot) return;
    this.markActivity();
    this.skipIntro();
    this.stopTour();
    if (this.flightActive) {
      this.flightActive = false;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }
    const destZoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = destZoom;
    this.zoomRate = 18.0;

    if (destZoom <= 0.05) {
      this.targetAnchor0[0] = 0;
      this.targetAnchor0[1] = 0;
    }

    if (followPose) {
      const [destPitch, rawDestYaw] = this.getCameraPoseForZoom(destZoom);
      const twoPi = Math.PI * 2;
      const deltaYaw = ((rawDestYaw - this.yaw) % twoPi + Math.PI * 3) % twoPi - Math.PI;
      this.targetPitch = destPitch;
      this.targetYaw = this.yaw + deltaYaw;
    }
  }

  private resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const maxDpr = this.isMobile ? 1.75 : 2.0;
    const maxPixels = this.isMobile ? MAX_RENDER_PIXELS_MOBILE : MAX_RENDER_PIXELS_DESKTOP;
    const nativeDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    // Cap total pixel count so Retina/5K and mobile displays stay razor-sharp without GPU fillrate overload
    const maxDprForBudget = Math.sqrt(maxPixels / Math.max(1, w * h));
    const dpr = Math.max(1.0, Math.min(nativeDpr, maxDprForBudget));
    this.cssW = w;
    this.cssH = h;
    this.canvasW = Math.max(1, Math.floor(w * dpr));
    this.canvasH = Math.max(1, Math.floor(h * dpr));
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    const rect = this.canvas.getBoundingClientRect();
    this.canvasRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width || w,
      height: rect.height || h,
    };
    if (!this.contextLost) {
      this.allocRenderTargets(this.canvasW, this.canvasH);
    }
    this.shadowDirty = true;
    this.markActivity();
  };

  public setLiquidGlassRegions(
    regions: readonly {
      cx: number;
      cy: number;
      hw: number;
      hh: number;
      radius: number;
      bevel: number;
      frost: number;
      style: 0 | 1 | 2 | 3;
      alpha: number;
    }[]
  ): void {
    const count = Math.min(16, regions.length);
    let changed = count !== this.glassCount;
    this.glassCount = count;
    let hasElev = false;
    for (let i = 0; i < count; i++) {
      const r = regions[i];
      if (r.style >= 2 && r.alpha > 0.005) hasElev = true;
      const o = i * 4;
      const p3 = r.style * 4.0 + clamp(r.alpha, 0.0, 1.0);
      if (
        !changed &&
        (Math.abs(this.glassRects[o] - r.cx) > 0.1 ||
          Math.abs(this.glassRects[o + 1] - r.cy) > 0.1 ||
          Math.abs(this.glassRects[o + 2] - r.hw) > 0.1 ||
          Math.abs(this.glassRects[o + 3] - r.hh) > 0.1 ||
          Math.abs(this.glassParams[o + 3] - p3) > 0.002)
      ) {
        changed = true;
      }
      this.glassRects[o] = r.cx;
      this.glassRects[o + 1] = r.cy;
      this.glassRects[o + 2] = r.hw;
      this.glassRects[o + 3] = r.hh;
      this.glassParams[o] = r.radius;
      this.glassParams[o + 1] = r.bevel;
      this.glassParams[o + 2] = r.frost;
      this.glassParams[o + 3] = p3;
    }
    this.glassHasElevated = hasElev;
    if (changed) this.markActivity();
  }

  public setGlassPointer(xCss: number, yCss: number, active: boolean): void {
    if (active && this.glassPointerActive > 0.5) {
      const dx = clamp(xCss - this.glassPointerX, -32, 32);
      const dy = clamp(yCss - this.glassPointerY, -32, 32);
      this.glassPointerVelX = this.glassPointerVelX * 0.65 + dx * 0.35;
      this.glassPointerVelY = this.glassPointerVelY * 0.65 + dy * 0.35;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.markActivity();
      }
    } else if (active !== (this.glassPointerActive > 0.5)) {
      this.markActivity();
    }
    this.glassPointerX = xCss;
    this.glassPointerY = yCss;
    this.glassPointerActive = active ? 1.0 : 0.0;
  }

  /** Upload Retina 2D canvas containing engraved Vernier ticks + landmark labels (premultiplied RGBA) */
  public uploadVernierTexture(source: HTMLCanvasElement, originCss: number, texWidthCss: number): void {
    if (this.contextLost) return;
    const gl = this.gl;
    if (!this.vernierTex) {
      this.vernierTex = gl.createTexture();
    }
    if (!this.vernierTex) return;
    gl.bindTexture(gl.TEXTURE_2D, this.vernierTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.vernierTexOriginCss = originCss;
    this.vernierTexWidthCss = Math.max(1, texWidthCss);
    this.markActivity();
  }

  /** Update Vernier strip screen placement, pitch, center glass half-width, and fade alpha */
  public setVernierStrip(
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    pitchCss: number,
    loupeHalfW: number,
    alpha: number
  ): void {
    const a = clamp(alpha, 0, 1);
    const changed =
      Math.abs(this.vernierRect[0] - cx) > 0.1 ||
      Math.abs(this.vernierRect[1] - cy) > 0.1 ||
      Math.abs(this.vernierRect[2] - halfW) > 0.1 ||
      Math.abs(this.vernierRect[3] - halfH) > 0.1 ||
      Math.abs(this.vernierPitchCss - pitchCss) > 0.1 ||
      Math.abs(this.vernierLoupeHalfW - loupeHalfW) > 0.1 ||
      Math.abs(this.vernierAlpha - a) > 0.002;
    this.vernierRect[0] = cx;
    this.vernierRect[1] = cy;
    this.vernierRect[2] = halfW;
    this.vernierRect[3] = halfH;
    this.vernierPitchCss = Math.max(1, pitchCss);
    this.vernierLoupeHalfW = Math.max(16, loupeHalfW);
    this.vernierAlpha = a;
    if (changed) this.markActivity();
  }

  /**
   * Steady center-reticle zoom on scroll/pinch (zero lateral cursor-drift).
   * Lateral targeting is handled deliberately via click-to-inspect ("Dive to...") or Shift/Right-drag pan.
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.introAwaitingBoot) return;
    if (this.flightActive) {
      this.flightActive = false;
      this.targetZoom = this.zoom;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }
    this.markActivity();
    this.skipIntro();
    this.stopTour();
    const delta = -e.deltaY * (e.ctrlKey ? 0.010 : 0.0028);
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom + delta));
    this.zoomRate = 9.5;
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onSafariGesture = (e: Event): void => {
    e.preventDefault();
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    window.location.reload();
  };

  private applyStagePan(dx: number, dy: number): void {
    // Pan across the active scale stage in view-aligned XZ directions!
    const k = clamp(Math.round(this.zoom), 0, 6);
    const sk = Math.max(0.05, this.stageScales[k]);
    const panSpeed = 0.0075 / sk;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    // Right vector = (cosY, -sinY), Forward vector = (-sinY, -cosY)
    const moveX = (-dx * cosY + dy * sinY) * panSpeed;
    const moveZ = (dx * sinY + dy * cosY) * panSpeed;

    if (k === 0) {
      this.targetAnchor0[0] = clamp(this.targetAnchor0[0] + moveX, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
      this.targetAnchor0[1] = clamp(this.targetAnchor0[1] + moveZ, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
    } else if (k === 6) {
      const cur = this.anchors[6];
      this.setStageAnchorSnapped(6, cur[0] + moveX * 1.6, cur[1] - dy * panSpeed * 1.4, cur[2] + moveZ * 1.6, true);
    } else {
      const cur = this.anchors[k];
      this.setStageAnchorSnapped(k, cur[0] + moveX * 2.2, 0, cur[2] + moveZ * 2.2, true);
    }
  }

  private seedPinchState(): void {
    const it = this.activePointers.values();
    const p0 = it.next().value as { x: number; y: number } | undefined;
    const p1 = it.next().value as { x: number; y: number } | undefined;
    if (!p0 || !p1) return;
    this.prevPinchDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    this.prevPinchMidX = (p0.x + p1.x) * 0.5;
    this.prevPinchMidY = (p0.y + p1.y) * 0.5;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.introAwaitingBoot) return;
    if (this.flightActive) {
      this.flightActive = false;
      this.targetZoom = this.zoom;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }
    this.markActivity();
    this.skipIntro();
    this.stopTour();
    this.clearHover();
    const rect = this.canvas.getBoundingClientRect();
    this.canvasRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width || this.cssW,
      height: rect.height || this.cssH,
    };

    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore on platforms without capture support
    }

    if (this.activePointers.size >= 2) {
      this.gestureHadMultiTouch = true;
      this.dragging = true;
      this.dragMode = 'pinch';
      this.seedPinchState();
      return;
    }

    this.gestureHadMultiTouch = false;
    this.dragging = true;
    // Right-drag or Shift+drag pans the microscope stage laterally; normal left-drag / 1-finger drag orbits in 3D!
    this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.canvas.style.cursor = this.dragMode === 'pan' ? 'move' : 'grabbing';
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) {
      if (e.pointerType === 'touch') return;
      if (!this.tourActive && !this.introActive && this.zoom < 0.85) {
        const pt = this.unprojectDiePoint(e.clientX, e.clientY);
        const hit = pt ? pickDieRegion(pt[0], pt[1], this.dieSpec) : null;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        if (hit) {
          this.hasHover = true;
          this.hoverId = hit.id;
          this.hoverBox = hit.box;
          this.markActivity();
          this.hooks.onHover?.(hit, e.clientX, e.clientY);
        } else {
          this.clearHover();
        }
      } else {
        this.canvas.style.cursor = 'grab';
        this.clearHover();
      }
      return;
    }

    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    this.markActivity();

    if (this.dragMode === 'pinch') {
      if (this.activePointers.size >= 2) {
        const it = this.activePointers.values();
        const p0 = it.next().value as { x: number; y: number };
        const p1 = it.next().value as { x: number; y: number };
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const midX = (p0.x + p1.x) * 0.5;
        const midY = (p0.y + p1.y) * 0.5;

        if (this.prevPinchDist > 8 && dist > 8) {
          const ratio = clamp(dist / this.prevPinchDist, 0.72, 1.38);
          const zoomDelta = Math.log(ratio) * 2.15;
          this.targetZoom = clamp(this.targetZoom + zoomDelta, MIN_ZOOM, MAX_ZOOM);
          this.zoomRate = 12.0;
        }

        const panDx = midX - this.prevPinchMidX;
        const panDy = midY - this.prevPinchMidY;
        if (Math.abs(panDx) > 0.1 || Math.abs(panDy) > 0.1) {
          this.applyStagePan(panDx, panDy);
        }

        this.prevPinchDist = dist;
        this.prevPinchMidX = midX;
        this.prevPinchMidY = midY;
      }
      return;
    }

    if (this.activePointers.size === 1 && !this.activePointers.has(e.pointerId)) {
      return;
    }

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.dragMode === 'pan') {
      this.applyStagePan(dx, dy);
      return;
    }

    this.targetYaw -= dx * 0.0065;
    const minPitch = this.zoom > 4.2 ? -0.55 : this.zoom < -0.25 ? 0.16 : 0.28;
    this.targetPitch = Math.max(minPitch, Math.min(1.52, this.targetPitch + dy * 0.0055));
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (this.activePointers.size >= 2) {
      this.seedPinchState();
      return;
    }

    if (this.activePointers.size === 1) {
      // Seamlessly hand back to 1-finger orbit from remaining finger with zero camera jump
      const remaining = this.activePointers.values().next().value as { x: number; y: number };
      this.dragMode = 'orbit';
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      return;
    }

    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    const wasOrbit = this.dragMode === 'orbit' && !this.gestureHadMultiTouch;
    const tapThreshold = e.pointerType === 'touch' ? 14 : 5;
    this.dragging = false;
    this.dragMode = 'orbit';
    this.gestureHadMultiTouch = false;
    this.canvas.style.cursor = 'grab';

    if (wasOrbit && e.button === 0 && moved < tapThreshold && this.zoom < 0.85) {
      const pt = this.unprojectDiePoint(e.clientX, e.clientY);
      const hit = pt ? pickDieRegion(pt[0], pt[1], this.dieSpec) : null;
      if (hit) {
        this.hasInspect = true;
        this.inspectId = hit.id;
        this.inspectBox = hit.box;
        this.markActivity();
        this.hooks.onInspect(hit);
      } else {
        this.clearInspect();
      }
    }
  };

  private onPointerLeave = (): void => {
    if (!this.dragging) {
      this.clearHover();
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (this.activePointers.size >= 2) {
      this.seedPinchState();
      return;
    }
    if (this.activePointers.size === 1) {
      const remaining = this.activePointers.values().next().value as { x: number; y: number };
      this.dragMode = 'orbit';
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      return;
    }
    this.dragging = false;
    this.dragMode = 'orbit';
    this.gestureHadMultiTouch = false;
    this.canvas.style.cursor = 'grab';
    this.clearHover();
  };

  private onVisibilityChange = (): void => {
    this.pageHidden = typeof document !== 'undefined' ? document.hidden : false;
    if (this.pageHidden) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    } else if (!this.disposed) {
      this.lastFrame = performance.now();
      this.lastRenderMs = 0;
      this.markActivity();
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(this.loop);
      }
    }
  };

  private onWindowFocus = (): void => {
    this.windowFocused = true;
    this.markActivity();
  };

  private onWindowBlur = (): void => {
    this.windowFocused = false;
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('gesturestart', this.onSafariGesture, { passive: false });
    this.canvas.addEventListener('gesturechange', this.onSafariGesture, { passive: false });
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  private drawOpaqueStage(stage: StageDraw): void {
    const gl = this.gl;
    if (stage.boxVao && stage.boxCount > 0) {
      gl.bindVertexArray(stage.boxVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.boxMesh.indexCount, gl.UNSIGNED_SHORT, 0, stage.boxCount);
    }
    if (stage.cylVao && stage.cylCount > 0) {
      gl.bindVertexArray(stage.cylVao);
      gl.drawElementsInstanced(gl.TRIANGLES, stage.cylIndexCount, gl.UNSIGNED_SHORT, 0, stage.cylCount);
    }
    if (stage.sphereVao && stage.sphereCount > 0) {
      gl.bindVertexArray(stage.sphereVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.sphereMesh.indexCount, gl.UNSIGNED_SHORT, 0, stage.sphereCount);
    }
    if (stage.bondVao && stage.bondCount > 0) {
      gl.bindVertexArray(stage.bondVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.bondMesh.indexCount, gl.UNSIGNED_SHORT, 0, stage.bondCount);
    }
  }

  private drawTranslucentStage(stage: StageDraw): void {
    const gl = this.gl;
    if (stage.transSphereVao && stage.transSphereCount > 0) {
      gl.bindVertexArray(stage.transSphereVao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        this.orbitalSphereMesh.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        stage.transSphereCount
      );
    }
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  private smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private bindStageHoleUniforms(
    locs: Record<string, WebGLUniformLocation | null>,
    idx: number,
    scale: number
  ): void {
    const gl = this.gl;
    const off = this.effOffsets[idx];
    const hole = this.getHoleConfig(idx);
    gl.uniform1f(locs.uWorldScale, scale);
    gl.uniform1f(locs.uYExtrude, this.getStageExtrude(idx, this.zoom));
    gl.uniform1f(locs.uStageReveal, this.getStageReveal(idx, this.zoom));
    gl.uniform3f(locs.uStageOffset, off[0], off[1], off[2]);
    gl.uniform1f(locs.uAtomRotY, idx === 7 && this.atomParity < 0 ? 1.0 : 0.0);
    gl.uniform4f(locs.uHoleBox, hole.cx, hole.cz, hole.hx, hole.hz);
    gl.uniform1f(locs.uHoleMinY, hole.minY);
    gl.uniform1f(locs.uHoleMode, hole.mode);
    gl.uniform1f(locs.uHoleOpen, hole.open);
    gl.uniform4f(locs.uAtomHole, hole.atomX, hole.atomY, hole.atomZ, hole.atomR);
  }

  private stageNeedsDiscard(hole: HoleConfig): boolean {
    return hole.hx > 0.001 && hole.open > 0.01 && hole.mode > 0.5 && hole.mode < 3.5;
  }

  private bindShadowProgramUniforms(
    prog: WebGLProgram,
    locs: Record<string, WebGLUniformLocation | null>,
    elapsedSec: number,
    camX: number,
    camY: number,
    camZ: number
  ): void {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(locs.uLightVP, false, this.lightVPMat);
    gl.uniform1f(locs.uTime, elapsedSec);
    gl.uniform4f(locs.uMacLoads, this.smoothP, this.smoothE, this.smoothGpu, this.smoothMem);
    gl.uniform4f(locs.uCoreA, this.smoothCores[0], this.smoothCores[1], this.smoothCores[2], this.smoothCores[3]);
    gl.uniform4f(locs.uCoreB, this.smoothCores[4], this.smoothCores[5], this.smoothCores[6], this.smoothCores[7]);
    gl.uniform1f(locs.uNetLoad, this.smoothNet);
    gl.uniform1f(locs.uPulsePhase, this.pulsePhase);
    gl.uniform1f(locs.uSocTemp, this.smoothTemp);
    gl.uniform3f(locs.uCamPos, camX, camY, camZ);
  }

  private bindSceneSharedUniforms(
    prog: WebGLProgram,
    locs: Record<string, WebGLUniformLocation | null>,
    elapsedSec: number,
    camX: number,
    camY: number,
    camZ: number,
    semFactor: number,
    focusX: number,
    focusZ: number,
    focusDist: number,
    dofStrength: number,
    fogDensity: number
  ): void {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(locs.uViewProj, false, this.viewProjMat);
    gl.uniformMatrix4fv(locs.uLightVP, false, this.lightVPMat);
    gl.uniform1f(locs.uTime, elapsedSec);
    gl.uniform4f(locs.uMacLoads, this.smoothP, this.smoothE, this.smoothGpu, this.smoothMem);
    gl.uniform4f(locs.uCoreA, this.smoothCores[0], this.smoothCores[1], this.smoothCores[2], this.smoothCores[3]);
    gl.uniform4f(locs.uCoreB, this.smoothCores[4], this.smoothCores[5], this.smoothCores[6], this.smoothCores[7]);
    gl.uniform1f(locs.uNetLoad, this.smoothNet);
    gl.uniform1f(locs.uPulsePhase, this.pulsePhase);
    gl.uniform1f(locs.uSocTemp, this.smoothTemp);
    gl.uniform1i(locs.uShadowMap, 0);
    gl.uniform1f(locs.uShadowTexel, 1.0 / this.shadowSize);
    gl.uniform1i(locs.uCoinTex, 1);
    gl.uniform1i(locs.uCoinNormTex, 2);
    gl.uniform1i(locs.uMatTex, 3);
    gl.uniform1i(locs.uMatNormTex, 4);
    gl.uniform1i(locs.uDieLithoTex, 5);
    gl.uniform1i(locs.uDieNormTex, 6);
    gl.uniform1i(locs.uAbfTex, 7);
    gl.uniform1i(locs.uAbfNormTex, 8);
    gl.uniform1i(locs.uRamDecalTex, 9);
    gl.uniform1i(locs.uEnvTex, 10);
    gl.uniform4f(locs.uCoinSpec, QUARTER_X, QUARTER_Z, QUARTER_RADIUS, QUARTER_HY);
    gl.uniform2f(locs.uFocusXZ, focusX, focusZ);
    gl.uniform1f(locs.uFocusDist, focusDist);
    gl.uniform1f(locs.uDofStrength, dofStrength);
    gl.uniform1f(locs.uFogDensity, fogDensity);
    gl.uniform3f(locs.uCamPos, camX, camY, camZ);
    gl.uniform1f(locs.uZoom, this.zoom);
    gl.uniform1f(locs.uSemFactor, semFactor);
    gl.uniform1f(locs.uThermal, this.thermal ? 1.0 : 0.0);
    gl.uniform1f(locs.uTranslucent, 0.0);
    gl.uniform1f(locs.uRegionKind, this.activeRegionKind);
    gl.uniform4f(locs.uIntroLight, this.introLightSweep, this.introKeyIntensity, this.introRimBoost, this.introBeatPulse);
    gl.uniform4f(locs.uBootA, this.bootPwrRails, this.bootFabricLock, this.bootMemTrain, this.bootEcoreWake);
    gl.uniform4f(locs.uBootB, this.bootPcoreWake, this.bootGpuWake, this.bootAuxWake, this.bootActive);
  }

  private renderUnifiedScene(
    activeStages: { idx: number; scale: number }[],
    activeStageCount: number,
    nowMs: number,
    elapsedSec: number,
    camX: number,
    camY: number,
    camZ: number,
    semFactor: number,
    focusX: number,
    focusZ: number,
    focusDist: number,
    dofStrength: number,
    fogDensity: number
  ): void {
    const gl = this.gl;

    // Smart Shadow Map Caching: skip re-rendering static shadow maps at rest (0 Hz on Worlds 0-4, 15 Hz on vibrating atoms!)
    let hasAnimatedStage = false;
    let hasWorld0 = false;
    let sig = `${this.world0Version}|${Math.round(this.zoom * 200)}|${Math.round(this.anchors[0][0] * 100)},${Math.round(this.anchors[0][2] * 100)}`;
    for (let i = 0; i < activeStageCount; i++) {
      const { idx, scale } = activeStages[i];
      if (idx === 0) hasWorld0 = true;
      if (idx >= 5) hasAnimatedStage = true;
      if (scale >= 0.015 && scale <= 40.0) {
        const off = this.effOffsets[idx];
        sig += `|${idx}:${Math.round(scale * 100)}:${Math.round(off[0] * 50)},${Math.round(off[1] * 50)},${Math.round(off[2] * 50)}`;
      }
    }
    const stageChanged = sig !== this.lastShadowStageSig;
    const animTick = hasAnimatedStage && nowMs - this.lastShadowMs >= 66;
    const pCoreTick = hasWorld0 && Math.abs(this.smoothP - this.lastShadowSmoothP) > 0.045 && nowMs - this.lastShadowMs >= 140;
    const shouldRenderShadow = this.shadowDirty || stageChanged || animTick || pCoreTick;

    // 1) Unified Directional Shadow Pass (uses pure depth-only shader when no hole discard is active!)
    if (shouldRenderShadow) {
      this.shadowDirty = false;
      this.lastShadowStageSig = sig;
      this.lastShadowMs = nowMs;
      this.lastShadowSmoothP = this.smoothP;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.8, 2.5);
      gl.colorMask(false, false, false, false);

      let activeShadowProg: WebGLProgram | null = null;
      let boundSolidShadow = false;
      let boundCutoutShadow = false;

      for (let i = 0; i < activeStageCount; i++) {
        const { idx, scale } = activeStages[i];
        if (scale < 0.015 || scale > 40.0) continue;
        const hole = this.getHoleConfig(idx);
        const needsDiscard = this.stageNeedsDiscard(hole);
        const prog = needsDiscard ? this.shadowCutoutProg : this.shadowProg;
        const locs = needsDiscard ? this.uShadowCutout : this.uShadow;
        if (activeShadowProg !== prog) {
          activeShadowProg = prog;
          if ((needsDiscard && !boundCutoutShadow) || (!needsDiscard && !boundSolidShadow)) {
            this.bindShadowProgramUniforms(prog, locs, elapsedSec, camX, camY, camZ);
            if (needsDiscard) boundCutoutShadow = true;
            else boundSolidShadow = true;
          } else {
            gl.useProgram(prog);
          }
        }
        this.bindStageHoleUniforms(locs, idx, scale);
        const lensClearance =
          idx === 6
            ? this.smoothstep(1.6, 3.6, scale) * 2.45
            : idx === 8
              ? this.smoothstep(1.8, 4.5, scale) * 5.2
              : 0.0;
        gl.uniform1f(locs.uLensClearance, lensClearance);
        this.drawOpaqueStage(this.stages[idx]);
      }

      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.colorMask(true, true, true, true);
    } else {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
    }

    // 2A) Unified MSAA HDR Opaque PBR Pass — discard-free fast path preserves Apple Silicon TBDR HSR!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.hdrMain.fbo);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(0.003, 0.005, 0.009, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.coinTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.coinNormTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.matTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.matNormTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.dieLithoTex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.dieNormTex);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.abfTex);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.abfNormTex);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.ramDecalTex);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.envTex);

    let activeSceneProg: WebGLProgram | null = null;
    let boundSolidScene = false;
    let boundCutoutScene = false;

    for (let i = 0; i < activeStageCount; i++) {
      const { idx, scale } = activeStages[i];
      const stage = this.stages[idx];
      const hole = this.getHoleConfig(idx);
      const needsDiscard = this.stageNeedsDiscard(hole);
      const prog = needsDiscard ? this.sceneCutoutProg : this.sceneProg;
      const locs = needsDiscard ? this.uSceneCutout : this.uScene;

      if (activeSceneProg !== prog) {
        activeSceneProg = prog;
        if ((needsDiscard && !boundCutoutScene) || (!needsDiscard && !boundSolidScene)) {
          this.bindSceneSharedUniforms(
            prog,
            locs,
            elapsedSec,
            camX,
            camY,
            camZ,
            semFactor,
            focusX,
            focusZ,
            focusDist,
            dofStrength,
            fogDensity
          );
          if (needsDiscard) boundCutoutScene = true;
          else boundSolidScene = true;
        } else {
          gl.useProgram(prog);
        }
      }

      this.bindStageHoleUniforms(locs, idx, scale);
      gl.uniform1f(locs.uFloorY, stage.floorY);

      const lensClearance =
        idx === 6
          ? this.smoothstep(1.6, 3.6, scale) * 2.45
          : idx === 8
            ? this.smoothstep(1.8, 4.5, scale) * 5.2
            : 0.0;
      gl.uniform1f(locs.uLensClearance, lensClearance);

      const showInspect = idx === 0 && this.inspectAlpha > 0.004 && this.renderInspectBox[2] > 0.001;
      const showHover = idx === 0 && this.hoverAlpha > 0.004 && this.renderHoverBox[2] > 0.001;
      if (showInspect) {
        gl.uniform4f(
          locs.uInspectBox,
          this.renderInspectBox[0],
          this.renderInspectBox[1],
          this.renderInspectBox[2],
          this.renderInspectBox[3]
        );
      } else {
        gl.uniform4f(locs.uInspectBox, 0, 0, 0, 0);
      }
      if (showHover) {
        gl.uniform4f(
          locs.uHoverBox,
          this.renderHoverBox[0],
          this.renderHoverBox[1],
          this.renderHoverBox[2],
          this.renderHoverBox[3]
        );
      } else {
        gl.uniform4f(locs.uHoverBox, 0, 0, 0, 0);
      }
      gl.uniform4f(
        locs.uHighlightFade,
        showHover ? this.hoverAlpha : 0.0,
        showInspect ? this.inspectAlpha : 0.0,
        this.renderHoverIsRing,
        this.renderInspectIsRing
      );
      this.drawOpaqueStage(stage);
    }

    // 2B) Translucent Volumetric Quantum Orbital Pass (always uses discard-free sceneProg!)
    let hasTranslucent = false;
    for (let i = 0; i < activeStageCount; i++) {
      if (this.stages[activeStages[i].idx].transSphereCount > 0) {
        hasTranslucent = true;
        break;
      }
    }
    if (hasTranslucent) {
      if (activeSceneProg !== this.sceneProg) {
        if (!boundSolidScene) {
          this.bindSceneSharedUniforms(
            this.sceneProg,
            this.uScene,
            elapsedSec,
            camX,
            camY,
            camZ,
            semFactor,
            focusX,
            focusZ,
            focusDist,
            dofStrength,
            fogDensity
          );
          boundSolidScene = true;
        } else {
          gl.useProgram(this.sceneProg);
        }
      }
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(this.uScene.uTranslucent, 1.0);
      gl.uniform1f(this.uScene.uLensClearance, 0.0);
      gl.uniform4f(this.uScene.uInspectBox, 0, 0, 0, 0);
      gl.uniform4f(this.uScene.uHoverBox, 0, 0, 0, 0);
      gl.uniform4f(this.uScene.uHighlightFade, 0, 0, 0, 0);

      for (let i = 0; i < activeStageCount; i++) {
        const { idx, scale } = activeStages[i];
        const stage = this.stages[idx];
        if (stage.transSphereCount === 0) continue;
        this.bindStageHoleUniforms(this.uScene, idx, scale);
        gl.uniform1f(this.uScene.uFloorY, stage.floorY);
        this.drawTranslucentStage(stage);
      }

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 3) Resolve MSAA Renderbuffer -> Single Linear HDR Texture
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.hdrMain.fbo);
      gl.blitFramebuffer(
        0,
        0,
        this.canvasW,
        this.canvasH,
        0,
        0,
        this.hdrMain.w,
        this.hdrMain.h,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
  }

  /** Blit a tight CSS-space padded region between two full-res sRGB framebuffers */
  private blitCssRegion(cx: number, cy: number, hw: number, hh: number, padCss: number): void {
    const scaleX = this.canvasW / Math.max(1, this.cssW);
    const scaleY = this.canvasH / Math.max(1, this.cssH);
    const centerGlY = this.cssH - cy;
    const x0 = Math.max(0, Math.floor((cx - hw - padCss) * scaleX));
    const x1 = Math.min(this.canvasW, Math.ceil((cx + hw + padCss) * scaleX));
    const y0 = Math.max(0, Math.floor((centerGlY - hh - padCss) * scaleY));
    const y1 = Math.min(this.canvasH, Math.ceil((centerGlY + hh + padCss) * scaleY));
    if (x1 > x0 && y1 > y0) {
      this.gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, this.gl.COLOR_BUFFER_BIT, this.gl.NEAREST);
    }
  }

  /** Draw tight screen-space quads for Liquid Glass (~2% of pixels instead of 200% full-screen!) */
  private renderLiquidGlass(elapsedSec: number): void {
    const gl = this.gl;

    // Smooth fluid viscosity decay for pointer surface interaction
    this.glassPointerVelX *= 0.84;
    this.glassPointerVelY *= 0.84;
    if (Math.abs(this.glassPointerVelX) < 0.01) this.glassPointerVelX = 0;
    if (Math.abs(this.glassPointerVelY) < 0.01) this.glassPointerVelY = 0;

    // 0) Composite Retina Vernier Strip (ticks + words) directly into srgbA BEFORE Liquid Glass
    //    so the rounded Liquid Glass magnifier pill genuinely refracts, bends & prismatically disperses the letters!
    if (this.vernierTex && this.vernierAlpha > 0.005 && this.vernierRect[2] > 1 && this.vernierRect[3] > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.srgbA.fbo);
      gl.viewport(0, 0, this.canvasW, this.canvasH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.vernierProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.vernierTex);
      gl.uniform1i(this.uVernier.uTex, 0);
      gl.uniform2f(this.uVernier.uCssSize, this.cssW, this.cssH);
      gl.uniform4f(
        this.uVernier.uVernierRect,
        this.vernierRect[0],
        this.vernierRect[1],
        this.vernierRect[2],
        this.vernierRect[3]
      );
      gl.uniform4f(
        this.uVernier.uTexParams,
        this.vernierTexOriginCss,
        this.vernierPitchCss,
        this.vernierTexWidthCss,
        this.zoom
      );
      gl.uniform4f(this.uVernier.uFadeParams, this.vernierLoupeHalfW, this.vernierAlpha, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }

    // 1) Hardware-blit full crisp composite scene (including Vernier strip!) srgbA -> default screen framebuffer
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.srgbA.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      this.canvasW,
      this.canvasH,
      0,
      0,
      this.canvasW,
      this.canvasH,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST
    );

    if (this.glassCount === 0) return;

    const drawStageQuads = (targetStage: 0 | 1) => {
      const pad = targetStage === 1 ? 20.0 : 36.0;
      for (let i = 0; i < this.glassCount; i++) {
        const o = i * 4;
        const p3 = this.glassParams[o + 3];
        const rawStyle = Math.floor(p3 * 0.25);
        const style = Math.round(rawStyle);
        const alpha = p3 - rawStyle * 4.0;
        if (alpha < 0.005) continue;
        const isElev = style >= 2;
        if (targetStage === 0 && isElev) continue;
        if (targetStage === 1 && !isElev) continue;
        gl.uniform4f(
          this.uLiquid.uGlassRect,
          this.glassRects[o],
          this.glassRects[o + 1],
          this.glassRects[o + 2],
          this.glassRects[o + 3]
        );
        gl.uniform4f(
          this.uLiquid.uGlassParams,
          this.glassParams[o],
          this.glassParams[o + 1],
          this.glassParams[o + 2],
          p3
        );
        gl.uniform1f(this.uLiquid.uQuadPad, pad);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };

    const bindLiquidShared = () => {
      gl.useProgram(this.liquidGlProg);
      gl.uniform2f(this.uLiquid.uResolution, this.canvasW, this.canvasH);
      gl.uniform2f(this.uLiquid.uCssSize, this.cssW, this.cssH);
      gl.uniform1f(this.uLiquid.uTime, elapsedSec);
      gl.uniform4f(
        this.uLiquid.uPointerFluid,
        this.glassPointerX,
        this.glassPointerY,
        this.glassPointerVelX * this.glassPointerActive,
        this.glassPointerVelY * this.glassPointerActive
      );
      gl.uniform1i(this.uLiquid.uTex, 0);
    };

    if (!this.glassHasElevated) {
      // Single-stage: draw Stage 0 glass quads directly onto screen reading srgbA
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvasW, this.canvasH);
      bindLiquidShared();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srgbA.tex);
      drawStageQuads(0);
      return;
    }

    // Two-stage stacked droplets: seed ONLY the small needed patches of srgbB from srgbA
    const refractMargin = Math.ceil(Math.min(this.cssW, this.cssH) * 0.10) + 28;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.srgbA.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.srgbB.fbo);
    for (let i = 0; i < this.glassCount; i++) {
      const o = i * 4;
      const p3 = this.glassParams[o + 3];
      const rawStyle = Math.floor(p3 * 0.25);
      const style = Math.round(rawStyle);
      const alpha = p3 - rawStyle * 4.0;
      if (alpha < 0.005) continue;
      this.blitCssRegion(
        this.glassRects[o],
        this.glassRects[o + 1],
        this.glassRects[o + 2],
        this.glassRects[o + 3],
        style >= 2 ? refractMargin : 36.0
      );
    }

    // Draw Stage 0 base glass quads into srgbB (sampling srgbA)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.srgbB.fbo);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    bindLiquidShared();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srgbA.tex);
    drawStageQuads(0);

    // Blit just the rendered Stage 0 glass rects from srgbB -> screen
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.srgbB.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    for (let i = 0; i < this.glassCount; i++) {
      const o = i * 4;
      const p3 = this.glassParams[o + 3];
      const rawStyle = Math.floor(p3 * 0.25);
      const style = Math.round(rawStyle);
      const alpha = p3 - rawStyle * 4.0;
      if (alpha < 0.005 || style >= 2) continue;
      this.blitCssRegion(
        this.glassRects[o],
        this.glassRects[o + 1],
        this.glassRects[o + 2],
        this.glassRects[o + 3],
        36.0
      );
    }

    // Draw Stage 1 elevated droplet & magnifier quads directly onto screen (sampling srgbB!)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srgbB.tex);
    drawStageQuads(1);
  }

  private loop = (): void => {
    if (this.disposed || this.pageHidden || this.contextLost) {
      this.rafId = 0;
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    if (this.introAwaitingBoot) {
      if (this.introHoldRendered) {
        return;
      }
      this.introHoldRendered = true;
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvasW, this.canvasH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const hoverDistinctNow = this.hasHover && (!this.hasInspect || this.hoverId !== this.inspectId);
    const idleAgeMs = now - this.lastActivityMs;
    const isMoving =
      this.introActive ||
      this.tourActive ||
      this.flightActive ||
      this.dragging ||
      this.autoOrbit ||
      this.burstActive ||
      this.pendingTexUploads.length > 0 ||
      Math.abs(this.targetZoom - this.zoom) > 0.0002 ||
      Math.abs(this.targetYaw - this.yaw) > 0.0002 ||
      Math.abs(this.targetPitch - this.pitch) > 0.0002 ||
      Math.abs(this.targetAnchor0[0] - this.anchors[0][0]) > 0.0004 ||
      Math.abs(this.targetAnchor0[1] - this.anchors[0][2]) > 0.0004 ||
      Math.abs(this.smoothCamShiftX) > 0.0004 ||
      Math.abs(this.smoothCamShiftY) > 0.0004 ||
      Math.abs(this.smoothCamShiftZ) > 0.0004 ||
      this.bootActive > 0.002 ||
      this.introBeatPulse > 0.002 ||
      (this.hasInspect && this.inspectAlpha < 0.996) ||
      (!this.hasInspect && this.inspectAlpha > 0.002) ||
      (hoverDistinctNow && this.hoverAlpha < 0.996) ||
      (!hoverDistinctNow && this.hoverAlpha > 0.002) ||
      Math.abs(this.glassPointerVelX) > 0.03 ||
      Math.abs(this.glassPointerVelY) > 0.03;

    const needsFullRate = isMoving || idleAgeMs < IDLE_HOLD_MS;
    this.isIdlePaced = !needsFullRate;
    if (!needsFullRate) {
      const minInterval = !this.windowFocused
        ? BLURRED_FRAME_MS
        : idleAgeMs < COOLDOWN_END_MS
          ? COOLDOWN_FRAME_MS
          : IDLE_FRAME_MS;
      if (now - this.lastRenderMs < minInterval) {
        return;
      }
    }
    this.lastRenderMs = now;

    const rawDtMs = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(0.10, Math.max(0.001, rawDtMs / 1000));
    const elapsedSec = (now - this.startTime) / 1000;

    if (rawDtMs > 0.5 && rawDtMs < 150) {
      this.emaFrameMs = this.emaFrameMs * 0.9 + rawDtMs * 0.1;
    }

    // Smooth live Mac telemetry
    const lr = 1 - Math.exp(-5.0 * dt);
    this.smoothP += (this.telemetry.pCoreAvg - this.smoothP) * lr;
    this.smoothE += (this.telemetry.eCoreAvg - this.smoothE) * lr;
    this.smoothGpu += (this.telemetry.gpuEst - this.smoothGpu) * lr;
    this.smoothMem += (this.telemetry.memRatio - this.smoothMem) * lr;
    const targetNet = Math.min(1, Math.log1p(this.telemetry.netKBps) / 7.5);
    this.smoothNet += (targetNet - this.smoothNet) * lr;
    const rawTemp = this.telemetry.socTempC !== null ? (this.telemetry.socTempC - 25) / 60 : 0.45;
    const targetTemp = Math.max(0.05, Math.min(1.2, rawTemp));
    this.smoothTemp += (targetTemp - this.smoothTemp) * lr;

    const eOff = Math.min(this.telemetry.eCoreCount, Math.max(0, this.telemetry.coreLoads.length - this.dieSpec.pCores));
    for (let i = 0; i < 8; i++) {
      const targetC = this.telemetry.coreLoads[eOff + i] ?? this.telemetry.pCoreAvg;
      this.smoothCores[i] += (targetC - this.smoothCores[i]) * lr;
    }

    const pulseSpeed = 0.28 + this.smoothP * 0.72 + this.smoothNet * 0.55;
    this.pulsePhase += dt * pulseSpeed;

    // Smooth continuous World 0 die anchor & smooth camera pan decay
    const a0Factor = 1 - Math.exp(-8.5 * dt);
    this.anchors[0][0] += (this.targetAnchor0[0] - this.anchors[0][0]) * a0Factor;
    this.anchors[0][2] += (this.targetAnchor0[1] - this.anchors[0][2]) * a0Factor;
    this.recomputeEffOffsets();

    const shiftDecay = Math.exp(-7.5 * dt);
    this.smoothCamShiftX *= shiftDecay;
    this.smoothCamShiftY *= shiftDecay;
    this.smoothCamShiftZ *= shiftDecay;

    // Beat-Locked "Cold Boot": Title on Black -> Dark Unpowered Silhouette Build -> MAJOR BEAT Ignition & Crane-Up!
    const prevZ = this.zoom;
    const prevYaw = this.yaw;
    if (this.introActive) {
      const cues = this.introCues;
      const audioClock = this.hooks.getIntroClockSec?.() ?? null;
      if (audioClock !== null && audioClock >= 0) {
        // Lock tightly to Web Audio hardware sample clock so visuals & music never drift on frame hitches!
        const nextDt = this.introElapsed + dt;
        const drift = audioClock - nextDt;
        if (Math.abs(drift) > 0.045) {
          this.introElapsed = Math.max(this.introElapsed, audioClock);
        } else {
          this.introElapsed = Math.max(this.introElapsed, nextDt + drift * 0.38);
        }
      } else {
        this.introElapsed += dt;
      }

      const t = this.introElapsed;
      const progress = clamp(t / cues.durationSec, 0, 1);

      // Smooth musical beat envelope (fast smoothstep attack -> clean exponential decay)
      const beatEnv = (beatSec: number, attack = 0.026, decay = 0.30): number => {
        const dtB = t - beatSec;
        if (dtB <= 0 || dtB > decay * 4.8) return 0;
        const a = clamp(dtB / attack, 0, 1);
        const rise = a * a * (3 - 2 * a);
        return rise * Math.exp(-Math.max(0, dtB - attack) / decay);
      };

      // Rhythmic rim-glint & subtle optical breath strictly on bass-thump build beats (damped cleanly during pre-drop inhale!)
      const preDropHush = 1.0 - this.smoothstep(cues.preDropSec, cues.preDropSec + 0.14, t);
      let buildPulse = 0;
      const pulseCount = cues.pulseBeats.length;
      for (let i = 0; i < pulseCount; i++) {
        const w = 0.42 + (pulseCount > 1 ? (i / (pulseCount - 1)) * 0.42 : 0.35);
        buildPulse += beatEnv(cues.pulseBeats[i], 0.036, 0.32) * w;
      }
      buildPulse = clamp(buildPulse, 0, 0.86) * preDropHush;

      const dropPulse = beatEnv(cues.dropSec, 0.02, 0.56);
      const bloomPulse = beatEnv(cues.bloomSec, 0.026, 0.42);
      this.introBeatPulse = clamp(buildPulse + dropPulse * 1.15 + bloomPulse * 0.45, 0, 1.45);

      // C1-smooth musical camera choreography:
      //   1. revealSec -> riseSec: slow sculptural horizon emergence (unpowered dark silhouette)
      //   2. riseSec -> preDropSec: deliberate tension crane-up while chip remains DARK & unpowered
      //   3. preDropSec -> dropSec: poised suspense breath right before the drop
      //   4. dropSec -> lockSec: authoritative kinetic surge up into hero framing on the MAJOR BEAT!
      const uEmerge = this.smootherstep(cues.revealSec, cues.riseSec, t);
      const uBuild = this.smootherstep(cues.riseSec, cues.preDropSec, t);
      const dropSpan = Math.max(0.45, cues.lockSec + 0.26 - cues.dropSec);
      const rawDrop = clamp((t - cues.dropSec) / dropSpan, 0, 1);
      const uDrop = (1.0 - Math.pow(1.0 - rawDrop, 3.1)) * this.smoothstep(0.0, 0.055, rawDrop);

      const midPitch = INTRO_START_PITCH + 0.33;
      const midZoom = INTRO_START_ZOOM + 0.28;
      const beatZoomBreath = buildPulse * 0.008 + dropPulse * 0.022;

      this.yaw = HERO_YAW;
      this.pitch = INTRO_START_PITCH + 0.03 * uEmerge + 0.30 * uBuild + (HERO_PITCH - midPitch) * uDrop;
      this.zoom = INTRO_START_ZOOM + 0.06 * uEmerge + 0.22 * uBuild + (HERO_ZOOM - midZoom) * uDrop + beatZoomBreath;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
      this.targetZoom = this.zoom;

      // Delayed Studio Lighting:
      //   - Pure #000 under the title card -> moody dark obsidian silhouette during build
      //   - Brief suspense hush during preDropSec -> dropSec
      //   - Studio key softbox floods & sweeps dramatically across the bare silicon RIGHT ON dropSec!
      const fadeInOff = uEmerge * 0.72;
      const buildExpLift = uBuild * 0.07;
      const preDropDip =
        this.smootherstep(cues.preDropSec, cues.dropSec, t) * (1.0 - this.smoothstep(cues.dropSec, cues.dropSec + 0.05, t));
      const lightSpan = Math.max(0.35, cues.lockSec - cues.dropSec);
      const rawDropLight = clamp((t - cues.dropSec) / lightSpan, 0, 1);
      const dropLight = (1.0 - Math.pow(1.0 - rawDropLight, 3.0)) * this.smoothstep(0.0, 0.045, rawDropLight);

      this.introExposure = clamp(
        fadeInOff + buildExpLift - preDropDip * 0.045 + (1.0 - 0.79) * dropLight + dropPulse * 0.05,
        0.0,
        1.05
      );
      this.introLightSweep = 0.18 + 0.12 * uBuild + 0.70 * uDrop;
      this.introKeyIntensity = clamp(0.045 + 0.065 * uBuild - preDropDip * 0.035 + (1.0 - 0.11) * dropLight, 0.02, 1.0);
      this.introRimBoost = 0.48 + 0.24 * uBuild + 0.28 * dropLight;
      this.introFogBoost = 0.032 * (1.0 - dropLight);
      this.introDofBoost = 0.0;

      // Delayed Hardware Power-On Cascade — stays 100% DARK until THE MAJOR BEAT (dropSec)!
      //   On dropSec (Major Beat): V_DD amber power rails -> Coherent Fabric & 48 MB SLC -> LPDDR5 45° training bursts
      //   On bloomSec (Next Beat): E-Cores -> P-Cores P0..P7 stagger -> GPU Array sweep -> ANE / Media / I/O PHY
      const beatLen = Math.max(0.45, cues.bloomSec - cues.dropSec);
      const dtDrop = t - cues.dropSec;
      this.bootPwrRails = clamp(dtDrop / (beatLen * 1.05), 0, 1);
      this.bootFabricLock = clamp((dtDrop - beatLen * 0.06) / (beatLen * 1.15), 0, 1);
      this.bootMemTrain = clamp((dtDrop - beatLen * 0.28) / (beatLen * 1.15), 0, 1);
      this.bootEcoreWake = clamp((t - (cues.bloomSec - beatLen * 0.18)) / (beatLen * 0.85), 0, 1);
      this.bootPcoreWake = clamp((t - cues.bloomSec) / (beatLen * 1.35), 0, 1);
      this.bootGpuWake = clamp((t - (cues.bloomSec + beatLen * 0.24)) / (beatLen * 1.25), 0, 1);
      this.bootAuxWake = clamp((t - (cues.bloomSec + beatLen * 0.48)) / (beatLen * 1.10), 0, 1);
      this.bootActive = 1.0 - this.smootherstep(cues.lockSec + beatLen * 0.45, cues.durationSec - 0.10, t);

      if (t >= cues.durationSec) {
        this.introActive = false;
        this.zoom = this.targetZoom = HERO_ZOOM;
        this.pitch = this.targetPitch = HERO_PITCH;
        this.yaw = this.targetYaw = HERO_YAW;
        this.introLightSweep = 1.0;
        this.introKeyIntensity = 1.0;
        this.introRimBoost = 1.0;
        this.introBeatPulse = 0.0;
        this.introFogBoost = 0.0;
        this.introExposure = 1.0;
        this.introDofBoost = 0.0;
        this.bootPwrRails = 1.0;
        this.bootFabricLock = 1.0;
        this.bootMemTrain = 1.0;
        this.bootEcoreWake = 1.0;
        this.bootPcoreWake = 1.0;
        this.bootGpuWake = 1.0;
        this.bootAuxWake = 1.0;
        this.bootActive = 0.0;
        this.kickoffDeferredHighResTextures();
        this.hooks.onIntroFrame?.({ active: false, progress: 1, elapsed: cues.durationSec });
      } else {
        this.hooks.onIntroFrame?.({ active: true, progress, elapsed: t });
      }
    } else {
      // Flush at most 1 deferred high-res photographic texture upload per frame (zero micro-stutter!)
      if (this.pendingTexUploads.length > 0) {
        const upload = this.pendingTexUploads.shift();
        upload?.();
      }
      // Smoothly settle any interrupted intro lighting/boot rails back to live steady state (zero harsh snap on skip!)
      const settle = 1 - Math.exp(-8.5 * dt);
      this.introLightSweep += (1.0 - this.introLightSweep) * settle;
      this.introKeyIntensity += (1.0 - this.introKeyIntensity) * settle;
      this.introRimBoost += (1.0 - this.introRimBoost) * settle;
      this.introBeatPulse += (0.0 - this.introBeatPulse) * settle;
      if (this.introBeatPulse < 0.002) {
        this.introBeatPulse = 0.0;
      }
      this.introFogBoost += (0.0 - this.introFogBoost) * settle;
      this.introExposure += (1.0 - this.introExposure) * settle;
      this.introDofBoost += (0.0 - this.introDofBoost) * settle;
      this.bootPwrRails += (1.0 - this.bootPwrRails) * settle;
      this.bootFabricLock += (1.0 - this.bootFabricLock) * settle;
      this.bootMemTrain += (1.0 - this.bootMemTrain) * settle;
      this.bootEcoreWake += (1.0 - this.bootEcoreWake) * settle;
      this.bootPcoreWake += (1.0 - this.bootPcoreWake) * settle;
      this.bootGpuWake += (1.0 - this.bootGpuWake) * settle;
      this.bootAuxWake += (1.0 - this.bootAuxWake) * settle;
      this.bootActive += (0.0 - this.bootActive) * settle;
      if (this.bootActive < 0.002) {
        this.bootActive = 0.0;
      }

      // Cinematic Dive keyframed choreography (Scale -> Hottest P-Core -> BEOL -> FEOL -> Gate -> Lattice -> Atom -> Nucleus -> Quarks)
      if (this.tourActive) {
        this.tourElapsed += dt;
        const totalDur = TOUR_KEYS[TOUR_KEYS.length - 1][0];
        if (this.tourElapsed >= totalDur) {
          this.stopTour();
        } else {
          let seg = 0;
          while (seg < TOUR_KEYS.length - 2 && this.tourElapsed > TOUR_KEYS[seg + 1][0]) seg++;
          const k0 = TOUR_KEYS[seg];
          const k1 = TOUR_KEYS[seg + 1];
          const u = clamp((this.tourElapsed - k0[0]) / Math.max(0.001, k1[0] - k0[0]), 0, 1);
          const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
          this.targetZoom = k0[1] + (k1[1] - k0[1]) * s;
          this.targetPitch = k0[2] + (k1[2] - k0[2]) * s;
          this.targetYaw = this.tourBaseYaw + (k0[3] + (k1[3] - k0[3]) * s);
          this.zoomRate = 4.6;
        }
      }

      // Motorized quintic-eased optical objective flight (zero initial velocity kick, buttery arrival!)
      if (this.flightActive) {
        this.flightElapsed += dt;
        const u = clamp(this.flightElapsed / Math.max(0.05, this.flightDuration), 0, 1);
        const s = this.smootherstep(0, 1, u);
        this.zoom = this.flightStartZoom + (this.flightEndZoom - this.flightStartZoom) * s;

        // Blend with natural intermediate scale pitch during multi-stop dives so camera arcs gracefully through layers
        const [midPitch] = this.getCameraPoseForZoom(this.zoom);
        const directPitch = this.flightStartPitch + (this.flightEndPitch - this.flightStartPitch) * s;
        const arcBlend = Math.sin(Math.PI * u) * clamp((Math.abs(this.flightEndZoom - this.flightStartZoom) - 1.2) / 3.0, 0, 0.55);
        this.pitch = directPitch + (midPitch - directPitch) * arcBlend;
        this.yaw = this.flightStartYaw + (this.flightEndYaw - this.flightStartYaw) * s;

        if (this.flightHasAnchor) {
          this.anchors[0][0] = this.flightStartAnchorX + (this.flightEndAnchorX - this.flightStartAnchorX) * s;
          this.anchors[0][2] = this.flightStartAnchorZ + (this.flightEndAnchorZ - this.flightStartAnchorZ) * s;
          this.recomputeEffOffsets();
        }

        this.targetZoom = this.zoom;
        this.targetPitch = this.pitch;
        this.targetYaw = this.yaw;

        if (u >= 1.0) {
          this.flightActive = false;
          this.zoom = this.targetZoom = this.flightEndZoom;
          this.pitch = this.targetPitch = this.flightEndPitch;
          this.yaw = this.targetYaw = this.flightEndYaw;
        }
      } else {
        // Frame-rate-independent snappy zoom & optical motion tracking
        const zFactor = 1 - Math.exp(-this.zoomRate * dt);
        this.zoom += (this.targetZoom - this.zoom) * zFactor;
        if (Math.abs(this.targetZoom - this.zoom) < 0.00015) {
          this.zoom = this.targetZoom;
        }

        if (this.autoOrbit && !this.dragging && !this.tourActive) {
          this.targetYaw += dt * 0.075;
        }
        const rotRate = this.dragging ? 14.0 : this.tourActive ? 3.8 : 6.0;
        const rotFactor = 1 - Math.exp(-rotRate * dt);
        this.yaw += (this.targetYaw - this.yaw) * rotFactor;
        this.pitch += (this.targetPitch - this.pitch) * rotFactor;
      }
    }

    const zoomVel = this.introActive ? 0.0 : Math.abs(this.zoom - prevZ) / dt;
    const yawVel = this.introActive ? 0.0 : (this.yaw - prevYaw) / dt;
    const targetMotion = Math.min(1.0, zoomVel * 0.20);
    this.smoothMotion += (targetMotion - this.smoothMotion) * (1 - Math.exp(-14.0 * dt));

    // Track active functional die region (zero-allocation fast check: 0 = Logic/CPU, 1 = SRAM/SLC, 2 = GPU)
    this.activeRegionKind = getDieRegionKind(this.anchors[0][0], this.anchors[0][2]);

    const fps = Math.round(1000 / Math.max(4, this.emaFrameMs));
    this.hooks.onZoomFrame(
      this.zoom,
      fps,
      this.smoothMotion,
      this.dragging || this.tourActive,
      yawVel,
      this.activeRegionKind
    );

    // Compute exact continuous log-scale for EVERY nested world (0..9) relative to current zoom z
    const z = Math.max(0, Math.min(MAX_ZOOM, this.zoom));
    const idx = Math.min(STAGE_RATIOS.length - 1, Math.floor(z));
    const f = z >= MAX_ZOOM ? 1.0 : z - idx;
    const logCamScale = LOG_CUM_SCALE[idx] * (1.0 - f) + LOG_CUM_SCALE[idx + 1] * f;
    const semFactor = this.smoothstep(0.9, 2.1, z);

    for (let k = 0; k < this.stages.length; k++) {
      this.stageScales[k] = Math.exp(logCamScale - LOG_CUM_SCALE[k]);
    }
    this.world0Scale = this.stageScales[0];
    if (this.hasInspect && z > 0.85) {
      this.clearInspect();
    }
    if (this.hasHover && z > 0.85) {
      this.clearHover();
    }

    // Smooth optical focus & corner-bracket fade transitions (zero jarring snap on hover/inspect)
    const targetInspectAlpha = this.hasInspect ? 1.0 : 0.0;
    const inspectRate = this.hasInspect ? 12.0 : 10.0;
    if (this.hasInspect) {
      const nextRing = this.inspectId === 'smd-caps' ? 1 : 0;
      const sameShape =
        this.inspectAlpha > 0.02 &&
        (this.inspectBox[3] < 0) === (this.renderInspectBox[3] < 0) &&
        nextRing === this.renderInspectIsRing;
      this.renderInspectIsRing = nextRing;
      if (sameShape) {
        const kBox = 1.0 - Math.exp(-18.0 * dt);
        for (let c = 0; c < 4; c++) {
          this.renderInspectBox[c] += (this.inspectBox[c] - this.renderInspectBox[c]) * kBox;
        }
      } else {
        this.renderInspectBox[0] = this.inspectBox[0];
        this.renderInspectBox[1] = this.inspectBox[1];
        this.renderInspectBox[2] = this.inspectBox[2];
        this.renderInspectBox[3] = this.inspectBox[3];
      }
    }
    this.inspectAlpha += (targetInspectAlpha - this.inspectAlpha) * (1.0 - Math.exp(-inspectRate * dt));
    if (this.inspectAlpha < 0.002 && !this.hasInspect) this.inspectAlpha = 0.0;

    const hoverDistinct = this.hasHover && (!this.hasInspect || this.hoverId !== this.inspectId);
    const targetHoverAlpha = hoverDistinct ? 1.0 : 0.0;
    const hoverRate = hoverDistinct ? 16.0 : 11.0;
    if (hoverDistinct) {
      const nextRing = this.hoverId === 'smd-caps' ? 1 : 0;
      const sameShape =
        this.hoverAlpha > 0.02 &&
        (this.hoverBox[3] < 0) === (this.renderHoverBox[3] < 0) &&
        nextRing === this.renderHoverIsRing;
      this.renderHoverIsRing = nextRing;
      if (sameShape) {
        const kBox = 1.0 - Math.exp(-26.0 * dt);
        for (let c = 0; c < 4; c++) {
          this.renderHoverBox[c] += (this.hoverBox[c] - this.renderHoverBox[c]) * kBox;
        }
      } else {
        this.renderHoverBox[0] = this.hoverBox[0];
        this.renderHoverBox[1] = this.hoverBox[1];
        this.renderHoverBox[2] = this.hoverBox[2];
        this.renderHoverBox[3] = this.hoverBox[3];
      }
    }
    this.hoverAlpha += (targetHoverAlpha - this.hoverAlpha) * (1.0 - Math.exp(-hoverRate * dt));
    if (this.hoverAlpha < 0.002 && !hoverDistinct) this.hoverAlpha = 0.0;

    // Smooth camera framing:
    //   - At Die (z = 0) and Scale (z < 0), stays centered on the chip package (with the US Quarter off to the side)
    //   - As you dive into an inspected die block (z: 0.02 -> 0.68), glides monotonically onto anchor[0] without overshoot
    //   - At deeper scales (z >= 0.7), locks onto the nested floating origin (0,0,0) + smooth pan glide!
    const aspect = this.canvasW / Math.max(1, this.canvasH);
    const outT = Math.max(0.0, -this.zoom);
    const macroOut = this.smoothstep(0.0, -0.85, this.zoom);
    const diveFocus = this.smoothstep(0.02, 0.68, this.zoom);
    const heroFrameMask = (1.0 - diveFocus) * (1.0 - macroOut);
    const heroLookZ = 0.72 * heroFrameMask;

    const lookX = -this.effOffsets[0][0] * (1.0 - diveFocus) + this.smoothCamShiftX;
    const lookY = this.smoothCamShiftY;
    const lookZ = -this.effOffsets[0][2] * (1.0 - diveFocus) + this.smoothCamShiftZ + heroLookZ;

    const aspectBoost = Math.max(1.0, 1.62 / Math.max(0.85, aspect));
    // Portrait & narrow-viewport framing boost (1.0 on desktop/landscape >= 1.18 aspect; pulls back cleanly on phones!)
    const portraitRatio = Math.max(0.0, 1.18 / Math.max(0.44, aspect) - 1.0);
    const portraitDieBoost = Math.min(2.15, 1.0 + portraitRatio * 0.72);
    const portraitDeepBoost = Math.min(1.62, 1.0 + portraitRatio * 0.38);
    const portraitScaleBoost = Math.min(1.65, 1.0 + portraitRatio * 0.42);
    const subatomicBackoff = this.smoothstep(7.6, 8.2, this.zoom);
    const heroDist = 11.2;
    const zoomBlend = this.smoothstep(0.0, 0.95, this.zoom);
    const portraitZoomFactor = portraitDieBoost + (portraitDeepBoost - portraitDieBoost) * zoomBlend;
    const dist =
      this.zoom < 0
        ? heroDist *
          Math.pow(2.55, outT) *
          (1.0 + 0.25 * macroOut) *
          (1.0 + (aspectBoost - 1.0) * Math.min(1.0, outT)) *
          (portraitDieBoost + (portraitScaleBoost - portraitDieBoost) * Math.min(1.0, outT))
        : (heroDist + (5.4 - heroDist) * zoomBlend + subatomicBackoff * 1.15) *
          portraitZoomFactor *
          (1.0 + (aspectBoost - 1.0) * subatomicBackoff * 0.35);
    const cp = Math.cos(this.pitch);
    const camX = lookX + Math.sin(this.yaw) * cp * dist;
    const camY = lookY + Math.sin(this.pitch) * dist;
    const camZ = lookZ + Math.cos(this.yaw) * cp * dist;

    const fovY = 2.0 * Math.atan(0.5 / 1.68);
    const nearClip = Math.max(0.10, dist * 0.015);
    const farClip = Math.max(110.0, dist * 3.5);
    mat4Perspective(this.projMat, fovY, aspect, nearClip, farClip);
    mat4LookAt(this.viewMat, camX, camY, camZ, lookX, lookY, lookZ, 0, 1, 0);
    mat4Multiply(this.viewProjMat, this.projMat, this.viewMat);

    this.updateLightMatrix(lookX, lookZ, 7.2 + macroOut * 8.6);
    const fogDensity = 0.0082 * Math.pow(0.10, outT) + this.introFogBoost;

    // Collect all physically visible nested scales (zero per-frame array/object allocation!)
    const distLogAdj = Math.log(5.4 / Math.max(5.4, dist));
    let activeStageCount = 0;
    for (let k = 0; k < this.stages.length; k++) {
      if (!this.isStageRevealed(k, this.zoom)) continue;
      const logS = logCamScale - LOG_CUM_SCALE[k];
      const minLogS = k === 8 ? -7.2 : -6.0;
      if (logS + distLogAdj > minLogS && logS < 4.75) {
        const entry = this.activeStagesBuf[activeStageCount++];
        entry.idx = k;
        entry.scale = this.stageScales[k];
      }
    }

    // Optical microscope DOF aperture: tack-sharp across the chip plane on World 0, creamy bokeh at deep oblique angles & intro silhouette
    const angleFactor = 1.0 - this.smoothstep(0.95, 1.48, this.pitch);
    const microDepth = this.smoothstep(0.25, 1.25, this.zoom);
    const scaleDof = 1.0 - 0.55 * this.smoothstep(5.8, 7.2, this.zoom);
    const dofStrength = clamp(
      ((0.06 + 0.26 * angleFactor) + microDepth * (0.04 + 0.18 * angleFactor)) * scaleDof + this.introDofBoost,
      0.0,
      0.92
    );

    const gl = this.gl;

    // Poll non-blocking hardware GPU timer queries (EXT_disjoint_timer_query_webgl2)
    this.pollGpuTimerQueries();
    let activeGpuQuery: WebGLQuery | null = null;
    if (this.timerQueryExt && this.pendingGpuQueries.length < 3) {
      const q = gl.createQuery();
      if (q) {
        gl.beginQuery(this.timerQueryExt.TIME_ELAPSED_EXT, q);
        activeGpuQuery = q;
      }
    }

    // PASS 0 + 1: Unified Multi-Scale 3D Render (ZERO 2D fading!)
    this.renderUnifiedScene(
      this.activeStagesBuf,
      activeStageCount,
      now,
      elapsedSec,
      camX,
      camY,
      camZ,
      semFactor,
      lookX,
      lookZ,
      dist,
      dofStrength,
      fogDensity
    );

    // PASS 2: Fast 3-Level Dual-Kawase Bloom
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);

    const d0 = this.bloomDown[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, d0.fbo);
    gl.viewport(0, 0, d0.w, d0.h);
    gl.useProgram(this.prefilterProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrMain.tex);
    gl.uniform1i(this.uPrefilter.uTex, 0);
    gl.uniform2f(this.uPrefilter.uTexelSize, 1.0 / this.canvasW, 1.0 / this.canvasH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.bloomDownProg);
    for (let i = 1; i < this.bloomDown.length; i++) {
      const src = this.bloomDown[i - 1];
      const dst = this.bloomDown[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.uDown.uTex, 0);
      gl.uniform2f(this.uDown.uHalfPixel, 0.5 / src.w, 0.5 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.useProgram(this.bloomUpProg);
    {
      const src = this.bloomDown[2];
      const dst = this.bloomUp[0];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.uUp.uTex, 0);
      gl.uniform2f(this.uUp.uHalfPixel, 0.5 / src.w, 0.5 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    {
      const src = this.bloomUp[0];
      const dst = this.bloomUp[1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.uUp.uTex, 0);
      gl.uniform2f(this.uUp.uHalfPixel, 0.5 / src.w, 0.5 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // PASS 3A: Full-Retina ACES Optical Composite -> Screen (or srgbA when liquidGL HUD or Vernier strip is active)
    const hasVernier = this.vernierTex !== null && this.vernierAlpha > 0.005;
    const runGlass = (this.glassCount > 0 || hasVernier) && this.srgbA && this.srgbB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, runGlass ? this.srgbA.fbo : null);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrMain.tex);
    gl.uniform1i(this.uComp.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomUp[1].tex);
    gl.uniform1i(this.uComp.uBloomTex, 1);
    gl.uniform2f(this.uComp.uResolution, this.canvasW, this.canvasH);
    gl.uniform1f(this.uComp.uMotion, this.smoothMotion);
    gl.uniform1f(this.uComp.uTime, elapsedSec);
    const voidPlunge = Math.exp(-Math.pow((this.zoom - 7.52) / 0.28, 2));
    gl.uniform1f(this.uComp.uVoidPlunge, voidPlunge);
    gl.uniform1f(this.uComp.uIntroExposure, this.introExposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // PASS 3B & 3C: Tight Per-Region Quad sRGB liquidGL Refraction + Stacked Droplet Lenses -> Screen
    if (runGlass) {
      this.renderLiquidGlass(elapsedSec);
    }

    if (activeGpuQuery && this.timerQueryExt) {
      gl.endQuery(this.timerQueryExt.TIME_ELAPSED_EXT);
      this.pendingGpuQueries.push(activeGpuQuery);
    }
  };

  public dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('gesturestart', this.onSafariGesture);
    this.canvas.removeEventListener('gesturechange', this.onSafariGesture);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);

    const gl = this.gl;
    for (const q of this.pendingGpuQueries) {
      gl.deleteQuery(q);
    }
    this.pendingGpuQueries = [];
    this.destroyRenderTargets();
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.shadowTex);
    gl.deleteTexture(this.coinTex);
    gl.deleteTexture(this.coinNormTex);
    gl.deleteTexture(this.matTex);
    gl.deleteTexture(this.matNormTex);
    gl.deleteTexture(this.dieLithoTex);
    gl.deleteTexture(this.dieNormTex);
    gl.deleteTexture(this.abfTex);
    gl.deleteTexture(this.abfNormTex);
    gl.deleteTexture(this.ramDecalTex);
    gl.deleteTexture(this.envTex);
    if (this.vernierTex) {
      gl.deleteTexture(this.vernierTex);
      this.vernierTex = null;
    }
    gl.deleteBuffer(this.boxVbo);
    gl.deleteBuffer(this.boxIbo);
    gl.deleteBuffer(this.cylVbo);
    gl.deleteBuffer(this.cylIbo);
    gl.deleteBuffer(this.coinCylVbo);
    gl.deleteBuffer(this.coinCylIbo);
    gl.deleteBuffer(this.sphereVbo);
    gl.deleteBuffer(this.sphereIbo);
    gl.deleteBuffer(this.orbitalSphereVbo);
    gl.deleteBuffer(this.orbitalSphereIbo);
    gl.deleteBuffer(this.bondVbo);
    gl.deleteBuffer(this.bondIbo);
    gl.deleteVertexArray(this.emptyVao);
    for (const s of this.stages) {
      if (s.boxVao) gl.deleteVertexArray(s.boxVao);
      if (s.cylVao) gl.deleteVertexArray(s.cylVao);
      if (s.sphereVao) gl.deleteVertexArray(s.sphereVao);
      if (s.transSphereVao) gl.deleteVertexArray(s.transSphereVao);
      if (s.bondVao) gl.deleteVertexArray(s.bondVao);
      if (s.boxBuf) gl.deleteBuffer(s.boxBuf);
      if (s.cylBuf) gl.deleteBuffer(s.cylBuf);
      if (s.sphereBuf) gl.deleteBuffer(s.sphereBuf);
      if (s.transSphereBuf) gl.deleteBuffer(s.transSphereBuf);
      if (s.bondBuf) gl.deleteBuffer(s.bondBuf);
    }
    gl.deleteProgram(this.shadowProg);
    gl.deleteProgram(this.shadowCutoutProg);
    gl.deleteProgram(this.sceneProg);
    gl.deleteProgram(this.sceneCutoutProg);
    gl.deleteProgram(this.prefilterProg);
    gl.deleteProgram(this.bloomDownProg);
    gl.deleteProgram(this.bloomUpProg);
    gl.deleteProgram(this.compositeProg);
    gl.deleteProgram(this.liquidGlProg);
    gl.deleteProgram(this.vernierProg);

    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
