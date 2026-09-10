import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../world/noise";
import { rockGeometry } from "../world/terrain";

/**
 * Procedural characters built from the cave's own vocabulary — the jagged
 * cone that makes every boulder, the slabs of the pinch walls, the plinths,
 * the vault's rings. Each kind is a recipe; the seed decides the heap.
 * Rig-free miniatures, like the packed figures. Heights are normalised by the
 * Figure that wears them, so recipes build at roughly unit scale.
 */

export type GolemKind = "cairn" | "shard" | "menhir" | "spire" | "dolmen" | "castle" | "totem" | "wisp" | "hound";

type Rng = () => number;

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** A stack of boulders, shoulders flung out, a shard for a head. */
function cairn(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  const segments = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const radius = (0.34 - t * 0.16) * (0.85 + rng() * 0.3);
    const height = 0.32 + rng() * 0.22;
    const g = rockGeometry(rng, radius, height);
    g.rotateY(rng() * Math.PI * 2);
    g.rotateZ((rng() - 0.5) * 0.25);
    g.translate((rng() - 0.5) * 0.08, y + height / 2, (rng() - 0.5) * 0.08);
    parts.push(g);
    y += height * 0.82;
  }
  for (const side of [-1, 1]) {
    const g = rockGeometry(rng, 0.14 + rng() * 0.08, 0.55 + rng() * 0.3);
    g.rotateZ(side * (0.9 + rng() * 0.4));
    g.translate(side * 0.34, y * 0.7, 0);
    parts.push(g);
  }
  const head = rockGeometry(rng, 0.12 + rng() * 0.06, 0.3 + rng() * 0.15);
  head.rotateZ((rng() - 0.5) * 0.5);
  head.translate(0, y + 0.1, 0);
  parts.push(head);
  return merge(parts);
}

/** A fan of thin shards splayed from a low knot — a walking crystal. */
function shard(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const knot = rockGeometry(rng, 0.28, 0.35);
  knot.translate(0, 0.3, 0);
  parts.push(knot);
  const n = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const len = 0.7 + rng() * 0.8;
    const g = rockGeometry(rng, 0.06 + rng() * 0.05, len);
    g.translate(0, len / 2, 0);
    g.rotateX((0.35 + rng() * 0.5) * (rng() < 0.5 ? 1 : -1) * 0.6);
    g.rotateZ(0.25 + rng() * 0.6);
    g.rotateY(a);
    g.translate(0, 0.32, 0);
    parts.push(g);
  }
  const crown = rockGeometry(rng, 0.09, 0.7);
  crown.translate(0, 0.75, 0);
  parts.push(crown);
  return merge(parts);
}

/** One tall slab, leaning, with a small head-stone perched on the shoulder. */
function menhir(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 1.5 + rng() * 0.4;
  const slab = new THREE.BoxGeometry(0.55 + rng() * 0.2, h, 0.28 + rng() * 0.12, 1, 3, 1);
  const pos = slab.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    pos.setX(i, pos.getX(i) * (1 - t * 0.35) + (rng() - 0.5) * 0.06);
    pos.setZ(i, pos.getZ(i) * (1 - t * 0.2) + (rng() - 0.5) * 0.05);
  }
  slab.rotateZ((rng() - 0.5) * 0.18);
  slab.translate(0, h / 2, 0);
  parts.push(slab);
  const head = rockGeometry(rng, 0.13, 0.3);
  head.rotateZ(0.6 + rng() * 0.4);
  head.translate(0.22, h * 0.92, 0.05);
  parts.push(head);
  const foot = rockGeometry(rng, 0.3, 0.25);
  foot.translate(0, 0.12, 0.1);
  parts.push(foot);
  return merge(parts);
}

