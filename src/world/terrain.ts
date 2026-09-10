import * as THREE from "three";
import { Simplex2, clamp, hash3, lerp, mulberry32, smoothstep } from "./noise";
import { BIOMES, biomeAt, biomeIdAt, type Biome } from "./biomes";
import { CFG } from "./config";

/**
 * The world as stacked height fields.
 *
 *   level 0 — the SURFACE. Bare paper under a paper sky; you start here and
 *             dig down.
 *   level 1 — GALLERIES: where a gallery field says so, the lower cave's
 *             ceiling is a slab whose top is another floor with its own
 *             ceiling. Shafts drop through; gallery edges ramp down as cliffs.
 *   level 2 — the LOWER CAVE. `floor` is the walkable surface; solidity lifts
 *             it to the ceiling to make walls and pillars.
 *
 * Every level is one heightfield per chunk, so every level is walkable and
 * diggable. Digging is a per-vertex depth map per level; dig deeper than the
 * slab and the level "breaks through" to the one below — that is how you get
 * from the surface into the caves.
 */

/** Slab between the lower cave's ceiling and the gallery floor above it —
 *  three digs' worth, so breaking through is a decision, not a click. */
export const SLAB = 1.8;
export const CHUNK = 24; // metres per chunk
export const CELLS = 24; // cells per chunk edge (1 m)
/** Rooms open up around the spawn column so you never start inside a wall. */
const SPAWN_CLEAR = 9;
export type Level = 0 | 1 | 2;

/** ~36 m grid of candidate two-torch-door vault sites (see `Terrain.vault`). */
const VAULT_GRID = 36;
const VAULT_CHANCE = 0.3;

export type Vault = {
  id: string; cx: number; cz: number; doorAngle: number;
  /** 0..1 draw for which golem kind sits inside, and its shape seed. */
  relicKindRng: number; relicSeed: number;
};

/** Where a vault's ring wall opens, and where its two door pillars stand
 *  (just outside the ring, flanking the threshold). Pure function of the
 *  vault, so terrain, props and the open-door check all agree on it. */
export type VaultDoorway = {
  x: number; z: number; radius: number;
  pillarA: { x: number; z: number };
  pillarB: { x: number; z: number };
};
export function vaultDoorway(v: Vault): VaultDoorway {
  const R = CFG.world.vaultRadius, ring = CFG.world.vaultRing;
  const dx = Math.cos(v.doorAngle), dz = Math.sin(v.doorAngle);
  const px = -dz, pz = dx;
  const midR = R + ring / 2;
  const outR = R + ring + 1.0;
  return {
    x: v.cx + dx * midR, z: v.cz + dz * midR, radius: ring + 0.9,
    pillarA: { x: v.cx + dx * outR + px * 1.1, z: v.cz + dz * outR + pz * 1.1 },
    pillarB: { x: v.cx + dx * outR - px * 1.1, z: v.cz + dz * outR - pz * 1.1 },
  };
}

export class Terrain {
  private readonly floorLo: Simplex2;
  private readonly floorHi: Simplex2;
  private readonly ceilLo: Simplex2;
  private readonly ceilHi: Simplex2;
  private readonly solid: Simplex2;
  private readonly gal: Simplex2;
  private readonly holeN: Simplex2;
  private readonly ceil2Hi: Simplex2;
  private readonly hills: Simplex2;
  /** Dug-out depth per integer world vertex ("x,z" → metres removed), per level. */
  readonly digs: [Map<string, number>, Map<string, number>, Map<string, number>] = [new Map(), new Map(), new Map()];
  /** Dug-UP height per integer world vertex ("x,z" → metres the ceiling has been
   *  raised), per level whose ceiling can be dug (1 = gallery roof, 2 = lower
   *  cave roof; index 0 is unused — the surface has open sky, no ceiling). */
  readonly digsUp: [Map<string, number>, Map<string, number>, Map<string, number>] = [new Map(), new Map(), new Map()];
  /** Vault sites, memoised per 36 m grid cell (there is at most one per cell). */
  private readonly vaultCache = new Map<string, Vault | null>();

