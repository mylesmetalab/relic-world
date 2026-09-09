import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "../physics/world";
import { rayHit } from "../physics/world";
import type { Props, Prop } from "../world/props";
import type { Terrain } from "../world/terrain";
import type { Pipeline } from "../render/pipeline";
import { HULL_FRAGMENT, HULL_VERTEX } from "../render/shaders";

/**
 * Grab and throw. Look at a prop within reach and it gets a white outline
 * (the same inverted hull the figure's contour uses, in paper white). F picks
 * it up: the body goes kinematic and rides in front of the chest on a
 * telemetry tether. Click throws it along the look direction; while holding,
 * a dashed white arc shows exactly where it will land — sampled from the
 * same gravity and initial velocity the physics will use, so the preview is
 * honest. Heavier props throw slower.
 */

const REACH = 3.2;
const GRAVITY = 20; // matches the physics world (positive magnitude)
const PAPER = 0xe8e4d0;

export class Grab {
  target: Prop | null = null;
  held: Prop | null = null;
  private readonly outline: THREE.Mesh;
  private readonly outlineMat: THREE.ShaderMaterial;
  private readonly tether: THREE.Line;
  private readonly arc: THREE.Line;
  private readonly ring: THREE.Mesh;
  private readonly arcPoints = new Float32Array(48 * 3);
  private readonly holdPoint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly p: Pipeline,
    private readonly ph: Physics,
    private readonly props: Props,
    private readonly terrain: Terrain,
  ) {
    this.outlineMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uThick: { value: 1.6 }, uInk: { value: new THREE.Color(PAPER) } },
      vertexShader: HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      depthTest: true,
    });
    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), this.outlineMat);
    this.outline.visible = false;
    p.scene.add(this.outline);
    p.ndHidden.add(this.outline);

    const lineMat = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.9 });
    this.tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    this.tether.visible = false;
    p.scene.add(this.tether);
    p.ndHidden.add(this.tether);

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.BufferAttribute(this.arcPoints, 3));
    this.arc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: PAPER, dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.9 }));
    this.arc.visible = false;
    this.arc.frustumCulled = false;
    p.scene.add(this.arc);
    p.ndHidden.add(this.arc);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 24), new THREE.MeshBasicMaterial({ color: PAPER, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    p.scene.add(this.ring);
    p.ndHidden.add(this.ring);
  }

  /** Each frame: find what the eye is on (a prop within reach along the look ray). */
  aim(origin: THREE.Vector3, dir: THREE.Vector3, exclude: RAPIER.RigidBody): void {
    if (this.held) {
      this.target = null;
      return;
    }
    const hit = rayHit(this.ph, origin, dir, REACH + 4, exclude);
    let found: Prop | null = null;
    if (hit) {
      const prop = this.props.fromCollider(hit.handle);
      if (prop && prop.dynamic) {
        const t = prop.body.translation();
        // Reach is measured from the figure, not the camera.
        if (Math.hypot(t.x - this.holdFrom.x, t.y - this.holdFrom.y, t.z - this.holdFrom.z) <= REACH) found = prop;
      }
    }
    this.target = found;
  }

  /** Where reach is measured from (chest). Set by main each frame. */
  readonly holdFrom = new THREE.Vector3();

  grabOrDrop(playerVel: THREE.Vector3): void {
    if (this.held) {
      this.release(playerVel.x, playerVel.y, playerVel.z);
      return;
    }
    if (!this.target) return;
    this.held = this.target;
    this.target = null;
    this.props.hold(this.held);
  }

  /** Throw along `dir` (unit). Speed falls with mass; the arc preview used the same numbers. */
  throw(dir: THREE.Vector3, playerVel: THREE.Vector3): void {
    if (!this.held) return;
    const v = this.throwVelocity(dir, playerVel, this.tmp);
    this.release(v.x, v.y, v.z);
  }

  private throwVelocity(dir: THREE.Vector3, playerVel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const mass = this.held ? this.held.body.mass() : 50;
    const speed = THREE.MathUtils.clamp(13 * Math.sqrt(60 / Math.max(mass, 1)), 3.5, 16);
    return out.copy(dir).normalize().multiplyScalar(speed).add(playerVel);
  }

  private release(vx: number, vy: number, vz: number): void {
    if (!this.held) return;
    this.props.drop(this.held, { x: vx, y: vy, z: vz });
    this.held = null;
    this.tether.visible = false;
    this.arc.visible = false;
    this.ring.visible = false;
  }

  /** Fixed-step: carry the held prop to the hold point. */
  step(chest: THREE.Vector3, forward: THREE.Vector3): void {
    if (!this.held) return;
    this.holdPoint.copy(chest).addScaledVector(forward, 1.15);
    this.holdPoint.y += 0.1;
    this.held.body.setNextKinematicTranslation({ x: this.holdPoint.x, y: this.holdPoint.y, z: this.holdPoint.z });
  }

  /** Per frame: outline the target or the held prop, tether + arc while holding. */
  render(chest: THREE.Vector3, throwDir: THREE.Vector3, playerVel: THREE.Vector3): void {
    const focus = this.held ?? this.target;
    if (focus) {
      const src = firstMesh(focus.mesh);
      if (src) {
        if (this.outline.geometry !== src.geometry) this.outline.geometry = src.geometry;
        src.updateWorldMatrix(true, false);
        this.outline.matrixAutoUpdate = false;
        this.outline.matrix.copy(src.matrixWorld);
        this.outline.visible = true;
        this.outlineMat.uniforms.uThick.value = this.held ? 2.2 : 1.6;
      }
    } else {
      this.outline.visible = false;
    }
    if (!this.held) {
      this.tether.visible = false;
      this.arc.visible = false;
      this.ring.visible = false;
      return;
    }
    const t = this.held.body.translation();
    const pos = (this.tether.geometry.attributes.position as THREE.BufferAttribute);
    pos.setXYZ(0, chest.x, chest.y, chest.z);
    pos.setXYZ(1, t.x, t.y, t.z);
    pos.needsUpdate = true;
    this.tether.visible = true;

    // Ballistic preview from the hold point with the exact throw velocity.
    const v = this.throwVelocity(throwDir, playerVel, this.tmp);
    const n = 48;
    let landed: THREE.Vector3 | null = null;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const tt = i * 0.06;
      const x = t.x + v.x * tt;
      const y = t.y + v.y * tt - 0.5 * GRAVITY * tt * tt;
      const z = t.z + v.z * tt;
      this.arcPoints[i * 3] = x;
      this.arcPoints[i * 3 + 1] = y;
      this.arcPoints[i * 3 + 2] = z;
      count = i + 1;
      if (i > 0 && y <= this.terrain.floor(x, z) + 0.05) {
        landed = new THREE.Vector3(x, this.terrain.floor(x, z) + 0.03, z);
        break;
      }
    }
    // Pad the rest of the buffer with the last point so the dash stays put.
    for (let i = count; i < n; i++) {
      this.arcPoints[i * 3] = this.arcPoints[(count - 1) * 3]!;
      this.arcPoints[i * 3 + 1] = this.arcPoints[(count - 1) * 3 + 1]!;
      this.arcPoints[i * 3 + 2] = this.arcPoints[(count - 1) * 3 + 2]!;
    }
    (this.arc.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.arc.computeLineDistances();
    this.arc.visible = true;
    if (landed) {
      this.ring.position.copy(landed);
      this.ring.visible = true;
    } else {
      this.ring.visible = false;
    }
  }
}

function firstMesh(o: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  o.traverse((c) => {
    if (!found && (c as THREE.Mesh).isMesh && (c as THREE.Mesh).material !== undefined) {
      const m = c as THREE.Mesh;
      // Skip hull shells (BackSide contour) — outline the colour mesh.
      if ((m.material as THREE.Material).side === THREE.BackSide) return;
      found = m;
    }
  });
  return found;
}
