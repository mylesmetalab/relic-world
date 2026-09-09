# Relic World — plan

A walkable, procedurally generated cave in the blacklight riso-comic style of
the Riso Relic Tuner. Three.js + Rapier, no engine. The print pipeline is the
tuner's, moved over verbatim; everything else is new.

## Why this shape

- **The look is a post-process plus one material.** Toon fill-by-tone, ruled
  ink hatching anchored per object, an inverted-hull contour, a normal+depth
  key plate, and a press pass (misregistration, tooth, halftone) at a FIXED
  print density. None of it depends on how the camera moves. That is the whole
  reason a walkable world is cheap: the frame costs about the same whether the
  world is one rock or a thousand.
- **Caves stay on-brand and dodge the sky.** Underground means no skyline and
  no daylight model. Rooms, pinches, pillars and stalagmites come from two
  noise fields (floor and ceiling); where they meet, the rock is solid.
- **Three.js over an engine** because the shaders are the asset. Godot/Unity
  give a character controller for free but the ink pass would be rewritten in
  their shader language and never quite match.

## Architecture

```
src/
  main.ts            boot, fixed-step loop, resize, HUD
  render/
    shaders.ts       the tuner's GLSL (fog range + ceiling arcs added)
    palette.ts       gradient baker, ink colorways, cave colorways
    pipeline.ts      renderer, camera, materials, ND target, composer, press pass
  world/
    noise.ts         mulberry32, lattice hash, 2-D simplex + fBm
    terrain.ts       floor/ceiling height fields, solidity, chunk meshes, rocks
    chunks.ts        ChunkManager — build/dispose chunks + colliders around the player
  physics/
    world.ts         Rapier init, fixed step, heightfield + convex-hull helpers
  player/
    input.ts         keyboard + pointer-lock mouse
    controller.ts    kinematic character controller (autostep = scramble), jump, gravity
    camera.ts        third-person boom with ray-shortened distance; first-person toggle
    figure.ts        packed Bast/Rook figure as the player body (base cut, facing)
```

One world seed drives everything (chunk RNG = hash(seed, cx, cz)); a given
seed is the same place on every machine.

### Coordinates and units

Metres. Player capsule radius 0.35, height 1.7. Chunk 24 m, 1 m cells.
Floor height ∈ [0, ~6]; ceiling ∈ [7, 16]. Where `ceiling − floor` would be
under ~2.5 m the floor is lifted to the ceiling: that IS the wall. One
heightfield per chunk is therefore the entire collision surface for terrain.

### Rendering rules carried over

- Palettes are sRGB-tagged LUTs, materials write linear, the press pass owns
  the encode.
- Composer + ND target sized to `canvas × printScale`, nearest-filtered; the
  hatch lives in print pixels.
- Per-object hatch via `onBeforeRender` (project origin → print px). Rocks
  anchor to themselves, chunks to their centre, the figure to its origin.
- ND pass: `scene.overrideMaterial = ndMat`; back-side ceiling geometry is
  absent from it (cleared to depth 1), so it never gets key-plate creases.

## Status (2026-09-09)

- M1 done. M2 (biomes, torches with reach), M3 (ledge grab + mantle),
  multiplayer and photo mode shipped in the second pass — see README for the
  rules of the place. Deliberately not done yet: M4 props/physics, M5 rigged
  body, sound, touch controls.
- Multiplayer is serverless (trystero over WebRTC, Nostr relays for the
  handshake). Metalab Sites' CSP (`connect-src 'self'`) blocks the relays,
  so a hosted build needs a static host without that policy — GitHub Pages
  is the intended one (`.github/workflows/pages.yml`).

## Milestones

- **M0 — pipeline in a room.** Renderer + materials + press pass on a static
  test scene. Done when a screenshot reads as the tuner.
- **M1 — walkable chunk (this build).** Floor/ceiling fields, rocks, one 5×5
  chunk window streamed around the player, Rapier heightfield + hull
  colliders, kinematic controller with autostep and jump, third-person camera
  that shortens on rock, Bast as the body, colorway hotkeys, HUD.
  Done when you can run around, scramble over knee-high rock, and the frame
  holds the look while moving.
- **M2 — a place.** Biomes: colorway + noise parameters per region blended
  by a low-frequency field; stalactites; torch props as light sources that
  also drive tone; fog toward the horizon tone; spawn on a flat pad.
- **M3 — climbing.** Ledge detection (raycasts ahead + up), grab, mantle,
  wall-scramble state machine. Auto-step already covers knee height.
- **M4 — props and physics.** Pushable relics (dynamic rigid bodies), rubble
  that scatters, a few breakable stalagmites.
- **M5 — body.** Rigged figure or a rig-free "miniature" with lean/bob and a
  footstep beat; first-person hands.
- **M6 — polish.** Touch controls, settings panel for the pen/press, seed
  sharing via URL, screenshot export at print density.

## Known risks

- **Heightfield orientation** in Rapier (row/column vs x/z). Verified at boot
  by casting rays and comparing to the analytic height; a mismatch is logged.
- **Fixed print density on a moving camera** can read as a screen texture on
  fast turns. Mitigations: camera smoothing, slightly lower misregistration
  than the tuner's default.
- **Draw calls.** The ND pass doubles them. Rocks per chunk are capped and
  the chunk window is 5×5; instancing is the next lever if needed.
