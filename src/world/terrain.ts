import * as THREE from "three";
import { Simplex2, clamp, lerp, mulberry32, smoothstep } from "./noise";

/**
 * The cave as two height fields. `floor(x,z)` is the walkable surface and the
 * ONLY terrain collider; `ceiling(x,z)` is the unlit roof. Where a third
 * field (solidity) says "rock", the floor is lifted up to the ceiling — that
 * pinch is a wall or a pillar, and it falls out of the same mesh + collider
 * as the ground. One seed drives every field.
 */

export const CHUNK = 24; // metres per chunk
export const CELLS = 24; // cells per chunk edge (1 m)
const FLOOR_BASE = 3.0;
const CEIL_BASE = 11.5;
/** Rooms open up around the spawn so you never start inside a wall. */
const SPAWN_CLEAR = 9;

export class Terrain {
  private readonly floorLo: Simplex2;
  private readonly floorHi: Simplex2;
  private readonly ceilLo: Simplex2;
  private readonly ceilHi: Simplex2;
  private readonly solid: Simplex2;

  constructor(readonly seed: number) {
    this.floorLo = new Simplex2(seed * 7 + 1);
    this.floorHi = new Simplex2(seed * 7 + 2);
    this.ceilLo = new Simplex2(seed * 7 + 3);
    this.ceilHi = new Simplex2(seed * 7 + 4);
    this.solid = new Simplex2(seed * 7 + 5);
  }

  /** Rolling cave floor before walls: gentle dunes plus rocky chop. */
  floorOpen(x: number, z: number): number {
    const broad = this.floorLo.fbm(x / 26, z / 26, 4) * 2.4;
    const chop = this.floorHi.fbm(x / 5.5, z / 5.5, 2) * 0.55;
    const d = Math.hypot(x, z);
    // Flat pad under the spawn.
    const pad = smoothstep(2.5, 9, d);
    return FLOOR_BASE + (broad + chop) * pad;
  }

  ceiling(x: number, z: number): number {
    const broad = this.ceilLo.fbm(x / 34, z / 34, 3) * 3.4;
    const chop = this.ceilHi.fbm(x / 6, z / 6, 2) * 0.7;
    return CEIL_BASE + broad + chop;
  }

  /** 0..1 — how much this column is solid rock (wall / pillar). */
  solidity(x: number, z: number): number {
    const s = (this.solid.fbm(x / 30 + 100, z / 30 - 40, 3) + 1) * 0.5;
    const d = Math.hypot(x, z);
    return s * smoothstep(SPAWN_CLEAR * 0.5, SPAWN_CLEAR * 1.6, d);
  }

  /** The walkable surface, walls included. */
  floor(x: number, z: number): number {
    const open = this.floorOpen(x, z);
    const s = this.solidity(x, z);
    const wall = smoothstep(0.56, 0.66, s);
    if (wall <= 0) return open;
    return lerp(open, this.ceiling(x, z) + 0.4, wall);
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
export function gridGeometry(grid: HeightGrid, cx: number, cz: number, up: boolean): THREE.BufferGeometry {
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
      // Alternate the diagonal so facets don't all lean one way.
      const flip = ((ix + iz) & 1) === 0;
      const a: [number, number] = [ix, iz], b: [number, number] = [ix + 1, iz];
      const c: [number, number] = [ix + 1, iz + 1], d: [number, number] = [ix, iz + 1];
      const tris = flip ? [a, c, b, a, d, c] : [a, d, b, b, d, c];
      // Counter-clockwise seen from +y for the floor; reversed for the ceiling.
      const order = up ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      for (const i of order) put(tris[i]![0], tris[i]![1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
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
function rockGeometry(rng: () => number, radius: number, height: number): THREE.BufferGeometry {
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

/** Scatter boulders and stalagmites over a chunk, seated on the floor,
 *  avoiding walls and the spawn pad. Deterministic per chunk. */
export function scatterRocks(terrain: Terrain, cx: number, cz: number, chunkSeed: number): RockSpec[] {
  const rng = mulberry32(chunkSeed);
  const out: RockSpec[] = [];
  const count = 8 + Math.floor(rng() * 8);
  for (let i = 0; i < count; i++) {
    const x = cx * CHUNK + rng() * CHUNK;
    const z = cz * CHUNK + rng() * CHUNK;
    if (Math.hypot(x, z) < 4) continue;
    if (!terrain.isOpen(x, z)) continue;
    const tall = rng() < 0.25;
    const radius = tall ? 0.25 + rng() * 0.5 : 0.35 + rng() * 1.1;
    const height = tall ? 1.8 + rng() * 3.2 : 0.35 + rng() * 1.4;
    const geometry = rockGeometry(rng, radius, height);
    const y = terrain.floor(x, z) + height / 2 - Math.min(0.25, height * 0.2);
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

export { clamp };
