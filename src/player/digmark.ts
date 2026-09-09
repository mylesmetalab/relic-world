import * as THREE from "three";
import type { Pipeline } from "../render/pipeline";
import type { Terrain, Level } from "../world/terrain";

/** What one click will cut, worked out from the aim each frame. */
export type DigPlan = {
  kind: "pit" | "tunnel" | "step";
  level: Level;
  /** Cell centre. */
  x: number;
  z: number;
  /** Floor height the cut leaves behind. */
  floorY: number;
  /** Where the aim ray met rock (chips fly from here). */
  hit: THREE.Vector3;
};

const PAPER = 0xe8e4d0;
const YELLOW = 0xf2f542;

/**
 * The dig marker: a white square on the 1 m cell the next click will cut,
 * drawn at the floor the cut leaves. A pit shows on the ground; a tunnel
 * shows its floor at your feet inside the wall; a step turns yellow and sits
 * up the wall where the new ledge will be. Also a fistful of ink chips when
 * a dig lands, so the cut has weight.
 */
export class DigMark {
  private readonly square: THREE.LineLoop;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly post: THREE.Line;
  private readonly chips: THREE.Points;
  private readonly chipPos: Float32Array;
  private readonly chipVel: Float32Array;
  private readonly chipLife: Float32Array;
  private readonly N = 96;
  private next = 0;

  constructor(private readonly p: Pipeline, private readonly terrain: Terrain) {
    this.mat = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.95 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    this.square = new THREE.LineLoop(geo, this.mat);
    this.square.frustumCulled = false;
    this.square.visible = false;
    p.scene.add(this.square);
    p.ndHidden.add(this.square);

    const postGeo = new THREE.BufferGeometry();
    postGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    this.post = new THREE.Line(postGeo, new THREE.LineDashedMaterial({ color: YELLOW, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9 }));
    this.post.frustumCulled = false;
    this.post.visible = false;
    p.scene.add(this.post);
    p.ndHidden.add(this.post);

    this.chipPos = new Float32Array(this.N * 3).fill(-9999);
    this.chipVel = new Float32Array(this.N * 3);
    this.chipLife = new Float32Array(this.N);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(this.chipPos, 3));
    this.chips = new THREE.Points(cg, new THREE.PointsMaterial({ color: PAPER, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.95 }));
    this.chips.frustumCulled = false;
    p.scene.add(this.chips);
    p.ndHidden.add(this.chips);
  }

  show(plan: DigPlan | null): void {
    if (!plan) {
      this.square.visible = false;
      this.post.visible = false;
      return;
    }
    const x0 = Math.floor(plan.x), z0 = Math.floor(plan.z);
    const pos = this.square.geometry.attributes.position as THREE.BufferAttribute;
    const y = plan.floorY + 0.05;
    pos.setXYZ(0, x0, y, z0);
    pos.setXYZ(1, x0 + 1, y, z0);
    pos.setXYZ(2, x0 + 1, y, z0 + 1);
    pos.setXYZ(3, x0, y, z0 + 1);
    pos.needsUpdate = true;
    this.mat.color.setHex(plan.kind === "step" ? YELLOW : PAPER);
    this.square.visible = true;
    // A step: a dashed post from the hit point down to the ledge, so the
    // height of the cut reads at a glance.
    if (plan.kind === "step") {
      const pp = this.post.geometry.attributes.position as THREE.BufferAttribute;
      pp.setXYZ(0, plan.x, plan.hit.y, plan.z);
      pp.setXYZ(1, plan.x, y, plan.z);
      pp.needsUpdate = true;
      this.post.computeLineDistances();
      this.post.visible = true;
    } else {
      this.post.visible = false;
    }
  }

  /** Throw chips out of a cut. `n` ≈ how much rock came away. */
  burst(at: THREE.Vector3, n = 14): void {
    for (let i = 0; i < n; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.N;
      const a = Math.random() * Math.PI * 2;
      const s = 1.2 + Math.random() * 2.2;
      this.chipPos[k * 3] = at.x + (Math.random() - 0.5) * 0.4;
      this.chipPos[k * 3 + 1] = at.y + Math.random() * 0.2;
      this.chipPos[k * 3 + 2] = at.z + (Math.random() - 0.5) * 0.4;
      this.chipVel[k * 3] = Math.cos(a) * s;
      this.chipVel[k * 3 + 1] = 2.2 + Math.random() * 2.6;
      this.chipVel[k * 3 + 2] = Math.sin(a) * s;
      this.chipLife[k] = 0.6 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let k = 0; k < this.N; k++) {
      if (this.chipLife[k]! <= 0) continue;
      any = true;
      this.chipLife[k]! -= dt;
      this.chipVel[k * 3 + 1]! -= 20 * dt;
      const x = (this.chipPos[k * 3]! += this.chipVel[k * 3]! * dt);
      let y = (this.chipPos[k * 3 + 1]! += this.chipVel[k * 3 + 1]! * dt);
      const z = (this.chipPos[k * 3 + 2]! += this.chipVel[k * 3 + 2]! * dt);
      // Settle on whatever floor is under the chip.
      const g = this.terrain.groundAt(x, z, y + 0.5);
      if (y < g) {
        y = this.chipPos[k * 3 + 1] = g + 0.02;
        this.chipVel[k * 3] = this.chipVel[k * 3 + 2] = 0;
        this.chipVel[k * 3 + 1] = 0;
      }
      if (this.chipLife[k]! <= 0) this.chipPos[k * 3 + 1] = -9999;
    }
    if (any) (this.chips.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
