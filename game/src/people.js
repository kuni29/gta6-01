// people.js — the people of Port Solano: Rico on foot and the crowds who fill the
// sidewalks. Pedestrians run a small behaviour machine (stroll, idle, flee, panic,
// down) and steer around the city on their own sidewalk rings, so the streets feel
// alive even when the player is just watching. Rico is one person built from the
// same limb rig, driven by the camera-relative movement keys.
//
// Every person is a low-poly box figure: torso, head, two pivoted arms and two
// pivoted legs. The walk cycle is a sine swing of the limb pivots, driven by how
// fast that person is actually moving, so a standing figure is still and a
// sprinting one pumps its arms. No model files are loaded; the meshes are built
// from boxes at runtime.

import { PLAYER } from './config.js';
import { collideBuildings } from './city.js';

// ------------------------------------------------------------------ palette

/** Shirt colours the crowd wears — sun-bleached tees, work shirts, tourist prints. */
const SHIRTS = [0xe8e0d0, 0xd94f3d, 0x3d7bd9, 0x53b06a, 0xf2b13d, 0x7a4a5e, 0x39594f, 0xe07b39, 0x8a6fbf, 0x2f6f6a];
/** Trouser colours. */
const PANTS = [0x2b3440, 0x4a4640, 0x6b5a48, 0x3d4a5e, 0x5e3d4a, 0x2f4038];
/** Skin tones across the crowd. */
const SKINS = [0xf2c9a0, 0xe0ac82, 0xc98d64, 0x8a5a3b, 0x6b4426, 0xf7d7b5];
/** Hair / cap colours. */
const HAIRS = [0x1c1a18, 0x3d2b1f, 0x6b4a2f, 0x8a8a8a, 0xd94f3d, 0xf2b13d];

const BODY_GEO = {
  torso: new THREE.BoxGeometry(0.62, 0.72, 0.34),
  head: new THREE.BoxGeometry(0.34, 0.36, 0.32),
  arm: new THREE.BoxGeometry(0.16, 0.62, 0.18),
  leg: new THREE.BoxGeometry(0.2, 0.66, 0.22),
  cap: new THREE.BoxGeometry(0.4, 0.12, 0.38),
};

function personMaterial(color) {
  return new THREE.MeshLambertMaterial({ color });
}

/**
 * Build one box person and return its group. The group carries its limb pivots in
 * userData.limbs and its walk phase in userData.phase, which animatePerson drives.
 * `cap` is 0 for bare hair, 1 for a cap, 2 for a wide sun hat.
 */
export function makePerson({ shirt, pants, skin, cap = 0 }) {
  const group = new THREE.Group();
  const torsoMat = personMaterial(shirt);
  const pantsMat = personMaterial(pants);
  const skinMat = personMaterial(skin);
  const hairMat = personMaterial(HAIRS[Math.floor(Math.random() * HAIRS.length)]);

  const torso = new THREE.Mesh(BODY_GEO.torso, torsoMat);
  torso.position.y = 1.02;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(BODY_GEO.head, skinMat);
  head.position.y = 1.56;
  head.castShadow = true;
  group.add(head);

  if (cap === 1) {
    const capMesh = new THREE.Mesh(BODY_GEO.cap, personMaterial(0x2b3440));
    capMesh.position.y = 1.78;
    group.add(capMesh);
  } else if (cap === 2) {
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.6), personMaterial(0xf2e3b3));
    brim.position.y = 1.76;
    group.add(brim);
  } else {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), hairMat);
    hair.position.y = 1.76;
    group.add(hair);
  }

  const armL = new THREE.Group();
  armL.position.set(-0.4, 1.32, 0);
  const armLMesh = new THREE.Mesh(BODY_GEO.arm, skinMat);
  armLMesh.position.y = -0.28;
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  const armR = new THREE.Group();
  armR.position.set(0.4, 1.32, 0);
  const armRMesh = new THREE.Mesh(BODY_GEO.arm, skinMat);
  armRMesh.position.y = -0.28;
  armRMesh.castShadow = true;
  armR.add(armRMesh);
  const legL = new THREE.Group();
  legL.position.set(-0.16, 0.68, 0);
  const legLMesh = new THREE.Mesh(BODY_GEO.leg, pantsMat);
  legLMesh.position.y = -0.32;
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  const legR = new THREE.Group();
  legR.position.set(0.16, 0.68, 0);
  const legRMesh = new THREE.Mesh(BODY_GEO.leg, pantsMat);
  legRMesh.position.y = -0.32;
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  group.add(armL, armR, legL, legR);

  group.userData.limbs = { armL, armR, legL, legR };
  group.userData.phase = Math.random() * Math.PI * 2;
  group.userData.moveSpeed = 0;
  return group;
}

