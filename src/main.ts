import * as THREE from "three";
import { applyConfig, createPipeline, renderFrame, resizePipeline, setWorldSeed, setDepth, setNight, MAX_LIGHTS, INK_BLACK, PAPER, type Torch } from "./render/pipeline";
import { COLORWAYS } from "./render/palette";
import { initPhysics, rayDistance, rayHit, hasLineOfSight } from "./physics/world";
import { Terrain, type Level } from "./world/terrain";
import { BIOMES } from "./world/biomes";
import { ChunkManager } from "./world/chunks";
import { CFG, configFromUrl, loadConfig, resolveQuality, QUALITY_PRESETS } from "./world/config";
import { msUntilRoll, sharedSeed } from "./world/settings";
import { Input } from "./player/input";
import { PlayerController } from "./player/controller";
import { PlayerCamera } from "./player/camera";
import { availableCharacters, Figure, normaliseCharacter, type CharacterId } from "./player/figure";
import { Grab } from "./player/grab";
import { DigMark, type DigPlan } from "./player/digmark";
import { Sound } from "./audio/sound";
import { Net, type DigMsg, type PresenceMsg } from "./net/room";
import { Presence, findPresenceSpawn } from "./world/presence";
import { Voice } from "./net/voice";
import { ScreenShare } from "./net/screenshare";
import { PhotoMode } from "./ui/photo";
import { Chat } from "./ui/chat";
import { Tune, applyBiomeDoc } from "./ui/tune";
import { PaperMap } from "./ui/map";
import { TouchControls } from "./ui/touch";
import { TORCH_REACH } from "./world/props";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const stamina = document.getElementById("stamina") as HTMLDivElement;
const staminaBar = stamina.firstElementChild as HTMLElement;
const voiceBtn = document.getElementById("voice") as HTMLButtonElement;
const screenshareBtn = document.getElementById("screenshare") as HTMLButtonElement;
const screensharesEl = document.getElementById("screenshares") as HTMLDivElement;
const gameAreaEl = document.getElementById("gameArea") as HTMLDivElement;
const splitDividerEl = document.getElementById("splitDivider") as HTMLDivElement;
const splitDockEl = document.getElementById("splitDock") as HTMLDivElement;
const aimEl = document.getElementById("aim") as HTMLDivElement;

// ── Which world ────────────────────────────────────────────────────────
// No `?seed=` means THE world: one cave everyone lands in, rolling to a new
// seed every two hours on the clock (everyone's clock agrees). `?seed=` is a
// private world; `?room=` a private room on any seed.
const url = new URL(location.href);
const seedParam = url.searchParams.get("seed");
const shared = seedParam == null;
const seed = shared ? sharedSeed() : Number(seedParam) || 7;
const roomOverride = url.searchParams.get("room") ?? undefined;
// Single player: `?solo=1`, or any host whose CSP blocks the relays (Metalab Sites).
const solo = url.searchParams.get("solo") === "1" || /(^|\.)sites\.metalab\.com$/.test(location.hostname);
// Quality: `?q=low|med|high`, else auto — `low` on a coarse pointer (phones),
// `high` (today's desktop default) otherwise. A fixed preset table
// (`QUALITY_PRESETS` in world/config.ts), not sliders — printScale still
// seeds the existing live slider, so the panel and `?cfg=` can still tune it
// from there; `?cfg=` (below) overrides the preset's printScale if given.
const quality = resolveQuality(url.searchParams.get("q"));
const qualityPreset = QUALITY_PRESETS[quality];
CFG.press.printScale = qualityPreset.printScale;
const urlCfg = configFromUrl() as { config?: unknown; biomes?: unknown } | null;
if (urlCfg) {
  loadConfig(urlCfg.config ?? urlCfg);
  applyBiomeDoc(urlCfg.biomes as never);
}

const PLAYER_REACH = 3.4;
const MAX_PLACED_TORCHES = 16;

type Remote = {
  figure: Figure;
  pos: THREE.Vector3;
  facing: number;
  torch: THREE.Vector3;
  speed: number;
  loading: CharacterId | null;
  talking: boolean;
};

