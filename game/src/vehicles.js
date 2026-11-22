// vehicles.js — the cars of Port Solano: low-poly merged-mesh models (one draw call each),
// arcade driving physics for the player's car, and traffic that follows the road grid from
// intersection to intersection, braking for the car ahead. Police cars are built here too;
// police.js drives them.

import { CAR } from './config.js';
import { collideBuildings, insideBuilding } from './city.js';
import { mergeParts, partMaterial } from './scene.js';

export const CAR_TYPES = {
  coupe: { name: 'Solano Coupe', topSpeed: 34, colors: [0xd94f3d, 0x3d7bd9, 0xf2b13d, 0x53b06a, 0x9b59b6] },
  sedan: { name: 'Palmetto Sedan', topSpeed: 29, colors: [0xc0c6cc, 0x5a6a7a, 0x7a4a5e, 0x39594f] },
  taxi: { name: 'Solano Cab', topSpeed: 29, colors: [0xf7c948] },
  van: { name: 'Marina Van', topSpeed: 25, colors: [0xd8d3c8, 0x87a8b8, 0xb8524a] },
  buggy: { name: 'Dune Buggy', topSpeed: 31, colors: [0xe07b39, 0x39b0a5] },
  police: { name: 'PSPD Interceptor', topSpeed: 36, colors: [0xf2f2f2] },
  armored: { name: 'Armored Van', topSpeed: 24, colors: [0x4a5058] },
};
const TYPE_KEYS = Object.keys(CAR_TYPES).filter((k) => k !== 'police' && k !== 'armored');

/** A random factory colour for a car type, drawn from a seeded generator. */
export function randomPaint(typeKey, rng) {
  return rng.pick(CAR_TYPES[typeKey].colors);
}

let sharedMat = null;

/** Build a car's mesh: body, cabin, wheels and lights merged into one vertex-colour mesh. */
export function makeCarMesh(typeKey, color) {
  if (!sharedMat) sharedMat = partMaterial();
  const dark = 0x1c1f24;
  const glass = 0x2c4a5e;
  let parts;
  if (typeKey === 'van' || typeKey === 'armored') {
    parts = [
      { w: 2.2, h: 1.7, d: 4.6, x: 0, y: 1.15, z: 0, color },
      { w: 2.0, h: 0.6, d: 0.9, x: 0, y: 0.75, z: 2.5, color },
      { w: 1.9, h: 0.5, d: 0.1, x: 0, y: 1.35, z: 2.92, color: glass },
      { w: 0.4, h: 0.8, d: 0.8, x: -1.05, y: 0.4, z: 1.5, color: dark },
      { w: 0.4, h: 0.8, d: 0.8, x: 1.05, y: 0.4, z: 1.5, color: dark },
      { w: 0.4, h: 0.8, d: 0.8, x: -1.05, y: 0.4, z: -1.5, color: dark },
      { w: 0.4, h: 0.8, d: 0.8, x: 1.05, y: 0.4, z: -1.5, color: dark },
    ];
  } else {
    parts = [
      { w: 2.0, h: 0.55, d: 4.3, x: 0, y: 0.55, z: 0, color },
      { w: 2.06, h: 0.22, d: 0.5, x: 0, y: 0.42, z: 2.1, color: 0x9aa0a6 },
      { w: 2.06, h: 0.22, d: 0.5, x: 0, y: 0.42, z: -2.1, color: 0x9aa0a6 },
      { w: 1.7, h: 0.52, d: 2.0, x: 0, y: 1.06, z: -0.25, color: glass },
      { w: 1.74, h: 0.1, d: 2.04, x: 0, y: 1.34, z: -0.25, color },
      { w: 0.38, h: 0.72, d: 0.72, x: -0.98, y: 0.36, z: 1.42, color: dark },
      { w: 0.38, h: 0.72, d: 0.72, x: 0.98, y: 0.36, z: 1.42, color: dark },
      { w: 0.38, h: 0.72, d: 0.72, x: -0.98, y: 0.36, z: -1.42, color: dark },
      { w: 0.38, h: 0.72, d: 0.72, x: 0.98, y: 0.36, z: -1.42, color: dark },
      { w: 0.34, h: 0.16, d: 0.08, x: -0.62, y: 0.68, z: 2.16, color: 0xfff2b0 },
      { w: 0.34, h: 0.16, d: 0.08, x: 0.62, y: 0.68, z: 2.16, color: 0xfff2b0 },
      { w: 0.34, h: 0.14, d: 0.08, x: -0.62, y: 0.68, z: -2.16, color: 0xd93d3d },
      { w: 0.34, h: 0.14, d: 0.08, x: 0.62, y: 0.68, z: -2.16, color: 0xd93d3d },
    ];
    if (typeKey === 'taxi') parts.push({ w: 0.9, h: 0.22, d: 0.4, x: 0, y: 1.5, z: -0.25, color: 0xffe95c });
    if (typeKey === 'buggy') parts.push({ w: 1.8, h: 0.14, d: 0.3, x: 0, y: 1.15, z: -1.9, color });
  }
  const group = new THREE.Group();
  const body = new THREE.Mesh(mergeParts(parts), sharedMat);
  body.castShadow = true;
  group.add(body);
  let lightbar = null;
  if (typeKey === 'police') lightbar = makeLightbar(group);
  return { group, lightbar };
}

