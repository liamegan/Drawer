import { Vec2 } from "wtc-math";
import type { Bounds } from "../geometry/Bounds.js";

/** cyrb128: hashes a string into four 32-bit seeds for sfc32. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Seeded pseudo-random numbers (sfc32). The same seed always produces the
 * same sequence, so a seed fully reproduces an artwork.
 */
export class Random {
  /** The seed this generator was created from, as a string. */
  readonly seed: string;
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: number | string) {
    this.seed = String(seed);
    [this.#a, this.#b, this.#c, this.#d] = cyrb128(this.seed);
    // Discard the first outputs, which are weakly mixed for similar seeds.
    for (let i = 0; i < 15; i++) this.value();
  }

  /**
   * An independent generator derived from this one's SEED (not its current
   * state) and `label`. Drawing more numbers from the parent never changes
   * what a fork produces, so separate parts of a sketch can't disturb each other.
   */
  fork(label: string): Random {
    return new Random(`${this.seed}/${label}`);
  }

  /** A float in [0, 1). */
  value(): number {
    this.#a |= 0;
    this.#b |= 0;
    this.#c |= 0;
    this.#d |= 0;
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** A float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.value();
  }

  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.value() * (hi - lo + 1));
  }

  /** True with probability `p`. */
  bool(p = 0.5): boolean {
    return this.value() < p;
  }

  /** A random element of `items`. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Random.pick needs a non-empty array");
    return items[Math.floor(this.value() * items.length)];
  }

  /**
   * A weighted choice: each option comes up in proportion to its weight.
   * Give `{ name: weight }` to get a name back, or `[value, weight]` pairs
   * for any values. Options are laid out in the order given and one
   * `value()` is drawn, so `weighted({ a: 1, b: 2 })` picks "a" exactly when
   * `value() < 1/3` would have been true. Zero weights never come up.
   * Throws on a negative or non-finite weight, or when nothing has weight.
   */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K;
  weighted<T>(choices: readonly (readonly [T, number])[]): T;
  weighted<T>(
    choices: Readonly<Record<string, number>> | readonly (readonly [T, number])[],
  ): T | string {
    const list: readonly (readonly [T | string, number])[] = Array.isArray(choices)
      ? choices
      : Object.entries(choices);
    let total = 0;
    for (const [, w] of list) {
      if (!(w >= 0) || !Number.isFinite(w)) {
        throw new RangeError("Random.weighted: weights must be finite and not negative");
      }
      total += w;
    }
    if (!(total > 0)) throw new RangeError("Random.weighted needs a weight above 0");
    const r = this.value() * total;
    let sum = 0;
    let last: T | string = list[0][0];
    for (const [item, w] of list) {
      if (w === 0) continue;
      sum += w;
      last = item;
      if (r < sum) return item;
    }
    return last; // Only reached through rounding at the very top.
  }

  /** A shuffled copy of `items` (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.value() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Normally distributed number (Box–Muller). */
  gaussian(mean = 0, sd = 1): number {
    const u = 1 - this.value(); // (0, 1], so log() stays finite
    const v = this.value();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A uniformly random point inside `bounds`. */
  pointIn(bounds: Bounds): Vec2 {
    return bounds.at(this.value(), this.value());
  }
}
