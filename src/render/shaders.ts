/**
 * Relic World — GLSL for the print pipeline (from the Riso Relic Tuner).
 *
 * The governing rule (borrowed from the "Rook, inked" study): LIGHTING PICKS
 * WHICH FLAT INK TO LAY DOWN; IT NEVER SHADES ONE. Everything below is
 * either a spot-colour fill or black ink.
 *
 * 1. TOON — the figure/rock material. Fill is chosen by ZONE (object-space
 *    height → a base ink and a highlight ink, the highlight taken where the
 *    tone is bright) or, for the rock, by posterized light band. Shadow is
 *    ink: three ruled hatch families that switch on as tone drops, the nib
 *    widening as it darkens, then solid black. Hatching is sampled in the
 *    PRINT pixel grid (the low-res colour target), so it belongs to the
 *    picture plane like ink on paper and holds its weight at any zoom.
 * 2. HULL — a heavy contour as an inverted hull: a back-face copy pushed out
 *    along smoothed normals, depth-scaled for constant screen weight,
 *    wobbled so it reads as a nib rather than a uniform stroke.
 * 3. ND — normals + depth packed into one RGBA8 target (normal.xy in rg,
 *    16-bit depth split across b/a) for the key plate's crease detection.
 *    Drawn from a FLAT-normal copy of the figure, so facet edges of the
 *    decimated mesh become the scratchy crease lines of the style.
 * 4. PRESS — the final full-screen pass: colour plates land off-register,
 *    the key plate (creases from depth + normal discontinuity) stays put,
 *    paper tooth, specks, grain, linear→sRGB. Upscales the low-res print
 *    target with nearest-neighbour so hatch and grain stay chunky.
 * 5. VAULT — unlit concave tunnel backdrop: posterized blues cut by
 *    concentric broken black brush arcs.
 */

export const TOON_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vLocalY;
varying float vDepth;
// Instanced rocks (src/world/chunks.ts) carry their own per-instance hatch
// anchor instead of the shared uHatchPhase/uHatchSeed uniform an
// onBeforeRender callback can only set correctly for ONE mesh at a time —
// see the matching branch in TOON_FRAGMENT.
#ifdef USE_INSTANCE_HATCH
attribute float instanceHatchSeed;
uniform vec2 uPrintSize;
varying vec2 vHatchPhase;
varying float vHatchSeed;
#endif

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
#ifdef USE_INSTANCING
  // three.js auto-declares an instanceMatrix attribute for any InstancedMesh;
  // apply it ourselves since this vertex shader is fully custom (no built-in
  // instancing_vertex / defaultnormal_vertex chunks). Normal transform
  // follows three's own non-uniform-scale trick (divide by each row's
  // squared length before applying) — exact for the shear-free
  // scale+rotate+translate matrices chunks.ts builds.
  transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  mat3 im = mat3(instanceMatrix);
  objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  objectNormal = im * objectNormal;
#endif
  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vec4 mv = viewMatrix * worldPos;
  vPosW = worldPos.xyz;
  vLocalY = transformed.y;
  vDepth = -mv.z;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
#ifdef USE_INSTANCE_HATCH
  // Project the INSTANCE's own origin (not this vertex) so every vertex of
  // one instance agrees on one hatch anchor, exactly like the per-mesh
  // onBeforeRender path anchors on the mesh's world origin.
  vec3 originLocal = instanceMatrix[3].xyz;
  vec4 originClip = projectionMatrix * viewMatrix * modelMatrix * vec4(originLocal, 1.0);
  vec2 originNdc = originClip.xy / originClip.w;
  vHatchPhase = (originNdc * 0.5 + 0.5) * uPrintSize;
  vHatchSeed = instanceHatchSeed;