// Police lightbar colours: the lit lamp, its dark unlit glass, per side.
const LAMP = {
  red: 0xff2222, redOff: 0x4a0d12,
  blue: 0x2a6aff, blueOff: 0x0d1e4a,
};

/**
 * Build a PSPD lightbar as separate lamp meshes on a dark housing — deliberately NOT
 * merged like the body — so the red and blue halves can strobe against each other.
 * Each lamp also gets a soft additive halo box that only shows while that lamp is lit,
 * which is what sells the flash on walls, road and screenshots. Returns the handles
 * updateLightbar drives; the meshes ride on the car group, so they inherit its motion.
 */
function makeLightbar(group) {
  const bar = new THREE.Group();
  const housing = new THREE.Mesh(
    mergeParts([{ w: 1.5, h: 0.13, d: 0.52, x: 0, y: 1.44, z: -0.25, color: 0x14161a }]),
    sharedMat,
  );
  bar.add(housing);
  const lampGeo = new THREE.BoxGeometry(0.58, 0.2, 0.46);
  const red = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: LAMP.red }));
  red.position.set(-0.43, 1.56, -0.25);
  const blue = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: LAMP.blue }));
  blue.position.set(0.43, 1.56, -0.25);
  const haloGeo = new THREE.BoxGeometry(1.05, 0.62, 0.9);
  const haloMat = (color) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const redHalo = new THREE.Mesh(haloGeo, haloMat(LAMP.red));
  redHalo.position.copy(red.position);
  const blueHalo = new THREE.Mesh(haloGeo, haloMat(LAMP.blue));
  blueHalo.position.copy(blue.position);
  bar.add(red, blue, redHalo, blueHalo);
  group.add(bar);
  return { red, blue, redHalo, blueHalo };
}

/**
 * Strobe a police lightbar at time t: the red and blue lamps alternate at ~7 Hz, the
 * lit one throwing its halo while the other drops to dark glass. Each car's phase is
 * offset by its strobeSeed so a whole fleet never blinks in unison. At t <= 0 both
 * lamps burn steady — the pose the screenshot scenes freeze.
 */
export function updateLightbar(car, t) {
  const lb = car.lightbar;
  if (!lb) return;
  if (t <= 0) {
    lb.red.material.color.setHex(LAMP.red);
    lb.blue.material.color.setHex(LAMP.blue);
    lb.redHalo.material.opacity = 0.16;
    lb.blueHalo.material.opacity = 0.16;
    return;
  }
  const redOn = Math.floor(t * 7 + (car.strobeSeed || 0)) % 2 === 0;
  lb.red.material.color.setHex(redOn ? LAMP.red : LAMP.redOff);
  lb.blue.material.color.setHex(redOn ? LAMP.blueOff : LAMP.blue);
  lb.redHalo.material.opacity = redOn ? 0.3 : 0.0;
  lb.blueHalo.material.opacity = redOn ? 0.0 : 0.3;
}

