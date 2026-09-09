import type { InkMap } from "../world/inkmap";

/**
 * The map IS the ink map: a sheet of paper that prints in as you explore.
 * Tab toggles it. Drawn from the same R8 texture the shaders read, so what
 * the map shows is exactly what you have inked, plus a dot per player.
 */
export class PaperMap {
  private readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch: ImageData;
  open = false;

  constructor(private readonly ink: InkMap) {
    this.el = document.getElementById("map") as HTMLCanvasElement;
    this.el.width = ink.size;
    this.el.height = ink.size;
    this.ctx = this.el.getContext("2d")!;
    this.scratch = this.ctx.createImageData(ink.size, ink.size);
  }

  toggle(): void {
    this.open = !this.open;
    this.el.hidden = !this.open;
  }

  /** Redraw (call at ~10 Hz while open). `me` and `others` are world xz. */
  draw(me: { x: number; z: number; yaw: number }, others: Array<{ x: number; z: number }>): void {
    if (!this.open) return;
    const { size, data, x0, z0 } = this.ink;
    const px = this.scratch.data;
    for (let i = 0; i < size * size; i++) {
      const v = data[i]! / 255;
      // Paper where unprinted; violet ink where visited (stronger = more printed).
      const k = i * 4;
      px[k] = Math.round(232 - v * (232 - 80));
      px[k + 1] = Math.round(228 - v * (228 - 40));
      px[k + 2] = Math.round(208 - v * (208 - 140));
      px[k + 3] = 255;
    }
    this.ctx.putImageData(this.scratch, 0, 0);
    // Grid every 24 m (chunk seams), faint.
    this.ctx.strokeStyle = "rgba(10,10,18,0.12)";
    this.ctx.lineWidth = 1;
    for (let g = 0; g <= size; g += 24) {
      this.ctx.beginPath();
      this.ctx.moveTo(g + 0.5, 0);
      this.ctx.lineTo(g + 0.5, size);
      this.ctx.moveTo(0, g + 0.5);
      this.ctx.lineTo(size, g + 0.5);
      this.ctx.stroke();
    }
    const dot = (x: number, z: number, color: string, r: number) => {
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x - x0, z - z0, r, 0, Math.PI * 2);
      this.ctx.fill();
    };
    for (const o of others) dot(o.x, o.z, "#46e0c8", 3);
    dot(me.x, me.z, "#f2f542", 3.5);
    // Heading tick.
    this.ctx.strokeStyle = "#f2f542";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(me.x - x0, me.z - z0);
    this.ctx.lineTo(me.x - x0 - Math.sin(me.yaw) * 9, me.z - z0 - Math.cos(me.yaw) * 9);
    this.ctx.stroke();
  }
}
