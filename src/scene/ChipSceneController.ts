import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BlockId } from '../sim/chipSim';
import { JOURNEY_CHAPTERS, KeystrokeStoryEngine } from '../sim/storyEngine';
import { StageCopperCity } from './stageCopperCity';
import { StagePackageDie } from './stagePackageDie';
import { StageTransistorAtoms } from './stageTransistorAtoms';

export interface SceneHooks {
  onZoomChange: (u: number) => void;
  onSelectBlock: (block: BlockId | null) => void;
  onChapterChange: (chapterIdx: number) => void;
}

export class ChipSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private stagePkgDie: StagePackageDie;
  private stageCopper: StageCopperCity;
  private stageTransistor: StageTransistorAtoms;

  // Continuous logarithmic zoom parameter u in [0, 5]
  public u = 0.05;
  private targetU = 0.05;

  // Cinematic 3D Orbit Camera
  private yaw = -0.45;
  private pitch = 0.62;
  private targetYaw = -0.45;
  private targetPitch = 0.62;
  private focus = new THREE.Vector3(-0.4, 0, 0.4);
  private targetFocus = new THREE.Vector3(-0.4, 0, 0.4);
  private autoRotate = false;

  public xrayLid = false;
  public thermalMode = false;
  public selectedBlock: BlockId | null = null;

  private pointerDown = false;
  private pointerMoved = false;
  private lastPx = 0;
  private lastPy = 0;
  private raycaster = new THREE.Raycaster();
  private mouseNdc = new THREE.Vector2();

  private rafId = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(container: HTMLElement, private story: KeystrokeStoryEngine, private hooks: SceneHooks) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060b);
    this.scene.fog = new THREE.FogExp2(0x04060b, 0.012);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);

    // HDR Selective Bloom Post-Processing Pipeline (crisp metallic speculars + luminous trails without washout!)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 768), 0.34, 0.45, 0.84);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.buildStudioLighting();

    this.stagePkgDie = new StagePackageDie();
    this.stageCopper = new StageCopperCity();
    this.stageTransistor = new StageTransistorAtoms();

    this.scene.add(this.stagePkgDie.group);
    this.scene.add(this.stageCopper.metalGroup);
    this.scene.add(this.stageCopper.logicGroup);
    this.scene.add(this.stageTransistor.transistorGroup);
    this.scene.add(this.stageTransistor.atomGroup);

    // Wire story chapter transitions directly into cinematic camera flights!
    this.story.onChapterChange = (idx) => {
      this.flyToChapter(idx);
      this.hooks.onChapterChange(idx);
    };

    this.resize();
    this.bindEvents();
    this.flyToChapter(this.story.chapterIndex);
    this.animate();
  }

  private buildStudioLighting(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x060912);

    const cards: { pos: [number, number, number]; rot: [number, number, number]; size: [number, number]; col: number }[] = [
      { pos: [0, 14, 0], rot: [Math.PI / 2, 0, 0], size: [20, 12], col: 0xdceaff },
      { pos: [14, 7, 9], rot: [0, -Math.PI / 3, 0], size: [14, 8], col: 0xffd5a6 },
      { pos: [-14, 6, -8], rot: [0, (Math.PI * 2) / 3, 0], size: [14, 8], col: 0x5cb6ff },
      { pos: [0, 5, 16], rot: [0, Math.PI, 0], size: [16, 6], col: 0x7effe6 },
    ];
    for (const c of cards) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(c.size[0], c.size[1]),
        new THREE.MeshBasicMaterial({ color: c.col, side: THREE.DoubleSide })
      );
      m.position.set(...c.pos);
      m.rotation.set(...c.rot);
      envScene.add(m);
    }
    this.scene.environment = pmrem.fromScene(envScene, 0.035).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xc2dcff, 0x0c1322, 0.65);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0db, 2.3);
    key.position.set(9, 15, 10);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x4eb8ff, 1.55);
    rim.position.set(-11, 8, -10);
    this.scene.add(rim);

    const accent = new THREE.DirectionalLight(0xc96bff, 0.65);
    accent.position.set(6, -5, -10);
    this.scene.add(accent);
  }

  public flyToChapter(chapterIdx: number): void {
    const ch = JOURNEY_CHAPTERS[chapterIdx];
    if (!ch) return;
    this.targetU = ch.scaleU;
    this.targetYaw = ch.cameraYaw;
    this.targetPitch = ch.cameraPitch;
    this.targetFocus.set(...ch.cameraFocus);
  }

  public flyToScale(targetU: number): void {
    this.targetU = THREE.MathUtils.clamp(targetU, 0, 5);
    this.targetFocus.set(0, 0, 0);
    if (targetU < 0.5) {
      this.targetPitch = 0.68;
      this.targetYaw = -0.4;
    } else if (targetU < 1.5) {
      this.targetPitch = 0.98;
      this.targetYaw = -0.1;
    } else if (targetU < 2.5) {
      this.targetPitch = 0.45;
      this.targetYaw = 0.58;
    } else if (targetU < 3.5) {
      this.targetPitch = 0.68;
      this.targetYaw = 0.22;
    } else if (targetU < 4.5) {
      this.targetPitch = 0.3;
      this.targetYaw = 0.3;
    } else {
      this.targetPitch = 0.36;
      this.targetYaw = 0.56;
    }
  }

  public setAutoRotate(on: boolean): void {
    this.autoRotate = on;
  }

  private resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, true);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Spread fingers (pinch out, deltaY < 0) or scroll up -> zoom IN (+u)!
    const delta = -e.deltaY * (e.ctrlKey ? 0.0065 : 0.0014);
    this.targetU = THREE.MathUtils.clamp(this.targetU + delta, 0, 5);
    // Pause auto-story advance when user manually takes over zoom
    if (Math.abs(delta) > 0.015) {
      this.story.autoPlaying = false;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = true;
    this.pointerMoved = false;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    const dx = e.clientX - this.lastPx;
    const dy = e.clientY - this.lastPy;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.pointerMoved = true;

    this.targetYaw -= dx * 0.006;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * 0.0055, 0.14, 1.48);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasClick = this.pointerDown && !this.pointerMoved;
    this.pointerDown = false;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (wasClick && this.u < 1.6) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      const hits = this.raycaster.intersectObjects(this.stagePkgDie.clickableMeshes, false);
      if (hits.length > 0) {
        const blockId = hits[0].object.userData.blockId as BlockId | undefined;
        if (blockId) {
          this.selectedBlock = blockId;
          this.hooks.onSelectBlock(blockId);
          return;
        }
      }
      this.selectedBlock = null;
      this.hooks.onSelectBlock(null);
    }
  };

  private bindEvents(): void {
    const el = this.renderer.domElement;
    window.addEventListener('resize', this.resize);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
  }

  private applyStageScale(group: THREE.Group, centerU: number, u: number, visibleHalfSpan = 0.78, baseScale = 1): void {
    const dist = u - centerU;
    if (Math.abs(dist) > visibleHalfSpan) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const sc = baseScale * Math.pow(3.6, dist);
    group.scale.setScalar(sc);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const time = now / 1000;

    // 1. Advance keystroke journey engine
    this.story.update(dt);

    // 2. Smooth cinematic damping of zoom, orbit & focus
    const prevU = this.u;
    this.u += (this.targetU - this.u) * Math.min(1, dt * 4.2);
    if (Math.abs(this.u - prevU) > 0.001) {
      this.hooks.onZoomChange(this.u);
    }

    // Subtle cinematic breathing orbit when playing the story or Auto-Orbit is enabled
    if ((this.autoRotate || this.story.autoPlaying) && !this.pointerDown) {
      this.targetYaw += dt * (this.autoRotate ? 0.22 : 0.055);
    }

    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 4.5);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 4.5);
    this.focus.lerp(this.targetFocus, Math.min(1, dt * 4.5));

    let radius = 12.8;
    if (this.u < 1.2) {
      const t = THREE.MathUtils.clamp(this.u / 1.0, 0, 1);
      radius = THREE.MathUtils.lerp(14.2, 12.4, t);
    } else if (this.u < 3.5) {
      radius = 12.4;
    } else if (this.u < 4.5) {
      radius = 11.4;
    } else {
      radius = 10.6;
    }

    const cosP = Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * cosP * radius,
      this.focus.y + Math.sin(this.pitch) * radius,
      this.focus.z + Math.cos(this.yaw) * cosP * radius
    );
    this.camera.lookAt(this.focus);

    // 3. Multi-Scale Stage Transitions
    if (this.u < 1.82) {
      this.stagePkgDie.group.visible = true;
      const sc = this.u <= 1.0 ? 0.95 + this.u * 0.14 : 1.09 * Math.pow(3.6, this.u - 1.0);
      this.stagePkgDie.group.scale.setScalar(sc);
      this.stagePkgDie.update(this.story, this.u, time, this.xrayLid, this.thermalMode, this.selectedBlock);
    } else {
      this.stagePkgDie.group.visible = false;
    }

    this.applyStageScale(this.stageCopper.metalGroup, 2.0, this.u, 0.74, 1.0);
    this.applyStageScale(this.stageCopper.logicGroup, 3.0, this.u, 0.72, 1.0);
    if (this.stageCopper.metalGroup.visible || this.stageCopper.logicGroup.visible) {
      this.stageCopper.update(this.story, time);
    }

    this.applyStageScale(this.stageTransistor.transistorGroup, 4.0, this.u, 0.72, 1.0);
    this.applyStageScale(this.stageTransistor.atomGroup, 5.0, this.u, 0.76, 1.0);
    if (this.stageTransistor.transistorGroup.visible || this.stageTransistor.atomGroup.visible) {
      this.stageTransistor.update(this.story, dt, time);
    }

    // Render with HDR Selective Bloom!
    this.composer.render();
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    const el = this.renderer.domElement;
    window.removeEventListener('resize', this.resize);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    this.composer.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) {
      this.container.removeChild(el);
    }
  }
}
