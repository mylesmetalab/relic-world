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
        <button data-k="export">Export JSON</button><button data-k="import">Import</button><button data-k="link">Copy link</button>
        <button data-k="rebuild">Rebuild world</button><button data-k="reset">Reset</button><button data-k="spawn">Spawn relic here (G)</button><button data-k="hopbiome">Hop biome (B)</button>
      </div>
      <textarea data-k="json" rows="5" placeholder="paste JSON here, then Import"></textarea>
      <label class="tune-check"><input type="checkbox" data-k="stl"> STL miniatures in the cast (Bast, Rook, Cam) — reload to apply</label>
      <div class="tune-actions" data-k="phaseButtons">
        <span>Time phase</span>
        <button data-phase="auto">Auto</button><button data-phase="day">Day</button><button data-phase="dusk">Dusk</button><button data-phase="night">Night</button>
      </div>
      <label class="tune-row"><span>Look controls</span>
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
      det.innerHTML = `<summary>${section}${section === "world" ? " <i>(rebuild)</i>" : ""}</summary>`;
      const vals = CFG[section] as unknown as Record<string, number>;
      for (const key of Object.keys(vals)) {
        if (key === "timePhase") continue; // its own button row, not a slider
        const r = RANGES[section][key] ?? [0, 1, 0.01];
        det.appendChild(this.slider(key, vals[key]!, r, (v) => {
          vals[key] = v;
          if (section !== "world") this.cb.onRender();
        }));
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
      lab.appendChild(sel);
      det.appendChild(lab);
      const ground = b as unknown as Record<string, number>;
      for (const key of Object.keys(GROUND_RANGES)) {
        det.appendChild(this.slider(`${key} (rebuild)`, ground[key]!, GROUND_RANGES[key]!, (v) => { ground[key] = v; }));
      }
      const pen = b.pen as unknown as Record<string, number>;
      for (const key of Object.keys(PEN_RANGES)) {
        det.appendChild(this.slider(key, pen[key]!, PEN_RANGES[key]!, (v) => { pen[key] = v; this.cb.onRender(); }));
      }
      host.appendChild(det);
      void i;
    });
    this.refreshPhaseButtons();
  }

  private slider(label: string, value: number, r: Range, onChange: (v: number) => void): HTMLLabelElement {
    const el = document.createElement("label");
    el.className = "tune-row";
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
