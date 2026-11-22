// missions.js — Sol's jobs, as a graph of steps.
//
// A mission is not a list of chores in a fixed order: it is a small directed
// graph. Each step (node) names one thing to do — go somewhere, get in a
// particular car, pick something up, collect crates, lose the heat, wait it
// out — and names the step that follows it. The Story walks the graph one node
// at a time, and a mission is done when the walk runs out of nodes. Side jobs
// are built the same way, from the same node kinds, with their targets rolled
// from the city's landmarks so no two feel identical.
//
// The Story never touches the world directly. It talks to the game through the
// small facade main.js hands it (playerPos, playerCar, wantedStars, spawnCarAt,
// addCash, onBrief, onAlarm, onPickup, setCrates, nearCrate, collectCrate and
// friends), and the main loop reads back target(), objective() and the
// 'complete' / 'failed' verdicts update() returns.

import { WANTED } from './config.js';
import { placePosition } from './city.js';

// ------------------------------------------------------------------ the graph

/**
 * One step of a job. `kind` says what counts as done:
 *   goto    reach the target point (on foot or in a car)
 *   enter   get into a car of `carType` (the job car, spawned at the step)
 *   pickup  reach the target and take the package (trips the alarm)
 *   carry   reach the target while carrying (follows a pickup)
 *   collect pick up every crate the step scattered (see `crates`)
 *   escape  lose the heat (zero stars) or reach the safehouse with 2 or fewer
 *   wait    stay at the target for `wait` seconds
 * `limit` is a countdown in seconds; `next` is the following node's id, or
 * null for the last step of the job.
 */
export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    brief: "Sol's coupe is waiting in the alley. Take it to the docks and don't scratch the paint.",
    payout: 150,
    nodes: [
      { id: 'take-car', kind: 'enter', carType: 'coupe', title: 'FIRST WHEELS', text: "Get in Sol's coupe — it's yours for the job", target: { place: 'fixerAlley', dx: 6, dz: 26 }, next: 'to-docks' },
      { id: 'to-docks', kind: 'goto', title: 'FIRST WHEELS', text: 'Take the coupe to Port Solano Docks', target: { place: 'docks' }, next: null },
    ],
  },
  {
    id: 'hot-package',
    title: 'Hot Package',
    brief: 'A package is sitting at the docks and the PSPD want it too. Grab it, run it to the marina, and try not to get made.',
    payout: 320,
    nodes: [
      { id: 'grab', kind: 'pickup', title: 'HOT PACKAGE', text: 'Pick up the package at the docks', target: { place: 'docks', dx: -10, dz: 8 }, next: 'deliver' },
      { id: 'deliver', kind: 'carry', title: 'HOT PACKAGE', text: 'Deliver to Marina Verde — lose them or outrun them', target: { place: 'marina' }, limit: 150, next: null },
    ],
  },
  {
    id: 'beach-salvage',
    title: 'Beach Salvage',
    brief: 'Three crates washed up on Solano Beach with Sol\'s name on them. Haul them to the chop shop, one run or three — your call.',
    payout: 420,
    nodes: [
      { id: 'to-beach', kind: 'goto', title: 'BEACH SALVAGE', text: 'Head to Solano Beach — the crates are in the sand', target: { place: 'beach' }, next: 'crates' },
      { id: 'crates', kind: 'collect', title: 'BEACH SALVAGE', text: 'Collect all 3 crates on the beach', target: { place: 'beach', dx: -8, dz: 4 }, crates: 3, next: 'to-garage' },
      { id: 'to-garage', kind: 'carry', title: 'BEACH SALVAGE', text: 'Drop the crates at the Chop Shop Garage', target: { place: 'garage' }, next: null },
    ],
  },
  {
    id: 'bank-run',
    title: 'The Bank Run',
    brief: 'Solano Trust is moving cash at noon and Sol wants a word with the courier. Be at the bank inside ninety seconds — then disappear.',
    payout: 650,
    nodes: [
      { id: 'to-bank', kind: 'goto', title: 'THE BANK RUN', text: 'Reach Solano Trust Bank before the window closes', target: { place: 'bank' }, limit: 90, next: 'vanish' },
      { id: 'vanish', kind: 'escape', title: 'THE BANK RUN', text: 'Lose the heat — zero stars, or reach the garage with 2 or fewer', target: { place: 'garage' }, next: null },
    ],
  },
  {
    id: 'big-score',
    title: 'The Big Score',
    brief: "The one Sol's been planning all year: lift the armored van at the docks, bring it to the bank, load the cash and run it to the marina. Then vanish.",
    payout: 1200,
    nodes: [
      { id: 'take-van', kind: 'enter', carType: 'armored', title: 'THE BIG SCORE', text: 'Steal the armored van at the docks', target: { place: 'docks', dx: 12, dz: -6 }, next: 'to-bank' },
      { id: 'to-bank', kind: 'goto', title: 'THE BIG SCORE', text: 'Take the van to the bank — the crew is waiting', target: { place: 'bank' }, limit: 120, next: 'load' },
      { id: 'load', kind: 'carry', title: 'THE BIG SCORE', text: 'Cash is loaded — deliver to Marina Verde', target: { place: 'marina' }, next: 'vanish' },
      { id: 'vanish', kind: 'escape', title: 'THE BIG SCORE', text: 'Lose the heat and the job is done', target: { place: 'garage' }, next: null },
    ],
  },
];

