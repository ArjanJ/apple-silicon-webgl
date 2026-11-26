export type BlockId = 'pCores' | 'eCores' | 'gpu' | 'npu' | 'slc' | 'ramL' | 'ramR' | 'io' | 'media';

export interface BlockMeta {
  id: BlockId;
  name: string;
  shortName: string;
  role: string;
  color: string;
  hex: number;
  // Die-space 3D center (in Stage 0/1 world coords where die spans roughly [-3.2..3.2] x [-2.5..2.5])
  pos: [number, number];
  size: [number, number];
  subGrid?: [number, number]; // sub-cores inside this block (e.g., 4x2 P-cores, 4x4 GPU cores)
}

export const CHIP_BLOCKS: Record<BlockId, BlockMeta> = {
  pCores: {
    id: 'pCores',
    name: 'Performance Cores (8× P-Cores)',
    shortName: 'P-CORES',
    role: 'Heavy math, physics, compiling & complex app logic',
    color: '#ffb347',
    hex: 0xffb347,
    pos: [-1.55, -1.05],
    size: [2.7, 1.85],
    subGrid: [4, 2],
  },
  eCores: {
    id: 'eCores',
    name: 'Efficiency Cores (4× E-Cores)',
    shortName: 'E-CORES',
    role: 'Typing, cursor tracking, background OS & battery-sipping tasks',
    color: '#4cc9ff',
    hex: 0x4cc9ff,
    pos: [-1.55, 0.9],
    size: [2.7, 1.35],
    subGrid: [4, 1],
  },
  slc: {
    id: 'slc',
    name: 'System Level Cache (24 MB)',
    shortName: 'CACHE',
    role: 'Ultra-fast shared memory highway linking CPU, GPU & Neural Engine',
    color: '#ffe299',
    hex: 0xffe299,
    pos: [0.15, -0.15],
    size: [0.55, 3.65],
    subGrid: [1, 8],
  },
  gpu: {
    id: 'gpu',
    name: 'Graphics Processor (16-Core GPU)',
    shortName: '16-CORE GPU',
    role: 'Drawing, animations, shadows, text pixels & 3D shaders',
    color: '#29f2d8',
    hex: 0x29f2d8,
    pos: [1.85, -0.78],
    size: [2.5, 2.38],
    subGrid: [4, 4],
  },
  npu: {
    id: 'npu',
    name: 'Neural Engine (16-Core NPU)',
    shortName: 'NEURAL ENGINE',
    role: 'AI models, image recognition & fast matrix math',
    color: '#c96bff',
    hex: 0xc96bff,
    pos: [1.85, 1.25],
    size: [2.5, 1.25],
    subGrid: [8, 2],
  },
  io: {
    id: 'io',
    name: 'I/O & HID Controller',
    shortName: 'USB / I/O',
    role: 'Catches every physical keystroke, trackpad move & USB packet first',
    color: '#4eff9b',
    hex: 0x4eff9b,
    pos: [-1.55, 2.02],
    size: [2.7, 0.6],
    subGrid: [6, 1],
  },
  media: {
    id: 'media',
    name: 'Display & Audio Engine',
    shortName: 'DISPLAY / AUDIO',
    role: 'Scans 60Hz frames to your screen & synthesizes audio waveforms',
    color: '#ff6e82',
    hex: 0xff6e82,
    pos: [1.85, 2.2],
    size: [2.5, 0.44],
    subGrid: [5, 1],
  },
  ramL: {
    id: 'ramL',
    name: 'Unified Memory (LPDDR5X-A)',
    shortName: 'UNIFIED RAM',
    role: 'Shared high-bandwidth memory pool (left package)',
    color: '#5e8bff',
    hex: 0x5e8bff,
    pos: [-4.65, 0.0],
    size: [1.5, 4.6],
  },
  ramR: {
    id: 'ramR',
    name: 'Unified Memory (LPDDR5X-B)',
    shortName: 'UNIFIED RAM',
    role: 'Shared high-bandwidth memory pool (right package)',
    color: '#5e8bff',
    hex: 0x5e8bff,
    pos: [4.65, 0.0],
    size: [1.5, 4.6],
  },
};

