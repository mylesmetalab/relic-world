import * as THREE from "three";

/**
 * Packed miniatures (`public/models/<id>.json` + `.bin`, from
 * scripts/pack-stl.mjs): 16-bit fixed-point positions then 16-bit indices.
 * Loaded once per id and shared — figures and relics both draw from here.
 */

type PackedHeader = { nv: number; nf: number; lo: number[]; hi: number[] };

export type PackedModel = {
  /** Base disc cut off, smooth normals. Y-up, feet near y = cutMin. */
  geometry: THREE.BufferGeometry;
  /** Uncut bounds (zone fills sample against these). */
  full: THREE.Box3;
  cutMin: number;
  /** A sparse point cloud for a convex-hull collider. */
  hull: Float32Array;
};

export const PACKED_IDS = ["bast", "rook", "cam"] as const;
export type PackedId = (typeof PACKED_IDS)[number];
/** Fraction of the model's height that is base disc. Cam crouches on a thick
 *  round base, so its cut is deeper. */
const BASE_CUT: Record<string, number> = { bast: 0.07, rook: 0.07, cam: 0.14 };

const cache = new Map<string, Promise<PackedModel>>();

export function loadPacked(id: PackedId): Promise<PackedModel> {
  let p = cache.get(id);
  if (!p) {
    p = fetchPacked(id);
    cache.set(id, p);
  }
  return p;
}

async function fetchPacked(id: PackedId): Promise<PackedModel> {
  const [header, bin] = await Promise.all([
    fetch(`models/${id}.json`).then((r) => r.json() as Promise<PackedHeader>),
    fetch(`models/${id}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const u16 = new Uint16Array(bin);
  const pos = new Float32Array(header.nv * 3);
  for (let i = 0; i < header.nv; i++) {
    for (let k = 0; k < 3; k++) {
      const lo = header.lo[k] ?? 0;
      const hi = header.hi[k] ?? 1;
      pos[i * 3 + k] = lo + ((u16[i * 3 + k] ?? 0) / 65535) * (hi - lo);
    }
  }
  const idx = new Uint16Array(u16.subarray(header.nv * 3, header.nv * 3 + header.nf * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeBoundingBox();
  const full = geometry.boundingBox!.clone();
  const size = new THREE.Vector3();
  full.getSize(size);
  // Drop the base disc: every triangle entirely below the cut line.
  const cutY = full.min.y + size.y * (BASE_CUT[id] ?? 0.07);
  const kept: number[] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
    if (pos[a * 3 + 1]! < cutY && pos[b * 3 + 1]! < cutY && pos[c * 3 + 1]! < cutY) continue;
    kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const cutMin = geometry.boundingBox!.min.y;
  // Every ~20th surviving vertex is plenty for a hull.
  const used = new Set(kept);
  const hullPts: number[] = [];
  let n = 0;
  for (const v of used) {
    if (n++ % 20 !== 0) continue;
    hullPts.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
  }
  return { geometry, full, cutMin, hull: new Float32Array(hullPts) };
}
