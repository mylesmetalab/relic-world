/**
 * Small persisted preferences and the shared-world clock.
 */

const STL_KEY = "relic-world:stl";

/** Whether the packed STL miniatures (Bast, Rook, Cam) are in the cast. Off
 *  by default — the cave's own procedural characters are the cast. */
export function stlEnabled(): boolean {
  return localStorage.getItem(STL_KEY) === "1";
}
export function setStlEnabled(on: boolean): void {
  localStorage.setItem(STL_KEY, on ? "1" : "0");
}

const CONTROL_SCHEME_KEY = "relic-world:control-scheme";

/** "auto" guesses mouse vs. trackpad from wheel-event shape (see `Input`);
 *  the others force a device so the look-sensitivity multiplier is fixed. */
export type ControlScheme = "auto" | "mouse" | "trackpad";

export function getControlScheme(): ControlScheme {
  const v = localStorage.getItem(CONTROL_SCHEME_KEY);
  return v === "mouse" || v === "trackpad" ? v : "auto";
}
export function setControlScheme(scheme: ControlScheme): void {
  localStorage.setItem(CONTROL_SCHEME_KEY, scheme);
}

/** The shared world rolls to a new seed on a fixed clock, so everyone who
 *  opens the game without a `?seed=` lands in the same cave — and the cave
 *  itself is never the same for long. */
export const WORLD_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function sharedSeed(now = Date.now()): number {
  const epoch = Math.floor(now / WORLD_INTERVAL_MS);
  // Scramble so consecutive worlds don't look like neighbours.
  let h = (epoch * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  return (h % 9973) + 1;
}

/** Milliseconds until the shared world rolls. */
export function msUntilRoll(now = Date.now()): number {
  return WORLD_INTERVAL_MS - (now % WORLD_INTERVAL_MS);
}
