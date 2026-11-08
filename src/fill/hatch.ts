import { Vec2 } from "wtc-math";
import { Bounds } from "../geometry/Bounds.js";
import {
  clipToShape,
  segmentCrossings,
  shapeEdges,
  windingAt,
} from "../geometry/clip.js";
import { asList, Polyline } from "../geometry/Polyline.js";
import { ScanlineSweep, type FillRule } from "../geometry/scanline.js";
import { isolines } from "../sdf/isolines.js";
import { sdf } from "../sdf/SDF.js";

/**
 * Where the family of hatch lines is pinned:
 * - `"page"`: the page origin, so shapes hatched with the same angle and
 *   spacing share collinear lines, and the hatching reads as one tint across
 *   the page;
 * - `"local"`: the centre of the shapes being hatched, so the lines sit
 *   symmetrically in them;
 * - a `Vec2`: that point, in mm.
 */
export type HatchAnchor = "page" | "local" | Vec2;

/** One line of the lattice, in the hatch frame: `u` runs along the lines, `v` across. */
export interface HatchLine {
  /** Index of the line in the lattice. Counted from the anchor, so global for `"page"`. */
  k: number;
  /** Position of the line across the hatch direction. */
  v: number;
  /** Where to start and stop along the line: the shape's extent plus a margin. */
  u0: number;
  u1: number;
}

/**
 * Builds one hatch line as [u, v] points in the hatch frame. The result is
 * clipped exactly to the shape afterwards, so it can run past the edges.
 */
export type LineStyle = (
  line: HatchLine,
) => ReadonlyArray<readonly [number, number]>;

/** Plain straight lines. Hatching with this style skips clipping and uses exact spans. */
export const straight: LineStyle = ({ v, u0, u1 }) => [
  [u0, v],
  [u1, v],
];

export interface SineOptions {
  /** Height of the wave either side of the line, in mm. Keep under half the spacing to avoid touching neighbours. */
  amplitude: number;
  /** Length of one wave, in mm. */
  wavelength: number;
  /** Phase in radians. Default 0. */
  phase?: number;
  /** Extra phase per lattice line, in radians. Default 0 (waves stacked in step). */
  phaseStep?: number;
  /** Points per wavelength. Default 16. */
  resolution?: number;
}

/**
 * Wavy lines. The phase is taken from the position along the line in page
 * space, so waves line up across shapes as well.
 */
export function sine(options: SineOptions): LineStyle {
  const { amplitude, wavelength } = options;
  if (!(wavelength > 0)) throw new RangeError("sine: wavelength must be positive");
  const phase = options.phase ?? 0;
  const phaseStep = options.phaseStep ?? 0;
  const step = wavelength / (options.resolution ?? 16);
  const w = (Math.PI * 2) / wavelength;
  return ({ k, v, u0, u1 }) => {
    const points: [number, number][] = [];
    const first = Math.floor(u0 / step);
    const last = Math.ceil(u1 / step);
    for (let i = first; i <= last; i++) {
      const u = i * step;
      points.push([u, v + amplitude * Math.sin(u * w + phase + k * phaseStep)]);
    }
    return points;
  };
}

