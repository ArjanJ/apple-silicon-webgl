import * as THREE from 'three';
import { KeystrokeStoryEngine } from '../sim/storyEngine';

/**
 * Stage 4 (3 nm):   Photorealistic Gate-All-Around (GAA) Nanosheet Transistor
 *                   - Sculpted metallic Source & Drain epitaxial pillars
 *                   - 3 stacked horizontal Silicon Nanosheet ribbons with electric-field bloom
 *                   - Wrap-around High-K / Metal Gate Collar with crystal cutaway front
 *                   - 280 HDR-glowing electrons pooling at Source (0V) & surging across (0.72V)
 *
 * Stage 5 (0.54 nm): Diamond-Cubic Silicon Crystal Lattice inside the 3nm channel
 *                   - Exact tetrahedral Si crystal (~100 atoms + 109.5° covalent bonds)
 *                   - Luminous quantum conduction electron wave drifting through the lattice
 */

function makeCalloutSprite(text: string, subtext: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 440;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(8, 12, 20, 0.86)';
  ctx.beginPath();
  ctx.roundRect(10, 12, 420, 104, 16);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px Inter, -apple-system, sans-serif';
  ctx.fillText(text, 220, 58);

  ctx.fillStyle = color;
  ctx.font = '600 21px "JetBrains Mono", monospace';
  ctx.fillText(subtext, 220, 94);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.0, 0.58, 1);
  return sp;
}

interface ElectronParticle {
  sheetIdx: number;
  x: number;
  zOff: number;
  yOff: number;
  speed: number;
  phase: number;
}

export class StageTransistorAtoms {
  public readonly transistorGroup = new THREE.Group();
  public readonly atomGroup = new THREE.Group();

  private gateCollarMat!: THREE.MeshPhysicalMaterial;
  private nanosheetMats: THREE.MeshPhysicalMaterial[] = [];
  private electronInstanced!: THREE.InstancedMesh;
  private electrons: ElectronParticle[] = [];
  private gateLight!: THREE.PointLight;

  private atomMat!: THREE.MeshPhysicalMaterial;
  private bondMat!: THREE.MeshStandardMaterial;
  private qWaveInstanced!: THREE.InstancedMesh;
  private qParticles: { x: number; y: number; z: number; speed: number; phase: number }[] = [];

  private dummy = new THREE.Object3D();

  constructor() {
    this.buildTransistor();
    this.buildAtomicLattice();
  }

  private buildTransistor(): void {
    // Dark silicon-dioxide dielectric substrate base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(12.2, 0.5, 8.0),
      new THREE.MeshStandardMaterial({ color: 0x0b1019, roughness: 0.3, metalness: 0.68 })
    );
    base.position.y = -1.65;
    this.transistorGroup.add(base);

    const grid = new THREE.GridHelper(11.6, 16, 0x223650, 0x131d2d);
    grid.position.y = -1.39;
    this.transistorGroup.add(grid);

    // 1. Source (Left) & Drain (Right) Epitaxial SiGe Vertical Pillars
    const termGeo = new THREE.BoxGeometry(1.75, 2.75, 2.55);
    const sourceMat = new THREE.MeshPhysicalMaterial({
      color: 0x3872b0,
      emissive: 0x10345e,
      emissiveIntensity: 0.45,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 0.5,
    });
    const drainMat = new THREE.MeshPhysicalMaterial({
      color: 0x248c82,
      emissive: 0x0e443e,
      emissiveIntensity: 0.45,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 0.5,
    });

    const sourceMesh = new THREE.Mesh(termGeo, sourceMat);
    sourceMesh.position.set(-3.15, -0.04, 0);
    const drainMesh = new THREE.Mesh(termGeo, drainMat);
    drainMesh.position.set(3.15, -0.04, 0);
    this.transistorGroup.add(sourceMesh, drainMesh);

