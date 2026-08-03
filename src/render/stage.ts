/**
 * The single Three.js presentation pipeline: one scene, two cameras
 * (perspective orbit / orthographic top-down), read-only consumer of board
 * state. Never constructed headless — requires a browser canvas.
 */

import * as THREE from 'three';
import type {
  Board64,
  ColoredPiece,
  Faction,
  CharacterName,
  Settings,
  Square,
} from '../core/contract.ts';
import { PIECE_CHARACTER } from '../core/contract.ts';
import type { CharacterRig, CharacterOptions, DuelCameraRig } from '../core/stage.ts';
import { mulberry32 } from '../core/prng.ts';
import { squareToWorld, worldToSquare } from './boardMath.ts';

export type ViewMode = '3d' | '2d';

export type RigBuilder = (
  name: CharacterName,
  faction: Faction,
  opts?: CharacterOptions,
) => CharacterRig;

/** Optional hook: swap an existing rig to/from its flat emblem variant. */
export type PieceVariantHook = (
  rig: CharacterRig,
  flat: boolean,
) => CharacterRig | null | undefined;

interface PieceEntry {
  anchor: THREE.Group;
  rig: CharacterRig;
  piece: ColoredPiece;
}

interface Glide {
  object: THREE.Object3D;
  from: THREE.Vector3;
  t: number;
}

const GLIDE_SECONDS = 0.12;
const CAMERA_RETURN_SECONDS = 0.45;
const ORBIT_MIN_POLAR = 0.25;
const ORBIT_MAX_POLAR = 1.32;
const ORBIT_MIN_RADIUS = 6.5;
const ORBIT_MAX_RADIUS = 18;
const ORTHO_HALF = 5.4;
const BOARD_FOG_COLOR = 0x0b0e14;

const easeInOut = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const factionOf = (color: ColoredPiece['color']): Faction =>
  color === 'w' ? 'ash' : 'ember';

// ── Procedural textures (browser-only; called from the constructor) ─────────

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [c, ctx];
}

