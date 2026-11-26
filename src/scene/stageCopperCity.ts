import * as THREE from 'three';
import { KeystrokeStoryEngine } from '../sim/storyEngine';

/**
 * Stage 2 (200 µm): 10-Story 3D Copper Metal Interconnect Metropolis (M1–M8)
 *   - Now features a blazing HERO SIGNAL COMET physically descending down
 *     the copper highways and plunging through vertical copper Vias to the floor!
 *
 * Stage 3 (2 µm):   8-Bit Logic Register Floor
 *   - Hero row of 8 sculpted FinFET logic cells displaying the EXACT 8-bit binary
 *     fingerprint of the key the user pressed (e.g. 'A' = 0 1 0 0 0 0 0 1)!
 */

function makeBitSprite(bitIdx: number, val: string, isOn: boolean, isFocused: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 180;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);

  ctx.fillStyle = isOn ? 'rgba(12, 42, 48, 0.92)' : 'rgba(12, 16, 24, 0.85)';
  ctx.beginPath();
  ctx.roundRect(10, 10, 140, 160, 16);
  ctx.fill();

  ctx.strokeStyle = isFocused ? '#ffb347' : isOn ? '#29f2d8' : '#334157';
  ctx.lineWidth = isFocused ? 5 : 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = isFocused ? '#ffd68a' : '#8da2c4';
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(`BIT ${7 - bitIdx}`, 80, 44);

  ctx.fillStyle = isOn ? '#9afff4' : '#586882';
  ctx.font = '700 80px "JetBrains Mono", monospace';
  ctx.fillText(val, 80, 128);

  ctx.fillStyle = isOn ? '#29f2d8' : '#4d5c75';
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText(isOn ? '0.72V' : '0.00V', 80, 156);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// Deliberate continuous 3D path descending from Top Highway M8 -> vertical Via -> M5 -> Via -> M2 -> Logic Floor!
const HERO_DESCENT_PATH: THREE.Vector3[] = [
  new THREE.Vector3(-5.8, 2.25, -1.8),
  new THREE.Vector3(1.2, 2.25, -1.8),
  new THREE.Vector3(1.2, 0.56, -1.8), // Plunge down Via #1!
  new THREE.Vector3(1.2, 0.56, 2.1),
  new THREE.Vector3(-2.4, 0.56, 2.1),
  new THREE.Vector3(-2.4, -1.12, 2.1), // Plunge down Via #2!
  new THREE.Vector3(-2.4, -1.12, 0.0),
  new THREE.Vector3(0.0, -1.12, 0.0),
  new THREE.Vector3(0.0, -2.1, 0.0), // Drop straight into Logic Floor!
];

function samplePath(pts: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const cl = Math.max(0, Math.min(1, t));
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    lens.push(l);
    total += l;
  }
  let dist = cl * total;
  for (let i = 0; i < lens.length; i++) {
    if (dist <= lens[i] || i === lens.length - 1) {
      const f = lens[i] > 0 ? dist / lens[i] : 0;
      return out.lerpVectors(pts[i], pts[i + 1], f);
    }
    dist -= lens[i];
  }
  return out.copy(pts[pts.length - 1]);
}

interface BitCellVisual {
  bodyMat: THREE.MeshStandardMaterial;
  railMat: THREE.MeshStandardMaterial;
  spriteMat: THREE.SpriteMaterial;
  lastKey: string;
}

export class StageCopperCity {
  public readonly metalGroup = new THREE.Group();
  public readonly logicGroup = new THREE.Group();

  private heroCometBeads: THREE.Mesh[] = [];
  private heroCometMats: THREE.MeshBasicMaterial[] = [];
  private bgPulseMesh!: THREE.InstancedMesh;
  private bgPulseTracks: { y: number; axis: 'x' | 'z'; fixed: number; speed: number; offset: number }[] = [];

  // Stage 3: 8 Hero Bit Register Cells displaying the EXACT 8-bit ASCII binary!
  private bitCells: BitCellVisual[] = [];
  private bgLogicMats: { mat: THREE.MeshStandardMaterial; phase: number }[] = [];

  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();

  constructor() {
    this.buildMetalCity();
    this.buildLogicFloor();
  }

