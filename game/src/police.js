// police.js — the heat: a wanted level that rises with witnessed crime and cools when the
// player breaks line of sight, plus the PSPD pursuit drivers who hunt the player across
// the grid, ram his car, and shoot when the stars are high enough.

import { WANTED, WORLD } from './config.js';
import { collideBuildings } from './city.js';
import { createCar, driveToward, syncCarMesh, angleDelta } from './vehicles.js';

export class WantedSystem {
  constructor() {
    this.heat = 0;          // 0..500
    this.bust = 0;          // 0..1 bust meter
    this.seen = false;      // any police close enough to watch the player
  }

  get stars() { return Math.min(WANTED.maxStars, Math.floor(this.heat / WANTED.perStar)); }

  /** Add heat for a crime. Unwitnessed crime (no police or peds near) counts for less. */
  addCrime(kind, witnessed = true) {
    const base = WANTED.crime[kind] || 20;
    this.heat = Math.min(WANTED.maxStars * WANTED.perStar, this.heat + base * (witnessed ? 1 : 0.45));
  }

  /** Cool the heat: fast when unseen, barely at all while watched. Clears the bust meter too. */
  update(dt) {
    const rate = this.seen ? WANTED.seenDecayPerSecond : WANTED.decayPerSecond;
    this.heat = Math.max(0, this.heat - rate * dt);
    if (!this.seen) this.bust = Math.max(0, this.bust - WANTED.bustDrainPerSecond * dt);
  }

  clear() { this.heat = 0; this.bust = 0; }
}

/** How many pursuit cars the current star count calls for. */
export function desiredPolice(stars) {
  return Math.min(WORLD.policeMax, stars * WANTED.policePerStar);
}

/**
 * Keep the pursuit fleet at strength: spawn interceptors on roads a few blocks from the
 * player (never in view if it can be helped), retire the far ones when the heat is gone.
 * `fleet` is the array of police cars; meshes are added/removed through the callbacks.
 */
export function maintainFleet(fleet, stars, player, city, rng, onAdd, onRemove) {
  const want = desiredPolice(stars);
  for (let i = fleet.length - 1; i >= 0; i -= 1) {
    const c = fleet[i];
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if ((stars === 0 && d > 40) || d > 190 || c.wrecked) {
      onRemove(c);
      fleet.splice(i, 1);
    }
  }
  let guard = 0;
  while (fleet.length < want && guard < 24) {
    guard += 1;
    const lines = city.roads;
    const vertical = rng.chance(0.5);
    const line = lines[rng.int(1, lines.length - 2)];
    const along = (vertical ? player.z : player.x) + rng.pick([-1, 1]) * rng.float(55, 85);
    const x = vertical ? line + 3.2 : Math.max(-city.size / 2 + 12, Math.min(city.size / 2 - 12, along));
    const z = vertical ? Math.max(-city.size / 2 + 12, Math.min(city.size / 2 - 12, along)) : line - 3.2;
    if (Math.hypot(x - player.x, z - player.z) < 48) continue;
    const car = createCar('police', 0xf2f2f2, x, z, rng.angle());
    car.driver = 'police';
    car.stuckT = 0; car.reverseT = 0; car.shootCd = rng.float(0.5, 1.5);
    fleet.push(car);
    onAdd(car);
  }
}

/**
 * Drive one interceptor for a frame: chase an intercept point ahead of the player, slow
 * to shadow him when close, back out when stuck on a building. At three stars or more the
 * officer fires on an on-foot player in range; hits are reported as events.
 */
export function stepPoliceCar(car, dt, player, playerCar, city, events, rng, shootAllowed = false) {
  car.fxT = (car.fxT || 0) + dt; // the lightbar strobes off the car's own clock
  const target = playerCar || player;
  const lead = playerCar ? 0.55 : 0.15;
  const tx = target.x + (target.vx || Math.sin(target.heading) * (target.speed || 0)) * lead;
  const tz = target.z + (target.vz || Math.cos(target.heading) * (target.speed || 0)) * lead;
  const dx = tx - car.x; const dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);

  if (car.reverseT > 0) {
    car.reverseT -= dt;
    car.speed = Math.max(-9, car.speed - 20 * dt);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    syncCarMesh(car, car.fxT);
    return;
  }
  let targetSpeed = 33.5;
  if (dist < 10) targetSpeed = Math.max(6, (playerCar ? Math.abs(playerCar.speed) : 4) + 2);
  if (dist < 4.2 && !playerCar) targetSpeed = 0; // on foot: the officer gets out — bust range
  driveToward(car, dt, desired, targetSpeed, 2.15);
  const before = { x: car.x, z: car.z };
  const fixed = collideBuildings(city, car.x, car.z, 1.9);
  car.x = fixed.x; car.z = fixed.z;
  // Stuck detection: barely moved while trying to drive.
  if (Math.abs(car.speed) > 8 && Math.hypot(car.x - before.x, car.z - before.z) < 0.05) {
    car.stuckT += dt;
    if (car.stuckT > 0.7) { car.reverseT = 0.65; car.stuckT = 0; }
  } else car.stuckT = Math.max(0, car.stuckT - dt);

  // Shooting: only at an on-foot player, only when the caller allows it (3+ stars).
  car.shootCd -= dt;
  if (shootAllowed && !playerCar && dist < 30 && dist > 3.5 && car.shootCd <= 0) {
    car.shootCd = rng.float(0.8, 1.5);
    events.push(rng.chance(0.42) ? 'policeHit' : 'policeMiss');
  }
  syncCarMesh(car, car.fxT);
}

/** True when this officer can see the player (close, roughly facing, not through a block). */
export function canSee(car, player) {
  const dx = player.x - car.x; const dz = player.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 55) return false;
  if (dist < 9) return true;
  const toPlayer = Math.atan2(dx, dz);
  return Math.abs(angleDelta(car.heading, toPlayer)) < 1.25;
}
