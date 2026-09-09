import { ENVWAYS, type GradientStop } from "../render/palette";

/**
 * Biomes — regions of the cave that print with a different pen and a
 * different cave colorway, with HARD ink boundaries between them. The region
 * field is a value-noise fBm quantised to N ids; the SAME hash and noise run
 * in GLSL (shaders.ts `biomeId`) and here, so what the rock draws and what the
 * terrain / HUD believe agree to the metre.
 */

export type Pen = {
  hatchRange: number; black: number; pitchScale: number; nib: number;
  cracks: number; stipple: number; hatchRot: number; formFollow: number;
};

export type Biome = {
  name: string;
  ramp: GradientStop[];
  pen: Pen;
  /** Quantise the open floor to steps of this height (0 = smooth). */
  terrace: number;
  /** Multiplies the open floor's relief. */
  relief: number;
  /** Rocks per chunk, and the share that are tall stalagmites. */
  rocks: number;
  tallShare: number;
};

const ramp = (name: string): GradientStop[] => ENVWAYS.find((e) => e.name === name)!.ramp;

export const BIOMES: Biome[] = [
  { name: "Dungeon", ramp: ramp("Dungeon Cave"), terrace: 0, relief: 1.0, rocks: 12, tallShare: 0.25,
    pen: { hatchRange: 0.55, black: 0.3, pitchScale: 1.3, nib: 1.0, cracks: 0.55, stipple: 0.35, hatchRot: 0, formFollow: 0.35 } },
  { name: "Glacier", ramp: ramp("Glacier"), terrace: 1.5, relief: 1.1, rocks: 7, tallShare: 0.1,
    pen: { hatchRange: 0.48, black: 0.2, pitchScale: 0.9, nib: 0.7, cracks: 0.15, stipple: 0.12, hatchRot: 0.5, formFollow: 0.2 } },
  { name: "Blood Cave", ramp: ramp("Blood Cave"), terrace: 0, relief: 0.9, rocks: 14, tallShare: 0.3,
    pen: { hatchRange: 0.62, black: 0.38, pitchScale: 1.6, nib: 1.5, cracks: 0.8, stipple: 0.5, hatchRot: -0.4, formFollow: 0.5 } },
  { name: "Sulphur Pit", ramp: ramp("Sulphur Pit"), terrace: 0, relief: 0.8, rocks: 20, tallShare: 0.55,
    pen: { hatchRange: 0.5, black: 0.25, pitchScale: 1.1, nib: 0.9, cracks: 0.4, stipple: 0.7, hatchRot: 0.9, formFollow: 0.3 } },
  { name: "Void Peaks", ramp: ramp("Void Peaks"), terrace: 2.0, relief: 1.2, rocks: 9, tallShare: 0.6,
    pen: { hatchRange: 0.7, black: 0.45, pitchScale: 2.0, nib: 1.2, cracks: 0.3, stipple: 0.2, hatchRot: -1.1, formFollow: 0.6 } },
  { name: "Deep Sea", ramp: ramp("Deep Sea"), terrace: 0, relief: 0.6, rocks: 6, tallShare: 0.15,
    pen: { hatchRange: 0.45, black: 0.2, pitchScale: 1.0, nib: 0.8, cracks: 0.1, stipple: 0.6, hatchRot: 0.2, formFollow: 0.25 } },
];

/** World metres per biome-noise unit — mirrors `uBiomeScale` in the shader. */
export const BIOME_SCALE = 90;

// ── The GLSL noise, ported byte-for-byte in intent ──────────────────────
function fract(x: number): number { return x - Math.floor(x); }
function hash21(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** 0..1 region value at world (x,z), before quantisation. Must match GLSL. */
export function biomeField(x: number, z: number, seed: number): number {
  const px = x / BIOME_SCALE + seed * 0.37;
  const pz = z / BIOME_SCALE + seed * 0.11;
  const n = vnoise(px, pz) * 0.7 + vnoise(px * 2.3 + 5.1, pz * 2.3 + 1.7) * 0.3;
  // Value noise huddles around 0.5; stretch it so every biome gets land.
  return Math.min(0.999, Math.max(0, (n - 0.5) * 2.2 + 0.5));
}

export function biomeIdAt(x: number, z: number, seed: number): number {
  const n = biomeField(x, z, seed);
  return Math.min(BIOMES.length - 1, Math.floor(n * BIOMES.length));
}

export function biomeAt(x: number, z: number, seed: number): Biome {
  return BIOMES[biomeIdAt(x, z, seed)]!;
}
