import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  TOON_VERTEX, TOON_FRAGMENT, HULL_VERTEX, HULL_FRAGMENT, ND_VERTEX, ND_FRAGMENT,
  INK_VERTEX, INK_FRAGMENT, VAULT_VERTEX, VAULT_FRAGMENT,
} from "./shaders";
import { bakeGradientToRGBA, COLORWAYS, type Colorway, type GradientStop } from "./palette";
import { BIOMES, biomeScale } from "../world/biomes";
import { CFG } from "../world/config";
import { InkMap } from "../world/inkmap";

/**
 * The print pipeline, lifted from the tuner: colour target → normal+depth
 * target → press pass, all at a fixed PRINT density (canvas × printScale,
 * nearest-filtered). Nothing here knows about the world; it renders whatever
 * is in `scene` with the materials it hands out.
 *
 * World additions over the tuner: up to four torches with reach (tone comes
 * from the brightest), the ink map (rock is bare paper until a torch has
 * reached it), and biomes (a ramp row + a pen per region, hard-edged).
 */

export const INK_BLACK = 0x0a0a12;
export const PAPER = 0xe8e4d0;
const ND_FAR = 160;
const ROCK_RAMP_SCALE = 0.55;
const CEIL_RAMP_LO = 0.64;
const CEIL_RAMP_HI = 1.0;
export const MAX_LIGHTS = 8;

export type Torch = { position: THREE.Vector3; reach: number };

export type Pipeline = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  inkPass: ShaderPass;
  ndRT: THREE.WebGLRenderTarget;
  ndMat: THREE.ShaderMaterial;
  /** Light-banded rock material (floor, boulders). */
  rockMat: THREE.ShaderMaterial;
  /** Unlit posterized ceiling with brush arcs. */
  ceilMat: THREE.ShaderMaterial;
  hullMat: THREE.ShaderMaterial;
  /** One zone-filled material per figure (own palette LUTs + bbox). */
  figureMats: Set<THREE.ShaderMaterial>;
  bgPaletteTex: THREE.DataTexture;
  biomeRamps: THREE.DataTexture;
  inkMap: InkMap;
  /** Objects hidden from the ND pass (hull shells). */
  ndHidden: Set<THREE.Object3D>;
  torches: Torch[];
  printScale: number;
  printW: number;
  printH: number;
  lastW: number;
  lastH: number;
  lastPrintScale: number;
  /** Accumulated time for the press pass grain. */
  time: number;
};

type ToonOpts = {
  bands: number; rampScale: number; shadowGamma: number; colorMode: 0 | 1;
  rim: number; fog: number; fogTone: number; brk: number; pitchScale: number; cracks: number; fill: number;
};

type SharedSources = { inkMap: InkMap; biomeRamps: THREE.DataTexture };

function penUniforms(): { a: THREE.Vector4[]; b: THREE.Vector4[] } {
  const a: THREE.Vector4[] = [];
  const b: THREE.Vector4[] = [];
  for (let i = 0; i < 8; i++) {
    const pen = (BIOMES[i] ?? BIOMES[0]!).pen;
    a.push(new THREE.Vector4(pen.hatchRange, pen.black, pen.pitchScale, pen.nib));
    b.push(new THREE.Vector4(pen.cracks, pen.stipple, pen.hatchRot, pen.formFollow));
  }
  return { a, b };
}

function lightUniforms(): Record<string, THREE.IUniform> {
  return {
    uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, 5, 0)) },
    uLightReach: { value: new Float32Array(MAX_LIGHTS) },
    uLightCount: { value: 1 },
  };
}