  constructor(readonly seed: number) {
    this.floorLo = new Simplex2(seed * 7 + 1);
    this.floorHi = new Simplex2(seed * 7 + 2);
    this.ceilLo = new Simplex2(seed * 7 + 3);
    this.ceilHi = new Simplex2(seed * 7 + 4);
    this.solid = new Simplex2(seed * 7 + 5);
    this.gal = new Simplex2(seed * 7 + 6);
    this.holeN = new Simplex2(seed * 7 + 7);
    this.ceil2Hi = new Simplex2(seed * 7 + 8);
    this.hills = new Simplex2(seed * 7 + 9);
  }

  biome(x: number, z: number): Biome {
    return biomeAt(x, z, this.seed);
  }
  biomeId(x: number, z: number): number {
    return biomeIdAt(x, z, this.seed);
  }

  // ── Analytic fields (no digging) ─────────────────────────────────────

  /** Rolling cave floor before walls: dunes plus rocky chop, terraced in
   *  biomes that want ledges. The spawn column is flat. */
  floorOpen(x: number, z: number): number {
    const b = this.biome(x, z);
    const d = Math.hypot(x, z);
    const pad = smoothstep(2.5, 9, d);
    const W = CFG.world;
    const broad = this.floorLo.fbm(x / W.dunes, z / W.dunes, 4) * 2.4 * b.relief;
    const chop = this.floorHi.fbm(x / W.chop, z / W.chop, 2) * 0.55;
    if (b.terrace > 0) {
      const stepped = Math.round(broad / b.terrace) * b.terrace;
      return W.floorBase + (stepped + chop * 0.35) * pad;
    }
    return W.floorBase + (broad + chop) * pad;
  }

  /** The lower cave's ceiling. Cathedral biomes lift it into a vault. */
  ceiling(x: number, z: number): number {
    const broad = this.ceilLo.fbm(x / 34, z / 34, 3) * CFG.world.ceilRelief;
    const chop = this.ceilHi.fbm(x / 6, z / 6, 2) * 0.7;
    return CFG.world.ceilBase + broad + chop + this.biome(x, z).ceilLift;
  }

  /** 0..1 — how much this column is solid rock (wall / pillar). */
  solidity(x: number, z: number): number {
    const s = (this.solid.fbm(x / 30 + 100, z / 30 - 40, 3) + 1) * 0.5;
    const d = Math.hypot(x, z);
    return s * smoothstep(SPAWN_CLEAR * 0.5, SPAWN_CLEAR * 1.6, d);
  }

  /** The lower floor, walls included. In a gallery a pinch wall rises all the
   *  way to the upper floor, so its top IS the next level. A vault's ring
   *  wall is just another wall source — the same lift, the same dig map. */
  floor(x: number, z: number): number {
    const open = this.floorOpen(x, z);
    const s = this.solidity(x, z);
    const wall = Math.max(smoothstep(CFG.world.wallLo, CFG.world.wallHi, s), this.vaultWall(x, z));
    if (wall <= 0) return open;
    const g = this.gallery(x, z);
    const top = g > 0.5 ? this.ceiling(x, z) + SLAB : this.ceiling(x, z) + 0.4;
    return lerp(open, top, wall);
  }

  /** The vault (if any) whose ~36 m site contains (x,z): a sealed lower-cave
   *  room, well clear of spawn and out from under a gallery. Deterministic
   *  per seed, memoised per grid cell — cheap to call from anywhere. */
  vault(x: number, z: number): Vault | null {
    const gx = Math.floor(x / VAULT_GRID), gz = Math.floor(z / VAULT_GRID);
    const key = `${gx},${gz}`;
    const cached = this.vaultCache.get(key);
    if (cached !== undefined) return cached;
    const rng = mulberry32(hash3(this.seed ^ 0x7a17c0de, gx, gz));
    let v: Vault | null = null;
    if (rng() <= VAULT_CHANCE) {
      const jitter = VAULT_GRID * 0.25;
      const cx = gx * VAULT_GRID + VAULT_GRID / 2 + (rng() - 0.5) * jitter;
      const cz = gz * VAULT_GRID + VAULT_GRID / 2 + (rng() - 0.5) * jitter;
      const doorAngle = Math.floor(rng() * 4) * (Math.PI / 2);
      const relicKindRng = rng();
      const relicSeed = Math.floor(rng() * 1e6);
      if (Math.hypot(cx, cz) >= SPAWN_CLEAR * 3 && this.gallery(cx, cz) < 0.4) {
        v = { id: `v${gx}_${gz}`, cx, cz, doorAngle, relicKindRng, relicSeed };
      }
    }
    this.vaultCache.set(key, v);
    return v;
  }

