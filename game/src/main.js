// main.js — Neon Coast Heat's conductor: builds the world, owns the game state (title,
// play, pause, busted, wasted), runs the frame loop, and wires every system together —
// driving, traffic, pedestrians, police, combat, missions, HUD, sound and saving.
// ?shot=start|drive|chase|mission stages a screenshot scene instead of the live game.

import { CITY, ECONOMY, PLAYER, WANTED } from './config.js';
import { Rng } from './random.js';
import { generateCity, placePosition, collideBuildings } from './city.js';
import { buildScene, makeBeacon } from './scene.js';
import { createCar, spawnFleet, stepTraffic, stepPlayerCar, resolveCarCollisions, syncCarMesh } from './vehicles.js';
import { createPlayer, createPedestrian, stepPedestrian, stepPlayerOnFoot, knockDown, respawnPedestrian } from './people.js';
import { WantedSystem, maintainFleet, stepPoliceCar, canSee } from './police.js';
import { Story } from './missions.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';
import { createInput, ACT_INTERACT, ACT_PAUSE, ACT_SHOOT, ACT_PUNCH, ACT_HORN, ACT_MUTE } from './input.js';
import { stageShot } from './shots.js';

const CITY_SEED = 20261121;
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const rng = new Rng(CITY_SEED);
const city = generateCity(CITY_SEED);
const hud = new Hud();
const sound = new SoundBank();
const input = createInput(canvas);

// ---------- three.js boot ----------
// Software renderers (SwiftShader, llvmpipe — VMs, CI boxes) rasterise on CPU and choke
// on MSAA, shadow maps and full-resolution pixels. Detect them and start lean; real GPUs
// get the full treatment. Screenshot mode always renders full quality (fps is moot there).
function isSoftwareGL() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|subzero/i.test(name);
  } catch (err) {
    return false;
  }
}
const FULL_QUALITY = Boolean(shotName) || !isSoftwareGL();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: FULL_QUALITY });
renderer.setPixelRatio(FULL_QUALITY ? Math.min(window.devicePixelRatio || 1, 1.75) : 0.65);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
const world3d = buildScene(scene, city, rng);
if (!FULL_QUALITY) world3d.sun.castShadow = false; // software path: no shadow pass at all
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- entities ----------
const player = createPlayer();
scene.add(player.mesh);
const startPlace = placePosition('fixerAlley');
player.x = startPlace.x + 3; player.z = startPlace.z + 24;
player.heading = Math.PI;

const cars = spawnFleet(city, rng, 16, 14);
for (const c of cars) scene.add(c.mesh);
const police = [];
const peds = [];
for (let i = 0; i < 26; i += 1) {
  const ped = createPedestrian(city.pedSpots[i % city.pedSpots.length], rng);
  peds.push(ped);
  scene.add(ped.mesh);
}
const beacon = makeBeacon(0xffd94d);
scene.add(beacon.group);
const crates = []; // beach-mission crates: {x, z, mesh}

// Tracers: a small pool of stretched boxes that flash for a frame when a shot is fired.
const tracers = [];
for (let i = 0; i < 6; i += 1) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 1),
    new THREE.MeshBasicMaterial({ color: 0xffe95c, transparent: true, opacity: 0 }),
  );
  m.visible = false;
  scene.add(m);
  tracers.push({ mesh: m, life: 0 });
}
function fireTracer(from, to) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  t.mesh.position.set((from.x + to.x) / 2, 1.35, (from.z + to.z) / 2);
  t.mesh.scale.z = len;
  t.mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  t.mesh.material.opacity = 0.9;
  t.mesh.visible = true;
  t.life = 0.07;
}

// ---------- game state ----------
let state = 'title'; // title | play | pause | busted | wasted
let cash = ECONOMY.startCash;
let story = new Story();
let playerCar = null;
let wanted = new WantedSystem();
let camYaw = Math.PI;
let camPos = new THREE.Vector3(player.x - 30, 26, player.z + 44);
let time = 0;
let crimeT = 0;        // peds flee while this is high
let briefT = 0;        // the mission brief holds the objective banner this long
let briefObj = null;
let lastHurtT = -99;
let saveT = 0;
let shake = 0;

