import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";

/** Options for {@link dedupePaths}. */
export interface DedupeOptions {
  /** Ink this close (mm) to ink already drawn counts as drawn twice. Default 0.05. */
  tolerance?: number;
  /**
   * Only doubled stretches at least this long (mm) are removed, so a path
   * isn't split, costing a pen lift, to save a sliver. Default 1.
   */
  minOverlap?: number;
  /**
   * Segments must run within this angle (radians) of each other to count as
   * doubled, so lines that merely cross are never cut. Default π/12 (15°).
   */
  angle?: number;
}

/** Partner segments this many indices apart still count as one stretch. */
const PARTNER_STEP = 3;

/**
 * Removes ink drawn on top of ink already drawn: repeated paths (in either
 * direction), edges shared by touching shapes, and paths that double back
 * over themselves. Paths are taken in order. A later path loses each stretch
 * that follows one stretch of earlier ink, within `tolerance`, for at least
 * `minOverlap`.
 *
 * Following one stretch is what tells a duplicate from texture: a wave so
 * tight its flanks overlap stays near different flanks in turn, in short
 * runs, and is kept as drawn. A path that loses a stretch comes back as the
 * pieces left over, which `mergePaths` can join back up; untouched paths
 * come back as they were.
 */
export function dedupePaths(
  paths: readonly Polyline[],
  options: DedupeOptions = {},
): Polyline[] {
  const tolerance = options.tolerance ?? 0.05;
  const minOverlap = options.minOverlap ?? 1;
  const sinMax = Math.sin(options.angle ?? Math.PI / 12);
  if (!(tolerance > 0) || !(minOverlap >= 0)) {
    throw new RangeError(
      "dedupePaths: tolerance must be positive and minOverlap non-negative",
    );
  }
  // Ink of the same path nearer than this along it is its own neighbourhood,
  // not a second pass over it.
  const selfGap = 3 * tolerance;
  const index = new SegmentIndex(Math.max(1, tolerance * 8));
  const pathSegments: number[] = [];
  const pathClosed: boolean[] = [];
  const candidates: number[] = [];
  const out: Polyline[] = [];

  paths.forEach((path, p) => {
    const pts = path.points;
    const n = pts.length;
    const closed = path.closed && n >= 3;
    const count = n < 2 ? 0 : closed ? n : n - 1;
    pathSegments.push(count);
    pathClosed.push(closed);
    if (count === 0) return;
    const offsets = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) {
      offsets[i + 1] = offsets[i] + pts[i].distance(pts[(i + 1) % n]);
    }
    const total = offsets[count];

    // Doubled spans along this path: [from, to, partner path, partner index].
    const spans: number[][] = [];
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const length = offsets[i + 1] - offsets[i];
      if (length === 0) continue;
      index.near(a.x, a.y, b.x, b.y, tolerance, candidates);
      for (const s of candidates) {
        const cx = index.ax[s];
        const cy = index.ay[s];
        const fx = index.bx[s] - cx;
        const fy = index.by[s] - cy;
        const flength = Math.hypot(fx, fy);
        if (Math.abs(ex * fy - ey * fx) > sinMax * length * flength) continue;
        const span = capsuleInterval(
          a.x,
          a.y,
          ex,
          ey,
          cx,
          cy,
          fx,
          fy,
          tolerance,
        );
        if (!span) continue;
        let lo = Math.max(0, span[0]);
        let hi = Math.min(1, span[1]);
        if (index.path[s] === p) {
          // Along its own path, only count points at least `selfGap` from
          // the ink they lie on (both ways round a ring): nearer is the
          // path's own neighbourhood. The point at λ projects to arc
          // position arcStart + ((a − c)·f + λ e·f) / |f| on the partner,
          // so its separation is linear in λ.
          const separation = between(
            offsets[i] -
              index.arcStart[s] -
              ((a.x - cx) * fx + (a.y - cy) * fy) / flength,
            length - (ex * fx + ey * fy) / flength,
            selfGap,
            closed ? total - selfGap : Infinity,
          );
          lo = Math.max(lo, separation[0]);
          hi = Math.min(hi, separation[1]);
        }
        if (hi > lo) {
          // Signed distance to the partner's line, at both ends of the span.
          const offset = (t: number) =>
            ((a.x - cx + t * ex) * -fy + (a.y - cy + t * ey) * fx) / flength;
          spans.push([
            offsets[i] + lo * length,
            offsets[i] + hi * length,
            index.path[s],
            index.index[s],
            offset(lo),
            offset(hi),
          ]);
        }
      }
      index.add(a.x, a.y, b.x, b.y, p, i, offsets[i], tolerance);
    }

    const partnerGap = (q: number, a: number, b: number) => {
      const d = Math.abs(a - b);
      return pathClosed[q] ? Math.min(d, pathSegments[q] - d) : d;
    };
    const removed = doubledStretches(spans, partnerGap, tolerance).filter(
      ([from, to]) => to - from >= minOverlap,
    );
    if (removed.length === 0) {
      out.push(path);
      return;
    }
    for (const [from, to] of keptRanges(removed, total, closed)) {
      if (to - from < tolerance) continue;
      out.push(slice(pts, offsets, closed, from, to));
    }
  });
  return out;
}

