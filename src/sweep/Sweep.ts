import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { simplify } from "../geometry/simplify.js";
import { leaf, type OutlineProfile, type Profile } from "./profiles.js";

/** A width per t (`Profile`), or an outline in unit leaf space. */
export type SweepProfile = Profile | OutlineProfile;

export interface SweepOptions {
  /** Width in mm where the profile is 1: half of it on each side. */
  width: number;
  /**
   * The width along the spine, the same on both sides or `{ left, right }`
   * (left and right as seen walking from base to tip). Default `leaf()`.
   */
  profile?:
    | SweepProfile
    | { readonly left: SweepProfile; readonly right: SweepProfile };
  /**
   * Extra turning in radians, spread evenly from base to tip (positive
   * turns clockwise on screen): a straight spine becomes an arc. Default 0.
   */
  bend?: number;
  /** Longest step along the spine between outline points, mm. Default 0.2. */
  step?: number;
  /** How closely the outline follows the true edge, mm. Default 0.01. */
  tolerance?: number;
}

/** Where a sweep's spine is at some t, and which way it faces. */
export interface SweepFrame {
  readonly point: Vec2;
  /** Unit vector along the spine, towards the tip. */
  readonly tangent: Vec2;
  /** Unit vector across it, to the right (`tangent` turned clockwise). */
  readonly normal: Vec2;
}

/** One side of the sweep, in mm along (s) and across (o) the spine. */
interface Side {
  /** Half-width at distance s along the spine, 0 outside the shape. */
  at(s: number): number;
  /** The edge from base to tip, as flat [o, s, o, s, …] with o ≥ 0. */
  readonly edge: readonly number[];
  readonly widest: number;
  /** The stretch of the spine the side covers. */
  readonly lo: number;
  readonly hi: number;
}

const MAX_BISECT = 12;

/**
 * A shape swept along a spine: a curve, with a width at each point along it
 * set by a profile. Leaves, petals, blades of grass, brush strokes.
 *
 * A sweep has its own coordinates. `t` runs along the spine from 0 at the
 * base to 1 at the tip, by arc length. Across it, `v` runs from −1 on the
 * left edge, through 0 on the spine, to 1 on the right edge, as a fraction
 * of the width there. `sweepHatch` draws lines in these coordinates, so
 * they follow the shape's form, not just its outline.
 *
 * The frame turns smoothly along the spine (normals are blended between the
 * spine's vertices), but nothing stops the edge on the inside of a bend
 * from folding over where the half-width is more than the bend's radius.
 * The outline still fills, but hatch lines cross there; keep the width
 * under the radius of the tightest bend.
 */
export class Sweep {
  /** The spine, after `bend`. */
  readonly spine: Polyline;
  /** Length of the spine in mm. */
  readonly length: number;
  /** The closed outline, clockwise on screen. */
  readonly outline: Polyline;
  /**
   * The outline without its base, as one open path from the base of the
   * left edge, round the tip, to the base of the right: for a shape that
   * grows out of something, like grass from the ground or a leaf from a
   * stem. Use `outline` as its silhouette.
   */
  readonly openOutline: Polyline;
  /**
   * The outline in the sweep's own space, as if the spine were laid
   * straight along +y from the origin: x is the offset from the spine in mm
   * (positive to the right) and y the distance along it.
   */
  readonly unrolled: Polyline;
  /**
   * The range of t the shape covers: [0, 1], unless an outline profile goes
   * past the base or the tip.
   */
  readonly extent: readonly [number, number];

  readonly #xs: Float64Array;
  readonly #ys: Float64Array;
  readonly #s: Float64Array;
  readonly #tx: Float64Array;
  readonly #ty: Float64Array;
  readonly #left: Side;
  readonly #right: Side;
  // Scratch output of #frameAt.
  #fx = 0;
  #fy = 0;
  #ftx = 1;
  #fty = 0;