// ---------- save / load ----------
function readSave() {
  try {
    const raw = window.localStorage.getItem(ECONOMY.saveKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave() {
  try {
    window.localStorage.setItem(ECONOMY.saveKey, JSON.stringify({
      cash, missionIndex: story.index, sideCount: story.sideCount,
    }));
  } catch { /* storage off: progress lasts this visit only */ }
}
function applySave(s) {
  cash = Math.max(0, s.cash | 0);
  story.index = Math.min(4, s.missionIndex | 0);
  story.sideCount = s.sideCount | 0;
}

// ---------- the facade missions.js talks to ----------
const game = {
  playerPos: () => (playerCar ? { x: playerCar.x, z: playerCar.z } : { x: player.x, z: player.z }),
  playerCar: () => playerCar,
  wantedStars: () => wanted.stars,
  rng: () => rng.next(),
  spawnCarAt(type, color, x, z, heading) {
    const car = createCar(type, color, x, z, heading);
    cars.push(car);
    scene.add(car.mesh);
    return car;
  },
  removeCar(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    scene.remove(car.mesh);
  },
  addCash(n) { cash += n; hud.setCash(cash); },
  onBrief(title, brief) {
    sound.missionStart();
    briefObj = { title: `NEW JOB — ${title.toUpperCase()}`, text: brief, timer: 0 };
    briefT = 9;
    announce(`New job: ${title}. ${brief}`);
  },
  onAlarm(heat) {
    wanted.heat = Math.max(wanted.heat, heat);
    hud.showToast('ALARM TRIPPED', 'The PSPD are on their way');
    sound.blip(1180, 0.3, 'square', 0.16, 0, 700);
  },
  onPickup() { sound.pickup(); hud.showToast('PACKAGE SECURED', 'Now deliver it'); },
  onStep() { sound.uiClick(); },
  onFail(reason) {
    sound.missionFail();
    hud.showToast('JOB FAILED', reason);
    announce(`Job failed. ${reason}`);
    writeSave();
  },
  setCrates(spots) {
    game.clearCrates();
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const mat = new THREE.MeshLambertMaterial({ color: 0xf2b13d, emissive: 0x664400 });
    for (const s of spots) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, 0.75, s.z);
      mesh.castShadow = true;
      scene.add(mesh);
      crates.push({ x: s.x, z: s.z, mesh });
    }
    syncCrateTargets();
  },
  clearCrates() {
    for (const c of crates) scene.remove(c.mesh);
    crates.length = 0;
    syncCrateTargets();
  },
  nearCrate(p, r) { return crates.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < r); },
  collectCrate(p) {
    const i = crates.findIndex((c) => Math.hypot(c.x - p.x, c.z - p.z) < 5);
    if (i >= 0) {
      scene.remove(crates[i].mesh);
      crates.splice(i, 1);
      sound.pickup();
      hud.showToast('CRATE COLLECTED', `${3 - crates.length} of 3`);
    }
    syncCrateTargets();
  },
};
function syncCrateTargets() {
  if (story.active) story.active.cratesLeft = crates.map((c) => ({ x: c.x, z: c.z }));
}

