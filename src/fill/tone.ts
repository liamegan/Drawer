import { clipPolyline } from "../geometry/clip.js";
import type { Polyline } from "../geometry/Polyline.js";
import { hatchWith, type HatchOptions } from "./hatch.js";

/** Tone at a point on the page: 0 is bare paper, 1 is solid ink. */
export type ToneField = (x: number, y: number) => number;

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

export interface ShadeOptions extends Omit<HatchOptions, "spacing" | "angle"> {
  /** A tone from 0 (paper) to 1 (solid), or a function giving the tone at each point. */
  tone: number | ToneField;
  /** Pen width in mm. */
  pen: number;
  /** Angle of the first pass, in radians. Default π/4. */
  angle?: number;
  /** Angle of each pass. Default: `angle`, then +π/2, +π/4, −π/4. */
  angles?: readonly number[];
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
 * different angles, switch on as the tone darkens.
 *
 * A constant tone gives each pass an even spacing (see `toneSpacing`). A
 * tone field instead dithers lines: each pass is a lattice at one pen width
 * apart, every lattice line has a fixed threshold, and a line is drawn
 * wherever the local coverage beats it. Darker areas only ever gain lines,
 * so gradients stay clean, and the lattice is pinned like any other hatch, so
 * neighbouring shapes stay aligned. `join` is ignored for tone fields.
 */
export function shade(
  shapes: Polyline | readonly Polyline[],
  options: ShadeOptions,
): Polyline[] {
  const { tone, pen } = options;
  if (!(pen > 0)) throw new RangeError("shade: pen must be positive");
  const angle = options.angle ?? Math.PI / 4;
  const angles = options.angles ?? [
    angle,
    angle + Math.PI / 2,
    angle + Math.PI / 4,
    angle - Math.PI / 4,
  ];
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const passes = Math.min(angles.length, thresholds.length);
  const minLength = options.minLength ?? 0.2;
  const base: Omit<HatchOptions, "spacing" | "angle"> = {
    anchor: options.anchor,
    offset: options.offset,
    rule: options.rule,
    alternate: options.alternate,
    join: options.join,
    maxJoin: options.maxJoin,
    style: options.style,
    minLength,
  };

  const out: Polyline[] = [];
  for (let pass = 0; pass < passes; pass++) {
    if (typeof tone === "number") {
      const coverage = passCoverage(tone, thresholds, pass);
      const spacing = toneSpacing(coverage, {
        pen,
        maxSpacing: options.maxSpacing,
        aligned: options.aligned,
      });
      if (spacing === null) continue;
      out.push(
        ...hatchWith(shapes, { ...base, angle: angles[pass], spacing }),
      );
    } else {
      const most = passCoverage(1, thresholds, pass);
      if (most <= 0) continue;
      const step = options.toneStep ?? 0.25;
      out.push(
        ...hatchWith(
          shapes,
          { ...base, join: false, angle: angles[pass], spacing: pen },
          (k, piece) => {
            const threshold = vanDerCorput(k);
            if (threshold >= most) return [];
            return clipPolyline(
              piece,
              (x, y) => passCoverage(tone(x, y), thresholds, pass) <= threshold,
              { step, minLength },
            );
          },
        ),
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
