# Silicon Microscope (Live Mac X-Ray + 1971–2026 Time Machine)

An interactive, photorealistic 2-pass WebGL2 GLSL 3D raymarched silicon microscope with two flagship modes:

1. **Live Mac X-Ray (`10× → 100M×`)**: Streams real live per-core CPU utilization (P-Cores & E-Cores), Unified Memory usage, Network I/O, chip model (`sysctl`), and active running processes directly from your Mac into the 3D raymarched silicon die—plus a one-click **Burst Mac** Web Worker stress trigger.
2. **Moore's Law Time Machine (`1971 → 2026`)**: Locks the microscope onto a fixed `10 µm × 10 µm` patch of silicon (one single 1971 Intel 4004 transistor) and physically shrinks & subdivides the 3D transistors across 55 years until **11.1 million** modern `3 nm` GAA switches pack inside that exact 1971 footprint.

## Rendering Pipeline (`src/shader/siliconRaymarch.ts` & `src/shader/RaymarchEngine.ts`)
- **Pass 1**: Lipschitz-safe analytical 3D SDF raymarching with real micro-bevels, 5-tap ambient occlusion, soft shadows, physical SiO₂ thin-film spectral iridescence, and **real 1-bounce raymarched metallic reflections** + studio softbox HDRI.
- **Pass 2**: Multi-tap HDR optical bloom, radial microscope edge depth-of-field, subtle chromatic dispersion, ACES filmic tone mapping, and fine SEM sensor grain.

## Run Locally
```bash
npm install
npm run dev
```