  /** Every vault whose centre could land inside this 24 m chunk (a chunk can
   *  straddle up to four 36 m vault sites, so its corners cover them all). */
  vaultsInChunk(cx: number, cz: number): Vault[] {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const gxs = new Set([Math.floor(ox / VAULT_GRID), Math.floor((ox + CHUNK - 1) / VAULT_GRID)]);
    const gzs = new Set([Math.floor(oz / VAULT_GRID), Math.floor((oz + CHUNK - 1) / VAULT_GRID)]);
    const out: Vault[] = [];
    for (const gx of gxs) {
      for (const gz of gzs) {
        const v = this.vault(gx * VAULT_GRID + 1, gz * VAULT_GRID + 1);
        if (v && v.cx >= ox && v.cx < ox + CHUNK && v.cz >= oz && v.cz < oz + CHUNK) out.push(v);
      }
    }
    return out;
  }

  /** 0..1 vault-wall contribution at (x,z): a ring around a vault's centre. */
  vaultWall(x: number, z: number): number {
    const v = this.vault(x, z);
    if (!v) return 0;
    const R = CFG.world.vaultRadius, ring = CFG.world.vaultRing;
    const d = Math.hypot(x - v.cx, z - v.cz);
    const inner = smoothstep(R - 0.3, R, d);
    const outer = 1 - smoothstep(R + ring, R + ring + 0.3, d);
    return inner * outer;
  }

  /** 0..1 — where the upper level exists (above 0.5). Never over the spawn column. */
  gallery(x: number, z: number): number {
    const n = (this.gal.fbm(x / 70 - 30, z / 70 + 55, 3) + 1) * 0.5;
    return n * smoothstep(12, 30, Math.hypot(x, z));
  }

  /** 0..1 — a shaft through the gallery slab (above 0.5), only inside a gallery. */
  hole(x: number, z: number): number {
    if (this.gallery(x, z) < 0.5) return 0;
    return (this.holeN.fbm(x / 13 + 7, z / 13 - 3, 2) + 1) * 0.5;
  }

  /** The upper (gallery) floor: slab top inside galleries, dropping to the
   *  lower floor in shafts and steeply at gallery edges; hidden just under the
   *  lower floor elsewhere so its collider never wins. */
  floor2(x: number, z: number): number {
    const g = this.gallery(x, z);
    const lower = this.floor(x, z);
    const edge = smoothstep(0.5, 0.545, g);
    if (edge <= 0) return lower - 0.05;
    const slabTop = this.ceiling(x, z) + SLAB;
    const shaft = smoothstep(0.58, 0.66, this.hole(x, z));
    return lerp(lower - 0.05, lerp(slabTop, lower, shaft), edge);
  }

  /** The gallery's ceiling (only meaningful where gallery > 0.5). */
  ceiling2(x: number, z: number): number {
    return this.ceiling(x, z) + SLAB + 7.5 + this.ceil2Hi.fbm(x / 22, z / 22, 3) * 2.5;
  }

  /** The roof of whatever cave is topmost here — what the surface sits on. */
  roofBelow(x: number, z: number): number {
    const g = smoothstep(0.47, 0.56, this.gallery(x, z));
    return lerp(this.ceiling(x, z), this.ceiling2(x, z), g);
  }

