import * as THREE from "three";
import { anchorHatch, type Pipeline } from "../render/pipeline";

/**
 * The player's body: one of the tuner's packed figures (16-bit fixed-point
 * positions + indices), base disc cut off, normalised to player height, feet
 * at the group origin. Drawn with the zone-filled figure material plus the
 * inverted-hull contour. A rig-free "miniature" for now — it turns to face
 * its motion and bobs a little when walking (plan M5 replaces it).
 */

type PackedHeader = { nv: number; nf: number; lo: number[]; hi: number[] };

export type FigureName = "bast" | "rook";
/** Yaw (radians) that turns each figure to face +z in its own frame. */
const FACING: Record<FigureName, number> = { bast: (95 * Math.PI) / 180, rook: (72 * Math.PI) / 180 };
const BASE_CUT = 0.07;

export class Figure {
  readonly group = new THREE.Group();
  private readonly inner = new THREE.Group();
  private facing = 0;
  private bob = 0;
  hull: THREE.Mesh | null = null;

  constructor(private readonly p: Pipeline) {
    this.group.add(this.inner);
    p.scene.add(this.group);
  }

  async load(name: FigureName, height: number): Promise<void> {
    const [header, bin] = await Promise.all([
      fetch(`/models/${name}.json`).then((r) => r.json() as Promise<PackedHeader>),
      fetch(`/models/${name}.bin`).then((r) => r.arrayBuffer()),
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
    const full = geometry.boundingBox!;
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
    const cut = geometry.boundingBox!;

    const scale = height / (size.y * (1 - BASE_CUT));
    const centre = new THREE.Vector3();
    full.getCenter(centre);
    this.inner.clear();
    const color = new THREE.Mesh(geometry, this.p.figureMat);
    anchorHatch(this.p, color, 0);
    const hull = new THREE.Mesh(geometry, this.p.hullMat);
    this.p.ndHidden.add(hull);
    this.hull = hull;
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -cut.min.y * scale, -centre.z * scale);
    carrier.rotation.y = FACING[name];
    this.inner.add(carrier);
    // Zone fills sample object-space height against the UNCUT bounds.
    this.p.figureMat.uniforms.uMinY.value = full.min.y;
    this.p.figureMat.uniforms.uMaxY.value = full.max.y;
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

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
