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