/**
 * Advance one person's walk cycle. The swing amplitude grows with the speed the
 * caller stored in group.userData.moveSpeed, and the phase advances in step with
 * it, so the feet roughly match the ground speed instead of moonwalking.
 */
export function animatePerson(person, dt) {
  const data = person.userData;
  const limbs = data.limbs;
  if (!limbs) return;
  const speed = data.moveSpeed || 0;
  data.phase += dt * (2.2 + speed * 1.15);
  const swing = Math.min(0.75, speed * 0.09) * Math.sin(data.phase);
  const counter = Math.min(0.75, speed * 0.09) * Math.sin(data.phase + Math.PI);
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = counter;
  limbs.armL.rotation.x = counter * 0.8;
  limbs.armR.rotation.x = swing * 0.8;
  // A running figure leans into the stride; a strolling one stays upright.
  person.rotation.x = 0;
  const torsoLean = Math.min(0.12, speed * 0.008);
  limbs.armL.rotation.x -= torsoLean;
  limbs.armR.rotation.x -= torsoLean;
}

// ------------------------------------------------------------------ pedestrians

/** How far a pedestrian notices a crime and starts running. */
const FLEE_RADIUS = 15;
/** How far a fleeing pedestrian runs before it dares to slow down. */
const FLEE_DISTANCE = 26;
/** Panic bursts last this long before the pedestrian picks a new direction. */
const PANIC_SPAN = 1.6;

/** Pick a fresh waypoint on the pedestrian's home sidewalk ring. */
function ringWaypoint(ped, rng) {
  const a = rng.angle();
  return {
    x: ped.home.x + Math.cos(a) * ped.home.ring,
    z: ped.home.z + Math.sin(a) * ped.home.ring,
  };
}

/**
 * Spawn one pedestrian on the sidewalk ring of `spot` ({x, z, ring} from the
 * city's pedSpots). The figure keeps its home ring for the rest of its life, so
 * respawns and wandering never drift it across the map.
 */
export function createPedestrian(spot, rng) {
  const outfit = {
    shirt: rng.pick(SHIRTS),
    pants: rng.pick(PANTS),
    skin: rng.pick(SKINS),
    cap: rng.int(0, 2),
  };
  const mesh = makePerson(outfit);
  const a = rng.angle();
  const ped = {
    mesh,
    home: { x: spot.x, z: spot.z, ring: spot.ring || 16 },
    x: spot.x + Math.cos(a) * (spot.ring || 16),
    z: spot.z + Math.sin(a) * (spot.ring || 16),
    heading: rng.angle(),
    state: 'stroll', // stroll | idle | flee | panic | down
    speed: 0,
    walkPhase: rng.float(0, 6),
    respawnT: 0,
    waitT: rng.float(0, 2),
    panicT: 0,
    target: null,
    fleeFrom: null,
    downT: 0,
  };
  ped.target = ringWaypoint(ped, rng);
  mesh.position.set(ped.x, 0, ped.z);
  mesh.rotation.y = ped.heading;
  return ped;
}

/** Tip a pedestrian over: down on the pavement, limbs slack, out for a while. */
export function knockDown(ped, rng) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.speed = 0;
  ped.downT = 0;
  ped.respawnT = rng.float(7, 13);
  ped.mesh.rotation.set(0, ped.heading, Math.PI / 2 - 0.12);
  ped.mesh.position.y = 0.28;
  const limbs = ped.mesh.userData.limbs;
  if (limbs) {
    limbs.armL.rotation.x = -1.2;
    limbs.armR.rotation.x = 0.9;
    limbs.legL.rotation.x = 0.35;
    limbs.legR.rotation.x = -0.25;
  }
}

