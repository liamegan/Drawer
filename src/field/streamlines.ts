import { Vec2 } from "wtc-math";
import type { HiddenTest } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { Region } from "../geometry/region.js";
import type { FillRule } from "../geometry/scanline.js";
import { simplify } from "../geometry/simplify.js";
import type { ScalarField, VectorField } from "./fields.js";

/** Options for {@link streamlines}. */
export interface StreamlineOptions {
  /** The closed shapes the lines fill. */
  region: Polyline | readonly Polyline[];
  /** How the region's rings combine. Default "nonzero", as in SVG. */
  rule?: FillRule;
  /**
   * Distance between neighbouring lines, in mm, or a function giving it at
   * each point for lines that crowd or thin out. Where the function returns
   * Infinity (or NaN) the region is left empty.
   */
  separation: number | ScalarField;
  /**
   * How close a growing line may come to another before it stops, as a
   * fraction of the separation. Default 0.5.
   */
  test?: number;
  /** Integration step, in mm. Default a quarter of the separation, at most 0.5. */
  step?: number;
  /** Lines shorter than this (mm) are dropped. Default one separation. */
  minLength?: number;
  /**
   * Longest line, in mm. A line that reaches it stops, and a new one starts a
   * separation further on, so the flow is drawn in dashes. Default Infinity.
   */
  maxLength?: number;
  /** Where to start the first lines. Default the middle of the region. */
  seeds?: readonly Vec2[];
  /**
   * Ends lines where this returns true, such as `sheet.mask.hiddenTest()`, so
   * the flow stops at ink already drawn instead of running underneath it.
   */
  stopAt?: HiddenTest;
  /** Drops points within this many mm of each line (RDP). Default 0.01. */
  simplify?: number;
}

/** Why one end of a line stopped. */
type Stop =
  "none" | "edge" | "collision" | "critical" | "hidden" | "length" | "steps";

/** One direction of a line, traced from its seed. */
interface Half {
  xs: number[];
  ys: number[];
  stop: Stop;
}

/**
 * Evenly spaced streamlines of `field` filling `region` (Jobard and Lefer,
 * 1997). Each line follows the field's direction (fourth-order Runge–Kutta)
 * both ways from a seed until it leaves the region, comes within `test`
 * separations of another line, or reaches a point where the field has no
 * direction. New seeds are tried a separation either side of every line, so
 * lines fill the region about one separation apart, without crowding closer
 * than `test` separations.
 *
 * Deterministic: the same inputs give the same lines. Lines come back in the
 * order they were made, each running with the field.
 */
