# Silicon Microscope (3nm GPU 3D Raymarcher)

An interactive, photorealistic 2-pass WebGL2 GLSL 3D raymarched silicon microscope that traces any keystroke (`A–Z`, `0–9`) across **100,000,000×** of continuous physical scale—from a `12 mm` Apple-Silicon-style SoC package down to a `3 nm` Gate-All-Around stacked nanosheet fin array on granular crystalline silicon.

## Highlights
- **Pure GPU WebGL2 2-Pass Pipeline** (`src/shader/siliconRaymarch.ts`, `src/shader/RaymarchEngine.ts`):
  - **Pass 1**: Lipschitz-safe analytical SDF raymarching with real micro-bevels, 5-tap ambient occlusion, soft shadows, physical SiO₂ thin-film spectral iridescence, and **real 1-bounce raymarched metallic reflections** + studio softbox HDRI.
  - **Pass 2**: Multi-tap HDR optical bloom, radial microscope edge depth-of-field, subtle chromatic dispersion, ACES filmic tone mapping, and fine SEM sensor grain.
- **6-Chapter Keystroke Journey** (`src/sim/microJourney.ts`):
  1. `10× · 12 mm` — Asymmetric Silicon Die + Twin Unified RAM + Dual-Cap SMDs
  2. `2.5K× · 60 µm` — Parallel Micro-Striations & Bus Canyons
  3. `250K× · 800 nm` — Sculpted 3-Layer SEM Silver-Titanium Metal Canyons & Circular Vias
  4. `8M× · 25 nm` — Repeating Nanometer Cell Fortresses latching your key's live 8-bit ASCII binary
  5. `100M× · 3 nm` — 2-Tier Stacked 3 nm GAA Fin/Nanosheet Array (`0.72V ON / 0V OFF` switch)
  6. `T+400 µs` — Optical Display Pixel Output of your exact typed character
- **Controls**: Press any letter (`A–Z`, `0–9`) to trace it, pinch/scroll to zoom continuously (`10× → 100M×`), drag to orbit in 3D, `Space` to play/pause, `←`/`→` to step chapters.

## Run Locally
```bash
npm install
npm run dev
```
