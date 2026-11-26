import { MICRO_CHAPTERS, MicroJourneyState } from '../sim/microJourney';
import { FRAGMENT_SHADER, POST_FRAGMENT_SHADER, VERTEX_SHADER } from './siliconRaymarch';

export interface RaymarchHooks {
  onZoomChange: (uZoom: number) => void;
  onChapterChange: (idx: number) => void;
}

/**
 * 2-Pass WebGL2 GPU Raymarching + Optical Microscope Post-Processing Engine.
 *   Pass 1 -> Renders full 3D PBR + 1-bounce reflection SDF raymarching into an offscreen FBO
 *   Pass 2 -> Applies multi-tap optical bloom, radial microscope DoF, chromatic dispersion & film grain
 */
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
    uKeyBits: WebGLUniformLocation | null;
    uGateOn: WebGLUniformLocation | null;
    uPulsePhase: WebGLUniformLocation | null;
    uThermal: WebGLUniformLocation | null;
    uChapter: WebGLUniformLocation | null;
  };

  private postUniforms: {
    uSceneTex: WebGLUniformLocation | null;
    uResolution: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
  };

  public zoom = 0.0;
  private targetZoom = 0.0;
  private yaw = -0.35;
  private pitch = 0.88;
  private targetYaw = -0.35;
  private targetPitch = 0.88;

  public thermal = false;
  public autoOrbit = false;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private rafId = 0;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private disposed = false;

  constructor(container: HTMLElement, private journey: MicroJourneyState, private hooks: RaymarchHooks) {
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
      throw new Error('WebGL2 is required for GPU 3D Raymarching');
    }
    this.gl = gl;

    // Enable HDR RGBA16F render target if supported (standard on macOS Metal / WebGL2!)
    this.useFloatFbo = gl.getExtension('EXT_color_buffer_float') !== null;

    this.sceneProgram = this.createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.postProgram = this.createProgram(gl, VERTEX_SHADER, POST_FRAGMENT_SHADER);

    this.sceneUniforms = {
      uResolution: gl.getUniformLocation(this.sceneProgram, 'uResolution'),
      uTime: gl.getUniformLocation(this.sceneProgram, 'uTime'),
      uZoom: gl.getUniformLocation(this.sceneProgram, 'uZoom'),
      uYaw: gl.getUniformLocation(this.sceneProgram, 'uYaw'),
      uPitch: gl.getUniformLocation(this.sceneProgram, 'uPitch'),
      uKeyBits: gl.getUniformLocation(this.sceneProgram, 'uKeyBits'),
      uGateOn: gl.getUniformLocation(this.sceneProgram, 'uGateOn'),
      uPulsePhase: gl.getUniformLocation(this.sceneProgram, 'uPulsePhase'),
      uThermal: gl.getUniformLocation(this.sceneProgram, 'uThermal'),
      uChapter: gl.getUniformLocation(this.sceneProgram, 'uChapter'),
    };

    this.postUniforms = {
      uSceneTex: gl.getUniformLocation(this.postProgram, 'uSceneTex'),
      uResolution: gl.getUniformLocation(this.postProgram, 'uResolution'),
      uTime: gl.getUniformLocation(this.postProgram, 'uTime'),
    };

    this.fbo = gl.createFramebuffer()!;
    this.fboTex = gl.createTexture()!;

    this.journey.onChapterChange = (idx) => {
      this.flyToChapter(idx);
      this.hooks.onChapterChange(idx);
    };

    this.resize();
    this.bindEvents();
    this.flyToChapter(this.journey.chapterIdx);
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

  public flyToChapter(idx: number): void {
    const ch = MICRO_CHAPTERS[idx];
    if (!ch) return;
    this.targetZoom = ch.targetZoom;
    this.targetYaw = ch.yaw;
    this.targetPitch = ch.pitch;
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
    this.targetZoom = Math.max(0, Math.min(4, this.targetZoom + delta));
    if (Math.abs(delta) > 0.012) {
      this.journey.playing = false;
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
    this.targetPitch = Math.max(0.26, Math.min(1.52, this.targetPitch + dy * 0.0055));
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

    this.journey.update(dt);

    const prevZ = this.zoom;
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 4.2);
    if (Math.abs(this.zoom - prevZ) > 0.0008) {
      this.hooks.onZoomChange(this.zoom);
    }

    if ((this.autoOrbit || this.journey.playing) && !this.dragging) {
      this.targetYaw += dt * (this.autoOrbit ? 0.22 : 0.055);
    }
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 5.0);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 5.0);

    const gl = this.gl;

    // PASS 1: Render HDR 3D PBR + 1-Bounce Reflection Raymarching into Offscreen FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.sceneProgram);
    gl.uniform2f(this.sceneUniforms.uResolution, this.fboW, this.fboH);
    gl.uniform1f(this.sceneUniforms.uTime, elapsedSec);
    gl.uniform1f(this.sceneUniforms.uZoom, this.zoom);
    gl.uniform1f(this.sceneUniforms.uYaw, this.yaw);
    gl.uniform1f(this.sceneUniforms.uPitch, this.pitch);
    gl.uniform1f(this.sceneUniforms.uKeyBits, this.journey.ascii);
    gl.uniform1f(this.sceneUniforms.uGateOn, this.journey.gateOn);
    gl.uniform1f(this.sceneUniforms.uPulsePhase, this.journey.pulsePhase);
    gl.uniform1f(this.sceneUniforms.uThermal, this.thermal ? 1.0 : 0.0);
    gl.uniform1f(this.sceneUniforms.uChapter, this.journey.chapterIdx);
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
