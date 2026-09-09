import RAPIER from "@dimforge/rapier3d-compat";
import type { HeightGrid } from "../world/terrain";
import { CELLS, CHUNK } from "../world/terrain";

/**
 * Rapier wrapper. Fixed 60 Hz step; terrain is one heightfield collider per
 * chunk, rocks are convex hulls on fixed bodies, the player is a kinematic
 * capsule driven by the character controller.
 */

export type Physics = {
  R: typeof RAPIER;
  world: RAPIER.World;
};

export async function initPhysics(): Promise<Physics> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = 1 / 60;
  return { R: RAPIER, world };
}

export type StaticHandle = { body: RAPIER.RigidBody; colliders: RAPIER.Collider[] };

/**
 * A chunk's floor as a heightfield. Rapier stores the height matrix in
 * COLUMN-major order with rows along z and columns along x; the field spans
 * ±scale/2 about the body's translation. Our grid is row-major by z, so the
 * copy below transposes. `main` cross-checks this at boot with ray casts.
 */
export function addHeightfield(ph: Physics, grid: HeightGrid, cx: number, cz: number): StaticHandle {
  const { R, world } = ph;
  const n = CELLS + 1;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      // column-major: index = column * nrows + row, column ↔ x, row ↔ z
      heights[ix * n + iz] = grid.samples[iz * n + ix]!;
    }
  }
  const body = world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2),
  );
  const desc = R.ColliderDesc.heightfield(CELLS, CELLS, heights, new R.Vector3(CHUNK, 1, CHUNK));
  desc.setFriction(0.9);
  const col = world.createCollider(desc, body);
  return { body, colliders: [col] };
}

export function addConvexHull(
  ph: Physics, points: Float32Array, x: number, y: number, z: number, rotationY: number,
): StaticHandle | null {
  const { R, world } = ph;
  const desc = R.ColliderDesc.convexHull(points);
  if (!desc) return null;
  const half = rotationY / 2;
  const body = world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
  );
  desc.setFriction(0.8);
  const col = world.createCollider(desc, body);
  return { body, colliders: [col] };
}

export function removeStatic(ph: Physics, h: StaticHandle): void {
  for (const c of h.colliders) ph.world.removeCollider(c, false);
  ph.world.removeRigidBody(h.body);
}

/** First collider along a ray: distance + collider handle, or null. */
export function rayHit(
  ph: Physics, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number },
  maxDist: number, exclude?: RAPIER.RigidBody,
): { toi: number; handle: number } | null {
  const ray = new ph.R.Ray(origin, dir);
  const hit = ph.world.castRay(ray, maxDist, true, undefined, undefined, undefined, exclude);
  if (!hit) return null;
  return { toi: hit.timeOfImpact, handle: hit.collider.handle };
}

/** Distance along `dir` (unit) from `origin` to the first collider, or null.
 *  `exclude` skips the player's own body. */
export function rayDistance(
  ph: Physics, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number },
  maxDist: number, exclude?: RAPIER.RigidBody,
): number | null {
  const ray = new ph.R.Ray(origin, dir);
  const hit = ph.world.castRay(ray, maxDist, true, undefined, undefined, undefined, exclude);
  if (!hit) return null;
  const h = hit as unknown as { timeOfImpact?: number; toi?: number };
  return h.timeOfImpact ?? h.toi ?? null;
}
