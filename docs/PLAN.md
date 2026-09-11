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
Lower floor ∈ [0, ~6]; lower ceiling ∈ [7, 16] (+24 in Cathedral); gallery
slab 1.8 m above that ceiling where the gallery field says so; surface =
topmost ceiling + `world.crust` (6 m) + hills. Where `ceiling − floor` would
be under ~2.5 m the floor is lifted to the ceiling: that IS the wall. One
heightfield per chunk PER LEVEL is the entire collision surface for terrain;
digging is a per-vertex depth map per level.

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

### Third pass (2026-09-09, later)
Shared rolling world; STL cast behind a toggle, procedural cast + golem
relics by default; grab/throw with white outline, tether, honest ballistic
arc + landing ring; paper map (Tab); tuning panel (backtick) with JSON
export/import and `?cfg=` links — CFG in `world/config.ts` is the single
source the terrain, pipeline and main read; opt-in proximity voice over the
same WebRTC connections; world-anchored mottle. Next: stacked caves and
hatched-wall climbing, torch shrines, two-torch doors, relics → colorways,
comic-panel photo mode, deeper-is-stranger, STL drop-in.

### Fifth pass (2026-09-09, night)
Surface start under a paper sky (`Terrain.surface`, a tunable `world.crust`
of rock over the topmost cave); three stacked heightfield levels (surface /
gallery / lower cave) with dig-through judged by the real rock thickness
under a vertex; Cathedral biome (vaulted lower cave); small cell-snapped
digs with a white marker showing what the next click cuts, tunnels at your
feet and mantle-able steps when you aim up a wall; dig tunables in the
panel; Gang Beasts carrying (F on a player, click throws, verified across
two tabs); jump latch; ink chips + pick sound; touch controls + installable
web-app shell (manifest, icons, iOS meta). Everything after this lives in
`docs/BACKLOG.md` as self-contained briefs — arms first.

### Sixth pass (2026-09-10)
Arms: every procedural golem but the Hound, plus the packed cast and any
dropped-in STL, now build two arm pivots off the figure's own material —
shoulder height 0.72 × the figure's height, shoulder half-width sampled from
the hull's own width at that slice. They swing opposite the legs while
walking (scaled per golem kind in `GOLEM_MOTION`), reach forward while
holding a prop or carrying another player (`figure.reaching`, set next to
`figure.flail`), and flail alongside the legs when the figure itself is
carried. Remote figures pick up the same flag from a new `ho` (holding a
prop) bit on `PeerState`. Next up per the backlog: show-who-you-can-pick-up
outline, two-torch doors.