/**
 * Chains doubled spans into stretches: a span continues a stretch when it
 * starts before the stretch ends and its partner segment is on the same path
 * and next to the stretch's latest partner. Returns the [from, to] arc
 * ranges of stretches that keep to one side of their partner: one whose
 * offset from it changes by more than `tolerance` is a line crossing at a
 * shallow angle, not a second pass.
 */
function doubledStretches(
  spans: number[][],
  partnerGap: (path: number, a: number, b: number) => number,
  tolerance: number,
): [number, number][] {
  interface Run {
    from: number;
    to: number;
    path: number;
    partner: number;
    enter: number;
    leave: number;
  }
  spans.sort((p, q) => p[0] - q[0]);
  const done: [number, number][] = [];
  const finish = (run: Run) => {
    if (Math.abs(run.leave - run.enter) <= tolerance) {
      done.push([run.from, run.to]);
    }
  };
  let active: Run[] = [];
  for (const [from, to, path, partner, enter, leave] of spans) {
    // Stretches that ended before this span can't grow any more.
    if (active.some((run) => run.to < from - 1e-9)) {
      for (const run of active) if (run.to < from - 1e-9) finish(run);
      active = active.filter((run) => run.to >= from - 1e-9);
    }
    const run = active.find(
      (r) =>
        r.path === path && partnerGap(path, r.partner, partner) <= PARTNER_STEP,
    );
    if (!run) {
      active.push({ from, to, path, partner, enter, leave });
      continue;
    }
    run.partner = partner;
    if (to > run.to) {
      run.to = to;
      run.leave = leave;
    }
  }
  for (const run of active) finish(run);
  return done;
}

/**
 * What's left of [0, total] once the `removed` ranges are taken out. On a
 * closed path the piece after the last cut runs round the seam to the first,
 * so it can end past `total`.
 */
function keptRanges(
  removed: [number, number][],
  total: number,
  closed: boolean,
): [number, number][] {
  const cuts: [number, number][] = [];
  for (const [a, b] of [...removed].sort((p, q) => p[0] - q[0])) {
    const last = cuts[cuts.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else cuts.push([a, b]);
  }
  const kept: [number, number][] = [];
  if (closed) {
    cuts.forEach(([, end], k) => {
      const next = k + 1 < cuts.length ? cuts[k + 1][0] : cuts[0][0] + total;
      if (next > end) kept.push([end, next]);
    });
    return kept;
  }
  let at = 0;
  for (const [a, b] of cuts) {
    if (a > at) kept.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < total) kept.push([at, total]);
  return kept;
}

/**
 * The part of a path between arc positions `from` and `to`, as an open path.
 * On a closed path `to` may run past the total length, round the seam.
 */
function slice(
  pts: readonly Vec2[],
  offsets: Float64Array,
  closed: boolean,
  from: number,
  to: number,
): Polyline {
  const n = pts.length;
  const count = offsets.length - 1;
  const total = offsets[count];
  const at = (u: number): Vec2 => {
    const w = closed && u >= total ? u - total : u;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= w) lo = mid;
      else hi = mid - 1;
    }
    const a = pts[lo];
    const b = pts[(lo + 1) % n];
    const length = offsets[lo + 1] - offsets[lo];
    const t =
      length > 0 ? Math.min(1, Math.max(0, (w - offsets[lo]) / length)) : 0;
    return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  };
  const out: Vec2[] = [at(from)];
  // Vertices strictly between `from` and `to`; on a ring, once more round.
  const vertices = closed ? 2 * n : n;
  for (let k = 0; k < vertices; k++) {
    const u = k < n ? offsets[k] : offsets[k - n] + total;
    if (u <= from) continue;
    if (u >= to) break;
    out.push(pts[k % n]);
  }
  out.push(at(to));
  return new Polyline(out);
}

