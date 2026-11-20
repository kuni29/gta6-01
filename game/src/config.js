// config.js — every tuning constant for Neon Coast Heat in one place: the city grid, the
// player and car handling, the wanted system and the economy. Other modules import from here
// and hold no magic numbers of their own.

/** The city is a square grid of blocks. One block plus its road share is CELL units across. */
export const CITY = {
  blocksPerSide: 9,          // 9 x 9 blocks of city, ocean to the south
  cell: 44,                  // world units per block+road pitch
  roadWidth: 14,             // asphalt width between building lots
  get size() { return this.blocksPerSide * this.cell; }, // 396 units across
};

/** World landmarks, in block coordinates (converted to world units by city.js). */
export const PLACES = {
  fixerAlley: { bx: 4, bz: 5, name: "Sol's Alley" },
  docks: { bx: 7, bz: 8, name: 'Port Solano Docks' },
  marina: { bx: 1, bz: 8, name: 'Marina Verde' },
  bank: { bx: 4, bz: 1, name: 'Solano Trust Bank' },
  garage: { bx: 1, bz: 2, name: 'Chop Shop Garage' },
  hospital: { bx: 6, bz: 2, name: 'St. Lucia Hospital' },
  station: { bx: 2, bz: 6, name: 'PSPD Station' },
  beach: { bx: 4, bz: 8, name: 'Solano Beach' },
};

export const PLAYER = {
  walkSpeed: 7,
  runSpeed: 12.5,
  radius: 0.85,
  maxHealth: 100,
  punchRange: 2.4,
  punchDamage: 34,
  gunRange: 60,
  gunDamage: 40,
};

export const CAR = {
  accel: 26,
  brake: 34,
  reverseMax: 12,
  drag: 0.55,
  gripTurn: 2.35,            // steering rate, scaled by speed
  radius: 1.9,
  maxHealth: 100,
};

/** Wanted tuning: heat is a 0..500 float; each whole 100 is one star. */
export const WANTED = {
  maxStars: 5,
  perStar: 100,
  decayPerSecond: 3.2,       // while no police see the player
  seenDecayPerSecond: 0.6,   // while in sight it barely cools
  crime: {
    stealCar: 55,
    hitPedestrian: 130,
    hitCar: 35,
    shootNear: 45,
    shootHit: 80,
    punch: 30,
    missionAlarm: 200,       // the big score starts at two stars
  },
  policePerStar: 2,          // active pursuit cars per star
  bustFillPerSecond: 0.55,   // how fast the bust meter fills when cornered
  bustDrainPerSecond: 0.8,
};

export const ECONOMY = {
  startCash: 20,
  bustedFineRate: 0.25,      // share of cash lost when busted
  wastedFee: 60,             // hospital fee, flat
  saveKey: 'neon-coast-heat-save-v1',
};

export const WORLD = {
  trafficCars: 16,
  parkedCars: 14,
  pedestrians: 26,
  policeMax: 10,
  sunColor: 0xffe3b3,
  fogColor: 0xf2c99a,
};
