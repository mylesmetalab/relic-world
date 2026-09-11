import { CFG, DEFAULTS, configToUrlParam, loadConfig, resetConfig, type Tunables } from "../world/config";
import { BIOMES, type Biome } from "../world/biomes";
import { ENVWAYS } from "../render/palette";
import { setStlEnabled, stlEnabled } from "../world/settings";
import type { Input } from "../player/input";

/**
 * The secret tuning panel (backtick). Every number the look and the world
 * are built from, as sliders; biomes get their own tabs (ramp, ground,
 * pen). Render changes are live; world changes need "Rebuild world".
 * Export copies JSON (config + biomes) to the clipboard and shows it — paste
 * that back to me and it becomes the default. Import pastes it in.
 */

type Range = [number, number, number]; // min, max, step

const RANGES: Record<keyof Tunables, Record<string, Range>> = {
  world: { floorBase: [0, 8, 0.1], ceilBase: [6, 40, 0.5], wallLo: [0.3, 0.9, 0.01], wallHi: [0.3, 0.95, 0.01], climbSolidity: [0.3, 0.98, 0.01], biomeScale: [30, 300, 5], dunes: [8, 80, 1], chop: [2, 20, 0.5], ceilRelief: [0, 12, 0.1], crust: [1, 24, 0.5], vaultRadius: [1.2, 5, 0.1], vaultRing: [0.4, 2.5, 0.1], vaultTorchRange: [1, 8, 0.5], propUpperDensity: [0, 1, 0.05], torchLifeSec: [10, 600, 5], presenceEnabled: [0, 1, 1], biomeHopRadius: [50, 1000, 10], dayNightCycleSec: [60, 3600, 30], nightIntensity: [0, 1, 0.05], nightPersonalReach: [1, 20, 0.5] },
  light: { localReach: [8, 80, 1], remoteReach: [4, 60, 1], inkStamp: [4, 60, 1], fogNear: [2, 80, 1], fogFar: [10, 200, 1], fog: [0, 1, 0.01], fogTone: [0, 1, 0.01], mottle: [0, 1, 0.01], shadowGamma: [0.4, 3, 0.05], ceilCell: [6, 80, 1], ceilArcSpacing: [0.4, 6, 0.1] },
  press: { printScale: [0.2, 1, 0.05], misreg: [0, 3, 0.1], edgeW: [0.5, 3, 0.1], depthCut: [0.002, 0.05, 0.001], normalCut: [0.1, 1, 0.01], grain: [0, 1, 0.01], speck: [0, 0.02, 0.0005], halftone: [0, 1, 0.01], halftoneScale: [2, 24, 0.5], halftoneAngle: [0, 90, 1], depthStrange: [0, 2, 0.05], shadowLift: [0, 1, 0.05] },
  dig: { radius: [0.6, 5, 0.1], depth: [0.1, 4, 0.05], tunnelRadius: [0.8, 6, 0.1], rate: [1, 20, 1], reach: [2, 12, 0.5], stepUp: [0.8, 2.2, 0.1] },
  figure: { hull: [0, 3, 0.05], hatchRange: [0.2, 0.95, 0.01], black: [0, 0.4, 0.005], pitch: [3, 16, 0.5], nib: [0.3, 2, 0.05], rim: [0, 1, 0.01], fill: [0, 1, 0.01], stipple: [0, 1, 0.01], formFollow: [0, 1, 0.01], zoneSoft: [0, 0.2, 0.005], zoneJitter: [0, 0.1, 0.005], hiCut: [0.3, 1, 0.01], hatchStyle: [0, 1, 1] },
  player: { landHardSpeed: [4, 25, 0.5], landStumbleDur: [0, 1.2, 0.05], landThumpMag: [0, 1, 0.01], landChipCount: [4, 60, 1], groundEscapeMargin: [1, 15, 0.5], impactPropSpeed: [2, 20, 0.5], impactPlayerSpeed: [4, 24, 0.5], impactRadius: [0.5, 5, 0.1] },
  controls: { mouseSens: [0.3, 3, 0.05], trackpadSens: [0.3, 3, 0.05] },
  presence: { wanderSpeed: [0.2, 4, 0.1], fleeSpeed: [0.5, 8, 0.1], fleeRadius: [4, 30, 1], retargetSec: [1, 20, 0.5], wanderRadius: [3, 30, 1], hearRadius: [4, 40, 1] },
};
const PEN_RANGES: Record<string, Range> = {
  hatchRange: [0.2, 0.95, 0.01], black: [0, 0.8, 0.01], pitchScale: [0.4, 3, 0.05], nib: [0.3, 2, 0.05], cracks: [0, 1, 0.01], stipple: [0, 1, 0.01], hatchRot: [-1.6, 1.6, 0.05], formFollow: [0, 1, 0.01],
};
const GROUND_RANGES: Record<string, Range> = { terrace: [0, 3, 0.1], relief: [0.2, 2, 0.05], rocks: [0, 30, 1], tallShare: [0, 1, 0.05], ceilLift: [0, 40, 1] };