/** A car entity: physics state plus its mesh, parked or driven by traffic/police/player. */
export function createCar(typeKey, color, x, z, heading) {
  const { group, lightbar } = makeCarMesh(typeKey, color);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  return {
    type: typeKey, name: CAR_TYPES[typeKey].name, color,
    x, z, heading, speed: 0, health: CAR.maxHealth,
    mesh: group, lightbar, driver: null, // null | 'traffic' | 'police' | 'player'
    route: null, wrecked: false, honkAt: 0,
    fxT: 0, // this car's own effects clock (drives the lightbar strobe)
    // A deterministic per-car strobe phase from its spawn point, in half-cycles.
    strobeSeed: Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 2,
  };
}

/** Spawn the ambient fleet: moving traffic on the grid plus parked cars at the kerb. */
export function spawnFleet(city, rng, count, parkedCount) {
  const cars = [];
  const lines = city.roads;
  for (let i = 0; i < count; i += 1) {
    const type = rng.pick(TYPE_KEYS);
    const vertical = rng.chance(0.5);
    const li = rng.int(1, lines.length - 2);
    const along = rng.float(-city.size / 2 + 20, city.size / 2 - 20);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = 3.2;
    const x = vertical ? lines[li] + (dir > 0 ? lane : -lane) : along;
    const z = vertical ? along : lines[li] + (dir > 0 ? -lane : lane);
    if (insideBuilding(city, x, z, 3)) continue;
    const heading = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const car = createCar(type, rng.pick(CAR_TYPES[type].colors), x, z, heading);
    car.driver = 'traffic';
    car.route = { vertical, lineIdx: li, dir, targetIdx: nearestLineIdx(lines, along, dir) };
    car.speed = rng.float(7, 11);
    cars.push(car);
  }
  for (let i = 0; i < parkedCount && i < city.parkedSpots.length; i += 1) {
    const spot = city.parkedSpots[Math.floor(rng.next() * city.parkedSpots.length)];
    const type = rng.pick(TYPE_KEYS);
    const car = createCar(type, rng.pick(CAR_TYPES[type].colors), spot.x, spot.z, spot.vertical ? 0 : Math.PI / 2);
    car.driver = null;
    cars.push(car);
  }
  return cars;
}

function nearestLineIdx(lines, along, dir) {
  let best = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (dir > 0 && lines[i] > along + 4) { best = i; break; }
    if (dir < 0 && lines[i] < along - 4) best = i;
    if (dir > 0) best = Math.max(best, 0);
  }
  return Math.max(0, Math.min(lines.length - 1, best));
}

/** Signed smallest angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Move a car kinematically: accelerate toward a target speed and steer toward a heading. */
export function driveToward(car, dt, targetHeading, targetSpeed, turnRate = 2.4) {
  const d = angleDelta(car.heading, targetHeading);
  const maxTurn = turnRate * dt;
  car.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
  const accel = targetSpeed > car.speed ? 14 : 30;
  car.speed += Math.max(-accel * dt, Math.min(accel * dt, targetSpeed - car.speed));
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}

/** Traffic update: follow the grid, choose turns at intersections, brake for cars ahead. */
export function stepTraffic(car, dt, city, cars, rng) {
  const lines = city.roads;
  const r = car.route;
  const lane = 3.2;
  // Target: the next intersection centre, offset into this car's lane.
  let tx; let tz;
  if (r.vertical) { tx = lines[r.lineIdx] + (r.dir > 0 ? lane : -lane); tz = lines[r.targetIdx]; }
  else { tx = lines[r.targetIdx]; tz = lines[r.lineIdx] + (r.dir > 0 ? -lane : lane); }
  const dx = tx - car.x; const dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4.5) {
    // Arrived: continue to the following intersection, or turn onto the crossing road.
    const choice = rng.next();
    const nextIdx = r.targetIdx + r.dir;
    const canStraight = nextIdx >= 1 && nextIdx <= lines.length - 2;
    if (choice < 0.62 && canStraight) {
      r.targetIdx = nextIdx;
    } else {
      // Turn: swap axes at this intersection.
      const turnDir = rng.chance(0.5) ? 1 : -1;
      const newLineIdx = r.targetIdx;
      r.vertical = !r.vertical;
      r.dir = turnDir;
      r.lineIdx = newLineIdx;
      const ahead = (r.vertical ? car.z : car.x);
      r.targetIdx = nearestLineIdx(lines, ahead, turnDir);
      if (r.targetIdx === newLineIdx) r.targetIdx = Math.max(1, Math.min(lines.length - 2, newLineIdx + turnDir));
    }
    return;
  }
  let targetSpeed = 11.5;
  // Brake for a car ahead in roughly the same lane.
  const fx = Math.sin(car.heading); const fz = Math.cos(car.heading);
  for (const other of cars) {
    if (other === car) continue;
    const ox = other.x - car.x; const oz = other.z - car.z;
    const ahead = ox * fx + oz * fz;
    const side = Math.abs(ox * fz - oz * fx);
    if (ahead > 0 && ahead < 8 && side < 2.4) { targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 5) * 2)); }
  }
  const desired = Math.atan2(dx, dz);
  driveToward(car, dt, desired, targetSpeed, 2.0);
  const fixed = collideBuildings(city, car.x, car.z, CAR.radius);
  car.x = fixed.x; car.z = fixed.z;
  syncCarMesh(car);
}