/**
 * Where the line a + λe runs through the stroke of segment c → c + f drawn
 * with radius r, as [λ0, λ1], or null. The stroke is convex, so that's one
 * interval: the hull of where the line crosses the two end discs and the
 * band along the segment.
 */
export function capsuleInterval(
  ax: number,
  ay: number,
  ex: number,
  ey: number,
  cx: number,
  cy: number,
  fx: number,
  fy: number,
  r: number,
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const ee = ex * ex + ey * ey;
  if (ee === 0) return null;
  for (const [px, py] of [
    [cx, cy],
    [cx + fx, cy + fy],
  ]) {
    // |a + λe − p|² ≤ r²
    const dx = ax - px;
    const dy = ay - py;
    const b = ex * dx + ey * dy;
    const disc = b * b - ee * (dx * dx + dy * dy - r * r);
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      lo = Math.min(lo, (-b - root) / ee);
      hi = Math.max(hi, (-b + root) / ee);
    }
  }
  const flength = Math.hypot(fx, fy);
  if (flength > 0) {
    const ux = fx / flength;
    const uy = fy / flength;
    const along = between(
      (ax - cx) * ux + (ay - cy) * uy,
      ex * ux + ey * uy,
      0,
      flength,
    );
    const across = between(
      -(ax - cx) * uy + (ay - cy) * ux,
      -ex * uy + ey * ux,
      -r,
      r,
    );
    const from = Math.max(along[0], across[0]);
    const to = Math.min(along[1], across[1]);
    if (from <= to) {
      lo = Math.min(lo, from);
      hi = Math.max(hi, to);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** The λ where low ≤ α + βλ ≤ high. */
function between(
  alpha: number,
  beta: number,
  low: number,
  high: number,
): [number, number] {
  if (Math.abs(beta) < 1e-15) {
    return alpha >= low && alpha <= high ? [-Infinity, Infinity] : [1, 0];
  }
  const a = (low - alpha) / beta;
  const b = (high - alpha) / beta;
  return a < b ? [a, b] : [b, a];
}

/** Segments already drawn, bucketed by the grid cells their strokes touch. */
class SegmentIndex {
  readonly ax: number[] = [];
  readonly ay: number[] = [];
  readonly bx: number[] = [];
  readonly by: number[] = [];
  readonly path: number[] = [];
  readonly index: number[] = [];
  readonly arcStart: number[] = [];
  readonly #seen: number[] = [];
  readonly #cells = new Map<number, number[]>();
  readonly #cell: number;
  #stamp = 0;

  constructor(cell: number) {
    this.#cell = cell;
  }

  add(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    path: number,
    index: number,
    arcStart: number,
    pad: number,
  ): void {
    const id = this.ax.length;
    this.ax.push(ax);
    this.ay.push(ay);
    this.bx.push(bx);
    this.by.push(by);
    this.path.push(path);
    this.index.push(index);
    this.arcStart.push(arcStart);
    this.#seen.push(0);
    this.#visit(ax, ay, bx, by, pad, (key) => {
      let list = this.#cells.get(key);
      if (!list) this.#cells.set(key, (list = []));
      if (list[list.length - 1] !== id) list.push(id);
    });
  }

  /** Segments in cells within `pad` of segment a→b, each once, into `out`. */
  near(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    pad: number,
    out: number[],
  ): void {
    out.length = 0;
    const stamp = ++this.#stamp;
    this.#visit(ax, ay, bx, by, pad, (key) => {
      const list = this.#cells.get(key);
      if (!list) return;
      for (const id of list) {
        if (this.#seen[id] === stamp) continue;
        this.#seen[id] = stamp;
        out.push(id);
      }
    });
  }

  /** Calls `fn` for each cell within `pad` of the segment, maybe repeating. */
  #visit(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    pad: number,
    fn: (key: number) => void,
  ): void {
    const cell = this.#cell;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)),
    );
    // Samples are half a cell apart, so a quarter cell either side covers
    // the gaps; add the pad on top.
    const reach = pad + cell / 4;
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      const i0 = Math.floor((x - reach) / cell);
      const i1 = Math.floor((x + reach) / cell);
      const j0 = Math.floor((y - reach) / cell);
      const j1 = Math.floor((y + reach) / cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) fn((i + 32768) * 65536 + (j + 32768));
      }
    }
  }
}