// Hover tooltips (pure text) — what each control does and what to expect
// moving it, since the tune panel has ~90 numbers across very different
// systems and it's genuinely hard to tell from the label alone. "Rebuild"
// in a description means: this reshapes terrain, so nothing visibly
// changes until you hit "Rebuild world" (or it changes for new chunks
// only). Everything else takes effect live, next frame.
const SECTION_DESC: Record<keyof Tunables, string> = {
  world: "Terrain shape and world rules — most of these need Rebuild world to see.",
  light: "How far light reaches, and the fog/mottle/shadow look.",
  press: "The print pass: ink line detection, paper texture, halftone, speckle — applied to the whole frame, not per-object.",
  dig: "How digging behaves — size, speed, reach.",
  figure: "Every figure's own ink material — separate from a biome's rock pen.",
  player: "Landing/impact feedback (camera thump, chips, stumble) and the physics-escape rescue.",
  controls: "Look sensitivity for mouse vs trackpad.",
  presence: "The wandering presence's movement and behaviour (private worlds only).",
};
const DESCRIPTIONS: Record<keyof Tunables, Record<string, string>> = {
  world: {
    floorBase: "Base height of the lower cave's floor before noise — raises or lowers the whole cave's ground level.",
    ceilBase: "Base height of the lower cave's ceiling — raises or lowers headroom (before Cathedral's extra lift).",
    wallLo: "Solidity where a wall starts forming (with wallHi, below). Narrower gap to wallHi = sharper wall edges; wider = softer, more gradual walls.",
    wallHi: "Solidity where a wall becomes fully solid — see wallLo.",
    climbSolidity: "Wall climbing only grips where solidity is below this. Lower = fewer surfaces grip (feels slippery); higher = more surfaces grip (feels soft/crumbly). Per-biome overrides exist too.",
    biomeScale: "Metres per biome region. Bigger = fewer, larger biome patches (walk further before it changes); smaller = biomes change more often as you walk.",
    dunes: "Wavelength (metres) of the broad rolling floor undulation. Bigger = wider, gentler hills; smaller = tighter rolls.",
    chop: "Wavelength (metres) of the rocky floor detail on top of the dunes. Smaller = more small bumps and roughness underfoot.",
    ceilRelief: "How much the ceiling's own noise varies its height. 0 = flat ceiling; higher = more bumps and sag.",
    crust: "Metres of solid rock between the surface and the cave under it — how deep you have to dig before breaking through.",
    vaultRadius: "How big a sealed two-torch vault room is, in metres. Existing vaults keep their size unless the world is rebuilt.",
    vaultRing: "Thickness of a vault's sealed ring wall, in metres.",
    vaultTorchRange: "How close a placed torch must stand to a vault door pillar to count toward opening it.",
    propUpperDensity: "Multiplier on shard/shrine/relic counts on the surface and gallery levels vs the lower cave (always ×1) — keeps the upper levels' scatter lighter.",
    torchLifeSec: "How long a torch YOU place (X) burns before it goes dark and vanishes, in seconds. World/shrine torches never expire regardless of this.",
    presenceEnabled: "Turns the wandering presence on/off. It only ever exists in private (?seed=) worlds regardless of this switch — it's an extra kill switch on top of that.",
    biomeHopRadius: "Max search distance (metres) for hopping to another biome (B / the button below). Too small and a far biome just won't be found — you'll get a 'none nearby' message instead of a long hang.",
    dayNightCycleSec: "How long a full day→night→day cycle takes, in seconds, in Auto phase. Ignored when a phase is locked (Day/Dusk/Night below).",
    nightIntensity: "Safety valve for the whole night-darkening effect: 0 disables it completely (looks like day at any phase); 1 is the full tuned strength.",
    nightPersonalReach: "How far YOUR own carried light reaches at full night (1.0 phase) — day's much bigger reach (see light.localReach) shrinks toward this as night falls. Small values make night feel genuinely dark; large values make night barely different from day.",
  },
  light: {
    localReach: "How far your own carried torch lights and permanently inks the rock around you, in metres. Higher = see and print further without placing a torch. Shrinks toward nightPersonalReach at night.",
    remoteReach: "Same idea as localReach, but for how far you see OTHER players' carried light reach.",
    inkStamp: "Radius (metres) your own position permanently inks into the map every frame, regardless of torch reach — the baseline 'you've been here' trail.",
    fogNear: "Distance (metres) where distance fog starts fading rock toward fogTone.",
    fogFar: "Distance (metres) where distance fog finishes — fully faded to fogTone beyond this. Push it out for a longer effective view distance.",
    fog: "Strength of the distance fog overall. 0 = no fog, full contrast at any distance; 1 = fully fades to fogTone by fogFar.",
    fogTone: "Which end of the current biome's colour ramp the fog fades toward — 0 is the ramp's dark end, 1 its bright end.",
    mottle: "Strength of the blotchy stain variation in a rock's shadowed tone. 0 = flat shadow; higher = more mottled/stained shadow texture.",
    shadowGamma: "Contrast curve on the shadow falloff. Lower = the shadow band appears sooner and wider (reads dark faster); higher = delays it (reads lit for longer).",
    ceilCell: "Size (metres) of one ceiling brush-arc ring cell — bigger cells read as fewer, larger arcs.",
    ceilArcSpacing: "How tightly packed the ceiling's brush arcs are within a cell. Smaller = denser rings.",
  },
  press: {
    printScale: "Print resolution as a fraction of the canvas. Lower = blockier but cheaper (this is the phone-quality lever); 1 = the sharpest the display allows. The single biggest performance knob in the whole panel.",
    misreg: "How far the ink line misregisters from the true edge, in print pixels — the 'hand-printed, slightly off' look. 0 = perfectly aligned; higher = sloppier, and it grows further with depth below the surface.",
    edgeW: "How far apart the edge-detector's four samples are spaced. Wider picks up more/thicker ink lines (can add false lines on noisy surfaces); narrower is more precise but can miss shallow edges.",
    depthCut: "How big a depth discontinuity has to be before it's drawn as an ink line. Lower = catches more/subtler edges (busier linework); higher = only hard breaks get a line.",
    normalCut: "How sharp a surface-angle change has to be before it's drawn as an ink line. Lower = gentle creases get lined too; higher = only sharp folds do.",
    grain: "How much the paper's own tooth/grain texture mixes into every surface's colour. 0 = flat colour; 1 = heavily textured.",
    speck: "Density of small paper flecks scattered across the whole frame (grows with depth below the surface). 0 removes it entirely.",
    halftone: "Strength of dot-halftone shading inside shadowed areas. 0 = the plain flat posterized shadow; higher adds a visible risograph-style dot pattern.",
    halftoneScale: "Size of the halftone dots. Bigger = bigger, more visible dots; smaller = a finer dot pattern.",
    halftoneAngle: "Rotation (degrees) of the halftone dot grid. Doesn't change density, just its orientation (real riso halftones are often angled to avoid moiré).",
    depthStrange: "Overall intensity of 'deeper is stranger' — pen jitter, misregistration, ceiling-arc density and paper dimming all scale with depth below the surface × this. 0 = flat regardless of depth; 1 = the tuned amount; higher exaggerates it.",
    shadowLift: "Shrinks each biome's flat-black cutoff toward 0, live. 0 = today's default look (shadow can go solid flat black); 1 = shadow never goes fully flat, always keeps some hatched texture. A way to feel out 'shading reads as darkness/abyss' for yourself.",
  },
  dig: {
    radius: "Radius of a single dig, in metres — how wide a bite it takes out of the floor or wall. Snaps to the 1 m grid cell, so this is really 'how many cells wide,' not a smooth radius.",
    depth: "How far a single dig lowers the floor (or raises the ceiling, digging up), in metres, per click.",
    tunnelRadius: "Radius used specifically when tunnelling into a wall (aiming forward, not down) — can differ from the floor-dig radius.",
    rate: "How many digs per second land while the button is held down (hold-to-dig).",
    reach: "Maximum distance (metres) you can aim and still dig. Beyond this, clicking does nothing.",
    stepUp: "Aiming up at a wall carves a step this far above your feet, at most — high enough to mantle onto.",
  },
  figure: {
    hull: "Thickness of the white contour outline around every figure's silhouette, in print pixels. 0 removes the outline entirely.",
    hatchRange: "How much of a figure's tone range gets ruled hatching vs flat fill. Higher = more of the body reads as hatched linework rather than solid colour.",
    black: "Tone cutoff below which a figure's surface goes solid flat black instead of hatched. Higher pushes more of the shadow to flat black sooner.",
    pitch: "Spacing (print pixels) between a figure's hatch lines. Smaller = denser, finer hatching; bigger = sparser, bolder lines.",
    nib: "Thickness of each individual hatch stroke on a figure.",
    rim: "Strength of the rim-light highlight along a figure's silhouette edge (facing away from the fill light).",
    fill: "Strength of the soft ambient fill light on a figure's shadow side. 0 = the shadow side stays fully dark; higher lifts it.",
    stipple: "Density of dot-stipple texture in a figure's darker tones, as an alternative/addition to ruled hatching.",
    formFollow: "How much a figure's hatch direction curves to follow its own surface contours vs staying in fixed rule families. 0 = rigid ruled lines; 1 = fully follows the form.",
    zoneSoft: "How soft the blend is between a figure's colour zones. 0 = a hard cut between zones; higher feathers the transition.",
    zoneJitter: "Random wobble on a figure's colour-zone boundaries, so they don't read as perfectly smooth geometric bands.",
    hiCut: "Tone threshold above which a figure's surface reads as the brightest highlight band.",
    hatchStyle: "0 = ruled hatch-line families (the default look); 1 = contour dashes that trace the form instead.",
  },
  player: {
    landHardSpeed: "Vertical landing speed (m/s) above which a landing reads as 'hard': camera thump, an ink-chip puff, and a brief no-input stumble. A gentle hop stays silent below this; a big drop always triggers above it.",
    landStumbleDur: "How long (seconds) movement input is ignored/dampened right after a hard landing.",
    landThumpMag: "How deep the camera dips on a hard landing, scaled by how hard the landing was.",
    landChipCount: "How many ink chips fly at the landing point on a hard landing, scaled by how hard.",
    groundEscapeMargin: "How far below every level's floor (metres) you can fall before being teleported back up to solid ground, in case physics ever lets you slip through.",
    impactPropSpeed: "Speed (m/s) a nearby dynamic prop must be moving to register as hitting you — the same camera-thump/chip/stumble feedback as a hard landing, retriggered. An ordinary push or kick stays below this.",
    impactPlayerSpeed: "Speed (m/s) a nearby remote player must be moving (thrown or flung) to register as hitting you. Set above normal walk/run speed so ordinary contact never triggers it.",
    impactRadius: "How close (metres) a fast prop or player must get to you to register as an impact.",
  },
  controls: {
    mouseSens: "Look-sensitivity multiplier for mouse movement (pointer-locked and free-drag alike).",
    trackpadSens: "Look-sensitivity multiplier for trackpad gestures. Usually higher than mouseSens, since a trackpad's raw movement reads smaller per physical gesture at the same nominal sensitivity.",
  },
  presence: {
    wanderSpeed: "How fast (m/s) the wandering presence drifts toward its next target when nothing's chasing it off.",
    fleeSpeed: "How fast (m/s) it flees once a light gets close — faster than wanderSpeed, so fleeing reads as urgent.",
    fleeRadius: "How close (metres) any light (yours, a peer's, or a standing torch) has to get before it flees, directly away from the nearest one.",
    retargetSec: "Average seconds between it picking a new nearby wander target (sooner if it reaches the current one first).",
    wanderRadius: "How far (metres) a newly picked wander target can be from its current position.",
    hearRadius: "How close (metres) YOU have to be, while it's unlit, to hear its occasional sound cue.",
  },
};
const PEN_DESCRIPTIONS: Record<string, string> = {
  hatchRange: "How much of this biome's rock reads as ruled hatching vs flat fill — the same idea as a figure's own hatchRange, but for this biome's terrain.",
  black: "Tone cutoff below which this biome's rock goes solid flat black instead of hatched. Higher biomes (Blood Cave, Void Peaks) push more shadow to flat black; lower ones (Crystal Vein) keep texture longer.",
  pitchScale: "Multiplier on hatch-line spacing for this biome's rock. Higher = sparser lines; lower = denser.",
  nib: "Hatch line thickness for this biome's rock.",
  cracks: "Strength of thin crack/fracture linework across this biome's rock. 0 removes it entirely.",
  stipple: "Density of dot-stipple texture in this biome's darker tones.",
  hatchRot: "Base rotation (radians) of this biome's hatch-line direction — purely cosmetic, a per-biome 'grain direction.'",
  formFollow: "How much this biome's hatch direction curves to follow the rock's own surface contours vs staying in fixed rule families.",
};
const GROUND_DESCRIPTIONS: Record<string, string> = {
  terrace: "Quantises this biome's open floor into steps of this height. 0 = smooth ground; higher = stair-stepped terraces (how Glacier and Void Peaks get climbable ledges).",
  relief: "Multiplies how much this biome's floor noise varies. Lower = flatter ground; higher = rougher, more dramatic terrain.",
  rocks: "How many rocks/stalagmites scatter per chunk in this biome.",
  tallShare: "Of this biome's scattered rocks, the share that spawn as tall stalagmites instead of small boulders.",
  ceilLift: "Extra ceiling height added in this biome, on top of the base. Cathedral uses a big one for its vaulted look.",
};