function makeToonMaterial(
  paletteTex: THREE.DataTexture, hiTex: THREE.DataTexture, shared: SharedSources,
  opts: ToonOpts, useBiomes: boolean, useInkMap: boolean,
): THREE.ShaderMaterial {
  const pens = penUniforms();
  return new THREE.ShaderMaterial({
    vertexShader: TOON_VERTEX,
    fragmentShader: TOON_FRAGMENT,
    uniforms: {
      ...lightUniforms(),
      uInkMap: { value: shared.inkMap.texture },
      uInkMapRect: { value: shared.inkMap.rect(useInkMap) },
      uPaper: { value: new THREE.Color(PAPER) },
      uBiomeRamps: { value: shared.biomeRamps },
      uBiomeCount: { value: BIOMES.length },
      uBiomeScale: { value: biomeScale() },
      uBiomeSeed: { value: 0 },
      uUseBiomes: { value: useBiomes ? 1 : 0 },
      uPenA: { value: pens.a },
      uPenB: { value: pens.b },
      uAmbientColor: { value: new THREE.Color(0x6a3fb8) },
      uInk: { value: new THREE.Color(INK_BLACK) },
      uPaletteTex: { value: paletteTex },
      uHiTex: { value: hiTex },
      uBands: { value: opts.bands },
      uRampOffset: { value: 0 },
      uRampScale: { value: opts.rampScale },
      uShadowGamma: { value: opts.shadowGamma },
      uColorMode: { value: opts.colorMode },
      uZones: { value: 10 },
      uZoneBlend: { value: 1 },
      uZoneJitter: { value: opts.colorMode === 0 ? 0.035 : 0 },
      uZoneSoft: { value: opts.colorMode === 0 ? 0.04 : 0 },
      uMinY: { value: -1 },
      uMaxY: { value: 1 },
      uHiCut: { value: 0.78 },
      uHatchRange: { value: 0.5 },
      uBlack: { value: 0.1 },
      uRim: { value: opts.rim },
      uFog: { value: opts.fog },
      uFogTone: { value: opts.fogTone },
      uFogRange: { value: new THREE.Vector2(14, 70) },
      uBreak: { value: opts.brk },
      uPitch: { value: 8 },
      uNib: { value: 0.75 },
      uHatchRot: { value: 0 },
      uHatchStyle: { value: 0 },
      uStipple: { value: 0.06 },
      uHatchPhase: { value: new THREE.Vector2(0, 0) },
      uHatchSeed: { value: 0 },
      uPitchScale: { value: opts.pitchScale },
      uFormFollow: { value: 0.6 },
      uHeadFrom: { value: 0.64 },
      uHeadPitch: { value: opts.colorMode === 0 ? 0.68 : 1 },
      uCracks: { value: opts.cracks },
      uFillDir: { value: new THREE.Vector3(0.2, -1, 0.45) },
      uFill: { value: opts.fill },
    },
  });
}

/** Anchor a mesh's hatching to itself: before each draw, project its world
 *  origin into print pixels and hand that (plus its own family angle) to the
 *  shared material. `uniformsNeedUpdate` forces the upload — three otherwise
 *  skips uniforms for consecutive draws of the same material. */
export function anchorHatch(p: Pipeline, mesh: THREE.Mesh, seed: number): void {
  const v = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _s, camera, _g, material) => {
    const m = material as THREE.ShaderMaterial;
    const u = m.uniforms;
    if (!u || !u.uHatchPhase) return;
    mesh.getWorldPosition(v).project(camera);
    u.uHatchPhase.value.set((v.x * 0.5 + 0.5) * p.printW, (v.y * 0.5 + 0.5) * p.printH);
    u.uHatchSeed.value = seed;
    m.uniformsNeedUpdate = true;
  };
}

function makeLut(linear = false, rows = 1): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(256 * rows * 4), 256, rows, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function writeLut(tex: THREE.DataTexture, stops: GradientStop[], row = 0): void {
  (tex.image.data as Uint8Array).set(bakeGradientToRGBA(stops, 256), row * 256 * 4);
  tex.needsUpdate = true;
}

/** A figure's own zone material: two LUTs it can recolour independently. */
export function makeFigureMaterial(p: Pipeline): THREE.ShaderMaterial {
  const base = makeLut();
  const hi = makeLut();
  const m = makeToonMaterial(base, hi, { inkMap: p.inkMap, biomeRamps: p.biomeRamps }, {
    bands: 4, rampScale: 1, shadowGamma: 1.0, colorMode: 0, rim: 0.4, fog: 0, fogTone: 0, brk: 0, pitchScale: 1, cracks: 0, fill: 0.3,
  }, false, false);
  m.userData.lutBase = base;
  m.userData.lutHi = hi;
  p.figureMats.add(m);
  setFigureColorway(m, 0);
  return m;
}

export function disposeFigureMaterial(p: Pipeline, m: THREE.ShaderMaterial): void {
  p.figureMats.delete(m);
  (m.userData.lutBase as THREE.DataTexture).dispose();
  (m.userData.lutHi as THREE.DataTexture).dispose();
  m.dispose();
}

export function setFigureColorway(m: THREE.ShaderMaterial, index: number): Colorway {
  const cw = COLORWAYS[((index % COLORWAYS.length) + COLORWAYS.length) % COLORWAYS.length]!;
  writeLut(m.userData.lutBase as THREE.DataTexture, cw.base);
  writeLut(m.userData.lutHi as THREE.DataTexture, cw.hi);
  m.userData.colorway = COLORWAYS.indexOf(cw);
  return cw;
}

