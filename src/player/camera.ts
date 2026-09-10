import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "../physics/world";
import { sweepDistance } from "../physics/world";

/**
 * Third-person boom that shortens when rock gets between it and the player,
 * with a first-person toggle. Yaw/pitch from mouse look; the boom distance
 * eases so a rock brushing past doesn't snap the frame.
 */

const SENS = 0.0022;
const PITCH_MIN = -0.55; // looking up
const PITCH_MAX = 1.15; // looking down
const BOOM = 4.6;
const EYE = 1.55;
const SHOULDER = 0.5;
/** How long a landing thump takes to ease back out, in seconds. */
const THUMP_DUR = 0.28;

export class PlayerCamera {
  yaw = Math.PI; // facing -z → camera behind the figure looking +z... set by main
  pitch = 0.22;
  firstPerson = false;
  private dist = BOOM;
  private readonly target = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private shakeT = 0;
  private shakeMag = 0;
  private readonly shakeOffset = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly ph: Physics) {}

  look(dx: number, dy: number): void {
    this.yaw -= dx * SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * SENS, PITCH_MIN, PITCH_MAX);
  }

  /** Unit forward vector on the ground plane (where W goes). */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Trigger a brief camera thump (a hard landing) — a quick downward dip
   *  that eases back out over `THUMP_DUR`. `mag` in metres. */
  thump(mag: number): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = THUMP_DUR;
  }

  update(feet: THREE.Vector3, dt: number, exclude: RAPIER.RigidBody): void {
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const t = this.shakeT / THUMP_DUR; // 1 → 0
      const eased = t * t;
      this.shakeOffset.set(0, -this.shakeMag * eased, 0);
    } else {
      this.shakeMag = 0;
      this.shakeOffset.set(0, 0, 0);
    }
    if (this.firstPerson) {
      this.camera.position.set(feet.x, feet.y + EYE, feet.z).add(this.shakeOffset);
      this.camera.rotation.set(0, 0, 0, "YXZ");
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = -this.pitch;
      return;
    }
    // Aim point: chest height, nudged over the right shoulder.
    const r = this.right(new THREE.Vector3());
    this.target.set(feet.x, feet.y + 1.35, feet.z).addScaledVector(r, SHOULDER);
    // Boom direction: behind and above, from yaw/pitch.
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    // Shorten on rock, with a small margin so the near plane never clips.
    // A swept ball, not a zero-width ray: a thin ray can clear a corner or a
    // shallow wall that the camera's actual near-plane/frustum would still
    // poke through as you rotate, leaving you looking through geometry.
    const hit = sweepDistance(this.ph, this.target, this.dir, 0.3, BOOM, exclude);
    const want = hit != null ? Math.max(0.6, hit - 0.3) : BOOM;
    // Snap in fast, ease back out.
    const k = want < this.dist ? 1 : Math.min(1, dt * 4);
    this.dist += (want - this.dist) * k;
    this.pos.copy(this.target).addScaledVector(this.dir, this.dist).add(this.shakeOffset);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }
}
