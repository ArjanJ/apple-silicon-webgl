import { DEFAULT_TELEMETRY, LiveMacTelemetry } from '../sim/macTelemetry';
import { createParametricBeveledBox, createParametricBeveledCylinder, MeshBuffers } from './geometry';
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
import { buildWorld0, buildWorld1, buildWorld2, buildWorld3, buildWorld4, WorldInstances } from './worlds';

export interface EngineHooks {
  onZoomFrame: (zoom: number, fps: number) => void;
  onInspect: (hit: DieInspectHit | null) => void;
}

interface StageDraw {
  boxVao: WebGLVertexArrayObject | null;
  boxCount: number;
  cylVao: WebGLVertexArrayObject | null;
  cylCount: number;
  floorY: number;
  boxBuf: WebGLBuffer | null;
  cylBuf: WebGLBuffer | null;
}

interface FboTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const SHADOW_SIZE = 2048;
const STAGE_FLOOR_Y = [-0.37, -0.22, -0.54, -0.21, -0.24];

/**
 * High-Speed Hardware-Instanced WebGL2 PBR Engine.
 *
 *   - 4x Hardware MSAA into HDR RGBA16F (runs in Apple Silicon TBDR tile memory)
 *   - 2048px Hardware-PCF Directional Shadow Map
 *   - Dual-Kawase 3-Level HDR Bloom
 *   - Seamless Dual-Stage Optical Cross-Dissolve + Velocity Radial Zoom Blur
 *   - Zero React, Zero Three.js, Zero per-frame CPU buffer uploads
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
  private boxVbo: WebGLBuffer;
  private boxIbo: WebGLBuffer;
  private cylVbo: WebGLBuffer;
  private cylIbo: WebGLBuffer;
  private stages: StageDraw[] = [];
  private emptyVao: WebGLVertexArrayObject;

  // Render targets
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColorRb: WebGLRenderbuffer | null = null;
  private msaaDepthRb: WebGLRenderbuffer | null = null;
  private fallbackDepthRb: WebGLRenderbuffer | null = null;
  private hdrA!: FboTarget;
  private hdrB!: FboTarget;
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

  // Interactive click-to-inspect state
  private inspectBox: [number, number, number, number] = [0, 0, 0, 0];
  private hasInspect = false;
  private downX = 0;
  private downY = 0;

  // Camera & snappy zoom state
  public zoom = 0.0;
  private targetZoom = 0.0;
  private zoomRate = 15.0; // tight 15.0 for trackpad/scroll, 8.5 for rail flyToZoom
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
  private smoothCores = new Float32Array(8).fill(0.15);
  private pulsePhase = 0;

  public thermal = false;
  public autoOrbit = false;

  // Interaction & timing
  private dragging = false;
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

    // Create shared procedural beveled box & cylinder meshes
    this.boxMesh = createParametricBeveledBox();
    this.cylMesh = createParametricBeveledCylinder(20);

    this.boxVbo = this.createArrayBuffer(this.boxMesh.vertices);
    this.boxIbo = this.createIndexBuffer(this.boxMesh.indices);
    this.cylVbo = this.createArrayBuffer(this.cylMesh.vertices);
    this.cylIbo = this.createIndexBuffer(this.cylMesh.indices);
    this.emptyVao = gl.createVertexArray()!;

    // Build all 5 instanced worlds once at startup (~2 MB total GPU memory!)
    const worlds: WorldInstances[] = [
      buildWorld0(),
      buildWorld1(),
      buildWorld2(),
      buildWorld3(),
      buildWorld4(),
    ];
    for (let i = 0; i < worlds.length; i++) {
      this.stages.push(this.uploadStage(worlds[i], STAGE_FLOOR_Y[i]));
    }

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

    // Precompute constant studio key light view-projection matrix
    // Matches keyDir = normalize(vec3(0.52, 0.84, 0.40))
    const lLen = Math.hypot(0.52, 0.84, 0.4);
    const lx = (0.52 / lLen) * 14.0;
    const ly = (0.84 / lLen) * 14.0;
    const lz = (0.4 / lLen) * 14.0;
    mat4LookAt(this.lightViewMat, lx, ly, lz, 0, 0, 0, 0, 1, 0);
    mat4Ortho(this.lightProjMat, -8.8, 8.8, -8.8, 8.8, 2.0, 28.0);
    mat4Multiply(this.lightVPMat, this.lightProjMat, this.lightViewMat);

    // Allocate screen-sized HDR + MSAA + Dual-Kawase bloom targets
    this.resize();
    this.bindEvents();
    this.loop();
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
      'uTime',
      'uMacLoads',
      'uCoreA',
      'uCoreB',
      'uNetLoad',
      'uPulsePhase',
    ]);

    this.uScene = grab(this.sceneProg, [
      'uViewProj',
      'uLightVP',
      'uWorldScale',
      'uTime',
      'uMacLoads',
      'uCoreA',
      'uCoreB',
      'uNetLoad',
      'uPulsePhase',
      'uShadowMap',
      'uCamPos',
      'uZoom',
      'uSemFactor',
      'uFloorY',
      'uThermal',
      'uInspectBox',
    ]);

    this.uPrefilter = grab(this.prefilterProg, ['uTexA', 'uTexB', 'uBlend', 'uTexelSize']);
    this.uDown = grab(this.bloomDownProg, ['uTex', 'uHalfPixel']);
    this.uUp = grab(this.bloomUpProg, ['uTex', 'uHalfPixel']);
    this.uComp = grab(this.compositeProg, [
      'uTexA',
      'uTexB',
      'uBloomTex',
      'uResolution',
      'uBlend',
      'uMotion',
      'uTime',
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

    // Per-vertex attributes: aAnchor (loc 0), aNorm (loc 1)
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);

    // Per-instance attributes: aInstA (loc 2), aInstB (loc 3), aInstC (loc 4)
    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instData, gl.STATIC_DRAW);

    const stride = 48; // 12 floats
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

  private uploadStage(w: WorldInstances, floorY: number): StageDraw {
    let boxVao: WebGLVertexArrayObject | null = null;
    let boxBuf: WebGLBuffer | null = null;
    if (w.boxCount > 0) {
      const built = this.buildInstancedVao(this.boxVbo, this.boxIbo, w.boxes);
      boxVao = built.vao;
      boxBuf = built.instBuf;
    }

    let cylVao: WebGLVertexArrayObject | null = null;
    let cylBuf: WebGLBuffer | null = null;
    if (w.cylinderCount > 0) {
      const built = this.buildInstancedVao(this.cylVbo, this.cylIbo, w.cylinders);
      cylVao = built.vao;
      cylBuf = built.instBuf;
    }

    return {
      boxVao,
      boxCount: w.boxCount,
      cylVao,
      cylCount: w.cylinderCount,
      floorY,
      boxBuf,
      cylBuf,
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
    drop(this.hdrA);
    drop(this.hdrB);
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

    // Try 4x Hardware MSAA HDR renderbuffer (virtually free in Apple Silicon TBDR tile memory!)
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

    this.hdrA = this.createColorFbo(w, h, msaaOk ? null : this.fallbackDepthRb);
    this.hdrB = this.createColorFbo(w, h, msaaOk ? null : this.fallbackDepthRb);

    // 3-Level Dual-Kawase Bloom pyramid: 1/2, 1/4, 1/8
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
    this.bloomUp = [
      this.createColorFbo(w2, h2),
      this.createColorFbo(w1, h1),
    ];
  }

  public setTelemetry(t: LiveMacTelemetry): void {
    this.telemetry = t;
  }

  public clearInspect(): void {
    if (!this.hasInspect) return;
    this.hasInspect = false;
    this.inspectBox = [0, 0, 0, 0];
    this.hooks.onInspect(null);
  }

  private unprojectDiePoint(clientX: number, clientY: number): [number, number] | null {
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
    const dy = farP[1] - nearP[1];
    if (Math.abs(dy) < 1e-6) return null;

    const planeY = 0.185 * this.world0Scale;
    const t = (planeY - nearP[1]) / dy;
    if (t < 0) return null;

    const sx = nearP[0] + (farP[0] - nearP[0]) * t;
    const sz = nearP[2] + (farP[2] - nearP[2]) * t;
    return [sx / this.world0Scale, sz / this.world0Scale];
  }

  public flyToZoom(z: number): void {
    this.targetZoom = Math.max(0, Math.min(4, z));
    this.zoomRate = 8.5; // crisp Apple ease-out for rail button jumps
    if (z < 0.5) {
      this.targetPitch = 0.86;
      this.targetYaw = -0.34;
    } else if (z < 1.5) {
      this.targetPitch = 0.78;
      this.targetYaw = 0.24;
    } else if (z < 2.5) {
      this.targetPitch = 0.56;
      this.targetYaw = 0.54;
    } else if (z < 3.5) {
      this.targetPitch = 0.9;
      this.targetYaw = 0.16;
    } else {
      this.targetPitch = 0.62;
      this.targetYaw = 0.34;
    }
  }

  private resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    // Full crisp 2x Retina — hardware instancing handles native 2x DPR effortlessly!
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    this.canvasW = Math.max(1, Math.floor(w * dpr));
    this.canvasH = Math.max(1, Math.floor(h * dpr));
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.allocRenderTargets(this.canvasW, this.canvasH);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Natural macOS pinch-to-zoom (ctrlKey === true, negative deltaY on pinch-out) + responsive two-finger scroll
    const delta = -e.deltaY * (e.ctrlKey ? 0.0115 : 0.0031);
    this.targetZoom = Math.max(0, Math.min(4, this.targetZoom + delta));
    this.zoomRate = 16.5; // glued-to-fingers responsiveness on direct scroll/pinch
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) {
      if (this.zoom < 0.85) {
        const pt = this.unprojectDiePoint(e.clientX, e.clientY);
        const hit = pt ? pickDieRegion(pt[0], pt[1]) : null;
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
    this.targetYaw -= dx * 0.0065;
    this.targetPitch = Math.max(0.28, Math.min(1.52, this.targetPitch + dy * 0.0055));
  };

  private onPointerUp = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (moved < 5 && this.zoom < 0.85) {
      const pt = this.unprojectDiePoint(e.clientX, e.clientY);
      const hit = pt ? pickDieRegion(pt[0], pt[1]) : null;
      if (hit) {
        this.hasInspect = true;
        this.inspectBox = hit.box;
        this.hooks.onInspect(hit);
      } else {
        this.clearInspect();
      }
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private drawStageGeometry(stage: StageDraw): void {
    const gl = this.gl;
    if (stage.boxVao && stage.boxCount > 0) {
      gl.bindVertexArray(stage.boxVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.boxMesh.indexCount, gl.UNSIGNED_SHORT, 0, stage.boxCount);
    }
    if (stage.cylVao && stage.cylCount > 0) {
      gl.bindVertexArray(stage.cylVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.cylMesh.indexCount, gl.UNSIGNED_SHORT, 0, stage.cylCount);
    }
  }

  private renderStagePass(
    stageIdx: number,
    worldScale: number,
    target: FboTarget,
    elapsedSec: number,
    camX: number,
    camY: number,
    camZ: number,
    semFactor: number
  ): void {
    const gl = this.gl;
    const stage = this.stages[stageIdx];

    // 1) Fast 2048px Directional Shadow Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.8, 2.5);
    gl.colorMask(false, false, false, false);

    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.uShadow.uLightVP, false, this.lightVPMat);
    gl.uniform1f(this.uShadow.uWorldScale, worldScale);
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
    this.drawStageGeometry(stage);

    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);

    // 2) 4x MSAA HDR PBR Scene Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? target.fbo);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(0.003, 0.005, 0.009, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.sceneProg);
    gl.uniformMatrix4fv(this.uScene.uViewProj, false, this.viewProjMat);
    gl.uniformMatrix4fv(this.uScene.uLightVP, false, this.lightVPMat);
    gl.uniform1f(this.uScene.uWorldScale, worldScale);
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

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(this.uScene.uShadowMap, 0);
    gl.uniform3f(this.uScene.uCamPos, camX, camY, camZ);
    gl.uniform1f(this.uScene.uZoom, this.zoom);
    gl.uniform1f(this.uScene.uSemFactor, semFactor);
    gl.uniform1f(this.uScene.uFloorY, stage.floorY);
    gl.uniform1f(this.uScene.uThermal, this.thermal ? 1.0 : 0.0);
    if (stageIdx === 0 && this.hasInspect) {
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

    this.drawStageGeometry(stage);

    // 3) Resolve MSAA Renderbuffer -> Linear HDR Texture
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
      gl.blitFramebuffer(
        0,
        0,
        this.canvasW,
        this.canvasH,
        0,
        0,
        target.w,
        target.h,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
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

    const eOff = Math.min(this.telemetry.eCoreCount, Math.max(0, this.telemetry.coreLoads.length - 8));
    for (let i = 0; i < 8; i++) {
      const targetC = this.telemetry.coreLoads[eOff + i] ?? this.telemetry.pCoreAvg;
      this.smoothCores[i] += (targetC - this.smoothCores[i]) * lr;
    }

    const pulseSpeed = 0.25 + this.smoothP * 0.75 + this.smoothNet * 0.65;
    this.pulsePhase = (this.pulsePhase + dt * pulseSpeed) % 1;

    // Frame-rate-independent snappy zoom & optical motion tracking
    const prevZ = this.zoom;
    const zFactor = 1 - Math.exp(-this.zoomRate * dt);
    this.zoom += (this.targetZoom - this.zoom) * zFactor;
    if (Math.abs(this.targetZoom - this.zoom) < 0.0002) {
      this.zoom = this.targetZoom;
    }
    const zoomVel = Math.abs(this.zoom - prevZ) / dt;
    const targetMotion = Math.min(1.0, zoomVel * 0.22);
    this.smoothMotion += (targetMotion - this.smoothMotion) * (1 - Math.exp(-14.0 * dt));

    if (this.autoOrbit && !this.dragging) {
      this.targetYaw += dt * 0.075;
    }
    const rotFactor = 1 - Math.exp(-10.0 * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotFactor;
    this.pitch += (this.targetPitch - this.pitch) * rotFactor;

    const fps = Math.round(1000 / Math.max(4, this.emaFrameMs));
    this.hooks.onZoomFrame(this.zoom, fps);

    // Camera matrices (matching telephoto Apple studio macro lens: fovY = 33.1 deg)
    const distBase = 10.2 + (5.1 - 10.2) * this.smoothstep(0.0, 1.15, this.zoom);
    const dist = distBase + (4.7 - distBase) * this.smoothstep(1.8, 4.0, this.zoom);
    const cp = Math.cos(this.pitch);
    const camX = Math.sin(this.yaw) * cp * dist;
    const camY = Math.sin(this.pitch) * dist;
    const camZ = Math.cos(this.yaw) * cp * dist;

    const fovY = 2.0 * Math.atan(0.5 / 1.68);
    mat4Perspective(this.projMat, fovY, this.canvasW / Math.max(1, this.canvasH), 0.12, 65.0);
    mat4LookAt(this.viewMat, camX, camY, camZ, 0, 0, 0, 0, 1, 0);
    mat4Multiply(this.viewProjMat, this.projMat, this.viewMat);

    // Determine active scale stage(s) — only draws 2 stages inside the brief cross-dissolve window!
    const z = Math.max(0, Math.min(4, this.zoom));
    const idx = Math.min(3, Math.floor(z));
    const f = z >= 4.0 ? 1.0 : z - idx;
    const semFactor = this.smoothstep(0.9, 2.1, z);

    const opticalStep = 2.85;
    const s0 = Math.pow(opticalStep, f);
    const s1 = Math.pow(opticalStep, f - 1.0);
    if (idx === 0) this.world0Scale = s0;
    if (this.hasInspect && z > 0.85) {
      this.clearInspect();
    }
    const blend = z >= 4.0 ? 1.0 : this.smoothstep(0.22, 0.78, f);

    const gl = this.gl;

    if (blend <= 0.001) {
      this.renderStagePass(idx, s0, this.hdrA, elapsedSec, camX, camY, camZ, semFactor);
    } else if (blend >= 0.999) {
      this.renderStagePass(idx + 1, s1, this.hdrB, elapsedSec, camX, camY, camZ, semFactor);
    } else {
      this.renderStagePass(idx, s0, this.hdrA, elapsedSec, camX, camY, camZ, semFactor);
      this.renderStagePass(idx + 1, s1, this.hdrB, elapsedSec, camX, camY, camZ, semFactor);
    }

    // PASS 2: Fast 3-Level Dual-Kawase Bloom
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);

    // 2a) Prefilter HDR -> bloomDown[0] (1/2 res)
    const d0 = this.bloomDown[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, d0.fbo);
    gl.viewport(0, 0, d0.w, d0.h);
    gl.useProgram(this.prefilterProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrA.tex);
    gl.uniform1i(this.uPrefilter.uTexA, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrB.tex);
    gl.uniform1i(this.uPrefilter.uTexB, 1);
    gl.uniform1f(this.uPrefilter.uBlend, blend);
    gl.uniform2f(this.uPrefilter.uTexelSize, 1.0 / this.canvasW, 1.0 / this.canvasH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2b) Downsample 1/2 -> 1/4 -> 1/8
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

    // 2c) Upsample 1/8 -> 1/4 -> 1/2
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
    gl.bindTexture(gl.TEXTURE_2D, this.hdrA.tex);
    gl.uniform1i(this.uComp.uTexA, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrB.tex);
    gl.uniform1i(this.uComp.uTexB, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomUp[1].tex);
    gl.uniform1i(this.uComp.uBloomTex, 2);
    gl.uniform2f(this.uComp.uResolution, this.canvasW, this.canvasH);
    gl.uniform1f(this.uComp.uBlend, blend);
    gl.uniform1f(this.uComp.uMotion, this.smoothMotion);
    gl.uniform1f(this.uComp.uTime, elapsedSec);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);

    const gl = this.gl;
    this.destroyRenderTargets();
    gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteTexture(this.shadowTex);
    gl.deleteBuffer(this.boxVbo);
    gl.deleteBuffer(this.boxIbo);
    gl.deleteBuffer(this.cylVbo);
    gl.deleteBuffer(this.cylIbo);
    gl.deleteVertexArray(this.emptyVao);
    for (const s of this.stages) {
      if (s.boxVao) gl.deleteVertexArray(s.boxVao);
      if (s.cylVao) gl.deleteVertexArray(s.cylVao);
      if (s.boxBuf) gl.deleteBuffer(s.boxBuf);
      if (s.cylBuf) gl.deleteBuffer(s.cylBuf);
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
