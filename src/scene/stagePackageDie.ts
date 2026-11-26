import * as THREE from 'three';
import { BlockId, CHIP_BLOCKS } from '../sim/chipSim';
import { KeystrokeStoryEngine } from '../sim/storyEngine';
import { createSiliconDiePBR, createSubstratePBR } from './dieTextures';

function makeLabelTexture(title: string, subtitle: string, accentHex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 148;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);

  ctx.fillStyle = 'rgba(7, 10, 16, 0.84)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 484, 120, 16);
  ctx.fill();
  ctx.strokeStyle = accentHex;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#f5f9ff';
  ctx.font = '700 40px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 72);

  ctx.fillStyle = accentHex;
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(subtitle, 256, 110);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function makeLidTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, '#323741');
  grad.addColorStop(0.35, '#1e222a');
  grad.addColorStop(0.55, '#373d48');
  grad.addColorStop(1, '#171a21');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Fine CNC brushed titanium grain
  ctx.fillStyle = 'rgba(255,255,255,0.022)';
  for (let y = 0; y < 1024; y += 2) {
    ctx.fillRect(0, y, 1024, 1);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 5;
  ctx.strokeRect(36, 36, 952, 952);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(244, 248, 255, 0.92)';
  ctx.font = '700 94px Inter, -apple-system, sans-serif';
  ctx.fillText('M-3NM', 512, 464);

  ctx.fillStyle = 'rgba(175, 192, 218, 0.72)';
  ctx.font = '500 30px "JetBrains Mono", monospace';
  ctx.fillText('28 BILLION TRANSISTORS · 3nm GAA', 512, 536);

  ctx.fillStyle = 'rgba(130, 152, 182, 0.48)';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.fillText('PRESS ANY KEY TO TRACE ITS JOURNEY', 512, 608);

  // Pin-1 corner triangle
  ctx.fillStyle = 'rgba(225, 232, 245, 0.6)';
  ctx.beginPath();
  ctx.moveTo(78, 882);
  ctx.lineTo(132, 936);
  ctx.lineTo(78, 936);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRamTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 768;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 256, 768);
  grad.addColorStop(0, '#181d29');
  grad.addColorStop(0.5, '#121620');
  grad.addColorStop(1, '#1a2030');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 768);
  ctx.strokeStyle = 'rgba(94, 139, 255, 0.34)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 236, 748);

  ctx.save();
  ctx.translate(128, 384);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(220, 232, 255, 0.84)';
  ctx.font = '700 34px "JetBrains Mono", monospace';
  ctx.fillText(label, 0, -6);
  ctx.fillStyle = 'rgba(120, 168, 255, 0.72)';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.fillText('LPDDR5X · 400 GB/s', 0, 30);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Physical 3D Manhattan signal highway routes on the package & die!
const ROUTED_PATHS: Record<string, THREE.Vector3[]> = {
  // USB/HID pin edge at bottom of substrate -> USB/I/O block on die
  pin_to_io: [
    new THREE.Vector3(-1.55, 0.04, 3.62),
    new THREE.Vector3(-1.55, 0.14, 2.95),
    new THREE.Vector3(-1.55, 0.31, 2.02),
  ],
  // USB/I/O -> E-Core 0 (leftmost Efficiency Core)
  io_to_ecore: [
    new THREE.Vector3(-1.55, 0.31, 2.02),
    new THREE.Vector3(-2.35, 0.31, 1.55),
    new THREE.Vector3(-2.35, 0.31, 0.9),
  ],
  // E-Core 0 -> 24MB System Level Cache
  ecore_to_slc: [
    new THREE.Vector3(-2.35, 0.31, 0.9),
    new THREE.Vector3(-0.45, 0.31, 0.9),
    new THREE.Vector3(0.15, 0.31, 0.45),
  ],
  // 24MB Cache -> Left Unified RAM (LPDDR5X)
  slc_to_ramL: [
    new THREE.Vector3(0.15, 0.31, 0.45),
    new THREE.Vector3(0.15, 0.31, -0.05),
    new THREE.Vector3(-3.3, 0.31, -0.05),
    new THREE.Vector3(-4.55, 0.36, -0.05),
  ],
  // 24MB Cache -> 16-Core GPU
  slc_to_gpu: [
    new THREE.Vector3(0.15, 0.31, -0.05),
    new THREE.Vector3(0.95, 0.31, -0.05),
    new THREE.Vector3(1.85, 0.31, -0.78),
  ],
  // 16-Core GPU -> Display Engine
  gpu_to_media: [
    new THREE.Vector3(1.85, 0.31, -0.78),
    new THREE.Vector3(1.85, 0.31, 0.9),
    new THREE.Vector3(1.85, 0.31, 2.2),
  ],
};

