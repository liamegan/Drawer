import { windingAt } from "../geometry/clip.js";
import { asList, type Polyline } from "../geometry/Polyline.js";
import { ScanlineSweep, type FillRule } from "../geometry/scanline.js";
import type { GridWindow } from "./grid.js";

/**
 * The closed paths in `shapes` as flat [x0, y0, x1, y1, ...] rings. Open
 * paths and rings with fewer than three points are left out.
 */
export function ringsOf(
  shapes: Polyline | readonly Polyline[],
): Float64Array[] {
  const rings: Float64Array[] = [];
  for (const shape of asList(shapes)) {
    if (!shape.closed || shape.pointCount < 3) continue;
    const ring = new Float64Array(shape.pointCount * 2);
    shape.points.forEach((p, i) => {
      ring[2 * i] = p.x;
      ring[2 * i + 1] = p.y;
    });
    rings.push(ring);
  }
  return rings;
}

/** Ring edges as flat [ax, ay, bx, by, ...], the layout `windingAt` reads. */
export function ringEdges(rings: readonly Float64Array[]): Float64Array {
  let count = 0;
  for (const ring of rings) count += ring.length >> 1;
  const out = new Float64Array(count * 4);
  let k = 0;
  for (const ring of rings) {
    const m = ring.length >> 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      out[k++] = ring[2 * i];
      out[k++] = ring[2 * i + 1];
      out[k++] = ring[2 * j];
      out[k++] = ring[2 * j + 1];
    }
  }
  return out;
}

/** True when winding number `w` counts as inside under `rule`. */
export function insideBy(w: number, rule: FillRule): boolean {
  return rule === "evenodd" ? (w & 1) !== 0 : w !== 0;
}

/** Cut parameters this close to 0 or 1 count as the edge's end points. */
const END = 1e-9;

/**
 * The parts of the rings' edges that bound the filled region under `rule`,
 * as flat [ax, ay, bx, by, ...] segments.
 *
 * Under even-odd every edge is boundary, unless edges overlap. Under nonzero,
 * edges inside the filled region (where rings overlap, or a ring runs inside
 * another in the same direction) are not, and distances must ignore them.
 * Edges are split wherever they cross or overlap, and each stretch between
 * cuts is kept if the region is inside on one side and outside on the other.
 */
