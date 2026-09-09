// Procedural app icons, no image deps: a paper-white page, an ink-black cairn
// (three stacked stones), a yellow torch flame, a little riso speckle.
// Writes public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png.
import zlib from "node:zlib";
import fs from "node:fs";

const PAPER = [0xe8, 0xe4, 0xd0], INK = [0x0a, 0x0a, 0x12], YELLOW = [0xf2, 0xf5, 0x42];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Deterministic speckle.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const ell = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;

function render(size) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      // Stones: bottom wide, middle, top small — leaning a touch.
      const s1 = ell(u, v, 0.50, 0.78, 0.30, 0.12);
      const s2 = ell(u, v, 0.52, 0.56, 0.22, 0.11);
      const s3 = ell(u, v, 0.49, 0.38, 0.14, 0.09);
      const gap = (ell(u, v, 0.50, 0.78, 0.30, 0.12 + 0.02) && !s1 && v < 0.78) || (ell(u, v, 0.52, 0.56, 0.22, 0.13) && !s2 && v < 0.56);
      const stone = (s1 || s2 || s3) && !gap;
      const flame = ell(u, v, 0.69, 0.22, 0.055, 0.085) || ell(u, v, 0.69, 0.30, 0.03, 0.05);
      const stick = Math.abs(u - 0.69 - (v - 0.3) * 0.08) < 0.012 && v > 0.28 && v < 0.62;
      let c = PAPER;
      if (stone || stick) c = INK;
      if (flame) c = YELLOW;
      // Riso grain: sparse ink specks on paper, sparse paper specks in ink.
      const r = hash(x, y);
      if (c === PAPER && r < 0.035) c = INK;
      else if (c === INK && r > 0.985) c = PAPER;
      const i = (y * size + x) * 3;
      rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
    }
  }
  return png(size, size, rgb);
}

fs.mkdirSync("public", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(`public/${name}`, render(size));
  console.log("wrote public/" + name);
}
