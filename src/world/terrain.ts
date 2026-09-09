import * as THREE from "three";
import { Simplex2, clamp, lerp, mulberry32, smoothstep } from "./noise";
import { BIOMES, biomeAt, biomeIdAt, type Biome } from "./biomes";
import { CFG } from "./config";

/**
 * The cave as two height fields. `floor(x,z)` is the walkable surface and the
 * ONLY terrain collider; `ceiling(x,z)` is the unlit roof. Where a third
 * field (solidity) says "rock", the floor is lifted up to the ceiling — that
 * pinch is a wall or a pillar, and it falls out of the same mesh + collider
 * as the ground. Biomes (hard-edged regions) scale the relief, terrace the
 * floor into climbable ledges, and set the rock scatter. One seed drives
 * every field.
 *
 * LAYERS: a gallery field says where a second level exists. There, the lower
 * cave's ceiling is a slab whose top is the UPPER floor (`floor2`), with its
 * own ceiling above. Shafts (a hole field) drop the upper floor to the lower
 * one, so you fall through from above and climb up through from below; at a
 * gallery's edge the upper floor ramps down steeply to the lower — a cliff you
 * scale with stamina.
 */

/** Slab between the lower ceiling and the upper floor. */
export const SLAB = 0.6;

export const CHUNK = 24; // metres per chunk
export const CELLS = 24; // cells per chunk edge (1 m)
/** Rooms open up around the spawn so you never start inside a wall. */
const SPAWN_CLEAR = 9;

export class Terrain {
  private readonly floorLo: Simplex2;
  private readonly floorHi: Simplex2;
  private readonly ceilLo: Simplex2;
  private readonly ceilHi: Simplex2;
  private readonly solid: Simplex2;
  private readonly gal: Simplex2;
  private readonly holeN: Simplex2;
  private readonly ceil2Hi: Simplex2;
  /** Dug-out depth per integer world vertex ("x,z" → metres removed). */
  readonly digs = new Map<string, number>();

  constructor(readonly seed: number) {
    this.gal = new Simplex2(seed * 7 + 6);
    this.holeN = new Simplex2(seed * 7 + 7);
    this.ceil2Hi = new Simplex2(seed * 7 + 8);
    this.floorLo = new Simplex2(seed * 7 + 1);
    this.floorHi = new Simplex2(seed * 7 + 2);
    this.ceilLo = new Simplex2(seed * 7 + 3);
    this.ceilHi = new Simplex2(seed * 7 + 4);
    this.solid = new Simplex2(seed * 7 + 5);
  }

  biome(x: number, z: number): Biome {
    return biomeAt(x, z, this.seed);
  }
  biomeId(x: number, z: number): number {
    return biomeIdAt(x, z, this.seed);
  }

  /** Rolling cave floor before walls: dunes plus rocky chop, terraced in
   *  biomes that want ledges. The spawn pad is flat and always Dungeon-relief. */
  floorOpen(x: number, z: number): number {
    const b = this.biome(x, z);
    const d = Math.hypot(x, z);
    const pad = smoothstep(2.5, 9, d);
    const W = CFG.world;
    const broad = this.floorLo.fbm(x / W.dunes, z / W.dunes, 4) * 2.4 * b.relief;
    const chop = this.floorHi.fbm(x / W.chop, z / W.chop, 2) * 0.55;
    if (b.terrace > 0) {
      // Steps with a slightly rough tread; the risers are what you climb.
      const stepped = Math.round(broad / b.terrace) * b.terrace;
      return W.floorBase + (stepped + chop * 0.35) * pad;
    }
    return W.floorBase + (broad + chop) * pad;
  }

  ceiling(x: number, z: number): number {
    const broad = this.ceilLo.fbm(x / 34, z / 34, 3) * CFG.world.ceilRelief;
    const chop = this.ceilHi.fbm(x / 6, z / 6, 2) * 0.7;
    return CFG.world.ceilBase + broad + chop;
  }

  /** 0..1 — how much this column is solid rock (wall / pillar). */
  solidity(x: number, z: number): number {
    const s = (this.solid.fbm(x / 30 + 100, z / 30 - 40, 3) + 1) * 0.5;
    const d = Math.hypot(x, z);
    return s * smoothstep(SPAWN_CLEAR * 0.5, SPAWN_CLEAR * 1.6, d);
  }

