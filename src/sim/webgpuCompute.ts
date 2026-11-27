/**
 * Real WebGPU Compute Workload Engine (WGSL Tiled GEMM + Vec4 FMA ALU Kernel).
 *
 * Inspired by vgpu.sh's explicit compute-pipeline architecture:
 *   - Runs genuine WGSL @compute shaders on the visitor's GPU (Apple Silicon / discrete GPU)
 *   - 'matrix': 16x16 workgroup shared-memory tiled FP32 GEMM (var<workgroup> tileA / tileB)
 *   - 'gpu'   : Massively parallel vec4<f32> FMA compute kernel across storage buffers
 *   - Timed via GPUQueue.onSubmittedWorkDone() for honest, live GFLOPS / TFLOPS measurements
 *   - Zero external dependencies & graceful fallback when navigator.gpu is unavailable
 */

interface GpuBufferLike {
  destroy(): void;
}

interface GpuQueueLike {
  writeBuffer(buffer: GpuBufferLike, bufferOffset: number, data: ArrayBufferView): void;
  submit(commandBuffers: unknown[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface GpuComputePassLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  finish(): unknown;
}

interface GpuDeviceLike {
  queue: GpuQueueLike;
  lost: Promise<unknown>;
  createShaderModule(desc: { code: string }): unknown;
  createBuffer(desc: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike;
  createComputePipeline(desc: {
    layout: 'auto';
    compute: { module: unknown; entryPoint: string };
  }): { getBindGroupLayout(index: number): unknown };
  createBindGroup(desc: {
    layout: unknown;
    entries: { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  destroy(): void;
}

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string; description?: string };
  requestDevice(): Promise<GpuDeviceLike | null>;
}

interface NavigatorGpuLike {
  requestAdapter(opts?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapterLike | null>;
}

const GPU_USAGE_STORAGE = 0x0080;
const GPU_USAGE_UNIFORM = 0x0040;
const GPU_USAGE_COPY_DST = 0x0008;

/** 16x16 workgroup shared-memory tiled FP32 GEMM: C = A * B (N x N) */
const TILED_GEMM_WGSL = /* wgsl */ `
struct GemmParams {
  n: u32,
  seed: f32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: GemmParams;
@group(0) @binding(1) var<storage, read> matA: array<f32>;
@group(0) @binding(2) var<storage, read> matB: array<f32>;
@group(0) @binding(3) var<storage, read_write> matC: array<f32>;

const TILE: u32 = 16u;
var<workgroup> tileA: array<f32, 256>;
var<workgroup> tileB: array<f32, 256>;

@compute @workgroup_size(16, 16, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>
) {
  let n = params.n;
  let row = gid.y;
  let col = gid.x;
  let localIdx = lid.y * TILE + lid.x;

  var acc: f32 = params.seed * 1e-6;
  let numTiles = n / TILE;

  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let aCol = t * TILE + lid.x;
    let bRow = t * TILE + lid.y;
    tileA[localIdx] = matA[row * n + aCol];
    tileB[localIdx] = matB[bRow * n + col];
    workgroupBarrier();

    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      acc = fma(tileA[lid.y * TILE + k], tileB[k * TILE + lid.x], acc);
    }
    workgroupBarrier();
  }

  matC[row * n + col] = acc;
}
`;

/** High-intensity vec4<f32> FMA compute kernel saturating GPU shader cores */
const ALU_FMA_WGSL = /* wgsl */ `
struct AluParams {
  count: u32,
  seed: f32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: AluParams;
@group(0) @binding(1) var<storage, read_write> data: array<vec4<f32>>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.count) {
    return;
  }
  var v0 = data[idx] + vec4<f32>(params.seed * 0.001, 0.13, 0.27, 0.41);
  var v1 = v0.yzwx * 0.9997 + vec4<f32>(0.017, -0.011, 0.023, -0.019);
  var v2 = v0.zwxy * 1.0003 - vec4<f32>(0.013, 0.029, -0.017, 0.011);
  var v3 = v0.wxyz * 0.9999 + vec4<f32>(0.007, 0.019, 0.011, -0.023);
  let kA = vec4<f32>(0.99991, 1.00007, 0.99993, 1.00005);
  let kB = vec4<f32>(1.00003, 0.99995, 1.00009, 0.99991);

  // 128 iterations * 8 vec4 FMAs * 8 FLOPs/vec4-fma = 8,192 FLOPs per invocation
  for (var i: u32 = 0u; i < 128u; i = i + 1u) {
    v0 = fma(v0, kA, v1 * 0.0001);
    v1 = fma(v1, kB, v2 * 0.0001);
    v2 = fma(v2, kA, v3 * 0.0001);
    v3 = fma(v3, kB, v0 * 0.0001);
    v0 = fma(v0, kB, -v2 * 0.0001);
    v1 = fma(v1, kA, -v3 * 0.0001);
    v2 = fma(v2, kB, -v0 * 0.0001);
    v3 = fma(v3, kA, -v1 * 0.0001);
  }

  data[idx] = (v0 + v1 + v2 + v3) * 0.25;
}
`;

export interface WebGpuSliceResult {
  gflops: number;
  elapsedMs: number;
}

export class WebGpuComputeEngine {
  private device: GpuDeviceLike | null = null;
  private initPromise: Promise<boolean> | null = null;
  private unavailable = false;

  // Tiled GEMM resources (N x N FP32)
  private gemmN = 512;
  private gemmPipeline: { getBindGroupLayout(index: number): unknown } | null = null;
  private gemmBindGroup: unknown = null;
  private gemmParamsBuf: GpuBufferLike | null = null;
  private gemmBufA: GpuBufferLike | null = null;
  private gemmBufB: GpuBufferLike | null = null;
  private gemmBufC: GpuBufferLike | null = null;

  // Vec4 FMA ALU resources
  private aluCount = 65536;
  private aluPipeline: { getBindGroupLayout(index: number): unknown } | null = null;
  private aluBindGroup: unknown = null;
  private aluParamsBuf: GpuBufferLike | null = null;
  private aluBuf: GpuBufferLike | null = null;

  private paramScratch = new ArrayBuffer(16);
  private paramU32 = new Uint32Array(this.paramScratch);
  private paramF32 = new Float32Array(this.paramScratch);

  constructor(private isMobile: boolean) {
    this.gemmN = isMobile ? 256 : 512;
    this.aluCount = isMobile ? 32768 : 65536;
  }

  public static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as unknown as { gpu?: unknown }).gpu);
  }

  public async ensureReady(): Promise<boolean> {
    if (this.device) return true;
    if (this.unavailable) return false;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const navGpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
        if (!navGpu) {
          this.unavailable = true;
          return false;
        }
        const adapter = await navGpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) {
          this.unavailable = true;
          return false;
        }
        const device = await adapter.requestDevice();
        if (!device) {
          this.unavailable = true;
          return false;
        }

        this.device = device;
        void device.lost.then(() => {
          this.resetDeviceState();
        });

        this.buildGemmResources(device);
        this.buildAluResources(device);
        return true;
      } catch {
        this.unavailable = true;
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  private buildGemmResources(device: GpuDeviceLike): void {
    const n = this.gemmN;
    const elems = n * n;
    const byteSize = elems * 4;

    const aInit = new Float32Array(elems);
    const bInit = new Float32Array(elems);
    for (let i = 0; i < elems; i++) {
      aInit[i] = (((i * 37) & 127) - 64) * 0.015;
      bInit[i] = (((i * 53) & 127) - 64) * 0.015;
    }

    const paramsBuf = device.createBuffer({ size: 16, usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST });
    const bufA = device.createBuffer({ size: byteSize, usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST });
    const bufB = device.createBuffer({ size: byteSize, usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST });
    const bufC = device.createBuffer({ size: byteSize, usage: GPU_USAGE_STORAGE });

    device.queue.writeBuffer(bufA, 0, aInit);
    device.queue.writeBuffer(bufB, 0, bInit);

    const mod = device.createShaderModule({ code: TILED_GEMM_WGSL });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: bufA } },
        { binding: 2, resource: { buffer: bufB } },
        { binding: 3, resource: { buffer: bufC } },
      ],
    });

    this.gemmParamsBuf = paramsBuf;
    this.gemmBufA = bufA;
    this.gemmBufB = bufB;
    this.gemmBufC = bufC;
    this.gemmPipeline = pipeline;
    this.gemmBindGroup = bindGroup;
  }

  private buildAluResources(device: GpuDeviceLike): void {
    const count = this.aluCount;
    const initData = new Float32Array(count * 4);
    for (let i = 0; i < initData.length; i++) {
      initData[i] = 0.5 + ((i * 19) % 97) * 0.005;
    }

    const paramsBuf = device.createBuffer({ size: 16, usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST });
    const buf = device.createBuffer({ size: initData.byteLength, usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST });
    device.queue.writeBuffer(buf, 0, initData);

    const mod = device.createShaderModule({ code: ALU_FMA_WGSL });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: buf } },
      ],
    });

    this.aluParamsBuf = paramsBuf;
    this.aluBuf = buf;
    this.aluPipeline = pipeline;
    this.aluBindGroup = bindGroup;
  }

  /** Run one compute slice and await GPU queue completion for real throughput measurement */
  public async runSlice(kind: 'gpu' | 'matrix', seed: number): Promise<WebGpuSliceResult | null> {
    const device = this.device;
    if (!device) return null;

    if (kind === 'matrix') {
      if (!this.gemmPipeline || !this.gemmBindGroup || !this.gemmParamsBuf) return null;
      const n = this.gemmN;
      const dispatches = this.isMobile ? 2 : 6;
      const groups = n / 16;

      this.paramU32[0] = n;
      this.paramF32[1] = seed;
      this.paramU32[2] = 0;
      this.paramU32[3] = 0;
      device.queue.writeBuffer(this.gemmParamsBuf, 0, this.paramU32);

      const t0 = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.gemmPipeline);
      pass.setBindGroup(0, this.gemmBindGroup);
      for (let d = 0; d < dispatches; d++) {
        pass.dispatchWorkgroups(groups, groups, 1);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const elapsedMs = Math.max(0.25, performance.now() - t0);
      const totalFlops = 2 * n * n * n * dispatches;
      return {
        gflops: totalFlops / (elapsedMs * 1e6),
        elapsedMs,
      };
    }

    if (!this.aluPipeline || !this.aluBindGroup || !this.aluParamsBuf) return null;
    const count = this.aluCount;
    const dispatches = this.isMobile ? 2 : 6;
    const groups = Math.ceil(count / 64);

    this.paramU32[0] = count;
    this.paramF32[1] = seed;
    this.paramU32[2] = 0;
    this.paramU32[3] = 0;
    device.queue.writeBuffer(this.aluParamsBuf, 0, this.paramU32);

    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.aluPipeline);
    pass.setBindGroup(0, this.aluBindGroup);
    for (let d = 0; d < dispatches; d++) {
      pass.dispatchWorkgroups(groups, 1, 1);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const elapsedMs = Math.max(0.25, performance.now() - t0);
    // 128 iterations * 8 vec4 FMAs * 8 FLOPs/vec4-fma = 8,192 FLOPs per invocation
    const totalFlops = count * 8192 * dispatches;
    return {
      gflops: totalFlops / (elapsedMs * 1e6),
      elapsedMs,
    };
  }

  private resetDeviceState(): void {
    this.gemmParamsBuf?.destroy();
    this.gemmBufA?.destroy();
    this.gemmBufB?.destroy();
    this.gemmBufC?.destroy();
    this.aluParamsBuf?.destroy();
    this.aluBuf?.destroy();
    this.gemmParamsBuf = null;
    this.gemmBufA = null;
    this.gemmBufB = null;
    this.gemmBufC = null;
    this.aluParamsBuf = null;
    this.aluBuf = null;
    this.gemmPipeline = null;
    this.gemmBindGroup = null;
    this.aluPipeline = null;
    this.aluBindGroup = null;
    this.device = null;
  }

  public dispose(): void {
    const dev = this.device;
    this.resetDeviceState();
    dev?.destroy();
  }
}