  /** The surface: a crust of rock (`world.crust` metres, tunable) over the
   *  topmost cave, with gentle hills. Galleries and cathedral vaults push it
   *  up into ridges. You dig through the crust to get in. */
  surface(x: number, z: number): number {
    const pad = smoothstep(3, 12, Math.hypot(x, z));
    const hill = this.hills.fbm(x / 40 + 9, z / 40 - 4, 3) * 2.2 * pad;
    return this.roofBelow(x, z) + CFG.world.crust + hill;
  }

  /** Metres of rock between a level and the cave under it. Digging this much
   *  breaks through. The lower cave has nothing under it. */
  thickness(level: Level, x: number, z: number): number {
    if (level === 2) return Infinity;
    const t = level === 0 ? this.surface(x, z) - this.roofBelow(x, z) : this.floor2(x, z) - this.ceiling(x, z);
    return Math.max(0.3, t);
  }

  // ── Dug fields (what is actually built and collided) ─────────────────

  /** Bilinear-sampled value from a per-vertex dig map (shared by downward
   *  `digs` and upward `digsUp`). */
  private sampleDig(m: Map<string, number>, x: number, z: number): number {
    if (m.size === 0) return 0;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const d = (X: number, Z: number) => m.get(`${X},${Z}`) ?? 0;
    return (d(x0, z0) * (1 - fx) + d(x0 + 1, z0) * fx) * (1 - fz) + (d(x0, z0 + 1) * (1 - fx) + d(x0 + 1, z0 + 1) * fx) * fz;
  }

  private dug(level: Level, x: number, z: number): number {
    return this.sampleDig(this.digs[level], x, z);
  }

  /** Metres a ceiling has been dug up here (1 = gallery roof, 2 = lower cave roof). */
  private dugUp(level: 1 | 2, x: number, z: number): number {
    return this.sampleDig(this.digsUp[level], x, z);
  }

  /** Lower floor with digging. */
  floorAt(x: number, z: number): number {
    return this.floor(x, z) - this.dug(2, x, z);
  }

  /** How far through the rock under/over a level a dig has gone here: 0 intact, 1 open.
   *  `t` is the thickness of the rock being dug through (down OR up — the
   *  caller picks which `thickness(level,...)` applies). */
  private through(level: Level, x: number, z: number, d: number): number {
    if (d <= 0) return 0;
    const t = this.thickness(level, x, z);
    return smoothstep(t - 0.15, t + 0.35, d);
  }

  /** The level whose FLOOR sits directly above a given level's ceiling — what
   *  breaks through when that ceiling is dug up far enough. Level 1's roof
   *  (`ceiling2`) always sits under the surface; level 2's roof (`ceiling`)
   *  sits under the gallery floor where there is one, else straight under
   *  the surface. */
  private levelAboveCeiling(level: 1 | 2, x: number, z: number): Level {
    return level === 1 ? 0 : this.gallery(x, z) > 0.5 ? 1 : 0;
  }

  /** Ceiling height with upward digging: the roof over `level` (1 = gallery,
   *  2 = lower cave), raised by however much has been dug into it. */
  ceilingAt(level: 1 | 2, x: number, z: number): number {
    const base = level === 2 ? this.ceiling(x, z) : this.ceiling2(x, z);
    return base + this.dugUp(level, x, z);
  }

  /** 0 intact .. 1 fully broken through to the level above (dug up all the
   *  way through the rock over `level`'s ceiling). */
  private throughUp(level: 1 | 2, x: number, z: number): number {
    const d = this.dugUp(level, x, z);
    if (d <= 0) return 0;
    return this.through(this.levelAboveCeiling(level, x, z), x, z, d);
  }

  /** Has this ceiling been dug all the way through here (a hole up into the
   *  level above, opened from below)? */
  brokenThroughUp(level: 1 | 2, x: number, z: number): boolean {
    const t = this.thickness(this.levelAboveCeiling(level, x, z), x, z);
    return this.dugUp(level, x, z) >= t + 0.1;
  }