/**
 * Bring a down pedestrian back: a fresh face on the same home ring, standing up,
 * walking again. Called only once the player is far away, so nobody watches the
 * trick happen.
 */
export function respawnPedestrian(ped, rng) {
  const a = rng.angle();
  ped.x = ped.home.x + Math.cos(a) * ped.home.ring;
  ped.z = ped.home.z + Math.sin(a) * ped.home.ring;
  ped.heading = rng.angle();
  ped.state = 'stroll';
  ped.speed = 0;
  ped.respawnT = 0;
  ped.waitT = rng.float(0, 1.5);
  ped.target = ringWaypoint(ped, rng);
  ped.mesh.rotation.set(0, ped.heading, 0);
  ped.mesh.position.set(ped.x, 0, ped.z);
  ped.mesh.userData.phase = rng.float(0, 6);
}

/** Steer one pedestrian toward a point at a given speed, keeping out of walls. */
function walkToward(ped, dt, city, tx, tz, speed) {
  const dx = tx - ped.x;
  const dz = tz - ped.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) return true;
  const want = Math.atan2(dx, dz);
  let turn = want - ped.heading;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  ped.heading += Math.max(-3.4 * dt, Math.min(3.4 * dt, turn));
  const step = Math.min(dist, speed * dt);
  ped.x += Math.sin(ped.heading) * step;
  ped.z += Math.cos(ped.heading) * step;
  const fixed = collideBuildings(city, ped.x, ped.z, PLAYER.radius);
  ped.x = fixed.x;
  ped.z = fixed.z;
  ped.speed = speed;
  return dist < 1.2;
}

/**
 * One pedestrian's frame. `threat` is the player (or their car) while a crime is
 * fresh, otherwise null. A threatened pedestrian within earshot flees away from
 * the threat; one that was just run over stays down until its timer ends.
 */
export function stepPedestrian(ped, dt, city, rng, threat) {
  if (ped.state === 'down') {
    ped.respawnT -= dt;
    ped.downT += dt;
    ped.mesh.userData.moveSpeed = 0;
    return;
  }

  // A fresh crime nearby turns a stroll into a sprint away from the trouble.
  if (threat) {
    const dx = ped.x - threat.x;
    const dz = ped.z - threat.z;
    const d = Math.hypot(dx, dz);
    if (d < FLEE_RADIUS) {
      ped.state = 'flee';
      ped.fleeFrom = { x: threat.x, z: threat.z };
      ped.panicT = PANIC_SPAN;
    }
  }

  if (ped.state === 'flee') {
    const from = ped.fleeFrom || { x: ped.x, z: ped.z };
    const away = Math.atan2(ped.x - from.x, ped.z - from.z);
    // Run away, but wobble the line so a crowd doesn't march in lockstep.
    const wobble = Math.sin(ped.walkPhase * 0.9) * 0.45;
    const tx = ped.x + Math.sin(away + wobble) * FLEE_DISTANCE;
    const tz = ped.z + Math.cos(away + wobble) * FLEE_DISTANCE;
    ped.walkPhase += dt * 9;
    walkToward(ped, dt, city, tx, tz, 5.6);
    ped.panicT -= dt;
    const threatD = threat ? Math.hypot(ped.x - threat.x, ped.z - threat.z) : 99;
    if (threatD > FLEE_DISTANCE && ped.panicT <= 0) {
      ped.state = 'stroll';
      ped.target = ringWaypoint(ped, rng);
      ped.waitT = rng.float(0, 1);
    }
  } else if (ped.state === 'panic') {
    ped.panicT -= dt;
    ped.walkPhase += dt * 9;
    const tx = ped.x + Math.sin(ped.heading) * 20;
    const tz = ped.z + Math.cos(ped.heading) * 20;
    walkToward(ped, dt, city, tx, tz, 6.4);
    if (ped.panicT <= 0) {
      ped.state = 'stroll';
      ped.target = ringWaypoint(ped, rng);
    }
  } else if (ped.state === 'idle') {
    ped.waitT -= dt;
    ped.speed = 0;
    ped.mesh.userData.moveSpeed = 0;
    if (ped.waitT <= 0) {
      ped.state = 'stroll';
      ped.target = ringWaypoint(ped, rng);
    }
  } else {
    // Stroll: amble to the waypoint, then idle a beat and pick another.
    ped.walkPhase += dt * 3.2;
    const arrived = walkToward(ped, dt, city, ped.target.x, ped.target.z, 1.7);
    if (arrived) {
      ped.state = 'idle';
      ped.waitT = rng.float(0.5, 3.5);
      ped.speed = 0;
    }
  }

  ped.mesh.position.set(ped.x, 0, ped.z);
  ped.mesh.rotation.y = ped.heading;
  ped.mesh.userData.moveSpeed = ped.speed;
  animatePerson(ped.mesh, dt);
}

