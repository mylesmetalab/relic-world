import * as THREE from "three";

/**
 * Text chat as speech bubbles. Enter opens the line; what you type streams
 * to everyone as you type (the draft rides the state heartbeat), Enter sends,
 * Escape cancels. A sent line hangs above the figure for a few seconds.
 * Bubbles are DOM, positioned by projecting each figure's head each frame.
 */

const HOLD_MS = 7000;

export type Bubble = { text: string; until: number; typing: boolean };

export class Chat {
  private readonly input: HTMLInputElement;
  private readonly layer: HTMLDivElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private readonly toastEl: HTMLDivElement;
  private toastUntil = 0;
  /** My current bubble (draft or sent), or null. */
  mine: Bubble | null = null;
  open = false;

  constructor(private readonly camera: THREE.Camera, private readonly canvas: HTMLCanvasElement) {
    this.input = document.getElementById("chat") as HTMLInputElement;
    this.layer = document.getElementById("bubbles") as HTMLDivElement;
    this.toastEl = document.getElementById("toast") as HTMLDivElement;
    this.input.addEventListener("input", () => {
      const t = this.input.value.slice(0, 120);
      this.mine = t ? { text: t, until: Infinity, typing: true } : null;
    });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const t = this.input.value.trim().slice(0, 120);
        this.mine = t ? { text: t, until: performance.now() + HOLD_MS, typing: false } : null;
        this.close();
      } else if (e.key === "Escape") {
        this.mine = null;
        this.close();
      }
    });
    this.input.addEventListener("blur", () => { if (this.open) this.close(); });
  }

  toggle(): void {
    if (this.open) this.close();
    else {
      this.open = true;
      this.input.hidden = false;
      this.input.value = "";
      this.mine = null;
      document.exitPointerLock?.();
      this.input.focus();
    }
  }

  private close(): void {
    this.open = false;
    this.input.hidden = true;
    this.input.value = "";
    this.input.blur();
    this.canvas.focus();
  }

  /** A brief chat-bubble-sized notice not tied to any head, e.g. when the
   *  victim of a grab gets "Stony-13 picked you up". */
  toast(text: string, ms = 2400): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastUntil = performance.now() + ms;
  }

  /** The text peers should see right now (draft gets a caret). */
  outgoing(): string {
    if (!this.mine) return "";
    if (this.mine.typing) return this.mine.text + "▍";
    return performance.now() < this.mine.until ? this.mine.text : "";
  }

  /** Position/update every bubble. `heads` = id → world head position + text. */
  render(heads: Array<{ id: string; head: THREE.Vector3; text: string }>): void {
    const seen = new Set<string>();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    for (const b of heads) {
      if (!b.text) continue;
      seen.add(b.id);
      let el = this.els.get(b.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "bubble";
        this.layer.appendChild(el);
        this.els.set(b.id, el);
      }
      if (el.textContent !== b.text) el.textContent = b.text;
      v.copy(b.head).project(this.camera);
      const behind = v.z > 1 || v.z < -1;
      el.hidden = behind;
      if (!behind) {
        el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        el.style.top = `${(1 - (v.y * 0.5 + 0.5)) * h}px`;
      }
    }
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    if (this.mine && !this.mine.typing && performance.now() >= this.mine.until) this.mine = null;
    if (this.toastUntil && performance.now() >= this.toastUntil) {
      this.toastEl.hidden = true;
      this.toastUntil = 0;
    }
  }
}