  /** The walkable surface, walls included. In a gallery a pinch wall rises
   *  all the way to the upper floor, so its top IS the next level. */
  floor(x: number, z: number): number {
    const open = this.floorOpen(x, z);
    const s = this.solidity(x, z);
    const wall = smoothstep(CFG.world.wallLo, CFG.world.wallHi, s);
    if (wall <= 0) return open;
    const g = this.gallery(x, z);
    const top = g > 0.5 ? this.ceiling(x, z) + SLAB : this.ceiling(x, z) + 0.4;
    return lerp(open, top, wall);
  }

  /** 0..1 — where the upper level exists (above 0.5). Never over the spawn pad. */
  gallery(x: number, z: number): number {
    const n = (this.gal.fbm(x / 70 - 30, z / 70 + 55, 3) + 1) * 0.5;
    return n * smoothstep(12, 30, Math.hypot(x, z));
  }

  /** 0..1 — a shaft through the slab (above 0.5), only inside a gallery. */
  hole(x: number, z: number): number {
    if (this.gallery(x, z) < 0.5) return 0;
    return (this.holeN.fbm(x / 13 + 7, z / 13 - 3, 2) + 1) * 0.5;
  }

  /** The upper floor: the slab top inside galleries, dropping to the lower
   *  floor in shafts and (steeply) at gallery edges. Outside galleries it
   *  hides just under the lower floor so its collider never wins. */
  floor2(x: number, z: number): number {
    const g = this.gallery(x, z);
    const lower = this.floor(x, z);
    const edge = smoothstep(0.5, 0.545, g);
    if (edge <= 0) return lower - 0.05;
    const slabTop = this.ceiling(x, z) + SLAB;
    const h = this.hole(x, z);
    const shaft = smoothstep(0.58, 0.66, h);
    return lerp(lower - 0.05, lerp(slabTop, lower, shaft), edge);
  }

  /** The upper level's ceiling (only meaningful where gallery > 0.5). */
  ceiling2(x: number, z: number): number {
    return this.ceiling(x, z) + SLAB + 7.5 + this.ceil2Hi.fbm(x / 22, z / 22, 3) * 2.5;
  }

  /** Is (x,z) upper-level walkable — slab top, no shaft, not the edge ramp? */
  isUpperOpen(x: number, z: number): boolean {
    return this.gallery(x, z) > 0.56 && this.hole(x, z) < 0.5 && this.solidity(x, z) < 0.5;
  }

  /** The lower floor WITH digging applied (bilinear over the dug vertices). */
  floorAt(x: number, z: number): number {
    const base = this.floor(x, z);
    if (this.digs.size === 0) return base;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const d = (X: number, Z: number) => this.digs.get(`${X},${Z}`) ?? 0;
    const dug = (d(x0, z0) * (1 - fx) + d(x0 + 1, z0) * fx) * (1 - fz) + (d(x0, z0 + 1) * (1 - fx) + d(x0 + 1, z0 + 1) * fx) * fz;
    return base - dug;
  }

  /** Carve a crater: lower every grid vertex within `radius` of (x,z) by up to
   *  `depth` (smooth falloff). Returns the chunk keys whose floors changed. */
  dig(x: number, z: number, radius: number, depth: number): Set<string> {
    const touched = new Set<string>();
    for (let Z = Math.floor(z - radius); Z <= Math.ceil(z + radius); Z++) {
      for (let X = Math.floor(x - radius); X <= Math.ceil(x + radius); X++) {
        const dd = Math.hypot(X - x, Z - z);
        if (dd > radius) continue;
        const t = 1 - dd / radius;
        const amount = depth * (t * t * (3 - 2 * t));
        const key = `${X},${Z}`;
        this.digs.set(key, Math.min(60, (this.digs.get(key) ?? 0) + amount));
        // A vertex on a chunk edge belongs to both chunks.
        for (const cx of [Math.floor(X / CHUNK), Math.floor((X - 1) / CHUNK)]) {
          for (const cz of [Math.floor(Z / CHUNK), Math.floor((Z - 1) / CHUNK)]) touched.add(`${cx},${cz}`);
        }
      }
    }
    return touched;
  }

  /** Is (x,z) open air at head height — usable for placing things? */
  isOpen(x: number, z: number): boolean {
    return this.solidity(x, z) < 0.5 && this.ceiling(x, z) - this.floorOpen(x, z) > 3;
  }

  spawnPoint(): THREE.Vector3 {
    return new THREE.Vector3(0, this.floor(0, 0) + 1.2, 0);
  }
}

export type HeightGrid = {
  /** (CELLS+1)² samples, row-major by z then x: heights[iz * (CELLS+1) + ix]. */
  samples: Float32Array;
  min: number;
  max: number;
};

