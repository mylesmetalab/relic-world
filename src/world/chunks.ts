import * as THREE from "three";
import { anchorHatch, type Pipeline } from "../render/pipeline";
import { addConvexHull, addHeightfield, removeStatic, type Physics, type StaticHandle } from "../physics/world";
import { CELLS, CHUNK, Terrain, gridGeometry, sampleGrid, scatterRocks, type Level } from "./terrain";
import { hash3 } from "./noise";
import { Props, type ChunkProps } from "./props";

type LevelPart = { mesh: THREE.Mesh | null; collider: StaticHandle };

/** Everything one chunk owns, so it can be dropped in one go. */
type Chunk = {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  statics: StaticHandle[];
  geometries: THREE.BufferGeometry[];
  props: ChunkProps;
  /** Floors by level (0 surface, 1 gallery or null, 2 lower). */
  floors: [LevelPart, LevelPart | null, LevelPart];
  /** Ceilings under the surface and under the gallery slab; re-cut when a dig breaks through. */
  ceilLower: THREE.Mesh | null;
  ceilUpper: THREE.Mesh | null;
  gallery: Uint8Array;
};

/**
 * Keeps a (2r+1)² window of chunks alive around the player. Each chunk is up
 * to three levels — surface, gallery, lower cave — every level a heightfield
 * collider with a faceted mesh; ceilings are drawn from below with shafts and
 * dug-through holes cut out. At most one chunk is built per frame so crossing
 * a seam never hitches. Digging re-samples one level of a chunk in place.
 */
