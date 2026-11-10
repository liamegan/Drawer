import { Vec2 } from "wtc-math";
import { insetShapes } from "../fill/hatch.js";
import { toneSpacing, vanDerCorput } from "../fill/tone.js";
import { clipPolyline, clipToEdges, shapeEdges } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { Region } from "../geometry/region.js";
import { simplify } from "../geometry/simplify.js";
import type { Sweep } from "./Sweep.js";

/** Options for {@link sweepHatch}. */
export interface SweepHatchOptions {
  /**
   * "across" draws lines from edge to edge at constant t, like the veins of
   * a leaf; "along" draws them from base to tip at constant v, following
   * the edges in towards the tip. Default "across".
   */
  direction?: "across" | "along";
  /** Distance between lines, in mm. Give this, or `tone` and `pen`. */
  spacing?: number;
  /**
   * A tone from 0 (paper) to 1 (solid): lines are spaced `pen / tone`
   * apart, so they cover about `tone` of the shape. Needs `pen`.
   */
  tone?: number;
  /** Pen width in mm, for `tone`. */
  pen?: number;
  /** Widest spacing for `tone`, mm; lighter tones get no lines. Default 4. */
  maxSpacing?: number;
  /**
   * The part of the width to hatch, as [from, to] values of v (−1 is the
   * left edge, 1 the right). [0, 1] hatches only the right half, as for a
   * shaded side. Ends inside the shape stay where they are. Default [−1, 1].
   */
  span?: readonly [number, number];
  /** Across: the first line's distance from the base, mm. Default spacing/2. */
  offset?: number;
  /**
   * Across: how far, in mm, each line's ends sit towards the tip from its
   * middle, so lines bow into chevrons, like veins. It fades out at the
   * base and the tip. Keep it under a third of the length so lines don't
   * cross. Default 0.
   */
  bow?: number;
  /**
   * Across: how far, in mm, the right edge's end of each line sits towards
   * the tip (and the left edge's away from it), for slanted lines.
   * Default 0.
   */
  slant?: number;
  /**
   * Along: lines meet where the shape narrows, so they're ended in pairs
   * wherever two would come closer than this fraction of `spacing`. True
   * is 0.5; about 0.72 keeps the tone even, since the gaps then range
   * evenly either side of `spacing`. False runs every line to the tip.
   * Default true.
   */
  thin?: boolean | number;
  /** Distance between points on curved lines, in mm. Default 0.25. */
  step?: number;
  /** Keep lines this far inside the outline, mm, as for `hatch`. Default 0. */
  inset?: number;
  /** Grid nodes per mm for `inset`. Default 5. */
  resolution?: number;
  /** Pieces shorter than this (mm) after clipping are dropped. Default 0.2. */
  minLength?: number;
  /** Points within this many mm of a curved line are dropped. Default 0.01. */
  simplify?: number;
}

/** How far past the widest point across lines start before clipping, mm. */
const MARGIN = 1;
const BISECTIONS = 30;

/**
 * Hatches a sweep in its own coordinates (see `Sweep`), so the lines follow
 * its form: across it at constant t, curving with the spine, or along it
 * at constant v, narrowing with the edges.
 *
 * Lines are laid out and clipped in the unrolled sweep (`Sweep.unrolled`),
 * then carried onto the page. They are cut at the true edge of the shape,
 * and a line can't pick up stray pieces where the sweep curls back past
 * itself.
 *
 * Across lines are `spacing` apart along the spine. Along lines split the
 * widest point evenly into steps of about `spacing`, with the outline as
 * the outermost line, so the gap from the last line to the edge matches
 * the rest.
 */
