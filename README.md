# Silicon Microscope — Live Mac X-Ray

An interactive, photorealistic 2-pass WebGL2 GLSL 3D raymarched silicon microscope streaming **real live hardware telemetry from your Mac** (`10×` down to `100,000,000×` / `3 nm`).

## Features
- **Live Mac X-Ray (`10× → 100M×`)**: Automatically detects your Apple Silicon chip (`sysctl`), streams real-time per-core CPU utilization (P-Cores & E-Cores), Unified Memory usage (`vm_stat`), Network I/O (`netstat`), and top running processes into the 3D raymarched silicon die—plus a one-click **Burst Mac** Web Worker stress trigger.
- **2-Pass GPU WebGL2 Raymarching Pipeline** (`src/shader/siliconRaymarch.ts` & `src/shader/RaymarchEngine.ts`):
  - **Pass 1**: Lipschitz-safe analytical 3D SDF raymarching with real micro-bevels, 5-tap ambient occlusion, soft shadows, physical SiO₂ thin-film spectral iridescence, and **real 1-bounce raymarched metallic reflections** + studio softbox HDRI.
  - **Pass 2**: Multi-tap HDR optical bloom, radial microscope edge depth-of-field, subtle chromatic dispersion, ACES filmic tone mapping, and fine SEM sensor grain.
- **Controls**: Pinch on trackpad / scroll to zoom continuously (`10× → 100M×`), click & drag to orbit in 3D, toggle **Thermal** infrared vision or **Orbit** rotation, or hit **Burst Mac**.

## Run Locally
```bash
npm install
npm run dev
```

