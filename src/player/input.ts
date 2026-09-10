import { CFG } from "../world/config";
import { getControlScheme, setControlScheme, type ControlScheme } from "../world/settings";

/** Keyboard + pointer-lock mouse. Look deltas accumulate between frames. */
export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  locked = false;
  /** While true (chat open) game keys are ignored and released. */
  captured = false;
  /** "free": the cursor is visible and the RIGHT button drags the view;
   *  "locked": pointer lock, FPS style. L toggles. */
  lookMode: "free" | "locked" = "free";
  /** Two-finger swipe / wheel turns the view (off while photo mode zooms). */
  wheelLooks = true;
  /** Mouse vs. trackpad look sensitivity: "auto" guesses from wheel-event
   *  shape (see `guessDeviceFromWheel`); the tune panel can force either.
   *  Persisted (`world/settings.ts`) so a choice survives a reload. */
  controlScheme: ControlScheme = getControlScheme();
  /** The device "auto" currently guesses. Starts "mouse" — today's behaviour
   *  — until a wheel event gives a signal one way or the other. */
  private guessedDevice: "mouse" | "trackpad" = "mouse";
  private dragging = false;
  private rightDown = false;
  /** Fed by the touch stick; added to the keyboard axes. */
  readonly touchAxes = { x: 0, z: 0 };
  /** A finger held still on the look side keeps digging. */
  touchDig = false;
  /** Left button currently held (continuous digging). */
  get leftDown(): boolean {
    return this.dragging || this.touchDig;
  }

  /** A one-shot key press from a UI control (touch button). */
  press(code: string): void {
    if (this.captured) return;
    this.pressed.add(code);
  }
  /** Hold / release a key from a UI control. */
  hold(code: string, on: boolean): void {
    if (on) this.down.add(code);
    else this.down.delete(code);
  }

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
      if (this.locked || (this.rightDown && (e.buttons & 2))) {
        const m = this.sensMultiplier();
        this.lookX += e.movementX * m;
        this.lookY += e.movementY * m;
      }
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.dragging = true;
        this.pressed.add("Mouse0");
      } else if (e.button === 2) {
        this.rightDown = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.dragging = false;
      if (e.button === 2) this.rightDown = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // Trackpads: a two-finger swipe looks around (free mode). Photo mode uses
    // the wheel for zoom instead, so it can switch this off.
    canvas.addEventListener("wheel", (e) => {
      this.guessDeviceFromWheel(e);
      if (this.locked || !this.wheelLooks) return;
      e.preventDefault();
      const m = this.sensMultiplier();
      this.lookX += e.deltaX * 1.1 * m;
      this.lookY += e.deltaY * 1.1 * m;
    }, { passive: false });
  }

  /** Refine the auto-detect guess from one wheel event's shape. Trackpads
   *  fire frequent, often-fractional `deltaMode: 0` (pixel) deltas that are
   *  small per physical gesture; mouse wheels fire `deltaMode: 1` (line)
   *  deltas, or big, whole-number pixel jumps with no horizontal component.
   *  Cheap enough to re-run on every event — no need to freeze after "the
   *  first few". A no-op once the scheme is set explicitly. */
  private guessDeviceFromWheel(e: WheelEvent): void {
    if (this.controlScheme !== "auto") return;
    const looksTrackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
    const looksMouse = e.deltaMode === 1 || (e.deltaMode === 0 && e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (looksTrackpad && !looksMouse) this.guessedDevice = "trackpad";
    else if (looksMouse && !looksTrackpad) this.guessedDevice = "mouse";
    // else ambiguous — keep the previous guess.
  }

  /** Persist and apply a control-scheme choice (from the tune panel). */
  setControlScheme(scheme: ControlScheme): void {
    this.controlScheme = scheme;
    setControlScheme(scheme);
  }

  /** The concrete device the current scheme resolves to. */
  resolvedDevice(): "mouse" | "trackpad" {
    return this.controlScheme === "auto" ? this.guessedDevice : this.controlScheme;
  }

  /** Look-sensitivity multiplier (`world/config.ts`) for the resolved device. */
  private sensMultiplier(): number {
    return this.resolvedDevice() === "trackpad" ? CFG.controls.trackpadSens : CFG.controls.mouseSens;
  }

  requestLock(): void {
    if (this.locked || this.lookMode !== "locked") return;
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
    const x = (d.has("KeyD") ? 1 : 0) - (d.has("KeyA") ? 1 : 0) + this.touchAxes.x;
    const z = (d.has("KeyW") ? 1 : 0) - (d.has("KeyS") ? 1 : 0) + this.touchAxes.z;
    return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
  }

  /** Arrow keys look (for keyboards without a comfortable drag). Pixels-equivalent per second. */
  arrowLook(dt: number): { x: number; y: number } {
    const d = this.down;
    const rate = 520 * dt;
    return {
      x: ((d.has("ArrowRight") ? 1 : 0) - (d.has("ArrowLeft") ? 1 : 0)) * rate,
      y: ((d.has("ArrowDown") ? 1 : 0) - (d.has("ArrowUp") ? 1 : 0)) * rate,
    };
  }

  endFrame(): void {
    this.pressed.clear();
  }

  setCaptured(on: boolean): void {
    this.captured = on;
    if (on) this.down.clear();
  }
}