export interface HatchOptions {
  /** Distance between lines, in mm. */
  spacing: number;
  /**
   * Direction of the lines in radians. 0 is horizontal; positive turns
   * clockwise on screen, as with `rotation()`. Default 0.
   */
  angle?: number;
  /** Where the lattice of lines is pinned. Default `"page"`. */
  anchor?: HatchAnchor;
  /**
   * Shifts the lattice off its anchor by this fraction of the spacing.
   * The default, 0.5, keeps lines off the edges of shapes drawn on the same
   * grid as the spacing (say a rectangle at whole mm, hatched at 1 mm).
   */
  offset?: number;
  /** How the shapes' rings combine. Default "nonzero", as in SVG. */
  rule?: FillRule;
  /**
   * Run every other line backwards, so the pen zigzags instead of returning
   * to the same side. Same look, less travel. Default true.
   */
  alternate?: boolean;
  /**
   * Connect the end of each line to the start of the next with a short
   * stroke inside the shape, making a continuous zigzag. Changes the look.
   * Implies `alternate`. Default false.
   */
  join?: boolean;
  /** Longest connecting stroke `join` may add, in mm. Default 2 × spacing. */
  maxJoin?: number;
  /** How each line is drawn. Default `straight`. */
  style?: LineStyle;
  /** Pieces shorter than this (mm) are dropped. Default 0.2. */
  minLength?: number;
  /**
   * Keep lines this far inside the outline, in mm, measured square to the
   * edge (so the gap doesn't widen where lines meet the edge at a shallow
   * angle). The shape is shrunk through a distance field, so the gap is
   * accurate to a small fraction of `resolution`'s cells, and sharp inward
   * corners of the shrunk outline are cut by up to half a cell's diagonal.
   * Default 0.
   */
  inset?: number;
  /** Grid nodes per mm for `inset`. Default 5 (0.2 mm cells). */
  resolution?: number;
}

/**
 * Fills the closed paths in `shapes` with parallel lines, cut exactly at
 * their edges. Open paths are ignored.
 *
 * Lines sit at a fixed lattice of positions (`anchor`, `offset`, `spacing`),
 * not at positions fitted to each shape, so separate shapes hatched alike
 * line up. Combine with occlusion by drawing the lines with the outline:
 * `doc.draw("ink", [outline, ...hatch(outline, o)], { silhouette: outline })`.
 */
export function hatch(
  shapes: Polyline | readonly Polyline[],
  options: HatchOptions,
): Polyline[] {
  return hatchWith(shapes, options);
}

/**
 * `hatch`, with a hook that can cut up each line's pieces before they are
 * ordered and joined. Used by tone fields.
 */
export function hatchWith(
  shapes: Polyline | readonly Polyline[],
  options: HatchOptions,
  filter?: (k: number, piece: Polyline) => Polyline[],
): Polyline[] {
  const { spacing } = options;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("hatch: spacing must be a positive number");
  }
  const angle = options.angle ?? 0;
  const offset = options.offset ?? 0.5;
  const rule = options.rule ?? "nonzero";
  const join = options.join ?? false;
  const alternate = join || (options.alternate ?? true);
  const style = options.style ?? straight;
  const minLength = options.minLength ?? 0.2;

  const inset = options.inset ?? 0;
  if (!(inset >= 0) || !Number.isFinite(inset)) {
    throw new RangeError("hatch: inset must be a non-negative number");
  }

  const given = asList(shapes).filter((p) => p.closed && p.pointCount >= 3);
  if (given.length === 0) return [];
  // The anchor comes from the shapes as given, so insetting doesn't move a
  // local lattice.
  const anchor = anchorPoint(options.anchor ?? "page", given);
  const closed =
    inset > 0 ? insetShapes(given, inset, rule, options.resolution) : given;
  if (closed.length === 0) return [];
  // Level lines never cross, so the inset outline fills the same either way.
  const fillRule: FillRule = inset > 0 ? "evenodd" : rule;

  // The hatch frame: u along the lines, v across them.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rings = closed.map((shape) => {
    const ring = new Float64Array(shape.pointCount * 2);
    shape.points.forEach((p, i) => {
      ring[2 * i] = p.x * cos + p.y * sin;
      ring[2 * i + 1] = -p.x * sin + p.y * cos;
    });
    return ring;
  });
  const toPage = (u: number, v: number) =>
    new Vec2(u * cos - v * sin, u * sin + v * cos);

  const sweep = new ScanlineSweep(rings);
  if (sweep.edgeCount === 0) return [];

  const v0 = -anchor.x * sin + anchor.y * cos + offset * spacing;
  const isStraight = style === straight;
  // Styled lines can wander off their base line, so look one line further out.
  const extra = isStraight ? 0 : 1;
  const kStart = Math.ceil((sweep.minY - v0) / spacing) - extra;
  const kEnd = Math.floor((sweep.maxY - v0) / spacing) + extra;

  const lines: { k: number; pieces: Polyline[] }[] = [];
  const spans = new Float64Array(sweep.edgeCount);
  const u0 = sweep.minX - spacing;
  const u1 = sweep.maxX + spacing;

  for (let k = kStart; k <= kEnd; k++) {
    const v = v0 + k * spacing;
    let pieces: Polyline[] = [];
    if (isStraight) {
      const n = sweep.spans(v, fillRule, spans);
      for (let i = 0; i < n; i++) {
        const ua = spans[2 * i];
        const ub = spans[2 * i + 1];
        if (ub - ua < minLength) continue;
        pieces.push(new Polyline([toPage(ua, v), toPage(ub, v)]));
      }
    } else {
      const points = style({ k, v, u0, u1 }).map(([u, w]) => toPage(u, w));
      pieces = clipToShape(new Polyline(points), closed, {
        rule: fillRule,
        minLength,
      });
    }
    if (filter) pieces = pieces.flatMap((piece) => filter(k, piece));
    if (alternate && (k & 1) === 1) {
      pieces = pieces.reverse().map((piece) => piece.reversed());
    }
    lines.push({ k, pieces });
  }

  if (!join) return lines.flatMap((line) => line.pieces);
  return joinLines(lines, closed, fillRule, options.maxJoin ?? spacing * 2);
}