/** A stalagmite that got up: a tapering spire ringed with drip-ledges. */
function spire(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 1.7;
  const body = rockGeometry(rng, 0.36, h);
  body.translate(0, h / 2, 0);
  parts.push(body);
  const rings = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < rings; i++) {
    const t = 0.2 + (i / rings) * 0.6;
    const r = 0.36 * (1 - t) + 0.14;
    const ring = new THREE.TorusGeometry(r, 0.05 + rng() * 0.04, 5, 9);
    ring.rotateX(Math.PI / 2);
    ring.rotateY(rng() * Math.PI);
    ring.translate((rng() - 0.5) * 0.06, t * h, (rng() - 0.5) * 0.06);
    parts.push(ring);
  }
  // Two stubby arms, drip-shaped.
  for (const side of [-1, 1]) {
    const arm = rockGeometry(rng, 0.08, 0.5);
    arm.rotateZ(side * 1.35);
    arm.translate(side * 0.3, h * 0.55, 0);
    parts.push(arm);
  }
  return merge(parts);
}

/** Two uprights and a lintel — a doorway that walks. */
function dolmen(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 1.15 + rng() * 0.2;
  for (const side of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.26, h, 0.32, 1, 2, 1);
    const pos = leg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + (rng() - 0.5) * 0.05);
      pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * 0.05);
    }
    leg.rotateZ(side * (0.04 + rng() * 0.05));
    leg.translate(side * 0.36, h / 2, 0);
    parts.push(leg);
  }
  const lintel = new THREE.BoxGeometry(1.1 + rng() * 0.2, 0.32, 0.42, 2, 1, 1);
  const lp = lintel.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) + (rng() - 0.5) * 0.06);
  lintel.rotateZ((rng() - 0.5) * 0.08);
  lintel.translate(0, h + 0.14, 0);
  parts.push(lintel);
  const cap = rockGeometry(rng, 0.16, 0.34);
  cap.translate((rng() - 0.5) * 0.3, h + 0.42, 0);
  parts.push(cap);
  return merge(parts);
}

/** The chess piece the Rook is named for: a tower with crenellations. */
function castle(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 8);
  base.translate(0, 0.11, 0);
  parts.push(base);
  const shaft = new THREE.CylinderGeometry(0.3, 0.38, 1.05, 8, 3);
  const sp = shaft.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    sp.setX(i, sp.getX(i) * (1 + (rng() - 0.5) * 0.08));
    sp.setZ(i, sp.getZ(i) * (1 + (rng() - 0.5) * 0.08));
  }
  shaft.translate(0, 0.22 + 0.525, 0);
  parts.push(shaft);
  const top = new THREE.CylinderGeometry(0.4, 0.32, 0.2, 8);
  top.translate(0, 1.37, 0);
  parts.push(top);
  const teeth = 6;
  for (let i = 0; i < teeth; i++) {
    if (rng() < 0.15) continue; // a missing merlon
    const a = (i / teeth) * Math.PI * 2;
    const m = new THREE.BoxGeometry(0.16, 0.22 + rng() * 0.1, 0.14);
    m.translate(Math.cos(a) * 0.33, 1.58, Math.sin(a) * 0.33);
    m.rotateY(0);
    parts.push(m);
  }
  return merge(parts);
}

/** Stacked discs of different girth, like the vault's rings turned solid. */
function totem(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.16 + rng() * 0.26;
    const h = 0.14 + rng() * 0.22;
    const sides = 5 + Math.floor(rng() * 4);
    const disc = new THREE.CylinderGeometry(r * (0.8 + rng() * 0.3), r, h, sides);
    disc.rotateY(rng() * Math.PI);
    disc.rotateZ((rng() - 0.5) * 0.1);
    disc.translate((rng() - 0.5) * 0.08, y + h / 2, (rng() - 0.5) * 0.08);
    parts.push(disc);
    y += h;
  }
  const beak = rockGeometry(rng, 0.08, 0.45);
  beak.rotateX(-1.3);
  beak.translate(0, y - 0.1, 0.25);
  parts.push(beak);
  return merge(parts);
}

