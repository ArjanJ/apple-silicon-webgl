import { DEFAULT_TELEMETRY, LiveMacTelemetry } from '../sim/macTelemetry';
import { FRAGMENT_SHADER, POST_FRAGMENT_SHADER, VERTEX_SHADER } from './siliconRaymarch';

export type MicroscopeMode = 'live' | 'moore';

export interface RaymarchHooks {
  onZoomChange: (uZoom: number) => void;
}

export class RaymarchEngine {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private sceneProgram: WebGLProgram;
  private postProgram: WebGLProgram;

  private fbo: WebGLFramebuffer;
  private fboTex: WebGLTexture;
  private fboW = 1;
  private fboH = 1;
  private useFloatFbo = false;

  private sceneUniforms: {
    uResolution: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
    uZoom: WebGLUniformLocation | null;
    uYaw: WebGLUniformLocation | null;
    uPitch: WebGLUniformLocation | null;
    uMode: WebGLUniformLocation | null;
    uEraProgress: WebGLUniformLocation | null;
    uMacLoads: WebGLUniformLocation | null;
    uCoreA: WebGLUniformLocation | null;
    uCoreB: WebGLUniformLocation | null;
    uNetLoad: WebGLUniformLocation | null;
    uPulsePhase: WebGLUniformLocation | null;
    uThermal: WebGLUniformLocation | null;
  };

  private postUniforms: {
    uSceneTex: WebGLUniformLocation | null;
    uResolution: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
  };

  public mode: MicroscopeMode = 'live';
  public zoom = 0.0;
  private targetZoom = 0.0;
  private yaw = -0.35;
  private pitch = 0.86;
  private targetYaw = -0.35;
  private targetPitch = 0.86;

  // Moore's Law continuous era progress 0.0 (1971) -> 1.0 (2026)
  public eraProgress = 0.0;
  private targetEraProgress = 0.0;

  // Smoothed live Mac telemetry for silky shader transitions
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

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private rafId = 0;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private disposed = false;