export class ChunkManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly pending: Array<[number, number]> = [];
  readonly root = new THREE.Group();
  readonly props: Props;

  constructor(
    private readonly p: Pipeline,
    private readonly ph: Physics,
    private readonly terrain: Terrain,
    private readonly radius = 2,
  ) {
    p.scene.add(this.root);
    this.props = new Props(p, ph, terrain);
  }

  get count(): number {
    return this.chunks.size;
  }

  update(pos: THREE.Vector3, buildBudget = 1): void {
    const cx = Math.floor(pos.x / CHUNK);
    const cz = Math.floor(pos.z / CHUNK);
    const wanted = new Set<string>();
    this.pending.length = 0;
    const ring: Array<[number, number, number]> = [];
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) ring.push([cx + dx, cz + dz, dx * dx + dz * dz]);
    }
    ring.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of ring) {
      const key = `${x},${z}`;
      wanted.add(key);
      if (!this.chunks.has(key)) this.pending.push([x, z]);
    }
    for (const [key, chunk] of this.chunks) if (!wanted.has(key)) this.dispose(chunk);
    let budget = buildBudget;
    for (const [x, z] of this.pending) {
      const under = x === cx && z === cz;
      if (!under && budget <= 0) break;
      this.build(x, z);
      if (!under) budget--;
    }
  }

  buildAll(pos: THREE.Vector3): void {
    this.update(pos, 1000);
  }

  rebuildAll(pos: THREE.Vector3): void {
    for (const chunk of [...this.chunks.values()]) this.dispose(chunk);
    this.buildAll(pos);
  }

  /** Re-sample one level's floor in the given chunks (after a dig), and re-cut
   *  the ceilings under it where the dig broke through. */
  refloor(level: Level, keys: Iterable<string>): void {
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      const part = chunk.floors[level];
      if (!part) continue;
      const T = this.terrain;
      const grid = sampleGrid((x, z) => T.levelAt(level, x, z), chunk.cx, chunk.cz);
      const keep = this.floorMask(chunk, level);
      const geo = gridGeometry(grid, chunk.cx, chunk.cz, true, keep);
      if (part.mesh) {
        part.mesh.geometry.dispose();
        if (geo) part.mesh.geometry = geo;
      }
      removeStatic(this.ph, part.collider);
      const si = chunk.statics.indexOf(part.collider);
      part.collider = addHeightfield(this.ph, grid, chunk.cx, chunk.cz);
      if (si >= 0) chunk.statics[si] = part.collider;
      else chunk.statics.push(part.collider);
      this.recutCeilings(chunk);
    }
  }

  /** Which cells of a level's floor to draw. The gallery floor only over
   *  galleries and their rim; everything else everywhere. */
  private floorMask(chunk: Chunk, level: Level): ((ix: number, iz: number) => boolean) | undefined {
    if (level !== 1) return undefined;
    const g = chunk.gallery;
    return (ix, iz) => g[iz * CELLS + ix] === 1 || neighbourGallery(g, ix, iz);
  }

  /** Ceilings are drawn where the level above is still intact. */
  private recutCeilings(chunk: Chunk): void {
    const T = this.terrain;
    const ox = chunk.cx * CHUNK, oz = chunk.cz * CHUNK;
    const cell = (ix: number, iz: number) => [ox + ix + 0.5, oz + iz + 0.5] as const;
    const isGallery = (ix: number, iz: number) => chunk.gallery[iz * CELLS + ix] === 1;
    // Lower ceiling: gone where a shaft is, or where whatever sits directly on
    // this slab (the gallery floor, or the surface) was dug through.
    if (chunk.ceilLower) {
      const grid = sampleGrid((x, z) => T.ceiling(x, z), chunk.cx, chunk.cz);
      const geo = gridGeometry(grid, chunk.cx, chunk.cz, false, (ix, iz) => {
        const [x, z] = cell(ix, iz);
        if (isGallery(ix, iz)) return T.hole(x, z) <= 0.62 && !T.brokenThrough(1, x, z);
        return !T.brokenThrough(0, x, z);
      });
      chunk.ceilLower.geometry.dispose();
      chunk.ceilLower.geometry = geo ?? new THREE.BufferGeometry();
    }
    if (chunk.ceilUpper) {
      const grid = sampleGrid((x, z) => T.ceiling2(x, z), chunk.cx, chunk.cz);
      const geo = gridGeometry(grid, chunk.cx, chunk.cz, false, (ix, iz) => {
        const [x, z] = cell(ix, iz);
        return isGallery(ix, iz) && !T.brokenThrough(0, x, z);
      });
      chunk.ceilUpper.geometry.dispose();
      chunk.ceilUpper.geometry = geo ?? new THREE.BufferGeometry();
    }
  }

  private build(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const statics: StaticHandle[] = [];
    const chunkSeed = hash3(this.terrain.seed, cx, cz);
    const T = this.terrain;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const hatchSeed = ((chunkSeed % 1000) / 1000 - 0.5) * 1.2;

    const gallery = new Uint8Array(CELLS * CELLS);
    let anyGallery = false;
    for (let iz = 0; iz < CELLS; iz++) {
      for (let ix = 0; ix < CELLS; ix++) {
        const g = T.gallery(ox + ix + 0.5, oz + iz + 0.5) > 0.5 ? 1 : 0;
        gallery[iz * CELLS + ix] = g;
        if (g) anyGallery = true;
      }
    }

    const floorPart = (level: Level, keep?: (ix: number, iz: number) => boolean, seedSign = 1): LevelPart => {
      const grid = sampleGrid((x, z) => T.levelAt(level, x, z), cx, cz);
      const geo = gridGeometry(grid, cx, cz, true, keep);
      let mesh: THREE.Mesh | null = null;
      if (geo) {
        mesh = new THREE.Mesh(geo, this.p.rockMat);
        anchorHatch(this.p, mesh, hatchSeed * seedSign + level * 0.37);
        group.add(mesh);
        geometries.push(geo);
      }
      const collider = addHeightfield(this.ph, grid, cx, cz);
      statics.push(collider);
      return { mesh, collider };
    };

    const lower = floorPart(2);
    const surface = floorPart(0, undefined, -1);
    const galleryPart = anyGallery
      ? floorPart(1, (ix, iz) => gallery[iz * CELLS + ix] === 1 || neighbourGallery(gallery, ix, iz), 0.5)
      : null;

    // Ceilings (cut properly by recutCeilings below).
    const ceilLower = new THREE.Mesh(new THREE.BufferGeometry(), this.p.ceilMat);
    group.add(ceilLower);
    let ceilUpper: THREE.Mesh | null = null;
    if (anyGallery) {
      ceilUpper = new THREE.Mesh(new THREE.BufferGeometry(), this.p.ceilMat);
      group.add(ceilUpper);
    }

    for (const level of [2, 1, 0] as Level[]) {
      if (level === 1 && !anyGallery) continue;
      for (const r of scatterRocks(T, cx, cz, chunkSeed, level)) {
        const mesh = new THREE.Mesh(r.geometry, this.p.rockMat);
        mesh.position.copy(r.position);
        mesh.rotation.y = r.rotationY;
        anchorHatch(this.p, mesh, r.hatchSeed);
        group.add(mesh);
        geometries.push(r.geometry);
        const h = addConvexHull(this.ph, r.hull, r.position.x, r.position.y, r.position.z, r.rotationY);
        if (h) statics.push(h);
      }
    }

    this.root.add(group);
    const chunk: Chunk = {
      key, cx, cz, group, statics, geometries, props: this.props.spawn(cx, cz, chunkSeed),
      floors: [surface, galleryPart, lower], ceilLower, ceilUpper, gallery,
    };
    this.recutCeilings(chunk);
    this.chunks.set(key, chunk);
  }

  private dispose(chunk: Chunk): void {
    this.root.remove(chunk.group);
    for (const g of chunk.geometries) g.dispose();
    chunk.ceilLower?.geometry.dispose();
    chunk.ceilUpper?.geometry.dispose();
    for (const s of chunk.statics) removeStatic(this.ph, s);
    this.props.dispose(chunk.props);
    this.chunks.delete(chunk.key);
  }
}

/** A cell bordering a gallery cell — so the edge ramp gets drawn. */
function neighbourGallery(gallery: Uint8Array, ix: number, iz: number): boolean {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = ix + dx, z = iz + dz;
      if (x < 0 || z < 0 || x >= CELLS || z >= CELLS) continue;
      if (gallery[z * CELLS + x] === 1) return true;
    }
  }
  return false;
}
