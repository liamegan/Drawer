import type { Polyline } from "../geometry/Polyline.js";
import { ScanlineSweep, type FillRule } from "../geometry/scanline.js";
import { circleSegments } from "../geometry/shapes.js";

export type { FillRule };

/** The pixel grid a ring is filled into. Coverage is 0–255 per pixel. */
export interface CoverageGrid {
  readonly cols: number;
  readonly rows: number;
  readonly data: Uint8Array;
}

/** Sub-scanlines per pixel row. Coverage across x is exact; down y it comes in steps of 1/SUB. */
const SUB = 4;

/**
 * Fills closed rings (flat [x0, y0, x1, y1, ...] arrays in pixel units) into
 * `grid` with anti-aliased coverage. Each pixel keeps the larger of its old
 * and new coverage, so repeated fills build up a union.
 *
 * Sweeps SUB sub-scanlines per pixel row (see `ScanlineSweep`) and adds
 * exact fractional x coverage at each span's ends.
 */
export function fillRings(grid: CoverageGrid, rings: readonly Float64Array[], rule: FillRule): void {
  const sweep = new ScanlineSweep(rings);
  if (sweep.edgeCount === 0) return;

  const rowStart = Math.max(0, Math.floor(sweep.minY));
  const rowEnd = Math.min(grid.rows, Math.ceil(sweep.maxY));
  const colStart = Math.max(0, Math.floor(sweep.minX));
  const colEnd = Math.min(grid.cols, Math.ceil(sweep.maxX));
  if (rowStart >= rowEnd || colStart >= colEnd) return;

  const spans = new Float64Array(sweep.edgeCount);
  const acc = new Float32Array(grid.cols);
  const weight = 1 / SUB;
  const { cols, data } = grid;

  const addSpan = (xa: number, xb: number): void => {
    if (xa < colStart) xa = colStart;
    if (xb > colEnd) xb = colEnd;
    if (xb <= xa) return;
    const ia = Math.floor(xa);
    const ib = Math.floor(xb);
    if (ia === ib) {
      acc[ia] += (xb - xa) * weight;
      return;
    }
    acc[ia] += (ia + 1 - xa) * weight;
    for (let i = ia + 1; i < ib; i++) acc[i] += weight;
    if (ib < colEnd) acc[ib] += (xb - ib) * weight;
  };

  for (let row = rowStart; row < rowEnd; row++) {
    acc.fill(0, colStart, colEnd);

    for (let s = 0; s < SUB; s++) {
      const n = sweep.spans(row + (s + 0.5) * weight, rule, spans);
      for (let i = 0; i < n; i++) addSpan(spans[2 * i], spans[2 * i + 1]);
    }

    const base = row * cols;
    for (let c = colStart; c < colEnd; c++) {
      const v = acc[c];
      if (v <= 0) continue;
      const value = v >= 1 ? 255 : Math.round(v * 255);
      if (value > data[base + c]) data[base + c] = value;
    }
  }
}

/** A polyline's points scaled into pixel units, as a flat ring. */
export function toPixelRing(path: Polyline, scale: number): Float64Array {
  const pts = path.points;
  const ring = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    ring[2 * i] = pts[i].x * scale;
    ring[2 * i + 1] = pts[i].y * scale;
  }
  return ring;
}

/**
 * The outline of a stroke of `radius` (pixel units) along `path`, as convex
 * pieces: one quad per segment plus a disc at every vertex, which gives round
 * caps and joins. All pieces share one orientation, so a single nonzero fill
 * of them is their exact union.
 */
export function strokeRings(path: Polyline, scale: number, radius: number): Float64Array[] {
  const pts = path.points;
  const n = pts.length;
  if (n === 0 || !(radius > 0)) return [];

  const pieces: Float64Array[] = [];
  const discSides = circleSegments(radius, 0.25);

  for (const p of pts) pieces.push(disc(p.x * scale, p.y * scale, radius, discSides));

  const segments = path.closed && n > 2 ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ax = a.x * scale;
    const ay = a.y * scale;
    const bx = b.x * scale;
    const by = b.y * scale;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const nx = (-(by - ay) / len) * radius;
    const ny = ((bx - ax) / len) * radius;
    pieces.push(positive(Float64Array.of(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny)));
  }
  return pieces;
}

function disc(cx: number, cy: number, radius: number, sides: number): Float64Array {
  // Increasing angle with y pointing down: positive signed area, like `positive`.
  const ring = new Float64Array(sides * 2);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring[2 * i] = cx + Math.cos(a) * radius;
    ring[2 * i + 1] = cy + Math.sin(a) * radius;
  }
  return ring;
}

/** Reverses a ring in place if its signed area is negative. */
function positive(ring: Float64Array): Float64Array {
  const m = ring.length >> 1;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    area += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
  }
  if (area >= 0) return ring;
  const out = new Float64Array(ring.length);
  for (let i = 0; i < m; i++) {
    out[2 * i] = ring[2 * (m - 1 - i)];
    out[2 * i + 1] = ring[2 * (m - 1 - i) + 1];
  }
  return out;
}
