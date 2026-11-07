import { Vec2, type Mat3 } from "wtc-math";
import { Bounds } from "./Bounds.js";

/**
 * An ordered run of points, optionally closed back to its start. This is the
 * unit a pen plotter draws: one pen-down stroke.
 *
 * Immutable: the constructor copies the points it is given and every operation
 * returns a new Polyline.
 */
export class Polyline {
  readonly points: readonly Vec2[];
  readonly closed: boolean;

  // Set while a method hands over a freshly built array, to skip the defensive copy.
  static #adopting = false;

  constructor(points: Iterable<Vec2>, closed = false) {
    const owned = Polyline.#adopting ? (points as Vec2[]) : Array.from(points, (p) => p.clone());
    this.points = Object.freeze(owned);
    this.closed = closed;
  }

  /** Wraps an array this module just built, without copying it again. */
  static #adopt(points: Vec2[], closed: boolean): Polyline {
    Polyline.#adopting = true;
    try {
      return new Polyline(points, closed);
    } finally {
      Polyline.#adopting = false;
    }
  }

  get pointCount(): number {
    return this.points.length;
  }

  /** Number of straight segments drawn, including the closing one. */
  get segmentCount(): number {
    const n = this.points.length;
    if (n < 2) return 0;
    return this.closed ? n : n - 1;
  }

  get start(): Vec2 | undefined {
    return this.points[0];
  }

  get end(): Vec2 | undefined {
    return this.points[this.points.length - 1];
  }

  /** Total drawn length in document units (mm), including the closing segment. */
  get length(): number {
    const pts = this.points;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i - 1].distance(pts[i]);
    if (this.closed && pts.length > 2) total += pts[pts.length - 1].distance(pts[0]);
    return total;
  }

  get bounds(): Bounds {
    return Bounds.fromPoints(this.points);
  }

  /** Applies a wtc-math Mat3 to every point. See `transforms.ts` for helpers. */
  transform(m: Mat3): Polyline {
    return Polyline.#adopt(
      this.points.map((p) => p.transformByMat3New(m)),
      this.closed,
    );
  }

  translate(offset: Vec2): Polyline {
    return Polyline.#adopt(
      this.points.map((p) => p.addNew(offset)),
      this.closed,
    );
  }

  reversed(): Polyline {
    return Polyline.#adopt(
      this.points.map((p) => p.clone()).reverse(),
      this.closed,
    );
  }

  /** Same points, joined back to the start. */
  close(): Polyline {
    return this.closed ? this : new Polyline(this.points, true);
  }

  clone(): Polyline {
    return new Polyline(this.points, this.closed);
  }
}

/** One path or a list of them, as a list. */
export function asList(paths: Polyline | readonly Polyline[]): readonly Polyline[] {
  return paths instanceof Polyline ? [paths] : paths;
}
