import * as THREE from "three";
import { COLORWAYS } from "../render/palette";
import { renderStill, setInkMapEnabled, type Pipeline } from "../render/pipeline";
import { rayDistance, type Physics } from "../physics/world";
import type { Figure } from "../player/figure";

/**
 * Photo mode. Freezes the world, releases the mouse, and gives you an orbit
 * camera plus the press controls — colorway, print density, off-register,
 * halftone — and a PNG export at print sizes. Everything is printed while
 * you frame (the ink map is bypassed), so a shot never has bare paper in it
 * unless you want it.
 */

const SIZES: Array<[string, number, number]> = [
  ["Portrait 1080×1350", 1080, 1350],
  ["Portrait 2160×2700", 2160, 2700],
  ["Poster 3000×3750", 3000, 3750],
  ["Square 2048", 2048, 2048],
  ["Wide 2560×1440", 2560, 1440],
];

export class PhotoMode {
  active = false;
  private yaw = 0;
  private pitch = 0.15;
  private dist = 4.5;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly panel: HTMLDivElement;
  private readonly target = new THREE.Vector3();
  private status: HTMLSpanElement;
  private bareToggle: HTMLInputElement;
  private figureToggle: HTMLInputElement;

  constructor(
    private readonly p: Pipeline,
    private readonly ph: Physics,
    private readonly canvas: HTMLCanvasElement,
    private readonly figure: Figure,
    private readonly onExit: () => void,
  ) {
    this.panel = document.getElementById("photo") as HTMLDivElement;
    this.panel.innerHTML = `
      <h2>Photo mode <span class="k">P to leave</span></h2>
      <label>Figure inks <select data-k="ink"></select></label>
      <label>Print density <input type="range" data-k="print" min="0.2" max="1" step="0.05"></label>
      <label>Off-register <input type="range" data-k="misreg" min="0" max="3" step="0.1"></label>
      <label>Halftone <input type="range" data-k="halftone" min="0" max="1" step="0.05"></label>
      <label>Paper tooth <input type="range" data-k="grain" min="0" max="1" step="0.05"></label>
      <label>Contour <input type="range" data-k="contour" min="0" max="3" step="0.05"></label>
      <label><input type="checkbox" data-k="bare"> Leave unlit rock as bare paper</label>
      <label><input type="checkbox" data-k="figure" checked> Show figure</label>
      <label>Export size <select data-k="size"></select></label>
      <button data-k="export">Export PNG</button>
      <span class="status" data-k="status"></span>
      <p class="hint">Drag to orbit · wheel to zoom</p>`;
    const q = <T extends HTMLElement>(k: string) => this.panel.querySelector<T>(`[data-k="${k}"]`)!;
    const ink = q<HTMLSelectElement>("ink");
    COLORWAYS.forEach((c, i) => ink.append(new Option(c.name, String(i))));
    ink.addEventListener("change", () => this.figure.setColorway(Number(ink.value)));
    const bind = (k: string, get: () => number, set: (v: number) => void) => {
      const el = q<HTMLInputElement>(k);
      el.value = String(get());
      el.addEventListener("input", () => set(Number(el.value)));
    };
    bind("print", () => p.printScale, (v) => { p.printScale = v; });
    bind("misreg", () => p.inkPass.uniforms.uMisreg.value, (v) => { p.inkPass.uniforms.uMisreg.value = v; });
    bind("halftone", () => p.inkPass.uniforms.uHalftone.value, (v) => { p.inkPass.uniforms.uHalftone.value = v; });
    bind("grain", () => p.inkPass.uniforms.uGrain.value, (v) => { p.inkPass.uniforms.uGrain.value = v; });
    bind("contour", () => p.hullMat.uniforms.uThick.value, (v) => { p.hullMat.uniforms.uThick.value = v; });
    this.bareToggle = q<HTMLInputElement>("bare");
    this.bareToggle.addEventListener("change", () => setInkMapEnabled(p, this.bareToggle.checked));
    this.figureToggle = q<HTMLInputElement>("figure");
    this.figureToggle.addEventListener("change", () => figure.setVisible(this.figureToggle.checked));
    const size = q<HTMLSelectElement>("size");
    SIZES.forEach((s, i) => size.append(new Option(s[0], String(i))));
    this.status = q<HTMLSpanElement>("status");
    q<HTMLButtonElement>("export").addEventListener("click", () => {
      const [, w, h] = SIZES[Number(size.value)]!;
      this.status.textContent = `printing ${w}×${h}…`;
      requestAnimationFrame(() => {
        const url = renderStill(p, w, h);
        const a = document.createElement("a");
        a.href = url;
        a.download = `relic-world-${Date.now()}.png`;
        a.click();
        this.status.textContent = `saved ${w}×${h}`;
      });
    });

    canvas.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("mouseup", () => { this.dragging = false; });
    window.addEventListener("mousemove", (e) => {
      if (!this.active || !this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.lastY) * 0.006, -0.9, 1.3);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    canvas.addEventListener("wheel", (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.0012), 1.2, 14);
    }, { passive: false });
  }

  enter(yaw: number, pitch: number, dist: number): void {
    this.active = true;
    this.yaw = yaw;
    this.pitch = pitch;
    this.dist = dist;
    this.panel.hidden = false;
    this.panel.querySelector<HTMLSelectElement>('[data-k="ink"]')!.value = String(this.figure.colorway);
    this.bareToggle.checked = false;
    setInkMapEnabled(this.p, false);
    this.figureToggle.checked = true;
    this.figure.setVisible(true);
    document.exitPointerLock?.();
  }

  exit(): void {
    this.active = false;
    this.panel.hidden = true;
    setInkMapEnabled(this.p, true);
    this.figure.setVisible(true);
    this.onExit();
  }

  /** Orbit the frozen figure; the boom shortens on rock like the game camera. */
  update(feet: THREE.Vector3, exclude: Parameters<typeof rayDistance>[4]): void {
    this.target.set(feet.x, feet.y + 1.0, feet.z);
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    const hit = rayDistance(this.ph, this.target, dir, this.dist, exclude);
    const d = hit != null ? Math.max(0.5, hit - 0.25) : this.dist;
    this.p.camera.position.copy(this.target).addScaledVector(dir, d);
    this.p.camera.lookAt(this.target);
  }
}
