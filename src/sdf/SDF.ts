import { Vec2 } from "wtc-math";
import { Bounds } from "../geometry/Bounds.js";
import type { Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import {
  boundarySegments,
  distanceAt,
  distanceField,
  ringEdges,
  ringsOf,
} from "./distance.js";
import {
  DEFAULT_RESOLUTION,
  SDFGrid,
  windowFor,
  type GridWindow,
} from "./grid.js";

/** Options for {@link sdf}. */
export interface SDFOptions {
  /** How the shapes' rings combine. Default "nonzero", as in SVG. */
  rule?: FillRule;
}

/** Options for {@link SDF.sample}. */
export interface SampleOptions {
  /** Grid nodes per mm. Default 5 (0.2 mm cells). */
  resolution?: number;
  /** Extra room around the field's bounds, in mm. Default 2 cells. */
  pad?: number;
}

/**
 * A signed distance field: for every point on the page, how far it is from
 * the edge of a shape, in mm. Negative inside, positive outside, zero on the
 * edge.
 *
 * Fields are built from closed paths with `sdf()` and combined with
 * `union`, `intersect`, `subtract` and `offset`. Nothing is computed until
 * the field is sampled: then every part fills the same grid of nodes, on a
 * lattice pinned to the page, and the results are combined node by node.
 *
 * A field made by `sdf()` is exact. Combinations are not quite distances:
 * `union` and `subtract` report points inside as shallower than they are
 * near where the shapes meet. Contour fills rebuild an exact field from the
 * combined outline before using it (see `exact` on `contourHatch`).
 */
export abstract class SDF {
  /**
   * A box around the inside of the field (where it is negative), or null
   * when it has no inside. Generous rather than tight.
   */
  abstract readonly bounds: Bounds | null;

  /**
   * True when values inside the shape are true distances to its edge, which
   * is what contour fills need. Fields from `sdf()` are exact everywhere.
   */
  abstract readonly exact: boolean;

  /** The signed distance at (x, y) mm, computed directly. */
  abstract at(x: number, y: number): number;

  /** Fills `window`'s nodes. Subclasses implement this; use `sample()`. */
  abstract fill(window: GridWindow): Float64Array;

  /**
   * The field at every node of a grid covering its inside, plus `pad`.
   * Throws when the field has no inside.
   */
  sample(options: SampleOptions = {}): SDFGrid {
    const bounds = this.bounds;
    if (!bounds) throw new RangeError("SDF: the field has no inside to sample");
    const resolution = options.resolution ?? DEFAULT_RESOLUTION;
    const pad = options.pad ?? 2 / resolution;
    return this.sampleWindow(windowFor(bounds, resolution, pad));
  }

  /** The field at every node of `window`. */
  sampleWindow(window: GridWindow): SDFGrid {
    return new SDFGrid(window, this.fill(window));
  }

  /**
   * Inside either field. With `smooth` > 0 (mm), the two blend into each
   * other with a fillet about that wide where they meet.
   */
  union(other: SDF, smooth = 0): SDF {
    return new Combined("union", this, other, smooth);
  }

  /** Inside both fields. `smooth` rounds the creases where they meet. */
  intersect(other: SDF, smooth = 0): SDF {
    return new Combined("intersect", this, other, smooth);
  }

  /** Inside this field and outside `other`. `smooth` rounds the cut. */
  subtract(other: SDF, smooth = 0): SDF {
    return new Combined("subtract", this, other, smooth);
  }

  /**
   * Moves the edge outward by `distance` mm (inward when negative).
   * Shrinking an exact field keeps its inside exact. Growing keeps the
   * outside exact, but not the inside: where the grown shape fills in a
   * notch or bridges a gap, points there are deeper than the field says.
   */
  offset(distance: number): SDF {
    return new Offset(this, distance);
  }
}

/**
 * The exact signed distance field of the closed paths in `shapes` (open paths
 * are ignored), with their rings combined by `rule`. Distances are measured
 * to the true outline of the filled region: under nonzero, edges inside it
 * (where rings overlap) don't count.
 */
export function sdf(
  shapes: Polyline | readonly Polyline[],
  options: SDFOptions = {},
): SDF {
  return new ShapeField(shapes, options.rule ?? "nonzero");
}

class ShapeField extends SDF {
  readonly bounds: Bounds | null;
  readonly exact = true;
  readonly rule: FillRule;
  readonly #rings: Float64Array[];
  #segments: Float64Array | null = null;
  #edges: Float64Array | null = null;

  constructor(shapes: Polyline | readonly Polyline[], rule: FillRule) {
    super();
    this.rule = rule;
    this.#rings = ringsOf(shapes);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of this.#rings) {
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]);
        maxX = Math.max(maxX, ring[i]);
        minY = Math.min(minY, ring[i + 1]);
        maxY = Math.max(maxY, ring[i + 1]);
      }
    }
    this.bounds =
      minX <= maxX && minY <= maxY
        ? new Bounds(new Vec2(minX, minY), new Vec2(maxX, maxY))
        : null;
  }

  /** The outline of the filled region, as flat [ax, ay, bx, by, ...]. */
  get segments(): Float64Array {
    return (this.#segments ??= boundarySegments(this.#rings, this.rule));
  }

  at(x: number, y: number): number {
    this.#edges ??= ringEdges(this.#rings);
    return distanceAt(this.segments, this.#edges, this.rule, x, y);
  }

  fill(window: GridWindow): Float64Array {
    return distanceField(this.segments, this.#rings, this.rule, window);
  }
}

type Operation = "union" | "intersect" | "subtract";

class Combined extends SDF {
  readonly bounds: Bounds | null;
  readonly exact = false;
  readonly #op: Operation;
  readonly #a: SDF;
  readonly #b: SDF;
  readonly #k: number;

  constructor(op: Operation, a: SDF, b: SDF, smooth: number) {
    super();
    if (!(smooth >= 0) || !Number.isFinite(smooth)) {
      throw new RangeError("SDF: smooth must be zero or a positive number");
    }
    this.#op = op;
    this.#a = a;
    this.#b = b;
    this.#k = smooth;
    const ba = a.bounds;
    const bb = b.bounds;
    if (op === "union") {
      // A smooth union swells by up to k/4 where the shapes meet.
      const grown = (box: Bounds) => box.inset(-smooth / 4);
      this.bounds =
        ba && bb ? grown(ba.union(bb)) : ba ? grown(ba) : bb ? grown(bb) : null;
    } else if (op === "intersect") {
      this.bounds = ba && bb ? overlap(ba, bb) : null;
    } else {
      this.bounds = ba;
    }
  }

  at(x: number, y: number): number {
    return this.#combine(this.#a.at(x, y), this.#b.at(x, y));
  }

  fill(window: GridWindow): Float64Array {
    const a = this.#a.fill(window);
    const b = this.#b.fill(window);
    for (let k = 0; k < a.length; k++) a[k] = this.#combine(a[k], b[k]);
    return a;
  }

  #combine(a: number, b: number): number {
    const k = this.#k;
    switch (this.#op) {
      case "union":
        return smoothMin(a, b, k);
      case "intersect":
        return -smoothMin(-a, -b, k);
      case "subtract":
        return -smoothMin(-a, b, k);
    }
  }
}

class Offset extends SDF {
  readonly bounds: Bounds | null;
  readonly exact: boolean;
  readonly #field: SDF;
  readonly #distance: number;

  constructor(field: SDF, distance: number) {
    super();
    if (!Number.isFinite(distance)) {
      throw new RangeError("SDF: offset must be a finite number");
    }
    this.#field = field;
    this.#distance = distance;
    const b = field.bounds;
    this.bounds = b && distance > 0 ? b.inset(-distance) : b;
    // Eroding keeps inside distances exact; dilating only outside ones.
    this.exact = field.exact && distance <= 0;
  }

  at(x: number, y: number): number {
    return this.#field.at(x, y) - this.#distance;
  }

  fill(window: GridWindow): Float64Array {
    const data = this.#field.fill(window);
    for (let k = 0; k < data.length; k++) data[k] -= this.#distance;
    return data;
  }
}

/**
 * Polynomial smooth minimum: min(a, b) where they differ by more than k,
 * dipping by up to k/4 where they are equal. k = 0 is a plain min.
 */
export function smoothMin(a: number, b: number, k: number): number {
  const least = a < b ? a : b;
  const gap = Math.abs(a - b);
  // Also catches two infinities, whose gap is NaN.
  if (!(k > 0) || !(gap < k)) return least;
  const h = (k - gap) / k;
  return least - h * h * k * 0.25;
}

function overlap(a: Bounds, b: Bounds): Bounds | null {
  const minX = Math.max(a.min.x, b.min.x);
  const minY = Math.max(a.min.y, b.min.y);
  const maxX = Math.min(a.max.x, b.max.x);
  const maxY = Math.min(a.max.y, b.max.y);
  if (minX > maxX || minY > maxY) return null;
  return new Bounds(new Vec2(minX, minY), new Vec2(maxX, maxY));
}
