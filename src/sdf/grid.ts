import type { Bounds } from "../geometry/Bounds.js";

/** Default SDF grid resolution, in nodes per mm (0.2 mm cells). */
export const DEFAULT_RESOLUTION = 5;

/** Grids bigger than this many nodes are refused rather than allocated. */
const MAX_NODES = 64_000_000;

/**
 * A rectangle of nodes on the page lattice: node (i, j) sits at
 * ((i0 + i) / resolution, (j0 + j) / resolution) mm. Every grid at the same
 * resolution shares the lattice, so grids of different shapes line up node
 * for node.
 */
export interface GridWindow {
  /** Nodes per mm. */
  readonly resolution: number;
  /** Lattice index of the first column and row. */
  readonly i0: number;
  readonly j0: number;
  readonly cols: number;
  readonly rows: number;
}

/** The smallest window covering `bounds` grown by `pad` mm on every side. */
export function windowFor(
  bounds: Bounds,
  resolution: number,
  pad: number,
): GridWindow {
  if (!(resolution > 0) || !Number.isFinite(resolution)) {
    throw new RangeError("SDF: resolution must be a positive number");
  }
  const i0 = Math.floor((bounds.min.x - pad) * resolution);
  const j0 = Math.floor((bounds.min.y - pad) * resolution);
  const i1 = Math.ceil((bounds.max.x + pad) * resolution);
  const j1 = Math.ceil((bounds.max.y + pad) * resolution);
  const cols = i1 - i0 + 1;
  const rows = j1 - j0 + 1;
  if (cols * rows > MAX_NODES) {
    throw new RangeError(
      `SDF: a ${cols} × ${rows} grid is too big; lower the resolution`,
    );
  }
  return { resolution, i0, j0, cols, rows };
}

/**
 * Signed distances (mm, negative inside) at the nodes of a window, stored
 * row by row.
 */
export class SDFGrid implements GridWindow {
  readonly resolution: number;
  readonly i0: number;
  readonly j0: number;
  readonly cols: number;
  readonly rows: number;
  readonly data: Float64Array;

  constructor(window: GridWindow, data: Float64Array) {
    if (data.length !== window.cols * window.rows) {
      throw new RangeError("SDFGrid: data doesn't match the window");
    }
    this.resolution = window.resolution;
    this.i0 = window.i0;
    this.j0 = window.j0;
    this.cols = window.cols;
    this.rows = window.rows;
    this.data = data;
  }

  /** Spacing between nodes, in mm. */
  get cell(): number {
    return 1 / this.resolution;
  }

  /** Page x of column i. */
  x(i: number): number {
    return (this.i0 + i) / this.resolution;
  }

  /** Page y of row j. */
  y(j: number): number {
    return (this.j0 + j) / this.resolution;
  }

  /** The smallest value in the grid. */
  get min(): number {
    let least = Infinity;
    for (const d of this.data) if (d < least) least = d;
    return least;
  }

  /**
   * The distance at (x, y) mm, interpolated bilinearly between nodes. Points
   * outside the window take the value at the nearest edge.
   */
  sample(x: number, y: number): number {
    const u = x * this.resolution - this.i0;
    const v = y * this.resolution - this.j0;
    const i = clamp(Math.floor(u), 0, this.cols - 2);
    const j = clamp(Math.floor(v), 0, this.rows - 2);
    const fu = clamp(u - i, 0, 1);
    const fv = clamp(v - j, 0, 1);
    const d = this.data;
    const k = j * this.cols + i;
    const top = d[k] + (d[k + 1] - d[k]) * fu;
    const bottom = d[k + this.cols] + (d[k + this.cols + 1] - d[k + this.cols]) * fu;
    return top + (bottom - top) * fv;
  }

  /**
   * The gradient of the distance at (x, y), by central differences one cell
   * wide, written into `out` as [gx, gy]. For a true distance field it has
   * length 1 and points away from the nearest edge on the outside, towards
   * it on the inside.
   */
  gradient(x: number, y: number, out: [number, number] = [0, 0]): [number, number] {
    const h = this.cell;
    out[0] = (this.sample(x + h, y) - this.sample(x - h, y)) / (2 * h);
    out[1] = (this.sample(x, y + h) - this.sample(x, y - h)) / (2 * h);
    return out;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