// ---------- helpers ----------
function announce(msg) { status.textContent = msg; }
function witnessedAt(x, z) {
  for (const c of police) if (Math.hypot(c.x - x, c.z - z) < 46) return true;
  for (const p of peds) if (p.state !== 'down' && Math.hypot(p.x - x, p.z - z) < 17) return true;
  return false;
}
function crime(kind, x, z) {
  wanted.addCrime(kind, witnessedAt(x, z));
  crimeT = 3;
}
function nearestCar(x, z, maxD) {
  let best = null; let bd = maxD;
  for (const list of [cars, police]) {
    for (const c of list) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}
function enterCar(car) {
  playerCar = car;
  if (car.driver === 'police') {
    const i = police.indexOf(car);
    if (i >= 0) police.splice(i, 1);
    crime('stealCar', car.x, car.z);
    wanted.addCrime('shootNear', true);
  } else if (car.driver === 'traffic') {
    crime('stealCar', car.x, car.z);
  }
  car.driver = 'player';
  player.mesh.visible = false;
  sound.doorSlam();
  hud.setSpeed(0, car.name);
  announce(`Driving the ${car.name}.`);
}
function exitCar() {
  if (!playerCar) return;
  const car = playerCar;
  car.driver = null;
  car.speed = 0;
  const rx = Math.cos(car.heading); const rz = -Math.sin(car.heading);
  const fixed = collideBuildings(city, car.x + rx * 3, car.z + rz * 3, PLAYER.radius);
  player.x = fixed.x; player.z = fixed.z;
  player.heading = car.heading;
  player.mesh.visible = true;
  playerCar = null;
  sound.doorSlam();
  sound.engine(false);
  hud.setSpeed(null);
}
function hurtPlayer(amount) {
  if (playerCar) {
    playerCar.health -= amount * 0.8;
    return;
  }
  player.health -= amount;
  lastHurtT = time;
  hud.flashDamage();
  if (player.health <= 0) doWasted();
}
function doBusted() {
  state = 'busted';
  const fine = Math.floor(cash * ECONOMY.bustedFineRate);
  cash -= fine;
  wanted.clear();
  if (playerCar) exitCar();
  const st = placePosition('station');
  player.x = st.x + 4; player.z = st.z + 24;
  player.health = PLAYER.maxHealth;
  sound.busted();
  sound.engine(false);
  sound.siren(false, 0);
  showEnd('BUSTED', `The PSPD got their man. Fine: $${fine.toLocaleString('en-US')}. You walk out of the station on foot — and Sol is already texting about the next job.`, false);
  writeSave();
  announce('Busted.');
}
function doWasted() {
  if (state !== 'play') return;
  state = 'wasted';
  const fee = Math.min(cash, ECONOMY.wastedFee);
  cash -= fee;
  wanted.clear();
  if (playerCar) exitCar();
  const h = placePosition('hospital');
  player.x = h.x - 4; player.z = h.z + 24;
  player.health = PLAYER.maxHealth;
  sound.wasted();
  sound.engine(false);
  sound.siren(false, 0);
  showEnd('WASTED', `You wake up at St. Lucia Hospital. Bill: $${fee.toLocaleString('en-US')}. The city didn't even slow down.`, true);
  writeSave();
  announce('Wasted.');
}
function showEnd(title, text, bad) {
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-title').className = bad ? 'bad' : '';
  document.getElementById('end-text').textContent = text;
  document.getElementById('end-screen').classList.add('on');
  hud.show(false);
}

// ---------- per-frame systems ----------
function stepPlay(dt) {
  time += dt;
  const actions = input.takeActions();
  if (actions & ACT_PAUSE) { pauseGame(); return; }
  if (actions & ACT_MUTE) {
    sound.setMuted(!sound.muted);
    hud.showToast(sound.muted ? 'SOUND OFF' : 'SOUND ON');
  }
  if (actions & ACT_HORN && playerCar) {
    sound.horn();
    for (const c of cars) if (c.driver === 'traffic' && Math.hypot(c.x - playerCar.x, c.z - playerCar.z) < 16 && rng.chance(0.4)) c.honkAt = time + rng.float(0.2, 0.7);
  }

  // --- the player ---
  const events = [];
  if (playerCar) {
    const ratio = stepPlayerCar(playerCar, dt, input, city, events);
    sound.engine(true, Math.abs(playerCar.speed) / 34);
    if (playerCar.wrecked) {
      hud.showToast('CAR WRECKED', 'Get out and find another');
      exitCar();
    }
  } else {
    stepPlayerOnFoot(player, dt, input, camYaw, city);
    player.punchCd -= dt; player.shootCd -= dt;
    if ((actions & ACT_PUNCH) && player.punchCd <= 0) {
      player.punchCd = 0.38;
      sound.punch();
      for (const p of peds) {
        if (p.state === 'down') continue;
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        const facing = Math.sin(player.heading) * (p.x - player.x) + Math.cos(player.heading) * (p.z - player.z);
        if (d < PLAYER.punchRange && facing > 0) {
          knockDown(p, rng);
          crime('punch', player.x, player.z);
          hud.showToast('KNOCKOUT', 'That was witnessed — or was it?');
          break;
        }
      }
    }
    if ((actions & ACT_SHOOT) && player.shootCd <= 0) {
      player.shootCd = 0.3;
      shoot();
    }
  }
  for (const e of events) {
    if (e === 'crashBuilding' || e === 'crashCar') {
      sound.crash(1);
      shake = Math.min(0.5, shake + 0.22);
      if (playerCar) hurtPlayer(2.5);
      if (e === 'crashCar') crime('hitCar', player.x, player.z);
    }
  }

  // --- interact: whichever is nearer, Sol's job marker or a car door ---
  if (actions & ACT_INTERACT) {
    if (playerCar) exitCar();
    else {
      const target = story.target();
      const jobD = !story.active ? Math.hypot(target.x - player.x, target.z - player.z) : Infinity;
      const car = nearestCar(player.x, player.z, 4.6);
      const carD = car ? Math.hypot(car.x - player.x, car.z - player.z) : Infinity;
      if (jobD < 7 && jobD <= carD) { story.start(game); syncCrateTargets(); }
      else if (car) enterCar(car);
    }
  }

  // --- traffic & crowds ---
  for (const c of cars) {
    if (c.driver === 'traffic') {
      stepTraffic(c, dt, city, cars, rng);
      if (c.honkAt && time >= c.honkAt) { sound.horn(); c.honkAt = 0; }
    } else if (c.driver !== 'player') syncCarMesh(c, time);
  }
  const threat = crimeT > 0 ? (playerCar || player) : null;
  crimeT = Math.max(0, crimeT - dt);
  for (const p of peds) {
    if (p.state === 'down' && p.respawnT <= 0 && Math.hypot(p.x - player.x, p.z - player.z) > 60) respawnPedestrian(p, rng);
    stepPedestrian(p, dt, city, rng, threat);
  }
  // Cars vs pedestrians.
  for (const c of [...cars, ...police]) {
    if (Math.abs(c.speed) < 5) continue;
    for (const p of peds) {
      if (p.state === 'down') continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 2.3) {
        knockDown(p, rng);
        sound.crash(0.6);
        if (c === playerCar) { crime('hitPedestrian', p.x, p.z); hud.showToast('PEDESTRIAN DOWN', 'The heat is rising'); hurtPlayer(0); }
        c.speed *= 0.6;
      }
    }
  }
  const allCars = [...cars, ...police];
  const carEvents = [];
  resolveCarCollisions(allCars, carEvents, playerCar);
  for (const e of carEvents) if (e === 'crashCar') { sound.crash(0.9); crime('hitCar', player.x, player.z); shake = Math.min(0.5, shake + 0.15); }

  // --- police ---
  maintainFleet(police, wanted.stars, playerCar || player, city, rng,
    (c) => scene.add(c.mesh), (c) => scene.remove(c.mesh));
  const policeEvents = [];
  wanted.seen = false;
  for (const c of police) {
    stepPoliceCar(c, dt, player, playerCar, city, policeEvents, rng, wanted.stars >= 3);
    if (canSee(c, playerCar || player)) wanted.seen = true;
  }
  for (const e of policeEvents) {
    if (e === 'policeHit') { hurtPlayer(6); sound.noise(0.08, 0.2, 1800); }
    else if (e === 'policeMiss') sound.noise(0.06, 0.1, 2400);
  }
  if (state !== 'play') return; // hurtPlayer may have ended the run (wasted)
  sound.siren(wanted.stars > 0 && police.length > 0, dt);
  // Bust meter: cornered by a close officer while slow.
  let cornered = false;
  if (wanted.stars > 0) {
    for (const c of police) {
      const d = Math.hypot(c.x - (playerCar ? playerCar.x : player.x), c.z - (playerCar ? playerCar.z : player.z));
      const mySpeed = playerCar ? Math.abs(playerCar.speed) : Math.hypot(player.vx, player.vz);
      if (d < (playerCar ? 9 : 5.5) && mySpeed < 3.5) cornered = true;
    }
  }
  if (cornered) {
    wanted.bust += WANTED.bustFillPerSecond * dt;
    if (wanted.bust >= 1) { doBusted(); return; }
  }
  wanted.update(dt);
  hud.setBusted(wanted.bust > 0.02 && wanted.stars > 0 ? wanted.bust : null);

  // --- missions ---
  const result = story.update(dt, game);
  if (result === 'complete') {
    sound.missionDone();
    hud.showToast('JOB COMPLETE', `+$${(story.lastPayout || 0).toLocaleString('en-US')} — ${story.done ? 'story complete! Sol still has side work' : 'Sol has more work when you are ready'}`);
    announce('Job complete.');
    writeSave();
  }

  // --- health regen, waterline, hud ---
  if (time - lastHurtT > 6 && !playerCar) player.health = Math.min(PLAYER.maxHealth, player.health + 2.2 * dt);
  clampToWorld(player);
  if (playerCar) clampToWorld(playerCar);
  hud.setCash(cash);
  hud.setStars(wanted.stars);
  hud.setHealth(playerCar ? playerCar.health : player.health);
  if (playerCar) hud.setSpeed(Math.abs(playerCar.speed) * 2.4, playerCar.name);
  briefT = Math.max(0, briefT - dt);
  hud.setObjective(briefT > 0 && briefObj ? briefObj : story.objective());
  updatePrompt();
  hud.update(dt);
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; }
  }
  // Beacon on the current target.
  const target = story.target();
  beacon.group.visible = true;
  beacon.group.position.set(target.x, 0, target.z);
  beacon.pillar.material.opacity = 0.26 + Math.sin(time * 3.2) * 0.1;
  beacon.ring.rotation.z = time * 0.8;
  for (const c of crates) c.mesh.rotation.y += dt * 1.4;
  // Shadow frustum follows the player.
  const focus = playerCar || player;
  world3d.sun.position.set(focus.x - 140, 190, focus.z - 90);
  world3d.sun.target.position.set(focus.x, 0, focus.z);
  world3d.sea.position.y = -0.35 + Math.sin(time * 0.7) * 0.08;
  saveT += dt;
  if (saveT > 6) { saveT = 0; writeSave(); }
}

