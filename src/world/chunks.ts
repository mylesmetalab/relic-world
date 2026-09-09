import * as THREE from "three";
import { anchorHatch, type Pipeline } from "../render/pipeline";
import { addConvexHull, addHeightfield, removeStatic, type Physics, type StaticHandle } from "../physics/world";
import { CELLS, CHUNK, Terrain, gridGeometry, sampleGrid, scatterRocks } from "./terrain";
import { hash3 } from "./noise";
import { Props, type ChunkProps } from "./props";

/** Everything one chunk owns, so it can be dropped in one go. */
type Chunk = {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  statics: StaticHandle[];
  geometries: THREE.BufferGeometry[];
  props: ChunkProps;
  /** The lower floor's mesh + collider, replaced when the ground is dug. */
  floorMesh: THREE.Mesh;
  floorStatic: StaticHandle;
};

/**
 * Keeps a (2r+1)² window of chunks alive around the player. Each chunk is two
 * levels: the lower floor + its ceiling (with shafts cut out), and where a
 * gallery exists the upper floor (slab top) + its ceiling. Both floors are
 * heightfield colliders. At most one chunk is built per frame so crossing a
 * seam never hitches. Digging re-samples a chunk's lower floor in place.
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

  /** Call once per frame with the player's position. */
  update(pos: THREE.Vector3, buildBudget = 1): void {
    const cx = Math.floor(pos.x / CHUNK);
    const cz = Math.floor(pos.z / CHUNK);
    const wanted = new Set<string>();
    this.pending.length = 0;
    const ring: Array<[number, number, number]> = [];
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        ring.push([cx + dx, cz + dz, dx * dx + dz * dz]);
      }
    }
    ring.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of ring) {
      const key = `${x},${z}`;
      wanted.add(key);
      if (!this.chunks.has(key)) this.pending.push([x, z]);
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) this.dispose(chunk);
    }
    let budget = buildBudget;
    for (const [x, z] of this.pending) {
      const under = x === cx && z === cz;
      if (!under && budget <= 0) break;
      this.build(x, z);
      if (!under) budget--;
    }
  }

  /** Build every chunk in the window now (boot). */
  buildAll(pos: THREE.Vector3): void {
    this.update(pos, 1000);
  }

  /** Drop every chunk and build the window again (terrain tunables changed). */
  rebuildAll(pos: THREE.Vector3): void {
    for (const chunk of [...this.chunks.values()]) this.dispose(chunk);
    this.buildAll(pos);
  }

  /** Re-sample the lower floor of the chunks covering these keys (after a dig). */
  refloor(keys: Iterable<string>): void {
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      const grid = sampleGrid((x, z) => this.terrain.floorAt(x, z), chunk.cx, chunk.cz);
      const geo = gridGeometry(grid, chunk.cx, chunk.cz, true)!;
      chunk.floorMesh.geometry.dispose();
      chunk.floorMesh.geometry = geo;
      const idx = chunk.geometries.indexOf(chunk.floorMesh.geometry);
      if (idx >= 0) chunk.geometries[idx] = geo;
      removeStatic(this.ph, chunk.floorStatic);
      const si = chunk.statics.indexOf(chunk.floorStatic);
      chunk.floorStatic = addHeightfield(this.ph, grid, chunk.cx, chunk.cz);
      if (si >= 0) chunk.statics[si] = chunk.floorStatic;
      else chunk.statics.push(chunk.floorStatic);
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

    // Per-cell masks (sampled at cell centres).
    const gallery = new Uint8Array(CELLS * CELLS);
    const shaft = new Uint8Array(CELLS * CELLS);
    let anyGallery = false;
    for (let iz = 0; iz < CELLS; iz++) {
      for (let ix = 0; ix < CELLS; ix++) {
        const x = ox + ix + 0.5, z = oz + iz + 0.5;
        const g = T.gallery(x, z) > 0.5 ? 1 : 0;
        gallery[iz * CELLS + ix] = g;
        shaft[iz * CELLS + ix] = g && T.hole(x, z) > 0.62 ? 1 : 0;
        if (g) anyGallery = true;
      }
    }
    const isGallery = (ix: number, iz: number) => gallery[iz * CELLS + ix] === 1;
    const isShaft = (ix: number, iz: number) => shaft[iz * CELLS + ix] === 1;

    // Lower floor (always; digs applied).
    const floorGrid = sampleGrid((x, z) => T.floorAt(x, z), cx, cz);
    const floorGeo = gridGeometry(floorGrid, cx, cz, true)!;
    const floorMesh = new THREE.Mesh(floorGeo, this.p.rockMat);
    anchorHatch(this.p, floorMesh, hatchSeed);
    group.add(floorMesh);
    geometries.push(floorGeo);
    const floorStatic = addHeightfield(this.ph, floorGrid, cx, cz);
    statics.push(floorStatic);

    // Lower ceiling — the vault, or the slab's underside; shafts are cut out.
    const ceilGrid = sampleGrid((x, z) => T.ceiling(x, z), cx, cz);
    const ceilGeo = gridGeometry(ceilGrid, cx, cz, false, (ix, iz) => !isShaft(ix, iz));
    if (ceilGeo) {
      group.add(new THREE.Mesh(ceilGeo, this.p.ceilMat));
      geometries.push(ceilGeo);
    }

    if (anyGallery) {
      // Upper floor: slab top, ramping down at edges and into shafts. Drawn
      // over gallery cells and their rim (the ramps); the collider covers the
      // whole chunk so the ramps are solid.
      const floor2Grid = sampleGrid((x, z) => T.floor2(x, z), cx, cz);
      const f2 = gridGeometry(floor2Grid, cx, cz, true, (ix, iz) => isGallery(ix, iz) || neighbourGallery(gallery, ix, iz));
      if (f2) {
        const m = new THREE.Mesh(f2, this.p.rockMat);
        anchorHatch(this.p, m, -hatchSeed);
        group.add(m);
        geometries.push(f2);
      }
      statics.push(addHeightfield(this.ph, floor2Grid, cx, cz));

      const ceil2Grid = sampleGrid((x, z) => T.ceiling2(x, z), cx, cz);
      const c2 = gridGeometry(ceil2Grid, cx, cz, false, (ix, iz) => isGallery(ix, iz));
      if (c2) {
        group.add(new THREE.Mesh(c2, this.p.ceilMat));
        geometries.push(c2);
      }
    }

    for (const upper of [false, true]) {
      if (upper && !anyGallery) continue;
      for (const r of scatterRocks(T, cx, cz, chunkSeed, upper)) {
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
    this.chunks.set(key, { key, cx, cz, group, statics, geometries, props: this.props.spawn(cx, cz, chunkSeed), floorMesh, floorStatic });
  }

  private dispose(chunk: Chunk): void {
    this.root.remove(chunk.group);
    for (const g of chunk.geometries) g.dispose();
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