export type TuneCallbacks = {
  /** Live render values changed (uniforms). */
  onRender: () => void;
  /** Terrain-shaping values changed — rebuild chunks. */
  onRebuild: () => void;
  /** Drop a relic in front of the player (also the G key). */
  onSpawnRelic: () => void;
  /** Hop to the nearest point in a different (cycling) biome (also the B key). */
  onHopBiome: () => void;
};

export class Tune {
  open = false;
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLElement;

  constructor(private readonly cb: TuneCallbacks, private readonly input: Input) {
    this.panel = document.getElementById("tune") as HTMLDivElement;
    this.panel.innerHTML = `<h2>Tuning <span class="k">\` to close</span></h2>
      <div class="tune-actions">
        <button data-k="export" data-tip="Copy the whole panel (every number here, plus every biome) as JSON to your clipboard — paste it back to me if you want a tuned look kept.">Export JSON</button><button data-k="import" data-tip="Paste JSON (from Export, or from me) into the box below first, then click this to apply it.">Import</button><button data-k="link" data-tip="Copy a URL with the current panel baked into a ?cfg= parameter — opening it reproduces this exact look.">Copy link</button>
        <button data-k="rebuild" data-tip="Re-generate terrain chunks with the current world.* values. Needed after changing anything marked (rebuild) — those don't reshape existing ground on their own.">Rebuild world</button><button data-k="reset" data-tip="Restore every slider and every biome to its shipped default.">Reset</button><button data-k="spawn" data-tip="Drop a golden relic on the ground right in front of you, at your own level.">Spawn relic here (G)</button><button data-k="hopbiome" data-tip="Teleport to the nearest point in the next biome in sequence — a quick way to tour all 10 without wandering.">Hop biome (B)</button>
      </div>
      <textarea data-k="json" rows="5" placeholder="paste JSON here, then Import"></textarea>
      <label class="tune-check" data-tip="Adds Bast, Rook and Cam (STL miniatures) to the character cast (C) alongside the procedural golems. Needs a reload to take effect."><input type="checkbox" data-k="stl"> STL miniatures in the cast (Bast, Rook, Cam) — reload to apply</label>
      <div class="tune-actions" data-k="phaseButtons">
        <span data-tip="Which part of the day/night cycle is showing. Auto runs the real clock (dayNightCycleSec, below); the other three freeze it so you can look at — and tune — exactly one phase without waiting.">Time phase</span>
        <button data-phase="auto">Auto</button><button data-phase="day">Day</button><button data-phase="dusk">Dusk</button><button data-phase="night">Night</button>
      </div>
      <label class="tune-row"><span data-tip="Auto guesses mouse vs trackpad from your first scroll/swipe. Mouse and Trackpad force one sensitivity (mouseSens/trackpadSens below) regardless of what you're actually using.">Look controls</span>
        <select data-k="scheme">
          <option value="auto">Auto</option>
          <option value="mouse">Mouse</option>
          <option value="trackpad">Trackpad</option>
        </select>
        <output data-k="schemeOut"></output>
      </label>
      <span class="status" data-k="status"></span>
      <div data-k="sections"></div>`;
    this.status = this.panel.querySelector('[data-k="status"]')!;
    const q = <T extends HTMLElement>(k: string) => this.panel.querySelector<T>(`[data-k="${k}"]`)!;
    const json = q<HTMLTextAreaElement>("json");
    q<HTMLButtonElement>("export").addEventListener("click", () => {
      const text = this.exportJson();
      json.value = text;
      void navigator.clipboard?.writeText(text).then(() => this.say("copied JSON to clipboard"), () => this.say("JSON below (clipboard blocked)"));
    });
    q<HTMLButtonElement>("import").addEventListener("click", () => {
      try {
        this.importJson(json.value);
        this.say("imported — rebuild world for terrain changes");
        this.rebuildUi();
        cb.onRender();
      } catch (e) {
        this.say(`bad JSON: ${String(e)}`);
      }
    });
    q<HTMLButtonElement>("link").addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("cfg", configToUrlParam(this.snapshot()));
      void navigator.clipboard?.writeText(url.toString()).then(() => this.say("link copied"), () => this.say(url.toString()));
    });
    q<HTMLButtonElement>("rebuild").addEventListener("click", () => { cb.onRebuild(); this.say("rebuilt"); });
    q<HTMLButtonElement>("spawn").addEventListener("click", () => { cb.onSpawnRelic(); this.say("relic dropped in front of you"); });
    q<HTMLButtonElement>("hopbiome").addEventListener("click", () => cb.onHopBiome());
    const stl = q<HTMLInputElement>("stl");
    stl.checked = stlEnabled();
    stl.addEventListener("change", () => { setStlEnabled(stl.checked); this.say("saved — reload to change the cast"); });
    const scheme = q<HTMLSelectElement>("scheme");
    scheme.value = input.controlScheme;
    this.refreshSchemeOut();
    scheme.addEventListener("change", () => {
      input.setControlScheme(scheme.value as "auto" | "mouse" | "trackpad");
      this.refreshSchemeOut();
    });
    // Phase lock (brief 20, Myles's explicit ask): actual buttons, not a
    // dropdown — "auto" runs the real day/night clock; the other three
    // freeze `uNight` at a fixed value every frame so a look can be tuned
    // against exactly one phase without waiting for the cycle.
    q<HTMLDivElement>("phaseButtons").querySelectorAll<HTMLButtonElement>("button[data-phase]").forEach((b) => {
      b.addEventListener("click", () => {
        CFG.world.timePhase = b.dataset.phase as Tunables["world"]["timePhase"];
        this.refreshPhaseButtons();
        this.say(`time phase: ${b.dataset.phase}`);
      });
    });
    this.refreshPhaseButtons();
    q<HTMLButtonElement>("reset").addEventListener("click", () => {
      resetConfig();
      for (let i = 0; i < BIOMES.length; i++) Object.assign(BIOMES[i]!.pen, BIOME_DEFAULTS[i]!.pen), Object.assign(BIOMES[i]!, { terrace: BIOME_DEFAULTS[i]!.terrace, relief: BIOME_DEFAULTS[i]!.relief, rocks: BIOME_DEFAULTS[i]!.rocks, tallShare: BIOME_DEFAULTS[i]!.tallShare, ceilLift: BIOME_DEFAULTS[i]!.ceilLift, ramp: BIOME_DEFAULTS[i]!.ramp });
      this.rebuildUi();
      cb.onRender();
      this.say("defaults restored — rebuild world for terrain");
    });
    // Keys typed into the panel must not drive the game.
    this.panel.addEventListener("keydown", (e) => e.stopPropagation());
    this.rebuildUi();
  }

  private say(msg: string): void {
    this.status.textContent = msg;
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.hidden = !this.open;
    if (this.open) {
      this.refreshSchemeOut();
      this.refreshPhaseButtons(); // CFG.world.timePhase can change from outside the panel (?cfg=, the console)
    }
  }

  /** Show which device the current scheme resolves to (only informative for
   *  "auto" — the other two are the device itself). */
  private refreshSchemeOut(): void {
    const out = this.panel.querySelector<HTMLOutputElement>('[data-k="schemeOut"]');
    if (out) out.textContent = this.input.controlScheme === "auto" ? `→ ${this.input.resolvedDevice()}` : "";
  }

  /** Highlight whichever phase button matches `CFG.world.timePhase` — called
   *  on click, and again after Import/Reset can change it from under the UI. */
  private refreshPhaseButtons(): void {
    const host = this.panel.querySelector<HTMLDivElement>('[data-k="phaseButtons"]');
    host?.querySelectorAll<HTMLButtonElement>("button[data-phase]").forEach((b) => {
      b.classList.toggle("on", b.dataset.phase === CFG.world.timePhase);
    });
  }

  /** Config + biomes (pen, ground, ramp name) as one JSON document. */
  snapshot(): unknown {
    return {
      config: CFG,
      biomes: BIOMES.map((b) => ({
        name: b.name,
        ramp: ENVWAYS.find((e) => e.ramp === b.ramp)?.name ?? "Dungeon Cave",
        terrace: b.terrace, relief: b.relief, rocks: b.rocks, tallShare: b.tallShare, ceilLift: b.ceilLift, pen: b.pen,
      })),
    };
  }
  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2);
  }
  importJson(text: string): void {
    const doc = JSON.parse(text) as { config?: unknown; biomes?: Array<Partial<Biome> & { ramp?: string }> };
    if (doc.config) loadConfig(doc.config);
    applyBiomeDoc(doc.biomes);
  }

  private rebuildUi(): void {
    const host = this.panel.querySelector<HTMLDivElement>('[data-k="sections"]')!;
    host.innerHTML = "";
    for (const section of Object.keys(CFG) as Array<keyof Tunables>) {
      const det = document.createElement("details");
      det.open = section === "light";
      const summary = document.createElement("summary");
      summary.innerHTML = `${section}${section === "world" ? " <i>(rebuild)</i>" : ""}`;
      summary.dataset.tip = SECTION_DESC[section];
      det.appendChild(summary);
      const vals = CFG[section] as unknown as Record<string, number>;
      for (const key of Object.keys(vals)) {
        if (key === "timePhase") continue; // its own button row, not a slider
        const r = RANGES[section][key] ?? [0, 1, 0.01];
        det.appendChild(this.slider(key, vals[key]!, r, (v) => {
          vals[key] = v;
          if (section !== "world") this.cb.onRender();
        }, DESCRIPTIONS[section][key]));
      }
      host.appendChild(det);
    }
    BIOMES.forEach((b, i) => {
      const det = document.createElement("details");
      det.innerHTML = `<summary>biome · ${b.name}</summary>`;
      const sel = document.createElement("select");
      for (const e of ENVWAYS) sel.append(new Option(e.name, e.name, false, e.ramp === b.ramp));
      sel.addEventListener("change", () => {
        b.ramp = ENVWAYS.find((e) => e.name === sel.value)!.ramp;
        this.cb.onRender();
      });
      const lab = document.createElement("label");
      lab.textContent = "cave colorway ";
      lab.dataset.tip = "This biome's colour ramp (dark/mid/bright ink stops) — a full palette swap, independent of the pen (hatch style) sliders below.";
      lab.appendChild(sel);
      det.appendChild(lab);
      const ground = b as unknown as Record<string, number>;
      for (const key of Object.keys(GROUND_RANGES)) {
        det.appendChild(this.slider(`${key} (rebuild)`, ground[key]!, GROUND_RANGES[key]!, (v) => { ground[key] = v; }, GROUND_DESCRIPTIONS[key]));
      }
      const pen = b.pen as unknown as Record<string, number>;
      for (const key of Object.keys(PEN_RANGES)) {
        det.appendChild(this.slider(key, pen[key]!, PEN_RANGES[key]!, (v) => { pen[key] = v; this.cb.onRender(); }, PEN_DESCRIPTIONS[key]));
      }
      host.appendChild(det);
      void i;
    });
    this.refreshPhaseButtons();
  }

  private slider(label: string, value: number, r: Range, onChange: (v: number) => void, desc?: string): HTMLLabelElement {
    const el = document.createElement("label");
    el.className = "tune-row";
    // The tip lives on the ROW, not the label span: the span truncates long
    // labels with overflow:hidden, which would clip its own ::after tooltip
    // right along with the text it's supposedly showing.
    if (desc) el.dataset.tip = desc;
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(r[0]);
    input.max = String(r[1]);
    input.step = String(r[2]);
    input.value = String(value);
    const out = document.createElement("output");
    out.textContent = fmt(value);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      onChange(v);
    });
    el.append(name, input, out);
    return el;
  }
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Pristine copy of the biome table for Reset. */
const BIOME_DEFAULTS: Array<{ pen: Biome["pen"]; terrace: number; relief: number; rocks: number; tallShare: number; ceilLift: number; ramp: Biome["ramp"] }> =
  BIOMES.map((b) => ({ pen: { ...b.pen }, terrace: b.terrace, relief: b.relief, rocks: b.rocks, tallShare: b.tallShare, ceilLift: b.ceilLift, ramp: b.ramp }));

/** Apply an imported biome list (by index) onto the live BIOMES. */
export function applyBiomeDoc(list: Array<Partial<Biome> & { ramp?: string | Biome["ramp"] }> | undefined): void {
  if (!Array.isArray(list)) return;
  list.forEach((src, i) => {
    const b = BIOMES[i];
    if (!b || !src) return;
    if (typeof src.ramp === "string") {
      const e = ENVWAYS.find((x) => x.name === src.ramp);
      if (e) b.ramp = e.ramp;
    }
    for (const k of ["terrace", "relief", "rocks", "tallShare", "ceilLift"] as const) {
      const v = src[k];
      if (typeof v === "number") (b as unknown as Record<string, number>)[k] = v;
    }
    if (src.pen && typeof src.pen === "object") {
      for (const k of Object.keys(b.pen) as Array<keyof Biome["pen"]>) {
        const v = (src.pen as Record<string, unknown>)[k];
        if (typeof v === "number") b.pen[k] = v;
      }
    }
  });
}

export { DEFAULTS };