function samplePolyline(pts: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const clamped = Math.max(0, Math.min(1, t));
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    lens.push(l);
    total += l;
  }
  let target = clamped * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const local = lens[i] > 0 ? target / lens[i] : 0;
      return out.lerpVectors(pts[i], pts[i + 1], local);
    }
    target -= lens[i];
  }
  return out.copy(pts[pts.length - 1]);
}

interface SubCoreEntry {
  blockId: BlockId;
  coreIndex: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  phase: number;
}

const COMET_BEADS = 12;
const MAX_COMETS = 4;

export class StagePackageDie {
  public readonly group = new THREE.Group();
  public readonly clickableMeshes: THREE.Object3D[] = [];

  private lidGroup = new THREE.Group();
  private lidMat: THREE.MeshPhysicalMaterial;
  private blockGlowMats: Partial<Record<BlockId, THREE.MeshStandardMaterial>> = {};
  private subCores: SubCoreEntry[] = [];
  private labelPlanes: THREE.Mesh[] = [];
  private traceMats: Record<string, THREE.MeshStandardMaterial> = {};

  // Multi-bead HDR Comet Pools for crisp luminous trails along physical traces!
  private cometMeshes: THREE.Mesh[][] = [];
  private cometMats: THREE.MeshBasicMaterial[][] = [];

