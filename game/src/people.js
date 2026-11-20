// people.js — the humans of Port Solano: a low-poly person factory (merged body mesh plus
// two swinging leg meshes), pedestrians who stroll the sidewalk ring of their home block
// and flee from danger, and the on-foot movement controller for Rico himself.

import { PLAYER } from './config.js';
import { collideBuildings } from './city.js';
import { mergeParts, partMaterial } from './scene.js';
import { angleDelta } from './vehicles.js';

const SKIN = [0xf2c09a, 0xc68863, 0x8a5a3b, 0xffe0bd];
const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xe67e22, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xff7fab, 0x95a5a6];
const PANTS = [0x2c3e50, 0x5d6d7e, 0x784212, 0x1a1a2e, 0xd6eaf8, 0x922b21];

let sharedMat = null;

/** Build a person: body (legs excluded) as one merged mesh, legs separate for the swing. */
export function makePerson({ shirt, pants, skin, cap = 0 }) {
  if (!sharedMat) sharedMat = partMaterial();
  const group = new THREE.Group();
  const bodyParts = [
    { w: 0.62, h: 0.78, d: 0.34, x: 0, y: 1.18, z: 0, color: shirt },          // torso
    { w: 0.34, h: 0.34, d: 0.34, x: 0, y: 1.78, z: 0, color: skin },           // head
    { w: 0.16, h: 0.62, d: 0.16, x: -0.42, y: 1.16, z: 0, color: shirt },      // arm L
    { w: 0.16, h: 0.62, d: 0.16, x: 0.42, y: 1.16, z: 0, color: shirt },       // arm R
  ];
  if (cap) bodyParts.push({ w: 0.4, h: 0.1, d: 0.4, x: 0, y: 1.99, z: 0, color: cap });
  if (cap) bodyParts.push({ w: 0.38, h: 0.06, d: 0.3, x: 0, y: 1.95, z: 0.3, color: cap });
  const body = new THREE.Mesh(mergeParts(bodyParts), sharedMat);
  body.castShadow = true;
  group.add(body);
  const legGeoParts = [{ w: 0.2, h: 0.8, d: 0.22, x: 0, y: -0.4, z: 0, color: pants }];
  const legGeo = mergeParts(legGeoParts);
  const legL = new THREE.Mesh(legGeo, sharedMat);
  legL.position.set(-0.16, 0.82, 0);
  const legR = new THREE.Mesh(legGeo, sharedMat);
  legR.position.set(0.16, 0.82, 0);
  group.add(legL); group.add(legR);
  return { group, body, legL, legR };
}

/** Animate a person's walk cycle from its speed and accumulated phase. */
export function animatePerson(person, dt) {
  const speed = Math.hypot(person.vx || 0, person.vz || 0);
  person.phase = (person.phase || 0) + dt * (2 + speed * 1.6);
  const swing = Math.min(0.65, speed * 0.14) * Math.sin(person.phase);
  person.parts.legL.rotation.x = swing;
  person.parts.legR.rotation.x = -swing;
  person.parts.body.position.y = Math.abs(Math.sin(person.phase)) * 0.05 * Math.min(1, speed);
  person.mesh.position.set(person.x, person.state === 'down' ? 0.25 : 0, person.z);
  person.mesh.rotation.y = person.heading;
  if (person.state === 'down') person.mesh.rotation.z = Math.PI / 2 - 0.12;
  else person.mesh.rotation.z = 0;
}

/** Create a pedestrian who lives on one block's sidewalk ring. */
export function createPedestrian(ring, rng) {
  const parts = makePerson({
    shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS), skin: rng.pick(SKIN),
    cap: rng.chance(0.3) ? rng.pick(SHIRTS) : 0,
  });
  const ped = {
    x: ring.x + rng.float(-ring.ring, ring.ring), z: ring.z - ring.ring,
    heading: rng.angle(), vx: 0, vz: 0, phase: rng.float(0, 6),
    health: 60, state: 'walk', fleeT: 0, idleT: 0, home: ring, wp: null,
    mesh: parts.group, parts, dead: false, respawnT: 0,
  };
  pickWaypoint(ped, rng);
  return ped;
}

/** A new random target point on the pedestrian's home ring (a rectangle path). */
function pickWaypoint(ped, rng) {
  const { x: cx, z: cz, ring: r } = ped.home;
  const side = rng.int(0, 3);
  const t = rng.float(-r, r);
  if (side === 0) ped.wp = { x: cx + t, z: cz - r };
  else if (side === 1) ped.wp = { x: cx + t, z: cz + r };
  else if (side === 2) ped.wp = { x: cx - r, z: cz + t };
  else ped.wp = { x: cx + r, z: cz + t };
}

