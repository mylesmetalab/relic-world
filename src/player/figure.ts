import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { anchorHatch, disposeFigureMaterial, makeFigureMaterial, setFigureColorway, type Pipeline } from "../render/pipeline";
import { loadPacked, type PackedId } from "../world/models";
import { buildGolem, GOLEM_MOTION, type GolemKind } from "./golems";
import { stlEnabled } from "../world/settings";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../world/noise";
import { rockGeometry } from "../world/terrain";

/**
 * A figure — the player's body, or another player's. Two kinds:
 *  - PACKED: one of the miniatures (Bast, Rook, Cam), base disc cut off,
 *    normalised to height, feet at the origin.
 *  - GOLEM: a procedural stack of the cave's own jagged rocks, seeded, so
 *    every golem is a different heap. Rig-free "miniatures" for now — they
 *    turn to face their motion and bob when walking (plan M5).
 * Each figure owns its zone material so players can wear different inks.
 */

export const CHARACTERS = [
  { id: "bast", name: "Bast" },
  { id: "rook", name: "Rook" },
  { id: "cam", name: "Cam" },
  { id: "golem-cairn", name: "Cairn" },
  { id: "golem-shard", name: "Shard" },
  { id: "golem-menhir", name: "Menhir" },
  { id: "golem-spire", name: "Spire" },
  { id: "golem-dolmen", name: "Dolmen" },
  { id: "golem-castle", name: "Castle" },
  { id: "golem-totem", name: "Totem" },
  { id: "golem-wisp", name: "Wisp" },
  { id: "golem-hound", name: "Hound" },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]["id"];

/** The cast you can cycle through: the cave's own characters, plus the STL
 *  miniatures only when that toggle is on. */
export function availableCharacters(): ReadonlyArray<(typeof CHARACTERS)[number]> {
  return stlEnabled() ? CHARACTERS : CHARACTERS.filter((c) => c.id.startsWith("golem-"));
}

/** Old saves / old builds used golem-1..3. */
export function normaliseCharacter(id: string): CharacterId {
  const legacy: Record<string, CharacterId> = { "golem-1": "golem-cairn", "golem-2": "golem-shard", "golem-3": "golem-menhir" };
  if (legacy[id]) return legacy[id]!;
  return (CHARACTERS.some((c) => c.id === id) ? id : "golem-cairn") as CharacterId;
}

/** Yaw (radians) that turns each packed figure to face +z in its own frame. */
export const FACING: Record<string, number> = { bast: (95 * Math.PI) / 180, rook: (72 * Math.PI) / 180, cam: Math.PI / 2 };

/** Deterministic string hash — same character id always builds the same limbs. */
function strHash(s: string): number {
  let h = 13;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** How wide the hull is (max |x|) among vertices near height `y`, in the
 *  mesh's own local units. Falls back when the slice misses every vertex. */
function hullHalfWidthAt(geometry: THREE.BufferGeometry, y: number, band: number, fallback: number): number {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  let w = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - y) > band) continue;
    w = Math.max(w, Math.abs(pos.getX(i)));
  }
  return w > 0.02 ? w : fallback;
}

/** Default motion flavour for packed figures and dropped-in STL. */
const DEFAULT_MOTION = { bob: 0.06, lean: 0.035, float: 0, armLen: 0.46, armSwing: 0.8 };

export class Figure {
  readonly group = new THREE.Group();
  private readonly inner = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private facing = 0;
  private bob = 0;
  private motion = { ...DEFAULT_MOTION };
  /** Fired on each footfall while walking (audio hook). */
  onStep: (() => void) | null = null;
  /** Only golem geometry is owned; packed geometry is shared via models.ts. */
  private ownedGeometry: THREE.BufferGeometry | null = null;
  hull: THREE.Mesh | null = null;
  character: CharacterId = "bast";
  /** Height of the figure in metres (for the chat bubble anchor). */
  height = 1.7;
  /** Leg pivots (golems only) — swing with the walk. */
  private legs: THREE.Group[] = [];
  /** Arm pivots (every figure but the hound) — swing opposite the legs,
   *  reach forward when `reaching`, flail when `flail`. */
  private arms: THREE.Group[] = [];
  /** Flail while carried. */
  flail = false;
  /** Reach forward — holding a prop, or carrying another player. */
  reaching = false;
  /** Seconds left of an active dig swing (arms[0]); see `swing()`. */
  private swingT = 0;
  private swingDur = 0.3;

