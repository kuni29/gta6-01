// missions.js — the story of Neon Coast Heat: four jobs from fixer Sol Reyes that take Rico
// from broke wheelman to the big score, then endless side deliveries. A mission is a list
// of steps (go somewhere, take a car, collect crates, deliver clean); this module owns the
// state machine and talks to the rest of the game through the `game` facade main.js gives it.

import { PLACES } from './config.js';
import { placePosition } from './city.js';

/** The four story missions, in order. Payouts land the moment the last step completes. */
export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    payout: 175,
    brief: 'Sol: "A client left a coupe by Marina Verde. Take it to the docks — no questions, no dents. And Rico: little gold packages are stashed all over this city. You find one, it\'s yours."',
    steps: [
      { kind: 'goto', place: 'marina', label: 'Reach the marina', r: 13, dz: 18 },
      { kind: 'enterMissionCar', label: 'Get in the marked coupe' },
      { kind: 'goto', place: 'docks', label: 'Drive to the docks', r: 12, dz: 20, needCar: true },
    ],
    spawn: (game) => {
      const p = placePosition('marina');
      return game.spawnCarAt('coupe', 0xf2b13d, p.x + 16, p.z + 18, Math.PI);
    },
  },
  {
    id: 'hot-package',
    title: 'Hot Package',
    payout: 350,
    timeLimit: 150,
    brief: 'Sol: "Pick up the package behind Solano Trust. The bank\'s alarm disagrees with us — move fast."',
    steps: [
      { kind: 'goto', place: 'bank', label: 'Reach the bank\'s back lot', r: 12, dz: 20 },
      { kind: 'pickup', label: 'Grab the package', r: 4.5, dx: 10, dz: 17, alarm: true },
      { kind: 'goto', place: 'marina', label: 'Deliver to Marina Verde', r: 13, dz: 18 },
    ],
    spawn: () => null,
  },
  {
    id: 'beach-crates',
    title: 'Beach Run',
    payout: 500,
    timeLimit: 130,
    brief: 'Sol: "Three crates washed up along Solano Beach. Collect them all before the tide — or the PSPD — does."',
    steps: [
      { kind: 'collect', label: 'Collect the beach crates', count: 3 },
    ],
    spawn: (game) => {
      const spots = [
        { x: -120, z: 190 }, { x: 8, z: 192 }, { x: 128, z: 189 },
      ];
      game.setCrates(spots);
      return null;
    },
  },
  {
    id: 'big-score',
    title: 'The Big Score',
    payout: 1000,
    brief: 'Sol: "An armored van sits at the bank, full of other people\'s money. Bring it to the Chop Shop — clean."',
    steps: [
      { kind: 'goto', place: 'bank', label: 'Reach Solano Trust Bank', r: 12, dz: 20 },
      { kind: 'enterMissionCar', label: 'Steal the armored van' },
      { kind: 'deliverClean', place: 'garage', label: 'Deliver to the Chop Shop with no heat', r: 11, dz: 22, needCar: true },
    ],
    spawn: (game) => {
      const p = placePosition('bank');
      return game.spawnCarAt('armored', 0x4a5058, p.x - 6, p.z + 22, Math.PI / 2);
    },
  },
];

/**
 * The story state machine. States: 'offered' (Sol waits at her alley), 'active',
 * 'complete' (story done; side jobs on offer). main.js renders target()/objective().
 */
export class Story {
  constructor() {
    this.index = 0;           // next story mission
    this.active = null;       // { def, stepIdx, car, timeLeft, collected }
    this.sideCount = 0;
  }

  get done() { return this.index >= MISSIONS.length; }

  /** Where the player should head: the active step's target, or Sol's alley when offered. */
  target() {
    if (!this.active) {
      const p = placePosition('fixerAlley');
      return { x: p.x, z: p.z + 22, name: p.name, label: this.done ? 'Side job from Sol' : 'Meet Sol' };
    }
    const step = this.active.def.steps[this.active.stepIdx];
    return stepTarget(this.active, step);
  }

  /** HUD objective lines for the current state. */
  objective() {
    if (!this.active) {
      return this.done
        ? { title: 'FREE ROAM — SOL HAS SIDE WORK', text: 'Head to Sol\'s Alley for a delivery job', timer: 0 }
        : { title: `JOB ${this.index + 1} — ${MISSIONS[this.index].title}`, text: 'Head to Sol\'s Alley to take the job', timer: 0 };
    }
    const step = this.active.def.steps[this.active.stepIdx];
    let text = step.label;
    if (step.kind === 'collect') text = `${step.label} (${this.active.collected}/${step.count})`;
    if (step.kind === 'deliverClean') text = `${step.label}${this.active.gameWantedStars() > 0 ? ' — lose the heat first' : ''}`;
    return { title: this.active.def.title.toUpperCase(), text, timer: this.active.timeLeft || 0 };
  }

