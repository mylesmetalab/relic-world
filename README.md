# Relic World

A walkable, procedurally generated cave drawn as a 1979 blacklight
riso-comic — the [Riso Relic Tuner](https://sites.metalab.com/oodles/riso-relic-tuner/)'s
print pipeline as a place you can explore, with friends. Three.js + Rapier,
no engine, no server.

```bash
pnpm install
pnpm dev        # http://localhost:5300
pnpm build      # static bundle in dist/
```

## Playing

Click to take the mouse.

| Key | |
|---|---|
| **WASD** / **Shift** / **Space** | move · run · jump |
| push into a ledge | climb — a mantle up to about head height; costs stamina, which refills on the ground |
| **two-finger swipe** / **arrows** / **right-drag** | look; **L** locks the mouse for FPS-style look; the tuning panel's "Look controls" picks Auto (guesses mouse vs. trackpad from your first scroll/swipe), Mouse or Trackpad, each with its own sensitivity |
| **V** | first ↔ third person |
| **C** / **⇧C** | change character — nine things the cave grew: Cairn, Shard, Menhir, Spire, Dolmen, Castle, Totem, Wisp, Hound (the STL miniatures Bast, Rook and Cam join the cast via a toggle in the tuning panel) |
| **Q / E** | your figure's ink colorway |
| **F** / **click** | grab the prop — or the player — under the cursor (both get the same white outline, the cursor fills in) · throw along your aim — the dashed arc and landing ring show exactly where a prop goes · with empty hands, click **digs** |
| **X** / **G** | plant a torch that lights and prints the rock around it · spawn a relic in front of you |
| **B** | hop to a different biome — teleports to the nearest point in the next biome in sequence (also a button in the tuning panel) |
| **Tab** | the paper map — the ink map itself, printed in as you explore, with players as dots |
| **Enter** | chat — what you type streams above your figure as you type; Enter sends, Esc cancels |
| **\`** | the tuning panel — every number the look and the world are built from; Export gives JSON to paste back, Copy link shares a `?cfg=` URL |
| **🎤** | proximity voice, opt in — your mic goes to players near you, fading with distance |
| **P** | photo mode — orbit, press controls, PNG export at print sizes, and a comic page (Add panel × up to 3, Make page) |
| **M** | mute |
| **R** / **T** | new seed · back to spawn |

With no `?seed=` you land in **the** world — one cave everyone shares, which
rolls to a new seed every two hours on the clock (the HUD counts down).
`?seed=123` opens a private world; `?room=name` a private room on any seed.
Wherever you are, you see the others' figures and torches, their light prints
the rock for you too, and what they push, you see move.

`?q=low|med|high` picks a quality preset — with none given it auto-picks
`low` on a touch device browsing the site directly (a coarse pointer) and
`high` everywhere else, including the wrapped iOS app (which always gets
`high` regardless of touch, so a TestFlight build matches the web look
rather than the phone preset). `low` (printScale 0.45, a 3×3 chunk window,
the normal+depth pass at half resolution) is tuned for a phone GPU that
would otherwise drop under 30 fps at the desktop's `printScale` 0.6; `med`
keeps `high`'s print density and view distance and only halves the ND pass;
`high` is today's desktop default (printScale 0.6, a 5×5 chunk window,
full-res ND). `printScale` itself is still a live slider in the tuning
panel — the preset just seeds its starting value, and `?cfg=` overrides it
same as always.

## The rules of the place

- **Unprinted until lit.** Rock is bare paper (with a pencil under-drawing)
  until a torch has reached it. Once printed it stays printed for the
  session. Exploring is inking the world in.
- **It has an upstairs.** Galleries are a second level: the lower cave's
  ceiling is a slab whose top is another floor with its own ceiling. Shafts
  drop through; gallery edges are cliffs. Push into a sheer face and you
  climb it, hand over hand, while stamina lasts — let go and you drop.
- **Hatched rock is grip.** A sheer face only holds a climb where it reads
  as hatched — smooth black fill (a pillar core) is too solid to grab, and
  you'll drop back off it. The cutoff is `climbSolidity` in the tuning
  panel.
- **You can dig.** Click with empty hands to carve the ground or a wall —
  small, body-wide cuts (the amount per dig is in the panel's dig section).
  Aim up at a wall and each dig carves a step you can mantle onto; you start
  on the surface and dig down through the crust into the caves;
  digs are shared and persist for the session. Plant torches (X) to light
  the way back.
- **You can dig up, too.** Aim up at open headroom (not a wall) and each dig
  raises the ceiling right above you instead — ceilings are painted fields,
  not colliders, so the cut is aimed by walking the same ray through the
  ceiling's height field a quarter-metre at a time. Keep at it and it breaks
  through into whatever is overhead (a gallery, or straight to the surface),
  dropping that floor open right there so you can climb up into it.
- **Biomes have hard edges.** Ten regions, each with its own cave colorway
  and its own pen — hatch pitch, nib, black fill, cracks, stipple — and its
  own ground: Glacier and Void Peaks are terraced into climbable ledges,
  Sulphur Pit is a stalagmite forest, Deep Sea is flat and wide, Dusk Ridge
  is a warm sun-baked canyon, Root Cellar is cramped and tangled with a
  squeezed-down ceiling, Crystal Vein is bright, glassy and sparse. Some
  biomes grip differently, too: a sheer wall only climbs where the rock reads
  as hatched, not smooth fill, and Glacier/Crystal Vein read slippery (a
  lower grip threshold) while Sulphur Pit is soft and crumbly (a higher one)
  — the same rock, a different feel underfoot depending where you are.
- **Things can be pushed, together.** Rock shards and gold-leaf relic
  statues on plinths are dynamic bodies at rock density; walk into them and
  they slide and topple. The nearest player simulates a prop and everyone
  else follows, so a shove is shared. They spawn on every level — a lighter
  scatter on the surface and on gallery slabs, the full set in the lower
  cave (tune the upper/lower balance as `propUpperDensity`).
- **You can pick each other up.** Aim at another player within reach and
  they get the same white outline a prop does — "F to pick up" is something
  you see, not just read. The one grabbed gets a chat-bubble-sized toast
  ("Stony-13 picked you up") and flails until thrown or set down.
- **Some rooms are sealed.** Small vault rooms in the lower cave are walled
  all the way to the ceiling, with two stone pillars flanking the door.
  Plant a torch by each pillar and the wall opens — a golem relic waits
  inside, on its own plinth. The paper map marks a known vault red until
  it's open, then green.
- **Torches you plant burn out.** A planted torch (X) lasts a few minutes
  (`torchLifeSec`), dimming over its last quarter of life before it goes
  dark and vanishes — keeping two lit at a vault door at once, and finding
  your way back through a darkening cave, are real choices. World/shrine
  torches placed by the cave itself never run out.
- **It sounds like paper and rock.** Everything is synthesized: footfalls, jump and land, knocks scaled by impact, a press roller
  that hums while new rock prints under your torch, and a blip when someone
  starts talking.
- **Tone picks the ink.** Lighting never shades a colour; it decides which
  flat ink lands. That is the whole style, and it is why a moving camera
  costs nothing.
- **Deeper is stranger.** The lower cave reads different from the surface:
  pen jitter and press misregistration grow with depth, the ceiling's brush
  arcs pack tighter, and the bare-paper reveal dims — all driven by how far
  below the (undug) surface you are, tunable as `depthStrange` in the panel.
- **Falls have weight.** A 30 m drop into a Cathedral vault is intended, and
  lands like one: a camera thump, a puff of ink chips at your feet, and a
  brief stumble where movement is ignored — a small hop off a ledge stays
  quiet (the cutoff is `landHardSpeed` in the panel). If you ever end up
  below every floor, you're teleported back up to the nearest one rather than
  left stuck under the world.
- **You're not always alone down there — in private worlds.** A single
  wandering presence, a jagged rock-stack silhouette with no shoulders, arms
  or head (so it never reads as a mis-worn player skin), drifts on its own
  slow business. It has no health, no attack and no collider at all —
  walking into it does nothing. Bring a lit torch near it and it flees,
  faster than its normal drift; step away and it fades back to unseen — it
  only renders while an active light actually reaches it, the same
  "half-seen" feeling the rock's ink map gives everything else, approximated
  for something that moves. One connected player simulates it at a time (the
  lowest peer id, same tie-break spirit as a shared prop's nearest-player
  rule) and broadcasts it to the rest. Private/seeded worlds only
  (`?seed=`/`?room=`) — off in the shared rolling world everyone lands in by
  default — and behind its own kill switch (`presenceEnabled` in the panel)
  on top of that.
- **A boulder that takes two.** A handful of big, round boulders (mirroring
  the two-torch vault's sparse per-site placement, own grid/hash) sit in the
  lower cave, dense enough — the same push/pull physics as every other
  dynamic prop, just tuned heavier — that one player pushing continuously can
  barely creep it forward, while a second player joining in (the existing
  nearest-player ownership handoff, no new mechanic) clearly moves it
  further, faster. Rendered as a jittered low-poly dome rather than the usual
  cone-shaped rock, since a shallow wide cone is just a walkable ramp; wall
  climbing and ledge-mantling now skip every dynamic prop entirely (they were
  only ever meant to read terrain), so a boulder always reads as something to
  push, never something to climb over.
- **Getting knocked down isn't just for falls.** The same camera thump, ink-
  chip puff and brief stumble a hard landing gives you now also fires if a
  fast-thrown prop, or another player thrown/flung at speed, passes close by
  — an ordinary push or a normal walk-up stays quiet (`impactPropSpeed`,
  `impactPlayerSpeed`, `impactRadius` in the panel set the cutoffs).
- **Night takes your ink back.** A day/night cycle (`dayNightCycleSec`, ~10
  minutes by default) runs everywhere, shared world included. By day,
  "unprinted until lit" works as always — once inked, always printed. At
  night that permanence stops applying: a place you explored earlier goes
  dark again the moment nothing is actually lighting it right now, unless a
  torch — yours, a peer's, or a permanent shrine/brazier — is still standing
  and burning there. Your own carried light shrinks a lot at night too
  (`nightPersonalReach`, a few metres by default) — it's a big, generous
  bubble by day, and night looked like day everywhere a player stood until
  that came down. Let a planted torch run out at night and its patch goes
  dark with it. An unlit patch at night fades toward near-black, not bright
  paper — it genuinely reads as dark, not just a dimmer page; the ink-pass's
  own silhouette/edge lines still draw over it regardless, so an unlit
  shape still reads by its outline in the dark, until a torch reveals its
  real colour. The surface itself reads duskier as night falls (still bare
  paper, just a darker sheet of it — no skyline). The tuning panel's Time
  phase buttons (Auto / Day / Dusk / Night) freeze the cycle at any phase so
  you can look at — and tune — exactly one of them; `nightIntensity` is a
  safety valve that fully disables the darkening at 0. The paper map (Tab)
  is untouched either way — it always shows your full inked history.

## How it's built

- `src/render/` — the tuner's shaders and press pass, plus four torches with
  reach, the ink map, and per-biome ramps and pens.
- `src/world/` — floor, ceiling and solidity fields; biome field (the same
  noise in TypeScript and GLSL); 24 m chunks streamed around the player with
  heightfield + convex-hull colliders. Rocks are drawn as `InstancedMesh`
  batches (one per prototype shape per chunk, from a fixed pool of 10) with
  hatch anchoring computed per-instance in-shader, not one mesh per rock —
  colliders stay one convex hull per rock either way.
- `src/player/` — Rapier kinematic controller with auto-step and a ledge
  grab / mantle state machine (its wall/ledge raycasts skip every dynamic
  rigid body, terrain and statics only, so a pushable prop is never
  mistaken for a climbable wall); third-person boom that shortens on rock via
  a swept-ball cast, not a zero-width ray, so a corner or shallow wall can't
  poke through the camera's near plane as you rotate;
  figures as packed miniatures or procedural golems, each with its own inks;
  every figure but the Hound swings two arms opposite its legs, reaches
  forward holding a prop or carrying another player, and flails when it is
  the one being carried; digging swings the lead arm through a brief
  windup-then-strike (`Figure.swing()`), for both the local player and
  remote diggers.
- `src/net/` — [trystero](https://github.com/dmotz/trystero) rooms over
  WebRTC; state at 12 Hz, remote figures interpolated; a peer silent for more
  than 8 s (a closed tab or dropped connection that never sent a clean leave)
  is swept from the room the same way a normal departure is.
- `src/world/presence.ts` — the wandering presence: its own procedural
  silhouette (the same stacked-cone rock technique as the golems, deliberately
  not one of their kinds), wander/flee movement sampling `terrain.solidity`
  the way rock scatter avoids walls, and a small net message (`PresenceMsg`
  in `src/net/room.ts`) the current owner broadcasts.
- `src/ui/photo.ts` — photo mode; also queues up to 3 framed stills into a
  composed comic page (24 px gutters, one wide panel + two small, a
  paper/ink caption strip) exported as one PNG.

Plan and milestones: [docs/PLAN.md](docs/PLAN.md).