export function sweepHatch(
  sweep: Sweep,
  options: SweepHatchOptions = {},
): Polyline[] {
  const spacing = hatchSpacing(options);
  if (spacing === null) return [];
  const [v0, v1] = options.span ?? [-1, 1];
  if (!(v0 >= -1 && v1 <= 1 && v0 < v1)) {
    throw new RangeError("sweepHatch: span must run from -1 to 1, low first");
  }
  const step = options.step ?? 0.25;
  if (!(step > 0)) throw new RangeError("sweepHatch: step must be positive");
  const minLength = options.minLength ?? 0.2;
  const tolerance = options.simplify ?? 0.01;
  const inset = options.inset ?? 0;
  if (!(inset >= 0) || !Number.isFinite(inset)) {
    throw new RangeError("sweepHatch: inset must be a non-negative number");
  }
  const length = sweep.length;

  let unrolled: Polyline[];
  if (options.direction === "along") {
    const region = new Region(sweep.unrolled);
    const outside = (x: number, y: number) => !region.contains(x, y);
    const ratio = thinning(options.thin);
    unrolled = alongLines(sweep, spacing, v0, v1, step, ratio).flatMap(
      (line) => clipPolyline(line, outside, { step, minLength }),
    );
  } else {
    const edges = shapeEdges(sweep.unrolled);
    unrolled = acrossLines(sweep, spacing, v0, v1, step, options).flatMap(
      (line) => clipToEdges(line, edges, { minLength }),
    );
  }

  let lines = unrolled.map((line) => {
    const page = new Polyline(
      line.points.map((p) => sweep.pointAtOffset(p.y / length, p.x)),
    );
    return page.pointCount > 2 ? simplify(page, tolerance) : page;
  });

  if (inset > 0) {
    const rings = insetShapes(
      [sweep.outline],
      inset,
      "nonzero",
      options.resolution,
    );
    if (rings.length === 0) return [];
    const edges = shapeEdges(rings);
    // Level lines never cross, so the inset outline fills the same either way.
    lines = lines.flatMap((line) =>
      clipToEdges(line, edges, { rule: "evenodd", minLength }),
    );
  }
  return lines;
}

function hatchSpacing(options: SweepHatchOptions): number | null {
  const { spacing, tone, pen } = options;
  if (spacing !== undefined) {
    if (!(spacing > 0)) {
      throw new RangeError("sweepHatch: spacing must be positive");
    }
    return spacing;
  }
  if (tone === undefined || pen === undefined) {
    throw new RangeError("sweepHatch: give spacing, or tone and pen");
  }
  return toneSpacing(tone, {
    pen,
    maxSpacing: options.maxSpacing,
    aligned: false,
  });
}

/** The closest-gap fraction for `thin`, or null for no thinning. */
function thinning(thin: boolean | number | undefined): number | null {
  if (thin === false) return null;
  if (thin === undefined || thin === true) return 0.5;
  if (!(thin > 0 && thin <= 1)) {
    throw new RangeError("sweepHatch: thin must be between 0 and 1");
  }
  return thin;
}

/**
 * Lines at constant t, from edge to edge (or the span's ends), in the
 * unrolled space: x is the offset across, y the distance along.
 */
function acrossLines(
  sweep: Sweep,
  spacing: number,
  v0: number,
  v1: number,
  step: number,
  options: SweepHatchOptions,
): Polyline[] {
  const length = sweep.length;
  const [t0, t1] = sweep.extent;
  const lo = t0 * length;
  const hi = t1 * length;
  const offset = options.offset ?? spacing / 2;
  const bow = options.bow ?? 0;
  const slant = options.slant ?? 0;
  if (!Number.isFinite(bow) || !Number.isFinite(slant)) {
    throw new RangeError("sweepHatch: bow and slant must be finite");
  }
  const wideL = sweep.widest(-1);
  const wideR = sweep.widest(1);
  const across = (o: number) => {
    const w = o < 0 ? wideL : wideR;
    return w > 0 ? Math.max(-1, Math.min(1, o / w)) : 0;
  };
  // Along-the-spine shift of the point o across a line through s.
  const shift = (o: number, s: number): number => {
    const u = across(o);
    const f = (s - lo) / (hi - lo);
    const fade = f > 0 && f < 1 ? Math.sin(Math.PI * f) : 0;
    return slant * u + bow * Math.abs(u) ** 1.5 * fade;
  };
  const curved = bow !== 0 || slant !== 0;
  // With slant, lines centred past the ends can reach in.
  const reach = Math.abs(slant);

  const lines: Polyline[] = [];
  const first = Math.ceil((lo - reach - offset) / spacing);
  const last = Math.floor((hi + reach - offset) / spacing);
  for (let k = first; k <= last; k++) {
    const s = offset + k * spacing;
    const t = s / length;
    const oA =
      v0 <= -1 ? -(wideL + MARGIN) : v0 * sweep.halfWidth(t, v0 < 0 ? -1 : 1);
    const oB =
      v1 >= 1 ? wideR + MARGIN : v1 * sweep.halfWidth(t, v1 < 0 ? -1 : 1);
    if (!(oB > oA)) continue;
    if (!curved) {
      lines.push(new Polyline([new Vec2(oA, s), new Vec2(oB, s)]));
      continue;
    }
    const n = Math.max(1, Math.ceil((oB - oA) / step));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const o = oA + ((oB - oA) * i) / n;
      pts.push(new Vec2(o, s + shift(o, s)));
    }
    lines.push(new Polyline(pts));
  }
  return lines;
}

