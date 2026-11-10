import { clipPolyline } from "../geometry/clip.js";
import { asList, type Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import { sdf } from "../sdf/SDF.js";
import { contourHatchWith } from "./contour.js";
import {
  anchorPoint,
  hatchWith,
  insetShapes,
  type HatchOptions,
} from "./hatch.js";

/** Tone at a point on the page: 0 is bare paper, 1 is solid ink. */
export type ToneField = (x: number, y: number) => number;

/** Options for {@link toneSpacing}. */
export interface ToneSpacingOptions {
  /** Pen width in mm. */
  pen: number;
  /** Widest spacing used, in mm; lighter tones get no lines. Default 4. */
  maxSpacing?: number;
  /**
   * Round the spacing to `maxSpacing / n` for a whole number `n`, so every
   * tone shares the lines of the lightest one and stays aligned across
   * shapes. Tone then comes in about `maxSpacing / pen` steps. Default true.
   */
  aligned?: boolean;
}

/**
 * Line spacing (mm) that gives `tone` with parallel lines of width `pen`:
 * lines cover `pen / spacing` of the paper. Returns null when the tone is too
 * light for any lines at `maxSpacing`.
 */
export function toneSpacing(
  tone: number,
  options: ToneSpacingOptions,
): number | null {
  const { pen } = options;
  if (!(pen > 0)) throw new RangeError("toneSpacing: pen must be positive");
  const maxSpacing = options.maxSpacing ?? 4;
  const coverage = clamp01(tone);
  if (coverage <= 0) return null;
  if (options.aligned ?? true) {
    const most = Math.max(1, Math.floor(maxSpacing / pen));
    const n = Math.min(most, Math.round((coverage * maxSpacing) / pen));
    return n >= 1 ? maxSpacing / n : null;
  }
  const spacing = pen / coverage;
  return spacing > maxSpacing ? null : spacing;
}

/** Tones at which each cross-hatching pass starts, by default. */
export const DEFAULT_THRESHOLDS: readonly number[] = [0, 0.4, 0.65, 0.85];

/**
 * The share of the paper that pass `pass` covers at `tone`. Passes fill in
 * turn: each one grows until the tone reaches the next pass's threshold,
 * then holds while the next takes over. So no pass ever thins out as the
 * tone darkens (gradients only gain lines), and together the passes cover
 * `tone` of the paper.
 */
export function passCoverage(
  tone: number,
  thresholds: readonly number[],
  pass: number,
): number {
  const t = clamp01(tone);
  let covered = 0;
  for (let i = 0; i <= pass && i < thresholds.length; i++) {
    if (t <= thresholds[i]) return 0;
    const end = i + 1 < thresholds.length ? thresholds[i + 1] : 1;
    const target = Math.min(t, end);
    if (i === pass) {
      return covered >= 1 ? 0 : clamp01((target - covered) / (1 - covered));
    }
    covered = Math.max(covered, target);
  }
  return 0;
}

/** Options for {@link shade}. */
export interface ShadeOptions extends Omit<HatchOptions, "spacing" | "angle"> {
  /** A tone from 0 (paper) to 1 (solid), or a function giving the tone at each point. */
  tone: number | ToneField;
  /** Pen width in mm. */
  pen: number;
  /** Angle of the first parallel pass, in radians. Default π/4. */
  angle?: number;
  /**
   * Angle of each parallel pass. Default: `angle`, then +π/2, +π/4, −π/4,
   * or the first three of those with `contour`.
   */
  angles?: readonly number[];
  /**
   * Make the first pass contours that follow the outline (see
   * `contourHatch`), with parallel passes cross-hatching over them as the
   * tone darkens. `angles` then lists only the parallel passes. Default false.
   */
  contour?: boolean;
  /** Tone at which each pass starts. Default `DEFAULT_THRESHOLDS`. */
  thresholds?: readonly number[];
  /** See `toneSpacing`. Default 4 mm. Constant tones only. */
  maxSpacing?: number;
  /** See `toneSpacing`. Default true. Constant tones only. */
  aligned?: boolean;
  /** How often a tone field is sampled along each line, in mm. Default 0.25. */
  toneStep?: number;
}

/**
 * Shades closed shapes to a tone with cross-hatching: more passes, at
 * different angles, switch on as the tone darkens. With `contour`, the first
 * pass is contours that follow the outline instead of parallel lines.
 *
 * A constant tone gives each pass an even spacing (see `toneSpacing`). A
 * tone field instead dithers lines: each pass is a lattice at one pen width
 * apart, every lattice line has a fixed threshold, and a line is drawn
 * wherever the local coverage beats it. Darker areas only ever gain lines,
 * so gradients stay clean, and the lattice is pinned like any other hatch, so
 * neighbouring shapes stay aligned. `join` is ignored for tone fields.
 * Contours dither the same way, ring by ring.
 *
 * `inset` is shared by every pass, and contours start from the inset
 * outline.
 */
export function shade(
  shapes: Polyline | readonly Polyline[],
  options: ShadeOptions,
): Polyline[] {
  const { tone, pen } = options;
  if (!(pen > 0)) throw new RangeError("shade: pen must be positive");
  const angle = options.angle ?? Math.PI / 4;
  const contour = options.contour ?? false;
  const defaultAngles = [
    angle,
    angle + Math.PI / 2,
    angle + Math.PI / 4,
    angle - Math.PI / 4,
  ];
  const angles = options.angles ?? defaultAngles.slice(0, contour ? 3 : 4);
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const first = contour ? 1 : 0;
  const passes = Math.min(first + angles.length, thresholds.length);
  const minLength = options.minLength ?? 0.2;
  const step = options.toneStep ?? 0.25;
  const rule: FillRule = options.rule ?? "nonzero";
  const inset = options.inset ?? 0;
  if (!(inset >= 0) || !Number.isFinite(inset)) {
    throw new RangeError("shade: inset must be a non-negative number");
  }

  const given = asList(shapes).filter((p) => p.closed && p.pointCount >= 3);
  if (given.length === 0) return [];
  // Inset once for every pass. The anchor is resolved first, so a local
  // lattice sits where it would without the inset.
  const closed =
    inset > 0 ? insetShapes(given, inset, rule, options.resolution) : given;
  if (closed.length === 0) return [];
  const base: Omit<HatchOptions, "spacing" | "angle"> = {
    anchor: anchorPoint(options.anchor ?? "page", given),
    offset: options.offset,
    rule: inset > 0 ? "evenodd" : rule,
    alternate: options.alternate,
    join: options.join,
    maxJoin: options.maxJoin,
    style: options.style,
    minLength,
  };

  const out: Polyline[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const most = passCoverage(1, thresholds, pass);
    if (most <= 0) continue;
    const dither =
      typeof tone === "number"
        ? undefined
        : (k: number, piece: Polyline) => {
            const threshold = vanDerCorput(k);
            if (threshold >= most) return [];
            return clipPolyline(
              piece,
              (x, y) => passCoverage(tone(x, y), thresholds, pass) <= threshold,
              { step, minLength },
            );
          };
    let spacing = pen;
    if (typeof tone === "number") {
      const s = toneSpacing(passCoverage(tone, thresholds, pass), {
        pen,
        maxSpacing: options.maxSpacing,
        aligned: options.aligned,
      });
      if (s === null) continue;
      spacing = s;
    }

    if (pass < first) {
      // Shrinking an exact field keeps it exact inside, so contours are
      // measured from the inset outline without re-tracing it.
      const field = sdf(given, { rule }).offset(-inset);
      out.push(
        ...contourHatchWith(
          field,
          {
            spacing,
            offset: options.offset,
            resolution: options.resolution,
            minLength,
          },
          dither,
        ),
      );
    } else {
      const lines = { ...base, angle: angles[pass - first], spacing };
      out.push(
        ...(dither
          ? hatchWith(closed, { ...lines, join: false }, dither)
          : hatchWith(closed, lines)),
      );
    }
  }
  return out;
}

/**
 * Base-2 van der Corput sequence: 0, 1/2, 1/4, 3/4, 1/8, ... Taking the lines
 * whose value is below a density d spreads them evenly, and raising d only
 * adds lines.
 */
export function vanDerCorput(k: number): number {
  let n = ((k % 65536) + 65536) % 65536;
  let x = 0;
  let f = 0.5;
  while (n > 0) {
    if (n & 1) x += f;
    n >>= 1;
    f /= 2;
  }
  return x;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