  /** Gallery floor with digging; dug through the slab (from above, or from
   *  below through the lower cave's ceiling) it drops to the lower floor. */
  floor2At(x: number, z: number): number {
    const d = this.dug(1, x, z);
    const downThrough = this.through(1, x, z, d);
    // Level 2's ceiling breaks through INTO level 1 only where a gallery
    // actually sits overhead — elsewhere level 2 breaks straight to the surface.
    const upThrough = this.levelAboveCeiling(2, x, z) === 1 ? this.throughUp(2, x, z) : 0;
    const through = Math.max(downThrough, upThrough);
    return lerp(this.floor2(x, z) - d, this.floorAt(x, z), through);
  }

  /** Surface with digging; dug through the crust (from above, or from below
   *  through whatever cave's ceiling sits under it) it drops to the cave below. */
  surfaceAt(x: number, z: number): number {
    const d = this.dug(0, x, z);
    const downThrough = this.through(0, x, z, d);
    const gal = this.gallery(x, z) > 0.5;
    const upThrough = gal ? this.throughUp(1, x, z) : this.throughUp(2, x, z);
    const through = Math.max(downThrough, upThrough);
    const below = gal ? this.floor2At(x, z) : this.floorAt(x, z);
    return lerp(this.surface(x, z) - d, below, through);
  }

  /** Height of a level at (x,z), digging included. */
  levelAt(level: Level, x: number, z: number): number {
    return level === 0 ? this.surfaceAt(x, z) : level === 1 ? this.floor2At(x, z) : this.floorAt(x, z);
  }

  /** Has this level been dug through here (a hole to the level below)? */
  brokenThrough(level: Level, x: number, z: number): boolean {
    return level < 2 && this.dug(level, x, z) >= this.thickness(level, x, z) + 0.1;
  }

  /** The highest floor at or under a point (a little above it counts, so a
   *  thing resting on a floor stays on it). Falls back to the lowest floor. */
  groundAt(x: number, z: number, y: number): number {
    let best = -Infinity;
    const consider = (h: number) => { if (h <= y + 0.3 && h > best) best = h; };
    consider(this.surfaceAt(x, z));
    consider(this.floorAt(x, z));
    if (this.gallery(x, z) > 0.5) consider(this.floor2At(x, z));
    return best === -Infinity ? this.floorAt(x, z) : best;
  }

  /** Which level a point at height y sits on (nearest level height). */
  levelOf(x: number, z: number, y: number): Level {
    const cands: Array<[Level, number]> = [[0, this.surfaceAt(x, z)], [2, this.floorAt(x, z)]];
    if (this.gallery(x, z) > 0.5) cands.push([1, this.floor2At(x, z)]);
    cands.sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y));
    return cands[0]![0];
  }

  /** Dig a flat-bottomed pit on a level: vertices within `radius` drop by
   *  `depth`, with a soft rim so it reads as hand-dug. Flat-bottomed matters:
   *  a V-shaped crater one vertex wide is a funnel the body can't fit down. */
  dig(level: Level, x: number, z: number, radius: number, depth: number): Set<string> {
    const m = this.digs[level];
    return this.carve(m, x, z, radius, (X, Z, t) => depth * smoothstep(0, 0.4, t) + (m.get(`${X},${Z}`) ?? 0));
  }

  /** Dig a level DOWN TO a height (a tunnel into a wall, a flat-bottomed pit).
   *  The rim keeps a soft falloff so the cut reads as hand-dug. */
  digTo(level: Level, x: number, z: number, radius: number, targetY: number): Set<string> {
    const base = (X: number, Z: number) => (level === 0 ? this.surface(X, Z) : level === 1 ? this.floor2(X, Z) : this.floor(X, Z));
    const m = this.digs[level];
    return this.carve(m, x, z, radius, (X, Z, t) => {
      const need = Math.max(0, base(X, Z) - targetY) * smoothstep(0, 0.35, t);
      return Math.max(m.get(`${X},${Z}`) ?? 0, need);
    });
  }

  /** Dig a ceiling UP: vertices within `radius` raise by `depth`, same soft
   *  rim and same small cell-snapped increments as a floor `dig`. Reuses the
   *  same `carve` (and the same 80 m cap) so ceiling digs behave exactly like
   *  floor digs — just pointed the other way. */
  digUp(level: 1 | 2, x: number, z: number, radius: number, depth: number): Set<string> {
    const m = this.digsUp[level];
    return this.carve(m, x, z, radius, (X, Z, t) => depth * smoothstep(0, 0.4, t) + (m.get(`${X},${Z}`) ?? 0));
  }

  private carve(m: Map<string, number>, x: number, z: number, radius: number, value: (X: number, Z: number, t: number) => number): Set<string> {
    const touched = new Set<string>();
    for (let Z = Math.floor(z - radius); Z <= Math.ceil(z + radius); Z++) {
      for (let X = Math.floor(x - radius); X <= Math.ceil(x + radius); X++) {
        const dd = Math.hypot(X - x, Z - z);
        if (dd > radius) continue;
        const t = 1 - dd / radius;
        m.set(`${X},${Z}`, Math.min(80, value(X, Z, t)));
        for (const cx of [Math.floor(X / CHUNK), Math.floor((X - 1) / CHUNK)]) {
          for (const cz of [Math.floor(Z / CHUNK), Math.floor((Z - 1) / CHUNK)]) touched.add(`${cx},${cz}`);
        }
      }
    }
    return touched;
  }

  /** Is (x,z) open air at head height on the lower level — usable for placing things? */
  isOpen(x: number, z: number): boolean {
    return this.solidity(x, z) < 0.5 && this.ceiling(x, z) - this.floorOpen(x, z) > 3;
  }

  /** Is (x,z) gallery-level walkable — slab top, no shaft, not the edge ramp? */
  isUpperOpen(x: number, z: number): boolean {
    return this.gallery(x, z) > 0.56 && this.hole(x, z) < 0.5 && this.solidity(x, z) < 0.5;
  }

  /** You start on the surface, at the world's origin. */
  spawnPoint(): THREE.Vector3 {
    return new THREE.Vector3(0, this.surfaceAt(0, 0) + 1.0, 0);
  }
}