  // Chapter 7 Holographic Pixel Matrix rising right out of the Display Engine!
  private holoGroup = new THREE.Group();
  private holoPixels: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; r: number; c: number }[] = [];
  private holoBeamMat: THREE.MeshBasicMaterial;
  private holoFrameMat: THREE.MeshStandardMaterial;

  private tmpVec = new THREE.Vector3();

  constructor() {
    // 1. High-Density Organic Package Substrate with PBR relief
    const subPBR = createSubstratePBR();
    const subGeo = new THREE.BoxGeometry(11.6, 0.36, 7.2);
    const subMat = new THREE.MeshStandardMaterial({
      map: subPBR.albedo,
      bumpMap: subPBR.bump,
      bumpScale: 0.025,
      roughness: 0.42,
      metalness: 0.35,
    });
    const substrate = new THREE.Mesh(subGeo, subMat);
    substrate.position.y = -0.22;
    this.group.add(substrate);

    // Machined metallic lower flange
    const flange = new THREE.Mesh(
      new THREE.BoxGeometry(11.74, 0.14, 7.34),
      new THREE.MeshStandardMaterial({ color: 0x262c34, roughness: 0.28, metalness: 0.88 })
    );
    flange.position.y = -0.35;
    this.group.add(flange);

    // Glowing USB-C / HID Input Pin Header on bottom edge (where Chapter 1's keystroke enters!)
    const pinBar = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.12, 0.28),
      new THREE.MeshStandardMaterial({
        color: 0xe6be68,
        emissive: 0x4eff9b,
        emissiveIntensity: 0.35,
        metalness: 0.9,
        roughness: 0.2,
      })
    );
    pinBar.position.set(-1.55, -0.02, 3.52);
    this.group.add(pinBar);

    // 2. 110+ Gleaming Gold-Capped SMD Ceramic Decoupling Capacitors
    const capBodyGeo = new THREE.BoxGeometry(0.15, 0.09, 0.075);
    const capGoldGeo = new THREE.BoxGeometry(0.20, 0.085, 0.072);
    const capBodyMat = new THREE.MeshStandardMaterial({ color: 0x735231, roughness: 0.35, metalness: 0.35 });
    const capGoldMat = new THREE.MeshStandardMaterial({ color: 0xf2cb74, roughness: 0.18, metalness: 0.95 });

    const capPositions: [number, number, number][] = [];
    for (let i = -13; i <= 13; i++) {
      capPositions.push([i * 0.25, 0.005, -3.06]);
      if (Math.abs(i + 6) > 2) capPositions.push([i * 0.25, 0.005, 3.06]);
    }
    for (let j = -9; j <= 9; j++) {
      capPositions.push([-3.62, 0.005, j * 0.26]);
      capPositions.push([3.62, 0.005, j * 0.26]);
    }

    const capBodies = new THREE.InstancedMesh(capBodyGeo, capBodyMat, capPositions.length);
    const capEnds = new THREE.InstancedMesh(capGoldGeo, capGoldMat, capPositions.length);
    const dummy = new THREE.Object3D();
    capPositions.forEach(([x, y, z], idx) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.abs(x) > 3.5 ? Math.PI / 2 : 0, 0);
      dummy.updateMatrix();
      capBodies.setMatrixAt(idx, dummy.matrix);
      capEnds.setMatrixAt(idx, dummy.matrix);
    });
    this.group.add(capBodies, capEnds);

    // 3. Twin Unified Memory (LPDDR5X) Packages
    (['ramL', 'ramR'] as BlockId[]).forEach((ramId) => {
      const meta = CHIP_BLOCKS[ramId];
      const ramMat = new THREE.MeshStandardMaterial({
        map: makeRamTexture(ramId === 'ramL' ? 'UNIFIED RAM A' : 'UNIFIED RAM B'),
        color: 0xffffff,
        emissive: new THREE.Color(meta.hex),
        emissiveIntensity: 0.05,
        roughness: 0.32,
        metalness: 0.55,
      });
      const ramMesh = new THREE.Mesh(new THREE.BoxGeometry(meta.size[0], 0.34, meta.size[1]), ramMat);
      ramMesh.position.set(meta.pos[0], 0.13, meta.pos[1]);
      ramMesh.userData.blockId = ramId;
      this.group.add(ramMesh);
      this.clickableMeshes.push(ramMesh);
      this.blockGlowMats[ramId] = ramMat;
    });

    // 4. Photorealistic 2048×1600 Micro-Circuit Silicon Die Wafer (Albedo + Bump + Roughness + Iridescence!)
    const diePBR = createSiliconDiePBR();
    const dieMat = new THREE.MeshPhysicalMaterial({
      map: diePBR.albedo,
      bumpMap: diePBR.bump,
      bumpScale: 0.045,
      roughnessMap: diePBR.roughness,
      roughness: 0.22,
      metalness: 0.82,
      iridescence: 0.92,
      iridescenceIOR: 1.75,
      iridescenceThicknessRange: [160, 560],
      clearcoat: 0.95,
      clearcoatRoughness: 0.12,
    });
    const dieBase = new THREE.Mesh(new THREE.BoxGeometry(6.65, 0.24, 5.25), dieMat);
    dieBase.position.y = 0.08;
    this.group.add(dieBase);

    // 5. Sleek Translucent Emissive Overlays + Raised Sub-Core Tiles + Floating Labels
    const dieBlockIds: BlockId[] = ['pCores', 'eCores', 'slc', 'gpu', 'npu', 'io', 'media'];
    for (const id of dieBlockIds) {
      const b = CHIP_BLOCKS[id];
      // Ultra-thin perimeter highlight frame (never hides the 2048px micro-circuit detail beneath!)
      const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.size[0], 0.05, b.size[1]));
      const frameMat = new THREE.LineBasicMaterial({
        color: b.hex,
        transparent: true,
        opacity: 0.65,
      });
      const frame = new THREE.LineSegments(frameGeo, frameMat);
      frame.position.set(b.pos[0], 0.22, b.pos[1]);
      this.group.add(frame);

      // Subtle translucent glow plate that illuminates with HDR bloom ONLY when this block is active in the story!
      const glowMat = new THREE.MeshStandardMaterial({
        color: b.hex,
        emissive: new THREE.Color(b.hex),
        emissiveIntensity: 0.06,
        transparent: true,
        opacity: 0.14,
        roughness: 0.2,
        metalness: 0.6,
        depthWrite: false,
      });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(b.size[0], 0.03, b.size[1]), glowMat);
      plate.position.set(b.pos[0], 0.215, b.pos[1]);
      plate.userData.blockId = id;
      this.group.add(plate);
      this.clickableMeshes.push(plate);
      this.blockGlowMats[id] = glowMat;

      if (b.subGrid) {
        const [cols, rows] = b.subGrid;
        const pad = 0.12;
        const cellW = (b.size[0] - pad * (cols + 1)) / cols;
        const cellH = (b.size[1] - pad * (rows + 1)) / rows;
        const tileGeo = new THREE.BoxGeometry(cellW * 0.92, 0.03, cellH * 0.92);

        let coreIdx = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tileMat = new THREE.MeshStandardMaterial({
              color: b.hex,
              emissive: new THREE.Color(b.hex),
              emissiveIntensity: 0.06,
              transparent: true,
              opacity: 0.16,
              roughness: 0.15,
              metalness: 0.7,
              depthWrite: false,
            });
            const tile = new THREE.Mesh(tileGeo, tileMat);
            const tx = b.pos[0] - b.size[0] / 2 + pad + cellW / 2 + c * (cellW + pad);
            const tz = b.pos[1] - b.size[1] / 2 + pad + cellH / 2 + r * (cellH + pad);
            tile.position.set(tx, 0.232, tz);
            tile.userData.blockId = id;
            this.group.add(tile);
            this.clickableMeshes.push(tile);
            this.subCores.push({
              blockId: id,
              coreIndex: coreIdx++,
              mesh: tile,
              mat: tileMat,
              phase: c * 0.55 + r * 0.85,
            });
          }
        }
      }

      const subtitleMap: Record<BlockId, string> = {
        pCores: '8× HIGH PERF',
        eCores: '4× EFFICIENCY',
        slc: '24 MB',
        gpu: '16× GRAPHICS',
        npu: '16× AI MATRIX',
        io: 'USB / KEYBOARD',
        media: 'DISPLAY ENGINE',
        ramL: 'LPDDR5X',
        ramR: 'LPDDR5X',
      };
      const lblW = Math.min(b.size[0] * 0.86, 1.85);
      const lblH = lblW * (148 / 512);
      const lblMat = new THREE.MeshBasicMaterial({
        map: makeLabelTexture(b.shortName, subtitleMap[id], b.color),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const lblMesh = new THREE.Mesh(new THREE.PlaneGeometry(lblW, lblH), lblMat);
      lblMesh.rotation.x = -Math.PI / 2;
      lblMesh.position.set(b.pos[0], 0.355, b.pos[1]);
      this.group.add(lblMesh);
      this.labelPlanes.push(lblMesh);
    }

    // 6. Physical 3D Routed Interconnect Highway Conduits on the Die
    for (const [key, pts] of Object.entries(ROUTED_PATHS)) {
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) {
        curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      }
      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.032, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x3b485c,
        emissive: 0x1a2838,
        emissiveIntensity: 0.2,
        metalness: 0.85,
        roughness: 0.25,
        transparent: true,
        opacity: 0.72,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      this.group.add(tube);
      this.traceMats[key] = tubeMat;
    }

    // 7. HDR Glowing Comet Trails (head + 11 tapered tail orbs per active hop!)
    const beadGeo = new THREE.SphereGeometry(0.11, 12, 12);
    for (let c = 0; c < MAX_COMETS; c++) {
      const beads: THREE.Mesh[] = [];
      const mats: THREE.MeshBasicMaterial[] = [];
      for (let b = 0; b < COMET_BEADS; b++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1 - b / COMET_BEADS,
        });
        const m = new THREE.Mesh(beadGeo, mat);
        m.visible = false;
        this.group.add(m);
        beads.push(m);
        mats.push(mat);
      }
      this.cometMeshes.push(beads);
      this.cometMats.push(mats);
    }

    // 8. Brushed Space-Black Titanium Heatspreader Lid
    const lidGeo = new THREE.BoxGeometry(6.95, 0.26, 5.55);
    this.lidMat = new THREE.MeshPhysicalMaterial({
      map: makeLidTexture(),
      color: 0xffffff,
      metalness: 0.84,
      roughness: 0.24,
      clearcoat: 0.45,
      transparent: true,
      opacity: 1.0,
    });
    const lidMesh = new THREE.Mesh(lidGeo, this.lidMat);
    lidMesh.position.y = 0.38;
    this.lidGroup.add(lidMesh);
    this.group.add(this.lidGroup);

    // 9. Chapter 7 Holographic Pixel Display rising right off the Display Engine!
    this.holoGroup.position.set(1.85, 0.3, 2.2);
    this.holoGroup.visible = false;

    // Translucent projection cone beaming up from Display Engine
    this.holoBeamMat = new THREE.MeshBasicMaterial({
      color: 0x29f2d8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.35, 1.35, 4, 1, true), this.holoBeamMat);
    cone.position.y = 0.68;
    cone.rotation.y = Math.PI / 4;
    this.holoGroup.add(cone);

    // Sleek dark glass holographic frame holding the 5×7 pixel matrix
    this.holoFrameMat = new THREE.MeshStandardMaterial({
      color: 0x0a131f,
      emissive: 0x10283d,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.78,
      roughness: 0.15,
      metalness: 0.5,
    });
    const holoScreen = new THREE.Mesh(new THREE.BoxGeometry(1.85, 2.35, 0.08), this.holoFrameMat);
    holoScreen.position.y = 2.45;
    this.holoGroup.add(holoScreen);

    const frameBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 2.4, 0.1)),
      new THREE.LineBasicMaterial({ color: 0x29f2d8 })
    );
    frameBorder.position.y = 2.45;
    this.holoGroup.add(frameBorder);

    // 5×7 3D Luminous Voxel Pixels!
    const pxGeo = new THREE.BoxGeometry(0.24, 0.24, 0.12);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x162230,
          emissive: 0x29f2d8,
          emissiveIntensity: 0.05,
          roughness: 0.15,
          metalness: 0.3,
        });
        const px = new THREE.Mesh(pxGeo, mat);
        px.position.set((c - 2) * 0.3, 2.45 + (3 - r) * 0.29, 0.04);
        this.holoGroup.add(px);
        this.holoPixels.push({ mesh: px, mat, r, c });
      }
    }
    this.group.add(this.holoGroup);
  }

  public update(
    story: KeystrokeStoryEngine,
    u: number,
    time: number,
    xrayLid: boolean,
    thermalMode: boolean,
    selectedBlock: BlockId | null
  ): void {
    // Lid stays neatly closed in Chapter 1 (u ≈ 0.05), opens smoothly as you zoom in or toggle X-Ray,
    // AND opens cleanly in Chapter 7 so you see the Display Engine beam out the holographic letter!
    const forceOpen = xrayLid || story.chapterIndex === 7;
    const lidOpen = forceOpen ? 1.0 : THREE.MathUtils.clamp((u - 0.15) / 0.65, 0, 1);
    this.lidGroup.position.y = lidOpen * 2.4;
    this.lidMat.opacity = Math.max(0, 1 - lidOpen * 1.25);
    this.lidGroup.visible = this.lidMat.opacity > 0.02;

    const labelAlpha = THREE.MathUtils.clamp(lidOpen * 1.15, 0, 1) * THREE.MathUtils.clamp(1.72 - u, 0, 1);
    for (const lp of this.labelPlanes) {
      lp.visible = labelAlpha > 0.03;
      (lp.material as THREE.MeshBasicMaterial).opacity = labelAlpha * 0.92;
    }

    const thermalColor = (heat: number): THREE.Color => {
      const c = new THREE.Color();
      if (heat < 0.35) c.setHSL(0.72 - heat * 0.6, 0.9, 0.25 + heat * 0.5);
      else if (heat < 0.7) c.setHSL(0.08 + (0.7 - heat) * 0.35, 1.0, 0.48 + (heat - 0.35) * 0.4);
      else c.setHSL(0.13, 1.0, 0.68 + (heat - 0.7) * 0.9);
      return c;
    };

    // Story-driven block illumination (only active blocks glow brightly with HDR bloom!)
    (Object.keys(this.blockGlowMats) as BlockId[]).forEach((id) => {
      const mat = this.blockGlowMats[id];
      if (!mat) return;
      const load = story.blockLoad[id] ?? 0.05;
      const isSel = selectedBlock === id;
      if (thermalMode) {
        mat.emissive.copy(thermalColor(load));
        mat.emissiveIntensity = 0.25 + load * 2.2;
        if (mat.transparent) mat.opacity = 0.22 + load * 0.45;
      } else {
        mat.emissive.setHex(CHIP_BLOCKS[id].hex);
        mat.emissiveIntensity = 0.04 + load * 1.9 + (isSel ? 0.6 : 0);
        if (mat.transparent) mat.opacity = 0.06 + load * 0.34;
      }
    });

    // Sub-core illumination: highlight E-Core 0 specifically in Chapters 1-2, sweep GPU cores in Ch 6!
    for (const sc of this.subCores) {
      let load = story.blockLoad[sc.blockId] ?? 0.05;
      if (sc.blockId === 'eCores' && story.chapterIndex <= 5) {
        // Spotlight E-Core 0 specifically so the user sees ONE exact core wake up for their keystroke!
        load = sc.coreIndex === 0 ? Math.max(load, 0.95) : load * 0.18;
      }
      const wave = (Math.sin(time * 6 + sc.phase) + 1) * 0.5;
      const intensity = load * (0.65 + wave * 1.65);
      if (thermalMode) {
        sc.mat.emissive.copy(thermalColor(load));
        sc.mat.emissiveIntensity = 0.2 + intensity * 1.1;
      } else {
        sc.mat.emissive.setHex(CHIP_BLOCKS[sc.blockId].hex);
        sc.mat.emissiveIntensity = intensity;
      }
      sc.mat.opacity = 0.05 + load * 0.42;
      sc.mesh.position.y = 0.232 + load * wave * 0.022;
    }

    // Reset trace conduits to dim copper, then brighten ONLY the active story conduits!
    for (const mat of Object.values(this.traceMats)) {
      mat.emissive.setHex(0x162230);
      mat.emissiveIntensity = 0.15;
    }

    for (let c = 0; c < MAX_COMETS; c++) {
      const hop = story.activeHops[c];
      const beads = this.cometMeshes[c];
      const mats = this.cometMats[c];
      if (!hop || !ROUTED_PATHS[hop.pathKey]) {
        for (let b = 0; b < COMET_BEADS; b++) beads[b].visible = false;
        continue;
      }

      const pts = ROUTED_PATHS[hop.pathKey];
      const tMat = this.traceMats[hop.pathKey];
      if (tMat) {
        tMat.emissive.setHex(hop.color);
        tMat.emissiveIntensity = 0.85;
      }

      const headColor = new THREE.Color(0xffffff);
      const tailColor = new THREE.Color(hop.color);

      for (let b = 0; b < COMET_BEADS; b++) {
        const bt = hop.progress - b * 0.026;
        if (bt < 0 || bt > 1) {
          beads[b].visible = false;
          continue;
        }
        beads[b].visible = true;
        samplePolyline(pts, bt, this.tmpVec);
        beads[b].position.copy(this.tmpVec);
        const falloff = 1 - b / COMET_BEADS;
        beads[b].scale.setScalar(0.35 + falloff * 0.95);
        mats[b].color.copy(tailColor).lerp(headColor, Math.pow(falloff, 2.5));
        mats[b].opacity = falloff * hop.intensity;
      }
    }

    // Chapter 7: Holographic Pixel Glyph materializing pixel-by-pixel right above Display Engine!
    const showHolo = story.chapterIndex === 7 && u < 1.5;
    this.holoGroup.visible = showHolo;
    if (showHolo) {
      const rev = story.hologramReveal;
      this.holoGroup.rotation.y = Math.sin(time * 0.9) * 0.22 - 0.35;
      this.holoBeamMat.opacity = 0.08 + rev * 0.14;
      const glyph = story.activeGlyph;
      const totalPx = 35;
      const litCutoff = Math.floor(rev * (totalPx + 4));

      for (const hp of this.holoPixels) {
        const idx = hp.r * 5 + hp.c;
        const isOn = glyph[hp.r]?.[hp.c] === 1 && idx <= litCutoff;
        const isScanFront = idx === litCutoff || idx === litCutoff - 1;
        if (isOn) {
          hp.mat.color.setHex(0xd8fff9);
          hp.mat.emissive.setHex(isScanFront ? 0xffffff : 0x29f2d8);
          hp.mat.emissiveIntensity = isScanFront ? 3.2 : 1.85;
          hp.mesh.scale.setScalar(1.0);
        } else {
          hp.mat.color.setHex(0x131d2b);
          hp.mat.emissive.setHex(0x13283d);
          hp.mat.emissiveIntensity = 0.12;
          hp.mesh.scale.setScalar(0.75);
        }
      }
    }
  }
}