/** Sample a field over a chunk, including the shared edge row/column. */
export function sampleGrid(fn: (x: number, z: number) => number, cx: number, cz: number): HeightGrid {
  const n = CELLS + 1;
  const samples = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const h = fn(ox + ix, oz + iz);
      samples[iz * n + ix] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { samples, min, max };
}

/** Faceted mesh for a sampled grid. `up` = surface faces +y (floor) or −y
 *  (ceiling). Positions are WORLD x/z (the mesh sits at the origin) so the
 *  toon shader's world-space noise is continuous across chunk seams. */
export function gridGeometry(
  grid: HeightGrid, cx: number, cz: number, up: boolean,
  /** Return false to leave a cell out (a shaft, or no upper level here). */
  keep?: (ix: number, iz: number) => boolean,
): THREE.BufferGeometry | null {
  const n = CELLS + 1;
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const pos = new Float32Array(CELLS * CELLS * 6 * 3);
  let k = 0;
  const put = (ix: number, iz: number) => {
    pos[k++] = ox + ix;
    pos[k++] = grid.samples[iz * n + ix]!;
    pos[k++] = oz + iz;
  };
  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      if (keep && !keep(ix, iz)) continue;
      // Alternate the diagonal so facets don't all lean one way.
      const flip = ((ix + iz) & 1) === 0;
      const a: [number, number] = [ix, iz], b: [number, number] = [ix + 1, iz];
      const c: [number, number] = [ix + 1, iz + 1], d: [number, number] = [ix, iz + 1];
      const tris = flip ? [a, c, b, a, d, c] : [a, d, b, b, d, c];
      // Counter-clockwise seen from +y for the floor; reversed for the ceiling.
      const order = up ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
      for (const i of order) put(tris[i]![0], tris[i]![1]);
    }
  }
  if (k === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, k), 3));
  geo.computeVertexNormals();
  return geo;
}

export type RockSpec = {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  rotationY: number;
  hatchSeed: number;
  /** Convex hull points in local space (Float32Array xyz). */
  hull: Float32Array;
};

/** Deterministic low-poly jagged boulder (the tuner's). */
export function rockGeometry(rng: () => number, radius: number, height: number): THREE.BufferGeometry {
  const sides = 5 + Math.floor(rng() * 3);
  const geo = new THREE.ConeGeometry(radius, height, sides, 2, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const leanX = (rng() - 0.5) * radius * 0.9;
  const leanZ = (rng() - 0.5) * radius * 0.9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const jitter = 1 + (rng() - 0.5) * 0.6;
    const t = (y + height / 2) / height;
    pos.setX(i, x * jitter + leanX * t);
    pos.setZ(i, z * jitter + leanZ * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Scatter boulders and stalagmites over a chunk per its biome, seated on
 *  the floor, avoiding walls and the spawn pad. Deterministic per chunk. */
export function scatterRocks(terrain: Terrain, cx: number, cz: number, chunkSeed: number, upper = false): RockSpec[] {
  const rng = mulberry32(chunkSeed ^ (upper ? 0x9e3779b9 : 0));
  const out: RockSpec[] = [];
  const centre = terrain.biome(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2);
  const count = Math.round(centre.rocks * (0.7 + rng() * 0.6) * (upper ? 0.5 : 1));
  for (let i = 0; i < count; i++) {
    const x = cx * CHUNK + rng() * CHUNK;
    const z = cz * CHUNK + rng() * CHUNK;
    if (Math.hypot(x, z) < 4) continue;
    if (upper ? !terrain.isUpperOpen(x, z) : !terrain.isOpen(x, z)) continue;
    const b = terrain.biome(x, z);
    const tall = rng() < b.tallShare;
    const radius = tall ? 0.25 + rng() * 0.5 : 0.35 + rng() * 1.1;
    const height = tall ? 1.8 + rng() * 3.2 : 0.35 + rng() * 1.4;
    const geometry = rockGeometry(rng, radius, height);
    const y = (upper ? terrain.floor2(x, z) : terrain.floor(x, z)) + height / 2 - Math.min(0.25, height * 0.2);
    const hullPts = (geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    out.push({
      geometry,
      position: new THREE.Vector3(x, y, z),
      rotationY: rng() * Math.PI * 2,
      hatchSeed: (rng() - 0.5) * 1.4,
      hull: hullPts,
    });
  }
  return out;
}

export { clamp, BIOMES };