#endif
  gl_Position = projectionMatrix * mv;
}
`;

export const TOON_FRAGMENT = /* glsl */ `
// Up to 8 torches. Tone is the brightest torch's N·L, attenuated to zero at
// that torch's reach — beyond every torch the rock is UNPRINTED (paper).
uniform vec3 uLights[8];
uniform float uLightReach[8];
uniform int uLightCount;
// Where the player's light has BEEN: a world-space R8 map (rect = x0, z0,
// size, enabled). Once inked, rock stays inked.
uniform sampler2D uInkMap;
uniform vec4 uInkMapRect;
uniform vec3 uPaper;
// Biomes: N cave ramps stacked as rows of one texture, a pen per row, and a
// world-space region field (same noise as world/biomes.ts) with HARD edges.
uniform sampler2D uBiomeRamps;
uniform float uBiomeCount;
uniform float uBiomeScale;
uniform float uBiomeSeed;
uniform float uUseBiomes;
// Sized to BIOMES.length (src/world/biomes.ts) -- keep in sync, GLSL array
// sizes are compile-time. A biome index past the end of these read out of
// bounds (undefined per spec; observed as silently repeating an earlier
// biome's pen on real GPUs), so any newly added biome past this count would
// quietly lose its own hatch/black/pitch/nib tuning until bumped.
uniform vec4 uPenA[10]; // hatchRange, black, pitchScale, nib
uniform vec4 uPenB[10]; // cracks, stipple, hatchRot, formFollow
uniform float uShadowLift;
uniform vec3 uAmbientColor;
uniform vec3 uInk;
uniform sampler2D uPaletteTex;
uniform sampler2D uHiTex;
uniform float uBands;
// Which slice of the ramp this material draws from: the figure uses the
// whole ramp (offset 0, scale 1); the rock environment only its lower,
// black→violet→magenta part so its brightest band is magenta, never the
// blue the ramp reserves for the vault.
uniform float uRampOffset;
uniform float uRampScale;
uniform float uShadowGamma;
// 0 = fill by ZONE (object-space height between uMinY..uMaxY, quantized
// into uZones steps and blended back toward the raw gradient by
// uZoneBlend); 1 = fill by posterized light band.
uniform float uColorMode;
uniform float uZones;
uniform float uZoneBlend;
// Wobbles the height a zone boundary is read at (world-space noise, in
// normalized-height units) so a boundary follows a ragged hand-painted
// line instead of a ruler-straight horizontal cut across the figure.
uniform float uZoneJitter;
// Depth below the (undug) surface, 0 at/above it ramping to 1 by ~40 m down
// (set from main.ts each frame), scaled by uDepthStrange (a tuner knob) —
// together they make the lower cave read jitterier and its bare-paper
// reveal dimmer the deeper you go.
uniform float uDepth;
uniform float uDepthStrange;
// Half-width (normalized height) of the box blur applied to the zone LUT
// lookups — 0 is a hard ink boundary, larger fades one ink into the next.
uniform float uZoneSoft;
uniform float uMinY;
uniform float uMaxY;
// Tone → ink selection. Highlight ink above uHiCut; hatch families switch
// on below uHatchRange (and 0.65× / 0.35× of it); solid black below uBlack.
uniform float uHiCut;
uniform float uHatchRange;
uniform float uBlack;
// Rim adds tone at grazing angles (a backlit comic edge — highlight ink
// along the silhouette, not a glow).
uniform float uRim;
// Tone drifts toward uFogTone with depth (the far cave floor — a high tone
// there lands the horizon in the magenta band, like the reference's rock
// behind the figure) and is broken up by noise (mottled rock) — all 0 for
// the figure.
uniform float uFog;
uniform float uFogTone;
// Depth span (view units) over which the fog drift ramps in.
uniform vec2 uFogRange;
uniform float uBreak;
// Hatch geometry in PRINT pixels.
uniform float uPitch;
uniform float uNib;
uniform float uHatchRot;
uniform float uHatchStyle; // 0 = ruled families, 1 = form-following dashes
uniform float uStipple;
// Per-OBJECT hatching. uHatchPhase anchors the line grid to the object's
// projected origin (print px) and uHatchSeed turns its families, so each
// rock / the figure carries its own hatch that stops at its silhouette
// instead of one screen-wide screen running across everything;
// uPitchScale lets the environment hatch coarser than the figure;
// uFormFollow leans the families toward the surface's screen tangent so
// strokes wrap arms and folds.
uniform vec2 uHatchPhase;
uniform float uHatchSeed;
#ifdef USE_INSTANCE_HATCH
varying vec2 vHatchPhase;
varying float vHatchSeed;
#endif
uniform float uPitchScale;
uniform float uFormFollow;
// Finer pen above uHeadFrom (normalized height): the reference hatches the
// face and headwrap with a lighter hand than the coat.
uniform float uHeadFrom;
uniform float uHeadPitch;
// Black crack lines along noise contours — the drawn quality of the
// reference's rock (0 on the figure).
uniform float uCracks;
// A second, coloured-floor bounce light from below-front: lifts tone on the
// undersides so they take the base ink instead of dropping to black.
uniform vec3 uFillDir;
uniform float uFill;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vLocalY;
varying float vDepth;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Region id at a world xz — mirrors biomeField() in world/biomes.ts.
int biomeId(vec2 xz) {
  vec2 p = xz / uBiomeScale + vec2(uBiomeSeed * 0.37, uBiomeSeed * 0.11);
  float n = vnoise(p) * 0.7 + vnoise(p * 2.3 + vec2(5.1, 1.7)) * 0.3;
  n = clamp((n - 0.5) * 2.2 + 0.5, 0.0, 0.999);
  return int(min(uBiomeCount - 1.0, floor(n * uBiomeCount)));
}