export function createPipeline(canvas: HTMLCanvasElement, printScale = 0.6): Pipeline {
  // preserveDrawingBuffer so photo mode (and a harness) can read the canvas
  // back after the frame; the cost is one buffer copy per frame.
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(INK_BLACK, 1);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK_BLACK);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  const inkMap = new InkMap();
  const biomeRamps = makeLut(true, BIOMES.length);
  BIOMES.forEach((b, i) => writeLut(biomeRamps, b.ramp, i));
  const shared: SharedSources = { inkMap, biomeRamps };

  const bgPaletteTex = makeLut(true);
  writeLut(bgPaletteTex, BIOMES[0]!.ramp);

  const rockMat = makeToonMaterial(bgPaletteTex, bgPaletteTex, shared, {
    bands: 3, rampScale: ROCK_RAMP_SCALE, shadowGamma: 1.25, colorMode: 1, rim: 0, fog: 0.5, fogTone: 0.4, brk: 0.3, pitchScale: 1.3, cracks: 0.55, fill: 0,
  }, true, true);

  const ceilMat = new THREE.ShaderMaterial({
    vertexShader: VAULT_VERTEX,
    fragmentShader: VAULT_FRAGMENT,
    // Double-sided: the lower cave's ceiling is the slab under the upper
    // level, and from a gallery's edge you look down onto its top.
    side: THREE.DoubleSide,
    uniforms: {
      ...lightUniforms(),
      uPaletteTex: { value: bgPaletteTex },
      uBiomeRamps: { value: biomeRamps },
      uBiomeCount: { value: BIOMES.length },
      uBiomeScale: { value: biomeScale() },
      uBiomeSeed: { value: 0 },
      uUseBiomes: { value: 1 },
      uInkMap: { value: inkMap.texture },
      uInkMapRect: { value: inkMap.rect(true) },
      uPaper: { value: new THREE.Color(PAPER) },
      uRampLo: { value: CEIL_RAMP_LO },
      uRampHi: { value: CEIL_RAMP_HI },
      uMinY: { value: 6 },
      uMaxY: { value: 17 },
      uCell: { value: 26 },
      uArcSpacing: { value: 1.6 },
      uSeed: { value: 0 },
      uMeshY: { value: 0 },
    },
  });

  const hullMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uThick: { value: 0.55 }, uInk: { value: new THREE.Color(INK_BLACK) } },
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
  });

  const ndRT = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.UnsignedByteType,
  });
  const ndMat = new THREE.ShaderMaterial({ uniforms: { uFar: { value: ND_FAR } }, vertexShader: ND_VERTEX, fragmentShader: ND_FRAGMENT });

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    rt.texture.minFilter = THREE.NearestFilter;
    rt.texture.magFilter = THREE.NearestFilter;
  }
  composer.addPass(new RenderPass(scene, camera));
  const inkPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tND: { value: null },
      uResolution: { value: new THREE.Vector2(2, 2) },
      uMisreg: { value: 0.6 },
      uEdgeW: { value: 1.0 },
      uDepthCut: { value: 0.012 },
      uNormalCut: { value: 0.5 },
      uHalftoneScale: { value: 4 },
      uHalftoneAngle: { value: 20 },
      uHalftone: { value: 0 },
      uGrain: { value: 0.9 },
      uSpeck: { value: 0.004 },
      uTime: { value: 0 },
      uInk: { value: new THREE.Color(INK_BLACK) },
      uPaper: { value: new THREE.Color(PAPER) },
    },
    vertexShader: INK_VERTEX,
    fragmentShader: INK_FRAGMENT,
  });
  inkPass.uniforms.tND.value = ndRT.texture;
  inkPass.renderToScreen = true;
  composer.addPass(inkPass);

  return {
    renderer, scene, camera, composer, inkPass, ndRT, ndMat,
    rockMat, ceilMat, hullMat, figureMats: new Set(), bgPaletteTex, biomeRamps, inkMap,
    ndHidden: new Set(), torches: [], printScale, printW: 2, printH: 2, lastW: 0, lastH: 0, lastPrintScale: 0, time: 0,
  };
}