export interface SignalPacket {
  id: number;
  from: BlockId;
  to: BlockId;
  color: number;
  progress: number; // 0..1
  speed: number; // progress units per second
  delay: number; // seconds before launch
  label: string;
}

export interface BitEvent {
  bit: 0 | 1;
  sourceLabel: string; // e.g., "Letter 'H' (01001000) · bit 6"
  color: string;
}

export interface ActivityEvent {
  id: number;
  title: string;
  story: string;
  route: string[];
  color: string;
  timestamp: number;
}

export class ChipSimulator {
  public load: Record<BlockId, number> = {
    pCores: 0.06,
    eCores: 0.14,
    gpu: 0.08,
    npu: 0.04,
    slc: 0.1,
    ramL: 0.08,
    ramR: 0.08,
    io: 0.06,
    media: 0.18,
  };

  public tempC = 35.0;
  public powerW = 1.6;
  public clockGHz = 1.2;
  public opsPerSec = 0;

  public packets: SignalPacket[] = [];
  private nextPacketId = 1;
  private nextEventId = 1;

  // Live Transistor Gate State (driven by real ASCII/cursor/AI bits!)
  public gateVoltage = 0.0; // 0.0V (OFF) to 0.72V (ON)
  public targetGateBit: 0 | 1 = 0;
  public manualGateOverride: boolean | null = null; // null = auto live bitstream
  public currentBitLabel = 'Idle OS heartbeat (waiting for input)';
  public currentBitColor = '#4cc9ff';
  private bitQueue: BitEvent[] = [];
  private bitTimer = 0;

  // Slow-motion multiplier (0.25 = slow-mo so you can follow packets easily, 1.0 = snappy)
  public slowMo = true;

  // Latest plain-English story event
  public lastEvent: ActivityEvent = {
    id: 0,
    title: 'Chip Idling (OS Heartbeat)',
    story:
      'Your Mac is quietly breathing at 1.6W: one Efficiency Core checks for input while the Display Engine refreshes the screen 60 times a second. Try typing, drawing, or running AI on the left!',
    route: ['E-Core', 'Cache', 'Display Engine'],
    color: '#4cc9ff',
    timestamp: Date.now(),
  };

  private idleTimer = 0;
  private cursorThrottle = 0;

  private pushEvent(title: string, story: string, route: string[], color: string): void {
    this.lastEvent = {
      id: this.nextEventId++,
      title,
      story,
      route,
      color,
      timestamp: Date.now(),
    };
  }

  private spawnChain(
    hops: { from: BlockId; to: BlockId; color: number; label: string }[],
    stagger = 0.17,
    speed = 2.1
  ): void {
    for (let i = 0; i < hops.length; i++) {
      if (this.packets.length > 90) this.packets.shift();
      this.packets.push({
        id: this.nextPacketId++,
        from: hops[i].from,
        to: hops[i].to,
        color: hops[i].color,
        progress: 0,
        speed,
        delay: i * stagger,
        label: hops[i].label,
      });
    }
  }

  private enqueueBits(value: number, bitCount: number, labelPrefix: string, color: string): void {
    // Keep queue responsive (trim stale bits if typing fast)
    if (this.bitQueue.length > 16) this.bitQueue.splice(0, this.bitQueue.length - 8);
    const binStr = (value & ((1 << bitCount) - 1)).toString(2).padStart(bitCount, '0');
    for (let i = bitCount - 1; i >= 0; i--) {
      const bit = ((value >>> i) & 1) as 0 | 1;
      this.bitQueue.push({
        bit,
        sourceLabel: `${labelPrefix} (${binStr}) · bit ${i}`,
        color,
      });
    }
  }

  // --- Interactive Triggers from Mini-Mac Playground ---

