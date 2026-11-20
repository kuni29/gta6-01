// random.js — a tiny seeded random number generator (mulberry32) so the city, traffic and
// crowds are the same on every load for a given seed, and screenshot scenes are reproducible.

/** Create a generator from a numeric seed. Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Friendlier helpers over a generator: ranges, picks and shuffles, never Math.random. */
export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float(min = 1, max) { return max === undefined ? this.next() * min : min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  chance(p) { return this.next() < p; }
  /** A random heading in radians, [0, 2π) — spawn code was hand-rolling this. */
  angle() { return this.next() * Math.PI * 2; }
  /** A coin-flip sign, -1 or 1. */
  sign() { return this.next() < 0.5 ? -1 : 1; }
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }
}