function clampToWorld(e) {
  const lim = city.size / 2 + 6;
  e.x = Math.max(-lim, Math.min(lim, e.x));
  e.z = Math.max(-lim, Math.min(lim, e.z));
}

function shoot() {
  sound.gunshot();
  crimeT = 3;
  const fx = Math.sin(player.heading); const fz = Math.cos(player.heading);
  let bestPed = null; let bestScore = 0.94;
  for (const p of peds) {
    if (p.state === 'down') continue;
    const dx = p.x - player.x; const dz = p.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER.gunRange) continue;
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot > bestScore) { bestScore = dot; bestPed = p; }
  }
  let bestCar = null; bestScore = 0.94;
  for (const c of [...cars, ...police]) {
    if (c === playerCar) continue;
    const dx = c.x - player.x; const dz = c.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER.gunRange) continue;
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot > bestScore) { bestScore = dot; bestCar = c; }
  }
  const from = { x: player.x + fx * 0.6, z: player.z + fz * 0.6 };
  if (bestPed && (!bestCar || Math.hypot(bestPed.x - player.x, bestPed.z - player.z) < Math.hypot(bestCar.x - player.x, bestCar.z - player.z))) {
    fireTracer(from, bestPed);
    knockDown(bestPed, rng);
    crime('shootHit', player.x, player.z);
  } else if (bestCar) {
    fireTracer(from, bestCar);
    bestCar.health -= 14;
    crime('shootHit', player.x, player.z);
    if (bestCar.health <= 0) bestCar.wrecked = true;
  } else {
    fireTracer(from, { x: player.x + fx * PLAYER.gunRange, z: player.z + fz * PLAYER.gunRange });
    crime('shootNear', player.x, player.z);
  }
}

