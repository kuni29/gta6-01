// city.js — generates the Port Solano city layout as plain data (no rendering): building
// lots with heights and pastel colours, collision boxes, the road centre-lines traffic
// drives on, palm positions, sidewalk spawn points and the named landmarks the missions
// use. scene.js turns this data into meshes; vehicles.js and people.js walk its roads.

import { CITY, PLACES } from './config.js';
import { Rng } from './random.js';

/** Sun-bleached pastel facades: cream, peach, mint, sky, coral, sand, lilac, white. */
const FACADE_COLORS = [0xf6e3c5, 0xf7c8a0, 0xbfe3c0, 0xa8d4f0, 0xf6a48f, 0xead9a8, 0xd9c6ec, 0xf2f0eb, 0xffd9e8, 0xb8e6e0];
const ROOF_COLORS = [0xb0563a, 0x8a6f55, 0x707a84, 0x9c4f42, 0x5f7d8c];

/** World x/z of a block's centre from its block coordinates. */
export function blockCentre(bx, bz) {
  return { x: (bx - (CITY.blocksPerSide - 1) / 2) * CITY.cell, z: (bz - (CITY.blocksPerSide - 1) / 2) * CITY.cell };
}

/** World position of a named place from config.PLACES. */
export function placePosition(key) {
  const p = PLACES[key];
  const c = blockCentre(p.bx, p.bz);
  return { x: c.x, z: c.z, name: p.name };
}

/** Road centre-lines: the asphalt runs between the lots, at half-cell offsets. */
export function roadLines() {
  const half = CITY.size / 2;
  const lines = [];
  for (let i = 0; i <= CITY.blocksPerSide; i += 1) lines.push(-half + i * CITY.cell);
  return lines; // same for x (vertical roads) and z (horizontal roads)
}

/**
 * Generate the whole city from a seed. Returns buildings (with colliders), palms, the
 * park, dock crates and lists of spawn points for parked cars and pedestrians.
 */
export function generateCity(seed) {
  const rng = new Rng(seed);
  const n = CITY.blocksPerSide;
  const lot = CITY.cell - CITY.roadWidth; // 30 units of lot per block
  const buildings = [];
  const colliders = [];
  const palms = [];
  const crates = [];
  const parkedSpots = [];
  const pedSpots = [];

  const parkBlock = { bx: 6, bz: 5 };
  const addBuilding = (x, z, w, d, h) => {
    const b = {
      x, z, w, d, h,
      color: rng.pick(FACADE_COLORS),
      roof: rng.pick(ROOF_COLORS),
      tex: rng.int(0, 3),
    };
    buildings.push(b);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    return b;
  };

  for (let bz = 0; bz < n; bz += 1) {
    for (let bx = 0; bx < n; bx += 1) {
      const c = blockCentre(bx, bz);
      const isPark = bx === parkBlock.bx && bz === parkBlock.bz;
      const isBeachRow = bz === n - 1;
      const downtown = Math.hypot(bx - 4, bz - 3) <= 2.2;
      if (isPark) {
        // Solano Green: no buildings, a loose grove of palms handled below.
        for (let i = 0; i < 7; i += 1) palms.push({ x: c.x + rng.float(-12, 12), z: c.z + rng.float(-12, 12), s: rng.float(0.9, 1.3) });
      } else if (isBeachRow && bx % 3 === 1) {
        // Beachfront lots stay open sand with palms; the docks get crates instead.
        for (let i = 0; i < 3; i += 1) palms.push({ x: c.x + rng.float(-12, 12), z: c.z + rng.float(-6, 10), s: rng.float(0.9, 1.25) });
        if (bx === 7) for (let i = 0; i < 6; i += 1) crates.push({ x: c.x + rng.float(-11, 11), z: c.z + rng.float(-11, 6), r: rng.float(0, 3) });
      } else {
        // One to four buildings per lot, taller downtown, low at the edges.
        const tall = downtown ? rng.float(17, 40) : rng.float(6.5, 16);
        const layout = rng.int(1, 3);
        if (layout === 1) {
          addBuilding(c.x, c.z - 2, lot - 4, lot - 8, tall);
        } else if (layout === 2) {
          addBuilding(c.x - 8, c.z - 2, 13, lot - 8, tall * rng.float(0.6, 1));
          addBuilding(c.x + 8, c.z - 2, 13, lot - 8, tall * rng.float(0.6, 1));
        } else {
          addBuilding(c.x - 8, c.z - 8, 13, 13, tall * rng.float(0.55, 0.95));
          addBuilding(c.x + 8, c.z - 8, 13, 13, tall * rng.float(0.55, 0.95));
          addBuilding(c.x, c.z + 8, lot - 6, 12, tall * rng.float(0.4, 0.7));
        }
      }
      // Palms along the south sidewalk of most blocks.
      if (rng.chance(0.75)) palms.push({ x: c.x + rng.float(-13, 13), z: c.z + lot / 2 + 3.4, s: rng.float(0.85, 1.2) });
      // Pedestrians stroll the lot perimeter (the sidewalk ring).
      pedSpots.push({ x: c.x, z: c.z, ring: lot / 2 + 2.6 });
    }
  }

  // Parked cars nose-in along the vertical roads, clear of intersections.
  const lines = roadLines();
  for (let i = 1; i < lines.length - 1; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!rng.chance(0.42)) continue;
      const c = blockCentre(0, j);
      parkedSpots.push({ x: lines[i] + (rng.chance(0.5) ? 4.6 : -4.6), z: c.z + rng.float(-9, 9), vertical: true });
    }
  }
  // A second, sparser rank along the horizontal roads, so the east-west streets offer
  // stealable cars too instead of leaving whole avenues empty.
  for (let i = 1; i < lines.length - 1; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!rng.chance(0.3)) continue;
      const c = blockCentre(j, 0);
      parkedSpots.push({ x: c.x + rng.float(-9, 9), z: lines[i] + (rng.chance(0.5) ? 4.6 : -4.6), vertical: false });
    }
  }

  return {
    buildings, colliders, palms, crates, parkedSpots, pedSpots,
    roads: lines,
    park: blockCentre(parkBlock.bx, parkBlock.bz),
    size: CITY.size,
  };
}

/** Circle-vs-buildings collision: push (x, z) with radius r out of every collider it overlaps. */
export function collideBuildings(city, x, z, r) {
  let px = x; let pz = z;
  for (let i = 0; i < city.colliders.length; i += 1) {
    const c = city.colliders[i];
    const nx = Math.max(c.minX, Math.min(px, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pz, c.maxZ));
    const dx = px - nx; const dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      px = nx + (dx / d) * r; pz = nz + (dz / d) * r;
    } else {
      // Centre inside the box: leave by the nearest face.
      const left = px - c.minX; const right = c.maxX - px;
      const top = pz - c.minZ; const bottom = c.maxZ - pz;
      const m = Math.min(left, right, top, bottom);
      if (m === left) px = c.minX - r; else if (m === right) px = c.maxX + r;
      else if (m === top) pz = c.minZ - r; else pz = c.maxZ + r;
    }
  }
  const lim = city.size / 2 + 8;
  px = Math.max(-lim, Math.min(lim, px));
  pz = Math.max(-lim, Math.min(lim, pz));
  return { x: px, z: pz };
}

/** True when the point sits inside any building footprint (used to keep spawns honest). */
export function insideBuilding(city, x, z, pad = 0) {
  for (let i = 0; i < city.colliders.length; i += 1) {
    const c = city.colliders[i];
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
  }
  return false;
}
