import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "../physics/world";

/**
 * Kinematic character controller. Rapier resolves the capsule against the
 * terrain heightfields and rock hulls; auto-step is the first rung of
 * climbing (knee-high rock is just walked over), slope limits turn steep
 * pinches into walls. Gravity and jump are integrated here.
 */

const RADIUS = 0.35;
const HALF_HEIGHT = 0.5; // capsule cylinder half-height → total height 1.7
const WALK = 4.2;
const RUN = 7.2;
const ACCEL = 24;
const GRAVITY = -20;
const JUMP = 7.4;
const STEP_HEIGHT = 0.55;
const COYOTE = 0.12;

export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly cc: RAPIER.KinematicCharacterController;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  private sinceGrounded = 0;
  private vy = 0;

  constructor(private readonly ph: Physics, spawn: THREE.Vector3) {
    const { R, world } = ph;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + HALF_HEIGHT + RADIUS, spawn.z),
    );
    this.collider = world.createCollider(R.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.cc = world.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(STEP_HEIGHT, 0.25, true);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((56 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.syncPosition();
  }

  /** Feet position (world). */
  private syncPosition(): void {
    const t = this.body.translation();
    this.position.set(t.x, t.y - HALF_HEIGHT - RADIUS, t.z);
  }

  get height(): number {
    return (HALF_HEIGHT + RADIUS) * 2;
  }

  /** `wish` is the desired horizontal direction in world space (length ≤ 1). */
  step(dt: number, wish: THREE.Vector3, run: boolean, jump: boolean): void {
    const speed = run ? RUN : WALK;
    // Horizontal velocity eases toward the wish so starts/stops read as weight.
    const targetX = wish.x * speed;
    const targetZ = wish.z * speed;
    const k = Math.min(1, ACCEL * dt / speed);
    this.velocity.x += (targetX - this.velocity.x) * k;
    this.velocity.z += (targetZ - this.velocity.z) * k;

    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;
    if (jump && this.sinceGrounded < COYOTE && this.vy <= 0.01) {
      this.vy = JUMP;
      this.sinceGrounded = COYOTE;
    }
    this.vy += GRAVITY * dt;
    if (this.grounded && this.vy < 0) this.vy = -2; // keep pressing into the ground

    const desired = { x: this.velocity.x * dt, y: this.vy * dt, z: this.velocity.z * dt };
    this.cc.computeColliderMovement(this.collider, desired);
    const m = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (this.grounded && this.vy < 0) this.vy = 0;
    // Ceiling bump: if we asked to rise and were stopped, kill upward speed.
    if (desired.y > 0.001 && m.y < desired.y * 0.5) this.vy = Math.min(this.vy, 0);
    this.velocity.y = this.vy;
  }

  /** After world.step(): read back the settled position. */
  afterStep(): void {
    this.syncPosition();
  }

  teleport(p: THREE.Vector3): void {
    this.body.setTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS, z: p.z });
    this.vy = 0;
    this.velocity.set(0, 0, 0);
    this.syncPosition();
  }
}