export function boundarySegments(
  rings: readonly Float64Array[],
  rule: FillRule,
): Float64Array {
  // Every edge with length, as parallel arrays.
  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  const ringOf: number[] = [];
  const prev: number[] = []; // previous edge on the same ring
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rings.forEach((ring, r) => {
    const m = ring.length >> 1;
    const first = ax.length;
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
      if (x0 === x1 && y0 === y1) continue;
      prev.push(ax.length - 1);
      ax.push(x0);
      ay.push(y0);
      bx.push(x1);
      by.push(y1);
      ringOf.push(r);
    }
    if (ax.length > first) prev[first] = ax.length - 1;
  });
  const count = ax.length;
  const scale = Math.max(maxX - minX, maxY - minY, 1e-12);

  // Find where edges cross or overlap.
  const cuts: (number[] | undefined)[] = new Array(count);
  const addCut = (e: number, t: number) => {
    (cuts[e] ??= []).push(t < 0 ? 0 : t > 1 ? 1 : t);
  };
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (p, q) => Math.min(ax[p], bx[p]) - Math.min(ax[q], bx[q]),
  );
  let crossings = 0;
  for (let p = 0; p < count; p++) {
    const e = order[p];
    const eMaxX = Math.max(ax[e], bx[e]);
    const eMinY = Math.min(ay[e], by[e]);
    const eMaxY = Math.max(ay[e], by[e]);
    for (let q = p + 1; q < count; q++) {
      const f = order[q];
      if (Math.min(ax[f], bx[f]) > eMaxX) break;
      if (Math.min(ay[f], by[f]) > eMaxY || Math.max(ay[f], by[f]) < eMinY) {
        continue;
      }
      // Neighbours on a ring share a vertex, which is not a crossing.
      if (prev[e] === f || prev[f] === e) continue;
      const rx = bx[e] - ax[e];
      const ry = by[e] - ay[e];
      const sx = bx[f] - ax[f];
      const sy = by[f] - ay[f];
      const wx = ax[f] - ax[e];
      const wy = ay[f] - ay[e];
      const lenR = Math.hypot(rx, ry);
      const lenS = Math.hypot(sx, sy);
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) > 1e-12 * lenR * lenS) {
        const t = (wx * sy - wy * sx) / denom;
        const u = (wx * ry - wy * rx) / denom;
        if (t >= -END && t <= 1 + END && u >= -END && u <= 1 + END) {
          addCut(e, t);
          addCut(f, u);
          crossings++;
        }
      } else if (Math.abs(wx * ry - wy * rx) / lenR <= 1e-9 * scale) {
        // Collinear: cut each edge where the other one's ends fall on it.
        const r2 = lenR * lenR;
        const s2 = lenS * lenS;
        const t0 = (wx * rx + wy * ry) / r2;
        const t1 = ((bx[f] - ax[e]) * rx + (by[f] - ay[e]) * ry) / r2;
        const u0 = (-wx * sx - wy * sy) / s2;
        const u1 = ((bx[e] - ax[f]) * sx + (by[e] - ay[f]) * sy) / s2;
        let overlap = false;
        for (const t of [t0, t1]) {
          if (t >= -END && t <= 1 + END) {
            addCut(e, t);
            overlap = true;
          }
        }
        for (const u of [u0, u1]) {
          if (u >= -END && u <= 1 + END) {
            addCut(f, u);
            overlap = true;
          }
        }
        if (overlap) crossings++;
      }
    }
  }

  const all = new Float64Array(count * 4);
  for (let e = 0; e < count; e++) {
    all[4 * e] = ax[e];
    all[4 * e + 1] = ay[e];
    all[4 * e + 2] = bx[e];
    all[4 * e + 3] = by[e];
  }
  // A ring that crosses nothing is boundary all round under even-odd, and
  // so is a lone ring under nonzero.
  if (crossings === 0 && (rule === "evenodd" || rings.length <= 1)) return all;

  // Split each ring into runs between cuts. Along a run nothing crosses the
  // ring, so the winding either side is constant and one test decides it.
  const out: number[] = [];
  const pieces: number[] = []; // x0, y0, x1, y1, startsRun
  const ringEdgeLists: number[][] = rings.map(() => []);
  for (let e = 0; e < count; e++) ringEdgeLists[ringOf[e]].push(e);
  const atEnd = (e: number) => cuts[e]?.some((t) => t >= 1 - END) ?? false;

  for (const edges of ringEdgeLists) {
    if (edges.length === 0) continue;
    pieces.length = 0;
    for (const e of edges) {
      const ts = (cuts[e] ?? []).filter((t) => t > END && t < 1 - END);
      ts.sort((p, q) => p - q);
      const startsAtCut =
        (cuts[e]?.some((t) => t <= END) ?? false) || atEnd(prev[e]);
      let t0 = 0;
      let first = true;
      for (const t1 of [...ts, 1]) {
        if (t1 - t0 <= END) continue;
        pieces.push(
          ax[e] + (bx[e] - ax[e]) * t0,
          ay[e] + (by[e] - ay[e]) * t0,
          ax[e] + (bx[e] - ax[e]) * t1,
          ay[e] + (by[e] - ay[e]) * t1,
          first ? (startsAtCut ? 1 : 0) : 1,
        );
        first = false;
        t0 = t1;
      }
    }
    const n = pieces.length / 5;
    // Start at a piece that begins a run, so no run wraps past the end.
    let s = 0;
    while (s < n && pieces[5 * s + 4] === 0) s++;
    if (s === n) s = 0;
    let runStart = 0;
    for (let c = 1; c <= n; c++) {
      const idx = (s + c) % n;
      if (c < n && pieces[5 * idx + 4] === 0) continue;
      // Pieces runStart .. c-1 (offset by s) form one run.
      let longest = -1;
      let best = -1;
      for (let r = runStart; r < c; r++) {
        const q = 5 * ((s + r) % n);
        const len = Math.hypot(pieces[q + 2] - pieces[q], pieces[q + 3] - pieces[q + 1]);
        if (len > best) {
          best = len;
          longest = q;
        }
      }
      if (isBoundary(all, pieces, longest, best, scale, rule)) {
        for (let r = runStart; r < c; r++) {
          const q = 5 * ((s + r) % n);
          out.push(pieces[q], pieces[q + 1], pieces[q + 2], pieces[q + 3]);
        }
      }
      runStart = c;
    }
  }
  return Float64Array.from(out);
}