function updatePrompt() {
  if (playerCar) { hud.setPrompt(null); return; }
  const target = story.target();
  if (!story.active && Math.hypot(target.x - player.x, target.z - player.z) < 7) {
    hud.setPrompt(story.done ? 'Press <b>E</b> — take a side job from Sol' : 'Press <b>E</b> — take the job from Sol');
    return;
  }
  const car = nearestCar(player.x, player.z, 4.6);
  if (car) hud.setPrompt(`Press <b>E</b> — get in the ${car.name}`);
  else hud.setPrompt(null);
}

function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  document.getElementById('pause-stats').textContent =
    `Cash $${cash.toLocaleString('en-US')} · Jobs done: ${story.index + story.sideCount} · ${wanted.stars} star${wanted.stars === 1 ? '' : 's'} of heat`;
  document.getElementById('pause-screen').classList.add('on');
  sound.engine(false);
  sound.siren(false, 0);
}
function resumeGame() {
  state = 'play';
  document.getElementById('pause-screen').classList.remove('on');
}

// ---------- camera ----------
function stepCamera(dt) {
  const focus = playerCar || player;
  if (state === 'title') {
    const a = time * 0.05;
    const tx = Math.sin(a) * 120; const tz = 60 + Math.cos(a) * 90;
    camPos.x += (tx - camPos.x) * (1 - Math.exp(-dt * 1.4));
    camPos.y += (52 - camPos.y) * (1 - Math.exp(-dt * 1.4));
    camPos.z += (tz - camPos.z) * (1 - Math.exp(-dt * 1.4));
    camera.position.copy(camPos);
    camera.lookAt(0, 4, 40);
    return;
  }
  const targetYaw = focus.heading + Math.PI;
  let dy = targetYaw - camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const speed = playerCar ? Math.abs(playerCar.speed) : Math.hypot(player.vx, player.vz);
  camYaw += dy * (1 - Math.exp(-dt * (speed > 2 ? 2.6 : 0.7)));
  const dist = playerCar ? 12.5 : 9.5;
  const height = playerCar ? 5 : 4.4;
  const bx = focus.x + Math.sin(camYaw) * dist;
  const bz = focus.z + Math.cos(camYaw) * dist;
  camPos.x += (bx - camPos.x) * (1 - Math.exp(-dt * 7));
  camPos.y += (height - camPos.y) * (1 - Math.exp(-dt * 7));
  camPos.z += (bz - camPos.z) * (1 - Math.exp(-dt * 7));
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 1.4);
  }
  camera.lookAt(focus.x, 1.7, focus.z);
}