  public triggerKeypress(char: string): void {
    const code = char.length === 1 ? char.charCodeAt(0) : 13;
    const printable = char === ' ' ? 'SPACE' : char.length === 1 ? `'${char}'` : char;
    const bin = (code & 0xff).toString(2).padStart(8, '0');

    this.load.io = Math.min(1, this.load.io + 0.85);
    this.load.eCores = Math.min(1, this.load.eCores + 0.75);
    this.load.slc = Math.min(1, this.load.slc + 0.55);
    this.load.ramL = Math.min(1, this.load.ramL + 0.45);
    this.load.gpu = Math.min(1, this.load.gpu + 0.55);
    this.load.media = Math.min(1, this.load.media + 0.5);

    this.spawnChain([
      { from: 'io', to: 'eCores', color: 0x4eff9b, label: `HID ${printable}` },
      { from: 'eCores', to: 'slc', color: 0x4cc9ff, label: `ASCII ${bin}` },
      { from: 'slc', to: 'ramL', color: 0x5e8bff, label: 'Write Buffer' },
      { from: 'slc', to: 'gpu', color: 0x29f2d8, label: 'Draw Glyph' },
      { from: 'gpu', to: 'media', color: 0xff6e82, label: 'Display Scan' },
    ]);

    this.enqueueBits(code, 8, `Key ${printable}`, '#4eff9b');

    this.pushEvent(
      `Typed ${printable}  →  Binary ${bin}`,
      `Your keyboard sent an electrical interrupt to the I/O Controller, which woke an Efficiency Core to decode ${printable} (${bin}), stored it in Unified Memory, and told the GPU to paint the letter onto your screen.`,
      ['USB / I/O', 'E-Core', 'Cache & RAM', 'GPU', 'Display'],
      '#4eff9b'
    );
  }

  public triggerCursorMove(nx: number, ny: number): void {
    const now = performance.now();
    if (now - this.cursorThrottle < 90) return;
    this.cursorThrottle = now;

    const xPx = Math.round(nx * 100);
    const yPx = Math.round(ny * 100);

    this.load.io = Math.min(1, this.load.io + 0.45);
    this.load.eCores = Math.min(1, this.load.eCores + 0.35);
    this.load.gpu = Math.min(1, this.load.gpu + 0.28);
    this.load.media = Math.min(1, this.load.media + 0.35);

    this.spawnChain(
      [
        { from: 'io', to: 'eCores', color: 0x4eff9b, label: 'HID XY' },
        { from: 'eCores', to: 'gpu', color: 0x4cc9ff, label: 'Move Cursor' },
        { from: 'gpu', to: 'media', color: 0x29f2d8, label: 'Composite' },
      ],
      0.1,
      2.6
    );

    if (this.bitQueue.length < 4) {
      this.enqueueBits((xPx ^ yPx) & 0x3f, 6, `Cursor (${xPx},${yPx})`, '#4cc9ff');
    }

    this.pushEvent(
      `Cursor Moved (${xPx}%, ${yPx}%)`,
      `Trackpad coordinates hit the I/O Controller, an Efficiency Core computes the new pointer position without waking the big P-Cores, and the Display Engine composites the cursor overlay.`,
      ['I/O HID', 'E-Core', 'GPU', 'Display'],
      '#4cc9ff'
    );
  }

  public triggerGpuDraw(nx: number, ny: number): void {
    const now = performance.now();
    if (now - this.cursorThrottle < 65) return;
    this.cursorThrottle = now;

    this.load.io = Math.min(1, this.load.io + 0.5);
    this.load.gpu = Math.min(1, this.load.gpu + 0.92);
    this.load.slc = Math.min(1, this.load.slc + 0.72);
    this.load.ramR = Math.min(1, this.load.ramR + 0.68);
    this.load.media = Math.min(1, this.load.media + 0.65);

    this.spawnChain(
      [
        { from: 'io', to: 'slc', color: 0x4eff9b, label: 'Brush Input' },
        { from: 'slc', to: 'gpu', color: 0x29f2d8, label: 'Shader Burst' },
        { from: 'gpu', to: 'ramR', color: 0x5e8bff, label: 'Framebuffer' },
        { from: 'gpu', to: 'media', color: 0xff6e82, label: 'Scanout' },
      ],
      0.08,
      2.8
    );

    const val = (Math.round(nx * 255) ^ Math.round(ny * 255)) & 0xff;
    this.enqueueBits(val, 6, 'GPU Pixel Shader', '#29f2d8');

    this.pushEvent(
      'GPU Brush Painting (16 Cores Active)',
      `All 16 GPU Cores fire in parallel to blend glowing brush pixels, streaming color values straight into Unified Memory and pushing live frames through the Display Engine.`,
      ['I/O', '16-Core GPU', 'Unified RAM', 'Display'],
      '#29f2d8'
    );
  }

