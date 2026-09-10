import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Physics } from "../physics/world";
import { rayDistance } from "../physics/world";
import type { Terrain } from "../world/terrain";
import { CFG } from "../world/config";

/**
 * Kinematic character controller. Rapier resolves the capsule against the
 * terrain heightfields and rock hulls; auto-step is the first rung of
 * climbing (knee-high rock is just walked over), slope limits turn steep
 * pinches into walls. Gravity, jump and the climb state machine live here.
 *
 * Climbing = ledge grab + mantle. When you push into a wall (or fall past one
 * while pushing toward it) three rays look for a ledge between knee and
 * reach height with headroom above it; if there is one and you have the
 * stamina, the body is carried up and over it along an eased path while
 * physics is bypassed. Stamina refills on the ground.
 *
 * A sheer-face wall climb only grips where the rock reads as hatched, not
 * smooth black fill: `terrain.solidity(x,z) < CFG.world.climbSolidity`.
 * Pillar cores (solidity near 1) are too smooth to grip, so the look tells
 * you where you can climb.
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
/** Ledge search: from above auto-step to a full reach overhead. */
const LEDGE_MIN = 0.7;
const LEDGE_MAX = 2.45;
const MANTLE_COST = 28;
const STAMINA_REGEN = 30;
/** Wall climb: metres per second up a sheer face, stamina per second. */
const CLIMB_SPEED = 1.7;
const CLIMB_DRAIN = 13;
const CLIMB_DELAY = 0.18; // seconds of pushing into a wall before the climb starts

type Mantle = { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; upY: number };

