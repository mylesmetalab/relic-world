#!/usr/bin/env node
/**
 * Pack an .stl into the tool's baked-in model format:
 *   public/models/<name>.json  { nv, nf, lo, hi }
 *   public/models/<name>.bin   16-bit fixed-point positions over lo..hi,
 *                              then 16-bit triangle indices
 *
 * Steps: parse → weld shared vertices → Z-up→Y-up → decimate by vertex
 * clustering to ~TARGET triangles → centre on x/z, floor at y=0 → quantize.
 *
 * Why cluster rather than edge-collapse: three's SimplifyModifier rescans
 * every vertex per collapse (O(n²)); on a 320k-triangle print file that is
 * hours. Clustering (snap vertices to a grid, drop degenerate triangles) is
 * seconds, and its faceted result is what the tool's key plate wants anyway.
 *
 * usage: node scripts/pack-stl.mjs <in.stl> <name> [targetTris=30000]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const [, , input, name, targetArg] = process.argv;
if (!input || !name) {
  console.error("usage: node scripts/pack-stl.mjs <in.stl> <name> [targetTris=30000]");
  process.exit(2);
}
const TARGET = Number(targetArg ?? 30000);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "models");

const buf = readFileSync(input);
const raw = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
let geo = mergeVertices(raw, 1e-4);
geo.rotateX(-Math.PI / 2); // most print STLs are Z-up; the tool is Y-up
console.log(`parsed: ${raw.attributes.position.count / 3} tris → welded ${geo.index.count / 3} tris, ${geo.attributes.position.count} verts`);

/** Vertex-cluster decimation at grid cell size `cell`; returns indexed geometry. */
function cluster(src, cell) {
  const pos = src.attributes.position;
  const idx = src.index.array;
  const bb = new THREE.Box3().setFromBufferAttribute(pos);
  const key = new Map(); // cell key → new vertex id
  const acc = []; // [sx, sy, sz, n]
  const remap = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const kx = Math.floor((x - bb.min.x) / cell), ky = Math.floor((y - bb.min.y) / cell), kz = Math.floor((z - bb.min.z) / cell);
    const k = `${kx},${ky},${kz}`;
    let id = key.get(k);
    if (id === undefined) { id = acc.length; key.set(k, id); acc.push([0, 0, 0, 0]); }
    const a = acc[id]; a[0] += x; a[1] += y; a[2] += z; a[3]++;
    remap[i] = id;
  }
  const out = new Float32Array(acc.length * 3);
  acc.forEach((a, i) => { out[i * 3] = a[0] / a[3]; out[i * 3 + 1] = a[1] / a[3]; out[i * 3 + 2] = a[2] / a[3]; });
  const tris = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]];
    if (a === b || b === c || a === c) continue; // collapsed
    tris.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  g.setIndex(tris);
  return g;
}

// Binary-search the cell size that lands near TARGET triangles.
const size = new THREE.Vector3();
new THREE.Box3().setFromBufferAttribute(geo.attributes.position).getSize(size);
let lo = size.length() / 4000, hi = size.length() / 20, best = null;
for (let it = 0; it < 18; it++) {
  const cell = Math.sqrt(lo * hi);
  const g = cluster(geo, cell);
  const n = g.index.count / 3;
  if (!best || Math.abs(n - TARGET) < Math.abs(best.n - TARGET)) best = { g, n, cell };
  if (n > TARGET) lo = cell; else hi = cell;
}
geo = best.g;
console.log(`decimated: ${best.n} tris, ${geo.attributes.position.count} verts (cell ${best.cell.toFixed(4)})`);
if (geo.attributes.position.count > 65535) {
  console.error("too many vertices for 16-bit indices — raise the decimation");
  process.exit(1);
}

// Centre x/z, floor at y=0 (same convention as the Rook pack).
const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
const c = bb.getCenter(new THREE.Vector3());
geo.translate(-c.x, -bb.min.y, -c.z);
bb.setFromBufferAttribute(geo.attributes.position);

const nv = geo.attributes.position.count;
const nf = geo.index.count / 3;
const u16 = new Uint16Array(nv * 3 + nf * 3);
const p = geo.attributes.position;
const loA = [bb.min.x, bb.min.y, bb.min.z], hiA = [bb.max.x, bb.max.y, bb.max.z];
for (let i = 0; i < nv; i++) {
  const v = [p.getX(i), p.getY(i), p.getZ(i)];
  for (let k = 0; k < 3; k++) {
    const span = hiA[k] - loA[k] || 1;
    u16[i * 3 + k] = Math.round(((v[k] - loA[k]) / span) * 65535);
  }
}
u16.set(geo.index.array, nv * 3);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.bin`), Buffer.from(u16.buffer));
writeFileSync(join(outDir, `${name}.json`), JSON.stringify({
  nv, nf,
  lo: loA.map((n) => +n.toFixed(5)), hi: hiA.map((n) => +n.toFixed(5)),
  note: `16-bit fixed-point positions over lo..hi, then 16-bit triangle indices; ${name} decimated from ${raw.attributes.position.count / 3} tris (scripts/pack-stl.mjs)`,
}));
console.log(`wrote public/models/${name}.{json,bin} — ${((u16.byteLength) / 1024).toFixed(0)} KB, height ${(hiA[1] - loA[1]).toFixed(3)}`);