/**
 * Lines at constant v, from base to tip, in the unrolled space. Each side's
 * lines sit at v = k / K, where K steps of about `spacing` span its widest
 * point, plus the spine itself (v = 0).
 *
 * Thinning: neighbouring lines are `w(s) / K` apart where the half-width is
 * w(s). Line k, with k = m · 2^j for odd m, ends wherever it would come
 * within `r · spacing` of the nearest line of a higher level (2^j steps
 * away) or of the edge (K − k steps away). Any line next to it is of a
 * higher level, or of the same level and further off, and the spine never
 * ends, so the gaps stay at least `ratio · spacing` all the way to the tip
 * as long as every line's r is at least `ratio`.
 *
 * Each line's r is `ratio` times 2^(φ/2) for a van der Corput φ in [0, 1),
 * so the lines of a level end one by one over a stretch instead of all at
 * once, which would show as a step in tone. Every line of a level still
 * ends before any line of the next, since their ranges of r don't overlap.
 */
function alongLines(
  sweep: Sweep,
  spacing: number,
  v0: number,
  v1: number,
  step: number,
  ratio: number | null,
): Polyline[] {
  const length = sweep.length;
  const [t0, t1] = sweep.extent;
  const lo = t0 * length;
  const hi = t1 * length;
  const count = Math.max(1, Math.ceil((hi - lo) / step));
  const grid = Array.from({ length: count + 1 }, (_, i) =>
    i === count ? hi : lo + ((hi - lo) * i) / count,
  );

  const lines: Polyline[] = [];
  // The spine, across the whole extent; clipping trims it to the shape.
  if (v0 <= 0 && v1 >= 0) {
    lines.push(new Polyline(grid.map((s) => new Vec2(0, s))));
  }

  for (const side of [-1, 1] as const) {
    const widest = sweep.widest(side);
    const steps = Math.max(1, Math.round(widest / spacing));
    const width = (s: number) => sweep.halfWidth(s / length, side);
    // Alive stretches per threshold width, shared by lines that use it.
    const cache = new Map<number, [number, number][]>();
    // Lines so far per step count to the nearest line they defer to.
    const seen = new Map<number, number>();
    for (let k = 1; k < steps; k++) {
      const v = (side * k) / steps;
      const apart = Math.min(2 ** trailingZeros(k), steps - k);
      const i = seen.get(apart) ?? 0;
      seen.set(apart, i + 1);
      if (v < v0 || v > v1) continue;
      let need = 0;
      if (ratio !== null) {
        // The i-th line with this gap. Both sides share one sequence,
        // taking turns at going first, so no two lines end at the same
        // place and neither side ends all its lines before the other.
        const phi = vanDerCorput(2 * i + ((side > 0 ? 1 : 0) ^ (i & 1)));
        const r = ratio * 2 ** (phi / 2);
        need = (r * spacing * steps) / apart;
      }
      let stretches = cache.get(need);
      if (!stretches) {
        stretches = aliveStretches(grid, width, need);
        cache.set(need, stretches);
      }
      for (const [a, b] of stretches) {
        const pts = [new Vec2(v * width(a), a)];
        for (const s of grid) {
          if (s > a && s < b) pts.push(new Vec2(v * width(s), s));
        }
        pts.push(new Vec2(v * width(b), b));
        lines.push(new Polyline(pts));
      }
    }
  }
  return lines;
}

/**
 * Stretches of `grid` where the half-width is at least `need` (or above 0
 * when `need` is 0), with their ends found by bisection.
 */
function aliveStretches(
  grid: readonly number[],
  width: (s: number) => number,
  need: number,
): [number, number][] {
  const alive = (s: number) => (need > 0 ? width(s) >= need : width(s) > 0);
  const edge = (a: number, b: number, aliveAtA: boolean): number => {
    let x = a;
    let y = b;
    for (let i = 0; i < BISECTIONS; i++) {
      const m = (x + y) / 2;
      if (alive(m) === aliveAtA) x = m;
      else y = m;
    }
    return aliveAtA ? x : y;
  };
  const out: [number, number][] = [];
  let start: number | null = alive(grid[0]) ? grid[0] : null;
  for (let i = 1; i < grid.length; i++) {
    const now = alive(grid[i]);
    if (start === null && now) {
      start = edge(grid[i - 1], grid[i], false);
    } else if (start !== null && !now) {
      out.push([start, edge(grid[i - 1], grid[i], true)]);
      start = null;
    }
  }
  if (start !== null) out.push([start, grid[grid.length - 1]]);
  return out.filter(([a, b]) => b > a);
}

function trailingZeros(k: number): number {
  let n = 0;
  while (k % 2 === 0 && k > 0) {
    k /= 2;
    n++;
  }
  return n;
}