// A ruled family: lines every uPitch print px, measured along direction d.
float ruleDir(vec2 p, vec2 d, float freq, float w) {
  float t = abs(fract(dot(p, d) * freq) - 0.5) * 2.0;
  return 1.0 - smoothstep(w, w + 0.09, t);
}
vec2 rot2(vec2 d, float a) {
  return vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
}

// Form-following alternative: dashed strokes perpendicular to the
// screen-space normal, so they wrap arms and folds like contour hatching.
float contourStrokes(vec2 fc, vec2 dir, float density, float weight, float seed) {
  float across = dot(fc, vec2(-dir.y, dir.x));
  float along = dot(fc, dir);
  float line = floor(across * density);
  float tri = abs(fract(across * density) * 2.0 - 1.0);
  float phase = hash21(vec2(line, seed)) * 40.0;
  float seg = floor((along + phase) * density * 0.45);
  float on = step(0.32, hash21(vec2(seg, line + seed)));
  float u = fract((along + phase) * density * 0.45);
  float taper = smoothstep(0.0, 0.18, u) * (1.0 - smoothstep(0.82, 1.0, u));
  float w = max(weight * (0.55 + 0.45 * taper), 0.001);
  return (1.0 - smoothstep(0.0, w, tri)) * on;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float depthAmt = uDepth * uDepthStrange;
#ifdef USE_INSTANCE_HATCH
  vec2 hatchPhase = vHatchPhase;
  float hatchSeed = vHatchSeed;
#else
  vec2 hatchPhase = uHatchPhase;
  float hatchSeed = uHatchSeed;
#endif

  // ── Biome pen (rock only) ─────────────────────────────────────────
  int bi = uUseBiomes > 0.5 ? biomeId(vPosW.xz) : 0;
  float hatchRange = uUseBiomes > 0.5 ? uPenA[bi].x : uHatchRange;
  // uShadowLift shrinks the flat-black cutoff toward 0: a live experiment
  // (tune panel) for "shading reads as darkness" -- 0 leaves every biome's
  // authored look untouched, 1 means a shadow never goes fully flat ink.
  float blackCut   = (uUseBiomes > 0.5 ? uPenA[bi].y : uBlack) * (1.0 - uShadowLift);
  float pitchScale = uUseBiomes > 0.5 ? uPenA[bi].z : uPitchScale;
  float nib        = uUseBiomes > 0.5 ? uPenA[bi].w : uNib;
  float cracks     = uUseBiomes > 0.5 ? uPenB[bi].x : uCracks;
  float stipple    = uUseBiomes > 0.5 ? uPenB[bi].y : uStipple;
  float hatchRot   = uUseBiomes > 0.5 ? uPenB[bi].z : uHatchRot;
  float formFollow = uUseBiomes > 0.5 ? uPenB[bi].w : uFormFollow;

  // ── Tone: a scalar the inks are chosen from, never applied as shade ──
  // The brightest torch wins; each fades to nothing at its reach.
  float tone = 0.0;
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec3 toL = uLights[i] - vPosW;
    float dist = length(toL);
    float reach = uLightReach[i];
    float att = reach > 0.0 ? 1.0 - smoothstep(reach * 0.45, reach, dist) : 1.0;
    float t = pow(max(dot(N, toL / max(dist, 1e-4)), 0.0), uShadowGamma) * att;
    tone = max(tone, t);
    lit = max(lit, att);
  }
  tone = max(tone, max(dot(N, normalize(uFillDir)), 0.0) * uFill * max(lit, step(uInkMapRect.w, 0.5)));
  tone += pow(1.0 - max(dot(N, V), 0.0), 2.5) * uRim;
  tone = clamp(tone, 0.0, 1.0);
  tone = mix(tone, uFogTone, smoothstep(uFogRange.x, uFogRange.y, vDepth) * uFog);
  vec2 fc = gl_FragCoord.xy;
  if (uBreak > 0.0) {
    // Mottle lives on the ROCK, not the screen: world-space noise offset by
    // the object's own hatch seed, so each boulder carries its own blotches
    // and nothing slides as the camera moves.
    vec2 wp = vPosW.xz + vPosW.y * 0.7 + hatchSeed * 11.0;
    float b = vnoise(wp * 1.1) * 0.6 + vnoise(wp * 0.33 + 4.0) * 0.4;
    tone = clamp(tone - uBreak * (0.75 - b), 0.0, 1.0);
  }

  // ── Fill ────────────────────────────────────────────────────────────
  float steps = max(uBands, 1.0);
  float banded = min(floor(tone * steps) / max(steps - 1.0, 1.0), 1.0);

  float hRaw = clamp((vLocalY - uMinY) / max(uMaxY - uMinY, 1e-4), 0.0, 1.0);
  float hJit = (vnoise(vec2(vPosW.x * 6.0 + vPosW.z * 4.0, vPosW.y * 5.0) + 2.7) - 0.5) * uZoneJitter * (1.0 + depthAmt * 2.0);
  hRaw = clamp(hRaw + hJit, 0.0, 1.0);
  float z = max(uZones, 1.0);
  float hStep = (floor(hRaw * z) + 0.5) / z;
  float h = mix(hStep, hRaw, uZoneBlend);

  vec3 base = vec3(0.0);
  vec3 hi = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    float hz = clamp(h + float(i) * uZoneSoft * 0.5, 0.0, 1.0);
    vec2 zoneUv = vec2(uRampOffset + hz * uRampScale, 0.5);
    base += texture2D(uPaletteTex, zoneUv).rgb;
    hi   += texture2D(uHiTex, zoneUv).rgb;
  }
  base /= 5.0;
  hi /= 5.0;
  vec3 zoneFill = tone > uHiCut ? hi : base;
  vec2 bandUv = vec2(uRampOffset + banded * uRampScale, 0.5);
  vec3 bandFill = uUseBiomes > 0.5
    ? texture2D(uBiomeRamps, vec2(bandUv.x, (float(bi) + 0.5) / uBiomeCount)).rgb
    : texture2D(uPaletteTex, bandUv).rgb;
  vec3 fill = mix(zoneFill, bandFill, uColorMode);
  fill = mix(fill, fill * uAmbientColor * 1.4, 0.04);

  // ── Ink ─────────────────────────────────────────────────────────────
  float ink = 0.0;
  float w = mix(0.06, 0.36, 1.0 - tone) * nib;   // the nib widens as it darkens
  // Surface tangent in screen space (perpendicular to the view normal) —
  // the direction a pen would follow around a cylinder or fold.
  vec3 nV = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  vec2 tang = vec2(-nV.y, nV.x);
  float tl = length(tang);
  float follow = formFollow * smoothstep(0.1, 0.45, tl);
  float pitchPx = max(uPitch * pitchScale * mix(1.0, uHeadPitch, step(uHeadFrom, hRaw)), 1.0);
  if (uHatchStyle < 0.5) {
    vec2 sp = (fc - hatchPhase) / pitchPx;
    float a0 = 0.62 + hatchRot + hatchSeed;
    vec2 d0 = vec2(cos(a0), sin(a0));
    vec2 tdir = tang / max(tl, 1e-4);
    if (dot(tdir, d0) < 0.0) tdir = -tdir;          // keep the blend from cancelling
    vec2 d1 = normalize(mix(d0, tdir, follow));
    if (tone < hatchRange)        ink = max(ink, ruleDir(sp, d1, 1.0, w));
    if (tone < hatchRange * 0.65) ink = max(ink, ruleDir(sp, rot2(d1, -1.37), 1.0, w));
    if (tone < hatchRange * 0.35) ink = max(ink, ruleDir(sp, rot2(d1,  0.93), 1.3, w));
  } else {
    vec2 fallback = vec2(cos(0.62 + hatchRot + hatchSeed), sin(0.62 + hatchRot + hatchSeed));
    vec2 dir = normalize(mix(fallback, tang / max(tl, 1e-4), max(follow, 0.15 * smoothstep(0.1, 0.45, tl))));
    float t = clamp((hatchRange - tone) / max(hatchRange - blackCut, 1e-3), 0.0, 1.0);
    float density = 1.0 / pitchPx;
    vec2 fp = fc - hatchPhase;
    ink = max(ink, contourStrokes(fp, dir, density, w * 1.6, 1.0) * smoothstep(0.0, 0.2, t));
    ink = max(ink, contourStrokes(fp, vec2(-dir.y, dir.x), density * 0.9, w * 1.3, 2.0) * smoothstep(0.55, 0.8, t));
  }
  // Stipple flecks just above the black fill.
  float near = clamp((hatchRange * 0.5 - tone) / max(hatchRange * 0.5 - blackCut, 1e-3), 0.0, 1.0);
  ink = max(ink, step(1.0 - stipple * near * near * 0.6, hash21(floor(fc / 2.0))));
  if (cracks > 0.0) {
    // Thin dark lines where a world-space noise field crosses its midline,
    // gated by a second field so they break into separate cracks.
    float cn = vnoise(vec2(vPosW.x * 2.3 + vPosW.z * 1.7, vPosW.y * 2.6) + 3.1);
    float ridge = abs(cn - 0.5);
    float gateC = step(0.38, vnoise(vec2(vPosW.z * 1.1 - vPosW.x * 0.6, vPosW.y * 0.9) + 9.0));
    ink = max(ink, (1.0 - smoothstep(0.0, 0.016, ridge)) * gateC * cracks);
  }
  if (tone < blackCut) ink = 1.0;

  vec3 col = mix(fill, uInk, ink);

  // ── Unprinted until lit ──────────────────────────────────────────
  // Where no torch reaches AND the ink map has never been inked, the page is
  // bare paper: no fill, no ink. The map remembers; the reveal is the print
  // arriving under your light.
  if (uInkMapRect.w > 0.5) {
    vec2 muv = (vPosW.xz - uInkMapRect.xy) / uInkMapRect.z;
    float inked = (muv.x >= 0.0 && muv.x <= 1.0 && muv.y >= 0.0 && muv.y <= 1.0)
      ? texture2D(uInkMap, muv).r : 0.0;
    float printed = smoothstep(0.08, 0.5, max(inked, lit));
    // Bare paper carries a faint pencil under-drawing of the tone so the
    // form reads before the ink lands; the sheet itself reads dimmer the
    // deeper below the surface it is.
    vec3 paper = uPaper * (1.0 - clamp(depthAmt, 0.0, 1.0) * 0.3);
    vec3 pencil = mix(paper, paper * 0.82, step(tone, blackCut) * 0.6);
    col = mix(pencil, col, printed);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export const HULL_VERTEX = /* glsl */ `
uniform float uThick;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float wob = 0.5 + 0.85 * abs(sin(position.x * 17.0 + position.y * 11.0 + position.z * 23.0));
  // Line weight with intent: a nib presses harder where the form turns
  // away (grazing normals) and lifts where it faces us.
  float facing = abs(dot(n, normalize(-mv.xyz)));
  float weight = mix(1.15, 0.6, facing);
  mv.xyz += n * uThick * wob * weight * (-mv.z) * 0.0035;
  gl_Position = projectionMatrix * mv;
}
`;

export const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }
`;

export const ND_VERTEX = /* glsl */ `
varying vec3 vN;
varying float vDepth;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
#ifdef USE_INSTANCING
  // scene.overrideMaterial = ndMat during the ND pass, so instanced rocks
  // draw through this material too — apply instanceMatrix ourselves (this
  // shader predates instancing and doesn't use the built-in chunks that do
  // it automatically), same non-uniform-scale normal trick as TOON_VERTEX.
  transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  mat3 im = mat3(instanceMatrix);
  objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  objectNormal = im * objectNormal;
