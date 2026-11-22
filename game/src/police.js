// police.js — the Port Solano Police Department's response to Rico's heat.
//
// Heat is a 0..500 float and every whole 100 is one wanted star. Crimes add heat
// (less when nobody saw it happen); heat cools over time, faster when no officer
// has eyes on the player, so lying low in an alley actually works. The fleet
// scales with the stars: two pursuit cars per star, capped, with extra roles at
// higher heat — chasers who ram, interceptors who cut across the player's path,
// and, at three stars and up, officers who shoot from their cars.
//
// A pursuit car is a small state machine of its own: it picks a lane on the road
// grid near the player when it spawns, chases with a look-ahead point so it
// corners instead of tail-chasing, and falls back to a roadblock posture when it
// gets ahead of the player. Line of sight is a distance plus a facing cone —
// the department's eyes are good, but they are not x-ray.

import { WANTED, WORLD } from './config.js';
import { createCar, driveToward, syncCarMesh } from './vehicles.js';
import { collideBuildings } from './city.js';

// ------------------------------------------------------------------ wanted

/** How much heat a crime adds when nobody witnesses it, as a share of the full amount. */
const UNSEEN_SHARE = 0.45;
/** The fleet never holds more cars than this, whatever the stars say. */
const FLEET_CAP = WORLD.policeMax;
/** An officer opens fire inside this range (only once the heat allows it). */
const SHOOT_RANGE = 26;
/** A ramming hit needs this much cooldown before the same car can hurt again. */
const RAM_COOLDOWN = 0.9;

/**
 * The wanted level. `heat` is the raw 0..500 float; `stars` is derived from it,
 * so setting heat (an alarm, a staged screenshot) moves the stars with it.
 * `bust` is the 0..1 meter that fills while the player is cornered, and `seen`
 * is refreshed every frame by the main loop's line-of-sight checks.
 */
export class WantedSystem {
  constructor() {
    this.heat = 0;
    this.bust = 0;
    this.seen = false;
  }

  /** Whole stars from the current heat, capped at the config maximum. */
  get stars() {
    return Math.min(WANTED.maxStars, Math.floor(this.heat / WANTED.perStar));
  }

  /**
   * Add a crime's heat. A witnessed crime counts in full; an unwitnessed one
   * still counts, just less — someone always phones it in eventually.
   */
  addCrime(kind, witnessed) {
    const base = WANTED.crime[kind] || 0;
    const share = witnessed ? 1 : UNSEEN_SHARE;
    this.heat = Math.min(WANTED.maxStars * WANTED.perStar, this.heat + base * share);
  }

  /** Cool the heat down. Hiding out of sight cools much faster than hiding in it. */
  update(dt) {
    const rate = this.seen ? WANTED.seenDecayPerSecond : WANTED.decayPerSecond;
    this.heat = Math.max(0, this.heat - rate * dt);
    if (this.bust > 0) {
      this.bust = Math.max(0, this.bust - WANTED.bustDrainPerSecond * dt);
    }
  }

  /** Walk out of the station a free person: no heat, no bust meter, unseen. */
  clear() {
    this.heat = 0;
    this.bust = 0;
    this.seen = false;
  }
}

/** How many pursuit cars a wanted level fields: two per star, capped by the fleet cap. */
export function desiredPolice(stars) {
  return Math.min(FLEET_CAP, Math.max(0, stars) * WANTED.policePerStar);
}

// ------------------------------------------------------------------ spawning

/** Pick a spawn point on a road line near the player, offset down the road. */
function spawnPointNear(player, city, rng) {
  const lines = city.roads;
  const vertical = rng.chance(0.5);
  // The nearest road line to the player on the chosen axis.
  let bestLine = lines[0];
  let bestD = Infinity;
  for (const line of lines) {
    const d = Math.abs(line - (vertical ? player.x : player.z));
    if (d < bestD) { bestD = d; bestLine = line; }
  }
  const along = rng.float(26, 62) * (rng.chance(0.5) ? 1 : -1);
  const lane = rng.chance(0.5) ? 3.4 : -3.4;
  let x;
  let z;
  if (vertical) {
    x = bestLine + lane;
    z = player.z + along;
  } else {
    x = player.x + along;
    z = bestLine + lane;
  }
  const fixed = collideBuildings(city, x, z, 2.2);
  const heading = Math.atan2(player.x - fixed.x, player.z - fixed.z);
  return { x: fixed.x, z: fixed.z, heading };
}

/**
 * Keep the fleet at the size the stars demand. New cars spawn on the roads near
 * the player with a pursuit role; surplus cars drive off the books from the back
 * of the list. onAdd / onRemove wire the car's mesh into and out of the scene.
 */
