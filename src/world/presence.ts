import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { anchorHatch, makeFigureMaterial, disposeFigureMaterial, setFigureColorway, type Pipeline } from "../render/pipeline";
import { rockGeometry, type Terrain } from "./terrain";
import { mulberry32 } from "./noise";
import { COLORWAYS } from "../render/palette";
import { CFG } from "./config";

/**
 * A wandering presence: one non-hostile roaming figure, private/seeded
 * worlds only (see the gate in main.ts). No health, no damage, no combat,
 * no collider at all — walking into it does nothing because there is
 * nothing for the player's body to hit, not because of a special case.
 * It drifts toward a randomly re-picked nearby point when left alone, and
 * flees the nearest active light source when one comes close. Built from
 * the same procedural-rock technique every boulder and golem already uses,
 * but its own small, distinct, asymmetric silhouette — no shoulders, arms
 * or head — so it never reads as a mis-worn player skin.
 */

const PRESENCE_COLORWAY = Math.max(0, COLORWAYS.findIndex((c) => c.name === "Newsprint"));

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** A jagged, hunched rock-stack, drifting sideways as it rises — the same
 *  `rockGeometry` cones every boulder/golem is built from, stacked with no
 *  shoulders/arms/head so it reads as a heap of watching rubble, not a
 *  figure. Deterministic per seed. */
function buildPresenceGeometry(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  let dx = 0, dz = 0;
  const segments = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const radius = (0.32 - t * 0.14) * (0.75 + rng() * 0.4);
    const height = 0.22 + rng() * 0.22;
    const g = rockGeometry(rng, radius, height);
    g.rotateY(rng() * Math.PI * 2);
    g.rotateX((rng() - 0.5) * 0.35);
    dx += (rng() - 0.5) * 0.16;
    dz += (rng() - 0.5) * 0.16;
    g.translate(dx, y + height / 2, dz);
    parts.push(g);
    y += height * 0.75;
  }
  const jut = rockGeometry(rng, 0.09 + rng() * 0.05, 0.26 + rng() * 0.18);
  jut.rotateZ((rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.4));
  jut.translate(dx + (rng() - 0.5) * 0.2, y * 0.8, dz + (rng() - 0.5) * 0.2);
  parts.push(jut);
  return merge(parts);
}

/** Pick a deterministic spawn point in an actually-open lower-cave room,
 *  searching outward from world origin — same seed always finds the same
 *  spot, so every client's very first (pre-sync) guess already agrees. */
export function findPresenceSpawn(terrain: Terrain, seed: number): THREE.Vector3 {
  const rng = mulberry32(seed ^ 0x9d2c5680);
  for (let i = 0; i < 200; i++) {
    const a = rng() * Math.PI * 2;
    const d = 10 + rng() * 70;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (terrain.isOpen(x, z)) return new THREE.Vector3(x, terrain.floorAt(x, z), z);
  }
  return new THREE.Vector3(0, terrain.floorAt(0, 0), 0);
}

/** Position + fleeing, as sent over the net — mirrors `TorchMsg`/`DigMsg`. */
export type PresenceNetState = { p: [number, number, number]; f: 0 | 1 };

export class Presence {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  fleeing = false;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly hull: THREE.Mesh;
  private readonly target = new THREE.Vector3();
  private retimer = 0;

