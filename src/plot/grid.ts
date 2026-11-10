/**
 * A uniform grid over a fixed set of points, for nearest-neighbour queries
 * while points are taken away. Points are numbered by their index in the
 * arrays given to the constructor.
 */
export class PointGrid {
  readonly #xs: Float64Array;
  readonly #ys: Float64Array;
  readonly #cell: number;
  readonly #x0: number;
  readonly #y0: number;
  readonly #cols: number;
  readonly #rows: number;
  readonly #cells: number[][];
  /** Where each point sits in its cell's list, or -1 once removed. */
  readonly #slot: Int32Array;
  readonly #cellOf: Int32Array;
  #size: number;

  constructor(xs: Float64Array, ys: Float64Array) {
    const n = xs.length;
    this.#xs = xs;
    this.#ys = ys;
    this.#size = n;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minY = Math.min(minY, ys[i]);
      maxY = Math.max(maxY, ys[i]);
    }
    if (n === 0) minX = minY = maxX = maxY = 0;
    const width = Math.max(maxX - minX, 1e-6);
    const height = Math.max(maxY - minY, 1e-6);
    // About four points to a cell, but never more than ~1M cells.
    let cell = Math.sqrt((width * height) / Math.max(n, 1)) * 2;
    cell = Math.max(cell, Math.sqrt((width * height) / 1e6), 1e-3);
    this.#cell = cell;
    this.#x0 = minX;
    this.#y0 = minY;
    this.#cols = Math.floor(width / cell) + 1;
    this.#rows = Math.floor(height / cell) + 1;
    this.#cells = Array.from({ length: this.#cols * this.#rows }, () => []);
    this.#slot = new Int32Array(n);
    this.#cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.#cellIndex(xs[i], ys[i]);
      this.#cellOf[i] = c;
      this.#slot[i] = this.#cells[c].length;
      this.#cells[c].push(i);
    }
  }

  /** Points not yet removed. */
  get size(): number {
    return this.#size;
  }

  has(id: number): boolean {
    return this.#slot[id] >= 0;
  }

  remove(id: number): void {
    const slot = this.#slot[id];
    if (slot < 0) return;
    const list = this.#cells[this.#cellOf[id]];
    const moved = list[list.length - 1];
    list[slot] = moved;
    this.#slot[moved] = slot;
    list.pop();
    this.#slot[id] = -1;
    this.#size--;
  }

  /**
   * The nearest remaining point to (x, y) no further than `maxDistance`, or
   * -1. Ties go to the lowest index, so results don't depend on removal order.
   */
  nearest(x: number, y: number, maxDistance = Infinity): number {
    if (this.#size === 0) return -1;
    const cell = this.#cell;
    const ci = Math.floor((x - this.#x0) / cell);
    const cj = Math.floor((y - this.#y0) / cell);
    // Beyond this ring every cell is outside the grid.
    const last = Math.max(
      Math.abs(ci),
      Math.abs(ci - this.#cols + 1),
      Math.abs(cj),
      Math.abs(cj - this.#rows + 1),
    );
    let best = -1;
    let bestD2 =
      maxDistance === Infinity ? Infinity : maxDistance * maxDistance;
    for (let r = 0; r <= last; r++) {
      // Cells in ring r are at least (r - 1) cells away.
      const gap = (r - 1) * cell;
      if (r > 0 && gap > 0 && gap * gap > bestD2) break;
      for (let dj = -r; dj <= r; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= this.#rows) continue;
        const edge = dj === -r || dj === r;
        const step = edge ? 1 : 2 * r;
        for (let di = -r; di <= r; di += step || 1) {
          const i = ci + di;
          if (i < 0 || i >= this.#cols) continue;
          for (const id of this.#cells[j * this.#cols + i]) {
            const dx = this.#xs[id] - x;
            const dy = this.#ys[id] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || id < best))) {
              best = id;
              bestD2 = d2;
            }
          }
        }
      }
    }
    return best;
  }

  #cellIndex(x: number, y: number): number {
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
}
