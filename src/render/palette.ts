/**
 * Ink palettes — the tuner's colorways, verbatim. A palette is a 256×1 LUT
 * baked from gradient stops; the toon shader picks one flat ink from it per
 * zone (figure) or per light band (rock) and never shades it.
 */

export type GradientStop = { pos: number; color: string; alpha: number };

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Bake stops to RGBA8 (sRGB bytes — the texture is tagged sRGB). */
export function bakeGradientToRGBA(stops: GradientStop[], width = 256): Uint8Array {
  const data = new Uint8Array(width * 4);
  if (stops.length === 0) return data;
  const sorted = [...stops].sort((a, b) => a.pos - b.pos).map((s) => ({ pos: s.pos, rgb: parseHex(s.color) }));
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    if (t <= lo.pos) hi = lo;
    else if (t >= hi.pos) lo = hi;
    else {
      for (let j = 0; j < sorted.length - 1; j++) {
        if (t >= sorted[j]!.pos && t <= sorted[j + 1]!.pos) { lo = sorted[j]!; hi = sorted[j + 1]!; break; }
      }
    }
    const span = hi.pos - lo.pos;
    const f = span > 1e-6 ? (t - lo.pos) / span : 0;
    data[i * 4] = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f);
    data[i * 4 + 1] = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f);
    data[i * 4 + 2] = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f);
    data[i * 4 + 3] = 255;
  }
  return data;
}

const INK = {
  deep: "#4a5518", olive: "#8f9b2e", green: "#7fe33f", yellow: "#f2f542",
  acid: "#e6ef3a", wax: "#f8ffa8", teal: "#46e0c8", blue: "#1b5fe0",
  violet: "#7b2fd0", magenta: "#d826c0", pink: "#f06aa8",
};

const stepStops = (bands: [number, string][], soft = 0.004): GradientStop[] => {
  const out: GradientStop[] = [];
  let from = 0;
  bands.forEach(([to, color], i) => {
    out.push({ pos: i === 0 ? 0 : Math.min(from + soft, to), color, alpha: 1 });
    out.push({ pos: Math.min(to, 1), color, alpha: 1 });
    from = to;
  });
  return out;
};
// Garment boundaries measured off the Rook: boots/hem, coat/collar, scarf/cap.
const Z = [0.288, 0.643, 0.749, 1] as const;
const zones = (a: string, b: string, c: string, d: string) =>
  stepStops([[Z[0], a], [Z[1], b], [Z[2], c], [Z[3], d]]);

export type Colorway = { name: string; base: GradientStop[]; hi: GradientStop[] };
export const COLORWAYS: Colorway[] = [
  { name: "Riso Dungeon", base: zones(INK.deep, "#a8b234", INK.green, INK.acid), hi: zones(INK.olive, INK.acid, INK.yellow, INK.wax) },
  { name: "Cyan Noir", base: zones("#0e2a5c", INK.blue, INK.teal, INK.blue), hi: zones(INK.blue, INK.teal, "#c8fff4", INK.teal) },
  { name: "Magenta Wraith", base: zones("#3a1250", INK.violet, INK.pink, INK.magenta), hi: zones(INK.violet, INK.magenta, "#ffd1f5", INK.pink) },
  { name: "Ember", base: zones("#3a1408", "#b8471c", "#ffb347", "#ff5f6d"), hi: zones("#7a2a10", "#ff7a2a", "#ffe08a", "#ffd1c8") },
  { name: "Frost", base: zones("#1c2f5c", INK.teal, "#c8f4ff", INK.blue), hi: zones("#2a5aa8", "#b8fff2", "#ffffff", "#7fb6ff") },
  { name: "Toxic Swamp", base: zones("#0f2a12", "#2f8a3a", INK.acid, INK.teal), hi: zones("#2f8a3a", INK.green, INK.wax, "#c8fff4") },
  { name: "Blood Moon", base: zones("#2a0a12", "#8a1030", INK.pink, INK.yellow), hi: zones("#5a1020", "#e0244a", "#ffd1e0", INK.wax) },
  { name: "Bruise", base: zones("#14082a", "#4a2a9a", INK.magenta, INK.teal), hi: zones("#4a2a9a", INK.violet, INK.pink, "#b8fff2") },
  { name: "Gold Leaf", base: zones("#3d2a08", "#b8861c", INK.yellow, "#e6a12a"), hi: zones("#7a5a10", "#f2c94c", "#fff8b0", "#ffd870") },
  { name: "Newsprint", base: zones("#2a2a2a", "#6b6b6b", INK.acid, "#bdbdbd"), hi: zones("#4a4a4a", "#bdbdbd", INK.wax, "#f0f0f0") },
];

/** Cave ramp: 0–0.55 is the torch-lit ROCK (shadow → mid → highlight),
 *  0.64–1 the unlit CEILING (dark → bright). */
const envRamp = (rock: [string, string, string], vault: [string, string, string]): GradientStop[] => [
  { pos: 0, color: rock[0], alpha: 1 },
  { pos: 0.28, color: rock[1], alpha: 1 },
  { pos: 0.55, color: rock[2], alpha: 1 },
  { pos: 0.64, color: vault[0], alpha: 1 },
  { pos: 0.84, color: vault[1], alpha: 1 },
  { pos: 1, color: vault[2], alpha: 1 },
];
export type EnvWay = { name: string; ramp: GradientStop[] };
export const ENVWAYS: EnvWay[] = [
  { name: "Dungeon Cave", ramp: envRamp(["#08040e", "#8a2bd6", "#d63ad8"], ["#0d1c6e", "#1f45cc", "#2f5be8"]) },
  { name: "Dusk Ridge", ramp: envRamp(["#1a0805", "#6a2412", "#e0641f"], ["#2a1040", "#7a2f6a", "#ffb36a"]) },
  { name: "Void Peaks", ramp: envRamp(["#08030c", "#3a1050", "#9a3fc4"], ["#0c0620", "#2b1450", "#7a4aa8"]) },
  { name: "Glacier", ramp: envRamp(["#06101e", "#2a5aa8", "#46e0c8"], ["#0a1a4a", "#1b5fe0", "#7fb6ff"]) },
  { name: "Sulphur Pit", ramp: envRamp(["#100e02", "#6b6a12", "#e6ef3a"], ["#1a0a2a", "#4a1a5a", "#8a3a7a"]) },
  { name: "Blood Cave", ramp: envRamp(["#12040a", "#7a1030", "#e0244a"], ["#0a0a28", "#1a2a7a", "#3a5ad0"]) },
  { name: "Deep Sea", ramp: envRamp(["#02060e", "#0e3a6a", "#26c6da"], ["#020a1a", "#0a2a5a", "#1b5fe0"]) },
  { name: "Ash Field", ramp: envRamp(["#0a0a0a", "#3a3a3a", "#8a8a8a"], ["#101018", "#2a2a3a", "#4a4a6a"]) },
  { name: "Crystal Vein", ramp: envRamp(["#0a0e14", "#3aa8c4", "#eafcff"], ["#160a2a", "#5a3aa8", "#c8b8ff"]) },
];
