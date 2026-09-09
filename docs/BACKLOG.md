# Relic World — backlog and handoff briefs

Self-contained briefs so a fresh agent (or a sub-agent per task) can pick one
up cold. Each is scoped to a single PR-sized change. Read `docs/PLAN.md`
"Status" first, then the brief, then the "How to work here" section at the end.

Priority order is Myles's, from his play feedback on 2026-09-09.

---

## 1. Arms (the figure has legs, no arms)

**Goal:** every procedural character (and the STL cast) gets two arms that
swing opposite the legs while walking, reach forward while holding a prop or
carrying a player, and flail when the figure itself is carried.

- Files: `src/player/figure.ts` (legs are pivot groups built in the figure's
  zone material — mirror that for arms; shoulder height ≈ 0.72 × height,
  shoulder half-width from the hull's width at that height), `src/player/golems.ts`
  (per-kind `GOLEM_MOTION` — add arm length/swing per kind; the hound gets none),
  `src/main.ts` (set `figure.reaching = !!grab.held || !!carrying` next to where
  `figure.flail` is set; remotes: `r.figure.reaching = !!st.g || st has held prop`).
- Arms are the same material as the body (toon fill + hatch); no new shader.
- Keep `Figure.update(pos, wish, speed, dt)` signature; add a `reaching` flag
  like `flail`.
- Verify: `?seed=7`, `__world.figure` has 2 arm pivots, screenshot walking
  (`__world.pump(60)` with `W` held via `__world.input.hold("KeyW", true)`),
  screenshot holding a relic (`__world.spawnRelic()` then `grab`).

## 2. Show who you can pick up

**Goal:** a white outline on the other player under the crosshair (same
inverted hull as props, `src/player/grab.ts` outline) so "F to pick up" is
visible, not just a HUD line. Also a brief "grabbed!" flail on the victim's
screen is already there — add a chat-bubble-sized toast "Stony-13 picked you up".

- Files: `src/main.ts` (`targetPlayer` is computed each frame — reuse
  `grab.outline` logic on `remotes.get(targetPlayer).figure`), `src/ui/chat.ts`
  for the toast.

## 3. Two-torch doors

**Goal:** sealed vault rooms in the lower cave whose wall opens when two
placed torches stand within 3 m of the two door pillars; inside, a relic.

- Files: `src/world/terrain.ts` (a `vault(x,z)` field: small rooms ~6 m
  across, deterministic per seed, walled by lifting the floor to the ceiling
  in a ring; a "door" cell pair on one side), `src/world/chunks.ts` (recut the
  door cells when open — same path `refloor` uses), `src/world/props.ts`
  (door pillars are shrine-like props; the relic inside is a golem relic),
  `src/main.ts` (each frame check `placedTorches()` against door pillars,
  open = replicate via a new net action or reuse `dig` with a `digTo` at the
  door cells so late joiners replay it), `src/ui/map.ts` (mark doors).
- Verify: dig-map replay already exists (`myDigs` replay to late joiners) —
  using `digTo` for the opening rides on it for free.

## 4. Comic-panel photo mode

**Goal:** photo mode (P) can capture three shots into one page: gutters,
a caption strip in the paper/ink style, one wide panel + two small.

- Files: `src/ui/photo.ts` (`renderStill` already renders a still at print
  density; add a "panel" buffer of up to 3 canvases; compose to an offscreen
  canvas with 24 px gutters; download as PNG), `index.html` (#photo panel
  buttons: "add panel", "make page").

## 5. Deeper is stranger

**Goal:** the lower cave (level 2) reads different from the surface: pen
jitter and misregistration grow with depth below the surface, ceiling arcs
get denser, the ink map's paper is dimmer.

- Files: `src/render/shaders.ts` (a `uDepth` 0..1 uniform multiplied into
  `misreg`, `zoneJitter`, `speck`), `src/render/pipeline.ts` (`applyConfig`
  reads CFG; add `depthStrange` to `Tunables.press` in `src/world/config.ts`
  with a slider in `src/ui/tune.ts`), `src/main.ts` sets `uDepth` from
  `(terrain.surface(x,z) − player.y) / 40` clamped.

## 6. "Hatched rock is grip"

**Goal:** wall climbing only works on hatched (non-black-fill) faces — the
tone decides, so the look tells you where you can climb.

- Files: `src/player/controller.ts` (`wallAhead` → also sample the wall's
  toon tone: cheapest is the analytic lighting model in `src/render/shaders.ts`
  reproduced in TS for the wall normal + nearest torch), or simpler: climb
  only where `terrain.solidity(x,z) < 0.85` (pillar cores are too smooth).
  Start with the simple rule; tune with `climbSolidity` in CFG.

## 7. Props on the surface and in galleries

**Goal:** shards, relics and shrines currently spawn on the lower level only
(`Props.spawn` seats on `floorAt`). Spawn a lighter set on the surface
(`surfaceAt`, level 0) and on gallery slabs (`isUpperOpen`).

- Files: `src/world/props.ts` (`spawn(cx,cz,seed)` — loop levels like
  `scatterRocks` does; seat on `terrain.levelAt(level,x,z)`), knock/ownership
  code is level-agnostic.

## 8. Dig upwards (ceilings)

**Goal:** Myles wants to "dig upwards and then scale up". Steps up walls
exist (aim up at a wall). True ceiling digging does not: ceilings are meshes
only, carved from analytic fields, and the aim ray has nothing to hit.

- Design: a per-level *ceiling* dig map (`digsUp[level]`, metres raised);
  `ceilingAt = ceiling + dugUp`; when `dugUp ≥ thickness(levelAbove) `, the
  level above breaks through from below (its `surfaceAt`/`floor2At` drop to
  the floor here — reuse `through()` with the ceiling map). Aim: march the
  aim ray in 0.25 m steps and test `y ≥ ceilingAt(x,z)` instead of a collider.
- Files: `src/world/terrain.ts`, `src/world/chunks.ts` (`recutCeilings` re-
  samples `ceilingAt`), `src/main.ts` (`planDig` gets a "roof" kind, marker
  drawn upside down), `src/net/room.ts` (`DigMsg.u = 1` for upward).

## 9. Landing and falls

**Goal:** a 30 m fall into a Cathedral vault is intended, but land with a
camera thump, a puff of chips and a stumble (0.4 s no input), and if the
player is ever below every floor (a physics escape) teleport to the nearest
level (`terrain.groundAt`). `T` already respawns at spawn.

- Files: `src/player/controller.ts`, `src/main.ts` (`wasGrounded`/`vyBefore`
  already detect landings for `sound.land`).

## 10. Quality toggle for phones

**Goal:** `printScale` 0.6 on a phone GPU may drop under 30 fps. Add a
`?q=low|med|high` and auto-pick low when `pointer: coarse`; low = printScale
0.45, chunk radius 1, ND pass at half res.

- Files: `src/world/config.ts`, `src/render/pipeline.ts` (`createPipeline`
  takes printScale), `src/world/chunks.ts` (radius arg), `src/main.ts`.

## 11. Prune ghost peers

**Goal:** peers whose heartbeat is older than 8 s vanish (HMR leaves ghosts
that never send `onPeerLeave`).

- Files: `src/net/room.ts` (`peers` map has `seen`; sweep in the heartbeat
  timer), `src/main.ts` (`remotes` disposal path already exists for leave).

## 12. iOS / App Store

**Assessment (2026-09-09):** the game is web tech through and through
(WebGL2, WebRTC, Web Audio) but that does not lock it out of the App Store.

- Cheapest real option: **Capacitor** (or a bare `WKWebView` app) wrapping
  the `pnpm build` bundle. WKWebView on iOS 17+ has WebGL2, WebRTC data
  channels and `getUserMedia` (mic needs `NSMicrophoneUsageDescription`).
  Trystero's Nostr relays are plain WebSockets — fine. ~1–2 days including
  signing, icons (already generated by `scripts/icons.mjs`), a launch screen
  and TestFlight. App Review: it is a complete game, not a thin wrapper, so
  guideline 4.2 (minimum functionality) is met; 4.7 (HTML5 games) applies to
  game *containers*, not a single packaged game.
- Risks: the print pass at fixed density on A-series GPUs (do task 10
  first), no pointer lock (touch controls already avoid it), Web Audio only
  starts on a tap (the hint tap does that), background tabs pausing WebRTC.
- Already shipped without the store: the Pages site is an installable
  web app (manifest + iOS meta). "Add to Home Screen" from Safari gives a
  full-screen icon launch today. Ship that first; wrap later if the store
  itself matters (discovery, payments, push).
- Not worth it: a native rewrite. The shaders are the asset.

---

## How to work here

- Repo `~/Sites/relic-world`, public `mylesmetalab/relic-world`. Push to
  `main` deploys to https://mylesmetalab.github.io/relic-world/ in ~1 min
  (`gh run list -R mylesmetalab/relic-world`). Myles's standing rule: deploy
  as you go after each verified change, no confirmation needed.
- Typecheck: `node_modules/.bin/tsc -p tsconfig.json --noEmit` (pnpm 11's
  corepack fights the pinned `packageManager`; call tsc directly). Build:
  `pnpm build`. Dev: `pnpm dev` on port 5300.
- Verify in a browser at `http://localhost:5300/?seed=7` (private world, so
  nobody else's digs land in your test). `window.__world` exposes `player`,
  `cam`, `terrain`, `chunks`, `figure`, `net`, `remotes`, `grab`, `tune`,
  `input`, `cfg`, `pump(n)` (runs n frames — a hidden tab gets no rAF),
  `applyDig`, `digAtAim`, `spawnRelic`, `grabPlayer(id)`, `throwPlayer(v)`,
  `carried()`, `shot()` (JPEG data URL). Click `#hint` first. Vite full-reloads
  on most edits, so gather all readings in one JS call. `?touch=1` forces the
  touch layer for desktop testing.
- Two-tab multiplayer test: open two tabs on the same `?seed=`; peers appear
  in `__world.net.peers` within ~3 s; use `grabPlayer`/`throwPlayer` in one
  and read `carried()`/`player.position` in the other, pumping the carried
  tab yourself.
- Commit style: imperative subject, body says why; co-author tag
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Update
  README/PLAN in the same commit as the code.
- Design rules: everything drawn is the toon material or paper-white
  telemetry; new tunables go in `src/world/config.ts` + a slider range in
  `src/ui/tune.ts`; no sky other than bare paper; no drone.
