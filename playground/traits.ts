import type { Random } from "wtc-drawer";

export type TraitValue = string | number | boolean;

/**
 * Records a seed's traits: the choices that give a piece its character,
 * named, like fxhash features. Sketches get one through `draw`'s fourth
 * argument. The playground shows them in the HUD and panel, writes them into
 * the SVG's description, and tallies them over a batch export.
 */
export class Traits {
  readonly #values = new Map<string, TraitValue>();

  /**
   * A weighted choice (see `Random.weighted`), recorded under `name`. It
   * draws exactly one number from `random`.
   */
  pick<K extends string>(
    name: string,
    random: Random,
    weights: Readonly<Record<K, number>>,
  ): K {
    const value = random.weighted(weights);
    this.#values.set(name, value);
    return value;
  }

  /** Records a trait worked out some other way, such as a count. */
  set<T extends TraitValue>(name: string, value: T): T {
    this.#values.set(name, value);
    return value;
  }

  get size(): number {
    return this.#values.size;
  }

  entries(): [string, TraitValue][] {
    return [...this.#values];
  }

  toJSON(): Record<string, TraitValue> {
    return Object.fromEntries(this.#values);
  }

  /** "View: oblique · Stones: 3" */
  toString(): string {
    return this.entries()
      .map(([name, value]) => `${name}: ${value}`)
      .join(" · ");
  }
}

/** Counts how often each trait value comes up over many seeds. */
export class TraitTally {
  readonly #counts = new Map<string, Map<string, number>>();
  #seeds = 0;

  add(traits: Traits): void {
    this.#seeds++;
    for (const [name, value] of traits.entries()) {
      let counts = this.#counts.get(name);
      if (!counts) this.#counts.set(name, (counts = new Map()));
      const key = String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  get seeds(): number {
    return this.#seeds;
  }

  /** `{ View: { oblique: 31, orthographic: 19 } }`, commonest first. */
  toJSON(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [name, counts] of this.#counts) {
      const sorted = [...counts].sort((a, b) => b[1] - a[1]);
      out[name] = Object.fromEntries(sorted);
    }
    return out;
  }

  /** "View: oblique 62%, orthographic 38% · …" */
  toString(): string {
    const pct = (n: number) => `${Math.round((100 * n) / this.#seeds)}%`;
    return Object.entries(this.toJSON())
      .map(
        ([name, counts]) =>
          `${name}: ` +
          Object.entries(counts)
            .map(([value, n]) => `${value} ${pct(n)}`)
            .join(", "),
      )
      .join(" · ");
  }
}
