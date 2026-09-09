/**
 * Everything the tuning panel can dial. One mutable object; the world, the
 * pipeline and main read it at use time, so a change is live (render) or
 * takes effect on the next rebuild (terrain). Export/import is plain JSON —
 * paste it back and it becomes the default.
 */

export type Tunables = {
  world: {
    floorBase: number;
    ceilBase: number;
    /** Solidity range that becomes wall (smoothstep lo→hi). */
    wallLo: number;
    wallHi: number;
    /** Metres per biome-noise unit. */
    biomeScale: number;
    /** Metres per floor-noise unit (broad dunes) and rocky chop. */
    dunes: number;
    chop: number;
    ceilRelief: number;
  };
  light: {
    localReach: number;
    remoteReach: number;
    inkStamp: number;
    fogNear: number;
    fogFar: number;
    fog: number;
    fogTone: number;
    mottle: number;
    shadowGamma: number;
    /** Ceiling ring cell size + spacing. */
    ceilCell: number;
    ceilArcSpacing: number;
  };
  press: {
    printScale: number;
    misreg: number;
    edgeW: number;
    depthCut: number;
    normalCut: number;
    grain: number;
    speck: number;
    halftone: number;
    halftoneScale: number;
    halftoneAngle: number;
  };
  figure: {
    hull: number;
    hatchRange: number;
    black: number;
    pitch: number;
    nib: number;
    rim: number;
    fill: number;
    stipple: number;
    formFollow: number;
    zoneSoft: number;
    zoneJitter: number;
    hiCut: number;
    /** 0 = ruled families, 1 = contour dashes. */
    hatchStyle: number;
  };
};

export const DEFAULTS: Tunables = {
  world: { floorBase: 3.0, ceilBase: 11.5, wallLo: 0.56, wallHi: 0.66, biomeScale: 90, dunes: 26, chop: 5.5, ceilRelief: 3.4 },
  light: { localReach: 34, remoteReach: 22, inkStamp: 26, fogNear: 14, fogFar: 70, fog: 0.5, fogTone: 0.4, mottle: 0.3, shadowGamma: 1.25, ceilCell: 26, ceilArcSpacing: 1.6 },
  press: { printScale: 0.6, misreg: 0.6, edgeW: 1.0, depthCut: 0.012, normalCut: 0.5, grain: 0.9, speck: 0.004, halftone: 0, halftoneScale: 4, halftoneAngle: 20 },
  figure: { hull: 0.55, hatchRange: 0.5, black: 0.1, pitch: 8, nib: 0.75, rim: 0.4, fill: 0.3, stipple: 0.06, formFollow: 0.6, zoneSoft: 0.04, zoneJitter: 0.035, hiCut: 0.78, hatchStyle: 0 },
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The live values. Mutated in place by the tuning panel and by `loadConfig`. */
export const CFG: Tunables = clone(DEFAULTS);

/** Deep-merge a partial config (from JSON or the URL) into CFG. */
export function loadConfig(partial: unknown): void {
  if (!partial || typeof partial !== "object") return;
  const src = partial as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(CFG) as Array<keyof Tunables>) {
    const from = src[section];
    if (!from) continue;
    const to = CFG[section] as unknown as Record<string, number>;
    for (const k of Object.keys(to)) {
      const v = from[k];
      if (typeof v === "number" && Number.isFinite(v)) to[k] = v;
    }
  }
}

export function resetConfig(): void {
  const d = clone(DEFAULTS);
  for (const section of Object.keys(CFG) as Array<keyof Tunables>) Object.assign(CFG[section], d[section]);
}

/** Read `?cfg=<base64url json>` if present. Returns the parsed object or null. */
export function configFromUrl(): unknown {
  const raw = new URL(location.href).searchParams.get("cfg");
  if (!raw) return null;
  try {
    const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function configToUrlParam(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
