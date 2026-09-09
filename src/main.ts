import * as THREE from "three";
import { createPipeline, renderFrame, resizePipeline, setWorldSeed } from "./render/pipeline";
import { COLORWAYS } from "./render/palette";
import { initPhysics, rayDistance } from "./physics/world";
import { Terrain } from "./world/terrain";
import { ChunkManager } from "./world/chunks";
import { Input } from "./player/input";
import { PlayerController } from "./player/controller";
import { PlayerCamera } from "./player/camera";
import { CHARACTERS, Figure, type CharacterId } from "./player/figure";
import { Net } from "./net/room";
import { PhotoMode } from "./ui/photo";
import { Chat } from "./ui/chat";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const stamina = document.getElementById("stamina") as HTMLDivElement;
const staminaBar = stamina.firstElementChild as HTMLElement;

const url = new URL(location.href);
const seed = Number(url.searchParams.get("seed") ?? 7) || 7;
const roomOverride = url.searchParams.get("room") ?? undefined;
// How far a torch prints the rock. The bare-paper edge sits at the reach; the
// tone fades from ~45% of it. Generous, so the unprinted world is a horizon,
// not a wall in your face.
const LOCAL_REACH = 34;
const REMOTE_REACH = 22;
const INK_STAMP = 26;

type Remote = {
  figure: Figure;
  pos: THREE.Vector3;
  facing: number;
  torch: THREE.Vector3;
  speed: number;
  loading: CharacterId | null;
};