  public triggerAudioSynth(): void {
    this.load.eCores = Math.min(1, this.load.eCores + 0.65);
    this.load.media = Math.min(1, this.load.media + 0.95);
    this.load.slc = Math.min(1, this.load.slc + 0.5);
    this.load.ramL = Math.min(1, this.load.ramL + 0.4);

    this.spawnChain([
      { from: 'eCores', to: 'slc', color: 0x4cc9ff, label: 'Audio DSP' },
      { from: 'slc', to: 'ramL', color: 0x5e8bff, label: 'PCM Samples' },
      { from: 'slc', to: 'media', color: 0xff6e82, label: '48kHz DAC' },
    ]);

    this.enqueueBits(0b10110101, 8, '48kHz Audio Wave', '#ff6e82');

    this.pushEvent(
      'Audio Synth Played (48 kHz PCM)',
      `An Efficiency Core calculates real-time sine & harmonic samples in memory and streams them through the Media/Audio Engine to your speakers.`,
      ['E-Core', 'Cache', 'Audio Engine'],
      '#ff6e82'
    );
  }

  public triggerNeuralAI(): void {
    this.load.npu = 1.0;
    this.load.slc = 0.95;
    this.load.ramR = 0.95;
    this.load.ramL = 0.85;
    this.load.pCores = Math.min(1, this.load.pCores + 0.45);
    this.load.gpu = Math.min(1, this.load.gpu + 0.35);

    this.spawnChain(
      [
        { from: 'ramR', to: 'npu', color: 0x5e8bff, label: 'Model Weights' },
        { from: 'ramL', to: 'slc', color: 0x5e8bff, label: 'Tensor Tile' },
        { from: 'slc', to: 'npu', color: 0xc96bff, label: '16×16 MatMul' },
        { from: 'npu', to: 'slc', color: 0xc96bff, label: 'Activations' },
        { from: 'slc', to: 'pCores', color: 0xffb347, label: 'Top-K Result' },
      ],
      0.11,
      2.3
    );

    this.enqueueBits(0b11010110, 8, 'AI Matrix Multiply', '#c96bff');

    this.pushEvent(
      'Neural Engine AI Pass (38 TOPS Burst)',
      `The 16-Core Neural Engine pulls model weights directly from Unified Memory at high bandwidth, executing thousands of matrix multiplications simultaneously without bogging down the CPU.`,
      ['Unified RAM', 'Neural Engine', 'Cache', 'P-Core'],
      '#c96bff'
    );
  }

  public triggerHeavyCompute(): void {
    this.load.pCores = 1.0;
    this.load.slc = 0.95;
    this.load.ramL = 0.92;
    this.load.ramR = 0.85;
    this.load.gpu = Math.min(1, this.load.gpu + 0.65);

    this.spawnChain(
      [
        { from: 'ramL', to: 'slc', color: 0x5e8bff, label: 'L2 Prefetch' },
        { from: 'slc', to: 'pCores', color: 0xffb347, label: '8-Thread Burst' },
        { from: 'pCores', to: 'slc', color: 0xffb347, label: 'ALU Writeback' },
        { from: 'slc', to: 'ramR', color: 0x5e8bff, label: 'Commit State' },
        { from: 'slc', to: 'gpu', color: 0x29f2d8, label: 'Render Frame' },
      ],
      0.09,
      2.5
    );

    this.enqueueBits(0b11101011, 8, 'P-Core 4.2GHz Math', '#ffb347');

    this.pushEvent(
      'Heavy Compute Burst (All 8 P-Cores @ 4.2 GHz)',
      `All 8 high-performance P-Cores turbo-boost together, pulling data from Unified Memory through the 24 MB Cache and heating the silicon die up as billions of transistors switch in unison.`,
      ['Unified RAM', 'Cache', '8× P-Cores', 'GPU'],
      '#ffb347'
    );
  }