  /** Begin the next story mission (or a side job when the story is done). */
  start(game) {
    if (this.done) { this.startSideJob(game); return; }
    const def = MISSIONS[this.index];
    this.active = {
      def, stepIdx: 0, car: null, collected: 0,
      timeLeft: def.timeLimit || 0, gameWantedStars: () => game.wantedStars(),
    };
    this.active.car = def.spawn ? def.spawn(game) : null;
    game.onBrief(def.title, def.brief);
  }

  /** A repeatable delivery: take Sol's car across town against the clock. */
  startSideJob(game) {
    const dests = ['docks', 'marina', 'bank', 'garage', 'beach', 'hospital'];
    const dest = dests[Math.floor(game.rng() * dests.length)];
    const def = {
      id: 'side-job', title: 'Side Job — Delivery', payout: 150 + Math.floor(game.rng() * 110),
      timeLimit: 120, brief: `Sol: "Quick one, Rico. My sedan, to ${PLACES[dest].name}. Clock's running."`,
      steps: [
        { kind: 'enterMissionCar', label: 'Get in Sol\'s sedan' },
        { kind: 'goto', place: dest, label: `Deliver to ${PLACES[dest].name}`, r: 12, needCar: true },
      ],
    };
    this.active = {
      def, stepIdx: 0, car: null, collected: 0,
      timeLeft: def.timeLimit, gameWantedStars: () => game.wantedStars(),
    };
    const p = placePosition('fixerAlley');
    this.active.car = game.spawnCarAt('sedan', 0x7a4a5e, p.x + 2, p.z + 22, Math.PI / 2);
    game.onBrief(def.title, def.brief);
  }

  /**
   * Advance the active mission. Returns 'complete' | 'failed' | null; the caller pays out
   * or cleans up. Fail states: timer out, mission car wrecked, delivery car abandoned hot.
   */
  update(dt, game) {
    const a = this.active;
    if (!a) return null;
    if (a.timeLeft > 0) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) return this.fail(game, 'Out of time');
    }
    if (a.car && a.car.wrecked) return this.fail(game, 'The car is wrecked');
    const step = a.def.steps[a.stepIdx];
    const t = stepTarget(a, step);
    const p = game.playerPos();
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    switch (step.kind) {
      case 'goto':
        if (d < step.r && (!step.needCar || game.playerCar() === a.car || !a.car)) return this.advance(game);
        break;
      case 'enterMissionCar':
        if (a.car && game.playerCar() === a.car) {
          if (a.def.id === 'big-score') game.onAlarm(300);
          return this.advance(game);
        }
        break;
      case 'pickup':
        if (d < step.r) {
          if (step.alarm) game.onAlarm(200);
          game.onPickup();
          return this.advance(game);
        }
        break;
      case 'collect':
        if (game.nearCrate(p, 4)) {
          game.collectCrate(p);
          a.collected += 1;
          if (a.collected === 1) game.onAlarm(100);
          if (a.collected >= step.count) return this.complete(game);
        }
        break;
      case 'deliverClean':
        if (d < step.r && game.wantedStars() === 0 && game.playerCar() === a.car) return this.complete(game);
        break;
      default:
        break;
    }
    return null;
  }

  advance(game) {
    const a = this.active;
    a.stepIdx += 1;
    game.onStep(a.def.steps[a.stepIdx] ? a.def.steps[a.stepIdx].label : '');
    if (a.stepIdx >= a.def.steps.length) return this.complete(game);
    return null;
  }

  complete(game) {
    const def = this.active.def;
    const payout = def.payout;
    this.lastPayout = payout;
    if (def.id !== 'side-job') this.index += 1;
    else this.sideCount += 1;
    this.active = null;
    game.clearCrates();
    game.addCash(payout);
    return 'complete';
  }

  fail(game, reason) {
    if (this.active && this.active.car && game.playerCar() !== this.active.car) game.removeCar(this.active.car);
    this.active = null;
    game.clearCrates();
    game.onFail(reason);
    return 'failed';
  }
}

/** World target of a step: a place, the mission car, or the nearest remaining crate. */
function stepTarget(active, step) {
  if (step.kind === 'enterMissionCar' && active.car) {
    return { x: active.car.x, z: active.car.z, label: step.label };
  }
  if (step.kind === 'collect' && active.cratesLeft && active.cratesLeft.length) {
    const c = active.cratesLeft[0];
    return { x: c.x, z: c.z, label: step.label };
  }
  if (step.place) {
    const p = placePosition(step.place);
    return { x: p.x + (step.dx || 0), z: p.z + (step.dz || 0), name: p.name, label: step.label };
  }
  return { ...placePosition('fixerAlley'), label: step.label };
}
