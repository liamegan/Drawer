import { Bounds } from "./Bounds.js";
import { shapeEdges } from "./clip.js";
import type { Polyline } from "./Polyline.js";
import type { FillRule } from "./scanline.js";

/**
 * Closed shapes, indexed so that point-in-region tests and "where does this
 * step leave the region" queries look only at nearby edges. Exact under
 * either fill rule, and consistent with `windingAt`.
 *
 * Edges are bucketed into horizontal bands: a winding number only needs the
 * edges that span its row, and a short step only meets edges in the bands it
 * crosses.
 */
export class Region {
  readonly rule: FillRule;
  /** Bounds of the edges, or null for an empty region. */
  readonly bounds: Bounds | null;
  readonly #edges: Float64Array;
  readonly #y0: number;
  readonly #band: number;
  readonly #bands: number;
  /** Edge indices for band b are #items[#start[b] .. #start[b + 1]). */
  readonly #start: Int32Array;
  readonly #items: Int32Array;
  readonly #seen: Int32Array;
  #stamp = 0;

  constructor(
    shapes: Polyline | readonly Polyline[],
    rule: FillRule = "nonzero",
  ) {
    this.rule = rule;
    const edges = shapeEdges(shapes);
    this.#edges = edges;
    const count = edges.length / 4;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let total = 0;
    for (let e = 0; e < count; e++) {
      const ax = edges[4 * e];
      const ay = edges[4 * e + 1];
      const bx = edges[4 * e + 2];
      const by = edges[4 * e + 3];
      minX = Math.min(minX, ax, bx);
      maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
      total += Math.abs(by - ay);
    }
    this.bounds =
      count > 0 ? Bounds.fromRect(minX, minY, maxX - minX, maxY - minY) : null;
    const height = Math.max(maxY - minY, 1e-9);
    // Bands about as tall as an average edge, so each edge lands in a few.
    const bands = Math.max(
      1,
      Math.min(
        4096,
        Math.ceil(height / Math.max(total / Math.max(count, 1), height / 4096)),
      ),
    );
    this.#y0 = count > 0 ? minY : 0;
    this.#band = height / bands;
    this.#bands = bands;

    const counts = new Int32Array(bands + 1);
    const range = (e: number): [number, number] => {
      const ay = edges[4 * e + 1];
      const by = edges[4 * e + 3];
      return [this.#bandOf(Math.min(ay, by)), this.#bandOf(Math.max(ay, by))];
    };
    for (let e = 0; e < count; e++) {
      const [b0, b1] = range(e);
      for (let b = b0; b <= b1; b++) counts[b + 1]++;
    }
    for (let b = 0; b < bands; b++) counts[b + 1] += counts[b];
    this.#start = counts.slice();
    const items = new Int32Array(counts[bands]);
    const fill = counts.slice();
    for (let e = 0; e < count; e++) {
      const [b0, b1] = range(e);
      for (let b = b0; b <= b1; b++) items[fill[b]++] = e;
    }
    this.#items = items;
    this.#seen = new Int32Array(count);
  }

  /** Winding number of the region's edges around (x, y). */
  winding(x: number, y: number): number {
    if (
      !this.bounds ||
      y < this.#y0 ||
      y > this.#y0 + this.#band * this.#bands
    ) {
      return 0;
    }
    const b = this.#bandOf(y);
    const edges = this.#edges;
    let w = 0;
    for (let k = this.#start[b]; k < this.#start[b + 1]; k++) {
      const i = 4 * this.#items[k];
      const ax = edges[i];
      const ay = edges[i + 1];
      const bx = edges[i + 2];
      const by = edges[i + 3];
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
        w--;
      }
    }
    return w;
  }

  /** Whether winding number `w` counts as inside under the region's rule. */
  insideBy(w: number): boolean {
    return this.rule === "evenodd" ? (w & 1) !== 0 : w !== 0;
  }

  /** Whether (x, y) is inside under the region's fill rule. */
  contains(x: number, y: number): boolean {
    return this.insideBy(this.winding(x, y));
  }

  /**
   * Where the step p→q leaves the region, as t in [0, 1], or -1 if it stays
   * inside. p should be inside or on the edge. The stretches between the
   * step's edge crossings are classified by the exact winding at their
   * middles, so a step that starts exactly on an edge, or passes through a
   * vertex, can't be miscounted. Returns 0 when p is on the edge and the step
   * heads out.
   */
  exit(px: number, py: number, qx: number, qy: number): number {
    if (!this.bounds) return 0;
    const hits = this.#crossings(px, py, qx, qy);
    if (hits.length === 0) return -1;
    hits.push(1);
    let from = 0;
    for (const to of hits) {
      if (to - from > 1e-12) {
        const m = (from + to) / 2;
        if (!this.contains(px + (qx - px) * m, py + (qy - py) * m)) return from;
      }
      from = to;
    }
    return -1;
  }

  /** Parameters t in [0, 1] where p→q crosses an edge, sorted. */
  #crossings(px: number, py: number, qx: number, qy: number): number[] {
    const out: number[] = [];
    const rx = qx - px;
    const ry = qy - py;
    const minX = Math.min(px, qx);
    const maxX = Math.max(px, qx);
    const b0 = this.#bandOf(Math.min(py, qy));
    const b1 = this.#bandOf(Math.max(py, qy));
    const stamp = ++this.#stamp;
    const edges = this.#edges;
    for (let b = b0; b <= b1; b++) {
      for (let k = this.#start[b]; k < this.#start[b + 1]; k++) {
        const e = this.#items[k];
        if (this.#seen[e] === stamp) continue;
        this.#seen[e] = stamp;
        const i = 4 * e;
        const ax = edges[i];
        const ay = edges[i + 1];
        const ex = edges[i + 2] - ax;
        const ey = edges[i + 3] - ay;
        if (Math.max(ax, ax + ex) < minX || Math.min(ax, ax + ex) > maxX) {
          continue;
        }
        const denom = rx * ey - ry * ex;
        if (denom === 0) continue;
        const wx = ax - px;
        const wy = ay - py;
        const t = (wx * ey - wy * ex) / denom;
        const u = (wx * ry - wy * rx) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(t);
      }
    }
    return out.sort((a, b) => a - b);
  }

  #bandOf(y: number): number {
    const b = Math.floor((y - this.#y0) / this.#band);
    return b < 0 ? 0 : b >= this.#bands ? this.#bands - 1 : b;
  }
}
