import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { anchorHatch, makeFigureMaterial, disposeFigureMaterial, setFigureColorway, type Pipeline } from "../render/pipeline";
import type { Physics } from "../physics/world";
import { CHUNK, Terrain, rockGeometry, boulderGeometry, vaultDoorway, type Level, type Vault, type VaultDoorway, type BoulderSite } from "./terrain";
import { mulberry32 } from "./noise";
import { loadPacked, PACKED_IDS, type PackedId } from "./models";
import { FACING } from "../player/figure";
import { COLORWAYS } from "../render/palette";
import { buildGolem, type GolemKind } from "../player/golems";
import { stlEnabled } from "./settings";
import { CFG } from "./config";

const GOLEM_KINDS: GolemKind[] = ["cairn", "shard", "menhir", "spire", "dolmen", "castle", "totem", "wisp", "hound"];

/**
 * Things you can push. Dynamic Rapier bodies with meshes that follow them:
 *  - SHARDS: fist-to-knee sized rock, scattered per chunk, light enough to
 *    kick along and heavy enough to feel like rock.
 *  - RELICS: a miniature (Bast / Rook / Cam) in gold leaf on a stone plinth.
 *    The statue is a dynamic body — walk into it and it topples and slides.
 * Props are shared: the nearest player owns a prop's simulation and
 * broadcasts it (see collectOwned / apply); everyone else follows.
 */

/** Rapier density is kg/m³. Shards are deliberately light (pumice, not
 *  granite) so a throw actually flies; statues are heavy enough to carry
 *  but not to hurl. */
const ROCK_DENSITY = 800;
const GOLD_DENSITY = 6000;
/** A boulder that takes two: dense enough (with the size below) that one
 *  player's push (character mass 85 kg, `setApplyImpulsesToDynamicBodies`
 *  in `PlayerController`) barely budges it, but two pushing/handing off
 *  ownership between them (see `main.ts`'s distance-based `isOwner`) move it
 *  for real. Tuned in-browser by measuring actual displacement (see
 *  `docs/PLAN.md`) rather than guessed — a fixed constant like `ROCK_DENSITY`
 *  itself, not a live slider, since it's a physical constant tuned once. */
const BOULDER_DENSITY = 400;

