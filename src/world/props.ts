import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { anchorHatch, makeFigureMaterial, disposeFigureMaterial, setFigureColorway, type Pipeline } from "../render/pipeline";
import type { Physics } from "../physics/world";
import { CHUNK, Terrain, rockGeometry } from "./terrain";
import { mulberry32 } from "./noise";
import { loadPacked, PACKED_IDS, type PackedId } from "./models";
import { FACING } from "../player/figure";
import { COLORWAYS } from "../render/palette";

/**
 * Things you can push. Dynamic Rapier bodies with meshes that follow them:
 *  - SHARDS: fist-to-knee sized rock, scattered per chunk, light enough to
 *    kick along and heavy enough to feel like rock.
 *  - RELICS: a miniature (Bast / Rook / Cam) in gold leaf on a stone plinth.
 *    The statue is a dynamic body — walk into it and it topples and slides.
 * Props are shared: the nearest player owns a prop's simulation and
 * broadcasts it (see collectOwned / apply); everyone else follows.
 */

/** Rapier density is kg/m³ — rock, not foam. */
const ROCK_DENSITY = 2400;
const GOLD_DENSITY = 2600;

type Prop = {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D;
  /** Own material to dispose (relics). */
  material: THREE.ShaderMaterial | null;
  geometry: THREE.BufferGeometry | null;
  dynamic: boolean;
  spawn: { x: number; y: number; z: number };
  lastV: THREE.Vector3;
};

/** One prop's motion state on the wire. */
export type PropState = { k: string; p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number]; w: [number, number, number] };

export type ChunkProps = { key: string; props: Prop[]; statics: Array<{ body: RAPIER.RigidBody; collider: RAPIER.Collider }>; alive: boolean };

const GOLD = COLORWAYS.findIndex((c) => c.name === "Gold Leaf");

export class Props {
  private readonly all = new Set<Prop>();
  private readonly byId = new Map<string, Prop>();
  readonly root = new THREE.Group();
  private readonly q = new THREE.Quaternion();
  /** Fired with the velocity change (m/s) when an awake prop is knocked. */
  onKnock: ((impact: number, x: number, y: number, z: number) => void) | null = null;

  constructor(private readonly p: Pipeline, private readonly ph: Physics, private readonly terrain: Terrain) {
    p.scene.add(this.root);
  }

  get count(): number {
    return this.all.size;
  }