export function streamlines(
  field: VectorField,
  options: StreamlineOptions,
): Polyline[] {
  const region = new Region(options.region, options.rule ?? "nonzero");
  const box = region.bounds;
  if (!box) return [];
  const test = options.test ?? 0.5;
  if (!(test > 0 && test <= 1)) {
    throw new RangeError("streamlines: test must be in (0, 1]");
  }
  const sepOption = options.separation;
  const separationAt: ScalarField =
    typeof sepOption === "number" ? () => sepOption : sepOption;
  if (typeof sepOption === "number" && !(sepOption > 0)) {
    throw new RangeError("streamlines: separation must be positive");
  }
  const smallest = smallestSeparation(separationAt, box);
  if (!(smallest < Infinity)) return [];
  const stepOption = options.step;
  if (stepOption !== undefined && !(stepOption > 0)) {
    throw new RangeError("streamlines: step must be positive");
  }
  const stepAt = (sep: number) => stepOption ?? Math.min(0.5, sep / 4);
  const maxLength = options.maxLength ?? Infinity;
  const stopAt = options.stopAt;
  const tolerance = options.simplify ?? 0.01;

  const grid = new PointGrid(box, smallest);
  const lines: { xs: number[]; ys: number[]; ends: [Stop, Stop] }[] = [];
  const queue: number[] = [];

  /** The separation at (x, y), or Infinity where the region is left empty. */
  const sep = (x: number, y: number) => {
    const s = separationAt(x, y);
    return s > 0 ? s : Infinity;
  };

  /** The field's unit direction at (x, y), times `sign`, into `out`. */
  const dir = new Float64Array(2);
  const direction = (x: number, y: number, sign: number): boolean => {
    const [dx, dy] = field(x, y);
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-12)) return false;
    dir[0] = (sign * dx) / length;
    dir[1] = (sign * dy) / length;
    return true;
  };

  /** Whether a new line may start at (x, y). */
  const seedable = (x: number, y: number) => {
    if (!region.contains(x, y)) return false;
    if (stopAt?.(x, y)) return false;
    const s = sep(x, y);
    if (!(s < Infinity)) return false;
    return !grid.near(x, y, s * 0.999, -1, 0, 0);
  };

  /**
   * Traces one way from the seed. Points go into the grid as they're made,
   * tagged with their arc position, so the line can run into its own
   * earlier stretch (closing an orbit) but not the points just behind it.
   */
  const trace = (
    x0: number,
    y0: number,
    sign: number,
    id: number,
    budget: number,
  ): Half => {
    const xs: number[] = [];
    const ys: number[] = [];
    let x = x0;
    let y = y0;
    let arc = 0;
    let px = NaN;
    let py = NaN;
    const k = new Float64Array(8);
    for (let steps = 0; steps < 200000; steps++) {
      const s = sep(x, y);
      if (!(s < Infinity)) return { xs, ys, stop: "critical" };
      let h = stepAt(s);
      if (arc + h > budget) h = budget - arc;
      if (!(h > 1e-9)) return { xs, ys, stop: "length" };
      // RK4 on the unit field.
      if (!direction(x, y, sign)) return { xs, ys, stop: "critical" };
      k[0] = dir[0];
      k[1] = dir[1];
      if (!direction(x + (h / 2) * k[0], y + (h / 2) * k[1], sign)) {
        return { xs, ys, stop: "critical" };
      }
      k[2] = dir[0];
      k[3] = dir[1];
      if (!direction(x + (h / 2) * k[2], y + (h / 2) * k[3], sign)) {
        return { xs, ys, stop: "critical" };
      }
      k[4] = dir[0];
      k[5] = dir[1];
      if (!direction(x + h * k[4], y + h * k[5], sign)) {
        return { xs, ys, stop: "critical" };
      }
      k[6] = dir[0];
      k[7] = dir[1];
      let qx = x + (h / 6) * (k[0] + 2 * k[2] + 2 * k[4] + k[6]);
      let qy = y + (h / 6) * (k[1] + 2 * k[3] + 2 * k[5] + k[7]);
      // A step that turns back on the last one, or barely moves, has reached
      // a sink or a saddle, where the direction flips: within half a step of
      // a sink, RK4's samples cancel out and the step goes nowhere.
      if (xs.length > 0 && (qx - x) * (x - px) + (qy - y) * (y - py) < 0) {
        return { xs, ys, stop: "critical" };
      }
      if (Math.hypot(qx - x, qy - y) < 0.25 * h) {
        return { xs, ys, stop: "critical" };
      }

      let stop: Stop = "none";
      const t = region.exit(x, y, qx, qy);
      if (t >= 0) {
        qx = x + (qx - x) * t;
        qy = y + (qy - y) * t;
        stop = "edge";
      }
      if (stopAt?.(qx, qy)) {
        // Find where the ink starts, to within a hundredth of the step.
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          if (stopAt(x + (qx - x) * mid, y + (qy - y) * mid)) hi = mid;
          else lo = mid;
        }
        qx = x + (qx - x) * lo;
        qy = y + (qy - y) * lo;
        stop = "hidden";
      }
      const length = Math.hypot(qx - x, qy - y);
      const qs = sep(qx, qy);
      const reach = test * (qs < Infinity ? qs : s);
      if (grid.near(qx, qy, reach, id, sign * (arc + length), 2 * s)) {
        return { xs, ys, stop: "collision" };
      }
      arc += length;
      px = x;
      py = y;
      x = qx;
      y = qy;
      xs.push(x);
      ys.push(y);
      grid.add(x, y, id, sign * arc);
      if (stop !== "none") return { xs, ys, stop };
      if (arc >= budget - 1e-9) return { xs, ys, stop: "length" };
    }
    return { xs, ys, stop: "steps" };
  };

  /** Traces a line both ways from a seed; keeps it if it's long enough. */
  const grow = (x: number, y: number): boolean => {
    const id = lines.length;
    grid.add(x, y, id, 0);
    // `maxLength` covers the whole line: the way back gets what's left.
    const ahead = trace(x, y, 1, id, maxLength);
    let aheadLength = 0;
    for (let i = 0; i < ahead.xs.length; i++) {
      const px = i > 0 ? ahead.xs[i - 1] : x;
      const py = i > 0 ? ahead.ys[i - 1] : y;
      aheadLength += Math.hypot(ahead.xs[i] - px, ahead.ys[i] - py);
    }
    const behind = trace(x, y, -1, id, maxLength - aheadLength);
    const xs = [...behind.xs.reverse(), x, ...ahead.xs];
    const ys = [...behind.ys.reverse(), y, ...ahead.ys];
    let length = 0;
    for (let i = 1; i < xs.length; i++) {
      length += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    const minLength = options.minLength ?? sep(x, y);
    lines.push({ xs, ys, ends: [behind.stop, ahead.stop] });
    if (xs.length < 2 || length < minLength) {
      grid.kill(id);
      return false;
    }
    queue.push(id);
    return true;
  };

  /** Tries seeds a separation either side of line `id`, and past dashed ends. */
  const spread = (id: number) => {
    const { xs, ys, ends } = lines[id];
    const n = xs.length;
    let next = 0;
    let arc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) arc += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      if (arc < next) continue;
      const s = sep(xs[i], ys[i]);
      if (!(s < Infinity)) continue;
      next = arc + s / 2;
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let tx = xs[b] - xs[a];
      let ty = ys[b] - ys[a];
      const tl = Math.hypot(tx, ty);
      if (!(tl > 0)) continue;
      tx /= tl;
      ty /= tl;
      for (const side of [1, -1]) {
        // Offset by the separation here, or there if that's wider.
        let d = s;
        const there = sep(xs[i] - side * ty * d, ys[i] + side * tx * d);
        if (there > d && there < Infinity) d = there;
        const cx = xs[i] - side * ty * d;
        const cy = ys[i] + side * tx * d;
        if (seedable(cx, cy)) grow(cx, cy);
      }
    }
    // A line cut short by `maxLength` carries on after a gap.
    for (const [end, stop] of [
      [0, ends[0]],
      [n - 1, ends[1]],
    ] as const) {
      if (stop !== "length" || n < 2) continue;
      const inner = end === 0 ? 1 : n - 2;
      const ex = xs[end] - xs[inner];
      const ey = ys[end] - ys[inner];
      const el = Math.hypot(ex, ey);
      const s = sep(xs[end], ys[end]);
      if (!(el > 0) || !(s < Infinity)) continue;
      const cx = xs[end] + (ex / el) * s;
      const cy = ys[end] + (ey / el) * s;
      if (seedable(cx, cy)) grow(cx, cy);
    }
  };

  const run = () => {
    while (queue.length > 0) spread(queue.shift()!);
  };

  const seeds = options.seeds ?? [box.center];
  for (const seed of seeds) {
    if (seedable(seed.x, seed.y) && grow(seed.x, seed.y)) run();
  }
  // Anything the flow didn't reach (separate parts of the region, or corners
  // the lines skirted): scan for room and start again from there.
  const scan = smallest;
  for (let y = box.min.y + scan / 2; y < box.max.y; y += scan) {
    for (let x = box.min.x + scan / 2; x < box.max.x; x += scan) {
      if (seedable(x, y) && grow(x, y)) run();
    }
  }

  const out: Polyline[] = [];
  lines.forEach(({ xs, ys }, id) => {
    if (!grid.alive(id)) return;
    const path = new Polyline(xs.map((x, i) => new Vec2(x, ys[i])));
    out.push(tolerance > 0 ? simplify(path, tolerance) : path);
  });
  return out;
}

