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
| **two-finger swipe** / **arrows** / **right-drag** | look; **L** locks the mouse for FPS-style look |
| **V** | first ↔ third person |
| **C** / **⇧C** | change character — nine things the cave grew: Cairn, Shard, Menhir, Spire, Dolmen, Castle, Totem, Wisp, Hound (the STL miniatures Bast, Rook and Cam join the cast via a toggle in the tuning panel) |
| **Q / E** | your figure's ink colorway |
| **F** / **click** | grab the prop — or the player — under the cursor (both get the same white outline, the cursor fills in) · throw along your aim — the dashed arc and landing ring show exactly where a prop goes · with empty hands, click **digs** |
| **X** / **G** | plant a torch that lights and prints the rock around it · spawn a relic in front of you |
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
`low` on a touch device (a coarse pointer) and `high` everywhere else.
`low` (printScale 0.45, a 3×3 chunk window, the normal+depth pass at half
resolution) is tuned for a phone GPU that would otherwise drop under 30 fps
at the desktop's `printScale` 0.6; `med` keeps `high`'s print density and
view distance and only halves the ND pass; `high` is today's desktop
default (printScale 0.6, a 5×5 chunk window, full-res ND). `printScale`
itself is still a live slider in the tuning panel — the preset just seeds
its starting value, and `?cfg=` overrides it same as always.

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
- **Biomes have hard edges.** Six regions, each with its own cave colorway
  and its own pen — hatch pitch, nib, black fill, cracks, stipple — and its
  own ground: Glacier and Void Peaks are terraced into climbable ledges,
  Sulphur Pit is a stalagmite forest, Deep Sea is flat and wide.
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

## How it's built

- `src/render/` — the tuner's shaders and press pass, plus four torches with
  reach, the ink map, and per-biome ramps and pens.
- `src/world/` — floor, ceiling and solidity fields; biome field (the same
  noise in TypeScript and GLSL); 24 m chunks streamed around the player with
  heightfield + convex-hull colliders.
- `src/player/` — Rapier kinematic controller with auto-step and a ledge
  grab / mantle state machine; third-person boom that shortens on rock;
  figures as packed miniatures or procedural golems, each with its own inks;
  every figure but the Hound swings two arms opposite its legs, reaches
  forward holding a prop or carrying another player, and flails when it is
  the one being carried.
- `src/net/` — [trystero](https://github.com/dmotz/trystero) rooms over
  WebRTC; state at 12 Hz, remote figures interpolated.
- `src/ui/photo.ts` — photo mode; also queues up to 3 framed stills into a
  composed comic page (24 px gutters, one wide panel + two small, a
  paper/ink caption strip) exported as one PNG.

Plan and milestones: [docs/PLAN.md](docs/PLAN.md).
