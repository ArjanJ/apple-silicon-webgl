# Silicon Microscope

An interactive, real-time WebGL2 3D silicon microscope plunging continuously across **11 physical scales** — from a **1:1 US Quarter (`72 mm`)** beside an Apple Silicon package all the way down to a **single proton (`0.84 fm`)** inside a 12 nm GAA transistor.

Built with zero runtime frameworks: pure TypeScript, custom multi-pass WebGL2 PBR shaders, GPU-refracted Liquid Glass HUD, procedural Web Audio synthesis, and optional live macOS Mach/IOKit hardware telemetry.

## Highlights
- **11-Scale Continuous Journey (`72 mm → 0.84 fm`)**: Seamless floating-origin nesting across Package + US Quarter (`1×`), Silicon Die (`4×`), BEOL Global Power Grid (`120 µm`), Copper Damascene Routing (`3.0 µm`), FEOL Standard-Cell Rows (`600 nm`), GAA Nanosheet Cell (`120 nm`), 12 nm Gate (`12 nm`), `(100)` Silicon Crystal Lattice (`0.543 nm`), Silicon-28 Atom (`111 pm`), Empty Space Plunge, Oblate `²⁸Si` Nucleus (`3.1 fm`), and Single Proton (`0.84 fm` · `uud` quarks & gluon flux).
- **Powers of Ten Auto-Dive (`Dive` / `Space`)**: One-click 35-second choreographed plunge from the US Quarter into the busiest live P-Core and down to a single proton, paired with physical scale analogies at every threshold.
- **Custom WebGL2 Deferred/Hybrid Optics**: Hardware-instanced multi-scale geometry with 2-stage PCSS shadows, half-res GTAO, planar & screen-space reflections (SSR), HDR bloom, ACES filmic tone mapping, and a **two-stage WebGL2 Liquid Glass** HUD with real optical refraction over the Retina vernier dial.
- **Live Hardware Telemetry & Real On-Device Workloads**:
  - **Local Mac (Native Mach/IOKit)**: Streams real per-core P/E-Core utilization, GPU %, VRAM, SoC die temperature, memory, and top processes via `native/mac_telemetry.m`.
  - **Pure Browser / Static Hosting**: Runs real multi-core Web Worker FMA compute, tiled FP32 GEMM matrix math, LPDDR5 Triad memory sweeps, offscreen WebGL2 GPU ALU stress, and Click-a-Core pinning — plus recorded real Apple M1 Max IOKit captures and `M1 / M2 Pro / M3 Max / M4 Max` floorplan switching.
- **5 Procedural Web Audio Soundtracks**: Zero-dependency Web Audio synthesizer (`Quantum Drift`, `Cleanroom Glass`, `Silicon Pulse`, `Late-Night Lab`, `Cyber Noir`) with a beat-locked Cold Boot power-on reveal and continuous harmonic scale feedback.

## Controls
| Input | Action |
| --- | --- |
| **Scroll / Pinch / Vernier Dial** | Zoom continuously (`0.25× → 150T×`) |
| **Drag** / **Shift + Drag** | Orbit 3D / Pan across the die |
| **Click Die Block** | Inspect block, **Dive Inside**, or **Wake Core** |
| **`Space`** | Start / stop Powers of Ten **Auto-Dive** |
| **`G`** | Toggle 1-tap **Depth Map** |
| **`V`** / **`M`** | Cycle soundtrack vibe / Mute audio |
| **`R`** | Replay Cold Boot power-on sequence |
| **`H`** | Pure View (hide HUD) |

## Run Locally
```bash
npm install
npm run dev
```

To build the optional native macOS Mach/IOKit telemetry helper:
```bash
npm run build:native
```

To create a production static build:
```bash
npm run build
```