/**
 * The smallest separation over the region's box, sampled on a grid (and at
 * the corners and centre), for sizing the collision grid.
 */
function smallestSeparation(
  separation: ScalarField,
  box: { min: Vec2; max: Vec2 },
): number {
  let least = Infinity;
  const n = 48;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const s = separation(
        box.min.x + ((box.max.x - box.min.x) * i) / n,
        box.min.y + ((box.max.y - box.min.y) * j) / n,
      );
      if (s > 0 && s < least) least = s;
    }
  }
  return least;
}

/**
 * Placed line points in a uniform grid, as linked lists per cell. Each
 * point remembers its line and arc position along it, so a line can ignore
 * the points just behind it, and a dropped line's points can be ignored.
 */
class PointGrid {
  readonly #x0: number;
  readonly #y0: number;
  readonly #cell: number;
  readonly #cols: number;
  readonly #rows: number;
  readonly #head: Int32Array;
  #xs = new Float64Array(1024);
  #ys = new Float64Array(1024);
  #arcs = new Float64Array(1024);
  #line = new Int32Array(1024);
  #next = new Int32Array(1024);
  #count = 0;
  readonly #dead = new Set<number>();

  constructor(box: { min: Vec2; max: Vec2 }, smallest: number) {
    const pad = smallest;
    const width = box.max.x - box.min.x + 2 * pad;
    const height = box.max.y - box.min.y + 2 * pad;
    // Cells about one separation wide, but never more than ~4M of them.
    const cell = Math.max(smallest, Math.sqrt((width * height) / 4e6));
    this.#x0 = box.min.x - pad;
    this.#y0 = box.min.y - pad;
    this.#cell = cell;
    this.#cols = Math.ceil(width / cell) + 1;
    this.#rows = Math.ceil(height / cell) + 1;
    this.#head = new Int32Array(this.#cols * this.#rows).fill(-1);
  }