export function maintainFleet(fleet, stars, player, city, rng, onAdd, onRemove) {
  const want = desiredPolice(stars);
  while (fleet.length < want) {
    const spot = spawnPointNear(player, city, rng);
    const car = createCar('police', 0xf2f2f2, spot.x, spot.z, spot.heading);
    car.driver = 'police';
    car.speed = rng.float(9, 14);
    // Two in three cars chase; the rest try to cut the player off instead.
    car.role = rng.chance(0.66) ? 'chase' : 'intercept';
    car.shootCd = rng.float(0.4, 1.2);
    car.ramCd = 0;
    car.blockT = 0;
    fleet.push(car);
    onAdd(car);
  }
  while (fleet.length > want) {
    const car = fleet.pop();
    if (car) onRemove(car);
  }
}

// ------------------------------------------------------------------ pursuit

/** Where a car is actually going: the player, or their car when they drive. */
function pursuitTarget(player, playerCar) {
  return playerCar || player;
}

/** The point a chaser steers at: a little ahead of the target, so it corners. */
function lookAheadPoint(target, seconds) {
  const vx = target.vx || 0;
  const vz = target.vz || 0;
  const speed = Math.hypot(vx, vz);
  if (target.speed !== undefined && speed < 0.5) {
    // Cars carry speed on a heading instead of a velocity vector.
    return {
      x: target.x + Math.sin(target.heading) * target.speed * seconds,
      z: target.z + Math.cos(target.heading) * target.speed * seconds,
    };
  }
  return { x: target.x + vx * seconds, z: target.z + vz * seconds };
}

/** Can this officer see the target: close enough and inside the facing cone. */
export function canSee(car, player) {
  const dx = player.x - car.x;
  const dz = player.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 52) return false;
  if (dist < 4) return true;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const dot = (dx * fx + dz * fz) / dist;
  // A ~115° forward cone: the PSPD notice trouble ahead of them, not behind.
  return dot > -0.18;
}

/**
 * One pursuit car's frame. Chasers steer at a look-ahead point and ram when
 * they close in; interceptors aim far ahead of the target to cut it off, then
 * hold a blocking line across the road. At three stars and up the officer
 * shoots from the window, and a hard ram hurts the player — both on cooldowns.
 * `events` collects 'policeHit' / 'policeMiss' for the main loop.
 */
export function stepPoliceCar(car, dt, player, playerCar, city, events, rng, shootAllowed = false) {
  const target = pursuitTarget(player, playerCar);
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);

  car.shootCd = Math.max(0, (car.shootCd || 0) - dt);
  car.ramCd = Math.max(0, (car.ramCd || 0) - dt);
  car.fxT = (car.fxT || 0) + dt;

  let aim;
  let topSpeed;
  if (car.role === 'intercept' && dist > 18) {
    // Cut across: aim well ahead of where the target is going, not where it is.
    aim = lookAheadPoint(target, 1.5);
    topSpeed = 33;
  } else if (dist < 7 && playerCar) {
    // Close in on a driven car: aim at its nose and push through it.
    aim = lookAheadPoint(target, 0.25);
    topSpeed = 34;
  } else {
    aim = lookAheadPoint(target, 0.55);
    topSpeed = dist > 42 ? 36 : 30;
  }
  const wantHeading = Math.atan2(aim.x - car.x, aim.z - car.z);

  driveToward(car, dt, wantHeading, topSpeed, 2.7);
  const fixed = collideBuildings(city, car.x, car.z, 2.0);
  car.x = fixed.x;
  car.z = fixed.z;
  syncCarMesh(car, car.fxT);

  // Ramming the player on foot hurts — once per cooldown, and only up close.
  if (!playerCar && dist < 2.4 && car.ramCd <= 0) {
    car.ramCd = RAM_COOLDOWN;
    car.speed *= 0.4;
    events.push('policeHit');
  }
  // Ramming the player's car: a shove, reported through the collision system.
  if (playerCar && dist < 3.6 && car.ramCd <= 0) {
    car.ramCd = RAM_COOLDOWN;
    playerCar.speed *= 0.82;
  }

  // Shooting: only with the heat to allow it, in range, roughly facing the player.
  if (shootAllowed && dist < SHOOT_RANGE && car.shootCd <= 0) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const dot = (dx * fx + dz * fz) / Math.max(dist, 0.001);
    if (dot > 0.35) {
      car.shootCd = rng.float(0.75, 1.5);
      // Hit odds fall with distance and rise with the player's exposure.
      const targetSpeed = playerCar ? Math.abs(playerCar.speed) : Math.hypot(player.vx || 0, player.vz || 0);
      const hitChance = Math.max(0.12, 0.55 - dist * 0.012 - targetSpeed * 0.008);
      events.push(rng.chance(hitChance) ? 'policeHit' : 'policeMiss');
    }
  }
}