  private buildMetalCity(): void {
    // Dark silicon floor below
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x080c14, roughness: 0.25, metalness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.25;
    this.metalGroup.add(floor);

    // 8 stacked metallic copper layers (M1 fine -> M8 thick power/signal highways)
    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xc97b46,
      emissive: 0x261004,
      emissiveIntensity: 0.2,
      metalness: 0.94,
      roughness: 0.2,
    });

    const bars: { pos: [number, number, number]; sc: [number, number, number] }[] = [];
    const vias: { pos: [number, number, number]; h: number; r: number }[] = [];
    const span = 12.6;

    for (let l = 0; l < 8; l++) {
      const y = -1.78 + l * 0.56;
      const isX = l % 2 === 0;
      const pitch = 0.54 + l * 0.15;
      const thickness = 0.08 + l * 0.025;
      const height = 0.12 + l * 0.022;
      const count = Math.floor(span / pitch);

      for (let i = 0; i < count; i++) {
        const coord = -span / 2 + (i + 0.5) * pitch;
        const hash = Math.sin(l * 31.7 + i * 17.3) * 43758.5453;
        const frac = hash - Math.floor(hash);
        const segLen = span * (0.48 + frac * 0.46);
        const segShift = (frac - 0.5) * (span - segLen) * 0.65;

        bars.push({
          pos: isX ? [segShift, y, coord] : [coord, y, segShift],
          sc: isX ? [segLen, height, thickness] : [thickness, height, segLen],
        });

        if ((i + l) % 5 === 0 && this.bgPulseTracks.length < 48) {
          this.bgPulseTracks.push({
            y: y + height * 0.55,
            axis: isX ? 'x' : 'z',
            fixed: coord,
            speed: (1.5 + frac * 2.0) * (i % 2 === 0 ? 1 : -1),
            offset: (frac - 0.5) * span,
          });
        }

        if (l > 0 && (i * 7 + l * 3) % 4 === 0 && vias.length < 210) {
          const vx = isX ? segShift + (frac - 0.5) * 4.5 : coord;
          const vz = isX ? coord : segShift + (frac - 0.5) * 4.5;
          vias.push({ pos: [vx, y - 0.28, vz], h: 0.56, r: 0.042 + l * 0.008 });
        }
      }
    }

    const barsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), copperMat, bars.length);
    bars.forEach((b, idx) => {
      this.dummy.position.set(...b.pos);
      this.dummy.scale.set(...b.sc);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      barsMesh.setMatrixAt(idx, this.dummy.matrix);
    });
    this.metalGroup.add(barsMesh);

    const viaMat = new THREE.MeshStandardMaterial({
      color: 0xffc680,
      emissive: 0x5c2e0c,
      emissiveIntensity: 0.35,
      metalness: 0.96,
      roughness: 0.16,
    });
    const viasMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), viaMat, vias.length);
    vias.forEach((v, idx) => {
      this.dummy.position.set(...v.pos);
      this.dummy.scale.set(v.r, v.h, v.r);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      viasMesh.setMatrixAt(idx, this.dummy.matrix);
    });
    this.metalGroup.add(viasMesh);

    // Subtle background copper traffic
    const bgPulseGeo = new THREE.BoxGeometry(0.42, 0.07, 0.1);
    const bgPulseMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.45 });
    this.bgPulseMesh = new THREE.InstancedMesh(bgPulseGeo, bgPulseMat, this.bgPulseTracks.length);
    this.metalGroup.add(this.bgPulseMesh);

    // HERO SIGNAL HIGHWAY CONDUIT (illuminated physical copper bus descending M8 -> M5 -> M2 -> Silicon Floor!)
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < HERO_DESCENT_PATH.length - 1; i++) {
      curve.add(new THREE.LineCurve3(HERO_DESCENT_PATH[i], HERO_DESCENT_PATH[i + 1]));
    }
    const heroTube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.11, 10, false),
      new THREE.MeshStandardMaterial({
        color: 0x29f2d8,
        emissive: 0x29f2d8,
        emissiveIntensity: 0.85,
        metalness: 0.6,
        roughness: 0.18,
      })
    );
    this.metalGroup.add(heroTube);

    // Hero blazing comet racing down the copper city!
    const beadGeo = new THREE.SphereGeometry(0.24, 14, 14);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1 - i / 16,
      });
      const m = new THREE.Mesh(beadGeo, mat);
      this.metalGroup.add(m);
      this.heroCometBeads.push(m);
      this.heroCometMats.push(mat);
    }
  }

  private buildLogicFloor(): void {
    // Polished crystalline silicon floor
    const wafer = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.26, 14),
      new THREE.MeshStandardMaterial({ color: 0x0b101b, metalness: 0.72, roughness: 0.24 })
    );
    wafer.position.y = -0.15;
    this.logicGroup.add(wafer);

    // Subtle background standard cells (top & bottom rows) for architectural depth
    const bgRows = [-2.55, 2.55];
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xd48e54,
      emissive: 0x3b1e08,
      emissiveIntensity: 0.28,
      metalness: 0.92,
      roughness: 0.2,
    });
    for (const rz of bgRows) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 0.14), railMat);
      rail.position.set(0, 0.04, rz);
      this.logicGroup.add(rail);

      for (let c = -4; c <= 4; c++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x151e2c,
          emissive: 0x3c6ea8,
          emissiveIntensity: 0.12,
          metalness: 0.7,
          roughness: 0.25,
        });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 0.9), mat);
        box.position.set(c * 1.48, 0.11, rz);
        this.logicGroup.add(box);
        this.bgLogicMats.push({ mat, phase: c * 0.9 + rz });
      }
    }

    // Center VDD & GND rails flanking the HERO 8-BIT REGISTER ROW (Bit 7 .. Bit 0)
    const vddRail = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.1, 0.16), railMat);
    vddRail.position.set(0, 0.06, -0.95);
    const gndRail = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.1, 0.16), railMat);
    gndRail.position.set(0, 0.06, 0.95);
    this.logicGroup.add(vddRail, gndRail);

    // 8 Hero FinFET Logic Cells — displaying the EXACT 8 binary bits of the typed key!
    const spacing = 1.56;
    const finMat = new THREE.MeshStandardMaterial({ color: 0xe6a666, metalness: 0.92, roughness: 0.2 });

    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * spacing;

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x141d2a,
        emissive: 0x29f2d8,
        emissiveIntensity: 0.08,
        metalness: 0.65,
        roughness: 0.22,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.42, 1.38), bodyMat);
      body.position.set(x, 0.21, 0);
      this.logicGroup.add(body);

      // 3 crisp vertical polysilicon FinFET gate bars inside each logic cell
      for (let f = -1; f <= 1; f++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.48, 1.52), finMat);
        fin.position.set(x + f * 0.32, 0.24, 0);
        this.logicGroup.add(fin);
      }

      // Output bus rail extending forward from each bit cell
      const outRailMat = new THREE.MeshStandardMaterial({
        color: 0x29f2d8,
        emissive: 0x29f2d8,
        emissiveIntensity: 0.1,
        metalness: 0.7,
        roughness: 0.2,
      });
      const outRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.95), outRailMat);
      outRail.position.set(x, 0.08, 1.15);
      this.logicGroup.add(outRail);

      // Floating crisp bit readout above each of the 8 cells!
      const spMat = new THREE.SpriteMaterial({
        map: makeBitSprite(i, '0', false, false),
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spMat);
      sprite.scale.set(1.22, 1.38, 1);
      sprite.position.set(x, 1.35, 0);
      this.logicGroup.add(sprite);

      this.bitCells.push({ bodyMat, railMat: outRailMat, spriteMat: spMat, lastKey: '' });
    }
  }

  public update(story: KeystrokeStoryEngine, time: number): void {
    // 1. Animate Hero Comet physically descending through the 10-story Copper City!
    const t = (time * 0.36) % 1;
    const headCol = new THREE.Color(0xffffff);
    const tailCol = new THREE.Color(0x29f2d8);

    for (let i = 0; i < this.heroCometBeads.length; i++) {
      const bt = (t - i * 0.018 + 1) % 1;
      samplePath(HERO_DESCENT_PATH, bt, this.tmp);
      const b = this.heroCometBeads[i];
      b.position.copy(this.tmp);
      const f = 1 - i / this.heroCometBeads.length;
      b.scale.setScalar(0.35 + f * 0.95);
      this.heroCometMats[i].color.copy(tailCol).lerp(headCol, Math.pow(f, 2.4));
    }

    // Background copper traffic
    const span = 12.6;
    for (let i = 0; i < this.bgPulseTracks.length; i++) {
      const pt = this.bgPulseTracks[i];
      const pos = (((pt.offset + time * pt.speed + span / 2) % span) + span) % span - span / 2;
      if (pt.axis === 'x') {
        this.dummy.position.set(pos, pt.y, pt.fixed);
        this.dummy.rotation.set(0, 0, 0);
      } else {
        this.dummy.position.set(pt.fixed, pt.y, pos);
        this.dummy.rotation.set(0, Math.PI / 2, 0);
      }
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.bgPulseMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.bgPulseMesh.instanceMatrix.needsUpdate = true;

    // 2. Update the 8 Hero FinFET Logic Cells with the EXACT binary bits of story.activeBinary!
    const bin = story.activeBinary;
    for (let i = 0; i < 8; i++) {
      const cell = this.bitCells[i];
      const bitStr = bin[i] ?? '0';
      const isOn = bitStr === '1';
      const isFocused = story.activeBitIndex === i;

      cell.bodyMat.emissive.setHex(isFocused ? 0xffb347 : 0x29f2d8);
      cell.bodyMat.emissiveIntensity = isOn ? (isFocused ? 2.1 : 1.35) : isFocused ? 0.45 : 0.04;
      cell.railMat.emissiveIntensity = isOn ? 1.8 : 0.06;

      const cacheKey = `${bitStr}_${isFocused ? 1 : 0}`;
      if (cell.lastKey !== cacheKey) {
        cell.lastKey = cacheKey;
        const oldMap = cell.spriteMat.map;
        cell.spriteMat.map = makeBitSprite(i, bitStr, isOn, isFocused);
        cell.spriteMat.needsUpdate = true;
        oldMap?.dispose();
      }
    }

    // Subtle background logic floor pulse
    for (const bg of this.bgLogicMats) {
      const w = (Math.sin(time * 2.5 + bg.phase) + 1) * 0.5;
      bg.mat.emissiveIntensity = 0.05 + w * 0.14;
    }
  }
}
