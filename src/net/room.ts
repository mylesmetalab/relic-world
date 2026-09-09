import { joinRoom, selfId } from "trystero";
import type { CharacterId } from "../player/figure";

/**
 * Multiplayer without a server. trystero pairs browsers over WebRTC using
 * public Nostr relays purely for the handshake; after that, state flows
 * peer-to-peer. Everyone who opens the same seed lands in the same room, so
 * a shared URL is a shared cave. State is fire-and-forget at ~12 Hz; remote
 * figures interpolate between updates.
 */

export type PeerState = {
  /** Feet position. */
  p: [number, number, number];
  /** Facing (radians). */
  f: number;
  /** Torch position (world). */
  t: [number, number, number];
  c: CharacterId;
  /** Ink colorway index. */
  i: number;
  /** Horizontal speed (for the walk bob). */
  s: number;
  n: string;
};

export type Peer = { id: string; state: PeerState; lastAt: number };

const ADJECTIVES = ["Hooded", "Quiet", "Ashen", "Sly", "Grim", "Amber", "Lucky", "Wandering", "Pale", "Bold", "Stony", "Feral"];

/** A stable display name for this browser session, derived from its peer id. */
export function nameFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `${ADJECTIVES[h % ADJECTIVES.length]}-${(h >>> 8) % 100}`;
}

export class Net {
  readonly selfId = selfId;
  readonly name = nameFor(selfId);
  readonly peers = new Map<string, Peer>();
  onJoin: ((id: string) => void) | null = null;
  onLeave: ((id: string) => void) | null = null;
  private readonly room;
  private readonly state;
  private sinceSend = 0;
  connected = true;

  constructor(seed: number, roomOverride?: string) {
    const roomId = roomOverride ?? `seed-${seed}`;
    this.room = joinRoom({ appId: "relic-world-v1" }, roomId, {
      onJoinError: (err) => {
        console.warn("[relic-world] room join error", err);
        this.connected = false;
      },
    });
    this.state = this.room.makeAction<PeerState>("state");
    this.state.onMessage = (data, ctx) => {
      const id = ctx.peerId;
      const peer = this.peers.get(id);
      if (peer) {
        peer.state = data;
        peer.lastAt = performance.now();
      } else {
        this.peers.set(id, { id, state: data, lastAt: performance.now() });
        this.onJoin?.(id);
      }
    };
    this.room.onPeerLeave = (id) => {
      if (this.peers.delete(id)) this.onLeave?.(id);
    };
  }

  /** Send at most every 1/12 s. */
  update(dt: number, mine: PeerState): void {
    this.sinceSend += dt;
    if (this.sinceSend < 1 / 12) return;
    this.sinceSend = 0;
    void this.state.send(mine).catch(() => {});
    // Drop peers we haven't heard from in a while (tab closed without leave).
    const now = performance.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastAt > 8000) {
        this.peers.delete(id);
        this.onLeave?.(id);
      }
    }
  }

  get count(): number {
    return this.peers.size;
  }

  leave(): void {
    void this.room.leave();
  }
}