### Seventh pass (2026-09-10, later)
Show who you can pick up: `targetPlayer` now drives the same inverted-hull
white outline props get (`Grab.showPlayerTarget`, a second outline mesh in
`src/player/grab.ts` sharing the prop outline's shader and paper-white ink,
matrix-copied each frame from the target's `figure.hull`), so "F to pick up"
is seen on the other player's body, not just read off the HUD. The victim of
a grab now also gets a brief chat-bubble-sized toast ("Stony-13 picked you
up") — a new `Chat.toast()` and `#toast` element in `src/ui/chat.ts` /
`index.html`, fired from `net.onGrabbed`. Verified across two tabs: the
outline tracks the targeted remote figure and the toast lands on the victim's
screen the moment `grabPlayer` fires. Next up per the backlog: two-torch
doors.

### Eighth pass (2026-09-10, night)
Two-torch doors: sealed ~6 m vault rooms scattered through the lower cave
(`Terrain.vault`, a ~36 m grid, one in ~3 cells, kept clear of spawn and
galleries) — a ring wall baked straight into `Terrain.floor` alongside the
usual solidity wall, so it is built, collided and dug exactly like any other
wall. Two shrine-like stone pillars flank the sealed door (`Props.addVault`,
reusing the plinth's fixed-body pattern) and a golem relic waits inside on
its own plinth. Each frame `main.ts` checks placed torches against both
pillars (`world.vaultTorchRange`, 3 m, a new CFG tunable next to
`vaultRadius`/`vaultRing`); once both are lit it opens the door with the
existing `digTo` at the threshold — the same call a pick tunnel makes — so
it rides `myDigs`/`net.sendDig` for free and late joiners see it through the
dig replay already in place, no new net message. The paper map marks a
loaded vault's door red while sealed, green once open (`PaperMap.draw`'s new
`doors` argument). Verified in the browser at `?seed=7`: found a vault via
`terrain.vaultsInChunk`, confirmed the door cell read as a full wall
(`floor` ~34 m, matching `floorAt`), placed two torches by the pillars,
watched `checkVaultDoors` cut it open (`floorAt` at the door's grid
vertices dropped to the open floor height, matching `floorOpen`), the map
marker flipped red to green, and walked through into the vault to the relic
on its plinth. Next up per the backlog: comic-panel photo mode.

### Ninth pass (2026-09-10, later)
Comic-panel photo mode: the photo panel gained "Add panel" (up to 3, capped)
and "Make page" (`src/ui/photo.ts`) — each Add panel call is a synchronous
`renderStill` at a fixed 1000×750 capture size pushed onto a small buffer;
Make page loads the buffered stills as images, composes them onto an
offscreen canvas with 24 px gutters (dark ink background reading as the
gutter lines) — one wide panel on top, two small panels below it, cover-fit
cropped into their slots — plus a paper-colored caption strip (colorway name,
today's date, a tagline) styled like the toast/chat-bubble boxes, then
downloads the composed page as one PNG and clears the buffer. Verified at
`?seed=7`: captured 3 panels at different orbit framings via the real UI
buttons, read the downloaded PNG back into an `<img>` (1200×1296, matching
the computed page size) and screenshotted it — gutters, the wide+two-small
layout and the caption strip all present. Next up per the backlog: deeper
is stranger.

### Tenth pass (2026-09-10, later)
Deeper is stranger: a `uDepth` uniform (0 at/above the undug surface, 1 by
~40 m below it — `src/main.ts` computes it each frame from
`terrain.surface(x,z) − player.y`) and a `uDepthStrange` intensity knob (the
new `depthStrange` tunable in `Tunables.press`, sliderized in
`src/ui/tune.ts`, pushed by `applyConfig`) land on the rock/figure toon
material, the ceiling material and the press pass (`src/render/shaders.ts`,
`src/render/pipeline.ts`'s new `setDepth`). Their product grows the zone-fill
jitter (`TOON_FRAGMENT`), the press misregistration and paper-speck rate
(`INK_FRAGMENT`), shrinks the ceiling's brush-arc spacing so rings pack
tighter (`VAULT_FRAGMENT`), and dims the bare-paper reveal everywhere the ink
map still shows blank sheet. Verified at `?seed=7`: typecheck clean;
teleported the player to a Cathedral spot 48 m below the surface and read
`uDepth` back off `rockMat`/`ceilMat`/`inkPass` as `1` (clamped), then to a
spot 20 m down and read `≈0.52` — confirms the linear depth ramp; screenshots
at the surface (uDepth 0, paper-bright open sky) and deep in the lower cave
(uDepth 1, denser hatching, dimmer bare-paper reveal) show the read
diverging. Next up per the backlog: "hatched rock is grip".

### Eleventh pass (2026-09-10, night)
Hatched rock is grip: a sheer-face wall climb (`PlayerController.wallClimb`
in `src/player/controller.ts`) now only grips where
`terrain.solidity(x,z) < CFG.world.climbSolidity` at the point just ahead of
the player — smooth pillar cores (solidity near 1, drawn as flat black fill
with no hatch) can't be grabbed, so the look tells you where you can climb.
The simple threshold rule per the brief (not the analytic-tone sampling
alternative); `climbSolidity` (default 0.85) is a new tunable next to
`wallLo`/`wallHi` in `src/world/config.ts`, sliderized in `src/ui/tune.ts`.
The controller now takes `terrain` in its constructor to read solidity.
Verified at `?seed=7`: typecheck clean; drove the controller directly
(`__world.player`, `__world.input.hold("KeyW", true)`, `__world.pump(n)`) at
a wall face with `terrain.solidity` ≈ 0.66–0.7 — climbed cleanly, HUD state
"climbing", stamina draining. At a genuinely steep face inside a smooth
pillar (`terrain.solidity` ≈ 0.85–0.89, found where the gallery-driven
ceiling height jumps sharply within an already-high-solidity column) the
climb was denied while blocked and pushing — confirmed the exact threshold
crossing: probed solidity 0.859 (denied, HUD "ground") then 0.849 one push
later (granted, HUD "climbing") after the player drifted along the face.
Screenshots of both the granted and denied states taken. Next up per the
backlog: props on the surface and in galleries.

### Twelfth pass (2026-09-10, later still)
Props on the surface and in galleries: `Props.spawn` (`src/world/props.ts`)
now loops all three levels via a new `spawnLevel(cp, cx, cz, chunkSeed,
level)` — level 2 (the lower cave) keeps its full shard/shrine/relic set;
levels 1 (galleries, gated by `terrain.isUpperOpen`) and 0 (the surface, no
extra gate, matching `scatterRocks`) get a lighter set scaled by the new
`propUpperDensity` tunable (default 0.4, sliderized in `src/ui/tune.ts`) —
fewer/smaller shards, and rarer shrines and relics, always the cheaper
procedural golem statue rather than an STL model on the upper levels. Every
prop is seated with `terrain.levelAt(level, x, z)` (plinths and torches too,
via a new optional `level` arg on `Props.plinth`), and ids carry an `L0:`/
`L1:` tag so the three per-chunk sets never collide (level 2 keeps its
original untagged ids — vaults, which are lower-cave only, are unaffected).
Verified at `?seed=7`: typecheck clean; read `chunks.props` back after
`pump(30)` and found 37 level-0 props, 6 level-1 props and 61 level-2 props
across the loaded chunks (including a plinth + golem relic pair on each of
the surface and gallery levels); teleported the player to a surface relic
(HUD "surface") and a gallery relic (HUD "upper gallery") and screenshotted
both — the gold golem statue on its plinth, out under the paper sky on the
surface and tucked in a gallery alcove under the ringed ceiling. Next up per
the backlog: dig upwards (ceilings).

### Thirteenth pass (2026-09-10, night)
Dig upwards (ceilings): a per-level upward dig map (`Terrain.digsUp[1|2]`,
metres the ceiling has risen) alongside the existing downward `digs`;
`ceilingAt(level,x,z) = base + dugUp` where the base is `ceiling` (lower
cave's roof, level 2) or `ceiling2` (gallery's roof, level 1). `dig`/`digTo`'s
shared `carve` now takes the target map directly so a new `digUp` reuses it
verbatim — same small, cell-snapped, radius-falloff increments as a floor
dig. When a ceiling's dugUp reaches `thickness` of whatever sits overhead
(reusing the existing `thickness()`/`through()` used for downward
breakthroughs — the same slab either way), `floor2At`/`surfaceAt` drop to
match the floor below via a new `throughUp`, exactly mirroring how a floor
dig breaks through from above. `ChunkManager.recutCeilings` samples
`ceilingAt` instead of the raw analytic ceiling and drops any cell that's
fully broken through (`brokenThroughUp`); a new `reCeil(level, keys)` re-cuts
the ceiling and re-samples the floor(s) above via the existing `refloor`.
Aim: since ceilings carry no collider at all (nothing for the physics ray to
hit), `main.ts`'s `planDig` only reaches the new `aimCeiling` ray-march (0.25
m steps testing `y ≥ ceilingAt`) once the ordinary physics-based aim comes up
empty and the look direction is steeply up (`aimDir.y > 0.3`) from inside a
level with a ceiling to dig (1 or 2 — the surface has open sky, nothing to
cut). `DigMsg.u = 1` marks an upward dig over the net, riding the existing
dig-replay for late joiners with no new message type. The dig marker (`digmark.ts`)
draws the same square upside down against the (raised) ceiling with a plumb
line hanging down to the aim point, mirroring the step marker's post; a
"roof" dig kind gets its own dig sound (`sound.ts`, highest-pitched of the
four). Verified at `?seed=7`: typecheck clean; drove the aim system directly
(`__world.player.teleport`, `cam.pitch/yaw`, `pump`) at open headroom away
from any wall, read the resulting `plan.kind === "roof"` back with the
correct cell/ceiling-height/hit point, then fired it for real through
`digAtAim()` and watched `ceilingAt` rise by one dig's amount; pushed a
column to full breakthrough with `terrain.digUp` + `chunks.reCeil` (the fast
path the brief invites, rather than clicking one grain at a time) and
confirmed `brokenThroughUp` flips true and `surfaceAt` collapses onto
`floorAt` exactly at that point; stood in the lower cave and looked straight
up through the new hole to open sky where solid rock had been (screenshot),
confirming both the mesh and the collider opened together. One deviation
worth flagging: because the aim's max upward pitch is only ~31° off the
horizontal (`PlayerCamera`'s existing `PITCH_MIN`), a shaft dug by staying
in one spot and clicking repeatedly drifts forward each click rather than
staying in a single vertical column, since the ray's fixed shallow slope
means "a bit higher" also reads as "a bit further ahead" — a real player
would naturally step forward to follow their own cut (the same way the
existing wall-step mechanic climbs a staircase forward, not straight up),
so this reads as consistent with the existing feel rather than a bug, but it
does mean a single stationary column rarely reaches full breakthrough on its
own; call it out if it feels wrong in play. Next up per the backlog: landing
and falls.

### Fourteenth pass (2026-09-10, latest)
Landing and falls: a hard landing now reads with weight instead of just a
sound. `main.ts`'s existing `wasGrounded`/`vyBefore` landing detection (the
same one that already drove `sound.land`) gates a new effect on
`-vyBefore > CFG.player.landHardSpeed` (default 10 m/s — a small hop stays
silent): `PlayerCamera.thump` (a new shake offset in `src/player/camera.ts`,
a quick downward dip that eases back out over 0.28 s), a puff of ink chips at
the landing point via the existing `DigMark.burst` (the same chip system a
dig throws), and `PlayerController.stumbleT` (a new field in
`src/player/controller.ts` — while it counts down, `step()` substitutes a
zero wish vector and forces `jump` false, so movement eases toward a stop and
can't reinitiate jumping/climbing rather than being clipped instantly). All
three scale 0-1 by how far past the threshold the fall speed got. Five new
tunables (`landHardSpeed`, `landStumbleDur`, `landThumpMag`, `landChipCount`,
`groundEscapeMargin`) in a new `player` section of `src/world/config.ts`,
sliderized in `src/ui/tune.ts`. Also a physics-escape safety net: every frame
(cheap analytic field reads), if the player's y is below every level's floor
at their x/z by `groundEscapeMargin` (4 m), `main.ts` teleports them up to
`terrain.groundAt` — the pre-existing "highest floor at or under y, falls
back to the lowest cave floor" helper is exactly "nearest level" for a player
who fell out the bottom. Verified at `?seed=7`: typecheck clean; found the
deepest Cathedral vault in range (`floor` 1.51, `ceiling` 37.3, ~35.8 m of
drop), teleported the player near its ceiling and pumped frames through the
fall — landed at `vy` ≈ -35 m/s, read back `stumbleT = 0.4` and
`cam.shakeMag = 0.35` (both saturated, since the fall speed was far past the
threshold) the instant `grounded` flipped true, and a screenshot shows a
scatter of ink chips at the figure's feet; confirmed the stumble actually
blocks movement (position barely moved with `W` held for 10 frames inside
the 0.4 s window, then moved normally once `stumbleT` hit 0); a small 0.6 m
hop landed with `stumbleT`/`shakeMag` both staying 0, confirming the
threshold gate. For the escape net: teleported the player 10 m below a
vault's floor and pumped 3 frames — landed back on top of the floor
(`groundAt` + 0.5), screenshotted standing on solid ground. Next up per the
backlog: quality toggle for phones.

### Fifteenth pass (2026-09-10, latest)
Quality toggle for phones: `?q=low|med|high` (`resolveQuality`/`QUALITY_PRESETS`
in `src/world/config.ts`) picks a fixed preset — `printScale`/chunk-window
radius/ND-pass resolution together — rather than three more sliders, since a
device tier is a discrete choice, not a continuum; with no `?q=` given it
auto-picks `low` on a coarse pointer (`matchMedia('(pointer: coarse)')`, the
same test `src/ui/touch.ts` already uses) and `high` otherwise, preserving
today's desktop default exactly. `low` = printScale 0.45, chunk radius 1 (a
3×3 window), ND pass at half the print resolution; `med` keeps `high`'s
printScale 0.6 and radius 2 (5×5) and only halves the ND pass; `high` is
today's unchanged default. `createPipeline` takes the printScale (as before)
plus a new `ndHalfRes` flag that sets `Pipeline.ndScale` (0.5 or 1), consumed
in `resizePipeline` to size `ndRT` at print-resolution × `ndScale` — the ink
pass samples it by UV same as before, so no shader change was needed, just a
blockier normal+depth read at half res. `ChunkManager`'s existing `radius`
constructor arg (already a parameter, just always called with a literal `2`)
now takes the preset's value directly, and is now a public readonly field for
verification. `main.ts` resolves quality before reading `?cfg=`, so an
explicit `?cfg=` still wins over the preset's `printScale` — the printScale
slider in the tuning panel is unaffected and still live-tunable either way.
Verified: typecheck clean; at `?seed=7&q=low` read back
`quality/qualityPreset/pipeline.{printScale,ndScale}/chunks.radius` as
`low`/`{0.45,1,true}`/`{0.45,0.5}`/`1`, and `ndRT`'s actual pixel size at half
the composer's; at `?seed=7` (no `q`, normal desktop pointer) read `high`/
`{0.6,2,false}`/`{0.6,1}`/`2`/25 loaded chunks (5×5); at `?seed=7&q=med` read
`med`/`{0.6,2,true}`/ndScale 0.5. Emulated a mobile viewport (coarse pointer)
with no `?q=` and confirmed auto-pick landed on `low` (screenshot: touch
controls up, chunk streaming and rendering fine at radius 1). A `?seed=7`
desktop screenshot at `q=low` shows the game running normally — softer ink
from the lower printScale, no crashes. Next up per the backlog: prune ghost
peers.

### Sixteenth pass (2026-09-10, latest)
Prune ghost peers: checked `src/net/room.ts` against brief 11 before touching
anything, since ten briefs had landed on this file since the brief was
written. The heartbeat timer's `tick()` already tracked each peer's last
message time (`Peer.lastAt`, updated on every `state.onMessage`) and already
swept `this.peers` every tick, deleting any entry silent for more than 8000 ms
and firing the same `onLeave` callback a clean `room.onPeerLeave` uses;
`main.ts`'s `net.onLeave` already disposes the remote figure and deletes it
from `remotes`. That sweep (and the disposal path) was wired in during the
original multiplayer pass, well before this backlog brief existed — it just
hadn't been called out as done. No code changed this pass; typecheck stayed
clean throughout. Verified live rather than by inspection alone: two tabs at
`?seed=7`, confirmed the peer showed up in `__world.net.peers`/`__world.remotes`
in tab one, then in tab two ran `clearInterval(net.timer)` to kill its
heartbeat without a clean leave (a real ghost — no `onPeerLeave` fires), and
after ~9 s tab one's `net.peers` and `remotes` both went empty. Brief 11 is
closed with the code as it already stood. Next up per the backlog: iOS / App
Store (brief 12 — an assessment, not a build).

### Ad-hoc (2026-09-10): mouse/trackpad control scheme
Myles asked live, mid-session, whether look controls could switch between
mouse and trackpad, or auto-detect — not a numbered backlog brief. Added
`Input.controlScheme: "auto" | "mouse" | "trackpad"`, persisted in
`localStorage` (`relic-world:control-scheme`, `world/settings.ts`), plus two
new tunables in `world/config.ts`/`ui/tune.ts` (`CFG.controls.mouseSens` = 1.0,
`trackpadSens` = 1.6) applied as a multiplier on look deltas in both existing
look paths — pointer-locked `mousemove` and the wheel-swipe fallback — so
touch's own drag-to-look (`ui/touch.ts`, writes `input.lookX/Y` directly) is
untouched. `"auto"` guesses the device from wheel-event shape (deltaMode,
integer-ness, size, presence of deltaX) on every `wheel` event, re-running
cheaply rather than freezing after a fixed count; defaults to "mouse" (today's
behaviour) until a wheel event gives a signal. Exposed as an Auto/Mouse/
Trackpad `<select>` in the tune panel next to the STL checkbox, with a small
"→ mouse/trackpad" readout while in Auto. Verified: typecheck clean; dispatched
synthetic `WheelEvent`s at the canvas — many small fractional-`deltaY`,
`deltaMode: 0` events resolved auto to `trackpad`, then a run of large integer
`deltaMode: 1` events resolved it back to `mouse`; forcing the selector to
Mouse/Trackpad in the browser changed `input.resolvedDevice()` and persisted
across the choice; screenshotted the panel showing the new control.

### Seventeenth pass (2026-09-10, latest)
iOS / App Store scaffold (brief 12): added Capacitor (`@capacitor/core`,
`@capacitor/cli`, `@capacitor/ios`) and an `ios/` Xcode project (bundle id
`uk.co.mylespalmer.relicworld`, Myles's own domain) wrapping the `dist/`
build — Capacitor 8's iOS template uses Swift Package Manager, not
CocoaPods, so there is no Podfile/`.xcworkspace` and no `pod install` step.
`ios/App/App/Info.plist` gained `NSMicrophoneUsageDescription` for the
existing opt-in voice chat and landscape-only orientations matching
`public/manifest.webmanifest`; the app icon and splash reuse/adapt
`scripts/icons.mjs`'s procedural ink-cairn mark instead of Capacitor's
placeholder. Verified with a real, unsigned Simulator build — `xcodebuild
-sdk iphonesimulator` succeeds (ad-hoc "Sign to Run Locally", no Apple
Developer account needed), installed and launched on an iPhone 17 Pro
simulator, and `xcrun simctl io screenshot` shows the actual paper-cave
scene rendering (hatching, HUD, touch controls) rather than a blank
WebView. Multiplayer verified working with no code changes: a Browser-pane
tab and the Simulator app both on `?seed=7` (via a temporary,
reverted-before-commit `capacitor.config.ts` `server.url` override) showed
up in each other's `net.peers`/`remotes`, HUD and screenshots on both sides
confirming `src/main.ts`'s solo check stays false for a
`capacitor://`/`localhost` origin and that the Nostr/WebRTC signaling works
unmodified inside WKWebView. One tool blocker: the dedicated iOS-Simulator
control tool refused every call over an environment-detection bug (asking
for a `sudo xcode-select` that direct `xcodebuild` calls prove is
unnecessary); worked around with `xcodebuild`/`xcrun simctl` directly.
Touch-input (tap/swipe) verification inside the Simulator could not be
completed — two different AppleScript/System-Events synthetic-click
attempts didn't register — so that's an open verification gap, not a known
defect, since the touch layer itself is untouched, already-shipped code.
Typecheck stayed clean (`tsconfig.json`'s `include: ["src"]` already keeps
`ios/`/`capacitor.config.ts` out of it); nothing about the existing GitHub
Pages or Metalab Sites web builds changed. What's left is entirely on
Myles's side — an Apple Developer Program enrollment, signing in Xcode, and
the first TestFlight upload — spelled out step by step in
`docs/BACKLOG.md` brief 12.

### Eighteenth pass (2026-09-10, latest)
Myles wants the iOS app to look like the web build, not the phone quality
preset from brief 10 — TestFlight testers have real device GPUs, not the
low end that preset targets. `resolveQuality()` (`src/world/config.ts`) now
checks `Capacitor.isNativePlatform()` before the coarse-pointer test: the
wrapped app always gets `high` (printScale 0.6, chunk radius 2, full-res ND
pass) regardless of touch input, while an actual mobile *browser* (Safari on
a phone visiting the site directly, not through the app) still auto-picks
`low` exactly as before — `?q=` still overrides either way. `@capacitor/core`
moved from `devDependencies` to `dependencies` since it's now imported at
runtime in the shipped bundle, not just used by the `cap` CLI. Verified:
desktop web still resolves `high`, an emulated mobile-web viewport (coarse
pointer) still resolves `low`, and a rebuilt/reinstalled Simulator app
(`xcodebuild` → `cap sync` → `xcrun simctl install`/`launch`) screenshots at
full density (61 fps in the HUD, no softened hatching). No web build
behavior changed (native-only branch), so no Metalab Sites republish.

### Nineteenth pass (2026-09-10, latest)
Brief 13, instance the rocks — the top item on Myles's own priority ranking
of "what's next," since every rock was still its own draw call and the ND
pass doubles that cost. Shipped as specced (prototype pool, per-instance
scale/hull, `InstancedMesh` batching, GLSL hatch-anchor projection via
`USE_INSTANCE_HATCH`, including a fix to the ND pass's own vertex shader for
manual instance-matrix application), but the build genuinely made draw
calls *worse* at first — caught only by measuring, not by trusting the
design: `InstancedMesh` needs an explicit `computeBoundingSphere()` call
after its instances are placed, or frustum culling uses the base geometry's
tiny near-origin bounds instead of the real spread, which either never
culls or wrongly culls batches that are genuinely in view. Fixed, then
profiled again and found a second issue: bucketing per (chunk, level,
prototype) left most buckets as singletons given how few rocks a level
actually has, so pooled all three levels' rocks per chunk instead (level
only ever mattered to placement, never to rendering). Final honest,
apples-to-apples measurement (same seed/position/camera angle, the whole
diff stashed for the "before" run): 202 → 157 total draw calls (≈22%) in a
dense Glacier stalagmite cluster, visually confirmed correct (per-rock
hatching intact, no smearing) and collision-confirmed (walked into the
cluster, no clipping, no physics-escape rescue firing).

### Twentieth pass (2026-09-10, latest)
Brief 14, dig swing — arms exist (brief 6) but digging, the game's single
most common action, didn't use them. `Figure` (`src/player/figure.ts`) gets
a third time-bounded pose alongside `flail`/`reaching`: `swing(ms = 300)`
sets a `swingT` countdown (mirrors `PlayerController.stumbleT`) that drives
an eased windup → strike → settle arc on the lead arm (`arms[0]`) while
active — priority over `reaching` (a dig mid-carry still shows the swing)
but under `flail` (being carried while digging is an edge case; flail
wins); a no-op with no thrown error when `arms.length === 0` (the Hound).
Wired at exactly the two call sites the brief specced, not inside
`applyDig` itself: locally in `digAtAim()` alongside `sound.dig`/
`digMark.burst`, and for remotes in `net.onDig` via
`remotes.get(peerId)?.figure.swing()` — no new net protocol field, reusing
the existing `DigMsg` + `peerId`. Verified: `figure["swingT"]` reads 0.3
right after a local dig and rides the eased arc down to 0 over ~18 pumped
frames (screenshotted mid-strike, arm visibly extended with dig chips
flying); a Hound digger no-ops without error; `checkVaultDoors()`'s
auto-open path calls `applyDig` directly and was confirmed by code
inspection never to call `swing()`. The remote path (`net.onDig`) was
verified by invoking it directly against a synthetic remote entry —
`remotes.get(id).figure.swingT` jumped from stale to 0.3 exactly as
wired — because this sandbox's outbound WebSocket to the Nostr signalling
relay (`wss://chorus.pjv.me/`) is blocked, so a live two-tab WebRTC
handshake couldn't be established here to also confirm it visually; that's
an environment limitation, not a code change. Separately noted, not fixed
(out of scope for this brief): remote figures are only ever placed
(`figure.place()`, position + facing) each frame, never `update()`'d, so
`flail`/`reaching`/the new `swing()` pose are set on remote figures'
state but have no visual path to render today — a pre-existing gap from
brief 6, not introduced here.

### Nineteenth pass (2026-09-10, latest)
Torches run out (brief 16): re-verified `TorchProp`/`Props.addTorch`/
`removeTorch`/`placedTorches` and `main.ts`'s `sendMyTorches`/`net.onTorches`/
`checkVaultDoors` against the real current code before touching anything.
`TorchProp` (`src/world/props.ts`) gained `life`/`maxLife` (seconds) —
`addTorch` sets `maxLife = placed ? CFG.world.torchLifeSec : Infinity`, so a
world/shrine torch (`placed: false`) is structurally exempt regardless of
what else touches it. A new `tickTorches(dt)` in `src/main.ts`, called each
frame next to `checkVaultDoors()`, only ever iterates
`chunks.props.placedTorches().filter(t => t.id.startsWith(net.selfId))` — my
own placed torches, never a peer's and never a shrine's — decrementing
`life`, shrinking `reach` down to 12% of `TORCH_REACH` over the last quarter
of `maxLife` (which feeds the light radius pushed each frame, so it dims for
free, no shader change), and on expiry calling `removeTorch` plus an
immediate `sendMyTorches()` rather than waiting for the 4 s periodic
broadcast. New tunable `world.torchLifeSec` (default 180 s) in
`src/world/config.ts`, sliderized `[10, 600, 5]` in `src/ui/tune.ts`. Also
fixed the latent bug the brief called out: `net.onTorches` was additive-only
(`addTorch` for everything in an incoming list, nothing ever removed) — with
torches now expiring on a timer this would leave every burned-out torch lit
forever on other players' screens. It now reconciles per peer: any of that
peer's placed torches missing from their latest list gets `removeTorch`'d
before the new list is applied, reusing the existing `peerId` argument
`onTorches` already receives — no new net message. `checkVaultDoors()` itself
needed no change: it already re-reads `placedTorches()` every frame, so a
torch burning out before both pillars are lit just means the door doesn't
open, and one that's already open stays open (carved into the terrain)
regardless of what expires afterward. Verified at `?seed=7`: typecheck
clean; placed a torch via `X` and read back `life: 180`/`maxLife: 180`/
`reach: 15`; set `life = 20` and pumped frames — `reach` dropped to ≈6.66
(matching the 12%–100% ramp over the last quarter), screenshotted the
dimmer torch; drove `life` to expiry and confirmed `chunks.props.torches`
no longer had the id and `placedTorches()` was empty; pumped 120 frames
against a real shrine torch (`placed: false`) and confirmed its `reach`
stayed exactly 15 and it was never present in the `placedTorches()` list
tickTorches reads from. For the `onTorches` fix, called `net.onTorches`
directly against a synthetic peer id with a two-torch list, then a
one-torch list, and confirmed the missing torch was removed — the same
direct-invocation approach the eighteenth pass used for `onDig`, since this
sandbox's outbound WebSocket to the Nostr signalling relay
(`wss://chorus.pjv.me/`) is still blocked (confirmed again via two real
tabs on `?seed=7`: `net.peers` stayed empty and the console showed the same
relay-join failure), so a live two-tab WebRTC broadcast couldn't be
observed directly here — an environment limitation, not a code change.

### Twenty-first pass (2026-09-10, latest)
Brief 15, more biome variety (and give biomes some teeth): three new `Biome`
entries in `src/world/biomes.ts` — Dusk Ridge and Root Cellar reuse the two
`ENVWAYS` colorways in `src/render/palette.ts` that had sat unused since the
palette was written ("Dusk Ridge": warm orange canyon, open and rolling;
"Ash Field": grey, cramped, now Root Cellar's low-ceiling tangle, `ceilLift:
-3`); Crystal Vein gets a genuinely new bright cyan/violet "Crystal Vein"
`ENVWAYS` ramp, sparse and glassy (`rocks: 5`, `tallShare: 0.7`). Mechanical
hook: option (a) from the brief, per-biome climb grip — `Biome` gained an
optional `climbSolidity` field; `PlayerController.climbable()`
(`src/player/controller.ts`) now reads `terrain.biome(x,z).climbSolidity ??
CFG.world.climbSolidity` instead of only the global tunable. Glacier (0.65)
and Sulphur Pit (0.95) got the exact override values the brief itself
suggested (slippery / soft-crumbly); Crystal Vein also overrides to 0.55
(glassiest of all). No new CFG/tune.ts entry, since these are per-biome data
like `terrace`/`relief`/`ceilLift`, not a single global slider. Verified at
`?seed=7`: typecheck clean; sampled `terrain.biomeId`/`terrain.biome(x,z).name`
across a wide chunk grid and found all 10 biomes present (7 original + the 3
new), with `climbSolidity` reading back correctly per biome; screenshotted
Crystal Vein (bright glassy spires), Dusk Ridge (warm orange canyon) and Root
Cellar (cramped grey rubble) at real in-world locations. Demonstrated the
mechanical difference live: forced `chunks.buildAll()` at a distant sheer
wall in Crystal Vein and drove the controller directly (`player.teleport`,
`cam.yaw`, `input.hold("KeyW", true)`, `pump`) — held ~2.2 s (130 frames)
against a wall reading solidity 0.52–0.60 the whole time, denied
(`wallClimb` stayed false) even though that same solidity is well under the
global default (0.85) and would climb in any of the seven unmodified
biomes; the identical setup against a Sulphur Pit wall at solidity ≈0.63
granted the climb almost immediately (`wallClimb`/`climbing` true, height
rising), screenshotted mid-climb with the HUD reading "climbing." One
methodology note for the record: since a wall's *first-contact* solidity is
bounded by `wallLo`/`wallHi` (≈0.56–0.66) regardless of how solid the core
gets deeper in, Crystal Vein's 0.55 threshold sits just below that band
(nearly every wall in that biome is ungrippable — reads as glass) while
Sulphur Pit's 0.95 sits well above it (nearly every wall grips — reads as
soft rock); this made a live side-by-side "same exact solidity, granted in
one biome and denied in the other" harder to catch mid-walk than expected,
so the proof leans on the measured value crossing the *global* default in
each direction instead, which is the same thing the brief itself asks for.

### Twenty-second pass (2026-09-10, latest)
Brief 17, a wandering presence — the largest, least-precedented brief in the
backlog (a genuine new entity type, not an extension of something existing),
decided directly with Myles: non-hostile, no fail state, no combat, no
damage/knockback/health system, gated to private/seeded worlds only. New
module `src/world/presence.ts`: `Presence` is a single global entity (a
deliberate simplification of "one per room" — see below), built from the
same stacked `rockGeometry` cones every golem uses but its own asymmetric,
shoulderless/armless/headless silhouette so it can never read as a mis-worn
player skin, rendered with the same `makeFigureMaterial`/hull-outline
technique as everything else. It has no Rapier body at all — walking into
it does nothing because there is nothing for the player's collider to hit,
not a special case. Wander: drifts toward a randomly re-picked nearby point
(`CFG.presence.wanderRadius`/`retargetSec`), sampling `terrain.isOpen` to
loosely avoid walls the way `scatterRocks` does, no pathfinding. Flee: any
active light in the current frame's already-built `p.torches` list (mine +
peers' + standing torches) within `CFG.presence.fleeRadius` makes it
accelerate directly away at `fleeSpeed` (faster than `wanderSpeed`).
"Half-seen": rendered (`group.visible`) only while at least one of that same
light list actually reaches its position — a hard on/off each frame rather
than a persistent per-vertex ink map (which doesn't apply to something that
moves), the simplification the brief itself explicitly invited. Sync: a new
`PresenceMsg` (`src/net/room.ts`, mirrors `TorchMsg`) carries position +
fleeing; ownership is "my id is the lexicographically smallest among self +
connected `remotes`" (the brief's own suggested equivalent to `isOwner`'s
nearest-player tie-break for one shared entity), recomputed fresh every
frame from the live `remotes` map so a departing owner needs no special
handling — whoever's left just becomes the smallest next frame. The owner
broadcasts on the torch cadence (4 s) or faster while fleeing (0.6 s) for
responsiveness; everyone else eases toward the last snapshot with the same
lerp constant remote players already use. Gate: `!shared && CFG.world.
presenceEnabled` (a new 0/1 tunable, default 1, sliderized in `src/ui/
tune.ts`) — `shared` is `main.ts`'s existing `seedParam == null` check, true
only for the one default rolling world. A new `presence` tunables section
(`wanderSpeed`, `fleeSpeed`, `fleeRadius`, `retargetSec`, `wanderRadius`,
`hearRadius`) landed in `src/world/config.ts`/`tune.ts`. Shipped the optional
sound cue too: `Sound.presence()` (`src/audio/sound.ts`), a soft one-shot
low tone + filtered-noise burst — not a drone — gated in `main.ts` to only
fire while unlit, within `hearRadius` of the local player, on a randomized
6–14 s cooldown.

One deliberate simplification from the full spec, stated up front rather
than discovered as a gap: "one per room" is shipped as one presence for the
whole world, not one spawned per chunk/room with per-instance ownership —
the brief's own ownership language ("since this is a single shared entity,
not a per-position prop") reads as inviting exactly this simpler shape, and
a single global entity already delivers the intended feeling ("not being
alone") without the added complexity of per-room spawn/despawn as chunks
stream in and out. It's confined to the lower cave (level 2, via
`terrain.isOpen`/`floorAt`) rather than wandering across all three levels,
for the same reason. Both are called out here as scope, not defects.

Verified at `?seed=7`: typecheck clean. Gate — loaded plain `http://
localhost:5300/` (no `?seed=`) and confirmed `__world.presence` is `null`
even with `presenceEnabled: 1`; loaded `?seed=7` and confirmed it exists.
Wander — sampled `presence.position` across 6 batches of 60 pumped frames
and saw it drift continuously. Flee — teleported the player's torch within
range and watched `fleeing` flip true, `group.visible` flip true, and
position measurably recede (distance to player grew frame over frame);
screenshotted the moment (a small jagged grey rock-stack, distinct from the
golem silhouettes, lit by the player's own torch) — moving away again
confirmed it fades back to `visible: false`. Walked the player directly onto
its position for 20 pumped frames with `console.error` intercepted: no
error, player physics unaffected. `?cfg=` with `world.presenceEnabled: 0` on
a `?seed=7` world confirmed `__world.presence` is `null`. **Live two-tab
test** (this session's sandbox could reach the Nostr relay, unlike several
recent prior passes — confirmed real peers in `__world.net.peers` on both
sides within ~3 s): the lexicographically-smaller selfId's tab read
`isPresenceOwner() === true` and the other `false`, matching the intended
tie-break exactly; the non-owner tab's `presence.position` converged onto
the owner's broadcast position over repeated `pump()` calls, and flipping
the owner's presence to fleeing (via a nearby torch) propagated to the
non-owner tab's `presence.fleeing` within one broadcast interval — a genuine
live confirmation of both the ownership tie-break and the net message path,
not the direct-invocation fallback several earlier passes had to use.

### Twenty-third pass (2026-09-10, latest)
Brief 18, a boulder that takes two: re-verified `makeDynamic`, `ROCK_DENSITY`/
`GOLD_DENSITY`, `setApplyImpulsesToDynamicBodies(true)` and the vault's
`vault`/`vaultsInChunk` sparse-placement pattern against the real current
code before touching anything. `Terrain.boulderSite`/`boulderSitesInChunk`
(`src/world/terrain.ts`) is a ~40 m grid of candidate sites — its own
hash/grid, mirroring `vault`'s memoised-per-cell pattern exactly — gated to
the lower cave (`isOpen`, clear of spawn, outside galleries). `Props.
addBoulder` (`src/world/props.ts`) seats one per site via `makeDynamic` at a
new `BOULDER_DENSITY` (400, a fixed tuned constant like `ROCK_DENSITY`
itself, not a slider — this is a physical constant tuned once by measuring,
not something worth live-retuning in the panel).

Real in-browser tuning turned up a genuine, non-obvious problem, not just a
number to dial in: a wide, short CONE (`rockGeometry`'s shape, the brief's
own "low height-to-radius ratio so it reads as a boulder" suggestion) is a
shallow, CONSTANT-slope ramp at any scale — the player's own slope-climb
(52°) just walks up and over it, no push required, measured directly (a
cone-shaped boulder let the player climb up and over at any density). A
second, independent problem: the existing ledge-mantle system (search rays
at 0.7-2.45 m) and the wall-climb probe (rays at 0.9/1.6 m) both read the
boulder as a climbable wall or a mantle-able ledge whenever it was tall
enough to intersect those rays, since `climbable()` only checks TERRAIN
solidity at the point ahead — irrelevant to what's actually blocking, so any
sufficiently tall dynamic prop sitting in open (low-solidity) terrain would
incorrectly qualify. Fixed at the source rather than fighting boulder
dimensions to dodge specific ray heights: `rayDistance` (`src/physics/
world.ts`) now takes an optional Rapier `filterPredicate`, and
`PlayerController`'s `wallAhead`/`findLedge` (`src/player/controller.ts`,
`notDynamic`) pass one that excludes every collider on a `Dynamic` rigid
body — wall-climb and ledge-mantle now only ever read terrain and static
props (pillars, plinths), never a pushable prop, which is the actually
correct rule (a loose object was never meant to be climbable) rather than a
boulder-specific patch. With that fixed, a new `boulderGeometry` (`terrain.
ts`) builds a jittered icosahedron-dome instead of a cone — a round shape's
slope runs shallow-to-vertical-to-shallow (flat poles, vertical equator), so
at a big enough radius/height its too-steep-to-climb band is itself taller
than autostep (0.55 m) can bridge, genuinely blocking a walking player
rather than just looking round.

Verified at `?seed=7`: typecheck clean. Found real placed boulders via
`terrain.boulderSitesInChunk` across a chunk sweep. Solo push (a fixed
world-space heading held into it for 3 s, `__world.pump`, no re-aiming) at
`BOULDER_DENSITY` 400 (mass ≈ 4720 kg for this boulder's actual size, read
back via `body.mass()`) moved it **0.197 m** in one run and **0.218 m** in a
second run with a slightly different steering methodology — small,
consistent, clearly "barely budges." **Live two-tab test** (this session's
sandbox reached the Nostr relay; confirmed real peers in `net.peers` on both
sides): reset the same boulder to an identical start position in both tabs,
had tab A push it alone for 1 s (**+0.148 m**), confirmed tab B's own
independent physics read the exact same resulting position within one
broadcast interval (cross-checked to 3 decimal places — genuine live sync,
not assumed), then had tab B continue pushing from there for another 1 s
(**+0.065 m** more) — **two real players, 2 s of combined pushing, totalling
≈0.27 m, already ahead of what one player alone manages in a full 3 s** (0.20-
0.22 m). Screenshots taken: the boulder at rest from directly above (a
faceted dome, clearly bigger and rounder than any shard or the jagged
crystal-cluster rocks beside it) and mid-interaction with a real second
player's figure visible beside it during a live push. One honest caveat, not
papered over: when both players' pushes converged too tightly on the same
contact point at once in an earlier attempt, the existing distance-based
props-ownership reconciliation (two independent client-side physics
simulations, periodically hard-synced) produced a visible pop/launch
artifact that settled back to rest a moment later — a known characteristic
of the pre-existing sync model this brief explicitly says not to redesign,
not something introduced by or unique to this boulder; real human players
adjusting their approach (as this session's scripted "reposition after
sliding off" test did) shouldn't hit it often, but it is a real edge case
worth knowing about.

### Twenty-fourth pass (2026-09-10, latest)
Brief 19, getting knocked down: re-verified the inline hard-landing block in
`src/main.ts` (`wasGrounded`/`vyBefore`, `cam.thump`, `digMark.burst`,
`player.stumbleT`), `Prop.lastV`/`onKnock` in `src/world/props.ts`, and the
`Remote` type's position-only tracking against the real current code before
touching anything. Extracted the landing feedback into a reusable
`applyImpact(k: number)` closure in `main.ts` (same 0..1 magnitude curve the
landing code always used) and added two new per-frame proximity+speed
checks that call it, exactly per the brief: `checkPropImpacts()` walks a new
`Props.dynamicProps()` accessor (mirrors `placedTorches()`'s style),
comparing each awake, un-held dynamic prop's live Rapier body speed and
distance against new `impactPropSpeed`/`impactRadius` tunables; the
remote-player check lives inline in the existing per-frame remotes loop,
deriving a per-frame velocity from the position delta already computed there
(`remotePrev` vs. the just-lerped `r.pos`, divided by `dt` — no new net
field) and comparing against `impactPlayerSpeed`/`impactRadius`. New
tunables (`impactPropSpeed: 6`, `impactPlayerSpeed: 10`, `impactRadius: 1.8`)
in `CFG.player`, sliderized in `src/ui/tune.ts`.

One real hazard found in-browser, not just guessed at: grabbing another
player snaps their broadcast position toward the carrier's hand between
network ticks, which the remote-speed derivation would otherwise read as an
enormous, spurious "thrown" velocity the instant a grab starts (confirmed by
calculation and then by testing) — fixed with a `heldRemoteIds` set (built
each frame from my own `carrying` var plus every peer's broadcast `g` field,
"who I'm carrying") that skips the impact check for anyone currently held,
so only real free flight after a release counts. Held props needed no
equivalent fix: they're kinematic while carried, so `body.linvel()` already
reads inert.

Verified at `?seed=7`: typecheck clean. Prop case — teleported a real
dynamic prop from `chunks.props.dynamicProps()` to fly past the player
in-air at 12 m/s, offset to pass beside rather than straight through:
`stumbleT` jumped to 0.314 and `cam.shakeMag` to 0.237 at the moment it
closed to 1.65 m, matching the scaling formula exactly by hand-calculation;
a second run at 3 m/s (below `impactPropSpeed`) approaching to within 0.77 m
never moved `stumbleT` off 0 across 25 frames. **Live two-tab test**: two
real tabs on `?seed=7` found each other in `net.peers` within seconds; had
tab A `grabPlayer`/`throwPlayer` tab B's player with an upward-lobbed,
fast horizontal velocity aimed back near A's own position, and polled A with
a real-time async loop (necessary because this sandbox's background tab
kept running its own render loop live, not frozen, so the flight played out
in wall-clock time across both tabs) — watched B's synced remote position
close to 1.5-1.6 m of A while A's `stumbleT`/`cam.shakeMag` flipped from 0 to
0.232/0.151 and decayed back to 0 over the following ~0.25 s as `stumbleT`
ticked down, a genuine cross-tab detection of A's own client reading B's
network-synced speed. Confirmed the grab itself (carry, no throw yet) never
false-triggers despite the position snap. Confirmed ordinary contact doesn't
trigger either way: a real dynamic prop pushed into the player at 3 m/s
never crossed the threshold, and B walking at RUN speed (7.2 m/s, launched
and pumped for real, not simulated) all the way to 0.94 m from A left A's
`stumbleT` at 0 throughout.

### Twenty-fifth pass (2026-09-10, latest): two real bugs found by live playtesting
Myles reported three things while actually playing: `G` (spawn relic)
"sometimes does, sometimes doesn't," `F` (grab) "never works," and the
camera "often ends up looking through walls" as he rotated it. Investigated
directly rather than guessing, and confirmed two distinct, real bugs:

- **`spawnRelicAt` ignored the player's actual level.** It always seated a
  spawned relic at the LOWER CAVE's floor height (`terrain.floorAt`)
  regardless of where the player stood — since players start on the
  surface, pressing `G` there dropped the relic ~11 m below and dozens of
  metres away, invisible and unreachable; `F` then "never worked" because
  there was nothing nearby to grab. Only worked when already deep in the
  lower cave, matching "sometimes." Fixed: `spawnRelic()` (`src/main.ts`)
  now reads the player's own level (`terrain.levelOf`) and passes it to
  `spawnRelicAt(x, z, level)` (`src/world/props.ts`), which seats on
  `terrain.levelAt(level, x, z)` instead. Verified: a fresh spawn now lands
  ~2.2 m in front of the player at their own height (was an 11 m vertical
  gap before), and grabbing it works — confirmed by aiming precisely at the
  relic's real position and reading back a correct `fromCollider` match
  (the raycast/collider system itself was never at fault, only the
  placement).
- **The third-person boom used a zero-width raycast to shorten on rock**
  (`src/player/camera.ts`) — a thin ray can clear a corner or a shallow
  wall that the camera's actual near-plane/frustum still pokes through as
  you rotate, exactly matching "looking through walls." Fixed with a new
  `sweepDistance` helper (`src/physics/world.ts`, `RAPIER.World.castShape`
  with a small ball in place of a ray) and swapped the boom to use it.
  Verified head-to-head, not just by feel: same test position, a full yaw
  sweep, old ray-based code vs. the new sweep — the new code pulled the
  camera closer at every single angle tested, up to 1.36 m closer at the
  worst one, proving the old code really was letting the camera sit
  inside/behind geometry the ray missed.
- Also confirmed, not changed: hold-to-dig already exists (`input.leftDown`
  + a `digT`/`CFG.dig.rate` accumulator in `main.ts`) — holding the mouse
  button already digs continuously, no feature was missing there. And the
  paper-speck/grain effect Myles asked about is intentionally screen/print-
  space, not per-object — the press pass is explicitly a fixed-density print
  simulation over the whole frame by design (see "Why this shape" above),
  not a rendering bug, though it's a known tradeoff the project's own
  "known risks" section already calls out.
- Typecheck clean throughout; both fixes pushed directly to `origin/main`
  and republished (this changes visible behavior on the live build).

### Twenty-sixth pass (2026-09-10, latest): the actual reason F never worked
The spawn-level fix above was real, but Myles reported `F` still wasn't
picking things up afterward — rightly, because it was a second, unrelated,
more fundamental bug in the exact same key. `Input.once(code)`
(`src/player/input.ts`) is consume-on-read: the first call after a
keypress returns `true` and deletes the pending flag; every call after
that (until the key is pressed again) returns `false`. The `KeyF` handler
in `src/main.ts` called it three separate times across a chained
`if / else if / else if`:
```
if (input.once("KeyF") && carrying) { ... }
else if (input.once("KeyF") && !grab.held && targetPlayer && !carriedBy) { ... }
else if (input.once("KeyF")) { grab.grabOrDrop(...) }
```
Whenever `carrying` is falsy — which is nearly always, "carrying another
player" is a rare special state — the FIRST call still consumes the
keypress (it reads `true` before `&& carrying` drags the whole condition
back down to `false`), so by the time the real `grabOrDrop()` branch's own
`input.once("KeyF")` call runs, the flag is already gone. `F` was
structurally eating its own input on the one path that mattered most.
Fixed by reading `input.once("KeyF")` exactly once into a local
(`pressedF`) and branching on that. Grepped the rest of `main.ts` to
confirm this was the only key checked more than once per frame — it was.
Verified as the real end-to-end flow, not a synthetic shortcut: a real
`KeyG` press (via `input`'s own pending-key set, not calling `spawnRelic()`
directly), then iteratively aimed the real camera at the spawned relic's
actual seated position until `grab.target` was set by the genuine raycast
(not assigned by hand), then a real single `KeyF` press — `grab.held`
correctly became the relic, HUD read "holding (click to throw, F to
drop)", screenshotted. Typecheck clean; pushed to `origin/main` and
republished.

### Twenty-seventh pass (2026-09-10, latest): 2 of 10 biomes were reading another biome's pen
Found while investigating Myles's "hard to tell biomes apart" and shading
feedback, not by guessing: `uPenA`/`uPenB` (`src/render/shaders.ts`) — the
per-biome hatch/black/pitch/nib/cracks/stipple/hatchRot/formFollow values —
are declared `[8]`, a GLSL array size, which is compile-time fixed. Brief
15 grew `BIOMES` (`src/world/biomes.ts`) from 7 to 10 entries, but
`penUniforms()`'s upload loop (`src/render/pipeline.ts`) was still
hardcoded `for (let i = 0; i < 8; i++)`, so the two newest biomes past
index 7 (Root Cellar, Crystal Vein) were never given their own slot at
all — reading `uPenA[8]`/`uPenA[9]` in the shader is an out-of-bounds
constant-array access, undefined per the GLSL spec and observed in
practice as silently repeating an earlier biome's values, not the newest
biomes' own authored ones. Fixed by sizing both the shader arrays and the
upload loop to match (`uPenA[10]`/`uPenB[10]`, loop bound `BIOMES.length`).
Verified directly: `uPenA.value.length` is now 10, and indices 7/8/9 each
read back their own distinct authored pen (Crystal Vein's `black` reads
0.15, notably lower than its neighbours, matching its "bright, glassy,
sparse" design intent from brief 15) rather than duplicating each other.
This directly affects biome legibility (2 of 10 biomes weren't reading as
designed at all) and likely contributed to some of the "too dark" shading
Myles flagged, since Root Cellar came up repeatedly in recent testing.

Also added `press.shadowLift` (`src/world/config.ts` + a tune-panel slider,
default 0 — no change to today's look): shrinks each biome's flat-black
cutoff toward 0 as it rises, so a shadowed rock face keeps reading as
hatched tone instead of going solid ink, live. This is a tool for Myles to
feel out "shading reads as darkness/abyss" himself while actually playing
(backtick → press → shadowLift) rather than a default anyone changed on his
behalf — the design is deliberately posterized/hard-edged and that stays
the default. Wired into the shared toon material (`makeToonMaterial` in
`src/render/pipeline.ts`), so it reaches rock, instanced rocks (shared
uniforms) and figures together; not wired into the ceiling material, which
uses an unrelated shader with no `blackCut` concept.

### Twenty-eighth pass (2026-09-11): a frozen throw-arc/outline stuck on screen forever
Found from a real screenshot Myles shared showing a jagged white cluster
hanging in open space, unattached to any wall. Traced with a property
trap on `Grab`'s own `arc.visible` (logging every write with a stack
trace, not guessing) to `renderFrame()` in `src/render/pipeline.ts`:
`p.ndHidden` holds every mesh that should sit out the ND (normal+depth)
key-plate pass — Grab's outline/player-outline/tether/throw-arc/landing-
ring, DigMark's marker and ink chips, every figure's and prop's inverted-
hull contour. `renderFrame` hid them all for the ND pass, then restored
them ALL to a hardcoded `visible = true` afterward — fine for hulls that
are always meant to be visible, but wrong for anything ALSO independently
shown/hidden by its own owner's logic that same frame (`Grab.render()`
correctly sets `arc`/`ring`/`tether`/`outline` back to `false` once nothing
is held or targeted — and then the ND-hidden restore step silently
overwrote that back to `true`, one call later in the same frame). Once
such a mesh was ever given real, non-degenerate geometry (any first grab,
even one immediately released), it rendered forever after regardless of
game state — exactly the persistent jagged shape in the screenshot.
Fixed by remembering each object's own visibility going into the ND-hide
step (a `Map<Object3D, boolean>`) and restoring to THAT instead of a
blanket `true` — a no-op for the always-visible cases (hulls), a real fix
for the sometimes-hidden ones. Verified with a live property trap both
ways: after a real grab → target → grab → throw sequence (`grab.
grabOrDrop`/`grab.throw` called for real, not hand-set state), `arc`/
`ring`/`tether`/`outline` all correctly stay `false` across 30+ subsequent
frames (previously flipped back to `true` one frame later, proven by the
trap's stack trace pointing straight at `renderFrame`'s restore loop); a
genuinely-still-targeted object's outline still correctly stays `true`
across many frames too, so the fix doesn't break the normal case.
Screenshotted a real grab→throw→settle sequence at Myles's own seed
(2866): clean, no stray shape. Typecheck clean; pushed to `origin/main`
and republished (visible rendering fix).

### Twenty-ninth pass (2026-09-11): a way to hop between biomes
Brief 21: biomes are a spatial noise field (`terrain.biome(x,z)`/`biomeAt`),
not a per-player toggle, so "switch my biome" means finding the nearest
point actually in a different biome and teleporting there rather than
overriding the field under the player. A new `hopBiome()` in `src/main.ts`
reads the player's current `terrain.biomeId`, then walks forward through
`BIOMES` in index order (wrapping) — for each candidate id it grows a ring
search (`findBiomePoint`, 5 m ring step, angular samples scaled to keep ring
spacing roughly constant) out to `CFG.world.biomeHopRadius` (new tunable,
default 400 m, sliderized `[50, 1000, 10]` in `src/ui/tune.ts`) looking for
the nearest point whose `biomeId` matches; the first id (in cycle order)
with a hit wins, so repeated presses tour the full biome list rather than
bouncing between the same two neighbours. Lands via `player.teleport()`
seated on `terrain.levelAt(terrain.levelOf(...), x, z)` — the player's own
current level, not always the lower cave, matching the fix `spawnRelicAt`
got in the twenty-fifth pass. A bounded search (no match found in any
biome within the radius) does nothing and shows `chat.toast("no other
biome found nearby")` rather than hanging or crashing. Wired to a new `B`
hotkey (confirmed free against the README key table) right next to `G` in
`src/main.ts`, and to a matching "Hop biome (B)" button in the tuning panel
(`TuneCallbacks.onHopBiome`, `src/ui/tune.ts`) — same precedent as the
Export/Import/Spawn-relic action buttons. Verified at `?seed=7`: typecheck
clean; drove `__world.hopBiome()` directly eight presses in a row and read
`terrain.biome(player.position.x, player.position.z).name` back as Dungeon,
Glacier, Blood Cave, Sulphur Pit, Void Peaks, Deep Sea, Cathedral, Dusk
Ridge — a clean tour in `BIOMES` order, not a bounce; dispatched a real
`KeyB` `keydown` through the actual input system and confirmed the same
cycle continues (Dusk Ridge → Root Cellar); opened the tuning panel
(backtick) and clicked the real "Hop biome (B)" button, confirmed it
advances the biome exactly the same way (Root Cellar → Crystal Vein).
Screenshotted two distinct biomes reached this way — Crystal Vein (bright
orange/purple glassy spires, HUD reading "Crystal Vein · surface") and
Dungeon (HUD reading "Dungeon · surface", toast "hopped to Dungeon"
visible on screen). Forced `CFG.world.biomeHopRadius` down to 3 m and
confirmed the bounded-search fallback: the player didn't move and the
toast read "no other biome found nearby", screenshotted.

### Thirtieth pass (2026-09-11): night mode
Brief 20, shipped in full. A new `uNight` uniform threads through both
copies of the "unprinted until lit" block (`TOON_FRAGMENT` and
`VAULT_FRAGMENT` in `src/render/shaders.ts`): `printed = smoothstep(0.08,
0.5, mix(max(inked, lit), lit, uNight))` — at `uNight = 0` this is
byte-for-byte the old formula (`mix` at `t=0` returns its first argument
exactly, so day rendering is provably unchanged, not just "looks the
same"); at `uNight = 1` only this frame's real `lit` counts, so a
previously-inked, currently-unlit spot reverts to bare paper. `setNight`
(`src/render/pipeline.ts`) pushes it to `rockMat`/`ceilMat`/`figureMats`
every frame, the same unconditional per-frame pattern `setDepth` already
used for `uDepth` — main.ts computes it either from the phase lock or from
`p.time % dayNightCycleSec` (a single cosine lobe for a smooth day→night→
day, no hard cut), scaled by the new `nightIntensity` safety valve (0 fully
disables it). `CFG.world.timePhase: "auto" | "day" | "dusk" | "night"`
(plus `dayNightCycleSec`, `nightIntensity`) is a new string-valued field in
an otherwise all-numeric `Tunables.world` — `loadConfig` special-cases it
(the generic numeric-merge loop skips the key, a separate string check
restores it), and `tune.ts`'s per-key slider loop skips it the same way, in
favour of Auto/Day/Dusk/Night buttons — a small custom control (mirroring
the mouse/trackpad control-scheme select's precedent, per Myles's literal
ask for buttons, not a dropdown) that write straight to `CFG.world.
timePhase` and highlight the active one, refreshed after Import/Reset too.
Surface dusk-toning is one small additive change to the existing
depth-dimming paper-tone line in `TOON_FRAGMENT` (`* (1.0 - uNight * 0.4)`)
plus the same treatment for `main.ts`'s `scene.background` color when
`onSurface` (previously a flat, undimmed `PAPER` hex) — both still flat
bare paper, just a darker sheet of it; no skyline, no gradient. A new
sparse permanent-brazier scatter (`BRAZIER_GRID = 90` in `src/world/
terrain.ts`, mirroring the vault/boulder grid-cache pattern exactly, its
own hash) spawns a taller/bulkier stone-cairn-and-flame fixture
(`Props.addBrazier`/`brazierMesh`, `BRAZIER_REACH = 24`, visually distinct
from a hand torch) in the lower cave — `placed: false` like a vault pillar
torch, so it's immune to brief 16's burnout for free, no new code needed
there.

Verified at `?seed=7`: typecheck clean throughout. Confirmed the day/night
math directly against the shipped formula (not just eyeballing) — read the
real `inkMap` texture data and the real `p.torches` list back, replicated
`smoothstep`/`printed` in JS, and got `dayNear/dayFar` both `printed=1`
(day unaffected) vs `nightNear=1`/`nightFar=0` (night's whole point) at two
real, ink-stamped points. Then proved it visually: with the player's own
carried light pinned to a hair's-width reach (isolating "what's actually
lit right now" from "what I'm currently standing next to"), the same
camera position read as full black-ink hatched rock at Day and flat bare
paper at Night — screenshotted both, plus read back the literal rendered
pixel color of a distant background peak at the same screen coordinate
(215,212,193 by day vs 172,169,154 by night, ≈80% of day's brightness —
"duskier, not black," exactly as asked). Watched a placed torch's lit
patch (screenshotted, fully inked) go fully bare (screenshotted) the
instant `tickTorches` expired it while locked to Night. Confirmed
`nightIntensity: 0` forces `uNight` to `0` even locked to Night. Confirmed
Export JSON / `?cfg=` both carry `timePhase`/`dayNightCycleSec`/
`nightIntensity` after changing them, and Import round-trips the string
`timePhase` field correctly. Clicked the real Day/Dusk/Night/Auto buttons
in the tuning panel (not scripted state) and confirmed `CFG.world.
timePhase` follows and the active button highlights. Opened the paper map
(Tab) at Day and at Night at the same explored spot and confirmed it was
pixel-identical either way. Found a real brazier site via `terrain.
brazierSitesInChunk`, streamed its chunk in, and confirmed the live
`TorchProp` reads `reach: 24`, `placed: false`, `life: Infinity` —
screenshotted its bulkier cairn-and-flame silhouette next to a normal hand
torch's thin stake for the visual contrast the brief asked for. No scope
cuts — the whole brief shipped, phase-lock/tuning-export included, per
Myles's explicit ask that piece not be skipped.

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