async function boot(): Promise<void> {
  const p = createPipeline(canvas, 0.6);
  setWorldSeed(p, seed);
  const ph = await initPhysics();
  const terrain = new Terrain(seed);
  const chunks = new ChunkManager(p, ph, terrain, 2);
  const spawn = terrain.spawnPoint();
  chunks.buildAll(spawn);

  // Heightfield orientation self-check: cast down at a few points and compare
  // with the analytic floor. A transposed matrix shows up here as metres.
  {
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      const x = (Math.random() - 0.5) * 60;
      const z = (Math.random() - 0.5) * 60;
      const d = rayDistance(ph, { x, y: 40, z }, { x: 0, y: -1, z: 0 }, 80);
      if (d == null) continue;
      worst = Math.max(worst, Math.abs(40 - d - terrain.floor(x, z)));
    }
    console.info(`[relic-world] heightfield vs analytic floor: worst ${worst.toFixed(3)} m`);
    if (worst > 0.5) console.error("[relic-world] heightfield orientation mismatch");
  }

  const input = new Input(canvas);
  const player = new PlayerController(ph, spawn);
  const cam = new PlayerCamera(p.camera, ph);
  const figure = new Figure(p);
  let charIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === (localStorage.getItem("relic-world:character") ?? "bast")));
  await figure.load(CHARACTERS[charIndex]!.id, 1.7);
  figure.setColorway(Number(localStorage.getItem("relic-world:ink") ?? 0));

  const torchPos = new THREE.Vector3(0, 5, 0);
  const net = new Net(seed, roomOverride);
  const remotes = new Map<string, Remote>();
  net.onJoin = (id) => {
    const r: Remote = { figure: new Figure(p), pos: new THREE.Vector3(), facing: 0, torch: new THREE.Vector3(), speed: 0, loading: null };
    const st = net.peers.get(id)!.state;
    r.pos.set(...st.p);
    r.torch.set(...st.t);
    remotes.set(id, r);
  };
  net.onLeave = (id) => {
    remotes.get(id)?.figure.dispose();
    remotes.delete(id);
  };
  window.addEventListener("beforeunload", () => net.leave());
  // Read by the heartbeat timer, independent of the frame loop.
  net.setSource(() => ({
    p: [player.position.x, player.position.y, player.position.z],
    f: figure.group.rotation.y,
    t: [torchPos.x, torchPos.y, torchPos.z],
    c: figure.character,
    i: figure.colorway,
    s: lastSpeed,
    n: net.name,
    b: chat.outgoing(),
  }));

  const photo = new PhotoMode(p, ph, canvas, figure, () => input.requestLock());
  const chat = new Chat(p.camera, canvas);

  // The overlay goes on the first click regardless — some hosts (embedded
  // browsers, iframes) refuse pointer lock, and drag-to-look covers them.
  const dismiss = () => {
    hint.classList.add("hidden");
    if (!photo.active) input.requestLock();
  };
  canvas.addEventListener("click", dismiss);
  hint.addEventListener("click", dismiss);

  const wish = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  let lastSpeed = 0;
  const tmp = new THREE.Vector3();
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let frames = 0;
  let fps = 0;
  const STEP = 1 / 60;

  const switchCharacter = (dir: number) => {
    charIndex = (charIndex + dir + CHARACTERS.length) % CHARACTERS.length;
    const id = CHARACTERS[charIndex]!.id;
    localStorage.setItem("relic-world:character", id);
    void figure.load(id, 1.7);
  };

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    resizePipeline(p, canvas.clientWidth, canvas.clientHeight);

    // ── Keys ─────────────────────────────────────────────────────────
    if (input.once("Enter") && !photo.active) {
      chat.toggle();
      input.setCaptured(chat.open);
    }
    if (chat.open !== input.captured) input.setCaptured(chat.open); // Esc / blur closed it
    if (input.once("KeyP") && !chat.open) {
      if (photo.active) photo.exit();
      else photo.enter(cam.yaw, cam.pitch, 4.5);
      hint.classList.toggle("hidden", input.locked || photo.active);
      hud.hidden = photo.active;
    }
    if (!photo.active) {
      const look = input.takeLook();
      cam.look(look.x, look.y);
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
        url.searchParams.set("seed", String(Math.floor(Math.random() * 999) + 1));
        location.href = url.toString();
      }
      if (input.once("KeyT")) player.teleport(terrain.spawnPoint());
    } else {
      input.takeLook();
    }

    // ── Simulation ───────────────────────────────────────────────────
    const axes = input.axes();
    cam.forward(fwd);
    cam.right(rgt);
    wish.set(0, 0, 0).addScaledVector(fwd, axes.z).addScaledVector(rgt, axes.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const run = input.down.has("ShiftLeft") || input.down.has("ShiftRight");
    let jump = input.once("Space");
    if (!photo.active) {
      acc += dt;
      while (acc >= STEP) {
        player.step(STEP, wish, run, jump);
        jump = false;
        ph.world.step();
        player.afterStep();
        acc -= STEP;
      }
    }

    chunks.update(player.position);
    chunks.props.update();
    const speed = photo.active ? 0 : Math.hypot(player.velocity.x, player.velocity.z);
    figure.update(player.position, wish, speed, photo.active ? 0 : dt);
    if (photo.active) photo.update(player.position, player.body);
    else cam.update(player.position, dt, player.body);

    // ── Torches: mine rides upper-left of the lens; the rest are peers ──
    torchPos.copy(rgt).multiplyScalar(-3.5).addScaledVector(fwd, -1);
    torchPos.add(p.camera.position);
    torchPos.y += 2.2;
    p.torches.length = 0;
    p.torches.push({ position: torchPos, reach: LOCAL_REACH });
    p.inkMap.stamp(player.position.x, player.position.z, INK_STAMP);

    // ── Peers ────────────────────────────────────────────────────────
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, r] of remotes) {
      const st = net.peers.get(id)?.state;
      if (!st) continue;
      r.pos.lerp(tmp.set(st.p[0], st.p[1], st.p[2]), k);
      r.torch.lerp(tmp.set(st.t[0], st.t[1], st.t[2]), k);
      let d = st.f - r.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.facing += d * k;
      r.speed = st.s;
      r.figure.place(r.pos, r.facing);
      if (r.figure.character !== st.c && r.loading !== st.c) {
        r.loading = st.c;
        void r.figure.load(st.c, 1.7).then(() => { r.loading = null; });
      }
      if (r.figure.colorway !== st.i) r.figure.setColorway(st.i);
      if (p.torches.length < 4) p.torches.push({ position: r.torch, reach: REMOTE_REACH });
      p.inkMap.stamp(r.pos.x, r.pos.z, INK_STAMP * 0.7);
    }
    lastSpeed = speed;

    renderFrame(p, dt);
    // Speech bubbles: mine (unless first person) + every peer's.
    const heads: Array<{ id: string; head: THREE.Vector3; text: string }> = [];
    if (!cam.firstPerson) heads.push({ id: "me", head: tmp.set(player.position.x, player.position.y + figure.height + 0.35, player.position.z).clone(), text: chat.outgoing() });
    for (const [id, r] of remotes) {
      const st = net.peers.get(id)?.state;
      heads.push({ id, head: r.pos.clone().setY(r.pos.y + r.figure.height + 0.35), text: st?.b ?? "" });
    }
    chat.render(heads);
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
      const peerNames = [...net.peers.values()].map((pe) => `<span class="peer">${pe.state.n}</span>`).join(" · ");
      hud.innerHTML =
        `<b>Relic World</b> seed ${seed} · ${fps} fps · ${biome}<br>` +
        `you are <span class="peer">${net.name}</span> as ${CHARACTERS[charIndex]!.name} in ${COLORWAYS[figure.colorway]!.name}` +
        (net.count ? ` · with ${peerNames}` : " · alone so far (share the URL)") + `<br>` +
        `x ${pos.x.toFixed(0)} z ${pos.z.toFixed(0)} · ${player.climbing ? "climbing" : player.grounded ? "ground" : "air"} · ${cam.firstPerson ? "1st" : "3rd"} person · inked ${(p.inkMap.coverage() * 100).toFixed(1)}% · props ${chunks.props.count}`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Debug handle for harness verification.
  (window as unknown as { __world: unknown }).__world = {
    seed, player, cam, terrain, chunks, pipeline: p, figure, net, remotes, photo,
    setInk: (i: number) => figure.setColorway(i),
    setCharacter: (i: number) => { charIndex = i - 1; switchCharacter(1); },
    shot: () => canvas.toDataURL("image/jpeg", 0.8),
  };
}

boot().catch((err) => {
  console.error(err);
  hint.textContent = `failed to start: ${String(err)}`;
});
