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

/** Resolution each page panel is captured at — cropped to fit its slot on compose. */
const PANEL_W = 1000;
const PANEL_H = 750;
const PANEL_MAX = 3;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("panel image failed to load"));
    img.src = src;
  });
}

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
  /** Stills queued for the next composed comic page, up to PANEL_MAX. */
  private panels: string[] = [];
  private panelStatus: HTMLSpanElement;

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
      <hr>
      <label>Comic page <span class="k" data-k="panelStatus">0/3 panels</span></label>
      <button data-k="addPanel">Add panel</button>
      <button data-k="makePage">Make page</button>
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

    this.panelStatus = q<HTMLSpanElement>("panelStatus");
    q<HTMLButtonElement>("addPanel").addEventListener("click", () => this.addPanel());
    q<HTMLButtonElement>("makePage").addEventListener("click", () => { void this.makePage(); });

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
    this.panels = [];
    this.updatePanelUI();
    document.exitPointerLock?.();
  }

  exit(): void {
    this.active = false;
    this.panel.hidden = true;
    setInkMapEnabled(this.p, true);
    this.figure.setVisible(true);
    this.onExit();
  }

  private updatePanelUI(): void {
    this.panelStatus.textContent = `${this.panels.length}/${PANEL_MAX} panels`;
  }

  /** Grab the current framing as one panel for the comic page (up to PANEL_MAX). */
  private addPanel(): void {
    if (this.panels.length >= PANEL_MAX) {
      this.status.textContent = `page full at ${PANEL_MAX} — make page to start a new one`;
      return;
    }
    this.panels.push(renderStill(this.p, PANEL_W, PANEL_H));
    this.updatePanelUI();
    this.status.textContent = `panel ${this.panels.length}/${PANEL_MAX} captured`;
  }

  /**
   * Compose the queued panels into one comic page: 24 px paper gutters, one
   * wide panel on top, two small panels below it, and a paper/ink caption
   * strip at the bottom. Downloads the page as a PNG and clears the buffer.
   */
  private async makePage(): Promise<void> {
    if (this.panels.length === 0) {
      this.status.textContent = "add a panel first";
      return;
    }
    this.status.textContent = "composing page…";
    const shots = this.panels;
    const imgs = await Promise.all(shots.map(loadImage));

    const GUTTER = 24;
    const pageW = 1200;
    const wideH = 620;
    const smallH = 420;
    const captionH = 160;
    const contentW = pageW - GUTTER * 2;
    const pageH = GUTTER * 4 + wideH + smallH + captionH;

    const c = document.createElement("canvas");
    c.width = pageW;
    c.height = pageH;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, pageW, pageH);

    const drawCover = (img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number) => {
      if (!img) {
        ctx.fillStyle = "#1c1c28";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#e8e4d0";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.fillStyle = "#e8e4d0";
        ctx.font = "20px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("(no panel)", x + w / 2, y + h / 2);
        return;
      }
      const scale = Math.max(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
    };

    const wideY = GUTTER;
    drawCover(imgs[0], GUTTER, wideY, contentW, wideH);
    const smallY = wideY + wideH + GUTTER;
    const smallW = (contentW - GUTTER) / 2;
    drawCover(imgs[1], GUTTER, smallY, smallW, smallH);
    drawCover(imgs[2], GUTTER + smallW + GUTTER, smallY, smallW, smallH);

    const capY = smallY + smallH + GUTTER;
    ctx.fillStyle = "#e8e4d0";
    ctx.fillRect(GUTTER, capY, contentW, captionH);
    ctx.strokeStyle = "#0a0a12";
    ctx.lineWidth = 4;
    ctx.strokeRect(GUTTER + 2, capY + 2, contentW - 4, captionH - 4);
    ctx.fillStyle = "#0a0a12";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 34px ui-monospace, Menlo, monospace";
    ctx.fillText("RELIC WORLD", GUTTER + 20, capY + 52);
    ctx.font = "18px ui-monospace, Menlo, monospace";
    const colorwayName = COLORWAYS[this.figure.colorway]?.name ?? "";
    const dateStr = new Date().toISOString().slice(0, 10);
    ctx.fillText(`${colorwayName} — ${dateStr}`, GUTTER + 20, capY + 84);
    ctx.font = "italic 16px ui-monospace, Menlo, monospace";
    ctx.fillText("an expedition into the dark", GUTTER + 20, capY + 116);

    const url = c.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `relic-world-page-${Date.now()}.png`;
    a.click();
    this.status.textContent = `page saved (${shots.length} panel${shots.length === 1 ? "" : "s"})`;
    this.panels = [];
    this.updatePanelUI();
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