/** Push every tunable that lives in a uniform (CFG + BIOMES) into the materials. */
export function applyConfig(p: Pipeline): void {
  const L = CFG.light, F = CFG.figure, P = CFG.press;
  const pens = penUniforms();
  for (const m of [p.rockMat, p.ceilMat, ...p.figureMats]) {
    const u = m.uniforms;
    u.uBiomeScale.value = biomeScale();
    if (u.uPenA) { u.uPenA.value = pens.a; u.uPenB.value = pens.b; }
  }
  BIOMES.forEach((b, i) => writeLut(p.biomeRamps, b.ramp, i));
  const r = p.rockMat.uniforms;
  r.uFogRange.value.set(L.fogNear, L.fogFar);
  r.uFog.value = L.fog;
  r.uFogTone.value = L.fogTone;
  r.uBreak.value = L.mottle;
  r.uShadowGamma.value = L.shadowGamma;
  p.ceilMat.uniforms.uCell.value = L.ceilCell;
  p.ceilMat.uniforms.uArcSpacing.value = L.ceilArcSpacing;
  for (const m of p.figureMats) {
    const u = m.uniforms;
    u.uHatchRange.value = F.hatchRange; u.uBlack.value = F.black; u.uPitch.value = F.pitch; u.uNib.value = F.nib;
    u.uRim.value = F.rim; u.uFill.value = F.fill; u.uStipple.value = F.stipple; u.uFormFollow.value = F.formFollow;
    u.uZoneSoft.value = F.zoneSoft; u.uZoneJitter.value = F.zoneJitter; u.uHiCut.value = F.hiCut; u.uHatchStyle.value = F.hatchStyle;
  }
  p.hullMat.uniforms.uThick.value = F.hull;
  const k = p.inkPass.uniforms;
  k.uMisreg.value = P.misreg; k.uEdgeW.value = P.edgeW; k.uDepthCut.value = P.depthCut; k.uNormalCut.value = P.normalCut;
  k.uGrain.value = P.grain; k.uSpeck.value = P.speck; k.uHalftone.value = P.halftone; k.uHalftoneScale.value = P.halftoneScale; k.uHalftoneAngle.value = P.halftoneAngle;
  p.printScale = P.printScale;
}

export function setWorldSeed(p: Pipeline, seed: number): void {
  p.rockMat.uniforms.uBiomeSeed.value = seed;
  p.ceilMat.uniforms.uBiomeSeed.value = seed;
  p.ceilMat.uniforms.uSeed.value = seed;
}

/** Turn "unprinted until lit" on/off (photo mode wants everything printed). */
export function setInkMapEnabled(p: Pipeline, on: boolean): void {
  p.rockMat.uniforms.uInkMapRect.value.w = on ? 1 : 0;
  p.ceilMat.uniforms.uInkMapRect.value.w = on ? 1 : 0;
}

/** Push the torch list into every lit material. */
function applyTorches(p: Pipeline): void {
  const n = Math.min(MAX_LIGHTS, p.torches.length);
  const mats = [p.rockMat, p.ceilMat, ...p.figureMats];
  for (const m of mats) {
    const u = m.uniforms;
    u.uLightCount.value = n;
    const arr = u.uLights.value as THREE.Vector3[];
    const reach = u.uLightReach.value as Float32Array;
    for (let i = 0; i < n; i++) {
      arr[i]!.copy(p.torches[i]!.position);
      reach[i] = p.torches[i]!.reach;
    }
  }
}

/** Size renderer + camera to the canvas, and the print targets to canvas ×
 *  printScale. Tracked independently of the renderer's own guard. */
export function resizePipeline(p: Pipeline, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  if (p.lastW === w && p.lastH === h && p.lastPrintScale === p.printScale) return;
  p.lastW = w;
  p.lastH = h;
  p.lastPrintScale = p.printScale;
  p.renderer.setSize(w, h, false);
  const pr = p.renderer.getPixelRatio();
  const rw = Math.max(2, Math.round(w * pr * p.printScale));
  const rh = Math.max(2, Math.round(h * pr * p.printScale));
  p.composer.setSize(rw, rh);
  p.ndRT.setSize(rw, rh);
  p.printW = rw;
  p.printH = rh;
  p.inkPass.uniforms.uResolution.value.set(rw, rh);
  p.camera.aspect = w / h;
  p.camera.updateProjectionMatrix();
}

/** Normal+depth pass (everything but the hull shells), then colour → press. */
export function renderFrame(p: Pipeline, dt: number): void {
  const { renderer, scene, camera } = p;
  applyTorches(p);
  p.inkMap.flush();
  const prevBackground = scene.background;
  const prevClear = renderer.getClearColor(new THREE.Color());
  for (const o of p.ndHidden) o.visible = false;
  scene.overrideMaterial = p.ndMat;
  scene.background = null;
  renderer.setClearColor(0x8080ff, 1); // "no geometry": normal (0,0), depth = far
  renderer.setRenderTarget(p.ndRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, 1);
  scene.overrideMaterial = null;
  scene.background = prevBackground;
  for (const o of p.ndHidden) o.visible = true;

  p.time += dt;
  p.inkPass.uniforms.uTime.value = p.time;
  p.composer.render();
}

/** Render one frame at an arbitrary size (photo export) and return a PNG
 *  data URL. Restores the live size afterwards. */
export function renderStill(p: Pipeline, w: number, h: number): string {
  const liveW = p.lastW, liveH = p.lastH;
  const pr = p.renderer.getPixelRatio();
  p.renderer.setPixelRatio(1);
  p.lastW = 0; // force a resize
  resizePipeline(p, w, h);
  renderFrame(p, 0);
  const url = p.renderer.domElement.toDataURL("image/png");
  p.renderer.setPixelRatio(pr);
  p.lastW = 0;
  resizePipeline(p, liveW, liveH);
  return url;
}