// Ambient life for the title screen: traffic and crowds keep moving behind the menu.
function stepAmbient(dt) {
  time += dt;
  for (const c of cars) if (c.driver === 'traffic') stepTraffic(c, dt, city, cars, rng);
  for (const p of peds) stepPedestrian(p, dt, city, rng, null);
  world3d.sea.position.y = -0.35 + Math.sin(time * 0.7) * 0.08;
}

// ---------- boot & loop ----------
function startPlay(fresh) {
  if (fresh) {
    try { window.localStorage.removeItem(ECONOMY.saveKey); } catch { /* ignore */ }
    cash = ECONOMY.startCash;
    story = new Story();
  }
  document.getElementById('title-screen').classList.remove('on');
  document.getElementById('end-screen').classList.remove('on');
  hud.show(true);
  hud.setCash(cash);
  state = 'play';
  sound.unlock();
  sound.uiClick();
  announce('Playing Neon Coast Heat.');
}
document.getElementById('btn-new').addEventListener('click', () => startPlay(true));
document.getElementById('btn-continue').addEventListener('click', () => {
  const s = readSave();
  if (s) applySave(s);
  startPlay(false);
});
document.getElementById('btn-resume').addEventListener('click', () => { sound.unlock(); resumeGame(); });
document.getElementById('btn-restart').addEventListener('click', () => {
  document.getElementById('pause-screen').classList.remove('on');
  startPlay(true);
});
document.getElementById('btn-respawn').addEventListener('click', () => {
  document.getElementById('end-screen').classList.remove('on');
  hud.show(true);
  state = 'play';
  sound.unlock();
});
if (!readSave()) document.getElementById('btn-continue').disabled = true;
window.addEventListener('keydown', () => sound.unlock(), { once: true });
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') pauseGame();
});