  constructor(container: HTMLElement, private hooks: RaymarchHooks) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required');
    }
    this.gl = gl;
    this.useFloatFbo = gl.getExtension('EXT_color_buffer_float') !== null;

    this.sceneProgram = this.createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.postProgram = this.createProgram(gl, VERTEX_SHADER, POST_FRAGMENT_SHADER);

    this.sceneUniforms = {
      uResolution: gl.getUniformLocation(this.sceneProgram, 'uResolution'),
      uTime: gl.getUniformLocation(this.sceneProgram, 'uTime'),
      uZoom: gl.getUniformLocation(this.sceneProgram, 'uZoom'),
      uYaw: gl.getUniformLocation(this.sceneProgram, 'uYaw'),
      uPitch: gl.getUniformLocation(this.sceneProgram, 'uPitch'),
      uMode: gl.getUniformLocation(this.sceneProgram, 'uMode'),
      uEraProgress: gl.getUniformLocation(this.sceneProgram, 'uEraProgress'),
      uMacLoads: gl.getUniformLocation(this.sceneProgram, 'uMacLoads'),
      uCoreA: gl.getUniformLocation(this.sceneProgram, 'uCoreA'),
      uCoreB: gl.getUniformLocation(this.sceneProgram, 'uCoreB'),
      uNetLoad: gl.getUniformLocation(this.sceneProgram, 'uNetLoad'),
      uPulsePhase: gl.getUniformLocation(this.sceneProgram, 'uPulsePhase'),
      uThermal: gl.getUniformLocation(this.sceneProgram, 'uThermal'),
    };

    this.postUniforms = {
      uSceneTex: gl.getUniformLocation(this.postProgram, 'uSceneTex'),
      uResolution: gl.getUniformLocation(this.postProgram, 'uResolution'),
      uTime: gl.getUniformLocation(this.postProgram, 'uTime'),
    };

    this.fbo = gl.createFramebuffer()!;
    this.fboTex = gl.createTexture()!;

    this.resize();
    this.bindEvents();
    this.loop();
  }

  private compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
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

  private createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
    const vs = this.compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl, gl.FRAGMENT_SHADER, fsSrc);
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

  private allocFbo(w: number, h: number): void {
    const gl = this.gl;
    this.fboW = w;
    this.fboH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (this.useFloatFbo) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public setTelemetry(t: LiveMacTelemetry): void {
    this.telemetry = t;
  }

  public setMode(mode: MicroscopeMode): void {
    this.mode = mode;
    if (mode === 'moore') {
      this.targetPitch = 0.88;
      this.targetYaw = -0.25;
    } else {
      this.flyToZoom(this.targetZoom);
    }
  }

  public setEraProgress(p: number): void {
    this.targetEraProgress = Math.max(0, Math.min(1, p));
  }

  public flyToZoom(z: number): void {
    this.targetZoom = Math.max(0, Math.min(4, z));
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
      this.targetPitch = 0.90;
      this.targetYaw = 0.16;
    } else {
      this.targetPitch = 0.62;
      this.targetYaw = 0.34;
    }
  }

  private resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const cw = Math.floor(w * dpr);
    const ch = Math.floor(h * dpr);
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.allocFbo(cw, ch);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = -e.deltaY * (e.ctrlKey ? 0.0065 : 0.0014);
    if (this.mode === 'live') {
      this.targetZoom = Math.max(0, Math.min(4, this.targetZoom + delta));
    } else {
      // In Moore's Law Time Machine, pinching/scrolling forward scrubs through the decades!
      this.targetEraProgress = Math.max(0, Math.min(1, this.targetEraProgress + delta * 0.25));
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.targetYaw -= dx * 0.0065;
    this.targetPitch = Math.max(0.28, Math.min(1.52, this.targetPitch + dy * 0.0055));
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const elapsedSec = (now - this.startTime) / 1000;

    // Smooth live Mac telemetry
    const lr = Math.min(1, dt * 4.5);
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

    const prevZ = this.zoom;
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 4.5);
    if (Math.abs(this.zoom - prevZ) > 0.0008) {
      this.hooks.onZoomChange(this.zoom);
    }
    this.eraProgress += (this.targetEraProgress - this.eraProgress) * Math.min(1, dt * 6.0);

    if (this.autoOrbit && !this.dragging) {
      this.targetYaw += dt * 0.075;
    }
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 5.0);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 5.0);

    const gl = this.gl;

    // PASS 1: Render HDR 3D PBR + 1-Bounce Reflection SDF Raymarching into FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.sceneProgram);
    gl.uniform2f(this.sceneUniforms.uResolution, this.fboW, this.fboH);
    gl.uniform1f(this.sceneUniforms.uTime, elapsedSec);
    gl.uniform1f(this.sceneUniforms.uZoom, this.zoom);
    gl.uniform1f(this.sceneUniforms.uYaw, this.yaw);
    gl.uniform1f(this.sceneUniforms.uPitch, this.pitch);
    gl.uniform1f(this.sceneUniforms.uMode, this.mode === 'moore' ? 1.0 : 0.0);
    gl.uniform1f(this.sceneUniforms.uEraProgress, this.eraProgress);
    gl.uniform4f(this.sceneUniforms.uMacLoads, this.smoothP, this.smoothE, this.smoothGpu, this.smoothMem);
    gl.uniform4f(
      this.sceneUniforms.uCoreA,
      this.smoothCores[0],
      this.smoothCores[1],
      this.smoothCores[2],
      this.smoothCores[3]
    );
    gl.uniform4f(
      this.sceneUniforms.uCoreB,
      this.smoothCores[4],
      this.smoothCores[5],
      this.smoothCores[6],
      this.smoothCores[7]
    );
    gl.uniform1f(this.sceneUniforms.uNetLoad, this.smoothNet);
    gl.uniform1f(this.sceneUniforms.uPulsePhase, this.pulsePhase);
    gl.uniform1f(this.sceneUniforms.uThermal, this.thermal ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // PASS 2: Optical Bloom + Edge Microscope DoF + Chromatic Dispersion + SEM Film Grain -> Screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.postProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(this.postUniforms.uSceneTex, 0);
    gl.uniform2f(this.postUniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.postUniforms.uTime, elapsedSec);
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
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.fboTex);
    this.gl.deleteProgram(this.sceneProgram);
    this.gl.deleteProgram(this.postProgram);
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