  constructor(private readonly p: Pipeline) {
    this.material = makeFigureMaterial(p);
    this.group.add(this.inner);
    p.scene.add(this.group);
  }

  setColorway(index: number): number {
    setFigureColorway(this.material, index);
    return this.material.userData.colorway as number;
  }
  get colorway(): number {
    return this.material.userData.colorway as number;
  }

  async load(id: CharacterId, height: number): Promise<void> {
    this.character = id;
    this.height = height;
    let geometry: THREE.BufferGeometry;
    let cutMin: number;
    let full: THREE.Box3;
    let owned: THREE.BufferGeometry | null = null;
    this.legs = [];
    if (id.startsWith("golem-")) {
      const kind = id.slice(6) as GolemKind;
      let h = 13;
      for (const ch of kind) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      geometry = buildGolem(kind, h);
      // Legs: the body rides on pivoting rock stumps (four for the hound).
      const legLen = kind === "hound" ? 0.3 : 0.36;
      geometry.translate(0, legLen * 0.85, 0);
      geometry.computeBoundingBox();
      full = geometry.boundingBox!.clone();
      full.min.y = 0;
      cutMin = 0;
      owned = geometry;
      this.motion = GOLEM_MOTION[kind];
      const rng = mulberry32(h ^ 0x51ed);
      const spots: Array<[number, number]> = kind === "hound" ? [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]] : [[-0.16, 0], [0.16, 0]];
      for (const [lx, lz] of spots) {
        const g = rockGeometry(rng, 0.075 + rng() * 0.03, legLen);
        g.translate(0, -legLen / 2, 0); // hangs from the pivot
        const pivot = new THREE.Group();
        pivot.position.set(lx, legLen * 0.95, lz);
        const leg = new THREE.Mesh(g, this.material);
        anchorHatch(this.p, leg, 0.2);
        const hull = new THREE.Mesh(g, this.p.hullMat);
        this.p.ndHidden.add(hull);
        pivot.add(leg, hull);
        pivot.userData.geo = g;
        this.legs.push(pivot);
      }
    } else {
      this.motion = { ...DEFAULT_MOTION };
      const m = await loadPacked(id as PackedId);
      if (this.character !== id) return; // superseded while loading
      geometry = m.geometry;
      full = m.full;
      cutMin = m.cutMin;
    }
    this.arms = this.buildArms(geometry, full, cutMin, height, this.motion.armLen, strHash(id) ^ 0x4a12);
    const scale = height / (full.max.y - cutMin);
    const centre = new THREE.Vector3();
    full.getCenter(centre);