/** Player driving: throttle/steer input, arcade grip, building collision, crash events. */
export function stepPlayerCar(car, dt, input, city, events) {
  const type = CAR_TYPES[car.type];
  const throttle = input.throttle();
  const steer = input.steer();
  if (car.wrecked) throttle && events.push('wreckedPush');
  if (!car.wrecked) {
    if (throttle > 0) car.speed += CAR.accel * dt * (1 - Math.max(0, car.speed) / (type.topSpeed * 1.15));
    else if (throttle < 0) {
      car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.accel * 0.6) * dt;
      if (car.speed < -CAR.reverseMax) car.speed = -CAR.reverseMax;
    }
  }
  car.speed -= car.speed * CAR.drag * dt * 0.35;
  if (throttle === 0 && Math.abs(car.speed) < 0.25) car.speed = 0;
  const speedRatio = Math.min(1, Math.abs(car.speed) / 22);
  if (car.speed !== 0) {
    car.heading += steer * CAR.gripTurn * dt * speedRatio * (car.speed > 0 ? 1 : -1) * -1;
  }
  const px = car.x; const pz = car.z;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const fixed = collideBuildings(city, car.x, car.z, CAR.radius);
  if ((fixed.x !== car.x || fixed.z !== car.z) && Math.abs(car.speed) > 6) {
    events.push('crashBuilding');
    car.health -= Math.abs(car.speed) * 0.55;
    car.speed *= -0.25;
  }
  car.x = fixed.x; car.z = fixed.z;
  if (px === car.x && pz === car.z && throttle !== 0) car.speed *= 0.9;
  car.fxT += dt; // a stolen interceptor keeps strobing while the player drives it
  syncCarMesh(car, car.fxT);
  return speedRatio;
}

/** Circle collisions between every pair of cars: push apart, trade speed, report hard hits. */
export function resolveCarCollisions(cars, events, playerCar) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i]; const b = cars[j];
      const dx = b.x - a.x; const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = 3.4;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = dx / d; const nz = dz / d;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
      const rel = Math.abs(a.speed) + Math.abs(b.speed);
      if (rel > 7) {
        const involvesPlayer = a === playerCar || b === playerCar;
        if (involvesPlayer) events.push('crashCar');
        a.health -= rel * 0.4; b.health -= rel * 0.4;
        a.speed *= 0.55; b.speed *= 0.55;
      } else {
        a.speed *= 0.85; b.speed *= 0.85;
      }
      syncCarMesh(a); syncCarMesh(b);
    }
  }
}

/**
 * Copy a car's physics state into its mesh and strobe its lightbar, if it has one.
 * The strobe reads `time` when the caller passes a clock (the main loop does for
 * parked cars), and falls back to the car's own effects clock otherwise — police.js
 * and the player driver advance that clock themselves.
 */
export function syncCarMesh(car, time = 0) {
  car.mesh.position.set(car.x, car.wrecked ? -0.12 : 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z = car.wrecked ? 0.04 : 0;
  if (car.lightbar) updateLightbar(car, time || car.fxT || 0);
  if (car.health <= 0 && !car.wrecked) car.wrecked = true;
}