export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly cc: RAPIER.KinematicCharacterController;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  stamina = 100;
  mantle: Mantle | null = null;
  /** True while scaling a wall (stamina draining). */
  wallClimb = false;
  /** While someone carries me: the point I ride at (set from their state). */
  carriedAt: THREE.Vector3 | null = null;
  private pushT = 0;
  /** Set for one frame when a mantle starts (HUD / sound hook). */
  justMantled = false;
  private sinceGrounded = 0;
  private vy = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ph: Physics, spawn: THREE.Vector3, private readonly terrain: Terrain) {
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
    this.cc.setCharacterMass(85);
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
  get climbing(): boolean {
    return this.mantle !== null || this.wallClimb;
  }

  /** Distance to a wall in direction f at height h above the feet, or null. */
  private wallAhead(f: THREE.Vector3, h: number, max = RADIUS + 0.6): number | null {
    return rayDistance(this.ph, { x: this.position.x, y: this.position.y + h, z: this.position.z }, f, max, this.body);
  }

  /** Hatched rock is grip: a sheer face only holds a climb where the rock
   *  column ahead reads below the solidity cutoff (smooth pillar cores are
   *  solidity ≈ 1, drawn as flat black fill with no hatch). */
  private climbable(f: THREE.Vector3): boolean {
    const x = this.position.x + f.x * (RADIUS + 0.6);
    const z = this.position.z + f.z * (RADIUS + 0.6);
    return this.terrain.solidity(x, z) < CFG.world.climbSolidity;
  }

  /** Look for a ledge in direction `f` (unit, horizontal). Returns the point
   *  the feet should land on, or null. */
  private findLedge(f: THREE.Vector3): THREE.Vector3 | null {
    const feet = this.position;
    const exclude = this.body;
    // 1. Something in front, between knee and head — the nearest hit wins,
    //    so a 1 m step and a 2 m wall both register.
    let dWall: number | null = null;
    for (const h of [0.5, 1.0, 1.5]) {
      const d = rayDistance(this.ph, { x: feet.x, y: feet.y + h, z: feet.z }, f, RADIUS + 0.9, exclude);
      if (d != null && (dWall == null || d < dWall)) dWall = d;
    }
    if (dWall == null) return null;
    // 2. Drop rays from above at a few distances past the wall face and take
    //    the first TREAD — a top that is flat for another 0.4 m, so a
    //    heightfield riser (a steep 1 m slope) isn't mistaken for a ledge
    //    halfway up.
    const topY = feet.y + LEDGE_MAX + 0.4;
    const span = LEDGE_MAX + 0.4 - LEDGE_MIN + 0.01;
    const down = { x: 0, y: -1, z: 0 };
    for (const past of [0.55, 0.95, 1.35, 1.75]) {
      const over = dWall + past;
      const px = feet.x + f.x * over, pz = feet.z + f.z * over;
      const dTop = rayDistance(this.ph, { x: px, y: topY, z: pz }, down, span, exclude);
      if (dTop == null) continue;
      const ledgeY = topY - dTop;
      const rise = ledgeY - feet.y;
      if (rise < LEDGE_MIN || rise > LEDGE_MAX) continue;
      const dAhead = rayDistance(this.ph, { x: px + f.x * 0.4, y: topY, z: pz + f.z * 0.4 }, down, span + 1, exclude);
      if (dAhead == null || Math.abs((topY - dAhead) - ledgeY) > 0.15) continue;
      // 3. Headroom for the capsule on the tread.
      const head = rayDistance(this.ph, { x: px, y: ledgeY + 0.15, z: pz }, { x: 0, y: 1, z: 0 }, this.height, exclude);
      if (head != null) continue;
      return new THREE.Vector3(px + f.x * 0.15, ledgeY + 0.04, pz + f.z * 0.15);
    }
    return null;
  }

  private startMantle(to: THREE.Vector3): void {
    const rise = to.y - this.position.y;
    this.mantle = {
      from: this.position.clone(),
      to,
      t: 0,
      dur: 0.42 + rise * 0.14,
      upY: to.y + 0.06,
    };
    this.stamina -= MANTLE_COST;
    this.vy = 0;
    this.velocity.set(0, 0, 0);
    this.justMantled = true;
  }

  /** Let go with a velocity — thrown, or dropped. */
  launch(vx: number, vy: number, vz: number): void {
    this.carriedAt = null;
    this.mantle = null;
    this.wallClimb = false;
    this.velocity.set(vx, vy, vz);
    this.vy = vy;
    this.grounded = false;
    this.sinceGrounded = COYOTE;
  }

  /** `wish` is the desired horizontal direction in world space (length ≤ 1). */
  step(dt: number, wish: THREE.Vector3, run: boolean, jump: boolean): void {
    this.justMantled = false;
    if (this.carriedAt) {
      // Carried: I am where my carrier's hands are. Physics is bypassed.
      const c = this.carriedAt;
      this.body.setNextKinematicTranslation({ x: c.x, y: c.y + HALF_HEIGHT + RADIUS - 0.4, z: c.z });
      this.grounded = false;
      this.velocity.set(0, 0, 0);
      this.vy = 0;
      return;
    }
    if (this.mantle) {
      const m = this.mantle;
      m.t = Math.min(1, m.t + dt / m.dur);
      // Up first (to just above the ledge), then forward onto it.
      const up = Math.min(1, m.t / 0.6);
      const fwd = Math.max(0, (m.t - 0.55) / 0.45);
      const eu = up * up * (3 - 2 * up);
      const ef = fwd * fwd * (3 - 2 * fwd);
      const x = m.from.x + (m.to.x - m.from.x) * ef;
      const z = m.from.z + (m.to.z - m.from.z) * ef;
      const y = m.from.y + (m.upY - m.from.y) * eu + (m.to.y - m.upY) * ef;
      this.body.setNextKinematicTranslation({ x, y: y + HALF_HEIGHT + RADIUS, z });
      this.grounded = true;
      if (m.t >= 1) this.mantle = null;
      return;
    }

    // ── Wall climb ──────────────────────────────────────────────────
    // Keep pushing into a sheer face and you go up it, hand over hand, while
    // stamina lasts. Let go of the stick and you drop; run out and you drop;
    // reach the top and you mantle over.
    if (this.wallClimb) {
      const pushing = wish.lengthSq() > 0.09;
      const f = this.tmp.copy(wish).setY(0).normalize();
      const wallMid = pushing ? this.wallAhead(f, 0.9) : null;
      const grippy = pushing && wallMid != null && this.climbable(f);
      if (!pushing || this.stamina <= 0 || jump || (wallMid != null && !grippy)) {
        this.wallClimb = false;
        this.vy = jump ? JUMP * 0.7 : 0;
        if (jump) this.velocity.set(-f.x * 3, 0, -f.z * 3);
      } else if (wallMid == null) {
        // Nothing in front at chest height any more: the top. Mantle if there
        // is a tread, else keep rising a little to clear the lip.
        const ledge = this.findLedge(f);
        this.wallClimb = false;
        if (ledge) this.startMantle(ledge);
        else this.vy = 3.5;
      } else {
        this.stamina = Math.max(0, this.stamina - CLIMB_DRAIN * dt);
        // Slide along the wall with the sideways part of the stick.
        const along = new THREE.Vector3(-f.z, 0, f.x);
        const side = wish.dot(along);
        const desired = { x: (f.x * 0.6 + along.x * side * 1.2) * dt, y: CLIMB_SPEED * dt, z: (f.z * 0.6 + along.z * side * 1.2) * dt };
        this.cc.computeColliderMovement(this.collider, desired);
        const m = this.cc.computedMovement();
        const t = this.body.translation();
        this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
        this.grounded = false;
        this.velocity.set(0, CLIMB_SPEED, 0);
        return;
      }
    }

    const speed = run ? RUN : WALK;
    // Horizontal velocity eases toward the wish so starts/stops read as weight.
    const k = Math.min(1, ACCEL * dt / speed);
    this.velocity.x += (wish.x * speed - this.velocity.x) * k;
    this.velocity.z += (wish.z * speed - this.velocity.z) * k;

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
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (this.grounded && this.vy < 0) this.vy = 0;
    if (desired.y > 0.001 && m.y < desired.y * 0.5) this.vy = Math.min(this.vy, 0);
    this.velocity.y = this.vy;

    // ── Ledge grab ────────────────────────────────────────────────────
    // Pushing into something that stopped us (on the ground or in the air,
    // rising slowly or falling): look for a ledge to mantle onto.
    const pushing = wish.lengthSq() > 0.09;
    const wantedH = Math.hypot(desired.x, desired.z);
    const gotH = Math.hypot(m.x, m.z);
    const blocked = wantedH > 0.004 && gotH < wantedH * 0.4;
    if (pushing && blocked && this.stamina >= MANTLE_COST && (wasGrounded || this.vy < 4)) {
      const f = this.tmp.copy(wish).setY(0).normalize();
      const ledge = this.findLedge(f);
      if (ledge) this.startMantle(ledge);
    }
    // No ledge in reach but a sheer face ahead: after a beat of pushing, climb.
    if (pushing && blocked && !this.mantle && this.stamina > 8) {
      this.pushT += dt;
      const f = this.tmp.copy(wish).setY(0).normalize();
      if (this.pushT > CLIMB_DELAY && this.wallAhead(f, 0.9) != null && this.wallAhead(f, 1.6) != null && this.climbable(f)) {
        this.wallClimb = true;
        this.pushT = 0;
      }
    } else {
      this.pushT = 0;
    }
    if (this.grounded) this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * dt);
  }

  /** After world.step(): read back the settled position. */
  afterStep(): void {
    this.syncPosition();
  }

  teleport(p: THREE.Vector3): void {
    this.mantle = null;
    this.body.setTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF_HEIGHT + RADIUS, z: p.z });
    this.vy = 0;
    this.velocity.set(0, 0, 0);
    this.syncPosition();
  }
}