export type HeightGrid = {
  /** (CELLS+1)² samples, row-major by z then x: heights[iz * (CELLS+1) + ix]. */
  samples: Float32Array;
  min: number;
  max: number;
};

/** Sample a field over a chunk, including the shared edge row/column. */
export function sampleGrid(fn: (x: number, z: number) => number, cx: number, cz: number): HeightGrid {
  const n = CELLS + 1;
  const samples = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const h = fn(ox + ix, oz + iz);
      samples[iz * n + ix] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { samples, min, max };
}

/** Faceted mesh for a sampled grid. `up` = surface faces +y (floor) or −y
 *  (ceiling). Positions are WORLD x/z (the mesh sits at the origin) so the
 *  toon shader's world-space noise is continuous across chunk seams. */
export function gridGeometry(
  grid: HeightGrid, cx: number, cz: number, up: boolean,
  /** Return false to leave a cell out (a shaft, or no upper level here). */
  keep?: (ix: number, iz: number) => boolean,
): THREE.BufferGeometry | null {
  const n = CELLS + 1;
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const pos = new Float32Array(CELLS * CELLS * 6 * 3);
  let k = 0;
  const put = (ix: number, iz: number) => {
    pos[k++] = ox + ix;
    pos[k++] = grid.samples[iz * n + ix]!;
    pos[k++] = oz + iz;
  };
  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      if (keep && !keep(ix, iz)) continue;
      const flip = ((ix + iz) & 1) === 0;
      const a: [number, number] = [ix, iz], b: [number, number] = [ix + 1, iz];
      const c: [number, number] = [ix + 1, iz + 1], d: [number, number] = [ix, iz + 1];
      const tris = flip ? [a, c, b, a, d, c] : [a, d, b, b, d, c];
      const order = up ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
      for (const i of order) put(tris[i]![0], tris[i]![1]);
    }
  }
  if (k === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, k), 3));
  geo.computeVertexNormals();
  return geo;
}

