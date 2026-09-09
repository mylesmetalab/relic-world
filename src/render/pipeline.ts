import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  TOON_VERTEX, TOON_FRAGMENT, HULL_VERTEX, HULL_FRAGMENT, ND_VERTEX, ND_FRAGMENT,
  INK_VERTEX, INK_FRAGMENT, VAULT_VERTEX, VAULT_FRAGMENT,
} from "./shaders";
import { bakeGradientToRGBA, COLORWAYS, ENVWAYS, type Colorway, type GradientStop } from "./palette";

/**
 * The print pipeline, lifted from the tuner: colour target → normal+depth
 * target → press pass, all at a fixed PRINT density (canvas × printScale,
 * nearest-filtered). Nothing here knows about the world; it renders whatever
 * is in `scene` with the materials it hands out.
 */

export const INK_BLACK = 0x0a0a12;
const ND_FAR = 160;
const ROCK_RAMP_SCALE = 0.55;
const CEIL_RAMP_LO = 0.64;
const CEIL_RAMP_HI = 1.0;

export type Pipeline = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  inkPass: ShaderPass;
  ndRT: THREE.WebGLRenderTarget;
  ndMat: THREE.ShaderMaterial;
  torch: THREE.PointLight;
  /** Zone-filled figure material (the player). */
  figureMat: THREE.ShaderMaterial;
  /** Light-banded rock material (floor, boulders). */
  rockMat: THREE.ShaderMaterial;
  /** Unlit posterized ceiling with brush arcs. */
  ceilMat: THREE.ShaderMaterial;
  hullMat: THREE.ShaderMaterial;
  paletteTex: THREE.DataTexture;
  hiPaletteTex: THREE.DataTexture;
  bgPaletteTex: THREE.DataTexture;
  /** Objects hidden from the ND pass (hull shells). */
  ndHidden: Set<THREE.Object3D>;
  printScale: number;
  printW: number;
  printH: number;
  lastW: number;
  lastH: number;
  inkIndex: number;
  caveIndex: number;
};

type ToonOpts = {
  bands: number; rampScale: number; shadowGamma: number; colorMode: 0 | 1;
  rim: number; fog: number; fogTone: number; brk: number; pitchScale: number; cracks: number; fill: number;
};

function makeToonMaterial(paletteTex: THREE.DataTexture, hiTex: THREE.DataTexture, opts: ToonOpts): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: TOON_VERTEX,
    fragmentShader: TOON_FRAGMENT,
    uniforms: {
      uLightPos: { value: new THREE.Vector3(0, 3, 0) },
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

function makeLut(linear = false): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function writeLut(tex: THREE.DataTexture, stops: GradientStop[]): void {
  (tex.image.data as Uint8Array).set(bakeGradientToRGBA(stops, 256));
  tex.needsUpdate = true;
}

export function setInkColorway(p: Pipeline, index: number): Colorway {
  const cw = COLORWAYS[((index % COLORWAYS.length) + COLORWAYS.length) % COLORWAYS.length]!;
  p.inkIndex = COLORWAYS.indexOf(cw);
  writeLut(p.paletteTex, cw.base);
  writeLut(p.hiPaletteTex, cw.hi);
  return cw;
}

export function setCaveColorway(p: Pipeline, index: number): string {
  const ew = ENVWAYS[((index % ENVWAYS.length) + ENVWAYS.length) % ENVWAYS.length]!;
  p.caveIndex = ENVWAYS.indexOf(ew);
  writeLut(p.bgPaletteTex, ew.ramp);
  return ew.name;
}

export function createPipeline(canvas: HTMLCanvasElement, printScale = 0.6): Pipeline {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(INK_BLACK, 1);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK_BLACK);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  scene.add(new THREE.AmbientLight(0x6a3fb8, 0.55));
  // The carried torch — the one light the tone is measured against. main()
  // parks it up-left-front of the player every frame.
  const torch = new THREE.PointLight(0xc8ffd8, 6, 60, 1.6);
  scene.add(torch);

  const paletteTex = makeLut();
  const hiPaletteTex = makeLut();
  const bgPaletteTex = makeLut(true);

  const figureMat = makeToonMaterial(paletteTex, hiPaletteTex, {
    bands: 4, rampScale: 1, shadowGamma: 1.0, colorMode: 0, rim: 0.4, fog: 0, fogTone: 0, brk: 0, pitchScale: 1, cracks: 0, fill: 0.3,
  });
  const rockMat = makeToonMaterial(bgPaletteTex, bgPaletteTex, {
    bands: 3, rampScale: ROCK_RAMP_SCALE, shadowGamma: 0.85, colorMode: 1, rim: 0, fog: 0.55, fogTone: 0.35, brk: 0.3, pitchScale: 1.3, cracks: 0.55, fill: 0,
  });
  rockMat.uniforms.uHatchRange.value = 0.55;
  rockMat.uniforms.uBlack.value = 0.3;
  rockMat.uniforms.uNib.value = 1.0;
  rockMat.uniforms.uStipple.value = 0.35;
  rockMat.uniforms.uFormFollow.value = 0.35;

  const ceilMat = new THREE.ShaderMaterial({
    vertexShader: VAULT_VERTEX,
    fragmentShader: VAULT_FRAGMENT,
    side: THREE.FrontSide,
    uniforms: {
      uPaletteTex: { value: bgPaletteTex },
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
      uPaper: { value: new THREE.Color(0xe8e4d0) },
    },
    vertexShader: INK_VERTEX,
    fragmentShader: INK_FRAGMENT,
  });
  inkPass.uniforms.tND.value = ndRT.texture;
  inkPass.renderToScreen = true;
  composer.addPass(inkPass);

  const p: Pipeline = {
    renderer, scene, camera, composer, inkPass, ndRT, ndMat, torch,
    figureMat, rockMat, ceilMat, hullMat, paletteTex, hiPaletteTex, bgPaletteTex,
    ndHidden: new Set(), printScale, printW: 2, printH: 2, lastW: 0, lastH: 0, inkIndex: 0, caveIndex: 0,
  };
  setInkColorway(p, 0);
  setCaveColorway(p, 0);
  return p;
}

/** Size renderer + camera to the canvas, and the print targets to canvas ×
 *  printScale. Tracked independently of the renderer's own guard. */
export function resizePipeline(p: Pipeline, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  if (p.lastW === w && p.lastH === h) return;
  p.lastW = w;
  p.lastH = h;
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

  p.inkPass.uniforms.uTime.value += dt;
  p.figureMat.uniforms.uLightPos.value.copy(p.torch.position);
  p.rockMat.uniforms.uLightPos.value.copy(p.torch.position);
  p.composer.render();
}