  constructor(private readonly p: Pipeline, private readonly terrain: Terrain, seed: number, spawnAt: THREE.Vector3) {
    const geo = buildPresenceGeometry(seed ^ 0x51ed270b);
    this.geometry = geo;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const targetH = 1.3;
    const scale = targetH / Math.max(0.4, bb.max.y - bb.min.y);
    const centre = new THREE.Vector3();
    bb.getCenter(centre);
    this.material = makeFigureMaterial(p);
    setFigureColorway(this.material, PRESENCE_COLORWAY);
    this.material.uniforms.uMinY.value = bb.min.y;
    this.material.uniforms.uMaxY.value = bb.max.y;
    const color = new THREE.Mesh(geo, this.material);
    anchorHatch(p, color, ((seed % 1000) / 1000 - 0.5) * 1.2);
    const hull = new THREE.Mesh(geo, p.hullMat);
    p.ndHidden.add(hull);
    this.hull = hull;
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -bb.min.y * scale, -centre.z * scale);
    this.group.add(carrier);
    this.group.visible = false;
    p.scene.add(this.group);
    this.position = spawnAt.clone();
    this.group.position.copy(this.position);
    this.pickTarget();
  }

  private pickTarget(): void {
    const R = CFG.presence.wanderRadius;
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 3 + Math.random() * R;
      const x = this.position.x + Math.cos(a) * d;
      const z = this.position.z + Math.sin(a) * d;
      if (this.terrain.isOpen(x, z)) {
        this.target.set(x, 0, z);
        this.retimer = CFG.presence.retargetSec * (0.6 + Math.random() * 0.8);
        return;
      }
    }
    // Nowhere open turned up nearby this try — sit a moment, try again soon.
    this.target.set(this.position.x, 0, this.position.z);
    this.retimer = 1.5;
  }

  /** Try to step `dx,dz * dist` from the current position; slides along one
   *  axis if the diagonal is blocked, same loose collision-avoidance
   *  `scatterRocks` uses (`terrain.isOpen`), not real physics. Returns
   *  whether it actually moved. */
  private tryStep(dx: number, dz: number, dist: number): boolean {
    const nx = this.position.x + dx * dist, nz = this.position.z + dz * dist;
    if (this.terrain.isOpen(nx, nz)) { this.position.x = nx; this.position.z = nz; return true; }
    if (this.terrain.isOpen(nx, this.position.z)) { this.position.x = nx; return true; }
    if (this.terrain.isOpen(this.position.x, nz)) { this.position.z = nz; return true; }
    return false;
  }

  /** Owner-only: advance the wander/flee AI for one frame. `torches` is the
   *  frame's already-assembled active light list (mine + peers' + standing
   *  torches) — reacting to it is the entire "half-seen" behaviour. */
  simulate(dt: number, torches: Array<{ position: THREE.Vector3; reach: number }>): void {
    let nearest: THREE.Vector3 | null = null;
    let nearestD = Infinity;
    for (const t of torches) {
      const d = this.position.distanceTo(t.position);
      if (d <= CFG.presence.fleeRadius && d < nearestD) { nearestD = d; nearest = t.position; }
    }
    this.fleeing = nearest !== null;
    let dx: number, dz: number;
    if (nearest) {
      dx = this.position.x - nearest.x;
      dz = this.position.z - nearest.z;
    } else {
      this.retimer -= dt;
      dx = this.target.x - this.position.x;
      dz = this.target.z - this.position.z;
      if (Math.hypot(dx, dz) < 0.6 || this.retimer <= 0) { this.pickTarget(); dx = this.target.x - this.position.x; dz = this.target.z - this.position.z; }
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const speed = this.fleeing ? CFG.presence.fleeSpeed : CFG.presence.wanderSpeed;
    if (!this.tryStep(dx, dz, speed * dt) && !this.fleeing) this.pickTarget();
    this.position.y = this.terrain.floorAt(this.position.x, this.position.z);
  }

  /** Non-owner: ease toward the latest broadcast snapshot, same lerp
   *  constant `main.ts` already applies to remote players. */
  applyRemote(msg: PresenceNetState, k: number): void {
    this.fleeing = msg.f === 1;
    this.position.x += (msg.p[0] - this.position.x) * k;
    this.position.y += (msg.p[1] - this.position.y) * k;
    this.position.z += (msg.p[2] - this.position.z) * k;
  }

  /** Visible only while at least one of the frame's active lights actually
   *  reaches it — the "half-seen" approximation: most of the time, in the
   *  dark, you shouldn't see it at all, so this is a hard on/off rather than
   *  a persistent per-vertex ink map (which doesn't apply to something that
   *  moves). Call every frame, owner or not. */
  render(torches: Array<{ position: THREE.Vector3; reach: number }>): void {
    let lit = false;
    for (const t of torches) {
      if (this.position.distanceTo(t.position) <= t.reach) { lit = true; break; }
    }
    this.group.visible = lit;
    this.group.position.copy(this.position);
  }

  dispose(): void {
    this.p.scene.remove(this.group);
    this.p.ndHidden.delete(this.hull);
    disposeFigureMaterial(this.p, this.material);
    this.geometry.dispose();
  }
}