/** Pedestrian update: stroll to waypoints, flee threats, lie still when down. */
export function stepPedestrian(ped, dt, city, rng, threat) {
  if (ped.state === 'down') {
    ped.vx = 0; ped.vz = 0;
    ped.respawnT -= dt;
    animatePerson(ped, dt);
    return;
  }
  let speed = 2.2;
  let tx = ped.wp.x; let tz = ped.wp.z;
  if (threat && Math.hypot(threat.x - ped.x, threat.z - ped.z) < 14) { ped.fleeT = 2.6; ped.idleT = 0; }
  if (ped.fleeT > 0) {
    ped.fleeT -= dt;
    speed = 8.5;
    const away = Math.atan2(ped.x - (threat ? threat.x : ped.x), ped.z - (threat ? threat.z : ped.z));
    tx = ped.x + Math.sin(away) * 10;
    tz = ped.z + Math.cos(away) * 10;
  } else if (ped.idleT > 0) {
    // A breather at the corner: stand, watch the traffic go by, then stroll on.
    ped.idleT -= dt;
    ped.vx = 0; ped.vz = 0;
    animatePerson(ped, dt);
    return;
  } else if (Math.hypot(tx - ped.x, tz - ped.z) < 1.2) {
    if (rng.chance(0.3)) ped.idleT = rng.float(0.8, 2.4);
    pickWaypoint(ped, rng);
    tx = ped.wp.x; tz = ped.wp.z;
  }
  const desired = Math.atan2(tx - ped.x, tz - ped.z);
  ped.heading += Math.max(-3.2 * dt, Math.min(3.2 * dt, angleDelta(ped.heading, desired)));
  ped.vx = Math.sin(ped.heading) * speed;
  ped.vz = Math.cos(ped.heading) * speed;
  ped.x += ped.vx * dt;
  ped.z += ped.vz * dt;
  const fixed = collideBuildings(city, ped.x, ped.z, 0.7);
  if (fixed.x !== ped.x || fixed.z !== ped.z) pickWaypoint(ped, rng);
  ped.x = fixed.x; ped.z = fixed.z;
  animatePerson(ped, dt);
}

/** Knock a pedestrian down (car hit, punch, bullet): they stay down, then quietly respawn. */
export function knockDown(ped, rng) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.health = 0;
  ped.respawnT = 14;
  ped.mesh.rotation.z = Math.PI / 2 - 0.12;
}

/** Respawn a downed pedestrian at a fresh ring point, good as new (off-screen cleanup). */
export function respawnPedestrian(ped, rng) {
  ped.state = 'walk';
  ped.health = 60;
  ped.x = ped.home.x + rng.float(-ped.home.ring, ped.home.ring);
  ped.z = ped.home.z - ped.home.ring;
  pickWaypoint(ped, rng);
}

/**
 * The player character entity: Rico, in a coral shirt and a teal cap so he reads at a
 * glance. Movement is camera-relative; main.js owns the camera and passes its yaw.
 */
export function createPlayer() {
  const parts = makePerson({ shirt: 0xff5964, pants: 0x22304a, skin: 0xc68863, cap: 0x14b8a6 });
  return {
    x: 0, z: 0, heading: Math.PI, vx: 0, vz: 0, phase: 0,
    health: PLAYER.maxHealth, state: 'foot', car: null,
    mesh: parts.group, parts, punchCd: 0, shootCd: 0,
  };
}

/** Move Rico on foot from input, relative to the camera yaw. Returns his speed. */
export function stepPlayerOnFoot(player, dt, input, camYaw, city) {
  const ix = input.steer();
  const iz = input.throttle();
  let speed = 0;
  if (ix !== 0 || iz !== 0) {
    const len = Math.hypot(ix, iz);
    // Camera forward on the ground is -(sin camYaw, cos camYaw) (the camera sits behind
    // the player, looking past him); camera right is (cos camYaw, -sin camYaw).
    const mx = (-Math.sin(camYaw) * iz + Math.cos(camYaw) * ix) / len;
    const mz = (-Math.cos(camYaw) * iz - Math.sin(camYaw) * ix) / len;
    const target = Math.atan2(mx, mz);
    player.heading += Math.max(-11 * dt, Math.min(11 * dt, angleDelta(player.heading, target)));
    speed = input.held.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    player.vx = mx * speed;
    player.vz = mz * speed;
  } else {
    player.vx = 0; player.vz = 0;
  }
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  const fixed = collideBuildings(city, player.x, player.z, PLAYER.radius);
  player.x = fixed.x; player.z = fixed.z;
  animatePerson(player, dt);
  return speed;
}
