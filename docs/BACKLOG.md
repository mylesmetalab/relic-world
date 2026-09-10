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

**Built (2026-09-10): Simulator-buildable scaffold, done — signing and
TestFlight are the only things left, and only Myles can do them.**

- Added Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios` as
  devDependencies) and ran `cap init` / `cap add ios` — bundle id
  `uk.co.mylespalmer.relicworld` (his own domain, reverse-DNS'd, per his ask
  rather than a Metalab identifier). `capacitor.config.ts` sets `webDir:
  "dist"` and a `backgroundColor` of `#0a0a12` matching the PWA manifest's
  `theme_color`, so the WKWebView doesn't flash white before the canvas
  paints. Capacitor 8's iOS template uses **Swift Package Manager**, not
  CocoaPods — there is no `ios/App/App.xcworkspace` and no Podfile, so
  `pod install` is never needed here; `xcodebuild` resolves the one SPM
  dependency (`capacitor-swift-pm`) itself on first build.
- `ios/App/App/Info.plist`: added `NSMicrophoneUsageDescription` ("Relic
  World has opt-in proximity voice chat with nearby players. Your mic is
  only used if you turn voice on.") for the existing opt-in voice feature,
  and narrowed `UISupportedInterfaceOrientations`(`~ipad`) to landscape only,
  matching `public/manifest.webmanifest`'s `"orientation": "landscape"`.
- App icon and launch screen: adapted the exact procedural mark from
  `scripts/icons.mjs` (the ink cairn + yellow flame on paper) at 1024×1024,
  no alpha channel, into `ios/App/App/Assets.xcassets/AppIcon.appiconset/
  AppIcon-512@2x.png` (Xcode 14+ uses one universal 1024 px source, despite
  the legacy filename) — a reasonable adaptation, not a pixel-perfect
  redesign for iOS's corner-mask/no-alpha rules. Replaced Capacitor's
  default blue-logo splash images (`Assets.xcassets/Splash.imageset/*`,
  three identical 2732×2732 files per Apple's universal launch-image setup)
  with a flat `#0a0a12` fill instead of reinventing a splash design.
- `tsconfig.json` needed no changes: `include: ["src"]` already keeps `tsc`
  away from `ios/` and `capacitor.config.ts`; typecheck stayed clean
  throughout.
- **Verified via a real Simulator build**, no signing identity needed
  (`security find-identity -v -p codesigning` shows 0 — confirmed a
  Simulator build doesn't care): `vite build` → `cap sync ios` →
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk
  iphonesimulator -destination 'generic/platform=iOS Simulator' build` →
  **BUILD SUCCEEDED**, code-signed "Sign to Run Locally" (the ad-hoc
  simulator signature that needs no developer account). Installed and
  launched on an iPhone 17 Pro simulator (`xcrun simctl install`/`launch`);
  screenshots (`xcrun simctl io screenshot`) show the real paper-cave scene
  — riso hatching, the HUD, the touch stick/button cluster — rendering
  correctly, not a blank or crashed WebView.
- **Multiplayer verified working with zero code changes**, across two real
  processes: a Browser-pane tab at `http://localhost:5300/?seed=7` and the
  Simulator app pointed at the same URL (via a temporary
  `capacitor.config.ts` `server.url` override, reverted before commit — the
  shipped app still loads the bundled `dist/`). Both sides showed up in each
  other's `__world.net.peers`/`remotes`, the HUD read "with `<other's
  name>`" on both, and each screenshot shows the other's figure standing
  nearby — confirming `src/main.ts`'s solo check (`?solo=1` or
  `sites.metalab.com`'s hostname) correctly stays *false* for a
  `capacitor://`/`http://localhost` origin, and that Nostr's `wss://` relay
  signaling and the resulting WebRTC data channel work inside WKWebView with
  no ATS exception needed.
- **One real blocker hit and worked around, not silently skipped:** the
  `mcp__Claude_Code_iOS_Simulator__control` tool (attach/launch/screenshot/
  tap) refused every call with "Xcode is installed but not selected... run
  `sudo xcode-select -s ...`", even though `xcode-select -p` and
  `xcodebuild -version` both show Xcode correctly selected and building
  fine directly — an environment-detection bug in that tool in this sandbox,
  not a real Xcode problem, and not fixable without a `sudo` password this
  session doesn't have. Worked around for the build/install/launch/
  screenshot parts with `xcodebuild`/`xcrun simctl` directly (used above).
  Touch-input verification (tap/swipe on the touch layer) could **not** be
  completed: two different attempts to synthesize a click into the
  Simulator's window via AppleScript/System Events (raw screen coordinates,
  then an accessibility-element click) both left the app's "tap to enter"
  hint unchanged, so this pass stops there per the two-failed-attempts rule
  rather than continuing to guess at window/screen coordinate math. The
  touch layer itself is unchanged code (already shipped, already used on
  real touch devices), so this is a verification gap in this session, not a
  known defect.
- Nothing about the existing web build changed: the solo-mode regex in
  `src/main.ts` is untouched, and this pass never ran the Metalab Sites
  republish step — GitHub Pages and Metalab Sites keep behaving exactly as
  before.

**What's left — only Myles can do this part (no Apple Developer Program
membership yet; `security find-identity` confirms zero signing identities
on this Mac):**

1. Enroll at developer.apple.com/programs/enroll as an **Individual**
   ($99/yr) — an Apple ID and a payment method, no D-U-N-S number (that's
   only for the Organization account type). Approval is usually instant to
   about 48 hours.
2. Sign that Apple ID into Xcode: **Xcode → Settings → Accounts → +**.
3. Open `ios/App/App.xcodeproj` in Xcode (this project has no CocoaPods, so
   there's no `.xcworkspace` to open instead — the `.xcodeproj` is it).
   Select the **App** target → **Signing & Capabilities** → check
   "Automatically manage signing" → pick his personal team. The bundle id
   `uk.co.mylespalmer.relicworld` registers to his account automatically on
   the first signed build; it does not need to be pre-registered anywhere.
4. Create the app record in App Store Connect
   (appstoreconnect.apple.com → My Apps → **+** → New App), matching that
   bundle id, name "Relic World" (or whatever he'd rather call it there).
5. In Xcode: pick **Any iOS Device** (not a Simulator) as the run
   destination, then **Product → Archive**, then **Distribute App → App
   Store Connect → Upload**. Processing in App Store Connect typically takes
   15–60 minutes.
6. In App Store Connect's **TestFlight** tab: answer the export-compliance
   question (apps that only use HTTPS/TLS/WebRTC's built-in DTLS are
   typically the standard "uses encryption, exempt" case — but read the
   exact wording when it's in front of him rather than trusting a canned
   answer), then add **Internal Testers** (up to 100 people, no review, near
   -instant) or **External Testers** (needs a quick Beta App Review, usually
   24–48 hours).
7. Multiplayer needs no extra setup beyond the above — it rides the same
   Nostr-relay WebRTC signaling the web build already uses, verified working
   end-to-end in this pass (see above). Nothing App Store- or
   TestFlight-specific is required for peers to find each other.

---

## 13. Instance the rocks

**Goal:** cut draw calls — and the ND pass's doubled cost on top of them —
from one mesh per rock to a handful of `InstancedMesh` batches per
chunk-level, without losing per-rock hatch anchoring or per-rock convex-hull
physics colliders. This is the thing most likely to silently hurt phones and
the iOS TestFlight build (which now defaults to `high` quality, same as
desktop) if left alone.

- Today: `scatterRocks(terrain, cx, cz, chunkSeed, level)`
  (`src/world/terrain.ts`) builds a UNIQUE procedural geometry per rock;
  `src/world/chunks.ts`'s rock loop makes one `THREE.Mesh` per rock, each
  with its own `anchorHatch(this.p, mesh, r.hatchSeed)` call. `anchorHatch`
  (`src/render/pipeline.ts`) sets an `onBeforeRender` that projects the
  mesh's world origin to print pixels and writes it into a uniform SHARED by
  every mesh using `rockMat` — this only works because meshes draw one at a
  time, each mutating the uniform right before its own draw call. That
  approach cannot survive real instancing (all instances in one draw call
  share one set of uniforms).
- Approach: bake a small fixed pool of prototype rock geometries once (8–12
  shapes spanning the small/tall/stalagmite silhouettes `rockGeometry`
  already produces, generated up front instead of per-rock). `scatterRocks`
  picks a prototype index per rock (deterministic from `chunkSeed`/rock
  index) instead of building a unique geometry, still returning per-rock
  position/rotationY/hatchSeed/hull. `chunks.ts` groups rocks by prototype
  id and builds ONE `THREE.InstancedMesh` per prototype per chunk-level
  (instead of one `THREE.Mesh` per rock), setting each instance's matrix
  from position + rotationY.
- Hatch anchoring has to move from the CPU (`onBeforeRender` per mesh) into
  the shader for instanced rocks: add an instanced attribute (e.g.
  `instanceHatchSeed`, an `InstancedBufferAttribute`) and compute each
  instance's world origin → print-pixel projection in GLSL from
  `instanceMatrix`, using the view/projection matrices already available to
  the material — real work in `src/render/shaders.ts` (the hatch-anchoring
  block) and `src/render/pipeline.ts` (an "instanced hatch mode" variant;
  leave the existing per-mesh `onBeforeRender` path alone for chunk
  floor/ceiling meshes, which are already one draw call each and don't need
  this).
- Colliders are unchanged: keep one convex-hull collider per rock instance
  exactly as today (`addConvexHull`) — Rapier doesn't care how rendering
  batches things.
- Non-goals, to keep this PR-sized: don't instance chunk floor/ceiling
  meshes (already one draw call per level) or figures; scope strictly to
  `scatterRocks`'s rock population.

Files: `src/world/terrain.ts` (`rockGeometry`/`scatterRocks` — prototype
pool + per-rock prototype index), `src/world/chunks.ts` (group by prototype
into `InstancedMesh` per level per chunk), `src/render/pipeline.ts`
(instanced-hatch attribute wiring), `src/render/shaders.ts` (per-instance
hatch-phase projection).

Verify: compare `renderer.info.render.calls` before/after at the same
chunk radius/seed — should drop meaningfully; screenshot a rock-dense area
and confirm hatching still reads correctly anchored per-rock (no shared or
smeared pattern across instances, which is the failure mode this refactor
risks); walk into rocks and confirm colliders still block correctly.
This is the hardest of the new briefs (real per-instance shader math) — if
the projection math doesn't work out after two real attempts, stop and
report rather than ship visibly broken hatching.

**Built (2026-09-10):** shipped as designed, plus a real bug caught and
fixed by measuring rather than trusting the design. The prototype pool
(`rockPrototypes()` in `terrain.ts`, 10 unit-scale shapes), per-instance
scale/hull, `InstancedMesh` batching, and the GLSL hatch-anchor projection
(`USE_INSTANCE_HATCH` in `shaders.ts`/`pipeline.ts`) all landed as specced —
including fixing up the ND pass's own vertex shader, which predates
instancing and needed its own manual `instanceMatrix` application (missing
this would have silently corrupted the ND key-plate's normals/depth for
every rock once instanced).

The first real build **made draw calls worse, not better**, and this was
caught by actually measuring rather than trusting the design: `InstancedMesh`
needs `computeBoundingSphere()` called explicitly after its instance
matrices are set, or frustum culling falls back to the base geometry's tiny,
near-origin bounding sphere — every batch either always drew (no win) or,
worse, wrongly passed the cull test near world origin regardless of where
its instances actually were. Measured directly (stash the diff, reload,
compare `renderer.info.render.calls` at an identical player position/camera
angle before and after): missing the call, rock draw calls went from 51 (old
per-mesh code) to 59 (new, "instanced") at one test spot — confirmed broken,
not just underwhelming. Added the `computeBoundingSphere()` call and
re-measured clean.

A second, independent finding from the same profiling: bucketing per
(chunk, level, prototype) was too fine — most chunk-levels only have a
handful of rocks spread across 10 prototypes, so most buckets ended up as
singletons, barely beating one-mesh-per-rock. Fixed by pooling all three
levels' rocks into one set of per-chunk buckets (rendering never cared
which level a transform came from — only `scatterRocks`' placement logic
did). Final, clean, apples-to-apples measurement (same exact player
position/camera angle, same seed, stashing the whole diff for the "before"
run): **202 → 157 total draw calls** (≈22%) in a dense Glacier-biome
stalagmite cluster — visually confirmed correct (hatching still reads
per-rock, no shared/smeared pattern) and collision-confirmed (walked into
the cluster, stayed grounded, no clipping through, no physics-escape
rescue firing).

## 14. Dig swing

**Goal:** when you (or a peer) swing a pick to dig, the figure's arm
actually swings through the motion — arms exist now (brief 1), but digging
doesn't use them, so the game's single most common action is invisible on
the body.

- `Figure.update()` (`src/player/figure.ts`) already has two pose states
  ahead of ordinary walk-swing: a top-of-function `flail` branch, and a
  `reaching` check further down that overrides arm rotation with a fixed
  forward-reach pose. Add a third, time-bounded one: `swing(ms = 300)`
  (mirror `PlayerController`'s `stumbleT` countdown pattern from brief 9) —
  a `swingT` field that counts down each `update(pos, wish, speed, dt)`
  call. While `swingT > 0`, override one "lead" arm's rotation (e.g.
  `arms[0]`) through a short eased windup-then-strike arc, timed to peak
  roughly when the dig cell is actually carved. `swing()` takes priority
  over `reaching` (a dig mid-carry should still show the swing) but loses to
  `flail` (being carried while trying to dig is an edge case — flail wins).
  No-op if `this.arms.length === 0` (the golem Hound has none, per
  `GOLEM_MOTION`) — don't throw.
- Wire it in `src/main.ts` at exactly two call sites, not inside `applyDig`
  itself (that's the wrong layer — it's also called by the vault-door
  auto-open, which should NOT trigger a swing):
  - Local: inside `digAtAim()`, alongside the existing `sound.dig(...)` /
    `digMark.burst(...)` calls.
  - Remote: `net.onDig` already hands you `(d: DigMsg, peerId)` — call
    `remotes.get(peerId)?.figure.swing()` there. No new net protocol field
    needed; the existing `DigMsg` + `peerId` is enough.

Files: `src/player/figure.ts` (`swing()` + `swingT` + arm-pose priority in
`update()`), `src/main.ts` (`digAtAim()` and the `net.onDig` handler).

Verify: `?seed=7`, dig at aim, confirm `figure["swingT"] > 0` right after
and the arm visibly swings across a pumped-frame sequence; two-tab test —
dig in tab A, confirm tab B's remote figure for A also swings; confirm a
Hound-character digger doesn't error (no arms).

## 15. More biome variety (and give biomes some teeth)

**Goal:** today's 7 biomes (`src/world/biomes.ts`) differ only by palette +
ink-pen parameters + a few terrain numbers (`terrace`/`relief`/`rocks`/
`tallShare`/`ceilLift`) — nothing is mechanically distinct beyond
Cathedral's taller ceiling. Add a couple more biomes, and give at least one
(existing or new) an actual gameplay difference, so "deeper is stranger"
gets a sibling: "here is stranger."

- Add 2–3 new `Biome` entries following the exact shape every existing one
  uses. Reuse an existing ramp (like Cathedral reuses "Void Peaks") or add
  new `ENVWAYS` colorway entries in `src/render/palette.ts` for genuinely
  new palettes. Ideas in the game's own idiom (no literal water/weather —
  everything is still rock, ink and light): a "Crystal Vein" (low `black`,
  high `nib`, sparse rocks, high `tallShare` — bright, glassy, sparse) or a
  "Root Cellar" (high `cracks`/`stipple`, low `relief`, lots of small rocks
  — cramped and tangled).
- Pick ONE mechanical hook (not more — keep this PR-sized) so a biome
  actually feels different to move through, not just look different. Two
  concrete options, use judgement on which fits the current code best:
  (a) Per-biome climb grip: brief 6's `climbSolidity` gate in
  `src/player/controller.ts` currently reads one global `CFG.world.
  climbSolidity` — read `terrain.biome(x,z).climbSolidity` instead, falling
  back to the global for biomes that don't override it, so e.g. Glacier
  reads as slippery (lower threshold) and Sulphur Pit as soft/crumbly
  (higher).
  (b) Per-biome prop density: extend brief 7's `propUpperDensity` pattern in
  `src/world/props.ts` with a `Biome.propDensity` multiplier.
- Keep the design rules: no sky, no drone sound, nothing here touches the
  dig-cell system's small/cell-snapped rule.

Files: `src/world/biomes.ts` (new entries + any new mechanical field),
`src/render/palette.ts` (new `ENVWAYS` ramps if needed), and whichever of
`src/player/controller.ts` / `src/world/props.ts` the chosen mechanical
hook lives in.

Verify: `?seed=7`, sample `terrain.biomeId(x,z)`/`terrain.biome(x,z).name`
across a range of chunks (and try a different `?seed=` if the new biomes
don't turn up nearby — they're seeded per-world) to confirm the new biomes
exist and screenshot each one's distinct look; specifically demonstrate the
chosen mechanical difference (e.g. climbing failing at the same solidity
value in one biome but succeeding in another).

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
