import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { anchorHatch, disposeFigureMaterial, makeFigureMaterial, setFigureColorway, type Pipeline } from "../render/pipeline";
import { mulberry32 } from "../world/noise";
import { rockGeometry } from "../world/terrain";

/**
 * A figure — the player's body, or another player's. Two kinds:
 *  - PACKED: one of the tuner's miniatures (16-bit fixed-point positions +
 *    indices), base disc cut off, normalised to height, feet at the origin.
 *  - GOLEM: a procedural stack of the cave's own jagged rocks, seeded, so
 *    every golem is a different heap. Rig-free "miniatures" for now — they
 *    turn to face their motion and bob when walking (plan M5).
 * Each figure owns its zone material so players can wear different inks.
 */

type PackedHeader = { nv: number; nf: number; lo: number[]; hi: number[] };

export const CHARACTERS = [
  { id: "bast", name: "Bast" },
  { id: "rook", name: "Rook" },
  { id: "golem-1", name: "Cairn" },
  { id: "golem-2", name: "Shard" },
  { id: "golem-3", name: "Menhir" },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]["id"];

/** Yaw (radians) that turns each packed figure to face +z in its own frame. */
const FACING: Record<string, number> = { bast: (95 * Math.PI) / 180, rook: (72 * Math.PI) / 180 };
const BASE_CUT = 0.07;

function buildGolem(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  const segments = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const radius = (0.34 - t * 0.16) * (0.85 + rng() * 0.3);
    const height = 0.32 + rng() * 0.22;
    const g = rockGeometry(rng, radius, height);
    g.rotateY(rng() * Math.PI * 2);
    g.rotateZ((rng() - 0.5) * 0.25);
    g.translate((rng() - 0.5) * 0.08, y + height / 2, (rng() - 0.5) * 0.08);
    parts.push(g);
    y += height * 0.82;
  }
  // Shoulders: two slabs flung out at the top third.
  for (const side of [-1, 1]) {
    const g = rockGeometry(rng, 0.14 + rng() * 0.08, 0.55 + rng() * 0.3);
    g.rotateZ(side * (0.9 + rng() * 0.4));
    g.translate(side * 0.34, y * 0.7, 0);
    parts.push(g);
  }
  // Head: a small tilted shard.
  const head = rockGeometry(rng, 0.12 + rng() * 0.06, 0.3 + rng() * 0.15);
  head.rotateZ((rng() - 0.5) * 0.5);
  head.translate(0, y + 0.1, 0);
  parts.push(head);
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class Figure {
  readonly group = new THREE.Group();
  private readonly inner = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private facing = 0;
  private bob = 0;
  private geometry: THREE.BufferGeometry | null = null;
  hull: THREE.Mesh | null = null;
  character: CharacterId = "bast";

  constructor(private readonly p: Pipeline) {
    this.material = makeFigureMaterial(p);
    this.group.add(this.inner);
    p.scene.add(this.group);
  }

  setColorway(index: number): number {
    return setFigureColorway(this.material, index).name ? (this.material.userData.colorway as number) : 0;
  }
  get colorway(): number {
    return this.material.userData.colorway as number;
  }

  async load(id: CharacterId, height: number): Promise<void> {
    this.character = id;
    let geometry: THREE.BufferGeometry;
    let cutMin: number;
    let full: THREE.Box3;
    if (id.startsWith("golem")) {
      geometry = buildGolem(Number(id.split("-")[1]) * 977 + 13);
      geometry.computeBoundingBox();
      full = geometry.boundingBox!.clone();
      cutMin = full.min.y;
    } else {
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
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
      geometry.computeBoundingBox();
      full = geometry.boundingBox!.clone();
      const size = new THREE.Vector3();
      full.getSize(size);
      // Drop the base disc: every triangle entirely below the cut line.
      const cutY = full.min.y + size.y * BASE_CUT;
      const kept: number[] = [];
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
        if (pos[a * 3 + 1]! < cutY && pos[b * 3 + 1]! < cutY && pos[c * 3 + 1]! < cutY) continue;
        kept.push(a, b, c);
      }
      geometry.setIndex(kept);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      cutMin = geometry.boundingBox!.min.y;
    }

    const size = new THREE.Vector3();
    full.getSize(size);
    const scale = height / (full.max.y - cutMin);
    const centre = new THREE.Vector3();
    full.getCenter(centre);

    this.inner.clear();
    if (this.hull) this.p.ndHidden.delete(this.hull);
    this.geometry?.dispose();
    this.geometry = geometry;
    const color = new THREE.Mesh(geometry, this.material);
    anchorHatch(this.p, color, 0);
    const hull = new THREE.Mesh(geometry, this.p.hullMat);
    this.p.ndHidden.add(hull);
    this.hull = hull;
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -cutMin * scale, -centre.z * scale);
    carrier.rotation.y = FACING[id] ?? 0;
    this.inner.add(carrier);
    // Zone fills sample object-space height against the UNCUT bounds.
    this.material.uniforms.uMinY.value = full.min.y;
    this.material.uniforms.uMaxY.value = full.max.y;
  }

  /** Place at the feet, turn toward `heading` (world xz, may be zero), bob with speed. */
  update(feet: THREE.Vector3, heading: THREE.Vector3, speed: number, dt: number): void {
    if (heading.lengthSq() > 1e-4) {
      const want = Math.atan2(heading.x, heading.z);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
    }
    this.bob += speed * dt * 2.2;
    const lift = speed > 0.3 ? Math.abs(Math.sin(this.bob)) * 0.06 : 0;
    this.group.position.set(feet.x, feet.y + lift, feet.z);
    this.group.rotation.y = this.facing;
    this.inner.rotation.z = speed > 0.3 ? Math.sin(this.bob) * 0.035 : 0;
  }

  /** Direct placement (remote players: interpolated elsewhere). */
  place(feet: THREE.Vector3, facing: number): void {
    this.group.position.copy(feet);
    this.facing = facing;
    this.group.rotation.y = facing;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.p.scene.remove(this.group);
    if (this.hull) this.p.ndHidden.delete(this.hull);
    this.geometry?.dispose();
    disposeFigureMaterial(this.p, this.material);
  }
}
