import { DEFAULT_TELEMETRY, LiveMacTelemetry } from '../sim/macTelemetry';
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
import { DieInspectHit, pickDieRegion } from './inspect';
import { mat4Invert, mat4LookAt, mat4Multiply, mat4Ortho, mat4Perspective } from './math';
import {
  BLOOM_DOWN_FS,
  BLOOM_PREFILTER_FS,
  BLOOM_UP_FS,
  COMPOSITE_FS,
  FULLSCREEN_VS,
  SCENE_FS,
  SCENE_VS,
  SHADOW_FS,
  SHADOW_VS,
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

export interface EngineHooks {
  onZoomFrame: (zoom: number, fps: number) => void;
  onInspect: (hit: DieInspectHit | null) => void;
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
  atomX: number;
  atomY: number;
  atomZ: number;
  atomR: number;
}

const SHADOW_SIZE = 2048;
export const MIN_ZOOM = -2.4;
export const MAX_ZOOM = 9.0;
const STAGE_FLOOR_Y = [-0.598, -0.26, -0.14, -0.075, -0.35, -6.0, -6.0, -6.0, -6.0, -6.0];
const WORLD0_GRID_STEP = WORLD1_PITCH / STAGE_RATIOS[0]; // 0.095 (exact World 1 grid pitch on World 0!)

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

  private shadowProg: WebGLProgram;
  private sceneProg: WebGLProgram;
  private prefilterProg: WebGLProgram;
  private bloomDownProg: WebGLProgram;
  private bloomUpProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  private boxMesh: MeshBuffers;
  private cylMesh: MeshBuffers;
  private coinCylMesh: MeshBuffers;
  private sphereMesh: MeshBuffers;
  private bondMesh: MeshBuffers;
  private boxVbo: WebGLBuffer;
  private boxIbo: WebGLBuffer;
  private cylVbo: WebGLBuffer;
  private cylIbo: WebGLBuffer;
  private coinCylVbo: WebGLBuffer;
  private coinCylIbo: WebGLBuffer;
  private sphereVbo: WebGLBuffer;
  private sphereIbo: WebGLBuffer;
  private bondVbo: WebGLBuffer;
  private bondIbo: WebGLBuffer;
  private stages: StageDraw[] = [];
  private latticeAtoms: LatticeAtomSite[] = [];
  private emptyVao: WebGLVertexArrayObject;

  // Render targets & US Quarter PBR textures
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;
  private coinTex: WebGLTexture;
  private coinNormTex: WebGLTexture;
  private lastLightLookX = Number.NaN;
  private lastLightLookZ = Number.NaN;
  private lastLightHalf = Number.NaN;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColorRb: WebGLRenderbuffer | null = null;
  private msaaDepthRb: WebGLRenderbuffer | null = null;
  private fallbackDepthRb: WebGLRenderbuffer | null = null;
  private hdrMain!: FboTarget;
  private bloomDown: FboTarget[] = [];
  private bloomUp: FboTarget[] = [];

  private canvasW = 1;
  private canvasH = 1;

  // Cached uniform locations
  private uShadow: Record<string, WebGLUniformLocation | null> = {};
  private uScene: Record<string, WebGLUniformLocation | null> = {};
  private uPrefilter: Record<string, WebGLUniformLocation | null> = {};
  private uDown: Record<string, WebGLUniformLocation | null> = {};
  private uUp: Record<string, WebGLUniformLocation | null> = {};
  private uComp: Record<string, WebGLUniformLocation | null> = {};

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

  // Interactive click-to-inspect state
  private inspectBox: [number, number, number, number] = [0, 0, 0, 0];
  private hasInspect = false;
  private downX = 0;
  private downY = 0;

  // Camera & snappy zoom state
  public zoom = 0.0;
  private targetZoom = 0.0;
  private zoomRate = 15.0;
  private smoothMotion = 0.0;

  private yaw = -0.35;
  private pitch = 0.86;
  private targetYaw = -0.35;
  private targetPitch = 0.86;

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

  // Interaction & timing
  private dragging = false;
  private dragMode: 'orbit' | 'pan' = 'orbit';
  private lastX = 0;
  private lastY = 0;
  private rafId = 0;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private emaFrameMs = 16.0;
  private disposed = false;

  constructor(container: HTMLElement, private hooks: EngineHooks) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
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

    this.useFloatHdr = gl.getExtension('EXT_color_buffer_float') !== null;
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
    this.msaaSamples = Math.min(4, maxSamples || 0);

    // Compile shader programs
    this.shadowProg = this.createProgram(SHADOW_VS, SHADOW_FS);
    this.sceneProg = this.createProgram(SCENE_VS, SCENE_FS);
    this.prefilterProg = this.createProgram(FULLSCREEN_VS, BLOOM_PREFILTER_FS);
    this.bloomDownProg = this.createProgram(FULLSCREEN_VS, BLOOM_DOWN_FS);
    this.bloomUpProg = this.createProgram(FULLSCREEN_VS, BLOOM_UP_FS);
    this.compositeProg = this.createProgram(FULLSCREEN_VS, COMPOSITE_FS);

    this.cacheUniforms();

    // Shared procedural meshes
    this.boxMesh = createParametricBeveledBox();
    this.cylMesh = createParametricBeveledCylinder(20);
    this.coinCylMesh = createParametricBeveledCylinder(96);
    this.sphereMesh = createUnitSphere(26, 36);
    this.bondMesh = createUnitBondCylinder(12);

    this.boxVbo = this.createArrayBuffer(this.boxMesh.vertices);
    this.boxIbo = this.createIndexBuffer(this.boxMesh.indices);
    this.cylVbo = this.createArrayBuffer(this.cylMesh.vertices);
    this.cylIbo = this.createIndexBuffer(this.cylMesh.indices);
    this.coinCylVbo = this.createArrayBuffer(this.coinCylMesh.vertices);
    this.coinCylIbo = this.createIndexBuffer(this.coinCylMesh.indices);
    this.sphereVbo = this.createArrayBuffer(this.sphereMesh.vertices);
    this.sphereIbo = this.createIndexBuffer(this.sphereMesh.indices);
    this.bondVbo = this.createArrayBuffer(this.bondMesh.vertices);
    this.bondIbo = this.createIndexBuffer(this.bondMesh.indices);
    this.emptyVao = gl.createVertexArray()!;

    // Upload instant placeholder US Quarter textures, then hot-swap 1024x1024 photographic PBR maps
    const placeholder = createPlaceholderQuarterTextures();
    this.coinTex = gl.createTexture()!;
    this.coinNormTex = gl.createTexture()!;
    this.uploadQuarterTexture(this.coinTex, placeholder.albedo);
    this.uploadQuarterTexture(this.coinNormTex, placeholder.relief);
    loadQuarterPbrTextures((pbr) => {
      if (this.disposed) return;
      this.uploadQuarterTexture(this.coinTex, pbr.albedo);
      this.uploadQuarterTexture(this.coinNormTex, pbr.relief);
    });

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

    // Setup 2048px Hardware-PCF shadow map
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      SHADOW_SIZE,
      SHADOW_SIZE,
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
    this.loop();
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
    const none: HoleConfig = { cx: 0, cz: 0, hx: 0, hz: 0, minY: -10, mode: 0.0, atomX: 0, atomY: 0, atomZ: 0, atomR: 0 };

    switch (stageIdx) {
      case 0:
        // World 0 stays 100% solid & unbroken (ZERO moving trapdoor!); only opens far off-screen
        // once World 1's 13x13 grid already covers >2x the entire viewport (z >= 0.78)!
        if (z < 0.78) return none;
        return {
          cx: a[0],
          cz: a[2],
          hx: 0.62,
          hz: 0.62,
          minY: -0.35,
          mode: 2.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 1:
        // All 169 SRAM tiles stay uniform while browsing World 1; opens ONLY once diving into the target tile!
        if (z < 1.32) return none;
        return {
          cx: a[0],
          cz: a[2],
          hx: WORLD1_HOLE_HALF,
          hz: WORLD1_HOLE_HALF,
          minY: -0.18,
          mode: 1.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 2:
        // All 25 canyon courtyards stay uniform while browsing World 2; opens once diving between the 4 corner vias!
        if (z < 2.24) return none;
        return {
          cx: a[0],
          cz: a[2],
          hx: WORLD2_HOLE_HALF,
          hz: WORLD2_HOLE_HALF,
          minY: -0.10,
          mode: 2.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 3:
        if (z < 3.05) return none;
        return {
          cx: a[0],
          cz: a[2],
          hx: WORLD3_HOLE_HALF,
          hz: WORLD3_HOLE_HALF,
          minY: -0.09,
          mode: 1.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 4:
        // All 27 gold GAA gates stay uniform at z = 4.0; front cutaway opens once diving into your chosen gate!
        if (z < 4.22) return none;
        return {
          cx: a[0],
          cz: a[2],
          hx: WORLD4_HOLE_HX,
          hz: WORLD4_HOLE_HZ,
          minY: -0.185,
          mode: 1.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 5:
        if (z < 5.05) return none;
        return {
          cx: a[0],
          cz: 0,
          hx: 2.45 / STAGE_RATIOS[5],
          hz: 1.75 / STAGE_RATIOS[5],
          minY: -0.25,
          mode: 4.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0,
        };
      case 6:
        // All Silicon crystal atoms stay uniform metallic at z = 6.0; opens into sp3 orbitals once diving into your chosen atom!
        if (z < 6.22) return none;
        return {
          cx: 0,
          cz: 0,
          hx: 0,
          hz: 0,
          minY: -10,
          mode: 0.0,
          atomX: a[0],
          atomY: a[1],
          atomZ: a[2],
          atomR: 0.30,
        };
      case 8:
        // Central sapphire Proton at (0,0,0) opens cleanly once diving into World 9 (Single Proton & uud Quarks!)
        if (z < 8.22) return none;
        return {
          cx: 0,
          cz: 0,
          hx: 0,
          hz: 0,
          minY: -10,
          mode: 0.0,
          atomX: 0,
          atomY: 0,
          atomZ: 0,
          atomR: 0.25,
        };
      default:
        return none;
    }
  }

  /** Minimum zoom before child stage `k` activates (zero premature cutouts or jumping holes!) */
  private isStageRevealed(k: number, z: number): boolean {
    if (k === 0) return true;
    if (k === 1) return z >= 0.58;
    if (k === 2) return z >= 1.32;
    if (k === 3) return z >= 2.24;
    if (k === 4) return z >= 3.05;
    if (k === 5) return z >= 4.22;
    if (k === 6) return z >= 5.05;
    if (k === 7) return z >= 6.22;
    if (k === 8) return z >= 7.05;
    if (k === 9) return z >= 8.22;
    return true;
  }

  /** Smooth physical 3D relief extrusion factor (0 -> 1) so newly revealed micro-layers rise cleanly out of the surface */
  private getStageExtrude(k: number, z: number): number {
    if (k === 1) return this.smoothstep(0.58, 0.86, z);
    if (k === 2) return this.smoothstep(1.32, 1.62, z);
    if (k === 3) return this.smoothstep(2.24, 2.60, z);
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
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, buf.width, buf.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (anisoExt) {
      const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso || 1));
    }
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

    this.uShadow = grab(this.shadowProg, [
      'uLightVP',
      'uWorldScale',
      'uYExtrude',
      'uStageOffset',
      'uAtomRotY',
      'uHoleBox',
      'uHoleMinY',
      'uHoleMode',
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
    ]);

    this.uScene = grab(this.sceneProg, [
      'uViewProj',
      'uLightVP',
      'uWorldScale',
      'uYExtrude',
      'uStageOffset',
      'uAtomRotY',
      'uHoleBox',
      'uHoleMinY',
      'uHoleMode',
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
      'uCoinTex',
      'uCoinNormTex',
      'uCoinSpec',
      'uFocusXZ',
      'uFogDensity',
      'uZoom',
      'uSemFactor',
      'uFloorY',
      'uThermal',
      'uTranslucent',
      'uRegionKind',
      'uInspectBox',
    ]);

    this.uPrefilter = grab(this.prefilterProg, ['uTex', 'uTexelSize']);
    this.uDown = grab(this.bloomDownProg, ['uTex', 'uHalfPixel']);
    this.uUp = grab(this.bloomUpProg, ['uTex', 'uHalfPixel']);
    this.uComp = grab(this.compositeProg, ['uTex', 'uBloomTex', 'uResolution', 'uMotion', 'uTime']);
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
      const built = this.buildInstancedVao(this.sphereVbo, this.sphereIbo, w.translucentSpheres);
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

  private createColorFbo(w: number, h: number, attachDepth: WebGLRenderbuffer | null = null): FboTarget {
    const gl = this.gl;
    const width = Math.max(1, w);
    const height = Math.max(1, h);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (this.useFloatHdr) {
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

    const w1 = Math.max(2, Math.floor(w / 2));
    const h1 = Math.max(2, Math.floor(h / 2));
    const w2 = Math.max(2, Math.floor(w / 4));
    const h2 = Math.max(2, Math.floor(h / 4));
    const w3 = Math.max(2, Math.floor(w / 8));
    const h3 = Math.max(2, Math.floor(h / 8));

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

  public getFrameActivity(): { frameMs: number; motion: number; zoom: number } {
    return {
      frameMs: this.emaFrameMs,
      motion: this.smoothMotion,
      zoom: this.zoom,
    };
  }

  public clearInspect(): void {
    if (!this.hasInspect) return;
    this.hasInspect = false;
    this.inspectBox = [0, 0, 0, 0];
    this.hooks.onInspect(null);
  }

  /** Compute camera-space ray (origin + unit direction) for a client pixel */
  private getPointerRay(clientX: number, clientY: number): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } | null {
    const rect = this.canvas.getBoundingClientRect();
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

  /** Pick the closest 3D Silicon atom in World 6 to the pointer ray */
  private pickNearestLatticeAtom(clientX: number, clientY: number): LatticeAtomSite | null {
    const ray = this.getPointerRay(clientX, clientY);
    if (!ray) return null;
    const s6 = this.stageScales[6];
    const off6 = this.effOffsets[6];
    let best: LatticeAtomSite | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < this.latticeAtoms.length; i++) {
      const at = this.latticeAtoms[i];
      const cx = (at.x - off6[0]) * s6;
      const cy = (at.y - off6[1]) * s6;
      const cz = (at.z - off6[2]) * s6;
      const px = cx - ray.ox;
      const py = cy - ray.oy;
      const pz = cz - ray.oz;
      const t = px * ray.dx + py * ray.dy + pz * ray.dz;
      if (t < 0.2) continue;
      const rx = px - ray.dx * t;
      const ry = py - ray.dy * t;
      const rz = pz - ray.dz * t;
      const perp = Math.hypot(rx, ry, rz);
      // Favor atoms close to the pointer ray, gently preferring nearer atoms on tie
      const score = perp + t * 0.035;
      if (score < bestScore) {
        bestScore = score;
        best = at;
      }
    }
    return best;
  }

  public flyToZoom(z: number, dieTargetXZ?: [number, number]): void {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    this.zoomRate = 8.5;
    if (dieTargetXZ) {
      const gx = Math.round(dieTargetXZ[0] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
      const gz = Math.round(dieTargetXZ[1] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
      this.targetAnchor0[0] = clamp(gx, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
      this.targetAnchor0[1] = clamp(gz, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
    }
    if (z < -0.5) {
      this.targetPitch = 0.96;
      this.targetYaw = -0.14;
    } else if (z < 0.5) {
      this.targetPitch = 0.86;
      this.targetYaw = -0.34;
    } else if (z < 1.5) {
      this.targetPitch = 0.78;
      this.targetYaw = 0.24;
    } else if (z < 2.5) {
      this.targetPitch = 0.64;
      this.targetYaw = 0.48;
    } else if (z < 3.5) {
      this.targetPitch = 0.86;
      this.targetYaw = 0.16;
    } else if (z < 4.5) {
      this.targetPitch = 0.56;
      this.targetYaw = 0.24;
    } else if (z < 5.5) {
      this.targetPitch = 0.30;
      this.targetYaw = 0.30;
    } else if (z < 6.5) {
      this.targetPitch = 0.26;
      this.targetYaw = 0.38;
    } else if (z < 7.5) {
      this.targetPitch = 0.24;
      this.targetYaw = 0.56;
    } else if (z < 8.5) {
      this.targetPitch = 0.30;
      this.targetYaw = 0.46;
    } else {
      this.targetPitch = 0.34;
      this.targetYaw = 0.52;
    }
  }

  private resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    this.canvasW = Math.max(1, Math.floor(w * dpr));
    this.canvasH = Math.max(1, Math.floor(h * dpr));
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.allocRenderTargets(this.canvasW, this.canvasH);
  };

  /**
   * Zoom-to-cursor on scroll/pinch!
   * When zooming IN over any region of the silicon die (or any tile/canyon/cell/gate/atom),
   * smoothly targets that exact physical feature under the cursor (Option 1: non-silicon regions
   * stay cleanly clamped onto the silicon die once diving past z > 0).
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = -e.deltaY * (e.ctrlKey ? 0.011 : 0.0031);
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom + delta));
    this.targetZoom = nextZoom;
    this.zoomRate = 16.5;

    // Only steer zoom-to-cursor when zooming IN (scrolling out reverses cleanly along your entry path!)
    if (delta <= 0.0005) return;

    const z = this.zoom;
    if (z >= -0.35 && z < 0.56) {
      // Aim anywhere on the Apple Silicon die — snapped cleanly to the fixed 0.095 micro-striation grid!
      const diePt = this.unprojectDiePoint(e.clientX, e.clientY);
      if (diePt) {
        const onDie = Math.abs(diePt[0]) <= 3.15 && Math.abs(diePt[1]) <= 2.48;
        if (onDie || nextZoom > 0.12) {
          const gx = clamp(Math.round(diePt[0] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP, -WORLD0_DIE_CLAMP_X, WORLD0_DIE_CLAMP_X);
          const gz = clamp(Math.round(diePt[1] / WORLD0_GRID_STEP) * WORLD0_GRID_STEP, -WORLD0_DIE_CLAMP_Z, WORLD0_DIE_CLAMP_Z);
          const pull = Math.min(1.0, Math.abs(delta) * 5.0 + 0.42);
          this.targetAnchor0[0] = Math.round((this.targetAnchor0[0] + (gx - this.targetAnchor0[0]) * pull) / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
          this.targetAnchor0[1] = Math.round((this.targetAnchor0[1] + (gz - this.targetAnchor0[1]) * pull) / WORLD0_GRID_STEP) * WORLD0_GRID_STEP;
        }
      }
    } else if (z >= 0.78 && z < 5.20) {
      // Discrete grid/gate/ribbon levels 1..5: steer while viewing level k, lock once diving into k+1!
      const k = Math.floor(z + 0.25);
      const fracIntoNext = z - k;
      const lockFrac = k === 1 ? 0.30 : k === 2 ? 0.22 : k === 3 ? 0.04 : k === 4 ? 0.20 : 0.05;
      if (k >= 1 && k <= 5 && fracIntoNext < lockFrac) {
        const camHit = this.unprojectPlaneXZ(e.clientX, e.clientY, 0.0);
        if (camHit) {
          const sk = this.stageScales[k];
          const lx = camHit[0] / sk + this.effOffsets[k][0];
          const lz = camHit[1] / sk + this.effOffsets[k][2];
          const steer = 0.72;
          const bx = this.anchors[k][0] + (lx - this.anchors[k][0]) * steer;
          const bz = this.anchors[k][2] + (lz - this.anchors[k][2]) * steer;
          this.setStageAnchorSnapped(k, bx, 0, bz, true);
        }
      }
    } else if (z >= 5.72 && z < 6.20) {
      // World 6 (3D Silicon Crystal Lattice): aim at ANY Silicon atom under the cursor before opening orbitals!
      const atom = this.pickNearestLatticeAtom(e.clientX, e.clientY);
      if (atom) {
        this.setStageAnchorSnapped(6, atom.x, atom.y, atom.z, true);
      }
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    // Right-drag or Shift+drag pans the microscope stage laterally; normal left-drag orbits in 3D!
    this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.canvas.style.cursor = this.dragMode === 'pan' ? 'move' : 'grabbing';
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) {
      if (this.zoom < 0.85) {
        const pt = this.unprojectDiePoint(e.clientX, e.clientY);
        const hit = pt ? pickDieRegion(pt[0], pt[1], this.dieSpec) : null;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      } else {
        this.canvas.style.cursor = 'grab';
      }
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.dragMode === 'pan') {
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
      return;
    }

    this.targetYaw -= dx * 0.0065;
    const minPitch = this.zoom > 4.2 ? -0.55 : this.zoom < -0.25 ? 0.16 : 0.28;
    this.targetPitch = Math.max(minPitch, Math.min(1.52, this.targetPitch + dy * 0.0055));
  };

  private onPointerUp = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    const wasOrbit = this.dragMode === 'orbit';
    this.dragging = false;
    this.dragMode = 'orbit';
    this.canvas.style.cursor = 'grab';
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (wasOrbit && e.button === 0 && moved < 5 && this.zoom < 0.85) {
      const pt = this.unprojectDiePoint(e.clientX, e.clientY);
      const hit = pt ? pickDieRegion(pt[0], pt[1], this.dieSpec) : null;
      if (hit) {
        this.hasInspect = true;
        this.inspectBox = hit.box;
        this.hooks.onInspect(hit);
      } else {
        this.clearInspect();
      }
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.dragging = false;
    this.dragMode = 'orbit';
    this.canvas.style.cursor = 'grab';
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
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
        this.sphereMesh.indexCount,
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
    gl.uniform3f(locs.uStageOffset, off[0], off[1], off[2]);
    gl.uniform1f(locs.uAtomRotY, idx === 7 && this.atomParity < 0 ? 1.0 : 0.0);
    gl.uniform4f(locs.uHoleBox, hole.cx, hole.cz, hole.hx, hole.hz);
    gl.uniform1f(locs.uHoleMinY, hole.minY);
    gl.uniform1f(locs.uHoleMode, hole.mode);
    gl.uniform4f(locs.uAtomHole, hole.atomX, hole.atomY, hole.atomZ, hole.atomR);
  }

  private renderUnifiedScene(
    activeStages: { idx: number; scale: number }[],
    elapsedSec: number,
    camX: number,
    camY: number,
    camZ: number,
    semFactor: number,
    focusX: number,
    focusZ: number,
    fogDensity: number
  ): void {
    const gl = this.gl;

    // 1) Unified 2048px Directional Shadow Pass across ALL active nested scales
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
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

    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.uShadow.uLightVP, false, this.lightVPMat);
    gl.uniform1f(this.uShadow.uTime, elapsedSec);
    gl.uniform4f(this.uShadow.uMacLoads, this.smoothP, this.smoothE, this.smoothGpu, this.smoothMem);
    gl.uniform4f(
      this.uShadow.uCoreA,
      this.smoothCores[0],
      this.smoothCores[1],
      this.smoothCores[2],
      this.smoothCores[3]
    );
    gl.uniform4f(
      this.uShadow.uCoreB,
      this.smoothCores[4],
      this.smoothCores[5],
      this.smoothCores[6],
      this.smoothCores[7]
    );
    gl.uniform1f(this.uShadow.uNetLoad, this.smoothNet);
    gl.uniform1f(this.uShadow.uPulsePhase, this.pulsePhase);
    gl.uniform1f(this.uShadow.uSocTemp, this.smoothTemp);
    gl.uniform3f(this.uShadow.uCamPos, camX, camY, camZ);

    for (let i = 0; i < activeStages.length; i++) {
      const { idx, scale } = activeStages[i];
      if (scale < 0.015 || scale > 40.0) continue;
      this.bindStageHoleUniforms(this.uShadow, idx, scale);
      const lensClearance =
        idx === 6
          ? this.smoothstep(1.6, 3.6, scale) * 2.45
          : idx === 8
            ? this.smoothstep(1.8, 4.5, scale) * 5.2
            : 0.0;
      gl.uniform1f(this.uShadow.uLensClearance, lensClearance);
      this.drawOpaqueStage(this.stages[idx]);
    }

    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);

    // 2A) Unified 4x MSAA HDR Opaque PBR Pass — ALL nested scales share ONE 3D depth buffer!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.hdrMain.fbo);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(0.003, 0.005, 0.009, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.sceneProg);
    gl.uniformMatrix4fv(this.uScene.uViewProj, false, this.viewProjMat);
    gl.uniformMatrix4fv(this.uScene.uLightVP, false, this.lightVPMat);
    gl.uniform1f(this.uScene.uTime, elapsedSec);
    gl.uniform4f(this.uScene.uMacLoads, this.smoothP, this.smoothE, this.smoothGpu, this.smoothMem);
    gl.uniform4f(
      this.uScene.uCoreA,
      this.smoothCores[0],
      this.smoothCores[1],
      this.smoothCores[2],
      this.smoothCores[3]
    );
    gl.uniform4f(
      this.uScene.uCoreB,
      this.smoothCores[4],
      this.smoothCores[5],
      this.smoothCores[6],
      this.smoothCores[7]
    );
    gl.uniform1f(this.uScene.uNetLoad, this.smoothNet);
    gl.uniform1f(this.uScene.uPulsePhase, this.pulsePhase);
    gl.uniform1f(this.uScene.uSocTemp, this.smoothTemp);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(this.uScene.uShadowMap, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.coinTex);
    gl.uniform1i(this.uScene.uCoinTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.coinNormTex);
    gl.uniform1i(this.uScene.uCoinNormTex, 2);
    gl.uniform4f(this.uScene.uCoinSpec, QUARTER_X, QUARTER_Z, QUARTER_RADIUS, QUARTER_HY);
    gl.uniform2f(this.uScene.uFocusXZ, focusX, focusZ);
    gl.uniform1f(this.uScene.uFogDensity, fogDensity);
    gl.uniform3f(this.uScene.uCamPos, camX, camY, camZ);
    gl.uniform1f(this.uScene.uZoom, this.zoom);
    gl.uniform1f(this.uScene.uSemFactor, semFactor);
    gl.uniform1f(this.uScene.uThermal, this.thermal ? 1.0 : 0.0);
    gl.uniform1f(this.uScene.uTranslucent, 0.0);
    gl.uniform1f(this.uScene.uRegionKind, this.activeRegionKind);

    for (let i = 0; i < activeStages.length; i++) {
      const { idx, scale } = activeStages[i];
      const stage = this.stages[idx];
      this.bindStageHoleUniforms(this.uScene, idx, scale);
      gl.uniform1f(this.uScene.uFloorY, stage.floorY);

      const lensClearance =
        idx === 6
          ? this.smoothstep(1.6, 3.6, scale) * 2.45
          : idx === 8
            ? this.smoothstep(1.8, 4.5, scale) * 5.2
            : 0.0;
      gl.uniform1f(this.uScene.uLensClearance, lensClearance);

      if (idx === 0 && this.hasInspect) {
        gl.uniform4f(
          this.uScene.uInspectBox,
          this.inspectBox[0],
          this.inspectBox[1],
          this.inspectBox[2],
          this.inspectBox[3]
        );
      } else {
        gl.uniform4f(this.uScene.uInspectBox, 0, 0, 0, 0);
      }
      this.drawOpaqueStage(stage);
    }

    // 2B) Translucent Volumetric Quantum Orbital Pass (depth-tested, additive Fresnel glow!)
    let hasTranslucent = false;
    for (let i = 0; i < activeStages.length; i++) {
      if (this.stages[activeStages[i].idx].transSphereCount > 0) {
        hasTranslucent = true;
        break;
      }
    }
    if (hasTranslucent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(this.uScene.uTranslucent, 1.0);
      gl.uniform1f(this.uScene.uLensClearance, 0.0);
      gl.uniform4f(this.uScene.uInspectBox, 0, 0, 0, 0);

      for (let i = 0; i < activeStages.length; i++) {
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

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const rawDtMs = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDtMs / 1000));
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

    const pulseSpeed = 0.25 + this.smoothP * 0.75 + this.smoothNet * 0.65;
    this.pulsePhase = (this.pulsePhase + dt * pulseSpeed) % 1;

    // Smooth continuous World 0 die anchor & smooth camera pan decay
    const a0Factor = 1 - Math.exp(-12.0 * dt);
    this.anchors[0][0] += (this.targetAnchor0[0] - this.anchors[0][0]) * a0Factor;
    this.anchors[0][2] += (this.targetAnchor0[1] - this.anchors[0][2]) * a0Factor;
    this.recomputeEffOffsets();

    const shiftDecay = Math.exp(-11.0 * dt);
    this.smoothCamShiftX *= shiftDecay;
    this.smoothCamShiftY *= shiftDecay;
    this.smoothCamShiftZ *= shiftDecay;

    // Frame-rate-independent snappy zoom & optical motion tracking
    const prevZ = this.zoom;
    const zFactor = 1 - Math.exp(-this.zoomRate * dt);
    this.zoom += (this.targetZoom - this.zoom) * zFactor;
    if (Math.abs(this.targetZoom - this.zoom) < 0.0002) {
      this.zoom = this.targetZoom;
    }
    const zoomVel = Math.abs(this.zoom - prevZ) / dt;
    const targetMotion = Math.min(1.0, zoomVel * 0.20);
    this.smoothMotion += (targetMotion - this.smoothMotion) * (1 - Math.exp(-14.0 * dt));

    if (this.autoOrbit && !this.dragging) {
      this.targetYaw += dt * 0.075;
    }
    const rotFactor = 1 - Math.exp(-10.0 * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotFactor;
    this.pitch += (this.targetPitch - this.pitch) * rotFactor;

    const fps = Math.round(1000 / Math.max(4, this.emaFrameMs));
    this.hooks.onZoomFrame(this.zoom, fps);

    // Compute exact continuous log-scale for EVERY nested world (0..9) relative to current zoom z
    const z = Math.max(0, Math.min(MAX_ZOOM, this.zoom));
    const idx = Math.min(STAGE_RATIOS.length - 1, Math.floor(z));
    const f = z >= MAX_ZOOM ? 1.0 : z - idx;
    const logCamScale = LOG_CUM_SCALE[idx] * (1.0 - f) + LOG_CUM_SCALE[idx + 1] * f;
    const semFactor = this.smoothstep(0.9, 2.1, z);

    // Track active functional die region (0 = Logic/CPU, 1 = SRAM/SLC, 2 = GPU)
    const dieRegion = pickDieRegion(this.anchors[0][0], this.anchors[0][2], this.dieSpec);
    this.activeRegionKind = dieRegion ? dieRegion.regionKind : 0;

    for (let k = 0; k < this.stages.length; k++) {
      this.stageScales[k] = Math.exp(logCamScale - LOG_CUM_SCALE[k]);
    }
    this.world0Scale = this.stageScales[0];
    if (this.hasInspect && z > 0.85) {
      this.clearInspect();
    }

    // Smooth camera framing:
    //   - At Die (z = 0) and Scale (z < 0), stays centered on the chip package (with the US Quarter off to the side)
    //   - As you zoom into ANY spot on the die (z: 0.02 -> 0.68), smoothly glides right onto anchor[0]!
    //   - At deeper scales (z >= 0.7), locks onto the nested floating origin (0,0,0) + smooth pan glide!
    const aspect = this.canvasW / Math.max(1, this.canvasH);
    const outT = Math.max(0.0, -this.zoom);
    const macroOut = this.smoothstep(0.0, -0.85, this.zoom);
    const diveFocus = this.smoothstep(0.02, 0.68, this.zoom);

    const pkgOriginX = -this.effOffsets[0][0] * this.world0Scale;
    const pkgOriginZ = -this.effOffsets[0][2] * this.world0Scale;
    const lookX = pkgOriginX * (1.0 - diveFocus) + this.smoothCamShiftX;
    const lookY = this.smoothCamShiftY;
    const lookZ = pkgOriginZ * (1.0 - diveFocus) + this.smoothCamShiftZ;

    const aspectBoost = Math.max(1.0, 1.62 / Math.max(0.85, aspect));
    const subatomicBackoff = this.smoothstep(7.6, 8.2, this.zoom);
    const dist =
      this.zoom < 0
        ? 10.2 * Math.pow(2.55, outT) * (1.0 + 0.25 * macroOut) * (1.0 + (aspectBoost - 1.0) * Math.min(1.0, outT))
        : (10.2 + (5.4 - 10.2) * this.smoothstep(0.0, 0.95, this.zoom) + subatomicBackoff * 1.15) *
          (1.0 + (aspectBoost - 1.0) * subatomicBackoff * 0.35);
    const cp = Math.cos(this.pitch);
    const camX = lookX + Math.sin(this.yaw) * cp * dist;
    const camY = lookY + Math.sin(this.pitch) * dist;
    const camZ = lookZ + Math.cos(this.yaw) * cp * dist;

    const fovY = 2.0 * Math.atan(0.5 / 1.68);
    const nearClip = Math.max(0.10, dist * 0.015);
    const farClip = Math.max(85.0, dist * 3.2);
    mat4Perspective(this.projMat, fovY, aspect, nearClip, farClip);
    mat4LookAt(this.viewMat, camX, camY, camZ, lookX, lookY, lookZ, 0, 1, 0);
    mat4Multiply(this.viewProjMat, this.projMat, this.viewMat);

    this.updateLightMatrix(lookX, lookZ, 8.8 + macroOut * 7.8);
    const fogDensity = 0.0082 * Math.pow(0.10, outT);

    // Collect all physically visible nested scales (allow deeper visibility for World 8 during the 1800x empty-space plunge!)
    const distLogAdj = Math.log(5.4 / Math.max(5.4, dist));
    const activeStages: { idx: number; scale: number }[] = [];
    for (let k = 0; k < this.stages.length; k++) {
      if (!this.isStageRevealed(k, this.zoom)) continue;
      const logS = logCamScale - LOG_CUM_SCALE[k];
      const minLogS = k === 8 ? -7.2 : -6.0;
      if (logS + distLogAdj > minLogS && logS < 4.35) {
        activeStages.push({ idx: k, scale: this.stageScales[k] });
      }
    }

    // PASS 0 + 1: Unified Multi-Scale 3D Render (ZERO 2D fading!)
    this.renderUnifiedScene(activeStages, elapsedSec, camX, camY, camZ, semFactor, lookX, lookZ, fogDensity);

    const gl = this.gl;

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

    // PASS 3: Final Full-Retina Optical Composite -> Screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);

    const gl = this.gl;
    this.destroyRenderTargets();
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.shadowTex);
    gl.deleteTexture(this.coinTex);
    gl.deleteTexture(this.coinNormTex);
    gl.deleteBuffer(this.boxVbo);
    gl.deleteBuffer(this.boxIbo);
    gl.deleteBuffer(this.cylVbo);
    gl.deleteBuffer(this.cylIbo);
    gl.deleteBuffer(this.coinCylVbo);
    gl.deleteBuffer(this.coinCylIbo);
    gl.deleteBuffer(this.sphereVbo);
    gl.deleteBuffer(this.sphereIbo);
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
    gl.deleteProgram(this.sceneProg);
    gl.deleteProgram(this.prefilterProg);
    gl.deleteProgram(this.bloomDownProg);
    gl.deleteProgram(this.bloomUpProg);
    gl.deleteProgram(this.compositeProg);

    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
