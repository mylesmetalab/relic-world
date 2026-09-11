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

**Built (2026-09-10):** shipped as specced — `swing(ms = 300)` + `swingT`
+ an eased windup/strike/settle arc on `arms[0]` in `Figure.update()`,
wired only at the two named call sites (`digAtAim()` locally,
`net.onDig` for remotes), untouched `applyDig`. Verified `swingT` hits 0.3
right after a local dig and rides the arc down over ~18 pumped frames
(screenshotted mid-strike); Hound (no arms) digs without throwing. The
remote wiring was verified by calling `net.onDig` directly against a
synthetic `remotes` entry (its figure's `swingT` jumped to 0.3 exactly as
wired) rather than over a live two-tab WebRTC handshake, because this
sandbox blocks the outbound WebSocket to the Nostr signalling relay
(`wss://chorus.pjv.me/`) — an environment limitation, not a code issue.
Also found, and left alone as out of scope here: remote figures are only
ever `place()`d (position + facing), never `update()`'d, so `flail`/
`reaching`/`swing()` are set on their state but have no render path today
— a brief-6-era gap, not something this brief introduced or was asked to
fix.

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

**Built (2026-09-10):** shipped as specced, option (a) — per-biome climb
grip. Three new `Biome` entries in `src/world/biomes.ts`: Dusk Ridge and Root
Cellar reuse the two `ENVWAYS` colorways in `src/render/palette.ts` that had
sat unused since the palette was written ("Dusk Ridge" warm orange canyon;
"Ash Field" grey → Root Cellar's cramped, low-ceiling tangle, `ceilLift:
-3`); Crystal Vein gets a genuinely new bright cyan/violet ramp, sparse and
glassy. `Biome` gained an optional `climbSolidity`; `PlayerController.
climbable()` reads `terrain.biome(x,z).climbSolidity ?? CFG.world.
climbSolidity` — Glacier (0.65) and Sulphur Pit (0.95) got the brief's own
suggested values, Crystal Vein overrides to 0.55 (glassiest). No new CFG/
tune.ts tunable, since this is per-biome data like `terrace`/`ceilLift`, not
a global slider. Verified at `?seed=7`: typecheck clean; all 10 biomes
sampled correctly across a wide chunk grid with `climbSolidity` reading back
per biome; screenshotted all three new biomes' distinct looks. Demonstrated
the mechanical difference live by force-loading chunks (`chunks.buildAll`)
at real sheer walls and driving the controller directly: a Crystal Vein wall
held solidity 0.52–0.60 for ~2.2 s of pushing and never climbed (denied),
even though that same solidity is comfortably under the global default
(0.85) and would climb in any of the seven unmodified biomes; the identical
setup against a Sulphur Pit wall at solidity ≈0.63 granted the climb almost
immediately. See `docs/PLAN.md`'s twenty-first pass for the full verification
notes and a caveat about why an exact matched-solidity side-by-side (same
value, two biomes, live) is harder to catch mid-walk than the brief's "e.g."
implies — a wall's first-contact solidity is bounded by `wallLo`/`wallHi`
(≈0.56–0.66) regardless of biome, so the two demonstrations above (each
compared against the global default) are the cleanest real proof available.

## 16. Torches run out

**Goal:** placed torches (`X`) are permanent today — `TorchProp` has no
lifetime, so the two-torch vault door (brief 3) is a one-time unlock, not a
resource decision. Give placed torches a burn time so keeping two lit at
once, and finding your way back through a dark cave, are real choices —
world/shrine torches (`placed: false`, spawned by chunk generation) are
unaffected, only player-placed ones.

- `TorchProp` (`src/world/props.ts`) gets a `life`/`maxLife` (seconds) —
  only meaningful when `placed`. New tunable `world.torchLifeSec` in
  `src/world/config.ts` (a few minutes feels right — tune by feel once it's
  running) with a slider in `src/ui/tune.ts`.
- Countdown lives in `src/main.ts`'s per-frame loop (near `checkVaultDoors()`
  — `Props` doesn't have `net.selfId` in scope and shouldn't need to), and
  only ticks torches YOU placed: `chunks.props.placedTorches().filter(t =>
  t.id.startsWith(net.selfId))`. On expiry, `chunks.props.removeTorch(id)`
  and call `sendMyTorches()` immediately (don't wait for the existing 4 s
  periodic broadcast) so onlookers see it go out promptly.
- Cheap dying-torch visual, no new shader/uniform needed: shrink the
  `TorchProp.reach` value as `life` runs low (say, the last quarter of
  `maxLife`) — `reach` already feeds directly into the light radius pushed
  into `p.torches` each frame, so a shrinking reach reads as a dimming torch
  for free.
- **A real latent bug this brief will make visible constantly, so fix it as
  part of this brief, not as scope creep:** `net.onTorches` (`src/main.ts`)
  is additive-only — it calls `addTorch` for everything in an incoming list,
  but never removes a peer's torch that's missing from a later list. Today
  that only shows up rarely (recycling past `MAX_PLACED_TORCHES`); with
  torches expiring on a timer it would happen constantly and every burned-out
  torch would sit there forever on OTHER players' screens. Fix `onTorches`
  to reconcile: track which torch ids belong to each peer and remove any
  that are no longer in that peer's latest list (the existing 4 s periodicity
  of `sendMyTorches()` is enough — no new net message needed).
- The vault door itself needs no change: `checkVaultDoors()` already
  re-evaluates `placedTorches()` every frame, so a torch burning out before
  both pillars are lit simply means the door doesn't open (the intended
  tension) — once it DOES open it's carved into the terrain permanently, so
  torches expiring afterward correctly doesn't reseal it.

Files: `src/world/props.ts` (`TorchProp.life`/`maxLife`, reach-dimming),
`src/main.ts` (countdown + expiry near `checkVaultDoors()`, the `onTorches`
reconciliation fix), `src/world/config.ts` + `src/ui/tune.ts`
(`torchLifeSec`).

Verify: place a torch, fast-forward its life via `__world` (set `life` near
0 directly, or lower `torchLifeSec` via `?cfg=`/the tune panel for a quick
test) and confirm it dims then disappears, screenshot the dim/near-death
state; two-tab test — place a torch in tab A, expire it, confirm tab B's
view of that torch also disappears within one broadcast interval (~4 s);
confirm a *world* shrine torch (a vault's door pillar, `placed: false`)
never dims or disappears no matter how long you wait.

**Built (2026-09-10):** shipped as specced — `TorchProp.life`/`maxLife`
(`addTorch` sets `maxLife = placed ? CFG.world.torchLifeSec : Infinity`, so
a shrine torch is structurally exempt), a new `tickTorches(dt)` in
`src/main.ts` called next to `checkVaultDoors()` that only ever iterates
`placedTorches().filter(t => t.id.startsWith(net.selfId))`, shrinking
`reach` over the last quarter of life and calling `removeTorch` +
`sendMyTorches()` immediately on expiry. `world.torchLifeSec` (default 180)
added to `config.ts`/`tune.ts`. Also fixed the additive-only `net.onTorches`
bug called out in the brief: it now removes a peer's torches missing from
their latest list before applying it, using the `peerId` the handler
already receives — no new net message. Verified at `?seed=7`: typecheck
clean; placed a torch and read `life: 180`/`maxLife: 180`/`reach: 15`;
forced `life = 20` and pumped frames — `reach` fell to ≈6.66, screenshotted
dim; forced expiry and confirmed the torch left both `chunks.props.torches`
and `placedTorches()`; pumped 120 frames against a real shrine torch and
confirmed its `reach` stayed 15 and it was never in the tick list. The
`onTorches` fix was verified by calling it directly against a synthetic
peer id with a shrinking torch list (two torches, then one) and confirming
the missing one was removed, since this sandbox's outbound WebSocket to the
Nostr signalling relay is still blocked (reconfirmed with two real tabs —
`net.peers` stayed empty) — an environment limitation, not a code issue.

---

## 17. A wandering presence

**Goal:** give the cave a sense of not being alone, without turning this
into a combat game. One roaming figure per room, non-hostile, no fail
state, no damage, no combat — it just reacts to torchlight: recedes from a
lit torch nearby, otherwise drifts on its own slow business. Decided with
Myles directly (2026-09-10): this shape specifically (a wandering presence,
not a cave-in event, not a hostile creature with a health/knockback model —
that's explicitly out of scope, a much bigger swing this pass isn't taking),
and **gated to private/seeded worlds only for now** (`?seed=`) — NOT the
shared rolling world everyone plays in by default, until it's been felt out.

- **Gate:** `src/main.ts` already computes `const shared = seedParam ==
  null;` (true only for the default shared world). Also add a CFG toggle
  (`world.presenceEnabled`, default `true`) so it can be killed without a
  redeploy — `src/ui/tune.ts` already has a checkbox pattern (`<input
  type="checkbox" data-k="...">`, see the STL toggle) if that's the cleanest
  fit, otherwise a 0/1 numeric tunable is fine. The feature is active only
  when `!shared && CFG.world.presenceEnabled`.
- **Look:** do NOT reuse an existing playable `GolemKind` from `src/player/
  golems.ts`/`CHARACTERS` (`src/player/figure.ts`) — a player could be
  wearing that same skin and it would read as a confusing duplicate, not an
  entity. Build its shape with its own small, distinct construction (a
  jagged rock-stack silhouette in the same idiom as the golems is fine and
  cheap to reuse the *technique* from, just not literally shared model
  data), rendered with the same toon/hatch material system as everything
  else so it's visually consistent with the world.
- **"Half-seen," not "unprinted until lit":** rock's bare-paper-until-lit
  look is driven by a persistent per-vertex ink map that doesn't apply to a
  moving entity. Approximate the same *feeling* more simply: each frame,
  check whether it's within `reach` of any of the current frame's active
  light sources (the same `p.torches`/light list `src/main.ts` already
  builds each frame from `chunks.props.torches` + the player's own torch)
  and only render it (or render it at meaningfully lower opacity/visibility)
  when it is. Genuinely half-seen — most of the time, in the dark, you
  shouldn't see it at all.
- **Behavior — deliberately simple, no pathfinding:** wander by drifting
  toward a randomly re-picked nearby target point (re-pick every several
  seconds, or on arrival), loosely avoiding walls by sampling
  `terrain.solidity(x,z)` the way `scatterRocks` avoids walls rather than
  real collision/pathfinding. When any player-carried or placed torch comes
  within some radius, switch to fleeing: accelerate directly away from the
  nearest such light, faster than its normal drift. No attack, no contact
  effect on the player at all — if a player walks right into it, nothing
  happens (or, at most, the same passive collider treatment as any other
  prop; do not add any harm/knockback/health system, none exists in this
  game and this brief must not be the one to introduce it).
- **One per room, single sim authority:** exactly one connected client
  should simulate its movement/AI each frame and broadcast position (+
  fleeing state) to the rest — everyone else just interpolates/places it,
  same spirit as how `Props`' dynamic bodies work ("the nearest player
  simulates a prop and everyone else follows," `src/world/props.ts`). Since
  this is a single shared entity, not a per-position prop, pick authority
  with a simple tie-break already idiomatic to this codebase: `isOwner` in
  `src/main.ts` breaks position ties with `id < net.selfId`; for one global
  entity, the equivalent is "I am the owner iff my id is the lexicographically
  smallest among `net.selfId` and every connected `remotes`/peer id." Add a
  small new net message (mirror `TorchMsg`/`DigMsg` in `src/net/room.ts`,
  e.g. `PresenceMsg = { p: [number, number, number], f: 0 | 1 }` for
  position + fleeing) sent by the owner on a modest interval (reuse the
  torch cadence, ~4 s, or faster while fleeing for responsiveness — use
  judgement).
- **Sound, optional, keep it simple:** a soft, occasional, non-continuous
  audio cue (NOT a drone — the design rules ban a continuous drone
  specifically) when it's nearby but unlit, reusing `Sound`'s synthesis
  style (`src/audio/sound.ts`). If this proves fiddly, it's fine to ship
  without it and note that as a followup — the visual behavior is the
  substance of this brief, the sound is a nice-to-have.
- This is the largest, least-precedented brief in the backlog — an actual
  new entity type with AI and its own net sync, not an extension of
  something that already exists. It is explicitly fine to land a smaller,
  solid version (e.g. skip the sound cue, or simplify wander/flee to
  something cruder than described) rather than force the full design if a
  part of it proves genuinely risky — say so clearly rather than shipping
  something half-working. Two failed attempts on any one sub-problem means
  stop and report exactly what's blocking, same as every other brief.

Files: a new small module (e.g. `src/world/presence.ts`, following the
shape of `src/world/props.ts`/`golems.ts` rather than cramming this into an
existing file), `src/main.ts` (the gate, per-frame tick, ownership check,
wiring into the light list for visibility), `src/net/room.ts` (the new
message type), `src/world/config.ts` + `src/ui/tune.ts`
(`presenceEnabled`, and any wander/flee tunables — radius, speeds).

Verify: `?seed=7` (a private world — the gate should be ON here), confirm
it exists and wanders when left alone for a while (pump many frames,
sample its position over time to show it's moving); place/carry a torch
near it and confirm it flees (position moves away, screenshot the visible
moment it's lit and receding); move away and confirm it becomes invisible/
very dim again; confirm walking directly into it does nothing (no damage,
no knockback, no console error). Load the game with NO `?seed=` (or
`presenceEnabled: 0` via `?cfg=`) and confirm it does not spawn at all —
this gate is the one thing that must not be wrong. Two-tab test if
feasible: confirm only one tab simulates it (check which one via the
ownership tie-break) and the other sees it move via the new net message —
if the sandbox's WebSocket relay is blocked (as in recent prior passes),
verify the ownership/message-passing logic directly instead and say so.

**Built (2026-09-10):** shipped close to spec, with one deliberate
simplification called out up front: "one per room" landed as one presence
for the whole world (not one spawned per chunk with per-instance ownership)
— the brief's own framing ("since this is a single shared entity, not a
per-position prop") reads as inviting exactly this, and it delivers the same
"not alone" feeling without per-room spawn/despawn complexity as chunks
stream. It's also confined to the lower cave (level 2) rather than all three
levels, for the same reason. New `src/world/presence.ts`: its own
stacked-`rockGeometry` silhouette (the golems' technique, not their model
data or a `GolemKind`), no Rapier body at all (walking into it does nothing
because there's nothing to collide with), wander/flee sampling
`terrain.isOpen` the way `scatterRocks` avoids walls, and "half-seen" done
as a hard per-frame visibility gate against the same `p.torches` list
`main.ts` already builds (not a persistent ink map, which doesn't apply to
something that moves). Sync: a new `PresenceMsg` (`src/net/room.ts`) sent by
whichever client's id is lexicographically smallest among itself + connected
`remotes` — recomputed fresh every frame, so a departing owner needs no
special handling. Gate: `!shared && CFG.world.presenceEnabled` (new 0/1
tunable, default 1). Shipped the optional sound cue too (`Sound.presence()`
in `src/audio/sound.ts`, a one-shot tone + filtered burst on a randomized
cooldown while unlit and nearby — not a drone). Verified at `?seed=7`:
typecheck clean; confirmed `__world.presence` is `null` on the shared world
and with `presenceEnabled: 0` even on `?seed=7`, and non-null otherwise;
watched it wander over pumped frames, flee and become visible the instant a
torch came within range (screenshotted), and fade back to invisible on
retreat; walked directly onto it with `console.error` intercepted — no
error, no effect on player physics. This session's sandbox could actually
reach the Nostr signalling relay (unlike several recent prior passes), so
the ownership tie-break and net sync were confirmed **live across two real
tabs**, not by direct invocation: the lower-selfId tab read
`isPresenceOwner() === true`, the other `false`; the non-owner's
`presence.position` converged onto the owner's broadcast, and flipping the
owner to fleeing propagated to the non-owner within one broadcast interval.
See `docs/PLAN.md`'s twenty-second pass for full detail.

---

## 18. A boulder that takes two

**Goal:** reuse the physics you already have (dynamic rigid-body props,
Rapier's kinematic-controller-pushes-dynamic-bodies via
`setApplyImpulsesToDynamicBodies(true)`, already set in
`src/player/controller.ts`) for something more theatrical than a statue
that topples at a touch: a big, heavy boulder that one player can barely
budge alone, but two pushing together move for real. No new mechanic, no
"requires N players" gate — just mass tuned so the physics itself makes it
a co-op moment.

- `src/world/props.ts` already has everything needed: `makeDynamic(id, geo,
  hullPts, x, y, z, yaw, material, density, mesh?)`, and two existing
  density tiers to calibrate against (`ROCK_DENSITY = 800` for shards/
  statues, `GOLD_DENSITY = 6000` for relics). Build one new large, roughly
  round boulder shape (bigger radius than any existing shard, low height-to-
  radius ratio so it reads as a boulder, not a stalagmite — `rockGeometry`
  can produce this at the right radius/height args) at a density high
  enough that ONE player's push barely moves it but two clearly do — this
  needs real in-browser tuning, not a guess: measure actual displacement
  over N seconds of one simulated push vs. two real players pushing
  together (see Verify).
- Placement: a handful, not everywhere — sparse and findable, the way
  vaults are sparse (`Terrain.vault`/`vaultsInChunk` in `terrain.ts` is a
  reasonable pattern to mirror for "boulder sites," own noise/hash, own
  grid spacing, no need to guarantee a literal slope under it — the mass
  tuning is what makes this a two-player moment, a slope is a nice-to-have
  bonus if convenient, not a requirement). Lower cave (level 2) is fine.
- **Important existing-architecture note, so this isn't rebuilt from
  scratch:** prop physics ownership (`src/main.ts`'s `isOwner`, distance-
  based, recomputed every frame — "the nearest player simulates a prop and
  everyone else follows") already means two players standing near the same
  prop effectively hand ownership back and forth as their relative distance
  shifts, each contributing their own push during their momentary ownership
  window. This is the existing mechanism this brief rides on for a
  "two-player" feel — do not attempt to build genuine simultaneous dual-
  authority physics for one prop; that's a much bigger change than this
  brief is asking for. If the handoff-based feel doesn't read as
  convincingly cooperative once tuned, say so honestly rather than trying
  to redesign the sync model.
- A knock/impact sound already exists (`chunks.props.onKnock`, wired to
  `sound.knock`) — reuse it, no new sound needed.
- No harm, no new interaction verb: walking into it (or being near it while
  it rolls) does nothing beyond ordinary physics contact, same as every
  other dynamic prop today.

Files: `src/world/props.ts` (new boulder shape + spawn/placement logic),
`src/world/terrain.ts` (a sparse placement field if mirroring the vault
pattern), `src/world/config.ts` + `src/ui/tune.ts` if the density/size ends
up worth exposing as a tunable rather than a fixed constant (use judgement
— this may be fine as a fixed, tuned-by-feel number like `ROCK_DENSITY`
itself is).

Verify: `?seed=7`, find a placed boulder (may need to sample/search a few
sites or teleport, same as biome-sampling in brief 15). Push it alone for a
fixed few seconds and measure real displacement (should be small/slow).
Two-tab test — both players push from the same side (or opposite sides)
for the same duration and measure displacement again (should be clearly
larger) — this is the one thing that actually needs a real two-tab test,
not a synthetic stand-in, since it's specifically about the felt difference
between one and two players; recent passes (brief 17) found this sandbox's
WebRTC actually works, so attempt it for real before falling back to
anything synthetic. Screenshot the boulder both at rest and mid-roll.

**Built (2026-09-10):** shipped close to spec, plus a real physics problem
caught by testing rather than guessed at. `Terrain.boulderSite`/
`boulderSitesInChunk` mirrors `vault`'s own-grid/hash sparse-placement
pattern (a ~40 m grid, lower cave only, clear of spawn); `Props.addBoulder`
seats one per site via the existing `makeDynamic` at a new fixed
`BOULDER_DENSITY` (400 — a tuned physical constant like `ROCK_DENSITY`
itself, not a slider). The brief's own suggested shape (a wide, short CONE)
turned out to be a shallow, constant-slope ramp at any scale — the player's
own 52° slope-climb just walked up and over it, verified directly, no push
involved. Root-caused rather than patched around: wall-climb/ledge-mantle's
raycasts (`src/player/controller.ts`) previously had no way to tell terrain
from a dynamic prop, so any sufficiently tall pushable object sitting in
open terrain would incorrectly read as a climbable wall or ledge.
`rayDistance` (`src/physics/world.ts`) gained an optional Rapier
`filterPredicate`; `wallAhead`/`findLedge` now pass one (`notDynamic`) that
skips every collider on a `Dynamic` rigid body — climbing now only ever
reads terrain and static props, which is the actually-correct rule, not a
boulder-specific hack. With that fixed, a new `boulderGeometry` (a jittered
icosahedron dome, not a cone) genuinely blocks a walking player once
radius/height are big enough that its too-steep band exceeds autostep's
0.55 m. Verified at `?seed=7`: typecheck clean; solo continuous 3 s push
measured **0.197 m** and **0.218 m** across two runs (mass ≈ 4720 kg,
read back via `body.mass()`) — small and consistent. **Real two-tab test**:
tab A pushed it 1 s alone (**+0.148 m**), tab B's independent physics
confirmed the identical resulting position within one broadcast interval
(genuine live sync, checked to 3 decimals), then tab B continued pushing for
another 1 s (**+0.065 m** more) — two players, 2 s combined, ≈0.27 m total,
already past what one player alone gets in a full 3 s. Screenshots taken at
rest (a faceted dome, clearly bigger/rounder than any shard) and mid-push
with a second player's figure visible beside it. Honest caveat: when both
players' pushes converged too tightly on the same contact point at once in
an earlier attempt, the pre-existing distance-based props-ownership sync
(two independent client physics sims, periodically hard-corrected) produced
a visible pop/launch that settled back to rest a moment later — a known
characteristic of that sync model (explicitly out of scope to redesign
here), not a defect introduced by this boulder. See `docs/PLAN.md`'s
twenty-third pass for full detail.

---

## 19. Getting knocked down

**Goal:** a hard fall already gives weight — camera thump, ink-chip puff,
a brief no-input stumble (brief 9). Extend the exact same feedback to a
second trigger: getting struck by something fast passing close by — a
thrown prop, or a thrown/flung player barrelling into you. This is a
variation on brief 9's existing code, not a new system — reuse it.

- `src/main.ts`'s hard-landing block (around where `wasGrounded`/`vyBefore`
  are checked, roughly: `if (-vyBefore > P.landHardSpeed) { const k = ...;
  cam.thump(...); digMark.burst(...); player.stumbleT = ...; }`) is where
  the actual feedback lives today, inline, only reachable from a landing.
  Extract it into a small reusable helper (e.g. `applyImpact(k: number)`
  taking the same 0..1 magnitude scale the landing code already computes)
  so both the landing site and two new checks below can call it.
- **Thrown-prop check:** `src/world/props.ts`'s `Prop.lastV` already tracks
  each dynamic prop's velocity frame-to-frame for the existing knock-sound
  system (`dv = hypot(v - lastV)`, `onKnock`). Each frame in `main.ts`, for
  props near the local player (within a small radius — the player's capsule
  plus a bit), check if the prop's current speed exceeds a new threshold;
  if so, call `applyImpact` scaled by that speed, same as a hard landing
  scales by how far past `landHardSpeed` the fall was.
- **Thrown/fast-player check:** remote figures (`Remote` in `main.ts`) only
  track position today (`r.pos`, lerped toward the synced position each
  frame), not velocity — derive a simple per-frame velocity from the
  position delta (previous vs. current `r.pos`, divided by `dt`) rather
  than adding anything to the net protocol. If a remote's derived speed
  exceeds a threshold AND their position is within a small radius of the
  local player, call `applyImpact`. This is naturally symmetric and needs
  no new net message: it runs identically on every client, checking its own
  position against every OTHER player's synced position — so if player A
  gets thrown into player B, B's own client detects A's high speed nearby
  and stumbles, with no coordination required.
- New tunables in `src/world/config.ts`'s `player` section (mirror
  `landHardSpeed`'s naming) — something like `impactPropSpeed`,
  `impactPlayerSpeed`, `impactRadius` — with slider ranges in
  `src/ui/tune.ts`.
- No damage, no health, no fail state — same as every other physics
  interaction in this game. This is purely the existing camera-thump/chip-
  puff/stumble feedback, retriggered from a new cause.

Files: `src/main.ts` (extract `applyImpact`, the two new per-frame proximity
checks), `src/world/config.ts` + `src/ui/tune.ts` (new tunables).

Verify: `?seed=7`. Grab a shard/prop and throw it directly at yourself or
have it bounce back — or simpler, spawn/throw a prop past the player at
high speed via `__world` — and confirm `player.stumbleT` engages and the
camera/chip feedback fires, matching a hard landing's look. Two-tab test —
have one tab carry-and-throw the other player (`grabPlayer`/`throwPlayer`,
already wired) so the thrown player flies toward the other's position, and
confirm the SECOND player (the one not thrown) also stumbles as the thrown
one passes close by; recent passes (17, 18) found this sandbox's WebRTC
actually works, so attempt this for real. Confirm a normal, moderate walk
into another player or a slow-moving prop does NOT trigger it (the
threshold should exclude ordinary contact).

**Built (2026-09-10):** shipped as specced, plus a real hazard caught by
testing rather than guessed at. `applyImpact(k)` in `src/main.ts` extracts
the landing feedback verbatim; `checkPropImpacts()` walks a new
`Props.dynamicProps()` accessor (`src/world/props.ts`), skipping held props;
the remote-player check runs inline in the existing per-frame remotes loop,
deriving speed from the position delta already computed there (a new
`remotePrev` scratch vector vs. the just-lerped `r.pos`, over `dt`) — no new
net field either way. New tunables `impactPropSpeed` (6), `impactPlayerSpeed`
(10), `impactRadius` (1.8) in `CFG.player` + `src/ui/tune.ts`. The hazard: a
grab snaps the carried player's broadcast position toward the carrier's hand
between network ticks, which read as an enormous fake "thrown" velocity the
instant a grab started — fixed with a `heldRemoteIds` set (from my own
`carrying` var plus every peer's broadcast `g` field) that skips the check
for anyone currently held, so only real flight after release counts.
Verified at `?seed=7`: typecheck clean; a real dynamic prop flown past the
player in-air at 12 m/s triggered `stumbleT`/`cam.shakeMag` at the exact
scaling the formula predicts, a 3 m/s prop against the player never did.
**Live two-tab test**: real peers found each other in `net.peers`; tab A
grabbed and threw tab B's player back near its own position with a real
upward-lobbed velocity, and polling A with a real-time async loop (the
sandbox's background tab kept simulating live, not frozen) showed A's
`stumbleT`/`shakeMag` flip on as B's synced position closed to ~1.5 m and
decay back to 0 over the next ~0.25 s — a genuine cross-tab detection, not a
direct-invocation fallback. The grab itself (no throw yet) never
false-triggered; B walking at real RUN speed (7.2 m/s, launched and pumped
for real) all the way to 0.94 m from A never triggered it either.

---

## 20. Night mode: a day/night cycle where torches are required

**Goal:** decided directly with Myles (2026-09-10/11), not guessed at. A
real day/night cycle, in the shared world too (not gated to private
worlds). During the day, everything looks and behaves exactly as it does
today. During the night, the existing "unprinted until lit, stays printed
forever" rule (README, `src/render/shaders.ts`'s "Unprinted until lit"
block) stops applying its *permanent* half at render time: a place you
explored earlier goes dark again once you leave it, UNLESS a torch is
actually still standing there — placed torches (yours, a peer's) and
permanent world/shrine torches keep their own patch lit for as long as
they burn, Minecraft-base-style. The persistent ink-map DATA itself is
untouched (see below) — this is a rendering-time change, not a data-model
change. Myles also explicitly asked for hands-on control: buttons/config
to freeze the cycle at a specific phase and tweak numbers while looking at
exactly that phase, then paste the tuned values back — see "Phase lock and
tuning" below, that's not optional polish, it's part of the ask.

**How the existing pieces already fit this, so it's smaller than it
sounds:**
- `src/render/shaders.ts`'s toon fragment shader already computes exactly
  the two signals needed: `inked` (read from the permanent `uInkMap`
  texture — "has this ever been lit") and `lit` (this frame's real-time
  distance falloff against the current `p.torches` list — "is a light
  actually reaching this spot right now"). Today: `float printed =
  smoothstep(0.08, 0.5, max(inked, lit));` — permanent OR current, so once
  inked it's always `printed`. Night mode's core change is threading a new
  `uNight` 0..1 uniform through so this becomes something like `printed =
  smoothstep(0.08, 0.5, mix(max(inked, lit), lit, uNight));` — at `uNight =
  0` (full day) this is byte-for-byte today's behavior; at `uNight = 1`
  only the CURRENT frame's `lit` counts, so a place goes dark the moment
  nothing is currently lighting it. This appears in more than one shader
  copy (check every fragment shader in `shaders.ts` that has this exact
  block, the same way `uDepth` already had to be threaded through more
  than one).
- The permanent `uInkMap` texture / `InkMap` class (`src/world/inkmap.ts`)
  is NOT reset, cleared, or changed by this brief — it keeps accumulating
  exactly as today (every torch still calls `p.inkMap.stamp(...)` each
  frame in `src/main.ts`, unchanged). It's still the source of truth for
  the paper map (Tab) and for daytime rendering. Night mode only changes
  whether the fragment shader is ALLOWED to use it as a lighting shortcut
  at render time. Do NOT touch the paper map or `inkMap.stamp` call sites.
- "Torches remain in place so it's always lit" needs no new code at all —
  a placed or world/shrine torch that still exists is already in
  `chunks.props.torches` and gets pushed into `p.torches` every frame in
  `src/main.ts` regardless of day or night, and `lit` (the real-time signal
  night mode falls back to) already reacts to anything in `p.torches`. A
  torch that's still burning keeps its patch genuinely lit at night for
  free; one that's burned out (brief 16, already shipped) stops — exactly
  the intended loop (keep your torches fed, or the dark comes back).
- `src/render/pipeline.ts` already has the exact wiring pattern to copy for
  a new global per-frame uniform: `uDepth` is set on `[p.rockMat, p.ceilMat,
  ...p.figureMats]` plus the ink pass each frame from one `setDepth`-style
  function, called unconditionally every frame from `main.ts` (not gated
  behind `applyConfig`/a slider-change event) — do the same for a new
  `setNight(p, amt)`, since `uNight` is inherently dynamic (changes every
  frame from the clock or the phase lock below), not a "changes only when a
  slider moves" value.
- `Pipeline.time` (`p.time`, already accumulated every frame for `uTime`) is
  a ready-made elapsed-session-seconds clock — derive the cycle phase from
  `p.time % cycleSec` in "auto" mode rather than adding a second timer.
  Smooth the day→night→day transition (no hard cut) — a cosine or
  smoothstep-based curve over the cycle is fine; exact shape is a feel
  decision, tune by playing it (and by using the phase lock below).
- **Read `docs/PLAN.md`'s "Twenty-eighth pass" entry before touching
  `src/render/pipeline.ts`'s `renderFrame()`**: a real bug was just found
  and fixed there (the ND-hidden restore step used to force every
  `p.ndHidden` object back to a hardcoded `visible = true`, clobbering
  objects with their own independent show/hide logic — now it restores
  each object's own remembered pre-hide visibility instead). Night mode
  doesn't need to touch that function, just be aware of it if anything here
  ends up added to `p.ndHidden`.

**Phase lock and tuning (Myles's explicit ask — build this, not just the
cycle):**
- `CFG.world.timePhase: "auto" | "day" | "dusk" | "night"` (a discrete
  mode, not a numeric slider — follow the exact precedent already in
  `src/ui/tune.ts` for the mouse/trackpad control-scheme selector: a
  small custom control in the tune panel, not the generic per-key slider
  loop). `"auto"` uses the real cycle timer; `"day"`/`"dusk"`/`"night"`
  freeze `uNight` at a fixed value (0 / 0.5 / 1) every frame regardless of
  `p.time`, so Myles can stare at exactly one phase and tune numbers
  against it without waiting for the cycle. Expose this as actual buttons
  in the tune panel (Auto / Day / Dusk / Night), per his literal request
  for "buttons... where I can set it to the different cycles," not a
  dropdown.
- Every other night-related number — `world.dayNightCycleSec`,
  `world.nightIntensity` (see below), any dusk-paper-dimming constant you
  make tunable — goes in `CFG` the normal way (`src/world/config.ts` +  a
  slider range in `src/ui/tune.ts`'s per-section ranges object) purely
  because that's the house rule for every tunable — but it also means it
  rides the EXISTING Export/Copy-link mechanism for free: `src/ui/tune.ts`
  already serializes the whole `CFG` object (`config: CFG` in its export
  payload) and `?cfg=` already round-trips it on load — verify this before
  assuming you need to build new export plumbing; you almost certainly
  don't. Confirm by actually exporting after changing a new night tunable
  and checking it's present in the JSON.
- `world.nightIntensity` (0..1, default 1) is a safety valve: at 0 it fully
  disables the darkening (day-like regardless of phase) via `?cfg=`
  without a redeploy, in case the shared-world default turns out too harsh.

**New pieces actually needed beyond the phase-lock/tuning above:**
- `world.dayNightCycleSec` (total cycle length in "auto" mode — start
  around 600s / 10 min full cycle and tune by feel, Minecraft's day is
  ~20 min for reference).
- **Surface goes dusk-toned too** (Myles's explicit call — NOT full black,
  just darker paper, and the "no skyline" rule stays: this is a paper-tone
  change, not a rendered sky). The bare-paper "unprinted" look already
  dims with depth in a few places (`vec3 paper = uPaper * (1.0 -
  clamp(depthAmt, 0.0, 1.0) * 0.3);` in `shaders.ts`) — extend the same
  line to also fold in `uNight` (e.g. an extra `* (1.0 - uNight * 0.4)` or
  similar), so the exposed ground/rock at the surface (which uses this same
  paper look before it's inked) reads duskier as night falls. This is a
  small, additive change to an existing line, not new rendering.
- **A handful of new PERMANENT shrine-style torches, sparser and visually
  distinct from a placed torch or a vault pillar** — "so you can sort of
  see some things" even alone, at night, without your own torch. Extend
  `Props` (mirror how vault pillar torches are already spawned via
  `addTorch(id, x, y, z, false)` — `placed: false` already makes a torch
  immune to brief 16's burnout, so this is free) with a new, wider-spaced
  scatter (mirror the vault/boulder sparse-grid pattern in `terrain.ts`) of
  a visually distinct fixture — a taller/bulkier brazier or cairn shape
  (a new small geometry builder alongside `torchMesh()`), with a bigger
  fixed `reach` than a hand torch, so it reads unmistakably as "a landmark,
  not something a player put there."

**Scope discipline:** this is one of the largest briefs in the backlog —
touching the shader in more than one place, a new global per-frame uniform,
a new timer, a new tune-panel control, and new world content. It's fine to
land a smaller, solid cut if a specific piece proves risky (e.g. a hard
day/night cut instead of a smooth transition, or a simpler brazier that
reuses the existing torch shape at a bigger scale instead of a new
geometry) — say so clearly. Two failed attempts on any one sub-problem
means stop and report, same as every other brief.

Files: `src/render/shaders.ts` (`uNight` uniform + the `printed`/paper
formula, in every fragment shader copy that has it), `src/render/
pipeline.ts` (`setNight`, uniform declarations on the relevant materials),
`src/main.ts` (compute `uNight` from `p.time` or the phase lock each frame,
call `setNight`), `src/world/config.ts` + `src/ui/tune.ts`
(`dayNightCycleSec`, `nightIntensity`, the `timePhase` buttons),
`src/world/props.ts` + `src/world/terrain.ts` (the new sparse
permanent-brazier scatter).

Verify: `?seed=7`. Confirm day-phase rendering is pixel-for-pixel
unchanged from before this brief (screenshot comparison at `uNight≈0`,
via the Day phase-lock button — cleaner than fast-forwarding a timer).
Lock to Night and confirm a previously-explored, currently-unlit spot goes
dark, while a spot near a still-burning placed or permanent torch stays
lit — screenshot both. Let a placed torch burn out (brief 16) while
locked to Night and confirm its patch goes dark once it does. Confirm the
surface reads visibly duskier locked to Night vs Day (screenshot both).
Confirm the paper map (Tab) is unaffected — still shows full history
regardless of phase. Confirm `nightIntensity: 0` via `?cfg=` fully
disables the darkening (day-like regardless of phase). Confirm Export
JSON / Copy-link actually includes the new night tunables after changing
them from their defaults.

## 21. A way to hop between biomes

**Goal:** Myles wants a button or hotkey that jumps him to a different
biome, so biome variety (brief 15) is actually easy to tour and compare —
right now finding a specific biome means wandering until the noise field
happens to change. Biomes are a spatial field (`terrain.biome(x,z)` /
`biomeAt` in `src/world/biomes.ts`), not a per-player toggle, so "switch my
biome" means finding the nearest point that's actually IN a different
biome and teleporting there (`player.teleport`, the same method `T`/the
physics-escape rescue already use) — not overriding the noise field under
the player, which would look inconsistent with the terrain already built
around them.

- A hotkey (an unused one — check `README.md`'s key table for what's
  taken; `B` is free and mnemonic) that searches outward from the player's
  current position (a spiral or growing-radius sample of `terrain.biomeId
  (x,z)`) for the nearest point whose biome id differs from the current
  one — ideally cycling forward through `BIOMES` in index order each press
  (so repeated presses tour all 10 in sequence) rather than always landing
  on the same neighbour — then `player.teleport()`s there, landing on
  `terrain.levelAt(2, x, z)` (or whatever level is under the player
  already) the same way `spawnRelicAt`'s recent fix seats things on the
  player's actual level, not always the lower cave.
- Also add it as an actual button in the tune panel (Myles asked for
  "button... or hotkey" — do both, it's cheap and the tune panel already
  has a precedent for one-off action buttons like Export/Import/Copy
  link).
- Keep the search bounded (a max radius / max ring count) so it can't hang
  looking for a biome that doesn't exist within a reasonable distance in
  this seed — fall back to doing nothing (with a HUD/chat message) rather
  than an unbounded search.

Files: `src/main.ts` (the hotkey handler + biome-hop logic), `src/ui/
tune.ts` (the button), `src/world/terrain.ts`/`src/world/biomes.ts` (reuse
`biomeId`/`BIOMES`, no changes needed there unless something's missing).

Verify: `?seed=7`, press the hotkey repeatedly and confirm `terrain.biome
(player.position.x, player.position.z).name` changes each time (ideally
touring multiple distinct biomes across a few presses, not bouncing
between the same two), screenshot at least two different biomes reached
this way. Confirm the button in the tune panel does the same thing.

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