/** Landmarks a side job can send the player to, rolled fresh every time. */
const SIDE_PLACES = ['docks', 'marina', 'bank', 'garage', 'hospital', 'station', 'beach'];

/** Resolve a node's target {place, dx, dz} to world coordinates. */
function nodeTarget(node) {
  const base = placePosition(node.target.place);
  return { x: base.x + (node.target.dx || 0), z: base.z + (node.target.dz || 0) };
}

/** Distance on the ground between two points. */
function groundDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Build one side job from the node kinds: a fare, a courier run or a lookout. */
function buildSideJob(rng) {
  const pick = () => SIDE_PLACES[Math.floor(rng() * SIDE_PLACES.length)];
  const kind = Math.floor(rng() * 3);
  if (kind === 0) {
    const dest = pick();
    return {
      id: 'side-fare',
      title: 'Side Fare',
      brief: `A regular needs a fast driver to ${placePosition(dest).name}. Ninety seconds, no questions.`,
      payout: 90,
      side: true,
      nodes: [
        { id: 'fare', kind: 'goto', title: 'SIDE FARE', text: `Drop the fare at ${placePosition(dest).name} — fast`, target: { place: dest }, limit: 90, next: null },
      ],
    };
  }
  if (kind === 1) {
    const from = pick();
    let to = pick();
    while (to === from) to = pick();
    return {
      id: 'side-courier',
      title: 'Side Courier',
      brief: `Pick up a parcel at ${placePosition(from).name} and run it to ${placePosition(to).name}. Sol's cut is already taken.`,
      payout: 140,
      side: true,
      nodes: [
        { id: 'pickup', kind: 'pickup', title: 'SIDE COURIER', text: `Collect the parcel at ${placePosition(from).name}`, target: { place: from }, next: 'drop' },
        { id: 'drop', kind: 'carry', title: 'SIDE COURIER', text: `Deliver to ${placePosition(to).name}`, target: { place: to }, limit: 120, next: null },
      ],
    };
  }
  const spot = pick();
  return {
    id: 'side-lookout',
    title: 'Side Lookout',
    brief: `Sol needs eyes on ${placePosition(spot).name} for a few seconds. Stand there, look casual, and don't get made.`,
    payout: 110,
    side: true,
    nodes: [
      { id: 'watch', kind: 'wait', title: 'SIDE LOOKOUT', text: `Hold position at ${placePosition(spot).name} and keep watch`, target: { place: spot }, wait: 12, next: null },
    ],
  };
}

// ------------------------------------------------------------------ the story

/**
 * The story's progress through the job graph. `index` is the next story job
 * (0..4; done when it reaches 5), `sideCount` the side jobs finished, `active`
 * the job in progress or null, `lastPayout` what the last job paid. The save
 * system reads and writes index / sideCount directly.
 */
export class Story {
  constructor() {
    this.index = 0;
    this.sideCount = 0;
    this.active = null;
    this.done = false;
    this.lastPayout = 0;
  }

  /** Where the beacon points: the current step's target, or Sol's alley between jobs. */
  target() {
    if (this.active) return nodeTarget(this.active.node);
    return placePosition('fixerAlley');
  }