#endif
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vN = normalize(normalMatrix * objectNormal);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const ND_FRAGMENT = /* glsl */ `
uniform float uFar;
varying vec3 vN;
varying float vDepth;
void main() {
  vec3 n = normalize(vN);
  float d = clamp(vDepth / uFar, 0.0, 1.0) * 255.0;
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, floor(d) / 255.0, fract(d));
}
`;

export const INK_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const INK_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tND;
// Size of the PRINT targets (tDiffuse / tND), not the screen.
uniform vec2 uResolution;
uniform float uMisreg;
uniform float uEdgeW;
uniform float uDepthCut;
uniform float uNormalCut;
uniform float uHalftoneScale;
uniform float uHalftoneAngle;
uniform float uHalftone;
uniform float uGrain;
uniform float uSpeck;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uPaper;
// Depth below the surface (0..1, set from main.ts) × a tuner intensity —
// the press runs looser (more misregistration, more bare-paper specks) the
// deeper the page came from.
uniform float uDepth;
uniform float uDepthStrange;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 decodeN(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
float depthAt(vec4 s) { return s.b + s.a / 255.0; }

// Key-plate crease test between the centre sample and a neighbour: a depth
// step (silhouettes, overlaps) or a normal discontinuity (facet edges).
float crease(vec2 uv, vec3 n0, float d0) {
  vec4 s = texture2D(tND, uv);
  float d = depthAt(s);
  float e = step(uDepthCut, abs(d - d0) / max(d0, 0.02));
  return max(e, step(uNormalCut, 1.0 - dot(n0, decodeN(s.rg))));
}

float halftoneDots(vec2 p, float angleDeg, float scale, float darkness) {
  float a = radians(angleDeg);
  vec2 rot = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
  vec2 cell = fract(rot / max(scale, 1.0)) - 0.5;
  float radius = clamp(darkness, 0.0, 1.0) * 0.5;
  return 1.0 - smoothstep(radius - 0.06, radius, length(cell));
}

// The palette DataTextures are tagged sRGB, so the toon/vault shaders write
// LINEAR light into the composer, and a raw ShaderPass writes to the screen
// with no output encoding. This pass is the last thing to touch the pixels,
// so it owns the encode.
vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 px = 1.0 / uResolution;
  float depthAmt = uDepth * uDepthStrange;
  // Print-pixel coordinate: quantized so grain/tooth/dots live on the same
  // chunky grid as the upscaled colour plates.
  vec2 pp = floor(vUv * uResolution);

  // Colour plates, each slightly out of register (the press) — looser the
  // deeper the page is from.
  vec2 o = px * uMisreg * (1.0 + depthAmt);
  vec3 lin;
  lin.r = texture2D(tDiffuse, vUv + o * vec2( 1.00,  0.35)).r;
  lin.g = texture2D(tDiffuse, vUv + o * vec2(-0.60, -0.85)).g;
  lin.b = texture2D(tDiffuse, vUv + o * vec2( 0.25,  0.90)).b;
  vec3 c = linearToSRGB(lin);

  // Key plate — stays in register.
  vec4 s0 = texture2D(tND, vUv);
  vec3 n0 = decodeN(s0.rg);
  float d0 = depthAt(s0);
  float e = 0.0;
  e = max(e, crease(vUv + vec2( uEdgeW, 0.0) * px, n0, d0));
  e = max(e, crease(vUv + vec2(-uEdgeW, 0.0) * px, n0, d0));
  e = max(e, crease(vUv + vec2(0.0,  uEdgeW) * px, n0, d0));
  e = max(e, crease(vUv + vec2(0.0, -uEdgeW) * px, n0, d0));
  c = mix(c, uInk, e);

  // The ND target is cleared to depth 1.0, so anything with geometry in it
  // reads below that — the BackSide vault is absent and stays untextured.
  float hasGeo = step(d0, 0.995);
  float l = luma(c);
  float shadowAmt = clamp(1.0 - l * 1.6, 0.0, 1.0);
  float dots = halftoneDots(pp, uHalftoneAngle, uHalftoneScale, shadowAmt * uHalftone) * hasGeo;
  c *= mix(1.0, 0.88, dots);

  // Paper tooth (multiplicative), specks of bare paper, grain. The sheet
  // dims and specks thicken with depth.
  float tooth = mix(0.86, 1.02, vnoise(pp * 0.85) * 0.6 + vnoise(pp * 2.9) * 0.4);
  c *= mix(1.0, tooth, uGrain);
  vec3 paper = uPaper * (1.0 - clamp(depthAmt, 0.0, 1.0) * 0.3);
  float speck = uSpeck * (1.0 + depthAmt * 3.0);
  if (hash(pp + floor(uTime * 0.0)) > 1.0 - speck) c = mix(c, paper, 0.7);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export const VAULT_VERTEX = /* glsl */ `
varying float vHeight;
// Position in the ENVIRONMENT's frame (object space + the mesh's lift), not
// world space: the vault is a sphere, so a world-space pattern would stay
// put when the cave turns (envYaw). Env-frame coords carry the arcs and
// noise round with the rock.
varying vec3 vPosE;
uniform float uMinY;
uniform float uMaxY;
uniform float uMeshY;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosE = position + vec3(0.0, uMeshY, 0.0);
  vHeight = clamp((worldPos.y - uMinY) / max(uMaxY - uMinY, 0.001), 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const VAULT_FRAGMENT = /* glsl */ `
uniform sampler2D uPaletteTex;
uniform sampler2D uBiomeRamps;
uniform float uBiomeCount;
uniform float uBiomeScale;
uniform float uBiomeSeed;
uniform float uUseBiomes;
uniform vec3 uLights[8];
uniform float uLightReach[8];
uniform int uLightCount;
uniform sampler2D uInkMap;
uniform vec4 uInkMapRect;
uniform vec3 uPaper;
// The slice of the ramp the vault draws from (the blue upper range).
uniform float uRampLo;
uniform float uRampHi;
// Concentric brush arcs ring a jittered grid of centres (cell size uCell,
// world units) on the xz plane — every room gets its own receding rings.
uniform float uCell;
uniform float uArcSpacing;
// Offsets every noise lookup so the environment seed reshuffles the vault
// too, not just the rock.
uniform float uSeed;
// Depth below the surface (0..1, main.ts) × a tuner intensity — the deeper
// cave packs its brush arcs tighter and dims its bare-paper reveal.
uniform float uDepth;
uniform float uDepthStrange;
varying float vHeight;
varying vec3 vPosE;

float vhash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
int biomeId(vec2 xz) {
  vec2 p = xz / uBiomeScale + vec2(uBiomeSeed * 0.37, uBiomeSeed * 0.11);
  float n = vnoise2(p) * 0.7 + vnoise2(p * 2.3 + vec2(5.1, 1.7)) * 0.3;
  n = clamp((n - 0.5) * 2.2 + 0.5, 0.0, 0.999);
  return int(min(uBiomeCount - 1.0, floor(n * uBiomeCount)));
}
// Cheap trilinear value noise — enough for brushy ink variation.
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = vhash(i);
  float n100 = vhash(i + vec3(1.0, 0.0, 0.0));
  float n010 = vhash(i + vec3(0.0, 1.0, 0.0));
  float n110 = vhash(i + vec3(1.0, 1.0, 0.0));
  float n001 = vhash(i + vec3(0.0, 0.0, 1.0));
  float n101 = vhash(i + vec3(1.0, 0.0, 1.0));
  float n011 = vhash(i + vec3(0.0, 1.0, 1.0));
  float n111 = vhash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

void main() {
  float depthAmt = uDepth * uDepthStrange;
  vec3 s = vec3(uSeed * 0.37, uSeed * 0.11, uSeed * 0.23);
  // Broad blue tone: height + stretched noise, posterized to 3 levels.
  vec3 p = vPosE * vec3(0.55, 1.6, 0.55) + s;
  float n = vnoise(p) * 0.65 + vnoise(p * 2.7 + 13.1) * 0.35;
  float h = clamp(vHeight + (n - 0.5) * 0.45, 0.0, 1.0);
  h = floor(h * 3.0) / 2.0;
  float rx = mix(uRampLo, uRampHi, h);
  vec3 col = uUseBiomes > 0.5
    ? texture2D(uBiomeRamps, vec2(rx, (float(biomeId(vPosE.xz)) + 0.5) / uBiomeCount)).rgb
    : texture2D(uPaletteTex, vec2(rx, 0.5)).rgb;

  // Concentric BLACK brush arcs around the tunnel axis — the reference's
  // cave ceiling is drawn as rings of broken ink strokes receding into the
  // tunnel. Hard-edged (step, not smoothstep) and truly black, so they read
  // as ink and the post pass leaves them alone. Radius is warped by noise
  // so the rings wobble; a coarse gate breaks each ring into separate
  // strokes and a fine tangential gate frays the strokes into streaks.
  vec2 cell = floor(vPosE.xz / uCell);
  vec2 jit = vec2(vhash(vec3(cell, 1.0 + uSeed)), vhash(vec3(cell, 7.0 + uSeed))) - 0.5;
  vec2 centre = (cell + 0.5 + jit * 0.6) * uCell;
  vec2 d = vPosE.xz - centre;
  float r = length(d);
  float ang = atan(d.y, d.x);
  float warp = (vnoise(vPosE * 0.9 + 41.0 + s) - 0.5) * 0.5;
  // Deeper cave: rings pack tighter, so more of them recede into the tunnel.
  float arcSpacing = uArcSpacing / (1.0 + depthAmt * 1.5);
  float ring = fract(r / max(arcSpacing, 0.1) + warp);
  float stroke = step(0.02, ring) * (1.0 - step(0.21, ring));
  float gate = step(0.3, vnoise(vPosE * vec3(1.6, 0.6, 1.6) + 7.0 + s));
  float fray = step(0.32, vnoise(vec3(ang * 14.0, r * 4.0, vPosE.z * 0.7) + 19.0 + s));
  float ink = stroke * gate * fray;
  col = mix(col, vec3(0.02, 0.012, 0.03), ink);

  if (uInkMapRect.w > 0.5) {
    float lit = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uLightCount) break;
      float reach = uLightReach[i];
      // The ceiling is far overhead; judge reach on the horizontal only.
      float dist = length(uLights[i].xz - vPosE.xz);
      lit = max(lit, 1.0 - smoothstep(reach * 0.5, reach * 1.1, dist));
    }
    vec2 muv = (vPosE.xz - uInkMapRect.xy) / uInkMapRect.z;
    float inked = (muv.x >= 0.0 && muv.x <= 1.0 && muv.y >= 0.0 && muv.y <= 1.0)
      ? texture2D(uInkMap, muv).r : 0.0;
    float printed = smoothstep(0.08, 0.5, max(inked, lit));
    vec3 paper = uPaper * (1.0 - clamp(depthAmt, 0.0, 1.0) * 0.3);
    col = mix(paper, col, printed);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
