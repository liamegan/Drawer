/** How overlapping or nested rings decide what is inside, as in SVG and Canvas. */
export type FillRule = "nonzero" | "evenodd";

/**
 * Sweeps horizontal scanlines down a set of closed rings and reports the
 * spans inside them. Shared by the mask rasteriser (pixel space) and by
 * hatching (a rotated frame in mm).
 *
 * Rings are flat [x0, y0, x1, y1, ...] arrays, closed implicitly. Each edge
 * covers the half-open range top <= y < bottom, so a scanline through a
 * vertex counts it once. Scanlines must be visited top to bottom: an
 * active-edge list follows the sweep, so each call only looks at the edges
 * that cross it.
 */
export class ScanlineSweep {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Non-horizontal edges. A scanline has at most this many crossings. */
  readonly edgeCount: number;

  readonly #yTop: Float64Array;
  readonly #yBot: Float64Array;
  readonly #xTop: Float64Array;
  readonly #slope: Float64Array; // dx / dy
  readonly #dir: Int8Array; // +1 where the ring runs down the page
  readonly #order: number[];
  readonly #active: number[] = [];
  readonly #xs: Float64Array;
  readonly #ws: Int8Array;
  #next = 0;
  #lastY = -Infinity;

  constructor(rings: readonly Float64Array[]) {
    let capacity = 0;
    for (const ring of rings) capacity += ring.length >> 1;

    const yTop = new Float64Array(capacity);
    const yBot = new Float64Array(capacity);
    const xTop = new Float64Array(capacity);
    const slope = new Float64Array(capacity);
    const dir = new Int8Array(capacity);
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const ring of rings) {
      const m = ring.length >> 1;
      if (m < 3) continue;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const x0 = ring[2 * i];
        const y0 = ring[2 * i + 1];
        const x1 = ring[2 * j];
        const y1 = ring[2 * j + 1];
        if (x0 < minX) minX = x0;
        if (x0 > maxX) maxX = x0;
        if (y0 < minY) minY = y0;
        if (y0 > maxY) maxY = y0;
        if (y0 === y1) continue;
        const down = y1 > y0;
        yTop[count] = down ? y0 : y1;
        yBot[count] = down ? y1 : y0;
        xTop[count] = down ? x0 : x1;
        slope[count] = (x1 - x0) / (y1 - y0);
        dir[count] = down ? 1 : -1;
        count++;
      }
    }

    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    this.edgeCount = count;
    this.#yTop = yTop;
    this.#yBot = yBot;
    this.#xTop = xTop;
    this.#slope = slope;
    this.#dir = dir;
    this.#order = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => yTop[a] - yTop[b],
    );
    this.#xs = new Float64Array(count);
    this.#ws = new Int8Array(count);
  }

  /**
   * Writes the inside spans of the scanline at `y` into `out` as
   * [xa0, xb0, xa1, xb1, ...], left to right, and returns how many spans
   * there are. `out` needs room for `edgeCount` numbers. `y` must not be
   * less than the previous call's.
   */
  spans(y: number, rule: FillRule, out: Float64Array): number {
    if (y < this.#lastY) {
      throw new RangeError("ScanlineSweep: scanlines must go top to bottom");
    }
    this.#lastY = y;

    const yTop = this.#yTop;
    const yBot = this.#yBot;
    const order = this.#order;
    const active = this.#active;

    while (this.#next < this.edgeCount && yTop[order[this.#next]] <= y) {
      active.push(order[this.#next++]);
    }
    let keep = 0;
    for (let i = 0; i < active.length; i++) {
      if (yBot[active[i]] > y) active[keep++] = active[i];
    }
    active.length = keep;

    // Crossings, insertion-sorted along x (there are usually only a few).
    const xs = this.#xs;
    const ws = this.#ws;
    let k = 0;
    for (const e of active) {
      const x = this.#xTop[e] + (y - yTop[e]) * this.#slope[e];
      let p = k++;
      while (p > 0 && xs[p - 1] > x) {
        xs[p] = xs[p - 1];
        ws[p] = ws[p - 1];
        p--;
      }
      xs[p] = x;
      ws[p] = this.#dir[e];
    }

    let n = 0;
    if (rule === "evenodd") {
      for (let i = 0; i + 1 < k; i += 2) {
        out[2 * n] = xs[i];
        out[2 * n + 1] = xs[i + 1];
        n++;
      }
    } else {
      let winding = 0;
      let start = 0;
      for (let i = 0; i < k; i++) {
        const before = winding;
        winding += ws[i];
        if (before === 0 && winding !== 0) {
          start = xs[i];
        } else if (before !== 0 && winding === 0) {
          out[2 * n] = start;
          out[2 * n + 1] = xs[i];
          n++;
        }
      }
    }
    return n;
  }
}