/** Tests the winding just either side of the piece at offset `q`. */
function isBoundary(
  edges: Float64Array,
  pieces: readonly number[],
  q: number,
  len: number,
  scale: number,
  rule: FillRule,
): boolean {
  const x0 = pieces[q];
  const y0 = pieces[q + 1];
  const dx = pieces[q + 2] - x0;
  const dy = pieces[q + 3] - y0;
  const eps = Math.min(1e-7 * scale, 0.01 * len);
  const nx = (-dy / len) * eps;
  const ny = (dx / len) * eps;
  const mx = x0 + dx / 2;
  const my = y0 + dy / 2;
  const left = insideBy(windingAt(edges, mx + nx, my + ny), rule);
  const right = insideBy(windingAt(edges, mx - nx, my - ny), rule);
  return left !== right;
}

/** Distance from (px, py) to segment `s` of a flat [ax, ay, bx, by, ...] list. */
export function segmentDistanceAt(
  segments: Float64Array,
  s: number,
  px: number,
  py: number,
): number {
  const k = 4 * s;
  const ax = segments[k];
  const ay = segments[k + 1];
  const ex = segments[k + 2] - ax;
  const ey = segments[k + 3] - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - ax - ex * t;
  const dy = py - ay - ey * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Cells either side of each segment whose distance is computed directly. */
const BAND = 2;

/**
 * Signed distance from every node of `window` to the nearest of `segments`,
 * negative inside `rings` under `rule`. Nodes with no segments at all get
 * +Infinity.
 *
 * Distances are exact near the segments. Further out, each node takes the
 * nearest segment of its neighbours, re-measured exactly, in forward and
 * backward raster sweeps. Every value is the true distance to some segment,
 * and to the nearest one except where its region is too thin for the sweep
 * to carry through, where the error is tiny.
 */
export function distanceField(
  segments: Float64Array,
  rings: readonly Float64Array[],
  rule: FillRule,
  window: GridWindow,
): Float64Array {
  const { resolution: res, i0, j0, cols, rows } = window;
  const total = cols * rows;
  const dist = new Float64Array(total).fill(Infinity);
  const owner = new Int32Array(total).fill(-1);
  const xs = new Float64Array(cols);
  const ys = new Float64Array(rows);
  for (let i = 0; i < cols; i++) xs[i] = (i0 + i) / res;
  for (let j = 0; j < rows; j++) ys[j] = (j0 + j) / res;

  // Exact distances within BAND cells of each segment.
  const band = BAND / res;
  const segmentCount = segments.length / 4;
  for (let s = 0; s < segmentCount; s++) {
    const x0 = segments[4 * s];
    const y0 = segments[4 * s + 1];
    const x1 = segments[4 * s + 2];
    const y1 = segments[4 * s + 3];
    const jStart = Math.max(0, Math.ceil((Math.min(y0, y1) - band) * res - j0));
    const jEnd = Math.min(rows - 1, Math.floor((Math.max(y0, y1) + band) * res - j0));
    for (let j = jStart; j <= jEnd; j++) {
      const y = ys[j];
      let tA = 0;
      let tB = 1;
      if (y1 !== y0) {
        const ta = (y - band - y0) / (y1 - y0);
        const tb = (y + band - y0) / (y1 - y0);
        tA = Math.max(0, Math.min(ta, tb));
        tB = Math.min(1, Math.max(ta, tb));
        if (tA > tB) continue;
      }
      const xa = x0 + (x1 - x0) * tA;
      const xb = x0 + (x1 - x0) * tB;
      const iStart = Math.max(0, Math.ceil((Math.min(xa, xb) - band) * res - i0));
      const iEnd = Math.min(cols - 1, Math.floor((Math.max(xa, xb) + band) * res - i0));
      const row = j * cols;
      for (let i = iStart; i <= iEnd; i++) {
        const d = segmentDistanceAt(segments, s, xs[i], y);
        if (d < dist[row + i]) {
          dist[row + i] = d;
          owner[row + i] = s;
        }
      }
    }
  }

  // Carry the nearest segment out to the rest of the grid.
  const take = (k: number, x: number, y: number, from: number) => {
    const o = owner[from];
    if (o < 0 || o === owner[k]) return;
    const d = segmentDistanceAt(segments, o, x, y);
    if (d < dist[k]) {
      dist[k] = d;
      owner[k] = o;
    }
  };
  for (let round = 0; round < 2; round++) {
    for (let j = 0; j < rows; j++) {
      const y = ys[j];
      const row = j * cols;
      for (let i = 0; i < cols; i++) {
        const k = row + i;
        const x = xs[i];
        if (i > 0) take(k, x, y, k - 1);
        if (j > 0) {
          if (i > 0) take(k, x, y, k - cols - 1);
          take(k, x, y, k - cols);
          if (i < cols - 1) take(k, x, y, k - cols + 1);
        }
      }
      for (let i = cols - 2; i >= 0; i--) take(row + i, xs[i], y, row + i + 1);
    }
    for (let j = rows - 1; j >= 0; j--) {
      const y = ys[j];
      const row = j * cols;
      for (let i = cols - 1; i >= 0; i--) {
        const k = row + i;
        const x = xs[i];
        if (i < cols - 1) take(k, x, y, k + 1);
        if (j < rows - 1) {
          if (i < cols - 1) take(k, x, y, k + cols + 1);
          take(k, x, y, k + cols);
          if (i > 0) take(k, x, y, k + cols - 1);
        }
      }
      for (let i = 1; i < cols; i++) take(row + i, xs[i], y, row + i - 1);
    }
    if (round === 0) walkAlongRings(segments, xs, ys, dist, owner);
  }

  // Negative inside, row by row.
  const sweep = new ScanlineSweep(rings);
  if (sweep.edgeCount > 0) {
    const spans = new Float64Array(sweep.edgeCount);
    for (let j = 0; j < rows; j++) {
      const y = ys[j];
      if (y < sweep.minY || y > sweep.maxY) continue;
      const n = sweep.spans(y, rule, spans);
      const row = j * cols;
      for (let s = 0; s < n; s++) {
        const xa = spans[2 * s];
        const xb = spans[2 * s + 1];
        const iStart = Math.max(0, Math.ceil(xa * res - i0));
        const iEnd = Math.min(cols - 1, Math.floor(xb * res - i0));
        for (let i = iStart; i <= iEnd; i++) {
          if (xs[i] >= xa && xs[i] <= xb) dist[row + i] = -dist[row + i];
        }
      }
    }
  }
  return dist;
}

/**
 * Where many short segments share a region thinner than a cell (near the
 * centre of a finely divided circle), the sweep can settle on a segment next
 * to the nearest. Segments are listed in ring order, so each node walks
 * along the list while the distance keeps falling. Run between the two
 * sweeps, so the second carries the corrections on.
 */
function walkAlongRings(
  segments: Float64Array,
  xs: Float64Array,
  ys: Float64Array,
  dist: Float64Array,
  owner: Int32Array,
): void {
  const count = segments.length / 4;
  const cols = xs.length;
  for (let j = 0; j < ys.length; j++) {
    const y = ys[j];
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let o = owner[k];
      if (o < 0) continue;
      for (let step = -1; step <= 1; step += 2) {
        for (let c = o + step; c >= 0 && c < count; c += step) {
          const d = segmentDistanceAt(segments, c, xs[i], y);
          if (!(d < dist[k])) break;
          dist[k] = d;
          owner[k] = o = c;
        }
      }
    }
  }
}

/** Exact signed distance at one point: brute force over every segment. */
export function distanceAt(
  segments: Float64Array,
  edges: Float64Array,
  rule: FillRule,
  x: number,
  y: number,
): number {
  let best = Infinity;
  for (let s = 0; s < segments.length / 4; s++) {
    const d = segmentDistanceAt(segments, s, x, y);
    if (d < best) best = d;
  }
  return insideBy(windingAt(edges, x, y), rule) ? -best : best;
}