// A small introspection hook for automated play-tests (and curious players in devtools).
window.__game = {
  get state() { return state; },
  get cash() { return cash; },
  get fps() { return lastFps; },
  player, cars, police, peds, story, wanted, renderer,
  get playerCar() { return playerCar; },
};

// Adaptive quality: a sliding-window frame rate; if it stays low (weak GPU, software
// rendering), first the shadow map goes, then the pixel ratio, so the game stays
// responsive everywhere. Physics sub-steps (below) keep game speed real-time meanwhile.
let lastFps = 60;
let qualityStage = FULL_QUALITY ? 0 : 2;
const frameStamps = [];
const bootStamp = performance.now();
function measureFps(now) {
  frameStamps.push(now);
  while (frameStamps.length && frameStamps[0] < now - 2500) frameStamps.shift();
  if (frameStamps.length < 2) return 60;
  const span = (frameStamps[frameStamps.length - 1] - frameStamps[0]) / 1000;
  return (frameStamps.length - 1) / Math.max(span, 0.001);
}
function adaptQuality(now) {
  if (!FULL_QUALITY) return; // software path already runs at its floor settings
  const elapsed = now - bootStamp;
  if (qualityStage === 0 && elapsed > 3500 && lastFps < 26) {
    qualityStage = 1;
    world3d.sun.castShadow = false;
    renderer.setPixelRatio(1);
  } else if (qualityStage === 1 && elapsed > 9000 && lastFps < 18) {
    qualityStage = 2;
    renderer.setPixelRatio(0.8);
  }
}

let last = performance.now();
let mapFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  lastFps = measureFps(now);
  adaptQuality(now);
  if (state === 'play') {
    // Sub-step in slices of at most 1/30 s so a slow frame still advances the world by
    // the real elapsed time (up to a cap) instead of slowing the game down.
    let remaining = Math.min(rawDt, 0.16);
    let guard = 0;
    while (remaining > 0.0001 && guard < 5 && state === 'play') {
      const step = Math.min(remaining, 1 / 30);
      stepPlay(step);
      remaining -= step;
      guard += 1;
    }
  } else if (state === 'title') {
    stepAmbient(Math.min(rawDt, 0.05));
  } else if (state === 'pause') {
    const a = input.takeActions();
    if (a & ACT_PAUSE) resumeGame();
  }
  stepCamera(Math.min(rawDt, 0.05));
  mapFrame += 1;
  if (qualityStage < 2 || mapFrame % 4 === 0) {
    hud.drawMinimap({
      player: playerCar ? { x: playerCar.x, z: playerCar.z, heading: playerCar.heading } : player,
      city, traffic: cars, police, target: state === 'play' ? story.target() : null, time,
    });
  }
  renderer.render(scene, camera);
}

if (shotName) {
  stageShot(shotName, {
    scene, camera, renderer, city, player, cars, police, peds, story, game, hud, wanted,
    placePosition, beacon, time: () => time,
    addPolice(n) {
      for (let i = 0; i < n; i += 1) {
        const c = createCar('police', 0xf2f2f2, player.x + 14 + i * 7, player.z + 18 - i * 5, Math.PI * 0.9);
        c.driver = 'police';
        police.push(c);
        scene.add(c.mesh);
      }
    },
    setTime(t) { time = t; },
    stepAmbient, stepCamera,
  });
} else {
  hud.setCash(cash);
  requestAnimationFrame(frame);
}