    // Copper vertical contact vias rising out of Source and Drain up to M1
    const contactGeo = new THREE.CylinderGeometry(0.32, 0.36, 1.35, 24);
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xe89c5c, metalness: 0.96, roughness: 0.15 });
    const srcContact = new THREE.Mesh(contactGeo, copperMat);
    srcContact.position.set(-3.15, 1.98, 0);
    const drnContact = new THREE.Mesh(contactGeo, copperMat);
    drnContact.position.set(3.15, 1.98, 0);
    this.transistorGroup.add(srcContact, drnContact);

    // 2. Three Stacked Horizontal 3nm Silicon Nanosheet Channels
    const sheetYs = [-0.72, 0.0, 0.72];
    const sheetGeo = new THREE.BoxGeometry(5.2, 0.28, 1.65);

    for (const sy of sheetYs) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x62b4e8,
        emissive: 0x29f2d8,
        emissiveIntensity: 0.15,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.55,
        transparent: true,
        opacity: 0.88,
        clearcoat: 1.0,
      });
      const sheet = new THREE.Mesh(sheetGeo, mat);
      sheet.position.set(0, sy, 0);
      this.transistorGroup.add(sheet);
      this.nanosheetMats.push(mat);
    }

    // 3. Wrap-Around High-K / Metal Gate Collar (Gate-All-Around!)
    this.gateCollarMat = new THREE.MeshPhysicalMaterial({
      color: 0xe3a84f,
      emissive: 0xffa838,
      emissiveIntensity: 0.2,
      metalness: 0.92,
      roughness: 0.18,
      clearcoat: 0.6,
      transparent: true,
      opacity: 0.92,
    });

    const gateW = 2.08;
    const capGeo = new THREE.BoxGeometry(gateW, 0.36, 2.48);
    const topCap = new THREE.Mesh(capGeo, this.gateCollarMat);
    topCap.position.set(0, 1.14, 0);
    const botCap = new THREE.Mesh(capGeo, this.gateCollarMat);
    botCap.position.set(0, -1.16, 0);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(gateW, 2.55, 0.38), this.gateCollarMat);
    backWall.position.set(0, -0.01, -1.04);

    // Internal Gate Spacer Ribs wrapping BETWEEN the 3 nanosheets!
    const ribGeo = new THREE.BoxGeometry(gateW * 0.96, 0.28, 2.18);
    const rib1 = new THREE.Mesh(ribGeo, this.gateCollarMat);
    rib1.position.set(0, -0.36, -0.08);
    const rib2 = new THREE.Mesh(ribGeo, this.gateCollarMat);
    rib2.position.set(0, 0.36, -0.08);

    // Crystal front rim cutaway so you watch electrons surge INSIDE the gate!
    const frontRim = new THREE.Mesh(
      new THREE.BoxGeometry(gateW, 2.55, 0.1),
      new THREE.MeshPhysicalMaterial({
        color: 0xffce78,
        emissive: 0xffa838,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.22,
        roughness: 0.08,
        metalness: 0.4,
      })
    );
    frontRim.position.set(0, -0.01, 1.16);

    const gateContact = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 1.15, 24), this.gateCollarMat);
    gateContact.position.set(0, 1.88, 0);

    this.transistorGroup.add(topCap, botCap, backWall, rib1, rib2, frontRim, gateContact);

    this.gateLight = new THREE.PointLight(0x29f2d8, 1.0, 11);
    this.gateLight.position.set(0, 0.2, 2.0);
    this.transistorGroup.add(this.gateLight);

    // Clean callouts well clear of copper contacts & top-right card
    const lblSrc = makeCalloutSprite('SOURCE', 'Electron Supply (-)', '#4cc9ff');
    lblSrc.position.set(-3.15, 3.12, 0);
    const lblGate = makeCalloutSprite('3nm METAL GATE', 'Switch (0V / 0.72V)', '#ffb347');
    lblGate.position.set(0, 3.12, 0);
    const lblDrn = makeCalloutSprite('DRAIN', 'Output Current (+)', '#29f2d8');
    lblDrn.position.set(3.2, -0.55, 1.9);
    this.transistorGroup.add(lblSrc, lblGate, lblDrn);

    // 4. 280 HDR-Glowing Electrons inside the 3 Nanosheet Ribbons
    const count = 280;
    const eGeo = new THREE.SphereGeometry(0.068, 10, 10);
    const eMat = new THREE.MeshBasicMaterial({ color: 0xb0fff8 });
    this.electronInstanced = new THREE.InstancedMesh(eGeo, eMat, count);

    for (let i = 0; i < count; i++) {
      this.electrons.push({
        sheetIdx: i % 3,
        x: -3.2 + Math.random() * 6.4,
        zOff: (Math.random() - 0.5) * 1.35,
        yOff: (Math.random() - 0.5) * 0.14,
        speed: 3.6 + Math.random() * 2.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.transistorGroup.add(this.electronInstanced);
  }

  private buildAtomicLattice(): void {
    const basis: [number, number, number][] = [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
      [0.25, 0.25, 0.25],
      [0.25, 0.75, 0.75],
      [0.75, 0.25, 0.75],
      [0.75, 0.75, 0.25],
    ];

    const a = 2.2;
    const nx = 3;
    const ny = 2;
    const nz = 2;
    const atoms: THREE.Vector3[] = [];

    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++) {
          for (const [bx, by, bz] of basis) {
            atoms.push(new THREE.Vector3((ix + bx - nx / 2) * a, (iy + by - ny / 2) * a, (iz + bz - nz / 2) * a));
          }
        }
      }
    }

    const atomGeo = new THREE.SphereGeometry(0.24, 20, 20);
    this.atomMat = new THREE.MeshPhysicalMaterial({
      color: 0x74b0ff,
      emissive: 0x1d468c,
      emissiveIntensity: 0.55,
      metalness: 0.38,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    });
    const atomMesh = new THREE.InstancedMesh(atomGeo, this.atomMat, atoms.length);
    atoms.forEach((p, idx) => {
      this.dummy.position.copy(p);
      this.dummy.scale.setScalar(1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      atomMesh.setMatrixAt(idx, this.dummy.matrix);
    });
    this.atomGroup.add(atomMesh);

    const bondTargetDist = (Math.sqrt(3) / 4) * a;
    const bondPairs: [THREE.Vector3, THREE.Vector3][] = [];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = atoms[i].distanceTo(atoms[j]);
        if (Math.abs(d - bondTargetDist) < 0.15) {
          bondPairs.push([atoms[i], atoms[j]]);
        }
      }
    }

    const bondGeo = new THREE.CylinderGeometry(0.048, 0.048, 1, 8);
    this.bondMat = new THREE.MeshStandardMaterial({
      color: 0x94d0ff,
      emissive: 0x1c4c7e,
      emissiveIntensity: 0.55,
      roughness: 0.22,
      metalness: 0.55,
      transparent: true,
      opacity: 0.78,
    });
    const bondsMesh = new THREE.InstancedMesh(bondGeo, this.bondMat, bondPairs.length);
    const up = new THREE.Vector3(0, 1, 0);
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    bondPairs.forEach(([p1, p2], idx) => {
      mid.addVectors(p1, p2).multiplyScalar(0.5);
      dir.subVectors(p2, p1);
      const len = dir.length();
      dir.normalize();
      quat.setFromUnitVectors(up, dir);
      this.dummy.position.copy(mid);
      this.dummy.quaternion.copy(quat);
      this.dummy.scale.set(1, len, 1);
      this.dummy.updateMatrix();
      bondsMesh.setMatrixAt(idx, this.dummy.matrix);
    });
    this.atomGroup.add(bondsMesh);

    const scaleSprite = makeCalloutSprite('SILICON CRYSTAL', '0.543 nm cell · 109.5° bonds', '#6ea8ff');
    scaleSprite.scale.set(2.55, 0.74, 1);
    scaleSprite.position.set(-1.4, 2.5, 0);
    this.atomGroup.add(scaleSprite);

    const qCount = 160;
    const qGeo = new THREE.SphereGeometry(0.11, 10, 10);
    const qMat = new THREE.MeshBasicMaterial({ color: 0x80fff4, transparent: true, opacity: 0.9 });
    this.qWaveInstanced = new THREE.InstancedMesh(qGeo, qMat, qCount);
    for (let i = 0; i < qCount; i++) {
      this.qParticles.push({
        x: (Math.random() - 0.5) * nx * a,
        y: (Math.random() - 0.5) * ny * a,
        z: (Math.random() - 0.5) * nz * a,
        speed: 2.2 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.atomGroup.add(this.qWaveInstanced);
  }

  public update(story: KeystrokeStoryEngine, dt: number, time: number): void {
    const gateNorm = THREE.MathUtils.clamp(story.gateVoltage / 0.72, 0, 1);
    const isOn = gateNorm > 0.35;
    const sheetYs = [-0.72, 0.0, 0.72];

    this.gateCollarMat.emissive.setHex(isOn ? 0xffbe4f : 0x5c3e18);
    this.gateCollarMat.emissiveIntensity = 0.12 + gateNorm * 1.65;
    this.gateLight.intensity = 0.6 + gateNorm * 4.5;

    for (const sm of this.nanosheetMats) {
      sm.emissiveIntensity = 0.08 + gateNorm * 0.72;
      sm.opacity = 0.48 + gateNorm * 0.18;
    }

    for (let i = 0; i < this.electrons.length; i++) {
      const e = this.electrons[i];
      if (isOn) {
        e.x += e.speed * (0.45 + gateNorm * 0.85) * 0.62 * dt;
        if (e.x > 3.25) e.x = -3.25;
      } else {
        if (e.x > -1.12 && e.x < 1.12) {
          e.x += (e.x < 0 ? -2.0 : 2.0) * dt;
        } else {
          e.x += Math.sin(time * 7 + e.phase) * 0.32 * dt;
          if (e.x < -3.3) e.x = -3.2;
          if (e.x > 3.3) e.x = 3.2;
        }
      }

      const wy = sheetYs[e.sheetIdx] + e.yOff + Math.sin(time * 9 + e.phase) * 0.025;
      const wz = e.zOff + Math.cos(time * 6 + e.phase) * 0.03;
      const sz = isOn ? 0.9 + Math.sin(time * 12 + e.phase) * 0.25 : 0.66;

      this.dummy.position.set(e.x, wy, wz);
      this.dummy.scale.setScalar(sz);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.electronInstanced.setMatrixAt(i, this.dummy.matrix);
    }
    this.electronInstanced.instanceMatrix.needsUpdate = true;

    this.atomMat.emissiveIntensity = 0.35 + gateNorm * 0.85;
    this.bondMat.emissiveIntensity = 0.3 + gateNorm * 0.85;

    const spanX = 3 * 2.2;
    for (let i = 0; i < this.qParticles.length; i++) {
      const qp = this.qParticles[i];
      if (isOn) {
        qp.x += qp.speed * (0.5 + gateNorm) * 0.6 * dt;
        if (qp.x > spanX / 2) qp.x = -spanX / 2;
      } else {
        qp.x += Math.sin(time * 4 + qp.phase) * 0.18 * dt;
      }
      const py = qp.y + Math.sin(time * 5 + qp.phase) * 0.16;
      const pz = qp.z + Math.cos(time * 4.5 + qp.phase) * 0.16;
      const ps = isOn ? 0.9 + Math.sin(time * 10 + qp.phase) * 0.4 : 0.45;
      this.dummy.position.set(qp.x, py, pz);
      this.dummy.scale.setScalar(ps);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.qWaveInstanced.setMatrixAt(i, this.dummy.matrix);
    }
    this.qWaveInstanced.instanceMatrix.needsUpdate = true;
  }
}