  // --- Per-Frame Update ---

  public update(dt: number): void {
    const timeScale = this.slowMo ? 0.45 : 1.0;
    const simDt = dt * timeScale;

    // Gentle decay of block loads back toward realistic idle baselines
    const baselines: Record<BlockId, number> = {
      pCores: 0.05,
      eCores: 0.14,
      gpu: 0.07,
      npu: 0.03,
      slc: 0.09,
      ramL: 0.07,
      ramR: 0.07,
      io: 0.05,
      media: 0.16,
    };

    const decay = Math.exp(-dt * 1.45);
    let totalLoad = 0;
    (Object.keys(this.load) as BlockId[]).forEach((k) => {
      this.load[k] = baselines[k] + (this.load[k] - baselines[k]) * decay;
      totalLoad += this.load[k];
    });

    // Realistic dynamic telemetry (Power, Temp, Clock)
    const avgLoad = totalLoad / 9;
    const targetPower = 1.4 + this.load.pCores * 14 + this.load.gpu * 10 + this.load.npu * 7 + avgLoad * 3;
    this.powerW += (targetPower - this.powerW) * Math.min(1, dt * 3.5);
    const targetTemp = 34 + (this.powerW / 32) * 44;
    this.tempC += (targetTemp - this.tempC) * Math.min(1, dt * 1.1);
    const targetClock = 1.1 + Math.max(this.load.pCores, this.load.eCores * 0.65) * 3.1;
    this.clockGHz += (targetClock - this.clockGHz) * Math.min(1, dt * 4.0);
    this.opsPerSec = Math.round((0.8 + avgLoad * 24) * 10) / 10;

    // Periodic gentle idle OS heartbeat packet so the chip always feels subtly alive
    this.idleTimer += dt;
    if (this.idleTimer >= 1.8) {
      this.idleTimer = 0;
      if (this.packets.length < 4) {
        this.spawnChain(
          [
            { from: 'eCores', to: 'slc', color: 0x4cc9ff, label: 'OS Tick' },
            { from: 'slc', to: 'media', color: 0xff6e82, label: '60Hz VSync' },
          ],
          0.22,
          1.4
        );
      }
    }

    // Advance 3D signal packets
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i];
      if (p.delay > 0) {
        p.delay -= simDt;
        continue;
      }
      p.progress += p.speed * simDt;
      if (p.progress >= 1.0) {
        // Flash destination block softly on arrival
        this.load[p.to] = Math.min(1, this.load[p.to] + 0.14);
        this.packets.splice(i, 1);
      }
    }

    // Drive the 3nm Transistor Gate Voltage from live bitstream (or manual toggle!)
    if (this.manualGateOverride !== null) {
      this.targetGateBit = this.manualGateOverride ? 1 : 0;
      this.currentBitLabel = this.manualGateOverride
        ? 'Manual Gate Override → 0.72V (ON · Electrons Flowing)'
        : 'Manual Gate Override → 0.00V (OFF · Channel Blocked)';
      this.currentBitColor = this.manualGateOverride ? '#29f2d8' : '#7b8799';
    } else {
      this.bitTimer += dt;
      const stepDur = this.slowMo ? 0.42 : 0.16;
      if (this.bitTimer >= stepDur) {
        this.bitTimer = 0;
        const next = this.bitQueue.shift();
        if (next) {
          this.targetGateBit = next.bit;
          this.currentBitLabel = next.sourceLabel;
          this.currentBitColor = next.color;
        } else {
          // Gentle idle clock pulse
          this.targetGateBit = this.targetGateBit === 1 ? 0 : 1;
          this.currentBitLabel = 'Idle OS Clock Heartbeat · 1.2 GHz';
          this.currentBitColor = '#4cc9ff';
        }
      }
    }

    const targetV = this.targetGateBit === 1 ? 0.72 : 0.0;
    this.gateVoltage += (targetV - this.gateVoltage) * Math.min(1, dt * 11);
  }
}