export type RockSpec = {
  /** Index into `rockPrototypes()` — which baked unit (radius=1, height=1)
   *  shape this instance reuses. */
  protoIndex: number;
  /** Non-uniform instance scale applied to the unit prototype: (radius,
   *  height, radius) — reproduces exactly what building a unique geometry at
   *  this radius/height used to look like, since `rockGeometry`'s per-vertex
   *  jitter/lean is linear in radius and height. */
  scale: THREE.Vector3;
  position: THREE.Vector3;
  rotationY: number;
  hatchSeed: number;
  /** Convex hull points in local space (Float32Array xyz), already scaled to
   *  this rock's actual size — physics doesn't care how rendering batches
   *  things, so this stays a real per-rock hull exactly as before. */
  hull: Float32Array;
};

/** Deterministic low-poly jagged boulder (the tuner's). */
export function rockGeometry(rng: () => number, radius: number, height: number): THREE.BufferGeometry {
  const sides = 5 + Math.floor(rng() * 3);
  const geo = new THREE.ConeGeometry(radius, height, sides, 2, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const leanX = (rng() - 0.5) * radius * 0.9;
  const leanZ = (rng() - 0.5) * radius * 0.9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const jitter = 1 + (rng() - 0.5) * 0.6;
    const t = (y + height / 2) / height;
    pos.setX(i, x * jitter + leanX * t);
    pos.setZ(i, z * jitter + leanZ * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Fixed pool of shapes every rock instance picks from instead of a unique
 *  geometry — built once (world-seed-independent: shape variety, not
 *  placement, so the pool doesn't need to vary by world) at radius=1,
 *  height=1 so `chunks.ts` can batch same-prototype rocks into one
 *  `InstancedMesh` and recover the real per-rock size with a non-uniform
 *  instance scale. */
const ROCK_PROTO_COUNT = 10;
let rockPrototypeCache: THREE.BufferGeometry[] | null = null;
export function rockPrototypes(): THREE.BufferGeometry[] {
  if (!rockPrototypeCache) {
    const rng = mulberry32(0xb0a7);
    rockPrototypeCache = Array.from({ length: ROCK_PROTO_COUNT }, () => rockGeometry(rng, 1, 1));
  }
  return rockPrototypeCache;
}

/** Scatter boulders and stalagmites over a chunk on one level, seated on that
 *  level's floor, avoiding walls and the spawn column. Deterministic. */
export function scatterRocks(terrain: Terrain, cx: number, cz: number, chunkSeed: number, level: Level): RockSpec[] {
  const rng = mulberry32(chunkSeed ^ (level === 1 ? 0x9e3779b9 : level === 0 ? 0x27d4eb2f : 0));
  const protos = rockPrototypes();
  const out: RockSpec[] = [];
  const centre = terrain.biome(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2);
  const count = Math.round(centre.rocks * (0.7 + rng() * 0.6) * (level === 2 ? 1 : 0.5));
  for (let i = 0; i < count; i++) {
    const x = cx * CHUNK + rng() * CHUNK;
    const z = cz * CHUNK + rng() * CHUNK;
    if (Math.hypot(x, z) < 4) continue;
    if (level === 2 && !terrain.isOpen(x, z)) continue;
    if (level === 1 && !terrain.isUpperOpen(x, z)) continue;
    const b = terrain.biome(x, z);
    const tall = rng() < b.tallShare;
    const radius = tall ? 0.25 + rng() * 0.5 : 0.35 + rng() * 1.1;
    const height = tall ? 1.8 + rng() * 3.2 : 0.35 + rng() * 1.4;
    const protoIndex = Math.floor(rng() * protos.length);
    const proto = protos[protoIndex]!;
    const y = terrain.levelAt(level, x, z) + height / 2 - Math.min(0.25, height * 0.2);
    const protoPts = (proto.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const hull = new Float32Array(protoPts.length);
    for (let k = 0; k < protoPts.length; k += 3) {
      hull[k] = protoPts[k]! * radius;
      hull[k + 1] = protoPts[k + 1]! * height;
      hull[k + 2] = protoPts[k + 2]! * radius;
    }
    out.push({
      protoIndex, scale: new THREE.Vector3(radius, height, radius),
      position: new THREE.Vector3(x, y, z), rotationY: rng() * Math.PI * 2,
      hatchSeed: (rng() - 0.5) * 1.4, hull,
    });
  }
  return out;
}

export { clamp, BIOMES };