/**
 * The outline of `shapes` shrunk by `inset` mm, through a distance field.
 * Rings come back oriented so either fill rule fills them alike.
 */
export function insetShapes(
  shapes: readonly Polyline[],
  inset: number,
  rule: FillRule,
  resolution?: number,
): Polyline[] {
  return isolines(sdf(shapes, { rule }), -inset, {
    resolution,
    simplify: 0.01,
    minLength: 0,
  });
}

export function anchorPoint(
  anchor: HatchAnchor,
  shapes: readonly Polyline[],
): Vec2 {
  if (anchor === "page") return new Vec2(0, 0);
  if (anchor === "local") {
    return Bounds.fromPoints(shapes.flatMap((s) => s.points)).center;
  }
  return anchor;
}

/**
 * Chains each line's pieces onto the pieces of the line before, wherever the
 * connecting stroke is short enough and stays inside the shape.
 */
function joinLines(
  lines: readonly { k: number; pieces: Polyline[] }[],
  shapes: readonly Polyline[],
  rule: FillRule,
  maxJoin: number,
): Polyline[] {
  const edges = shapeEdges(shapes);
  const inside = (x: number, y: number) => {
    const w = windingAt(edges, x, y);
    return rule === "evenodd" ? w % 2 !== 0 : w !== 0;
  };
  const crossings: number[] = [];
  const connects = (a: Vec2, b: Vec2): boolean => {
    crossings.length = 0;
    segmentCrossings(edges, a.x, a.y, b.x, b.y, crossings);
    for (const t of crossings) if (t > 1e-9 && t < 1 - 1e-9) return false;
    return inside((a.x + b.x) / 2, (a.y + b.y) / 2);
  };

  const done: Polyline[] = [];
  let open: Vec2[][] = [];
  for (const { pieces } of lines) {
    const used = new Set<Vec2[]>();
    const next: Vec2[][] = [];
    for (const piece of pieces) {
      const start = piece.start!;
      let best: Vec2[] | null = null;
      let bestDistance = maxJoin;
      for (const chain of open) {
        if (used.has(chain)) continue;
        const d = chain[chain.length - 1].distance(start);
        if (d <= bestDistance && connects(chain[chain.length - 1], start)) {
          best = chain;
          bestDistance = d;
        }
      }
      if (best) {
        used.add(best);
        best.push(...piece.points);
        next.push(best);
      } else {
        next.push([...piece.points]);
      }
    }
    for (const chain of open) {
      if (!used.has(chain)) done.push(new Polyline(chain));
    }
    open = next;
  }
  for (const chain of open) done.push(new Polyline(chain));
  return done;
}
