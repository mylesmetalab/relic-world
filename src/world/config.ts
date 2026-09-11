/**
 * Everything the tuning panel can dial. One mutable object; the world, the
 * pipeline and main read it at use time, so a change is live (render) or
 * takes effect on the next rebuild (terrain). Export/import is plain JSON —
 * paste it back and it becomes the default.
 */

import { Capacitor } from "@capacitor/core";

export type Tunables = {
  world: {
    floorBase: number;
    ceilBase: number;
    /** Solidity range that becomes wall (smoothstep lo→hi). */
    wallLo: number;
    wallHi: number;
    /** Wall climb only grips where solidity is below this — pillar cores
     *  (near-1 solidity) read as smooth black fill, no hatch, no grip. */
    climbSolidity: number;
    /** Metres per biome-noise unit. */
    biomeScale: number;
    /** Metres per floor-noise unit (broad dunes) and rocky chop. */
    dunes: number;
    chop: number;
    ceilRelief: number;
    /** Metres of rock between the surface and the cave under it. */
    crust: number;
    /** Two-torch vault: ring-wall radius and thickness (metres). */
    vaultRadius: number;
    vaultRing: number;
    /** How close a placed torch must stand to a door pillar to count. */
    vaultTorchRange: number;
    /** Multiplier on shard/shrine/relic counts and chances for the surface
     *  and gallery levels, vs the lower cave (level 2, always ×1) — keeps
     *  the upper sets "lighter" per the design brief. */
    propUpperDensity: number;
    /** How long a PLAYER-PLACED torch (X) burns before it goes out, in
     *  seconds. World/shrine torches (spawned by chunk generation,
     *  `placed: false`) never expire regardless of this value. */
    torchLifeSec: number;
    /** The wandering presence (brief 17), 0/1 — a kill switch independent of
     *  the private/seeded-world gate (`!shared` in main.ts), so it can be
     *  turned off without a redeploy. Only ever active when BOTH this is
     *  truthy AND the world is private. */
    presenceEnabled: number;
    /** Max search radius (metres) for "hop to another biome" (B) — bounded
     *  so a seed with a missing/far biome fails gracefully instead of
     *  hanging the search. */
    biomeHopRadius: number;
  };
  night: {
    /** Night mode's phase lock (Myles's explicit ask): "auto" runs the real
     *  day/night clock (`dayNightCycleSec`); "day"/"dusk"/"night" freeze
     *  `uNight` at a fixed value (0 / 0.5 / 1) every frame regardless of
     *  the clock, so a look can be tuned against exactly one phase without
     *  waiting for the cycle. A discrete mode, not a numeric slider — set
     *  from the Auto/Day/Dusk/Night buttons in the tune panel, the same
     *  custom-control precedent as the mouse/trackpad control scheme
     *  (which lives on `Input`/`settings.ts`, not here — this one has to
     *  live in `CFG` so it rides the existing Export/Copy-link JSON too). */
    timePhase: "auto" | "day" | "dusk" | "night";
    /** Full day→night→day cycle length in "auto" mode, seconds. */
    dayNightCycleSec: number;
    /** Safety valve: 0 fully disables night's darkening (day-like
     *  regardless of phase) via `?cfg=`, without a redeploy, in case the
     *  shared-world default turns out too harsh. 1 is the tuned strength. */
    nightIntensity: number;
    /** The reach of a player's own PASSIVE carried light (`light.localReach`/
     *  `remoteReach`, ~20-30 m by design, for daytime clarity) shrinks
     *  toward this much smaller radius as night falls — without this, night
     *  looked identical to day near any player, since their own always-on
     *  personal light bubble was bigger than most rooms. Placed torches,
     *  vault pillars and world braziers are untouched by this (their own
     *  `reach` field, not `light.localReach`) — they're the reliable light
     *  the whole point of night mode is to make you depend on. Default 0:
     *  Myles's call once the held torch (H) existed as a real alternative —
     *  no passive light at all, so night is genuinely black unless a torch
     *  (held, placed, or a shrine/brazier) is actually reaching you. Slide
     *  it up for a softer, Minecraft-moonlight-ish always-on floor instead.
     *  (`main.ts` clamps the value actually used to a small epsilon above
     *  0 — the light shader's falloff treats an exact 0 reach as "no
     *  falloff, fully lit," the opposite of what a slider all the way down
     *  should mean.) */
    nightPersonalReach: number;
    /** Reach of the equippable HELD torch (H), while it's out. Fixed, like
     *  a placed torch's own `reach` (`TORCH_REACH`) — it doesn't shrink at
     *  night the way `nightPersonalReach` does, since a real held torch
     *  burning is a real held torch burning regardless of the hour. That's
     *  the point of it: separate from the passive glow every player always
     *  has (torch or not), equipping one is a deliberate, visible choice
     *  that actually changes how far you can see, not a bigger version of
     *  the same ambient bubble. */
    heldTorchReach: number;
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
    /** Intensity of the depth-below-surface look (pen jitter, misreg, ceiling
     *  arc density, paper dimming all grow with depth × this). 0 = flat with
     *  depth, 1 = the tuned amount, higher exaggerates it. */
    depthStrange: number;
    /** Shrinks each biome's flat-black cutoff toward 0, live, so an
     *  unlit/shadowed rock face keeps reading as hatched tone instead of
     *  going solid ink — 0 = today's default per-biome look, 1 = shadow
     *  never goes fully flat black. A live way to feel out an alternative
     *  to "shading reads as darkness/abyss" rather than a shipped default. */
    shadowLift: number;
  };
  dig: {
    /** Radius of a dig and how much it removes per click; walls tunnel with their own radius.
     *  Digs snap to the 1 m grid cell, so a radius of ~1.2 drops exactly that cell's
     *  four corners: a body-wide shaft, not a one-vertex funnel. */
    radius: number;
    depth: number;
    tunnelRadius: number;
    /** Digs per second while the button is held. */
    rate: number;
    reach: number;
    /** Aim up at a wall and each dig carves a step this far above your feet at most. */
    stepUp: number;
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
  player: {
    /** |vertical velocity| (m/s) above which a landing reads as "hard": a
     *  camera thump, an ink-chip puff at the landing point, and a brief
     *  no-input stumble — a gentle hop stays silent, a 30 m drop doesn't. */
    landHardSpeed: number;
    /** Seconds of ignored/dampened movement input after a hard landing. */
    landStumbleDur: number;
    /** Camera dip depth (metres) on a hard landing, scaled by how hard. */
    landThumpMag: number;
    /** Ink chips thrown at the landing point on a hard landing, scaled by how hard. */
    landChipCount: number;
    /** A physics escape: how far below every level's floor (metres) before
     *  the player is teleported up to `terrain.groundAt`. */
    groundEscapeMargin: number;
    /** Speed (m/s) a nearby dynamic prop's body must exceed to register as
     *  getting struck by it — the same hard-landing feedback (camera thump,
     *  chip puff, stumble), retriggered. An ordinary push/kick stays below it. */
    impactPropSpeed: number;
    /** Speed (m/s) a nearby remote player's derived velocity must exceed to
     *  register as getting struck by them (thrown/flung into you). Above
     *  ordinary walk/run speed so normal contact never triggers it. */
    impactPlayerSpeed: number;
    /** Radius (m) around the local player a fast prop or player must be
     *  within to register as an impact — the player's capsule plus a bit. */
    impactRadius: number;
  };
  controls: {
    /** Look-sensitivity multiplier applied to mouse deltas — pointer-locked
     *  `movementX/Y` and the free-mode drag-to-look path. */
    mouseSens: number;
    /** Look-sensitivity multiplier applied to trackpad deltas — both
     *  pointer-locked drag and the two-finger wheel-swipe fallback. Higher
     *  than the mouse multiplier: a trackpad's raw deltas (especially via
     *  the wheel path) read smaller per physical gesture at the same nominal
     *  sensitivity. Which multiplier applies depends on `controlScheme`
     *  (`Input`, persisted in `settings.ts`) — "auto" guesses the device from
     *  wheel-event shape. */
    trackpadSens: number;
  };
  presence: {
    /** Metres per second, drifting toward its next wander target. */
    wanderSpeed: number;
    /** Metres per second while fleeing an active light — faster than wander. */
    fleeSpeed: number;
    /** A light (mine, a peer's, or a standing torch) within this many metres
     *  triggers fleeing, directly away from the nearest one. */
    fleeRadius: number;
    /** Seconds (average) between picking a new nearby wander target, or
     *  sooner if it arrives first. */
    retargetSec: number;
    /** How far (metres) a newly picked wander target can be from the current
     *  position. */
    wanderRadius: number;
    /** How close (metres) the LOCAL player must be, while it's unlit, to
     *  hear its occasional sound cue. */
    hearRadius: number;
  };
};

export const DEFAULTS: Tunables = {
  world: { floorBase: 3.0, ceilBase: 11.5, wallLo: 0.56, wallHi: 0.66, climbSolidity: 0.85, biomeScale: 90, dunes: 26, chop: 5.5, ceilRelief: 3.4, crust: 6, vaultRadius: 2.4, vaultRing: 1.0, vaultTorchRange: 3, propUpperDensity: 0.4, torchLifeSec: 180, presenceEnabled: 1, biomeHopRadius: 400 },
  night: { timePhase: "auto", dayNightCycleSec: 60, nightIntensity: 1, nightPersonalReach: 0, heldTorchReach: 16 },
  light: { localReach: 34, remoteReach: 22, inkStamp: 26, fogNear: 14, fogFar: 70, fog: 0.5, fogTone: 0.4, mottle: 0.3, shadowGamma: 1.25, ceilCell: 26, ceilArcSpacing: 1.6 },
  press: { printScale: 0.6, misreg: 0.6, edgeW: 1.0, depthCut: 0.012, normalCut: 0.5, grain: 0.9, speck: 0.004, halftone: 0, halftoneScale: 4, halftoneAngle: 20, depthStrange: 1, shadowLift: 0 },
  dig: { radius: 1.2, depth: 0.3, tunnelRadius: 1.2, rate: 5, reach: 4.5, stepUp: 1.3 },
  figure: { hull: 0.55, hatchRange: 0.5, black: 0.1, pitch: 8, nib: 0.75, rim: 0.4, fill: 0.3, stipple: 0.06, formFollow: 0.6, zoneSoft: 0.04, zoneJitter: 0.035, hiCut: 0.78, hatchStyle: 0 },
  player: { landHardSpeed: 10, landStumbleDur: 0.4, landThumpMag: 0.35, landChipCount: 20, groundEscapeMargin: 4, impactPropSpeed: 6, impactPlayerSpeed: 10, impactRadius: 1.8 },
  controls: { mouseSens: 1.0, trackpadSens: 1.6 },
  presence: { wanderSpeed: 1.0, fleeSpeed: 3.2, fleeRadius: 12, retargetSec: 6, wanderRadius: 10, hearRadius: 18 },
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The live values. Mutated in place by the tuning panel and by `loadConfig`. */
export const CFG: Tunables = clone(DEFAULTS);

/** Deep-merge a partial config (from JSON or the URL) into CFG. Every field
 *  is a number except `night.timePhase` (a discrete string mode), which the
 *  generic numeric loop below skips and a separate check restores. */
export function loadConfig(partial: unknown): void {
  if (!partial || typeof partial !== "object") return;
  const src = partial as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(CFG) as Array<keyof Tunables>) {
    const from = src[section];
    if (!from) continue;
    const to = CFG[section] as unknown as Record<string, number>;
    for (const k of Object.keys(to)) {
      if (k === "timePhase") continue;
      const v = from[k];
      if (typeof v === "number" && Number.isFinite(v)) to[k] = v;
    }
  }
  const phase = (src.night as Record<string, unknown> | undefined)?.timePhase;
  if (phase === "auto" || phase === "day" || phase === "dusk" || phase === "night") CFG.night.timePhase = phase;
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

// ── Quality presets (`?q=low|med|high`) ─────────────────────────────────
// A phone GPU can drop under 30 fps at the desktop `printScale` (0.6). This
// is a discrete choice of device tier, not a continuous tunable — a fixed
// table rather than sliders, so it lives here (for discoverability) instead
// of in `Tunables`/`tune.ts`. `printScale` itself IS a slider (CFG.press);
// the chosen preset just seeds its starting value.

export type Quality = "low" | "med" | "high";

export type QualityPreset = {
  /** Print target resolution = canvas × this. */
  printScale: number;
  /** ChunkManager window radius: a (2r+1)² grid of 24 m chunks kept alive. */
  chunkRadius: number;
  /** Render the ND (normal+depth) pass at half the print resolution — the
   *  edge/hatch read comes out a bit blockier, for a quarter of the pass's
   *  fill cost. */
  ndHalfRes: boolean;
};

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  // Today's desktop default, unchanged.
  high: { printScale: 0.6, chunkRadius: 2, ndHalfRes: false },
  // Same view distance and print density as `high`; only the cheapest lever
  // (ND half-res) is pulled, for mid-tier GPUs.
  med: { printScale: 0.6, chunkRadius: 2, ndHalfRes: true },
  // The brief's phone preset.
  low: { printScale: 0.45, chunkRadius: 1, ndHalfRes: true },
};

/** `?q=` if it names a known preset; otherwise `high` inside the wrapped iOS
 *  app (Myles wants the app to look the same as the web build, not the phone
 *  preset — TestFlight testers have real device GPUs, not the low end this
 *  preset was built for), else auto-pick `low` on a coarse pointer (touch, no
 *  precise mouse — same test `src/ui/touch.ts` uses) in an actual mobile
 *  *browser*, `high` everywhere else. */
export function resolveQuality(param: string | null): Quality {
  if (param === "low" || param === "med" || param === "high") return param;
  if (Capacitor.isNativePlatform()) return "high";
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "low" : "high";
}