  add(x: number, y: number, line: number, arc: number): void {
    if (this.#count === this.#xs.length) this.#grow();
    const k = this.#count++;
    this.#xs[k] = x;
    this.#ys[k] = y;
    this.#arcs[k] = arc;
    this.#line[k] = line;
    const c = this.#cellOf(x, y);
    this.#next[k] = this.#head[c];
    this.#head[c] = k;
  }

  /** Forget a line's points. */
  kill(line: number): void {
    this.#dead.add(line);
  }

  alive(line: number): boolean {
    return !this.#dead.has(line);
  }

  /**
   * Whether any live point lies within `radius` of (x, y), ignoring points
   * of line `line` within `lag` of arc position `arc` along it.
   */
  near(
    x: number,
    y: number,
    radius: number,
    line: number,
    arc: number,
    lag: number,
  ): boolean {
    const cell = this.#cell;
    const r2 = radius * radius;
    const i0 = Math.max(0, Math.floor((x - radius - this.#x0) / cell));
    const i1 = Math.min(
      this.#cols - 1,
      Math.floor((x + radius - this.#x0) / cell),
    );
    const j0 = Math.max(0, Math.floor((y - radius - this.#y0) / cell));
    const j1 = Math.min(
      this.#rows - 1,
      Math.floor((y + radius - this.#y0) / cell),
    );
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (
          let k = this.#head[j * this.#cols + i];
          k >= 0;
          k = this.#next[k]
        ) {
          const dx = this.#xs[k] - x;
          const dy = this.#ys[k] - y;
          if (dx * dx + dy * dy >= r2) continue;
          const owner = this.#line[k];
          if (owner === line && Math.abs(this.#arcs[k] - arc) < lag) continue;
          if (this.#dead.size > 0 && this.#dead.has(owner)) continue;
          return true;
        }
      }
    }
    return false;
  }

  #cellOf(x: number, y: number): number {
    const i = Math.min(
      this.#cols - 1,
      Math.max(0, Math.floor((x - this.#x0) / this.#cell)),
    );
    const j = Math.min(
      this.#rows - 1,
      Math.max(0, Math.floor((y - this.#y0) / this.#cell)),
    );
    return j * this.#cols + i;
  }

  #grow(): void {
    const size = this.#xs.length * 2;
    const widen = <T extends Float64Array | Int32Array>(a: T, b: T) => {
      b.set(a);
      return b;
    };
    this.#xs = widen(this.#xs, new Float64Array(size));
    this.#ys = widen(this.#ys, new Float64Array(size));
    this.#arcs = widen(this.#arcs, new Float64Array(size));
    this.#line = widen(this.#line, new Int32Array(size));
    this.#next = widen(this.#next, new Int32Array(size));
  }
}
