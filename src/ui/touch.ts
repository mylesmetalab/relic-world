import type { Input } from "../player/input";

/**
 * Touch controls for phones and tablets (a coarse pointer, or `?touch=1`).
 *
 *  - Left half of the screen: a floating stick. Put a thumb down anywhere
 *    there and drag; it moves you, in camera space, like WASD.
 *  - Right half: drag to look. A tap digs / throws (what the crosshair is
 *    on). Hold still for a moment and you keep digging until you lift.
 *  - A button cluster on the right: jump, grab, torch, run (toggle), plus a
 *    thin row for character, view, map, photo, tune.
 *
 * Everything ends up as key codes in `Input`, so the game does not know or
 * care that it is being touched.
 */
export class TouchControls {
  readonly enabled: boolean;
  private readonly root: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private lookMoved = 0;
  private lookStart = 0;
  private holdTimer = 0;
  private digging = false;
  private runOn = false;

  constructor(private readonly input: Input, private readonly canvas: HTMLCanvasElement) {
    const url = new URL(location.href);
    const forced = url.searchParams.get("touch");
    this.enabled = forced === "1" || (forced !== "0" && matchMedia("(pointer: coarse)").matches);
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.hidden = !this.enabled;
    document.body.appendChild(this.root);
    this.stick = document.createElement("div");
    this.stick.className = "stick";
    this.knob = document.createElement("div");
    this.knob.className = "knob";
    this.stick.appendChild(this.knob);
    this.stick.hidden = true;
    this.root.appendChild(this.stick);
    if (!this.enabled) return;
    document.documentElement.classList.add("touch");

    const cluster = document.createElement("div");
    cluster.className = "cluster";
    cluster.innerHTML = `
      <div class="row small">
        <button data-once="KeyC">char</button><button data-once="KeyV">view</button><button data-once="Tab">map</button>
        <button data-once="KeyP">photo</button><button data-once="Backquote">⚙</button>
      </div>
      <div class="row">
        <button data-hold="ShiftLeft" class="run">run</button><button data-once="KeyX">torch</button>
        <button data-once="KeyF" class="big">grab</button><button data-once="Space" class="big">jump</button>
      </div>`;
    this.root.appendChild(cluster);
    for (const b of cluster.querySelectorAll<HTMLButtonElement>("button")) {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const once = b.dataset.once, hold = b.dataset.hold;
        if (once) input.press(once);
        if (hold) {
          this.runOn = !this.runOn;
          input.hold(hold, this.runOn);
          b.classList.toggle("on", this.runOn);
        }
        b.classList.add("down");
      });
      b.addEventListener("pointerup", () => b.classList.remove("down"));
      b.addEventListener("pointercancel", () => b.classList.remove("down"));
    }

    // The canvas takes the touches; the cluster sits above it.
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.knob.style.transform = "translate(0,0)";
        this.stick.hidden = false;
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        this.lookMoved = 0;
        this.lookStart = performance.now();
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          if (this.lookId === e.pointerId && this.lookMoved < 14) {
            this.digging = true;
            input.touchDig = true;
            input.press("Mouse0");
          }
        }, 260);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") return;
      if (e.pointerId === this.stickId) {
        const dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
        const R = 56;
        const len = Math.hypot(dx, dy);
        const k = len > R ? R / len : 1;
        this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        // Dead zone, then linear to the rim.
        const mag = Math.max(0, (Math.min(len, R) - 8) / (R - 8));
        input.touchAxes.x = len > 0 ? (dx / len) * mag : 0;
        input.touchAxes.z = len > 0 ? (-dy / len) * mag : 0;
      } else if (e.pointerId === this.lookId && !this.digging) {
        const dx = e.clientX - this.lookLast.x, dy = e.clientY - this.lookLast.y;
        this.lookLast = { x: e.clientX, y: e.clientY };
        this.lookMoved += Math.hypot(dx, dy);
        input.lookX += dx * 2.4;
        input.lookY += dy * 2.4;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.stick.hidden = true;
        input.touchAxes.x = 0;
        input.touchAxes.z = 0;
      } else if (e.pointerId === this.lookId) {
        window.clearTimeout(this.holdTimer);
        // A quick tap that did not move: one dig / throw.
        if (!this.digging && this.lookMoved < 14 && performance.now() - this.lookStart < 300) input.press("Mouse0");
        this.lookId = null;
        this.digging = false;
        input.touchDig = false;
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    // No page zoom / scroll gestures over the game.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }
}