  /** The objective banner's content: the current step, or the next job's invite. */
  objective() {
    if (this.active) {
      const node = this.active.node;
      const timer = node.limit ? Math.max(0, node.limit - this.active.elapsed) : 0;
      return { title: node.title, text: node.text, timer };
    }
    if (!this.done) {
      const def = MISSIONS[this.index];
      return {
        title: `JOB ${this.index + 1} — ${def.title.toUpperCase()}`,
        text: 'Meet Sol at the alley — press E to take the job',
        timer: 0,
      };
    }
    return {
      title: 'SIDE WORK',
      text: 'Sol always has side work — press E at the alley',
      timer: 0,
    };
  }

  /** Take the next job: the next story mission, or a rolled side job once done. */
  start(game) {
    if (this.active) return;
    const def = this.index < MISSIONS.length ? MISSIONS[this.index] : buildSideJob(() => game.rng());
    this.active = {
      def,
      node: def.nodes[0],
      elapsed: 0,
      carrying: false,
      jobCar: null,
      waitT: 0,
      cratesLeft: [],
    };
    this.enterNode(game, this.active.node);
    game.onBrief(def.title, def.brief);
  }

  /** Side effects of arriving at a step: spawn its job car, scatter its crates. */
  enterNode(game, node) {
    if (!this.active) return;
    if (node.kind === 'enter') {
      const spot = nodeTarget(node);
      const color = node.carType === 'armored' ? 0x4a5058 : 0xd94f3d;
      this.active.jobCar = game.spawnCarAt(node.carType, color, spot.x + 4, spot.z, 0);
    } else if (node.kind === 'collect') {
      const centre = nodeTarget(node);
      const spots = [];
      for (let i = 0; i < (node.crates || 3); i += 1) {
        spots.push({ x: centre.x + (i - 1) * 7, z: centre.z + (i % 2 === 0 ? 5 : -6) });
      }
      game.setCrates(spots);
      this.active.cratesLeft = spots.map((s) => ({ x: s.x, z: s.z }));
    }
  }

  /** Fail the active job with a reason, clearing any crates it scattered. */
  fail(game, reason) {
    game.clearCrates();
    this.active = null;
    game.onFail(reason);
    return 'failed';
  }

  /**
   * Advance the active job one frame. Returns 'complete' when the last step
   * finishes (the main loop pays out the toast and saves), 'failed' when a
   * timer runs out or the job car is wrecked, and undefined otherwise.
   */
  update(dt, game) {
    if (!this.active) return undefined;
    const job = this.active;
    const node = job.node;
    job.elapsed += dt;

    // The job car is the job: wreck it and there is nothing left to do.
    if (job.jobCar && job.jobCar.wrecked) {
      return this.fail(game, 'The job car is wrecked — Sol is not paying for that.');
    }

    // A countdown that hits zero ends the job, whatever step it was on.
    if (node.limit && job.elapsed > node.limit) {
      return this.fail(game, 'Out of time — the window closed.');
    }

    const pos = game.playerPos();
    const target = nodeTarget(node);
    let stepDone = false;

    if (node.kind === 'goto' || node.kind === 'carry') {
      stepDone = groundDist(pos, target) < 6;
    } else if (node.kind === 'enter') {
      const car = game.playerCar();
      stepDone = Boolean(car && car.type === node.carType);
    } else if (node.kind === 'pickup') {
      if (groundDist(pos, target) < 5) {
        stepDone = true;
        job.carrying = true;
        game.onPickup();
        game.onAlarm(WANTED.crime.missionAlarm);
      }
    } else if (node.kind === 'collect') {
      if (game.nearCrate(pos, 5)) game.collectCrate(pos);
      const left = job.cratesLeft || [];
      stepDone = left.length === 0;
    } else if (node.kind === 'escape') {
      const stars = game.wantedStars();
      const safehouse = groundDist(pos, target) < 8;
      stepDone = stars === 0 || (safehouse && stars <= 2);
    } else if (node.kind === 'wait') {
      if (groundDist(pos, target) < 8) {
        job.waitT += dt;
        stepDone = job.waitT >= (node.wait || 10);
      } else {
        job.waitT = 0;
      }
    }

    if (!stepDone) return undefined;

    // Step done: follow the graph edge, or finish the job.
    game.onStep();
    job.elapsed = 0;
    job.waitT = 0;
    if (!node.next) {
      const payout = job.def.payout;
      game.addCash(payout);
      this.lastPayout = payout;
      if (job.def.side) this.sideCount += 1;
      else this.index += 1;
      this.done = this.index >= MISSIONS.length;
      this.active = null;
      return 'complete';
    }
    const next = job.def.nodes.find((n) => n.id === node.next);
    job.node = next;
    this.enterNode(game, next);
    return undefined;
  }
}
