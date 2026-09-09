/** Keyboard + pointer-lock mouse. Look deltas accumulate between frames. */
export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  locked = false;
  /** While true (chat open) game keys are ignored and released. */
  captured = false;
  private dragging = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (this.captured) {
        // Only the chat's own keys matter now; the line itself stops propagation.
        if (e.code === "Enter" || e.code === "Escape") this.pressed.add(e.code);
        return;
      }
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
    // Pointer lock when we can get it; otherwise drag-to-look with the left
    // button (hosts that refuse pointer lock, trackpads in embedded views).
    window.addEventListener("mousemove", (e) => {
      if (this.locked || (this.dragging && (e.buttons & 1))) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.dragging = true; });
    window.addEventListener("mouseup", () => { this.dragging = false; });
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* host refuses pointer lock — drag-to-look stays available */
    }
  }

  /** True once per key press. */
  once(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  /** Drain accumulated look deltas. */
  takeLook(): { x: number; y: number } {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  /** Movement axes in camera space: x right, z forward (each -1..1). */
  axes(): { x: number; z: number } {
    const d = this.down;
    const x = (d.has("KeyD") || d.has("ArrowRight") ? 1 : 0) - (d.has("KeyA") || d.has("ArrowLeft") ? 1 : 0);
    const z = (d.has("KeyW") || d.has("ArrowUp") ? 1 : 0) - (d.has("KeyS") || d.has("ArrowDown") ? 1 : 0);
    return { x, z };
  }

  endFrame(): void {
    this.pressed.clear();
  }

  setCaptured(on: boolean): void {
    this.captured = on;
    if (on) this.down.clear();
  }
}