    this.inner.clear();
    if (this.hull) this.p.ndHidden.delete(this.hull);
    this.ownedGeometry?.dispose();
    this.ownedGeometry = owned;
    const color = new THREE.Mesh(geometry, this.material);
    anchorHatch(this.p, color, 0);
    const hull = new THREE.Mesh(geometry, this.p.hullMat);
    this.p.ndHidden.add(hull);
    this.hull = hull;
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    for (const leg of this.legs) carrier.add(leg);
    for (const arm of this.arms) carrier.add(arm);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -cutMin * scale, -centre.z * scale);
    carrier.rotation.y = FACING[id] ?? 0;
    this.inner.add(carrier);
    this.material.uniforms.uMinY.value = full.min.y;
    this.material.uniforms.uMaxY.value = full.max.y;
  }

  /** Two arm pivots either side of the shoulder line (hull width sampled at
   *  0.72 × height); zero `armLen` (the hound) builds none. Same rock-cone
   *  recipe and material as the legs — no new shader. */
  private buildArms(geometry: THREE.BufferGeometry, full: THREE.Box3, cutMin: number, height: number, armLen: number, seed: number): THREE.Group[] {
    if (armLen <= 0) return [];
    const shoulderY = cutMin + 0.72 * (full.max.y - cutMin);
    const halfW = hullHalfWidthAt(geometry, shoulderY, 0.15, 0.18 * (full.max.y - cutMin));
    const rng = mulberry32(seed);
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const g = rockGeometry(rng, 0.05 + rng() * 0.02, armLen);
      g.translate(0, -armLen / 2, 0); // hangs from the pivot
      const pivot = new THREE.Group();
      pivot.position.set(side * (halfW + 0.03), shoulderY, 0);
      const arm = new THREE.Mesh(g, this.material);
      anchorHatch(this.p, arm, 0.2);
      const armHull = new THREE.Mesh(g, this.p.hullMat);
      this.p.ndHidden.add(armHull);
      pivot.add(arm, armHull);
      pivot.userData.geo = g;
      arms.push(pivot);
    }
    return arms;
  }

  /** Trigger a lead-arm ("arms[0]") dig swing: an eased windup-then-strike
   *  arc, active for `ms` (default 300) of `update()` calls. Takes priority
   *  over `reaching` (a dig mid-carry still shows the swing) but loses to
   *  `flail` (being carried while digging is an edge case — flail wins).
   *  No-op if this figure has no arms (the golem Hound, per `GOLEM_MOTION`). */
  swing(ms = 300): void {
    if (this.arms.length === 0) return;
    this.swingDur = ms / 1000;
    this.swingT = this.swingDur;
  }

  /** Windup (raise back) → strike (fast forward swing, peaking early since
   *  the dig itself lands the moment `swing()` is called) → settle back to
   *  neutral. `frac` runs 0 → 1 over the swing's duration. */
  private swingArc(frac: number): number {
    if (frac < 0.3) {
      const u = frac / 0.3;
      return 0.6 * u * (2 - u); // ease-out quad, 0 → 0.6
    }
    if (frac < 0.55) {
      const u = (frac - 0.3) / 0.25;
      const e = u * u * (3 - 2 * u); // smoothstep, 0.6 → -1.6 (the strike)
      return 0.6 - 2.2 * e;
    }
    const u = Math.min(1, (frac - 0.55) / 0.45);
    return -1.6 + 1.6 * (1 - (1 - u) * (1 - u)); // ease-out, -1.6 → 0
  }

  /** Place at the feet, turn toward `heading` (world xz, may be zero), bob with speed. */
  update(feet: THREE.Vector3, heading: THREE.Vector3, speed: number, dt: number): void {
    if (heading.lengthSq() > 1e-4) {
      const want = Math.atan2(heading.x, heading.z);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
    }
    const prevPhase = Math.floor(this.bob / Math.PI);
    this.bob += speed * dt * 2.2;
    if (speed > 0.3 && Math.floor(this.bob / Math.PI) !== prevPhase) this.onStep?.();
    const m = this.motion;
    const lift = (speed > 0.3 ? Math.abs(Math.sin(this.bob)) * m.bob : 0) + m.float * (0.6 + 0.4 * Math.sin(this.bob * 0.35 + performance.now() * 0.0012));
    this.group.position.set(feet.x, feet.y + lift, feet.z);
    this.group.rotation.y = this.facing;
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    if (this.flail) {
      const t = performance.now() * 0.012;
      this.inner.rotation.z = Math.sin(t) * 0.5;
      this.inner.rotation.x = Math.cos(t * 0.7) * 0.35;
      this.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 1.6 + i * 2) * 1.1; });
      this.arms.forEach((arm, i) => {
        arm.rotation.x = Math.sin(t * 1.6 + i * 2 + Math.PI) * 1.2;
        arm.rotation.z = Math.sin(t * 1.3 + i) * 0.6;
      });
      return;
    }
    this.inner.rotation.x = 0;
    this.inner.rotation.z = speed > 0.3 ? Math.sin(this.bob) * m.lean : 0;
    // Legs swing in opposition, more with speed.
    const swing = Math.min(1, speed / 4) * 0.8;
    this.legs.forEach((leg, i) => {
      const phase = this.legs.length === 4 ? (i === 0 || i === 3 ? 0 : Math.PI) : i * Math.PI;
      leg.rotation.x = Math.sin(this.bob + phase) * swing;
    });
    // Arms swing opposite the legs; reach forward holding a prop or carrying;
    // a dig swing overrides the lead arm (arms[0]) over either of those.
    const armSwing = Math.min(1, speed / 4) * m.armSwing;
    this.arms.forEach((arm, i) => {
      if (i === 0 && this.swingT > 0) {
        arm.rotation.x = this.swingArc(1 - this.swingT / this.swingDur);
        arm.rotation.z = 0;
      } else if (this.reaching) {
        arm.rotation.x = -1.3;
        arm.rotation.z = (i === 0 ? -1 : 1) * 0.12;
      } else {
        arm.rotation.x = Math.sin(this.bob + i * Math.PI + Math.PI) * armSwing;
        arm.rotation.z = 0;
      }
    });
  }

  /** Wear a dropped .stl: welded, Z-up → Y-up, base cut, normalised to height.
   *  Local only — peers see your last built-in character. */
  loadCustom(buffer: ArrayBuffer, height: number): void {
    const raw = new STLLoader().parse(buffer);
    const geometry = mergeVertices(raw, 1e-4);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingBox();
    const full = geometry.boundingBox!.clone();
    const size = new THREE.Vector3();
    full.getSize(size);
    const cutY = full.min.y + size.y * 0.07;
    const idx = geometry.index!.array;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const kept: number[] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
      if (pos.getY(a) < cutY && pos.getY(b) < cutY && pos.getY(c) < cutY) continue;
      kept.push(a, b, c);
    }
    geometry.setIndex(kept);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const cutMin = geometry.boundingBox!.min.y;
    this.motion = { ...DEFAULT_MOTION };
    this.arms = this.buildArms(geometry, full, cutMin, height, this.motion.armLen, strHash("custom-stl") ^ 0x4a12);
    const scale = height / (full.max.y - cutMin);
    const centre = new THREE.Vector3();
    full.getCenter(centre);
    this.inner.clear();
    if (this.hull) this.p.ndHidden.delete(this.hull);
    this.ownedGeometry?.dispose();
    this.ownedGeometry = geometry;
    this.height = height;
    const color = new THREE.Mesh(geometry, this.material);
    anchorHatch(this.p, color, 0);
    const hull = new THREE.Mesh(geometry, this.p.hullMat);
    this.p.ndHidden.add(hull);
    this.hull = hull;
    const carrier = new THREE.Group();
    carrier.add(color, hull);
    for (const arm of this.arms) carrier.add(arm);
    carrier.scale.setScalar(scale);
    carrier.position.set(-centre.x * scale, -cutMin * scale, -centre.z * scale);
    this.inner.add(carrier);
    this.material.uniforms.uMinY.value = full.min.y;
    this.material.uniforms.uMaxY.value = full.max.y;
  }

  /** Direct placement (remote players: interpolated elsewhere). */
  place(feet: THREE.Vector3, facing: number): void {
    this.group.position.copy(feet);
    this.facing = facing;
    this.group.rotation.y = facing;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.p.scene.remove(this.group);
    if (this.hull) this.p.ndHidden.delete(this.hull);
    this.ownedGeometry?.dispose();
    for (const leg of this.legs) (leg.userData.geo as THREE.BufferGeometry | undefined)?.dispose();
    for (const arm of this.arms) (arm.userData.geo as THREE.BufferGeometry | undefined)?.dispose();
    disposeFigureMaterial(this.p, this.material);
  }
}
