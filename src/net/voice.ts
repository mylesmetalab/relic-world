import type { Net } from "./room";

/**
 * Proximity voice, opt-in. Nothing is captured until you press the button;
 * then your microphone goes to every peer over the same WebRTC connections
 * the game state uses, and each incoming voice is played through a gain that
 * falls off with distance in the cave — close means loud, far means gone.
 */

const NEAR = 4; // full volume within this many metres
const FAR = 22; // silent beyond

type Incoming = { gain: GainNode; el: HTMLAudioElement };

export class Voice {
  enabled = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private readonly incoming = new Map<string, Incoming>();
  /** Peers currently sending audio (for the HUD). */
  readonly speaking = new Set<string>();
  onChange: ((enabled: boolean, error?: string) => void) | null = null;

  constructor(private readonly net: Net) {
    // Screen-share rides the same trystero stream slot (see Net.onPeerStream)
    // — ignore anything tagged "screen" so a shared screen never ends up
    // wired into the spatial-audio graph as if it were a mic.
    net.onPeerStream((stream, peerId, metadata) => {
      if (metadata === "screen") return;
      this.attach(peerId, stream);
    });
  }

  async toggle(): Promise<void> {
    if (this.enabled) {
      this.disable();
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (e) {
      this.onChange?.(false, "microphone unavailable");
      return;
    }
    this.enabled = true;
    void Promise.allSettled(this.net.room.addStream(this.stream, { metadata: "voice" }));
    this.onChange?.(true);
  }

  private disable(): void {
    if (this.stream) {
      this.net.room.removeStream(this.stream);
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.enabled = false;
    this.onChange?.(false);
  }

  /** Late joiner: send my stream to a peer that arrived after I enabled. */
  peerJoined(peerId: string): void {
    if (this.enabled && this.stream) void Promise.allSettled(this.net.room.addStream(this.stream, { target: peerId, metadata: "voice" }));
  }

  peerLeft(peerId: string): void {
    const inc = this.incoming.get(peerId);
    if (!inc) return;
    inc.el.srcObject = null;
    inc.gain.disconnect();
    this.incoming.delete(peerId);
    this.speaking.delete(peerId);
  }

  private attach(peerId: string, stream: MediaStream): void {
    this.peerLeft(peerId);
    if (!this.ctx) this.ctx = new AudioContext();
    // Chrome only plays WebRTC audio that is bound to a media element, even
    // when the graph is driven by Web Audio — so both.
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.ctx.destination);
    this.incoming.set(peerId, { gain, el });
    this.speaking.add(peerId);
    void this.ctx.resume();
  }

  /** Per frame: set each peer's volume from their distance to me. */
  update(me: { x: number; y: number; z: number }, positions: Map<string, { x: number; y: number; z: number }>): void {
    if (!this.ctx) return;
    for (const [id, inc] of this.incoming) {
      const p = positions.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
      const g = d <= NEAR ? 1 : d >= FAR ? 0 : 1 - (d - NEAR) / (FAR - NEAR);
      inc.gain.gain.setTargetAtTime(g * g, this.ctx.currentTime, 0.08);
    }
  }
}
