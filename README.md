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
| **mouse** | look |
| **V** | first ↔ third person |
| **C** | change character (Bast, Rook, and three rock golems: Cairn, Shard, Menhir) |
| **Q / E** | your figure's ink colorway |
| **P** | photo mode — orbit, press controls, PNG export at print sizes |
| **R** / **T** | new seed · back to spawn |

`?seed=123` opens a specific world. **Everyone who opens the same seed is in
the same cave**: you see each other's figures and torches, and their light
prints the rock for you too. `?room=name` joins a named room instead.

## The rules of the place

- **Unprinted until lit.** Rock is bare paper (with a pencil under-drawing)
  until a torch has reached it. Once printed it stays printed for the
  session. Exploring is inking the world in.
- **Biomes have hard edges.** Six regions, each with its own cave colorway
  and its own pen — hatch pitch, nib, black fill, cracks, stipple — and its
  own ground: Glacier and Void Peaks are terraced into climbable ledges,
  Sulphur Pit is a stalagmite forest, Deep Sea is flat and wide.
- **Tone picks the ink.** Lighting never shades a colour; it decides which
  flat ink lands. That is the whole style, and it is why a moving camera
  costs nothing.

## How it's built

- `src/render/` — the tuner's shaders and press pass, plus four torches with
  reach, the ink map, and per-biome ramps and pens.
- `src/world/` — floor, ceiling and solidity fields; biome field (the same
  noise in TypeScript and GLSL); 24 m chunks streamed around the player with
  heightfield + convex-hull colliders.
- `src/player/` — Rapier kinematic controller with auto-step and a ledge
  grab / mantle state machine; third-person boom that shortens on rock;
  figures as packed miniatures or procedural golems, each with its own inks.
- `src/net/` — [trystero](https://github.com/dmotz/trystero) rooms over
  WebRTC; state at 12 Hz, remote figures interpolated.
- `src/ui/photo.ts` — photo mode.

Plan and milestones: [docs/PLAN.md](docs/PLAN.md).