/** A loose cloud of pebbles orbiting nothing — floats a little when it moves. */
function wisp(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 14 + Math.floor(rng() * 8);
  for (let i = 0; i < n; i++) {
    const r = 0.06 + rng() * 0.12;
    const g = rockGeometry(rng, r, r * (1.2 + rng()));
    const a = rng() * Math.PI * 2;
    const rad = 0.15 + rng() * 0.4;
    const y = 0.5 + rng() * 1.1;
    g.rotateX(rng() * 3);
    g.rotateZ(rng() * 3);
    g.translate(Math.cos(a) * rad * (1 - Math.abs(y - 1) * 0.6), y, Math.sin(a) * rad * (1 - Math.abs(y - 1) * 0.6));
    parts.push(g);
  }
  const core = rockGeometry(rng, 0.17, 0.3);
  core.translate(0, 1.0, 0);
  parts.push(core);
  return merge(parts);
}

/** A low four-legged thing — a boulder that grew legs and a muzzle. */
function hound(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = rockGeometry(rng, 0.3, 0.9);
  body.rotateX(Math.PI / 2 + (rng() - 0.5) * 0.2);
  body.translate(0, 0.62, 0);
  parts.push(body);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = rockGeometry(rng, 0.07, 0.5 + rng() * 0.1);
      leg.rotateX(sz * 0.25);
      leg.translate(sx * 0.2, 0.27, sz * 0.3);
      parts.push(leg);
    }
  }
  const head = rockGeometry(rng, 0.15, 0.4);
  head.rotateX(Math.PI / 2 - 0.4);
  head.translate(0, 0.78, 0.55);
  parts.push(head);
  for (const sx of [-1, 1]) {
    const ear = rockGeometry(rng, 0.04, 0.2);
    ear.rotateZ(sx * -0.5);
    ear.translate(sx * 0.1, 0.98, 0.42);
    parts.push(ear);
  }
  const tail = rockGeometry(rng, 0.04, 0.45);
  tail.rotateX(-0.9);
  tail.translate(0, 0.85, -0.5);
  parts.push(tail);
  return merge(parts);
}

const BUILDERS: Record<GolemKind, (rng: Rng) => THREE.BufferGeometry> = {
  cairn, shard, menhir, spire, dolmen, castle, totem, wisp, hound,
};

export function buildGolem(kind: GolemKind, seed: number): THREE.BufferGeometry {
  return BUILDERS[kind](mulberry32(seed));
}

/** Per-kind motion flavour for the rig-free walk. `armLen` is in the same
 *  local units as the body build (0 = no arms — only the hound, which reads
 *  as a mount, not a figure with arms). `armSwing` scales the walk swing. */
export const GOLEM_MOTION: Record<GolemKind, { bob: number; lean: number; float: number; armLen: number; armSwing: number }> = {
  cairn: { bob: 0.06, lean: 0.035, float: 0, armLen: 0.5, armSwing: 0.85 },
  shard: { bob: 0.04, lean: 0.08, float: 0, armLen: 0.6, armSwing: 0.6 },
  menhir: { bob: 0.03, lean: 0.05, float: 0, armLen: 0.5, armSwing: 0.55 },
  spire: { bob: 0.02, lean: 0.02, float: 0, armLen: 0.55, armSwing: 0.5 },
  dolmen: { bob: 0.09, lean: 0.06, float: 0, armLen: 0.4, armSwing: 0.65 },
  castle: { bob: 0.05, lean: 0.03, float: 0, armLen: 0.45, armSwing: 0.5 },
  totem: { bob: 0.07, lean: 0.07, float: 0, armLen: 0.4, armSwing: 0.7 },
  wisp: { bob: 0.03, lean: 0.0, float: 0.25, armLen: 0.35, armSwing: 0.4 },
  hound: { bob: 0.08, lean: 0.02, float: 0, armLen: 0, armSwing: 0 },
};