async function boot(): Promise<void> {
  const p = createPipeline(canvas, CFG.press.printScale, qualityPreset.ndHalfRes);
  setWorldSeed(p, seed);
  applyConfig(p);
  const ph = await initPhysics();
  const terrain = new Terrain(seed);
  const chunks = new ChunkManager(p, ph, terrain, qualityPreset.chunkRadius);
  const spawn = terrain.spawnPoint();
  chunks.buildAll(spawn);

  // Heightfield orientation self-check at GRID VERTICES (where the collider
  // equals the analytic field exactly; between vertices the field's ramps
  // differ from the collider's linear facets). Rays can still land on a
  // boulder or a prop, so judge the MEDIAN. Queries need one step first.
  ph.world.step();
  {
    const errs: number[] = [];
    for (let i = 0; i < 40; i++) {
      const x = Math.round((Math.random() - 0.5) * 60);
      const z = Math.round((Math.random() - 0.5) * 60);
      const d = rayDistance(ph, { x, y: 60, z }, { x: 0, y: -1, z: 0 }, 100);
      if (d == null) continue;
      errs.push(Math.abs(60 - d - terrain.surfaceAt(x, z)));
    }
    errs.sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)] ?? Infinity;
    console.info(`[relic-world] heightfield vs analytic floor: median ${median.toFixed(3)} m over ${errs.length}/40 rays`);
    if (errs.length === 0) console.error("[relic-world] no ray hit the terrain — colliders missing?");
    else if (median > 0.5) console.error("[relic-world] heightfield orientation mismatch");
  }

  const input = new Input(canvas);
  const player = new PlayerController(ph, spawn, terrain);
  const cam = new PlayerCamera(p.camera, ph);
  const figure = new Figure(p);
  const sound = new Sound();
  const cast = availableCharacters();
  let charIndex = cast.findIndex((c) => c.id === normaliseCharacter(localStorage.getItem("relic-world:character") ?? ""));
  if (charIndex < 0) charIndex = Math.floor(Math.random() * cast.length);
  let customFigure = false;
  figure.onStep = () => sound.step(lastSpeed);
  await figure.load(cast[charIndex]!.id, 1.7);
  figure.setColorway(Number(localStorage.getItem("relic-world:ink") ?? Math.floor(Math.random() * COLORWAYS.length)));
  applyConfig(p);

  const torchPos = new THREE.Vector3(0, 5, 0);
  const net = new Net(seed, roomOverride, solo);
  if (solo) { voiceBtn.hidden = true; screenshareBtn.hidden = true; }
  const voice = new Voice(net);
  const screenShare = new ScreenShare(net);
  const remotes = new Map<string, Remote>();
  net.onJoin = (id) => {
    const r: Remote = { figure: new Figure(p), pos: new THREE.Vector3(), facing: 0, torch: new THREE.Vector3(), speed: 0, loading: null, talking: false };
    const st = net.peers.get(id)!.state;
    r.pos.set(...st.p);
    r.torch.set(...st.t);
    remotes.set(id, r);
    voice.peerJoined(id);
    screenShare.peerJoined(id);
    applyConfig(p);
    // Bring the newcomer up to date with what I have dug and placed.
    for (const d of myDigs) net.sendDig(d);
    sendMyTorches();
  };
  net.onLeave = (id) => {
    remotes.get(id)?.figure.dispose();
    remotes.delete(id);
    voice.peerLeft(id);
    screenShare.peerLeft(id);
  };
  window.addEventListener("beforeunload", () => net.leave());
  voice.onChange = (on, err) => {
    voiceBtn.textContent = err ? `🎤 ${err}` : on ? "🎤 voice on" : "🎤 voice off";
    voiceBtn.classList.toggle("on", on);
  };
  voiceBtn.addEventListener("click", (e) => { e.stopPropagation(); void voice.toggle(); });
  screenShare.onChange = (on, err) => {
    screenshareBtn.textContent = err ? `🖥️ ${err}` : on ? "🖥️ sharing (click to stop)" : "🖥️ share screen";
    screenshareBtn.classList.toggle("on", on);
  };
  const shareName = (peerId: string): string => (peerId === net.selfId ? "You" : net.peers.get(peerId)?.state.n ?? "someone");

  // ── Split view: one shared screen "docked" as its own resizable pane
  // alongside the game, Chrome-split-view style — everyone else's shares
  // (if any) stay as small floating tiles. `splitRatio` is the docked
  // pane's width as a fraction of the window, dragged via #splitDivider. ──
  let dockedId: string | null = null;
  let splitRatio = 0.5;
  const layoutSplit = (dockedVideo: HTMLVideoElement | null) => {
    const on = dockedVideo != null;
    splitDividerEl.hidden = !on;
    splitDockEl.hidden = !on;
    gameAreaEl.style.width = on ? `${splitRatio * 100}%` : "100%";
    splitDividerEl.style.left = on ? `${splitRatio * 100}%` : "";
    splitDockEl.style.left = on ? `${splitRatio * 100}%` : "";
  };
  // Rebuilt (not diffed) each time: at most a handful of peers ever share at
  // once, and this only runs on start/stop/dock, never per frame.
  screenShare.onIncomingChange = () => {
    const shares = screenShare.list();
    if (dockedId && !shares.some((s) => s.peerId === dockedId)) dockedId = null;
    screensharesEl.innerHTML = "";
    splitDockEl.innerHTML = "";
    let dockedVideo: HTMLVideoElement | null = null;
    for (const s of shares) {
      if (s.peerId === dockedId) {
        dockedVideo = s.video;
        const bar = document.createElement("div");
        bar.className = "shareBar";
        const label = document.createElement("span");
        label.textContent = `${shareName(s.peerId)}'s screen`;
        const undock = document.createElement("button");
        undock.textContent = "◱ float";
        undock.addEventListener("click", (e) => { e.stopPropagation(); dockedId = null; screenShare.onIncomingChange?.(); });
        bar.append(label, undock);
        splitDockEl.append(bar, s.video);
        continue;
      }
      const tile = document.createElement("div");
      tile.className = "tile";
      const bar = document.createElement("div");
      bar.className = "shareBar";
      const label = document.createElement("span");
      label.textContent = `${shareName(s.peerId)}'s screen`;
      const dock = document.createElement("button");
      dock.textContent = "⇔ split view";
      dock.addEventListener("click", (e) => { e.stopPropagation(); dockedId = s.peerId; screenShare.onIncomingChange?.(); });
      bar.append(label, dock);
      tile.append(bar, s.video);
      screensharesEl.appendChild(tile);
    }
    layoutSplit(dockedVideo);
  };
  // Drag the divider to resize the split; the canvas follows every frame
  // since resizePipeline already reads canvas.clientWidth/clientHeight live.
  let dragging = false;
  splitDividerEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    dragging = true;
    splitDividerEl.classList.add("dragging");
    splitDividerEl.setPointerCapture(e.pointerId);
  });
  splitDividerEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    splitRatio = Math.min(0.8, Math.max(0.2, e.clientX / window.innerWidth));
    layoutSplit(splitDockEl.querySelector("video"));
  });
  const stopDragging = () => { dragging = false; splitDividerEl.classList.remove("dragging"); };
  splitDividerEl.addEventListener("pointerup", stopDragging);
  splitDividerEl.addEventListener("pointercancel", stopDragging);
  screenshareBtn.addEventListener("click", (e) => { e.stopPropagation(); void screenShare.toggle(); });

  // ── A wandering presence (brief 17): private/seeded worlds only, and a
  // CFG kill switch on top of that, so it can be turned off without a
  // redeploy even there. `shared` is only ever true for the one default
  // rolling world — a private `?seed=` (or `?room=`) world is everything
  // else, which is exactly where this is allowed to exist. ────────────────
  const presence = !shared && CFG.world.presenceEnabled
    ? new Presence(p, terrain, seed, findPresenceSpawn(terrain, seed))
    : null;
  let presenceTarget: PresenceMsg | null = null;
  if (presence) net.onPresence = (m) => { presenceTarget = m; };
  const isPresenceOwner = (): boolean => {
    for (const id of remotes.keys()) if (id < net.selfId) return false;
    return true;
  };
  let presenceSendT = 0;
  let presenceSoundT = 2 + Math.random() * 4;

  // ── Props: ownership, digging, torches, collecting ──────────────────
  const isOwner = (x: number, z: number): boolean => {
    const mine = (player.position.x - x) ** 2 + (player.position.z - z) ** 2;
    for (const [id, r] of remotes) {
      const theirs = (r.pos.x - x) ** 2 + (r.pos.z - z) ** 2;
      if (theirs < mine - 1e-6 || (Math.abs(theirs - mine) <= 1e-6 && id < net.selfId)) return false;
    }
    return true;
  };
  net.onProps = (states) => chunks.props.apply(states, isOwner);
  chunks.props.onKnock = (impact) => sound.knock(impact);
  const myDigs: DigMsg[] = [];
  const applyDig = (m: DigMsg) => {
    const level = Math.min(2, Math.max(0, Math.round(m.l))) as Level;
    if (m.u === 1 && level !== 0) {
      const touched = terrain.digUp(level, m.x, m.z, m.r, m.d);
      chunks.reCeil(level, touched);
    } else {
      const touched = m.t != null ? terrain.digTo(level, m.x, m.z, m.r, m.t) : terrain.dig(level, m.x, m.z, m.r, m.d);
      chunks.refloor(level, touched);
    }
    sound.knock(5);
  };
  net.onDig = (d, peerId) => {
    applyDig(d);
    remotes.get(peerId)?.figure.swing();
  };
  let digT = 0;
  /** March the aim ray in 0.25 m steps looking for the ceiling above the
   *  level the player is standing in. Ceilings are meshes only — no
   *  collider — so there is nothing for a physics ray to hit up there; this
   *  walks the analytic field instead. Only tried once the physics ray has
   *  already come up empty (a real wall in the way still wins). */
  const aimCeiling = (max: number, level: 1 | 2): THREE.Vector3 | null => {
    const STEP_M = 0.25;
    const steps = Math.ceil((max + 8) / STEP_M);
    for (let i = 1; i <= steps; i++) {
      marchPt.copy(p.camera.position).addScaledVector(aimDir, i * STEP_M);
      if (marchPt.distanceTo(chest) > max) return null;
      if (marchPt.y >= terrain.ceilingAt(level, marchPt.x, marchPt.z)) return marchPt.clone();
    }
    return null;
  };
  /** What one click would cut. Small cuts, so a tunnel is something you
   *  carve rather than blast: at the ground a body-wide pit a few tens of cm
   *  deep; at a wall a body-wide tunnel at your feet; aim UP at a wall and it
   *  carves a step you can mantle onto — keep going and you have stairs; aim
   *  UP at open headroom and it carves the same small cut into the ceiling
   *  above you, raising it — keep going and it breaks through to whatever is
   *  overhead.
   *  Snapped to the centre of the 1 m cell so every dig drops a whole cell's
   *  four corners — a clean body-wide shaft instead of a one-vertex funnel. */
  const planDig = (): { m: DigMsg; plan: DigPlan } | null => {
    const D = CFG.dig;
    const feet = player.position.y;
    const pt = aimPoint(D.reach);
    if (pt) {
      const level = terrain.levelOf(pt.x, pt.z, pt.y);
      const wall = pt.y > feet + 1.1;
      const x = Math.floor(pt.x) + 0.5, z = Math.floor(pt.z) + 0.5;
      if (wall && aimDir.y > 0.2) {
        const stepY = Math.min(Math.max(pt.y - 0.4, feet + 0.8), feet + D.stepUp);
        return { m: { l: level, x, z, r: D.tunnelRadius, d: 0, t: stepY }, plan: { kind: "step", level, x, z, floorY: stepY, hit: pt } };
      }
      if (wall) {
        const t = feet - 0.08;
        return { m: { l: level, x, z, r: D.tunnelRadius, d: 0, t }, plan: { kind: "tunnel", level, x, z, floorY: t, hit: pt } };
      }
      const m: DigMsg = { l: level, x, z, r: D.radius, d: D.depth };
      return { m, plan: { kind: "pit", level, x, z, floorY: terrain.levelAt(level, x, z) - D.depth, hit: pt } };
    }
    // Nothing solid ahead. Looking up steeply with clear headroom? Try the
    // ceiling of the level we're standing in (the surface has none to dig).
    if (aimDir.y > 0.3) {
      const level = terrain.levelOf(player.position.x, player.position.z, feet);
      if (level === 1 || level === 2) {
        const roofPt = aimCeiling(D.reach, level);
        if (roofPt) {
          const x = Math.floor(roofPt.x) + 0.5, z = Math.floor(roofPt.z) + 0.5;
          const newCeil = terrain.ceilingAt(level, x, z) + D.depth;
          return {
            m: { l: level, x, z, r: D.tunnelRadius, d: D.depth, u: 1 },
            plan: { kind: "roof", level, x, z, floorY: newCeil, hit: roofPt },
          };
        }
      }
    }
    return null;
  };
  const digAtAim = () => {
    const planned = planDig();
    if (!planned) return;
    const { m, plan } = planned;
    sound.dig(plan.kind);
    digMark.burst(plan.hit, plan.kind === "pit" ? 12 : 22);
    figure.swing();
    applyDig(m);
    myDigs.push(m);
    if (myDigs.length > 600) myDigs.shift();
    net.sendDig(m);
  };
  // ── Torches run out: only MY placed torches tick down (a peer's own
  // client owns their countdown and tells me when one goes out via
  // sendMyTorches/onTorches); world/shrine torches (`placed: false`) are
  // never in this list at all, so they're untouched no matter how long the
  // game runs. `reach` already feeds straight into the light radius pushed
  // to the pipeline each frame, so shrinking it in the last quarter of life
  // reads as a dimming torch for free — no new shader/uniform needed. ────
  const TORCH_DIM_FRAC = 0.25;
  const tickTorches = (dt: number) => {
    const mine = chunks.props.placedTorches().filter((t) => t.id.startsWith(net.selfId));
    let expired = false;
    for (const t of mine) {
      t.life -= dt;
      if (t.life <= 0) {
        chunks.props.removeTorch(t.id);
        expired = true;
        continue;
      }
      const frac = t.life / t.maxLife;
      t.reach = frac < TORCH_DIM_FRAC ? TORCH_REACH * Math.max(0.12, frac / TORCH_DIM_FRAC) : TORCH_REACH;
    }
    // Don't wait for the periodic 4 s broadcast — an onlooker should see a
    // torch go dark promptly, not up to 4 s late.
    if (expired) sendMyTorches();
  };
  // ── Two-torch vault doors: two placed torches near a vault's door
  // pillars swing it open — the same digTo the pick uses on any wall, so it
  // replicates for free (myDigs / net.sendDig) and late joiners see it via
  // the existing dig replay on join. ───────────────────────────────────
  const checkVaultDoors = () => {
    const torches = chunks.props.placedTorches();
    if (torches.length < 2) return;
    const R = CFG.world.vaultTorchRange;
    const near = (px: number, pz: number) => torches.some((t) => Math.hypot(t.position.x - px, t.position.z - pz) <= R);
    for (const door of chunks.props.vaultDoors.values()) {
      const open = terrain.floorAt(door.x, door.z) < terrain.floor(door.x, door.z) - 0.4;
      if (open) continue;
      if (!near(door.pillarA.x, door.pillarA.z) || !near(door.pillarB.x, door.pillarB.z)) continue;
      const m: DigMsg = { l: 2, x: door.x, z: door.z, r: door.radius, d: 0, t: terrain.floorOpen(door.x, door.z) };
      applyDig(m);
      myDigs.push(m);
      if (myDigs.length > 600) myDigs.shift();
      net.sendDig(m);
      sound.knock(6);
    }
  };
  // ── Picking up players (Gang Beasts rules) ──────────────────────────
  let carrying: string | null = null;
  let carriedBy: string | null = null;
  let carriedSince = 0;
  let targetPlayer: string | null = null;
  const holdPoint = new THREE.Vector3();
  net.onGrabbed = (carrier) => {
    carriedBy = carrier;
    carriedSince = performance.now();
    player.carriedAt = player.position.clone();
    figure.flail = true;
    if (grab.held) grab.grabOrDrop(player.velocity); // drop whatever I held
    chat.toast(`${net.peers.get(carrier)?.state.n ?? "someone"} picked you up`);
  };
  net.onThrown = (v) => {
    carriedBy = null;
    figure.flail = false;
    player.launch(v[0], v[1], v[2]);
    sound.land(-6);
  };
  let torchSeq = 0;
  const sendMyTorches = () => {
    const mine = chunks.props.placedTorches().filter((t) => t.id.startsWith(net.selfId));
    net.sendTorches(mine.map((t) => ({ id: t.id, p: [t.mesh.position.x, t.mesh.position.y, t.mesh.position.z] })));
  };
  net.onTorches = (list, peerId) => {
    // Reconcile, don't just add: a torch that burned out on the sender's
    // side is missing from this list, and must go out here too, or every
    // expired torch would sit lit forever on other players' screens.
    const ids = new Set(list.map((t) => t.id));
    for (const t of chunks.props.placedTorches()) {
      if (t.id.startsWith(peerId) && !ids.has(t.id)) chunks.props.removeTorch(t.id);
    }
    for (const t of list) chunks.props.addTorch(t.id, t.p[0], t.p[1], t.p[2], true);
  };
  let relics = 0;
  net.onCollect = (k) => { chunks.props.removeById(k); };
  const grab = new Grab(p, ph, chunks.props, terrain);
  const digMark = new DigMark(p, terrain);
  let propSendT = 0;
  let propSnapT = 0;
  let torchSendT = 0;

  // ── Held torch (H): a real, deliberate light source distinct from the
  // passive personal glow every player always has — see CFG.night.heldTorchReach.
  // One mesh, reused for the whole session; toggled visible/invisible and
  // repositioned every frame rather than added/removed from the scene. ────
  let torchOut = false;
  const heldTorch = chunks.props.makeHeldTorch();
  heldTorch.visible = false;
  p.scene.add(heldTorch);

  net.setSource(() => ({
    p: [player.position.x, player.position.y, player.position.z],
    f: figure.group.rotation.y,
    t: [torchPos.x, torchPos.y, torchPos.z],
    c: customFigure ? "golem-cairn" : figure.character,
    i: figure.colorway,
    s: lastSpeed,
    n: net.name,
    b: chat.outgoing(),
    h: carrying ? [holdPoint.x, holdPoint.y, holdPoint.z] : null,
    g: carrying,
    ho: !!grab.held,
  }));

  const photo = new PhotoMode(p, ph, canvas, figure, () => input.requestLock());
  const chat = new Chat(p.camera, canvas);
  const touch = new TouchControls(input, canvas);
  if (touch.enabled) {
    // Phones aim with the crosshair at screen centre; there is no cursor.
    hint.querySelector<HTMLElement>(".kb")!.hidden = true;
    hint.querySelector<HTMLElement>(".tc")!.hidden = false;
    hint.firstChild!.textContent = "tap to enter";
  }
  const map = new PaperMap(p.inkMap);
  const spawnRelic = () => {
    const x = player.position.x + fwd.x * 2.2, z = player.position.z + fwd.z * 2.2;
    const level = terrain.levelOf(player.position.x, player.position.z, player.position.y);
    chunks.props.spawnRelicAt(x, z, level);
  };
  // ── Hop between biomes (B / tune panel button) ──────────────────────
  // Biomes are a spatial noise field, not a per-player toggle, so "switch
  // biome" means finding the nearest point that's actually IN a different
  // biome and teleporting there — cycling forward through BIOMES in index
  // order each press so repeated presses tour all of them in sequence,
  // rather than always landing on the same nearest neighbour.
  const findBiomePoint = (cx: number, cz: number, targetId: number, maxRadius: number): { x: number; z: number } | null => {
    const ringStep = 5;
    for (let r = ringStep; r <= maxRadius; r += ringStep) {
      const samples = Math.max(8, Math.round((2 * Math.PI * r) / ringStep));
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (terrain.biomeId(x, z) === targetId) return { x, z };
      }
    }
    return null;
  };
  const hopBiome = () => {
    const startId = terrain.biomeId(player.position.x, player.position.z);
    const maxRadius = CFG.world.biomeHopRadius;
    for (let step = 1; step < BIOMES.length; step++) {
      const targetId = (startId + step) % BIOMES.length;
      const hit = findBiomePoint(player.position.x, player.position.z, targetId, maxRadius);
      if (!hit) continue;
      const level = terrain.levelOf(player.position.x, player.position.z, player.position.y);
      player.teleport(new THREE.Vector3(hit.x, terrain.levelAt(level, hit.x, hit.z) + 0.5, hit.z));
      chat.toast(`hopped to ${BIOMES[targetId]!.name}`);
      return;
    }
    chat.toast("no other biome found nearby");
  };
  const tune = new Tune({
    onRender: () => applyConfig(p),
    onRebuild: () => {
      chunks.rebuildAll(player.position);
      applyConfig(p);
      const lv = terrain.levelOf(player.position.x, player.position.z, player.position.y);
      player.teleport(new THREE.Vector3(player.position.x, terrain.levelAt(lv, player.position.x, player.position.z) + 0.5, player.position.z));
    },
    onSpawnRelic: spawnRelic,
    onHopBiome: hopBiome,
  }, input);

  // Drop an .stl on the window to wear it (local; peers see your last character).
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file || !/\.stl$/i.test(file.name)) return;
    void file.arrayBuffer().then((buf) => {
      figure.loadCustom(buf, 1.7);
      customFigure = true;
    });
  });

  const dismiss = () => {
    hint.classList.add("hidden");
    sound.start();
    if (!photo.active && !tune.open) input.requestLock();
  };
  canvas.addEventListener("click", dismiss);
  hint.addEventListener("click", dismiss);
  (document.getElementById("tuneBtn") as HTMLButtonElement).addEventListener("click", (e) => {
    e.stopPropagation();
    tune.toggle();
    if (tune.open) document.exitPointerLock?.();
  });

  // The crosshair IS the cursor: it follows the mouse in free-look mode and
  // sits at the centre under pointer lock. Aim rays go through it.
  const mouseNdc = new THREE.Vector2(0, 0);
  window.addEventListener("mousemove", (e) => {
    if (input.locked || touch.enabled) return;
    // Relative to the canvas's own box, not the window — normally the same
    // thing, but split view (screen-share docked alongside the game) can
    // leave the canvas narrower than the window, and the aim ray has to
    // follow the actual rendered view, not the whole browser tab.
    const rect = canvas.getBoundingClientRect();
    mouseNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    aimEl.style.left = `${e.clientX}px`;
    aimEl.style.top = `${e.clientY}px`;
  });
  document.addEventListener("pointerlockchange", () => {
    if (input.locked) {
      mouseNdc.set(0, 0);
      aimEl.style.left = "50%";
      aimEl.style.top = "50%";
    }
  });

  const wish = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const throwDir = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let lastSpeed = 0;
  const tmp = new THREE.Vector3();
  const remotePrev = new THREE.Vector3();
  const marchPt = new THREE.Vector3();
  const paperColor = new THREE.Color(PAPER);
  const nightInk = new THREE.Color(INK_BLACK);
  const nightBg = new THREE.Color();
  const peerPositions = new Map<string, { x: number; y: number; z: number }>();
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let frames = 0;
  let fps = 0;
  let mapT = 0;
  // A jump press is latched until a physics step consumes it — frames that
  // don't step (dt just under 1/60) used to swallow it.
  let jumpQueued = false;
  const STEP = 1 / 60;

  // ── The hard-landing feedback (brief 9) as a reusable helper: a camera
  // thump, an ink-chip puff at the player's feet (the same chip system a dig
  // throws), and a brief no-input stumble. `k` is 0..1, how far past
  // whatever threshold the triggering speed got (12 m/s of headroom, same
  // curve the landing code always used). Brief 19 retriggers this from two
  // more causes — a thrown prop or a thrown/fast player passing close by —
  // nothing new about the feedback itself, just new callers. ─────────────
  const applyImpact = (k: number): void => {
    const P = CFG.player;
    cam.thump(P.landThumpMag * (0.4 + 0.6 * k));
    digMark.burst(tmp.copy(player.position).setY(player.position.y + 0.05), Math.round(P.landChipCount * (0.5 + 0.5 * k)));
    player.stumbleT = P.landStumbleDur * (0.6 + 0.4 * k);
  };

  // ── Getting struck by a thrown prop (brief 19): `Prop.lastV`/`onKnock`
  // already tracks per-frame velocity for the knock SOUND; this checks the
  // body's live speed directly against a nearby, awake, un-held dynamic prop
  // — held props are kinematic with no real velocity, so no extra guard is
  // needed there beyond skipping `heldIds` for clarity. Scaled the same way
  // a hard landing scales by how far past its threshold the fall got. ─────
  const checkPropImpacts = (): void => {
    const R2 = CFG.player.impactRadius * CFG.player.impactRadius;
    for (const prop of chunks.props.dynamicProps()) {
      if (chunks.props.heldIds.has(prop.id)) continue;
      const v = prop.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed <= CFG.player.impactPropSpeed) continue;
      const t = prop.body.translation();
      const dx = t.x - player.position.x, dy = t.y - player.position.y, dz = t.z - player.position.z;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      applyImpact(Math.min(1, (speed - CFG.player.impactPropSpeed) / 12));
    }
  };

  const switchCharacter = (dir: number) => {
    charIndex = (charIndex + dir + cast.length) % cast.length;
    const id = cast[charIndex]!.id;
    localStorage.setItem("relic-world:character", id);
    customFigure = false;
    void figure.load(id, 1.7);
  };

  /** Where the aim ray meets the world (or null), for digging / torches. */
  const aimPoint = (max: number): THREE.Vector3 | null => {
    const hit = rayHit(ph, p.camera.position, aimDir, max + 8, player.body);
    if (!hit) return null;
    const pt = tmp.copy(p.camera.position).addScaledVector(aimDir, hit.toi);
    return pt.distanceTo(chest) <= max ? pt.clone() : null;
  };

  const frame = (now: number) => {
    // Clamped both ways: a tab coming back from the background gets one 100 ms
    // step, and a clock that went backwards (the debug pump) can't stall the
    // fixed-step accumulator for seconds.
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    resizePipeline(p, canvas.clientWidth, canvas.clientHeight);
    if (shared && sharedSeed() !== seed) {
      location.reload();
      return false;
    }

    // ── Keys ─────────────────────────────────────────────────────────
    if (input.once("Enter") && !photo.active) {
      chat.toggle();
      input.setCaptured(chat.open);
    }
    if (chat.open !== input.captured) input.setCaptured(chat.open);
    if (input.once("Backquote") && !chat.open) {
      tune.toggle();
      if (tune.open) document.exitPointerLock?.();
      else input.requestLock();
    }
    if (input.once("KeyL") && !chat.open) {
      input.lookMode = input.lookMode === "free" ? "locked" : "free";
      if (input.lookMode === "locked") input.requestLock();
      else document.exitPointerLock?.();
    }
    if (input.once("Tab") && !chat.open) map.toggle();
    if (input.once("KeyP") && !chat.open) {
      if (photo.active) photo.exit();
      else photo.enter(cam.yaw, cam.pitch, 4.5);
      input.wheelLooks = !photo.active;
      hint.classList.toggle("hidden", input.locked || photo.active);
      hud.hidden = photo.active;
      aimEl.hidden = photo.active;
    }
    cam.forward(fwd);
    cam.right(rgt);
    chest.set(player.position.x, player.position.y + 1.2, player.position.z);
    // Aim ray through the crosshair; throws get a little lift.
    raycaster.setFromCamera(mouseNdc, p.camera);
    aimDir.copy(raycaster.ray.direction);
    throwDir.copy(aimDir).add(tmp.set(0, 0.25, 0)).normalize();

    if (!photo.active) {
      const look = input.takeLook();
      const arrows = input.arrowLook(dt);
      cam.look(look.x + arrows.x, look.y + arrows.y);
      if (input.once("KeyV")) {
        cam.firstPerson = !cam.firstPerson;
        figure.setVisible(!cam.firstPerson);
      }
      if (input.once("KeyC")) switchCharacter(input.down.has("ShiftLeft") || input.down.has("ShiftRight") ? -1 : 1);
      let inkChanged = false;
      if (input.once("KeyQ")) { figure.setColorway(figure.colorway - 1); inkChanged = true; }
      if (input.once("KeyE")) { figure.setColorway(figure.colorway + 1); inkChanged = true; }
      if (inkChanged) localStorage.setItem("relic-world:ink", String(figure.colorway));
      if (input.once("KeyR")) {
        url.searchParams.set("seed", String(Math.floor(Math.random() * 9973) + 1));
        location.href = url.toString();
      }
      if (input.once("KeyT")) player.teleport(terrain.spawnPoint());
      if (input.once("KeyG")) spawnRelic();
      if (input.once("KeyB")) hopBiome();
      const pressedF = input.once("KeyF");
      if (pressedF && carrying) {
        // Set them down gently.
        net.sendThrowPlayer(carrying, [player.velocity.x, 0.5, player.velocity.z]);
        carrying = null;
      } else if (pressedF && !grab.held && targetPlayer && !carriedBy) {
        carrying = targetPlayer;
        net.sendGrabPlayer(carrying);
        sound.mantle();
      } else if (pressedF) {
        const wasHeld = grab.held;
        // Dropping a relic on the spawn pad collects it.
        if (wasHeld && wasHeld.id.endsWith(":r") && Math.hypot(player.position.x, player.position.z) < 5) {
          grab.grabOrDrop(player.velocity);
          chunks.props.removeById(wasHeld.id);
          net.sendCollect(wasHeld.id);
          relics++;
          sound.blip();
        } else {
          grab.grabOrDrop(player.velocity);
        }
      }
      if (input.once("KeyH")) torchOut = !torchOut;
      if (input.once("KeyX")) {
        const mine = chunks.props.placedTorches().filter((t) => t.id.startsWith(net.selfId));
        if (mine.length >= MAX_PLACED_TORCHES) chunks.props.removeTorch(mine[0]!.id);
        const x = player.position.x + fwd.x * 1.2, z = player.position.z + fwd.z * 1.2;
        const d = rayDistance(ph, { x, y: player.position.y + 1.5, z }, { x: 0, y: -1, z: 0 }, 4, player.body);
        const y = d != null ? player.position.y + 1.5 - d : player.position.y;
        chunks.props.addTorch(`${net.selfId}:${torchSeq++}`, x, y, z, true);
        sound.knock(4);
        sendMyTorches();
      }
      if (input.once("Mouse0")) {
        if (carrying) {
          const v = throwDir.clone().multiplyScalar(11).add(player.velocity);
          net.sendThrowPlayer(carrying, [v.x, v.y, v.z]);
          carrying = null;
          sound.jump();
        } else if (grab.held) {
          grab.throw(throwDir, player.velocity);
        } else {
          digAtAim();
          digT = 0;
        }
      } else if (input.leftDown && !grab.held && !carrying && !carriedBy) {
        digT += dt;
        if (digT >= 1 / CFG.dig.rate) {
          digT = 0;
          digAtAim();
        }
      }
    } else {
      input.takeLook();
    }

    // ── Carried? ride the carrier's hands; released if they vanish ────
    if (carriedBy) {
      const st = net.peers.get(carriedBy)?.state;
      if (st?.h && st.g === net.selfId) {
        player.carriedAt!.set(st.h[0], st.h[1], st.h[2]);
        carriedSince = performance.now();
      } else if (performance.now() - carriedSince > 2500) {
        carriedBy = null;
        figure.flail = false;
        player.launch(0, 0, 0);
      }
    }
    if (carrying && !net.peers.has(carrying)) carrying = null;

    // ── Simulation ───────────────────────────────────────────────────
    const axes = input.axes();
    wish.set(0, 0, 0).addScaledVector(fwd, axes.z).addScaledVector(rgt, axes.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const run = input.down.has("ShiftLeft") || input.down.has("ShiftRight");
    if (input.once("Space")) {
      jumpQueued = true;
      if (player.grounded && !photo.active) sound.jump();
    }
    if (!photo.active) {
      acc += dt;
      while (acc >= STEP) {
        const wasGrounded = player.grounded;
        const vyBefore = player.velocity.y;
        player.step(STEP, wish, run, jumpQueued);
        jumpQueued = false;
        grab.step(chest.set(player.position.x, player.position.y + 1.2, player.position.z), fwd);
        ph.world.step();
        player.afterStep();
        acc -= STEP;
        if (player.justMantled) sound.mantle();
        if (!wasGrounded && player.grounded && vyBefore < -3) {
          sound.land(vyBefore);
          // Hard landing: a 30 m drop into a Cathedral vault is intended, but
          // it should land with weight — see applyImpact. Scaled by how far
          // past the "hard" threshold the fall speed got, so a small hop off
          // a ledge stays silent.
          if (-vyBefore > CFG.player.landHardSpeed) applyImpact(Math.min(1, (-vyBefore - CFG.player.landHardSpeed) / 12));
        }
      }
      // Physics escape: if the player ever ends up below every level's floor
      // here (a fall through the world), teleport up to the nearest one
      // rather than leaving them stuck under the terrain forever. Cheap
      // analytic field reads, so just done every frame.
      {
        const px = player.position.x, pz = player.position.z, py = player.position.y;
        let lowest = Math.min(terrain.surfaceAt(px, pz), terrain.floorAt(px, pz));
        if (terrain.gallery(px, pz) > 0.5) lowest = Math.min(lowest, terrain.floor2At(px, pz));
        if (py < lowest - CFG.player.groundEscapeMargin) {
          const g = terrain.groundAt(px, pz, py);
          player.teleport(new THREE.Vector3(px, g + 0.5, pz));
        }
      }
    }
    if (input.once("KeyM")) sound.toggleMute();

    chunks.update(player.position);
    chunks.props.update();
    tickTorches(dt);
    checkVaultDoors();
    checkPropImpacts();
    propSendT += dt;
    propSnapT += dt;
    torchSendT += dt;
    if (propSnapT >= 3) {
      propSnapT = 0;
      propSendT = 0;
      net.sendProps(chunks.props.collectOwned(isOwner, true));
    } else if (propSendT >= 0.1) {
      propSendT = 0;
      net.sendProps(chunks.props.collectOwned(isOwner, false));
    }
    if (torchSendT >= 4) {
      torchSendT = 0;
      sendMyTorches();
    }
    const speed = photo.active ? 0 : Math.hypot(player.velocity.x, player.velocity.z);
    figure.reaching = !!grab.held || !!carrying;
    figure.update(player.position, wish, speed, photo.active ? 0 : dt);
    if (photo.active) photo.update(player.position, player.body);
    else cam.update(player.position, dt, player.body);

    grab.holdFrom.copy(chest);
    grab.aim(p.camera.position, aimDir, player.body);
    grab.render(chest, throwDir, player.velocity);
    holdPoint.copy(chest).addScaledVector(fwd, 1.3);
    holdPoint.y += 0.3;
    // Held torch (H): out to one side and slightly forward, like carried in
    // a hand — not dead ahead, so it never blocks the aim/dig crosshair.
    heldTorch.visible = torchOut && !photo.active;
    if (heldTorch.visible) {
      heldTorch.position.copy(chest).addScaledVector(rgt, 0.45).addScaledVector(fwd, 0.25);
      heldTorch.position.y -= 0.15;
      heldTorch.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0.05);
    }
    // A player under the cursor, within reach, is grabbable too.
    targetPlayer = null;
    if (!grab.held && !carrying) {
      let best = 0.9;
      for (const [id, r] of remotes) {
        const toP = tmp.set(r.pos.x, r.pos.y + 0.9, r.pos.z).sub(p.camera.position);
        const along = toP.dot(aimDir);
        if (along < 0) continue;
        const perp = Math.sqrt(Math.max(0, toP.lengthSq() - along * along));
        if (perp < best && r.pos.distanceTo(chest) <= PLAYER_REACH) { best = perp; targetPlayer = id; }
      }
    }
    grab.showPlayerTarget(targetPlayer ? remotes.get(targetPlayer)!.figure.hull : null);
    aimEl.classList.toggle("hot", !!grab.target || !!targetPlayer);
    aimEl.classList.toggle("hold", !!grab.held || !!carrying);
    // With empty hands and nothing grabbable under the cursor, show what a click cuts.
    const canDig = !grab.held && !grab.target && !carrying && !carriedBy && !targetPlayer && !photo.active;
    digMark.show(canDig ? planDig()?.plan ?? null : null);
    digMark.update(dt);

    // ── Night mode (brief 20): 0 = day (today's rendering, byte-for-byte);
    // 1 = night — only a torch actually burning THIS frame keeps a spot
    // printed, the permanent ink-map history alone no longer counts.
    // "auto" derives the phase from the session clock (p.time, already
    // accumulated for uTime); the phase-lock buttons in the tune panel
    // freeze it so a look can be tuned against exactly one phase without
    // waiting for the cycle. nightIntensity is a safety valve: 0 disables
    // the darkening entirely regardless of phase. Computed here (before the
    // torches below) because a player's own passive light also needs it. ──
    const N = CFG.night;
    let nightAmt: number;
    if (N.timePhase === "day") nightAmt = 0;
    else if (N.timePhase === "dusk") nightAmt = 0.5;
    else if (N.timePhase === "night") nightAmt = 1;
    else {
      const cyc = Math.max(1, N.dayNightCycleSec);
      const t = (p.time % cyc) / cyc;
      // Smooth day→night→day: one cosine lobe over the cycle, 0 at t=0
      // (noon) rising to 1 at t=0.5 (midnight) and back — no hard cut.
      nightAmt = (1 - Math.cos(t * Math.PI * 2)) * 0.5;
    }
    nightAmt *= N.nightIntensity;

    // ── Torches: mine rides upper-left of the lens; then peers; then the
    // nearest standing torches, up to the shader's cap ──────────────────
    torchPos.copy(rgt).multiplyScalar(-3.5).addScaledVector(fwd, -1);
    torchPos.add(p.camera.position);
    torchPos.y += 2.2;
    const reachBonus = Math.min(12, relics * 1.5);
    p.torches.length = 0;
    // A player's OWN passive/carried light — big by day for comfortable
    // visibility (up to ~46 m with relics), but that same bubble used to
    // swallow night mode entirely: it's always-on and bigger than most
    // rooms, so nothing near a player ever looked dark. At night it shrinks
    // toward `nightPersonalReach` (0 by default — no passive light at all)
    // — actual darkness now depends on a held/placed torch, a peer's torch,
    // or a world brazier, none of which shrink (their own fixed `reach`).
    // The light shader's falloff treats an EXACT 0 reach as "no falloff,
    // fully lit" (a convenience for other callers, not a real light), so a
    // literal 0 here would make night the OPPOSITE of dark — clamp to a
    // small epsilon that's visually indistinguishable from off but never
    // trips that special case.
    const glowReach = Math.max(0.05, N.nightPersonalReach);
    const personalReach = THREE.MathUtils.lerp(CFG.light.localReach + reachBonus, glowReach, nightAmt);
    p.torches.push({ position: torchPos, reach: personalReach });
    // A held torch (H) is a real light like any placed one: fixed reach,
    // untouched by the night shrink above.
    if (torchOut && !photo.active) p.torches.push({ position: heldTorch.position, reach: N.heldTorchReach });
    const fresh = p.inkMap.stamp(player.position.x, player.position.z, CFG.light.inkStamp + reachBonus * 0.6);
    sound.print(fresh, dt);

    const k = 1 - Math.exp(-dt * 10);
    peerPositions.clear();
    // A remote currently being carried (by me, or — per their own broadcast
    // `g`, who THEY'RE carrying — by anyone) has its position snap toward a
    // hand each frame; that snap must never itself read as a "thrown player"
    // impact, only real free flight after release does.
    const heldRemoteIds = new Set<string>();
    if (carrying) heldRemoteIds.add(carrying);
    for (const peer of net.peers.values()) if (peer.state.g) heldRemoteIds.add(peer.state.g);
    // Chest height, not feet — the stand-in "can I actually see that torch"
    // point for the line-of-sight checks below.
    const eye = { x: player.position.x, y: player.position.y + 1.2, z: player.position.z };
    for (const [id, r] of remotes) {
      const st = net.peers.get(id)?.state;
      if (!st) continue;
      remotePrev.copy(r.pos);
      r.pos.lerp(tmp.set(st.p[0], st.p[1], st.p[2]), k);
      r.torch.lerp(tmp.set(st.t[0], st.t[1], st.t[2]), k);
      let d = st.f - r.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.facing += d * k;
      r.speed = st.s;
      // Getting struck by a thrown/flung player (brief 19): a per-frame
      // velocity derived purely from the position delta already tracked
      // above, no new net field. Runs identically on every client — if A
      // gets thrown into B, B's own client sees A's derived speed here.
      if (!heldRemoteIds.has(id) && dt > 0) {
        const remoteSpeed = remotePrev.distanceTo(r.pos) / dt;
        if (remoteSpeed > CFG.player.impactPlayerSpeed && r.pos.distanceTo(player.position) < CFG.player.impactRadius) {
          applyImpact(Math.min(1, (remoteSpeed - CFG.player.impactPlayerSpeed) / 12));
        }
      }
      if (carrying === id) r.pos.copy(holdPoint).setY(holdPoint.y - 0.6);
      r.figure.flail = carrying === id || (st.g == null && !!st.h) || false;
      r.figure.reaching = !!st.g || !!st.ho;
      r.figure.place(r.pos, r.facing);
      const wantChar = normaliseCharacter(st.c);
      if (r.figure.character !== wantChar && r.loading !== wantChar) {
        r.loading = wantChar;
        void r.figure.load(wantChar, 1.7).then(() => { r.loading = null; });
      }
      if ((st.b ?? "") && !r.talking) sound.blip();
      r.talking = !!(st.b ?? "");
      if (r.figure.colorway !== st.i) r.figure.setColorway(st.i);
      // A torch's light is a pure distance falloff with no occlusion of its
      // own — without a real line-of-sight check, a peer's torch on the far
      // side of solid rock (a different level, buried behind a wall) would
      // still light your side of it, as long as you were nominally in reach.
      // `eye` (chest height, not feet) is the viewer's own stand-in position.
      if (hasLineOfSight(ph, r.torch, eye, player.body)) {
        p.torches.push({ position: r.torch, reach: THREE.MathUtils.lerp(CFG.light.remoteReach, glowReach, nightAmt) });
        p.inkMap.stamp(r.pos.x, r.pos.z, CFG.light.inkStamp * 0.7);
      }
      peerPositions.set(id, r.pos);
    }
    // Standing torches: nearest first; each prints the rock around it. Only
    // ones with real line of sight to the player count — same reasoning as
    // the remote-torch check above (see hasLineOfSight in physics/world.ts).
    const standing: Torch[] = [];
    for (const t of chunks.props.torches.values()) standing.push({ position: t.position, reach: t.reach });
    standing.sort((a, b) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position));
    for (const t of standing) {
      if (p.torches.length >= MAX_LIGHTS) break;
      if (!hasLineOfSight(ph, t.position, eye, player.body)) continue;
      p.torches.push(t);
      p.inkMap.stamp(t.position.x, t.position.z, TORCH_REACH * 0.8);
    }
    // ── The wandering presence: one client (the lexicographically-smallest
    // id among self + connected peers, same tie-break spirit as `isOwner`'s
    // nearest-player rule for props) simulates wander/flee against this
    // frame's already-built light list; everyone else just eases toward the
    // broadcast position — the "nearest player simulates, everyone else
    // follows" model `Props` already uses, for one shared entity instead of
    // many positioned ones. ────────────────────────────────────────────
    if (presence) {
      if (isPresenceOwner()) {
        presence.simulate(dt, p.torches);
        presenceSendT += dt;
        if (presenceSendT >= (presence.fleeing ? 0.6 : 4)) {
          presenceSendT = 0;
          net.sendPresence({ p: [presence.position.x, presence.position.y, presence.position.z], f: presence.fleeing ? 1 : 0 });
        }
      } else if (presenceTarget) {
        presence.applyRemote(presenceTarget, k);
      }
      presence.render(p.torches);
      if (!presence.group.visible) {
        presenceSoundT -= dt;
        if (presenceSoundT <= 0 && presence.position.distanceTo(player.position) < CFG.presence.hearRadius) {
          sound.presence();
          presenceSoundT = 6 + Math.random() * 8;
        }
      }
    }
    voice.update(player.position, peerPositions);
    lastSpeed = speed;

    setNight(p, nightAmt);

    // The surface is the unprinted page: paper sky up top, ink black below.
    // Judged against the undug surface, so a pit you are digging is still daylit.
    // The sky itself dusk-tones with the same night amount as the ground's
    // bare-paper look (shaders.ts) — still flat bare paper, just a darker
    // sheet of it; no skyline, no gradient.
    const onSurface = player.position.y > terrain.surface(player.position.x, player.position.z) - 6;
    // Same bug as the rock's own "unprinted" fallback, same fix: a straight
    // dim (at most 40%) of bright paper is still bright paper, never
    // actually dark. Fades toward ink-black instead — all the way (not
    // capped at 92% like the rock's paper) so the sky reads strictly
    // darker than nearby ground at night, not the same flat tone as
    // whatever's around you; the sky has no pencil under-drawing to
    // preserve a sliver of contrast for, unlike the rock.
    if (onSurface) (p.scene.background as THREE.Color).copy(nightBg.copy(paperColor).lerp(nightInk, nightAmt));
    else (p.scene.background as THREE.Color).setHex(INK_BLACK);
    // Deeper is stranger: 0 at/above the surface, 1 by ~40 m below it.
    const depthBelow = terrain.surface(player.position.x, player.position.z) - player.position.y;
    setDepth(p, Math.min(1, Math.max(0, depthBelow / 40)));
    renderFrame(p, dt);
    const heads: Array<{ id: string; head: THREE.Vector3; text: string }> = [];
    if (!cam.firstPerson) heads.push({ id: "me", head: tmp.set(player.position.x, player.position.y + figure.height + 0.35, player.position.z).clone(), text: chat.outgoing() });
    for (const [id, r] of remotes) {
      const st = net.peers.get(id)?.state;
      heads.push({ id, head: r.pos.clone().setY(r.pos.y + r.figure.height + 0.35), text: st?.b ?? "" });
    }
    chat.render(heads);
    mapT += dt;
    if (map.open && mapT >= 0.1) {
      mapT = 0;
      const doors = [...chunks.props.vaultDoors.values()].map((d) => ({
        x: d.x, z: d.z, open: terrain.floorAt(d.x, d.z) < terrain.floor(d.x, d.z) - 0.4,
      }));
      map.draw({ x: player.position.x, z: player.position.z, yaw: cam.yaw }, [...remotes.values()].map((r) => ({ x: r.pos.x, z: r.pos.z })), doors);
    }
    input.endFrame();

    // ── HUD ──────────────────────────────────────────────────────────
    const showStamina = player.stamina < 99.5 || player.climbing;
    stamina.classList.toggle("show", showStamina);
    staminaBar.style.width = `${player.stamina}%`;
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
      const pos = player.position;
      const biome = terrain.biome(pos.x, pos.z).name;
      const lv = terrain.levelOf(pos.x, pos.z, pos.y);
      const level = lv === 0 ? "surface" : lv === 1 ? "upper gallery" : "lower cave";
      const peerNames = [...net.peers.values()].map((pe) => `<span class="peer">${pe.state.n}</span>`).join(" · ");
      const roll = msUntilRoll();
      const rollText = solo ? " · single player" : shared ? ` · world rolls in ${Math.floor(roll / 3600000)}h ${String(Math.floor((roll % 3600000) / 60000)).padStart(2, "0")}m` : " · private world";
      const state = player.wallClimb ? "climbing" : player.mantle ? "mantling" : player.grounded ? "ground" : "air";
      hud.innerHTML =
        `<b>Relic World</b> seed ${seed}${rollText} · ${fps} fps · ${biome} · ${level}<br>` +
        `you are <span class="peer">${net.name}</span> as ${customFigure ? "your STL" : cast[charIndex]!.name} in ${COLORWAYS[figure.colorway]!.name}` +
        (net.count ? ` · with ${peerNames}` : " · alone so far (share the URL)") + `<br>` +
        `x ${pos.x.toFixed(0)} z ${pos.z.toFixed(0)} · ${state} · ${cam.firstPerson ? "1st" : "3rd"} person · ${input.lookMode === "locked" ? "mouse locked" : "right-drag looks"} · inked ${(p.inkMap.coverage() * 100).toFixed(1)}% · relics ${relics}${reachBonus ? ` (+${reachBonus.toFixed(1)} m torch)` : ""}` +
        (carriedBy ? ` · <b>carried by ${net.peers.get(carriedBy)?.state.n ?? "someone"}</b>` : carrying ? ` · <b>carrying ${net.peers.get(carrying)?.state.n ?? "someone"}</b> (click to throw, F to set down)` : grab.held ? " · <b>holding</b> (click to throw, F to drop)" : targetPlayer ? ` · <b>F</b> to pick up ${net.peers.get(targetPlayer)?.state.n ?? ""}` : grab.target ? " · <b>F</b> to grab" : " · <b>click / hold</b> digs");
    }
    return true;
  };
  const loop = (now: number) => {
    if (frame(now) !== false) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const pump = (n = 1, dtMs = 16.7) => {
    for (let i = 0; i < n; i++) frame(last + dtMs);
  };

  (window as unknown as { __world: unknown }).__world = {
    seed, shared, player, cam, terrain, chunks, pipeline: p, figure, net, remotes, photo, sound, isOwner, grab, tune, map, voice, input, cfg: CFG,
    presence, isPresenceOwner,
    quality, qualityPreset,
    pump, applyDig, digAtAim, spawnRelic, hopBiome,
    grabPlayer: (id: string) => { carrying = id; net.sendGrabPlayer(id); },
    throwPlayer: (v: [number, number, number]) => { if (carrying) { net.sendThrowPlayer(carrying, v); carrying = null; } },
    carried: () => carriedBy,
    setInk: (i: number) => figure.setColorway(i),
    setCharacter: (i: number) => { charIndex = i - 1; switchCharacter(1); },
    shot: () => canvas.toDataURL("image/jpeg", 0.8),
  };
}

boot().catch((err) => {
  console.error(err);
  hint.textContent = `failed to start: ${String(err)}`;
});