  constructor(spine: Polyline, options: SweepOptions) {
    const { width } = options;
    if (!(width > 0) || !Number.isFinite(width)) {
      throw new RangeError("Sweep: width must be a positive number");
    }
    const bend = options.bend ?? 0;
    if (!Number.isFinite(bend)) {
      throw new RangeError("Sweep: bend must be finite");
    }
    const step = options.step ?? 0.2;
    if (!(step > 0)) throw new RangeError("Sweep: step must be positive");
    const tolerance = options.tolerance ?? 0.01;
    if (!(tolerance > 0)) {
      throw new RangeError("Sweep: tolerance must be positive");
    }
    if (spine.closed) {
      throw new RangeError("Sweep: the spine must be an open path");
    }

    const built = buildSpine(spine.points, bend);
    this.#xs = built.xs;
    this.#ys = built.ys;
    this.#s = built.s;
    this.#tx = built.tx;
    this.#ty = built.ty;
    const n = built.xs.length;
    const length = built.s[n - 1];
    this.length = length;
    this.spine =
      bend === 0 && n === spine.pointCount
        ? spine
        : new Polyline(
            Array.from(built.xs, (x, i) => new Vec2(x, built.ys[i])),
          );

    const profile = options.profile ?? leaf();
    const sides =
      typeof profile === "function" || "outline" in profile
        ? { left: profile, right: profile }
        : profile;
    const half = width / 2;
    const side = (p: SweepProfile) =>
      typeof p === "function"
        ? functionSide(p, half, length, step, tolerance)
        : outlineSide(p, half, length, step);
    this.#left = side(sides.left);
    this.#right = sides.right === sides.left ? this.#left : side(sides.right);

    const lo = Math.min(this.#left.lo, this.#right.lo);
    const hi = Math.max(this.#left.hi, this.#right.hi);
    this.extent = [lo / length, hi / length];

    // Unrolled: the left edge base to tip (offsets negated), then the right
    // edge back. Drawn as is, that's a mirror image of the sweep (+x, the
    // right side, is on the left of +y on screen), so this ring runs
    // anticlockwise there and clockwise on the page.
    const flat: number[] = [];
    const le = this.#left.edge;
    for (let i = 0; i < le.length; i += 2) flat.push(-le[i], le[i + 1]);
    const re = this.#right.edge;
    for (let i = re.length - 2; i >= 0; i -= 2) flat.push(re[i], re[i + 1]);
    const ring = dedupe(flat);
    this.unrolled = new Polyline(
      ring.map(([o, s]) => new Vec2(o, s)),
      true,
    );

    const page = ring.map(([o, s]) => this.#place(s, o));
    let outline = simplify(new Polyline(page, true), tolerance);
    if (signedArea(outline) < 0) outline = outline.reversed();
    this.outline = outline;
    // The ring starts at the base of the left edge and ends at the base of
    // the right, so opened up it leaves out just the base.
    this.openOutline = simplify(new Polyline(page), tolerance);
  }

  /**
   * The point at `t` along the spine and `v` across it, as a fraction of
   * the half-width there: −1 is the left edge, 1 the right.
   */
  point(t: number, v: number): Vec2 {
    const s = t * this.length;
    const side = v < 0 ? this.#left : this.#right;
    return this.#place(s, v * side.at(s));
  }

  /** The point at `t` along the spine, `offset` mm to its right (or left). */
  pointAtOffset(t: number, offset: number): Vec2 {
    return this.#place(t * this.length, offset);
  }

  /**
   * The spine's position and direction at `t`. Before the base and past the
   * tip, the spine carries on straight.
   */
  frame(t: number): SweepFrame {
    this.#frameAt(t * this.length);
    return {
      point: new Vec2(this.#fx, this.#fy),
      tangent: new Vec2(this.#ftx, this.#fty),
      normal: new Vec2(-this.#fty, this.#ftx),
    };
  }

  /** Half-width in mm at `t` on the right side (`side` 1) or left (−1). */
  halfWidth(t: number, side: 1 | -1 = 1): number {
    return (side < 0 ? this.#left : this.#right).at(t * this.length);
  }

  /** The largest half-width in mm on the right side (`side` 1) or left (−1). */
  widest(side: 1 | -1 = 1): number {
    return (side < 0 ? this.#left : this.#right).widest;
  }

  /**
   * The spine from `from` to `to` (values of t), as an open path: a centre
   * vein, as on GM's leaves. Default the whole spine.
   */
  midrib(from = 0, to = 1): Polyline {
    if (!(to > from)) throw new RangeError("midrib: to must be after from");
    const s0 = from * this.length;
    const s1 = to * this.length;
    const pts = [this.#place(s0, 0)];
    const s = this.#s;
    for (let i = 0; i < s.length; i++) {
      if (s[i] > s0 && s[i] < s1) {
        pts.push(new Vec2(this.#xs[i], this.#ys[i]));
      }
    }
    pts.push(this.#place(s1, 0));
    return new Polyline(pts);
  }

  /** The point `o` mm right of the spine at distance `s` along it. */
  #place(s: number, o: number): Vec2 {
    this.#frameAt(s);
    return new Vec2(this.#fx - this.#fty * o, this.#fy + this.#ftx * o);
  }

  /** Sets the scratch frame to the spine's position and tangent at s mm. */
  #frameAt(s: number): void {
    const xs = this.#xs;
    const ys = this.#ys;
    const tx = this.#tx;
    const ty = this.#ty;
    const S = this.#s;
    const last = xs.length - 1;
    if (s <= 0 || s >= S[last]) {
      const i = s <= 0 ? 0 : last;
      const d = s <= 0 ? s : s - S[last];
      this.#fx = xs[i] + tx[i] * d;
      this.#fy = ys[i] + ty[i] * d;
      this.#ftx = tx[i];
      this.#fty = ty[i];
      return;
    }
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - S[lo]) / (S[hi] - S[lo]);
    this.#fx = xs[lo] + (xs[hi] - xs[lo]) * f;
    this.#fy = ys[lo] + (ys[hi] - ys[lo]) * f;
    let ux = tx[lo] + (tx[hi] - tx[lo]) * f;
    let uy = ty[lo] + (ty[hi] - ty[lo]) * f;
    let len = Math.hypot(ux, uy);
    if (len < 1e-9) {
      // The spine turns right round here: fall back to the chord.
      ux = xs[hi] - xs[lo];
      uy = ys[hi] - ys[lo];
      len = Math.hypot(ux, uy);
    }
    this.#ftx = ux / len;
    this.#fty = uy / len;
  }
}

interface BuiltSpine {
  xs: Float64Array;
  ys: Float64Array;
  /** Cumulative arc length at each vertex. */
  s: Float64Array;
  /** Unit tangent at each vertex. */
  tx: Float64Array;
  ty: Float64Array;
}

/**
 * The spine's vertices, arc lengths and vertex tangents. Each vertex's
 * tangent splits the turn between its two segments, so the frame doesn't
 * jump at corners.
 *
 * With `bend`, the spine is cut into short pieces and rebuilt from its
 * start with every tangent turned by bend · s / length. Each piece then
 * turns at a constant rate, so it's an arc, and its chord is worked out
 * exactly.
 */
function buildSpine(points: readonly Vec2[], bend: number): BuiltSpine {
  const px: number[] = [];
  const py: number[] = [];
  for (const p of points) {
    const k = px.length - 1;
    if (k >= 0 && Math.hypot(p.x - px[k], p.y - py[k]) < 1e-12) continue;
    px.push(p.x);
    py.push(p.y);
  }
  const n = px.length;
  if (n < 2) {
    throw new RangeError("Sweep: the spine needs two distinct points");
  }

  // Segment directions and lengths, and tangents at the vertices.
  const dx: number[] = [];
  const dy: number[] = [];
  const len: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const ex = px[i + 1] - px[i];
    const ey = py[i + 1] - py[i];
    const l = Math.hypot(ex, ey);
    dx.push(ex / l);
    dy.push(ey / l);
    len.push(l);
  }
  const vtx: number[] = [dx[0]];
  const vty: number[] = [dy[0]];
  for (let i = 1; i + 1 < n; i++) {
    let ux = dx[i - 1] + dx[i];
    let uy = dy[i - 1] + dy[i];
    const l = Math.hypot(ux, uy);
    if (l < 1e-9) {
      ux = dx[i - 1];
      uy = dy[i - 1];
    } else {
      ux /= l;
      uy /= l;
    }
    vtx.push(ux);
    vty.push(uy);
  }
  vtx.push(dx[n - 2]);
  vty.push(dy[n - 2]);

  if (bend === 0) {
    const s = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + len[i - 1];
    return {
      xs: Float64Array.from(px),
      ys: Float64Array.from(py),
      s,
      tx: Float64Array.from(vtx),
      ty: Float64Array.from(vty),
    };
  }

  // Cut into pieces short enough that each turns by under 1% of `bend`
  // and is at most 0.5 mm long, so chords stay close to the arcs.
  const total = len.reduce((a, b) => a + b, 0);
  const piece = Math.min(0.5, total / 100);
  const xs = [px[0]];
  const ys = [py[0]];
  const tx: number[] = [];
  const ty: number[] = [];
  let x = px[0];
  let y = py[0];
  let s = 0;
  const turn = (ux: number, uy: number, a: number) => {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return [ux * c - uy * sn, ux * sn + uy * c] as const;
  };
  for (let i = 0; i + 1 < n; i++) {
    const m = Math.max(1, Math.ceil(len[i] / piece));
    const h = len[i] / m;
    for (let j = 0; j < m; j++) {
      // Tangent at this vertex: the corner's at the original vertex, else
      // the segment's own direction.
      const [ax, ay] = turn(
        j === 0 ? vtx[i] : dx[i],
        j === 0 ? vty[i] : dy[i],
        (bend * s) / total,
      );
      tx.push(ax);
      ty.push(ay);
      // ∫ R(φ) d du over the piece, with φ linear in u: the chord of an arc.
      const phiA = (bend * s) / total;
      const phiB = (bend * (s + h)) / total;
      const half = (phiB - phiA) / 2;
      const sinc = Math.abs(half) < 1e-8 ? 1 : Math.sin(half) / half;
      const [cx, cy] = turn(dx[i], dy[i], (phiA + phiB) / 2);
      x += cx * h * sinc;
      y += cy * h * sinc;
      s += h;
      xs.push(x);
      ys.push(y);
    }
  }
  const [ex, ey] = turn(vtx[n - 1], vty[n - 1], bend);
  tx.push(ex);
  ty.push(ey);

  // Arc length along the new chords, so t matches the polyline drawn.
  const out = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    out[i] = out[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    s: out,
    tx: Float64Array.from(tx),
    ty: Float64Array.from(ty),
  };
}

/**
 * A side whose width comes from a `Profile`. Its edge is sampled at least
 * every `step` mm, and halved further wherever the width bends away from
 * a straight line between samples by more than half of `tolerance`.
 */
function functionSide(
  profile: Profile,
  half: number,
  length: number,
  step: number,
  tolerance: number,
): Side {
  const width = (t: number): number => {
    const w = profile(t);
    if (!Number.isFinite(w)) {
      throw new RangeError("Sweep: the profile gave a non-finite width");
    }
    return w > 0 ? w * half : 0;
  };
  const at = (s: number): number =>
    s >= 0 && s <= length ? width(s / length) : 0;

  const edge: number[] = [];
  let widest = 0;
  const push = (t: number, w: number) => {
    edge.push(w, t * length);
    if (w > widest) widest = w;
  };
  const refine = (
    a: number,
    wa: number,
    b: number,
    wb: number,
    depth: number,
  ): void => {
    const m = (a + b) / 2;
    const wm = width(m);
    if (depth < MAX_BISECT && Math.abs(wm - (wa + wb) / 2) > tolerance / 2) {
      refine(a, wa, m, wm, depth + 1);
      push(m, wm);
      refine(m, wm, b, wb, depth + 1);
    }
  };
  const count = Math.max(16, Math.ceil(length / step));
  let wPrev = width(0);
  push(0, wPrev);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const w = width(t);
    refine((i - 1) / count, wPrev, t, w, 0);
    push(t, w);
    wPrev = w;
  }
  return { at, edge, widest, lo: 0, hi: length };
}

/**
 * A side drawn from an `OutlineProfile`, its samples scaled to mm and
 * filled in so no step is longer than `step`.
 */
function outlineSide(
  profile: OutlineProfile,
  half: number,
  length: number,
  step: number,
): Side {
  const edge: number[] = [];
  let widest = 0;
  const pts = profile.outline;
  for (let i = 0; i < pts.length; i++) {
    const o = pts[i][0] * half;
    const s = pts[i][1] * length;
    if (i > 0) {
      const po = pts[i - 1][0] * half;
      const ps = pts[i - 1][1] * length;
      const m = Math.ceil(Math.hypot(o - po, s - ps) / step);
      for (let j = 1; j < m; j++) {
        const f = j / m;
        edge.push(po + (o - po) * f, ps + (s - ps) * f);
      }
    }
    edge.push(o, s);
    widest = Math.max(widest, o);
  }
  return {
    at: (s: number) => profile.width(s / length) * half,
    edge,
    widest,
    lo: profile.yMin * length,
    hi: profile.yMax * length,
  };
}

/** Pairs from a flat ring, without repeats (including last-to-first). */
function dedupe(flat: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === flat[i] && prev[1] === flat[i + 1]) continue;
    out.push([flat[i], flat[i + 1]]);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) break;
    out.pop();
  }
  return out;
}

/** Twice the signed area: positive when the ring runs clockwise on screen. */
function signedArea(ring: Polyline): number {
  const p = ring.points;
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}