function woodTexture(base: string, grain: string, seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(128);
  const rnd = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = grain;
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.12 + rnd() * 0.18;
    const y = rnd() * 128;
    const wobble = 2 + rnd() * 5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + rnd() * 6) * wobble);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function knotworkTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(256);
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#33291f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const y = 16 + i * 30;
    ctx.strokeStyle = i % 2 === 0 ? '#453626' : '#241b12';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 8) {
      const yy = y + Math.sin((x / 256) * Math.PI * 6 + i * 1.7) * 9;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    ctx.strokeStyle = '#1d150d';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    const x = rnd() * 256;
    const y = rnd() * 256;
    ctx.strokeRect(x, y, 10 + rnd() * 8, 10 + rnd() * 8);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Angular rune-like tick glyphs for files a–h / ranks 1–8. */
const RUNE_STROKES: ReadonlyArray<ReadonlyArray<[number, number, number, number]>> = [
  [[8, 26, 8, 6], [8, 10, 22, 16], [8, 18, 20, 24]],
  [[8, 26, 8, 6], [8, 6, 22, 14], [22, 14, 22, 26]],
  [[8, 6, 22, 26], [22, 6, 8, 26]],
  [[8, 26, 8, 6], [8, 6, 22, 12], [22, 12, 8, 18]],
  [[16, 26, 16, 6], [16, 10, 6, 20], [16, 10, 26, 20]],
  [[8, 26, 16, 6], [16, 6, 24, 26]],
  [[8, 26, 8, 6], [22, 26, 22, 6], [8, 12, 22, 20]],
  [[16, 6, 16, 26], [8, 8, 24, 24], [24, 8, 8, 24]],
];

function runeTexture(index: number): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(32);
  ctx.clearRect(0, 0, 32, 32);
  ctx.strokeStyle = '#a08e66';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2] of RUNE_STROKES[index & 7]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stoneTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(128);
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    const v = 60 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 2 + rnd() * 4);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 64 unit quads merged into one geometry with two material groups. */
function buildSquaresGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const geo = new THREE.BufferGeometry();
  let indexStart = 0;
  for (const wantDark of [false, true]) {
    const groupStart = indices.length;
    for (let sq = 0; sq < 64; sq++) {
      const file = sq & 7;
      const rank = sq >> 3;
      const dark = (file + rank) % 2 === 0;
      if (dark !== wantDark) continue;
      const [cx, , cz] = squareToWorld(sq);
      const x0 = cx - 0.5;
      const x1 = cx + 0.5;
      const z0 = cz - 0.5;
      const z1 = cz + 0.5;
      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(indexStart, indexStart + 2, indexStart + 1, indexStart, indexStart + 3, indexStart + 2);
      indexStart += 4;
    }
    geo.addGroup(groupStart, indices.length - groupStart, wantDark ? 1 : 0);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function frameGeometry(outer: number, inner: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(inner, -inner);
  hole.lineTo(inner, inner);
  hole.lineTo(-inner, inner);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ── Stage ────────────────────────────────────────────────────────────────────

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly perspCamera: THREE.PerspectiveCamera;
  private readonly orthoCamera: THREE.OrthographicCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane: THREE.Mesh;
  private readonly pieceLayer: THREE.Group;
  private readonly reducedMotion: boolean;

  private viewMode: ViewMode;
  private readonly pieces = new Map<Square, PieceEntry>();
  private glides: Glide[] = [];
  private lastBuilder: RigBuilder | null = null;
  private variantHook: PieceVariantHook | null = null;

  onSquareClick?: (sq: Square) => void;
  onSquareHover?: (sq: Square | null) => void;

  // orbit state
  private orbitAzimuth = 0.55;
  private orbitPolar = 1.02;
  private orbitRadius = 11;
  private readonly orbitTarget = new THREE.Vector3(0, 0.2, 0);
  private dragging = false;
  private dragMoved = false;
  private lastPointer: [number, number] = [0, 0];

  // duel camera state
  private duelActive = false;
  private returning = false;
  private returnT = 0;
  private readonly duelStartPos = new THREE.Vector3();
  private readonly duelStartLook = new THREE.Vector3();
  private readonly duelDesiredPos = new THREE.Vector3();
  private readonly duelDesiredLook = new THREE.Vector3();
  private readonly returnFromPos = new THREE.Vector3();
  private readonly returnFromLook = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();

  /** Scratch vectors for hot paths — the render loop and pointer picking. */
  private readonly scratchVec3 = new THREE.Vector3();
  private readonly scratchVec3b = new THREE.Vector3();
  private readonly scratchVec2 = new THREE.Vector2();
  private readonly scratchSize = new THREE.Vector2();
  private readonly shakePrng = mulberry32(0x5eed);

  // highlights
  private readonly legalDots: THREE.Group[] = [];
  private readonly highlightLayer: THREE.Group;
  private readonly hoverFrame: THREE.Mesh;
  private readonly selectedFrame: THREE.Mesh;
  private readonly lastMoveFrom: THREE.Mesh;
  private readonly lastMoveTo: THREE.Mesh;
  private readonly checkRing: THREE.Group;
  private checkSquare: Square | null = null;

  private time = 0;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly removeListeners: () => void;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.viewMode = settings.viewMode;
    this.reducedMotion = settings.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BOARD_FOG_COLOR);
    this.scene.fog = new THREE.Fog(BOARD_FOG_COLOR, 14, 42);

    const aspect = Math.max(1e-6, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
    this.updateOrthoFrustum(aspect);
    this.orthoCamera.position.set(0, 16, 0);
    this.orthoCamera.up.set(0, 0, -1);
    this.orthoCamera.lookAt(0, 0, 0);

    this.buildLights();
    this.buildBoard();
    this.buildEnvironment();

    this.pieceLayer = new THREE.Group();
    this.scene.add(this.pieceLayer);

    this.highlightLayer = new THREE.Group();
    this.scene.add(this.highlightLayer);

    const mkFrameMat = (color: number, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: false,
      });
      this.disposables.push(m);
      return m;
    };

    const hoverGeo = frameGeometry(0.46, 0.4);
    const selGeo = frameGeometry(0.48, 0.36);
    const tintGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.disposables.push(hoverGeo, selGeo, tintGeo);
    this.hoverFrame = new THREE.Mesh(hoverGeo, mkFrameMat(0xd8d8d8, 0.5));
    this.selectedFrame = new THREE.Mesh(selGeo, mkFrameMat(0xffffff, 0.85));
    this.lastMoveFrom = new THREE.Mesh(tintGeo, mkFrameMat(0xf0e6c8, 0.16));
    this.lastMoveTo = new THREE.Mesh(tintGeo, mkFrameMat(0xf0e6c8, 0.28));
    for (const m of [this.hoverFrame, this.selectedFrame, this.lastMoveFrom, this.lastMoveTo]) {
      m.position.y = 0.012;
      m.visible = false;
      m.renderOrder = 10;
      this.highlightLayer.add(m);
    }

    this.checkRing = new THREE.Group();
    const ringOuterGeo = frameGeometry(0.5, 0.42);
    const ringInnerGeo = frameGeometry(0.4, 0.34);
    this.disposables.push(ringOuterGeo, ringInnerGeo);
    this.checkRing.add(new THREE.Mesh(ringOuterGeo, mkFrameMat(0xffffff, 0.9)));
    this.checkRing.add(new THREE.Mesh(ringInnerGeo, mkFrameMat(0x101010, 0.9)));
    this.checkRing.position.y = 0.014;
    this.checkRing.visible = false;
    this.checkRing.renderOrder = 11;
    this.highlightLayer.add(this.checkRing);

    const dotGeo = new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2);
    const dotRimGeo = new THREE.RingGeometry(0.13, 0.19, 20).rotateX(-Math.PI / 2);
    this.disposables.push(dotGeo, dotRimGeo);
    const dotMat = mkFrameMat(0xffffff, 0.95);
    const dotRimMat = mkFrameMat(0x101010, 0.7);
    for (let i = 0; i < 32; i++) {
      const g = new THREE.Group();
      const rim = new THREE.Mesh(dotRimGeo, dotRimMat);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.y = 0.001;
      g.add(rim, dot);
      g.position.y = 0.016;
      g.visible = false;
      g.renderOrder = 12;
      this.legalDots.push(g);
      this.highlightLayer.add(g);
    }

    const pickGeo = new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2);
    this.disposables.push(pickGeo);
    this.pickPlane = new THREE.Mesh(
      pickGeo,
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.disposables.push(this.pickPlane.material as THREE.Material);
    this.scene.add(this.pickPlane);

    const onPointerDown = (e: PointerEvent): void => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = [e.clientX, e.clientY];
    };
    const onPointerMove = (e: PointerEvent): void => {
      const sq = this.pickSquare(e);
      this.onSquareHover?.(sq >= 0 ? sq : null);
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer[0];
      const dy = e.clientY - this.lastPointer[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.lastPointer = [e.clientX, e.clientY];
      if (this.viewMode === '3d' && this.dragMoved && !this.duelActive) {
        this.orbitAzimuth -= dx * 0.006;
        this.orbitPolar = Math.min(
          ORBIT_MAX_POLAR,
          Math.max(ORBIT_MIN_POLAR, this.orbitPolar - dy * 0.005),
        );
      }
    };
    const onPointerUp = (e: PointerEvent): void => {
      const wasDrag = this.dragMoved;
      this.dragging = false;
      this.dragMoved = false;
      if (wasDrag) return;
      const sq = this.pickSquare(e);
      if (sq >= 0) this.onSquareClick?.(sq);
    };
    const onWheel = (e: WheelEvent): void => {
      if (this.viewMode !== '3d') return;
      e.preventDefault();
      this.orbitRadius = Math.min(
        ORBIT_MAX_RADIUS,
        Math.max(ORBIT_MIN_RADIUS, this.orbitRadius + e.deltaY * 0.01),
      );
    };
    const onLeave = (): void => {
      this.dragging = false;
      this.onSquareHover?.(null);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this.removeListeners = () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };

    this.applyOrbitCamera();
    this.resize();
  }

  // ── Scene construction ────────────────────────────────────────────────────

  private buildLights(): void {
    const key = new THREE.DirectionalLight(0xbfd4ff, 2.4);
    key.position.set(7, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6.5;
    key.shadow.camera.right = 6.5;
    key.shadow.camera.top = 6.5;
    key.shadow.camera.bottom = -6.5;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0015;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffb37a, 0.55);
    fill.position.set(-5, 3, -4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5);
    rim.position.set(0, 4, -9);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0x36414f, 0x1a1410, 0.55));
  }

  private buildBoard(): void {
    const lightTex = woodTexture('#cfc0a4', '#a89873', 11);
    const darkTex = woodTexture('#2c241f', '#171008', 23);
    const lightMat = new THREE.MeshStandardMaterial({ map: lightTex, roughness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.7 });
    const squaresGeo = buildSquaresGeometry();
    this.disposables.push(lightTex, darkTex, lightMat, darkMat, squaresGeo);
    const squares = new THREE.Mesh(squaresGeo, [lightMat, darkMat]);
    squares.receiveShadow = true;
    this.scene.add(squares);

    const knotTex = knotworkTexture(7);
    const rimMat = new THREE.MeshStandardMaterial({ map: knotTex, roughness: 0.8 });
    this.disposables.push(knotTex, rimMat);
    const rimLong = new THREE.BoxGeometry(9.2, 0.28, 0.6);
    const rimShort = new THREE.BoxGeometry(0.6, 0.28, 8);
    this.disposables.push(rimLong, rimShort);
    const rimSpecs: Array<[THREE.BoxGeometry, number, number]> = [
      [rimLong, 0, 4.3],
      [rimLong, 0, -4.3],
      [rimShort, 4.3, 0],
      [rimShort, -4.3, 0],
    ];
    for (const [geo, x, z] of rimSpecs) {
      const m = new THREE.Mesh(geo, rimMat);
      m.position.set(x, 0.02, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
    const knobGeo = new THREE.TorusKnotGeometry(0.16, 0.05, 48, 6);
    this.disposables.push(knobGeo);
    for (const [x, z] of [[4.3, 4.3], [-4.3, 4.3], [4.3, -4.3], [-4.3, -4.3]]) {
      const knob = new THREE.Mesh(knobGeo, rimMat);
      knob.position.set(x, 0.22, z);
      knob.rotation.x = Math.PI / 2;
      knob.castShadow = true;
      this.scene.add(knob);
    }

    const slabGeo = new THREE.BoxGeometry(9.2, 0.3, 9.2);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 0.9 });
    this.disposables.push(slabGeo, slabMat);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = -0.16;
    slab.receiveShadow = true;
    this.scene.add(slab);

    const tickGeo = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
    this.disposables.push(tickGeo);
    for (let i = 0; i < 8; i++) {
      const tex = runeTexture(i);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      this.disposables.push(tex, mat);
      const fileTick = new THREE.Mesh(tickGeo, mat);
      fileTick.position.set(i - 3.5, 0.165, 4.3);
      this.scene.add(fileTick);
      const rankTick = new THREE.Mesh(tickGeo, mat);
      rankTick.position.set(-4.3, 0.165, 3.5 - i);
      this.scene.add(rankTick);
    }
  }

  private buildEnvironment(): void {
    const stoneTex = stoneTexture(41);
    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 });
    this.disposables.push(stoneTex, stoneMat);

    const plinthGeo = new THREE.CylinderGeometry(6.2, 6.9, 0.7, 24);
    this.disposables.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, stoneMat);
    plinth.position.y = -0.66;
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    const groundGeo = new THREE.CircleGeometry(45, 32).rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 });
    this.disposables.push(groundGeo, groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -1.0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const stoneGeo = new THREE.CylinderGeometry(0.55, 0.95, 5.2, 5);
    this.disposables.push(stoneGeo);
    const placements: Array<[number, number, number, number]> = [
      [-11, -9, 0.12, 5.2],
      [13, -6, -0.08, 4.4],
      [3, -15, 0.05, 6.0],
    ];
    for (const [x, z, tilt, h] of placements) {
      const s = new THREE.Mesh(stoneGeo, stoneMat);
      s.scale.y = h / 5.2;
      s.position.set(x, h / 2 - 1, z);
      s.rotation.z = tilt;
      this.scene.add(s);
    }
  }

  // ── View modes ────────────────────────────────────────────────────────────

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    if (mode === '2d') {
      this.duelActive = false;
      this.returning = false;
    }
    const flat = mode === '2d';
    for (const [sq, entry] of this.pieces) {
      const swapped = this.variantHook?.(entry.rig, flat);
      const replacement =
        swapped && swapped !== entry.rig
          ? swapped
          : !swapped && this.lastBuilder
            ? this.lastBuilder(
                PIECE_CHARACTER[entry.piece.type],
                factionOf(entry.piece.color),
                { flat },
              )
            : null;
      if (!replacement) continue;

      // Hand any in-flight glide to the replacement: dropping it here would
      // leave the glide writing positions on a disposed rig, and pop the
      // swapped piece to its destination mid-slide.
      const glide = this.glides.find((g) => g.object === entry.rig.root);
      entry.anchor.remove(entry.rig.root);
      entry.rig.dispose();
      this.attachRig(entry.anchor, replacement);
      if (glide) glide.object = replacement.root;
      this.pieces.set(sq, { ...entry, rig: replacement });
    }
  }

  setPieceVariant(hook: PieceVariantHook | null): void {
    this.variantHook = hook;
  }

  // ── Piece management ──────────────────────────────────────────────────────

  private attachRig(anchor: THREE.Group, rig: CharacterRig): void {
    rig.root.position.set(0, 0, 0);
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    anchor.add(rig.root);
  }

  syncBoard(board: Board64, builder: RigBuilder): void {
    this.lastBuilder = builder;
    const flat = this.viewMode === '2d';

    const stale: Array<[Square, PieceEntry]> = [];
    for (const [sq, entry] of this.pieces) {
      const want = board[sq];
      if (!want || want.type !== entry.piece.type || want.color !== entry.piece.color) {
        stale.push([sq, entry]);
      }
    }
    const needs: Square[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const want = board[sq];
      if (!want) continue;
      const have = this.pieces.get(sq);
      if (have && have.piece.type === want.type && have.piece.color === want.color) continue;
      needs.push(sq);
    }

    for (const [sq] of stale) this.pieces.delete(sq);

    for (const sq of needs) {
      const want = board[sq] as ColoredPiece;
      const [wx, wy, wz] = squareToWorld(sq);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < stale.length; i++) {
        const [, entry] = stale[i];
        if (entry.piece.type !== want.type || entry.piece.color !== want.color) continue;
        const d = entry.anchor.position.distanceToSquared(this.scratchVec3.set(wx, wy, wz));
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const [, entry] = stale.splice(bestIdx, 1)[0];
        const from = entry.anchor.position.clone();
        entry.anchor.position.set(wx, wy, wz);
        if (!this.reducedMotion) {
          entry.rig.root.position.copy(from.sub(entry.anchor.position));
          this.glides.push({
            object: entry.rig.root,
            from: entry.rig.root.position.clone(),
            t: 0,
          });
        }
        this.pieces.set(sq, entry);
      } else {
        const anchor = new THREE.Group();
        anchor.position.set(wx, wy, wz);
        const rig = builder(PIECE_CHARACTER[want.type], factionOf(want.color), { flat });
        this.attachRig(anchor, rig);
        this.pieceLayer.add(anchor);
        this.pieces.set(sq, { anchor, rig, piece: { ...want } });
      }
    }

    for (const [, entry] of stale) {
      this.glides = this.glides.filter((g) => g.object !== entry.rig.root);
      this.pieceLayer.remove(entry.anchor);
      entry.rig.dispose();
    }
  }

  /** Board truth as read from the scene graph — the fuzz-harness oracle. */
  deriveBoard(): Board64 {
    const board: Board64 = new Array(64).fill(null);
    const p = new THREE.Vector3();
    for (const entry of this.pieces.values()) {
      entry.anchor.getWorldPosition(p);
      const sq = worldToSquare([p.x, p.y, p.z]);
      if (sq >= 0) board[sq] = { ...entry.piece };
    }
    return board;
  }

  getRigAt(sq: Square): CharacterRig | null {
    return this.pieces.get(sq)?.rig ?? null;
  }

  // ── Highlights ────────────────────────────────────────────────────────────

  setLegalTargets(squares: Square[]): void {
    for (let i = 0; i < this.legalDots.length; i++) {
      const dot = this.legalDots[i];
      if (i < squares.length) {
        const [x, , z] = squareToWorld(squares[i]);
        dot.position.x = x;
        dot.position.z = z;
        dot.visible = true;
      } else {
        dot.visible = false;
      }
    }
  }

  setLastMove(move: { from: Square; to: Square } | null): void {
    if (!move) {
      this.lastMoveFrom.visible = false;
      this.lastMoveTo.visible = false;
      return;
    }
    const [fx, , fz] = squareToWorld(move.from);
    const [tx, , tz] = squareToWorld(move.to);
    this.lastMoveFrom.position.set(fx, 0.012, fz);
    this.lastMoveTo.position.set(tx, 0.012, tz);
    this.lastMoveFrom.visible = true;
    this.lastMoveTo.visible = true;
  }

  setCheckSquare(sq: Square | null): void {
    this.checkSquare = sq;
    if (sq === null) {
      this.checkRing.visible = false;
      return;
    }
    const [x, , z] = squareToWorld(sq);
    this.checkRing.position.set(x, 0.014, z);
    this.checkRing.visible = true;
  }

  setHoverSquare(sq: Square | null): void {
    this.placeFrame(this.hoverFrame, sq);
  }

  setSelectedSquare(sq: Square | null): void {
    this.placeFrame(this.selectedFrame, sq);
  }

  private placeFrame(mesh: THREE.Mesh, sq: Square | null): void {
    if (sq === null) {
      mesh.visible = false;
      return;
    }
    const [x, , z] = squareToWorld(sq);
    mesh.position.set(x, mesh.position.y, z);
    mesh.visible = true;
  }

  // ── Picking ───────────────────────────────────────────────────────────────

  private pickSquare(e: PointerEvent): Square {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return -1;
    const ndc = this.scratchVec2.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const camera = this.viewMode === '3d' ? this.perspCamera : this.orthoCamera;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(this.pickPlane, false);
    if (hits.length === 0) return -1;
    const p = hits[0].point;
    return worldToSquare([p.x, p.y, p.z]);
  }

  // ── Duel camera ───────────────────────────────────────────────────────────

  getDuelCameraRig(): DuelCameraRig {
    return {
      camera: this.perspCamera,
      moveTo: (pos, lookAt, t) => {
        if (this.viewMode === '2d') return;
        if (!this.duelActive) {
          this.duelActive = true;
          this.returning = false;
          this.duelStartPos.copy(this.perspCamera.position);
          this.duelStartLook.copy(this.orbitTarget);
        }
        const k = this.reducedMotion ? 1 : easeInOut(t);
        // moveTo runs every frame of a duel — keep it allocation-free.
        this.duelDesiredPos.lerpVectors(
          this.duelStartPos,
          this.scratchVec3.set(pos[0], pos[1], pos[2]),
          k,
        );
        this.duelDesiredLook.lerpVectors(
          this.duelStartLook,
          this.scratchVec3.set(lookAt[0], lookAt[1], lookAt[2]),
          k,
        );
      },
      shake: (intensity) => {
        if (this.viewMode === '2d' || this.reducedMotion) return;
        const a = this.shakePrng() * Math.PI * 2;
        const m = intensity * 0.08;
        this.shakeOffset.set(Math.cos(a) * m, this.shakePrng() * m * 0.6, Math.sin(a) * m);
      },
      release: () => {
        if (!this.duelActive) return;
        this.duelActive = false;
        if (this.viewMode === '2d' || this.reducedMotion) {
          this.applyOrbitCamera();
          return;
        }
        this.returning = true;
        this.returnT = 0;
        this.returnFromPos.copy(this.perspCamera.position);
        this.returnFromLook.copy(this.duelDesiredLook);
      },
    };
  }

  private orbitPosition(out: THREE.Vector3): THREE.Vector3 {
    const sp = Math.sin(this.orbitPolar);
    out.set(
      this.orbitTarget.x + this.orbitRadius * sp * Math.sin(this.orbitAzimuth),
      this.orbitTarget.y + this.orbitRadius * Math.cos(this.orbitPolar),
      this.orbitTarget.z + this.orbitRadius * sp * Math.cos(this.orbitAzimuth),
    );
    return out;
  }

  private applyOrbitCamera(): void {
    this.orbitPosition(this.perspCamera.position);
    this.perspCamera.lookAt(this.orbitTarget);
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  render(dt: number): void {
    this.time += dt;
    this.resizeIfNeeded();

    for (const g of this.glides) {
      g.t += dt / GLIDE_SECONDS;
      const k = 1 - easeInOut(g.t);
      g.object.position.copy(g.from).multiplyScalar(k);
    }
    this.glides = this.glides.filter((g) => g.t < 1);

    if (this.checkSquare !== null && this.checkRing.visible) {
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.time * 5) * 0.08;
      this.checkRing.scale.setScalar(pulse);
    }

    if (this.duelActive) {
      this.perspCamera.position.copy(this.duelDesiredPos).add(this.shakeOffset);
      this.perspCamera.lookAt(this.duelDesiredLook);
      this.shakeOffset.multiplyScalar(Math.max(0, 1 - dt * 10));
    } else if (this.returning) {
      this.returnT += dt / CAMERA_RETURN_SECONDS;
      const k = easeInOut(this.returnT);
      const target = this.orbitPosition(this.scratchVec3);
      this.perspCamera.position.lerpVectors(this.returnFromPos, target, k);
      const look = this.scratchVec3b.lerpVectors(this.returnFromLook, this.orbitTarget, k);
      this.perspCamera.lookAt(look);
      if (this.returnT >= 1) this.returning = false;
    } else {
      this.applyOrbitCamera();
    }

    const camera = this.viewMode === '3d' ? this.perspCamera : this.orthoCamera;
    this.renderer.render(this.scene, camera);
  }

  // ── Resize / teardown ─────────────────────────────────────────────────────

  private resizeIfNeeded(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const size = this.scratchSize;
    this.renderer.getSize(size);
    const pr = this.renderer.getPixelRatio();
    if (Math.abs(size.x - w) > 0.5 || Math.abs(size.y - h) > 0.5 || pr === 0) {
      this.resize();
    }
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    this.updateOrthoFrustum(aspect);
  }

  private updateOrthoFrustum(aspect: number): void {
    const halfH = aspect >= 1 ? ORTHO_HALF : ORTHO_HALF / aspect;
    const halfW = halfH * aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  dispose(): void {
    this.removeListeners();
    for (const [, entry] of this.pieces) {
      this.pieceLayer.remove(entry.anchor);
      entry.rig.dispose();
    }
    this.pieces.clear();
    this.glides = [];
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      }
    });
    this.renderer.dispose();
  }
}