  /** Spawn a chunk's props (sync for shards; relics arrive when their model loads). */
  spawn(cx: number, cz: number, chunkSeed: number): ChunkProps {
    const cp: ChunkProps = { key: `${cx},${cz}`, props: [], statics: [], alive: true };
    const rng = mulberry32(chunkSeed ^ 0x5bd1e995);
    const shards = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < shards; i++) {
      const id = `${cp.key}:s${i}`;
      const x = cx * CHUNK + rng() * CHUNK;
      const z = cz * CHUNK + rng() * CHUNK;
      if (Math.hypot(x, z) < 3 || !this.terrain.isOpen(x, z)) continue;
      const radius = 0.22 + rng() * 0.25;
      const height = 0.3 + rng() * 0.4;
      const geo = rockGeometry(rng, radius, height);
      const y = this.terrain.floor(x, z) + height / 2 + 0.05;
      const prop = this.makeDynamic(id, geo, (geo.attributes.position as THREE.BufferAttribute).array as Float32Array, x, y, z, rng() * Math.PI * 2, this.p.rockMat, ROCK_DENSITY);
      anchorHatch(this.p, prop.mesh as THREE.Mesh, (rng() - 0.5) * 1.4);
      cp.props.push(prop);
    }
    if (rng() < 0.35) {
      const x = cx * CHUNK + 4 + rng() * (CHUNK - 8);
      const z = cz * CHUNK + 4 + rng() * (CHUNK - 8);
      if (Math.hypot(x, z) > 6 && this.terrain.isOpen(x, z)) {
        const id = PACKED_IDS[Math.floor(rng() * PACKED_IDS.length)]!;
        const yaw = rng() * Math.PI * 2;
        this.plinth(cp, x, z);
        void this.relic(cp, id, x, z, yaw);
      }
    }
    return cp;
  }

  private plinth(cp: ChunkProps, x: number, z: number): void {
    const { R, world } = this.ph;
    const h = 0.5;
    const y = this.terrain.floor(x, z);
    const geo = new THREE.CylinderGeometry(0.55, 0.7, h, 7, 1);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, this.p.rockMat);
    mesh.position.set(x, y, z);
    anchorHatch(this.p, mesh, 0.7);
    this.root.add(mesh);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z));
    const col = world.createCollider(R.ColliderDesc.cylinder(h / 2, 0.62).setFriction(0.9), body);
    cp.statics.push({ body, collider: col });
    cp.props.push({ id: `${cp.key}:plinth`, body, collider: col, mesh, material: null, geometry: geo, dynamic: false, spawn: { x, y, z }, lastV: new THREE.Vector3() });
  }

  private async relic(cp: ChunkProps, id: PackedId, x: number, z: number, yaw: number): Promise<void> {
    const m = await loadPacked(id);
    if (!cp.alive) return;
    const statueH = 0.8;
    const scale = statueH / (m.full.max.y - m.cutMin);
    const centre = new THREE.Vector3();
    m.full.getCenter(centre);
    // Build the statue in a group so the body's origin sits at the statue's
    // centre of mass (roughly mid-height) — a body whose origin is at the
    // feet spins oddly when pushed.
    const carrier = new THREE.Group();
    const material = makeFigureMaterial(this.p);
    setFigureColorway(material, GOLD);
    material.uniforms.uMinY.value = m.full.min.y;
    material.uniforms.uMaxY.value = m.full.max.y;
    const color = new THREE.Mesh(m.geometry, material);
    anchorHatch(this.p, color, 0.3);
    const hull = new THREE.Mesh(m.geometry, this.p.hullMat);
    this.p.ndHidden.add(hull);
    carrier.add(color, hull);
    carrier.scale.setScalar(scale);
    carrier.rotation.y = FACING[id] ?? 0;
    carrier.position.set(-centre.x * scale, -(m.cutMin + (m.full.max.y - m.cutMin) / 2) * scale, -centre.z * scale);
    // Rotate the carrier's offset by its own yaw so the mesh and hull agree.
    carrier.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), FACING[id] ?? 0);
    const holder = new THREE.Group();
    holder.add(carrier);
    // Hull points in holder space: scaled, yawed, offset like the carrier.
    const pts = new Float32Array(m.hull.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < m.hull.length; i += 3) {
      v.set(m.hull[i]!, m.hull[i + 1]!, m.hull[i + 2]!).multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), FACING[id] ?? 0).add(carrier.position);
      pts[i] = v.x; pts[i + 1] = v.y; pts[i + 2] = v.z;
    }
    // Seat the hull's lowest point on the plinth top, so the statue starts at
    // rest instead of dropping (and toppling) on spawn.
    let hullMinY = Infinity;
    for (let i = 1; i < pts.length; i += 3) hullMinY = Math.min(hullMinY, pts[i]!);
    const y = this.terrain.floor(x, z) + 0.5 - hullMinY + 0.01;
    const prop = this.makeDynamic(`${cp.key}:r`, null, pts, x, y, z, yaw, null, GOLD_DENSITY, holder);
    prop.material = material;
    cp.props.push(prop);
  }

  private makeDynamic(
    id: string, geo: THREE.BufferGeometry | null, hullPts: Float32Array, x: number, y: number, z: number, yaw: number,
    material: THREE.Material | null, density: number, mesh?: THREE.Object3D,
  ): Prop {
    const { R, world } = this.ph;
    const half = yaw / 2;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
        .setLinearDamping(0.6).setAngularDamping(0.9),
    );
    const desc = R.ColliderDesc.convexHull(hullPts) ?? R.ColliderDesc.ball(0.3);
    desc.setDensity(density).setFriction(0.8).setRestitution(0.05);
    const collider = world.createCollider(desc, body);
    const obj = mesh ?? new THREE.Mesh(geo!, material!);
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    this.root.add(obj);
    const prop: Prop = { id, body, collider, mesh: obj, material: null, geometry: geo, dynamic: true, spawn: { x, y, z }, lastV: new THREE.Vector3() };
    this.all.add(prop);
    this.byId.set(id, prop);
    return prop;
  }

  /** Copy body transforms into meshes (awake bodies only); detect knocks. */
  update(): void {
    for (const prop of this.all) {
      if (!prop.dynamic || prop.body.isSleeping()) {
        prop.lastV.set(0, 0, 0);
        continue;
      }
      const t = prop.body.translation();
      const r = prop.body.rotation();
      prop.mesh.position.set(t.x, t.y, t.z);
      this.q.set(r.x, r.y, r.z, r.w);
      prop.mesh.quaternion.copy(this.q);
      const v = prop.body.linvel();
      const dv = Math.hypot(v.x - prop.lastV.x, v.y - prop.lastV.y, v.z - prop.lastV.z);
      if (dv > 2.5 && this.onKnock) this.onKnock(dv, t.x, t.y, t.z);
      prop.lastV.set(v.x, v.y, v.z);
    }
  }

  /** States of the dynamic props I am responsible for. `isOwner` decides
   *  ownership by position (nearest player wins). Awake props only unless
   *  `snapshot`, which also includes sleeping props that have moved from
   *  their spawn — sent occasionally so late joiners converge. */
  collectOwned(isOwner: (x: number, z: number) => boolean, snapshot: boolean): PropState[] {
    const out: PropState[] = [];
    for (const prop of this.all) {
      if (!prop.dynamic) continue;
      const t = prop.body.translation();
      if (!isOwner(t.x, t.z)) continue;
      const asleep = prop.body.isSleeping();
      if (asleep) {
        if (!snapshot) continue;
        const moved = Math.hypot(t.x - prop.spawn.x, t.y - prop.spawn.y, t.z - prop.spawn.z) > 0.05;
        if (!moved) continue;
      }
      const r = prop.body.rotation();
      const v = prop.body.linvel();
      const w = prop.body.angvel();
      out.push({ k: prop.id, p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] });
    }
    return out;
  }

  /** Take a peer's states for props THEY own (nearest to them, not me). */
  apply(states: PropState[], isOwner: (x: number, z: number) => boolean): void {
    for (const s of states) {
      const prop = this.byId.get(s.k);
      if (!prop || !prop.dynamic) continue;
      if (isOwner(s.p[0], s.p[2])) continue; // mine — my simulation is the truth
      prop.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
      prop.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
      prop.body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
      prop.body.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
    }
  }

  dispose(cp: ChunkProps): void {
    cp.alive = false;
    for (const prop of cp.props) {
      this.all.delete(prop);
      this.byId.delete(prop.id);
      this.root.remove(prop.mesh);
      prop.mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.p.ndHidden.delete(o); });
      prop.geometry?.dispose();
      if (prop.material) disposeFigureMaterial(this.p, prop.material);
      if (!cp.statics.some((s) => s.body === prop.body)) {
        this.ph.world.removeCollider(prop.collider, false);
        this.ph.world.removeRigidBody(prop.body);
      }
    }
    for (const s of cp.statics) {
      this.ph.world.removeCollider(s.collider, false);
      this.ph.world.removeRigidBody(s.body);
    }
  }
}