export type Prop = {
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

export type ChunkProps = { key: string; props: Prop[]; statics: Array<{ body: RAPIER.RigidBody; collider: RAPIER.Collider }>; alive: boolean; torches: string[]; vaults: string[] };

/** A standing torch: a light that prints the rock around it. `life`/`maxLife`
 *  (seconds) are only meaningful when `placed` — world/shrine torches carry
 *  `maxLife: Infinity` and are never ticked down. */
export type TorchProp = { id: string; position: THREE.Vector3; reach: number; mesh: THREE.Group; placed: boolean; life: number; maxLife: number };
export const TORCH_REACH = 15;

const GOLD = COLORWAYS.findIndex((c) => c.name === "Gold Leaf");

export class Props {
  private readonly all = new Set<Prop>();
  private readonly byId = new Map<string, Prop>();
  private readonly byCollider = new Map<number, Prop>();
  /** Ids of props currently carried by THIS client (always owned). */
  readonly heldIds = new Set<string>();
  readonly root = new THREE.Group();
  private readonly q = new THREE.Quaternion();
  /** Fired with the velocity change (m/s) when an awake prop is knocked. */
  onKnock: ((impact: number, x: number, y: number, z: number) => void) | null = null;
  /** Every torch in the world right now (shrines + placed), by id. */
  readonly torches = new Map<string, TorchProp>();
  private torchMat: THREE.ShaderMaterial | null = null;
  /** Every currently-loaded vault's doorway geometry, by vault id — main.ts
   *  checks these each frame against `placedTorches()`. */
  readonly vaultDoors = new Map<string, VaultDoorway>();

  constructor(private readonly p: Pipeline, private readonly ph: Physics, private readonly terrain: Terrain) {
    p.scene.add(this.root);
  }

  get count(): number {
    return this.all.size;
  }

  /** Spawn a chunk's props on every level (sync for shards; relics arrive
   *  when their model loads). Level 2 (the lower cave) gets the full set;
   *  levels 1 (galleries) and 0 (the surface) get a lighter one — see
   *  `spawnLevel`. */
  spawn(cx: number, cz: number, chunkSeed: number): ChunkProps {
    const cp: ChunkProps = { key: `${cx},${cz}`, props: [], statics: [], alive: true, torches: [], vaults: [] };
    for (const level of [2, 1, 0] as Level[]) this.spawnLevel(cp, cx, cz, chunkSeed, level);
    // Two-torch vault(s) whose ~36 m site lands in this chunk (lower cave only).
    for (const v of this.terrain.vaultsInChunk(cx, cz)) this.addVault(cp, v);
    // Boulder site(s) whose ~40 m site lands in this chunk (lower cave only).
    for (const b of this.terrain.boulderSitesInChunk(cx, cz)) this.addBoulder(cp, b);
    return cp;
  }

  /** One level's shards/shrine/relic set, seated on `terrain.levelAt(level,
   *  x, z)`. Level 2 is the baseline (lower cave, density ×1, may use an
   *  STL relic); levels 1 and 0 scale shard count and shrine/relic chance by
   *  `CFG.world.propUpperDensity` (< 1, a lighter set) and skip STL relics
   *  in favour of the cheaper procedural golem statue, per the brief's
   *  "lighter set" on the surface and in galleries. Ids are tagged with the
   *  level so the three sets never collide within one chunk. */
  private spawnLevel(cp: ChunkProps, cx: number, cz: number, chunkSeed: number, level: Level): void {
    const rng = mulberry32(chunkSeed ^ (level === 1 ? 0x1b873593 : level === 0 ? 0x85ebca6b : 0x5bd1e995));
    const density = level === 2 ? 1 : CFG.world.propUpperDensity;
    const tag = level === 2 ? "" : `L${level}:`;
    const openHere = (x: number, z: number): boolean =>
      level === 2 ? this.terrain.isOpen(x, z) : level === 1 ? this.terrain.isUpperOpen(x, z) : true;

    const shards = Math.round((2 + Math.floor(rng() * 4)) * density);
    for (let i = 0; i < shards; i++) {
      const id = `${cp.key}:${tag}s${i}`;
      const x = cx * CHUNK + rng() * CHUNK;
      const z = cz * CHUNK + rng() * CHUNK;
      if (Math.hypot(x, z) < 3 || !openHere(x, z)) continue;
      const radius = (0.22 + rng() * 0.25) * (level === 2 ? 1 : 0.8);
      const height = (0.3 + rng() * 0.4) * (level === 2 ? 1 : 0.8);
      const geo = rockGeometry(rng, radius, height);
      const y = this.terrain.levelAt(level, x, z) + height / 2 + 0.05;
      const prop = this.makeDynamic(id, geo, (geo.attributes.position as THREE.BufferAttribute).array as Float32Array, x, y, z, rng() * Math.PI * 2, this.p.rockMat, ROCK_DENSITY);
      anchorHatch(this.p, prop.mesh as THREE.Mesh, (rng() - 0.5) * 1.4);
      cp.props.push(prop);
    }
    // A shrine: a standing torch that lights its room, in about one chunk in five (scaled).
    if (rng() < 0.2 * density) {
      const x = cx * CHUNK + 3 + rng() * (CHUNK - 6);
      const z = cz * CHUNK + 3 + rng() * (CHUNK - 6);
      if (Math.hypot(x, z) > 8 && openHere(x, z)) {
        const id = `${cp.key}:${tag}shrine`;
        this.addTorch(id, x, this.terrain.levelAt(level, x, z), z, false);
        cp.torches.push(id);
      }
    }
    if (rng() < 0.35 * density) {
      const x = cx * CHUNK + 4 + rng() * (CHUNK - 8);
      const z = cz * CHUNK + 4 + rng() * (CHUNK - 8);
      if (Math.hypot(x, z) > 6 && openHere(x, z)) {
        const yaw = rng() * Math.PI * 2;
        this.plinth(cp, x, z, `${cp.key}:${tag}plinth`, level);
        const plinthTop = (level === 2 ? this.terrain.floor(x, z) : this.terrain.levelAt(level, x, z)) + 0.5;
        if (level === 2 && stlEnabled() && rng() < 0.4) {
          void this.relic(cp, PACKED_IDS[Math.floor(rng() * PACKED_IDS.length)]!, x, z, yaw);
        } else {
          const kind = GOLEM_KINDS[Math.floor(rng() * GOLEM_KINDS.length)]!;
          this.golemRelic(cp, kind, Math.floor(rng() * 1e6), x, z, yaw, plinthTop, `${cp.key}:${tag}r`);
        }
      }
    }
  }

  /** The torch mesh: a leaning stake with a spiked flame, in the figure inks
   *  (acid yellow) so it reads as light even before its tone does. */
  private torchMesh(): THREE.Group {
    if (!this.torchMat) {
      this.torchMat = makeFigureMaterial(this.p);
      setFigureColorway(this.torchMat, COLORWAYS.findIndex((c) => c.name === "Riso Dungeon"));
      this.torchMat.uniforms.uMinY.value = 0;
      this.torchMat.uniforms.uMaxY.value = 1.6;
    }
    const g = new THREE.Group();
    const stake = new THREE.CylinderGeometry(0.035, 0.05, 1.1, 5);
    stake.translate(0, 0.55, 0);
    const flame = rockGeometry(mulberry32(3), 0.14, 0.5);
    flame.translate(0, 1.32, 0);
    for (const geo of [stake, flame]) {
      const m = new THREE.Mesh(geo, this.torchMat);
      anchorHatch(this.p, m, 0.9);
      g.add(m);
      const hull = new THREE.Mesh(geo, this.p.hullMat);
      this.p.ndHidden.add(hull);
      g.add(hull);
    }
    g.rotation.z = 0.12;
    return g;
  }

  /** Add a torch (shrine or placed). Idempotent by id. */
  addTorch(id: string, x: number, y: number, z: number, placed: boolean): TorchProp {
    const existing = this.torches.get(id);
    if (existing) return existing;
    const mesh = this.torchMesh();
    mesh.position.set(x, y, z);
    mesh.rotation.y = (x * 7 + z * 3) % 6.28;
    this.root.add(mesh);
    const maxLife = placed ? CFG.world.torchLifeSec : Infinity;
    const t: TorchProp = { id, position: new THREE.Vector3(x, y + 1.35, z), reach: TORCH_REACH, mesh, placed, life: maxLife, maxLife };
    this.torches.set(id, t);
    return t;
  }

  removeTorch(id: string): void {
    const t = this.torches.get(id);
    if (!t) return;
    this.root.remove(t.mesh);
    t.mesh.traverse((o) => this.p.ndHidden.delete(o));
    this.torches.delete(id);
  }

  /** Placed torches (mine or peers'), for the wire. */
  placedTorches(): TorchProp[] {
    return [...this.torches.values()].filter((t) => t.placed);
  }

  /** Every dynamic prop, for main.ts's per-frame proximity/impact checks (a
   *  thrown prop passing close to the local player — brief 19). */
  dynamicProps(): Prop[] {
    return [...this.all].filter((p) => p.dynamic);
  }

  /** Drop a golden relic right here (debug / spawn button). */
  spawnRelicAt(x: number, z: number): void {
    const key = `spawn:${Date.now()}`;
    const cp: ChunkProps = { key, props: [], statics: [], alive: true, torches: [], vaults: [] };
    const kind = GOLEM_KINDS[Math.floor(Math.random() * GOLEM_KINDS.length)]!;
    this.golemRelic(cp, kind, Math.floor(Math.random() * 1e6), x, z, Math.random() * Math.PI * 2, this.terrain.floorAt(x, z) - 0.5);
    this.loose.push(cp);
  }
  private readonly loose: ChunkProps[] = [];

  /** Remove one prop (a collected relic) by id, wherever it lives. */
  removeById(id: string): boolean {
    const prop = this.byId.get(id);
    if (!prop) return false;
    this.heldIds.delete(id);
    this.all.delete(prop);
    this.byId.delete(id);
    this.byCollider.delete(prop.collider.handle);
    this.root.remove(prop.mesh);
    prop.mesh.traverse((o) => this.p.ndHidden.delete(o));
    if (prop.material) disposeFigureMaterial(this.p, prop.material);
    this.ph.world.removeCollider(prop.collider, false);
    this.ph.world.removeRigidBody(prop.body);
    return true;
  }

  private plinth(cp: ChunkProps, x: number, z: number, id = `${cp.key}:plinth`, level: Level = 2): void {
    const { R, world } = this.ph;
    const h = 0.5;
    const y = level === 2 ? this.terrain.floor(x, z) : this.terrain.levelAt(level, x, z);
    const geo = new THREE.CylinderGeometry(0.55, 0.7, h, 7, 1);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, this.p.rockMat);
    mesh.position.set(x, y, z);
    anchorHatch(this.p, mesh, 0.7);
    this.root.add(mesh);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z));
    const col = world.createCollider(R.ColliderDesc.cylinder(h / 2, 0.62).setFriction(0.9), body);
    cp.statics.push({ body, collider: col });
    cp.props.push({ id, body, collider: col, mesh, material: null, geometry: geo, dynamic: false, spawn: { x, y, z }, lastV: new THREE.Vector3() });
  }

  /** A standing stone post — a vault's door pillars, and anything else that
   *  wants a shrine-like marker without a torch on it. */
  private pillar(cp: ChunkProps, id: string, x: number, z: number): void {
    const { R, world } = this.ph;
    const h = 1.6;
    const y = this.terrain.floor(x, z);
    const geo = new THREE.CylinderGeometry(0.16, 0.26, h, 6, 1);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, this.p.rockMat);
    mesh.position.set(x, y, z);
    anchorHatch(this.p, mesh, 0.5);
    this.root.add(mesh);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z));
    const col = world.createCollider(R.ColliderDesc.cylinder(h / 2, 0.22).setFriction(0.9), body);
    cp.statics.push({ body, collider: col });
    cp.props.push({ id, body, collider: col, mesh, material: null, geometry: geo, dynamic: false, spawn: { x, y, z }, lastV: new THREE.Vector3() });
  }

  /** A sealed vault: door pillars flank the (still walled) threshold, and a
   *  golem relic waits inside on its own plinth. The wall itself is baked
   *  into `terrain.floor` (a ring); opening it is main.ts's job — it digs
   *  the door cells like any other tunnel once two torches stand by the
   *  pillars, which the existing dig-replay carries to late joiners. */
  private addVault(cp: ChunkProps, v: Vault): void {
    const doorway = vaultDoorway(v);
    this.vaultDoors.set(v.id, doorway);
    cp.vaults.push(v.id);
    this.pillar(cp, `${v.id}:pa`, doorway.pillarA.x, doorway.pillarA.z);
    this.pillar(cp, `${v.id}:pb`, doorway.pillarB.x, doorway.pillarB.z);
    this.plinth(cp, v.cx, v.cz, `${v.id}:plinth`);
    const kind = GOLEM_KINDS[Math.floor(v.relicKindRng * GOLEM_KINDS.length)]!;
    this.golemRelic(cp, kind, v.relicSeed, v.cx, v.cz, v.doorAngle + Math.PI, undefined, `${v.id}:r`);
  }

  /** A big, heavy, round boulder — see `boulderGeometry` in terrain.ts for
   *  why it's a dome, not `rockGeometry`'s cone. `PlayerController`'s wall
   *  climb / mantle rays (see `notDynamic` there) already skip every dynamic
   *  prop, so this doesn't need to dodge a specific height band the way an
   *  earlier attempt did — it just needs to physically block a walking
   *  player, which the dome shape does on its own once big enough (see the
   *  comment on `boulderGeometry`). See `BOULDER_DENSITY` for the mass
   *  tuning. */
  private addBoulder(cp: ChunkProps, site: BoulderSite): void {
    let h = 0;
    for (let i = 0; i < site.id.length; i++) h = (h * 31 + site.id.charCodeAt(i)) | 0;
    const rng = mulberry32(h);
    const radius = 1.5 + rng() * 0.4;
    const height = radius * (0.85 + rng() * 0.25);
    const geo = boulderGeometry(rng, radius, height);
    const y = this.terrain.floor(site.x, site.z) + 0.05;
    const id = `boulder:${site.id}`;
    const prop = this.makeDynamic(
      id, geo, (geo.attributes.position as THREE.BufferAttribute).array as Float32Array,
      site.x, y, site.z, site.yaw, this.p.rockMat, BOULDER_DENSITY,
    );
    anchorHatch(this.p, prop.mesh as THREE.Mesh, (rng() - 0.5) * 1.4);
    cp.props.push(prop);
  }

  /** A miniature of one of the cave's own characters, in gold, on the plinth. */
  private golemRelic(cp: ChunkProps, kind: GolemKind, seed: number, x: number, z: number, yaw: number, plinthTop?: number, id = `${cp.key}:r`): void {
    const geo = buildGolem(kind, seed);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const statueH = 0.8;
    const scale = statueH / (bb.max.y - bb.min.y);
    const centre = new THREE.Vector3();
    bb.getCenter(centre);
    const material = makeFigureMaterial(this.p);
    setFigureColorway(material, GOLD);
    material.uniforms.uMinY.value = bb.min.y;
    material.uniforms.uMaxY.value = bb.max.y;
    const color = new THREE.Mesh(geo, material);
    anchorHatch(this.p, color, 0.3);
    const hull = new THREE.Mesh(geo, this.p.hullMat);
    this.p.ndHidden.add(hull);
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
    const holder = new THREE.Group();
    holder.add(carrier);
    // Sparse hull points in holder space.
    const src = geo.attributes.position as THREE.BufferAttribute;
    const pts: number[] = [];
    for (let i = 0; i < src.count; i += 7) {
      pts.push((src.getX(i) - centre.x) * scale, (src.getY(i) - centre.y) * scale, (src.getZ(i) - centre.z) * scale);
    }
    const arr = new Float32Array(pts);
    let hullMinY = Infinity;
    for (let i = 1; i < arr.length; i += 3) hullMinY = Math.min(hullMinY, arr[i]!);
    const y = (plinthTop ?? this.terrain.floorAt(x, z)) + 0.5 - hullMinY + 0.01;
    const prop = this.makeDynamic(id, geo, arr, x, y, z, yaw, null, GOLD_DENSITY, holder);
    prop.material = material;
    cp.props.push(prop);
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
    this.byCollider.set(collider.handle, prop);
    return prop;
  }

  fromCollider(handle: number): Prop | undefined {
    return this.byCollider.get(handle);
  }

  /** Pick up: the body follows the hand kinematically until dropped. */
  hold(prop: Prop): void {
    prop.body.setBodyType(this.ph.R.RigidBodyType.KinematicPositionBased, true);
    this.heldIds.add(prop.id);
  }

  /** Let go with a velocity (a throw, or the carrier's own motion). */
  drop(prop: Prop, vel: { x: number; y: number; z: number }): void {
    prop.body.setBodyType(this.ph.R.RigidBodyType.Dynamic, true);
    prop.body.setLinvel(vel, true);
    prop.body.setAngvel({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
    prop.lastV.set(vel.x, vel.y, vel.z);
    this.heldIds.delete(prop.id);
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
      const held = this.heldIds.has(prop.id);
      if (!held && !isOwner(t.x, t.z)) continue;
      const asleep = !held && prop.body.isSleeping();
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
      if (this.heldIds.has(s.k) || isOwner(s.p[0], s.p[2])) continue; // mine — my simulation is the truth
      prop.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
      prop.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
      prop.body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
      prop.body.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
    }
  }

  dispose(cp: ChunkProps): void {
    cp.alive = false;
    for (const id of cp.torches) this.removeTorch(id);
    for (const id of cp.vaults) this.vaultDoors.delete(id);
    for (const prop of cp.props) {
      this.all.delete(prop);
      this.byId.delete(prop.id);
      this.byCollider.delete(prop.collider.handle);
      this.heldIds.delete(prop.id);
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
