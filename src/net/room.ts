import { joinRoom, selfId } from "trystero";
import type { CharacterId } from "../player/figure";
import type { PropState } from "../world/props";

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
  /** Speech bubble text ("" = none). Drafts stream with a caret. */
  b: string;
  /** Hold point when carrying a player, and who (peer id) — else null. */
  h?: [number, number, number] | null;
  g?: string | null;
};

export type Peer = { id: string; state: PeerState; lastAt: number };
/** A dig: level, centre, radius; either a crater depth `d` or a dig-to height `t`. */
export type DigMsg = { l: number; x: number; z: number; r: number; d: number; t?: number };
export type TorchMsg = { id: string; p: [number, number, number] };

const ADJECTIVES = ["Hooded", "Quiet", "Ashen", "Sly", "Grim", "Amber", "Lucky", "Wandering", "Pale", "Bold", "Stony", "Feral"];

/** A stable display name for this browser session, derived from its peer id. */
export function nameFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `${ADJECTIVES[h % ADJECTIVES.length]}-${(h >>> 8) % 100}`;
}

/** A room that goes nowhere: every action is a no-op, no peers ever arrive. */
function soloRoom(): ReturnType<typeof joinRoom> {
  const stub = {
    makeAction: () => ({ send: async () => [], onMessage: null }),
    onPeerJoin: null, onPeerLeave: null, onPeerStream: null, onPeerTrack: null,
    addStream: async () => [], removeStream: () => {}, addTrack: async () => [], removeTrack: () => {}, replaceTrack: async () => [],
    getPeers: () => ({}), ping: async () => 0, leave: async () => {},
  };
  return stub as unknown as ReturnType<typeof joinRoom>;
}

export class Net {
  readonly selfId = selfId;
  readonly name = nameFor(selfId);
  readonly peers = new Map<string, Peer>();
  onJoin: ((id: string) => void) | null = null;
  onLeave: ((id: string) => void) | null = null;
  readonly room;
  private readonly state;
  private readonly props;
  private readonly dig;
  private readonly torches;
  private readonly collect;
  onProps: ((states: PropState[], peerId: string) => void) | null = null;
  onDig: ((d: DigMsg, peerId: string) => void) | null = null;
  onTorches: ((list: TorchMsg[], peerId: string) => void) | null = null;
  onCollect: ((id: string, peerId: string) => void) | null = null;
  private readonly grabP;
  private readonly throwP;
  /** Someone picked me up (peerId is the carrier). */
  onGrabbed: ((peerId: string) => void) | null = null;
  /** My carrier let go with this velocity. */
  onThrown: ((v: [number, number, number], peerId: string) => void) | null = null;
  /** Pulled on every heartbeat, so a tab that has never rendered a frame
   *  (opened in the background) still announces itself. */
  private source: (() => PeerState | null) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Count of relay join errors (informational — one relay failing is normal). */
  relayErrors = 0;

  /** True when running without a room at all (single player). */
  readonly solo: boolean;

  /** `solo` skips the relays entirely: same API, nothing ever goes out or
   *  comes in. Used on hosts whose CSP blocks the relays (Metalab Sites). */
  constructor(seed: number, roomOverride?: string, solo = false) {
    this.solo = solo;
    const roomId = roomOverride ?? `seed-${seed}`;
    this.room = solo
      ? soloRoom()
      : joinRoom({ appId: "relic-world-v1" }, roomId, {
          onJoinError: (err) => {
            this.relayErrors++;
            console.warn("[relic-world] relay join error", err);
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
    this.props = this.room.makeAction<PropState[]>("props");
    this.props.onMessage = (data, ctx) => this.onProps?.(data, ctx.peerId);
    this.dig = this.room.makeAction<DigMsg>("dig");
    this.dig.onMessage = (data, ctx) => this.onDig?.(data, ctx.peerId);
    this.torches = this.room.makeAction<TorchMsg[]>("torches");
    this.torches.onMessage = (data, ctx) => this.onTorches?.(data, ctx.peerId);
    this.collect = this.room.makeAction<{ k: string }>("collect");
    this.collect.onMessage = (data, ctx) => this.onCollect?.(data.k, ctx.peerId);
    this.grabP = this.room.makeAction<{ t: string }>("grabP");
    this.grabP.onMessage = (data, ctx) => { if (data.t === selfId) this.onGrabbed?.(ctx.peerId); };
    this.throwP = this.room.makeAction<{ t: string; v: [number, number, number] }>("throwP");
    this.throwP.onMessage = (data, ctx) => { if (data.t === selfId) this.onThrown?.(data.v, ctx.peerId); };
    this.room.onPeerLeave = (id) => {
      if (this.peers.delete(id)) this.onLeave?.(id);
    };
    // The heartbeat runs on a timer, not the frame loop: a hidden tab has no
    // requestAnimationFrame, but its timer still fires (~1 Hz), so a player
    // who alt-tabs stays standing in everyone else's cave instead of vanishing.
    this.timer = setInterval(() => this.tick(), 1000 / 12);
  }

  /** Provide the local state; the heartbeat timer reads it. */
  setSource(source: () => PeerState | null): void {
    this.source = source;
  }

  private tick(): void {
    const mine = this.source?.();
    if (mine) void this.state.send(mine).catch(() => {});
    // Drop peers we haven't heard from in a while (tab closed without leave).
    const now = performance.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastAt > 8000) {
        this.peers.delete(id);
        this.onLeave?.(id);
      }
    }
  }

  sendProps(states: PropState[]): void {
    if (states.length && this.peers.size) void this.props.send(states).catch(() => {});
  }
  sendDig(d: DigMsg): void {
    if (this.peers.size) void this.dig.send(d).catch(() => {});
  }
  sendTorches(list: TorchMsg[]): void {
    if (this.peers.size) void this.torches.send(list).catch(() => {});
  }
  sendCollect(k: string): void {
    if (this.peers.size) void this.collect.send({ k }).catch(() => {});
  }
  sendGrabPlayer(t: string): void {
    void this.grabP.send({ t }, { targets: t } as never).catch(() => {});
  }
  sendThrowPlayer(t: string, v: [number, number, number]): void {
    void this.throwP.send({ t, v }, { targets: t } as never).catch(() => {});
  }

  get count(): number {
    return this.peers.size;
  }

  leave(): void {
    if (this.timer) clearInterval(this.timer);
    void this.room.leave();
  }
}
