import * as THREE from "three";
import { createPipeline, renderFrame, resizePipeline, setCaveColorway, setInkColorway } from "./render/pipeline";
import { COLORWAYS, ENVWAYS } from "./render/palette";
import { initPhysics, rayDistance } from "./physics/world";
import { Terrain } from "./world/terrain";
import { ChunkManager } from "./world/chunks";
import { Input } from "./player/input";
import { PlayerController } from "./player/controller";
import { PlayerCamera } from "./player/camera";
import { Figure } from "./player/figure";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const url = new URL(location.href);
const seed = Number(url.searchParams.get("seed") ?? 7) || 7;

async function boot(): Promise<void> {
  const p = createPipeline(canvas, 0.6);
  const ph = await initPhysics();
  const terrain = new Terrain(seed);
  const chunks = new ChunkManager(p, ph, terrain, 2);
  const spawn = terrain.spawnPoint();
  chunks.buildAll(spawn);
  p.ceilMat.uniforms.uSeed.value = seed;

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
  await figure.load("bast", 1.7);

  setInkColorway(p, COLORWAYS.findIndex((c) => c.name === "Riso Dungeon"));
  setCaveColorway(p, ENVWAYS.findIndex((e) => e.name === "Dungeon Cave"));

  canvas.addEventListener("click", () => input.requestLock());
  hint.addEventListener("click", () => input.requestLock());
  document.addEventListener("pointerlockchange", () => hint.classList.toggle("hidden", input.locked));

  const wish = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const torchOffset = new THREE.Vector3();
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let frames = 0;
  let fps = 0;
  const STEP = 1 / 60;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    resizePipeline(p, canvas.clientWidth, canvas.clientHeight);

    const look = input.takeLook();
    cam.look(look.x, look.y);
    if (input.once("KeyV")) {
      cam.firstPerson = !cam.firstPerson;
      figure.setVisible(!cam.firstPerson);
    }
    for (let i = 1; i <= 8; i++) if (input.once(`Digit${i}`)) setCaveColorway(p, i - 1);
    if (input.once("KeyQ")) setInkColorway(p, p.inkIndex - 1);
    if (input.once("KeyE")) setInkColorway(p, p.inkIndex + 1);
    if (input.once("KeyR")) {
      url.searchParams.set("seed", String(Math.floor(Math.random() * 999) + 1));
      location.href = url.toString();
    }
    if (input.once("KeyT")) player.teleport(terrain.spawnPoint());

    const axes = input.axes();
    cam.forward(fwd);
    cam.right(rgt);
    wish.set(0, 0, 0).addScaledVector(fwd, axes.z).addScaledVector(rgt, axes.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const run = input.down.has("ShiftLeft") || input.down.has("ShiftRight");
    const jump = input.once("Space");

    acc += dt;
    let jumped = jump;
    while (acc >= STEP) {
      player.step(STEP, wish, run, jumped);
      jumped = false;
      ph.world.step();
      player.afterStep();
      acc -= STEP;
    }

    chunks.update(player.position);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    figure.update(player.position, wish, speed, dt);
    cam.update(player.position, dt, player.body);
    // Carried torch: up and to the camera's left, a little ahead.
    torchOffset.copy(rgt).multiplyScalar(-1.8).addScaledVector(fwd, 1.2);
    p.torch.position.set(player.position.x + torchOffset.x, player.position.y + 3.2, player.position.z + torchOffset.z);

    renderFrame(p, dt);
    input.endFrame();

    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
      const pos = player.position;
      hud.innerHTML =
        `<b>Relic World</b> seed ${seed} · ${fps} fps · chunks ${chunks.count}<br>` +
        `x ${pos.x.toFixed(1)} y ${pos.y.toFixed(1)} z ${pos.z.toFixed(1)} · ${player.grounded ? "ground" : "air"}<br>` +
        `inks ${COLORWAYS[p.inkIndex]!.name} · cave ${ENVWAYS[p.caveIndex]!.name} · ${cam.firstPerson ? "1st" : "3rd"} person`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Debug handle for harness verification.
  (window as unknown as { __world: unknown }).__world = {
    seed,
    player,
    cam,
    terrain,
    chunks,
    pipeline: p,
    setInk: (i: number) => setInkColorway(p, i),
    setCave: (i: number) => setCaveColorway(p, i),
    shot: () => canvas.toDataURL("image/jpeg", 0.8),
  };
}

boot().catch((err) => {
  console.error(err);
  hint.textContent = `failed to start: ${String(err)}`;
});
