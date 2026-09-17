import type { Net } from "./room";

/**
 * Screen sharing, opt-in, one direction per sharer. getDisplayMedia captures
 * a screen/window/tab you pick; the resulting stream goes to every peer over
 * the same WebRTC connections voice uses, tagged "screen" (see
 * Net.onPeerStream) so it's never mistaken for a mic feed. Not proximity-
 * gated like voice — a shared screen is meant to stay visible to everyone
 * in the room regardless of where they wander, the same way Zoom's screen
 * share isn't tied to who's "close" to you.
 */

export type SharedScreen = { peerId: string; video: HTMLVideoElement };

export class ScreenShare {
  enabled = false;
  private stream: MediaStream | null = null;
  private readonly incoming = new Map<string, SharedScreen>();
  onChange: ((enabled: boolean, error?: string) => void) | null = null;
  /** Fires whenever a peer starts/stops sharing, so the HUD can rebuild its tiles. */
  onIncomingChange: (() => void) | null = null;

  constructor(private readonly net: Net) {
    net.onPeerStream((stream, peerId, metadata) => {
      if (metadata !== "screen") return;
      this.attach(peerId, stream);
    });
  }

  async toggle(): Promise<void> {
    if (this.enabled) {
      this.disable();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" } as MediaTrackConstraints, audio: false });
    } catch (e) {
      this.onChange?.(false, "screen share unavailable");
      return;
    }
    this.stream = stream;
    this.enabled = true;
    // The browser's own "Stop sharing" bar ends the track without going
    // through our button — catch that so our state (and the peers) agree.
    stream.getVideoTracks()[0]!.addEventListener("ended", () => this.disable());
    void Promise.allSettled(this.net.room.addStream(stream, { metadata: "screen" }));
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

  /** Late joiner: send my screen to a peer that arrived after I started sharing. */
  peerJoined(peerId: string): void {
    if (this.enabled && this.stream) void Promise.allSettled(this.net.room.addStream(this.stream, { target: peerId, metadata: "screen" }));
  }

  peerLeft(peerId: string): void {
    const inc = this.incoming.get(peerId);
    if (!inc) return;
    inc.video.srcObject = null;
    inc.video.remove();
    this.incoming.delete(peerId);
    this.onIncomingChange?.();
  }

  private attach(peerId: string, stream: MediaStream): void {
    this.peerLeft(peerId);
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true; // no audio track anyway; keeps autoplay policies happy
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});
    // A peer's own "Stop sharing" ends their track — same cleanup as if they left.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => this.peerLeft(peerId));
    this.incoming.set(peerId, { peerId, video });
    this.onIncomingChange?.();
  }

  /** Currently visible shared screens, for the HUD to render as tiles. */
  list(): SharedScreen[] {
    return [...this.incoming.values()];
  }
}
