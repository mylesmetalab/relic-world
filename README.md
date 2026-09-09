# Relic World

A walkable, procedurally generated cave drawn as a 1979 blacklight
riso-comic — the [Riso Relic Tuner](https://sites.metalab.com/oodles/riso-relic-tuner/)'s
print pipeline as a place you can explore. Three.js + Rapier, no engine.

```bash
pnpm install
pnpm dev        # http://localhost:5300
```

Click to take the mouse. **WASD** move · **Shift** run · **Space** jump ·
**V** first/third person · **1–8** cave colorway · **Q/E** figure colorway ·
**R** new seed · **T** back to spawn. `?seed=123` opens a specific world.

## How it's built

- `src/render/` — the tuner's shaders and press pass, verbatim: toon
  fill-by-tone, ruled ink hatching anchored per object, inverted-hull
  contour, normal+depth key plate, off-register plates, paper tooth, all at
  a fixed print density.
- `src/world/` — the cave is two height fields (floor, ceiling) and a
  solidity field that pinches them into walls and pillars; 24 m chunks are
  streamed around the player, each with a heightfield collider and
  convex-hull boulders. One seed, same world everywhere.
- `src/player/` — Rapier kinematic character controller (auto-step is the
  first rung of climbing), third-person boom that shortens on rock, the
  packed Bast figure as the body.

Plan and milestones: [docs/PLAN.md](docs/PLAN.md).
