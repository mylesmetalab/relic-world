import * as THREE from "three";
import { anchorHatch, type Pipeline } from "../render/pipeline";
import { addConvexHull, addHeightfield, removeStatic, type Physics, type StaticHandle } from "../physics/world";
import { CHUNK, Terrain, gridGeometry, sampleGrid, scatterRocks } from "./terrain";
import { hash3 } from "./noise";

/** Everything one chunk owns, so it can be dropped in one go. */
type Chunk = {
  key: string;
  group: THREE.Group;
  statics: StaticHandle[];
  geometries: THREE.BufferGeometry[];
};

/**
 * Keeps a (2r+1)² window of chunks alive around the player. Building a chunk
 * is synchronous and cheap (~1k triangles + a dozen rocks); at most one is
 * built per frame so crossing a seam never hitches.
 */
export class ChunkManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly pending: Array<[number, number]> = [];
  readonly root = new THREE.Group();

  constructor(
    private readonly p: Pipeline,
    private readonly ph: Physics,
    private readonly terrain: Terrain,
    private readonly radius = 2,
  ) {
    p.scene.add(this.root);
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
    // Nearest first so the ground under the player is always there.
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
    // The chunk under the player is never deferred.
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

  private build(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const statics: StaticHandle[] = [];
    const chunkSeed = hash3(this.terrain.seed, cx, cz);

    const floorGrid = sampleGrid((x, z) => this.terrain.floor(x, z), cx, cz);
    const floorGeo = gridGeometry(floorGrid, cx, cz, true);
    const floor = new THREE.Mesh(floorGeo, this.p.rockMat);
    // Hatch anchors to the chunk centre; the seed keeps neighbours' families apart.
    floor.position.set(0, 0, 0);
    anchorHatch(this.p, floor, ((chunkSeed % 1000) / 1000 - 0.5) * 1.2);
    group.add(floor);
    geometries.push(floorGeo);
    statics.push(addHeightfield(this.ph, floorGrid, cx, cz));

    const ceilGrid = sampleGrid((x, z) => this.terrain.ceiling(x, z), cx, cz);
    const ceilGeo = gridGeometry(ceilGrid, cx, cz, false);
    const ceil = new THREE.Mesh(ceilGeo, this.p.ceilMat);
    group.add(ceil);
    geometries.push(ceilGeo);

    for (const r of scatterRocks(this.terrain, cx, cz, chunkSeed)) {
      const mesh = new THREE.Mesh(r.geometry, this.p.rockMat);
      mesh.position.copy(r.position);
      mesh.rotation.y = r.rotationY;
      anchorHatch(this.p, mesh, r.hatchSeed);
      group.add(mesh);
      geometries.push(r.geometry);
      const h = addConvexHull(this.ph, r.hull, r.position.x, r.position.y, r.position.z, r.rotationY);
      if (h) statics.push(h);
    }

    this.root.add(group);
    this.chunks.set(key, { key, group, statics, geometries });
  }

  private dispose(chunk: Chunk): void {
    this.root.remove(chunk.group);
    for (const g of chunk.geometries) g.dispose();
    for (const s of chunk.statics) removeStatic(this.ph, s);
    this.chunks.delete(chunk.key);
  }
}