// ------------------------------------------------------------------ the player

/**
 * Rico Vega, the player on foot. The same limb rig as the crowd, dressed to
 * stand out: a mustard jacket over a white tee, dark jeans, no hat.
 */
export function createPlayer() {
  const mesh = makePerson({ shirt: 0xf2b13d, pants: 0x2b3440, skin: 0xe0ac82, cap: 0 });
  mesh.userData.phase = 0;
  return {
    mesh,
    x: 0,
    z: 0,
    heading: Math.PI,
    vx: 0,
    vz: 0,
    health: PLAYER.maxHealth,
    punchCd: 0,
    shootCd: 0,
    walkPhase: 0,
  };
}

/**
 * Move Rico on foot. W/A/S/D move relative to the camera (W is away from it),
 * Shift runs. Velocity eases toward the wish direction so starting and stopping
 * have weight, and the figure turns to face where it is actually going.
 */
export function stepPlayerOnFoot(player, dt, input, camYaw, city) {
  const held = input.held;
  // Camera-relative basis: forward is away from the camera, right is 90° clockwise.
  const fwdX = -Math.sin(camYaw);
  const fwdZ = -Math.cos(camYaw);
  const rightX = -Math.cos(camYaw);
  const rightZ = Math.sin(camYaw);
  let wishX = 0;
  let wishZ = 0;
  if (held.forward) { wishX += fwdX; wishZ += fwdZ; }
  if (held.back) { wishX -= fwdX; wishZ -= fwdZ; }
  if (held.right) { wishX += rightX; wishZ += rightZ; }
  if (held.left) { wishX -= rightX; wishZ -= rightZ; }
  const wishLen = Math.hypot(wishX, wishZ);
  const running = Boolean(held.run);
  const topSpeed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;

  if (wishLen > 0.01) {
    const nx = wishX / wishLen;
    const nz = wishZ / wishLen;
    const accel = 46;
    player.vx += nx * accel * dt;
    player.vz += nz * accel * dt;
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > topSpeed) {
      player.vx = (player.vx / speed) * topSpeed;
      player.vz = (player.vz / speed) * topSpeed;
    }
    const wantHeading = Math.atan2(player.vx, player.vz);
    let turn = wantHeading - player.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    player.heading += Math.max(-11 * dt, Math.min(11 * dt, turn));
  } else {
    // No input: friction bleeds the velocity off instead of stopping dead.
    const drag = Math.max(0, 1 - 9 * dt);
    player.vx *= drag;
    player.vz *= drag;
    if (Math.hypot(player.vx, player.vz) < 0.15) { player.vx = 0; player.vz = 0; }
  }

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  const fixed = collideBuildings(city, player.x, player.z, PLAYER.radius);
  if (fixed.x !== player.x || fixed.z !== player.z) {
    // Brushed a wall: kill the into-the-wall component so Rico slides along it.
    const hitX = fixed.x !== player.x;
    const hitZ = fixed.z !== player.z;
    player.x = fixed.x;
    player.z = fixed.z;
    if (hitX) player.vx = 0;
    if (hitZ) player.vz = 0;
  }

  const speed = Math.hypot(player.vx, player.vz);
  player.walkPhase += dt * (2 + speed * 1.2);
  player.mesh.position.set(player.x, 0, player.z);
  player.mesh.rotation.y = player.heading;
  player.mesh.userData.moveSpeed = speed;
  animatePerson(player.mesh, dt);
}
