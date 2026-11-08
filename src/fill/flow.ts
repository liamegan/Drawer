import type { Vec2 } from "wtc-math";
import type { HiddenTest } from "../geometry/clip.js";
import { asList, type Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import type { ScalarField, VectorField } from "../field/fields.js";
import { streamlines } from "../field/streamlines.js";
import { insetShapes } from "./hatch.js";
import type { ToneField } from "./tone.js";

export interface FlowHatchOptions {
  /** The flow the lines follow. */
  field: VectorField;
  /** Distance between lines, in mm. Give this, or `tone` and `pen`. */
  spacing?: number;
  /**
   * A tone from 0 (paper) to 1 (solid), or a function giving the tone at
   * each point: lines are spaced `pen / tone` apart, so they cover about
   * `tone` of the paper. Needs `pen`.
   */
  tone?: number | ToneField;
  /** Pen width in mm, for `tone`. */
  pen?: number;
  /**
   * Widest spacing, in mm. Where the tone is too light for lines this far
   * apart, there are none. Default 4, as for `toneSpacing`.
   */
  maxSpacing?: number;
  /** How the shapes' rings combine. Default "nonzero", as in SVG. */
  rule?: FillRule;
  /** Keep lines this far inside the outline, in mm, as for `hatch`. Default 0. */
  inset?: number;
  /** Grid nodes per mm for `inset`. Default 5. */
  resolution?: number;
  /** See `streamlines`. */
  test?: number;
  /** See `streamlines`. */
  step?: number;
  /** See `streamlines`. Default one spacing. */
  minLength?: number;
  /** Longest line, in mm: longer flows are drawn in dashes. Default Infinity. */
  maxLength?: number;
  /** Where to start the first lines. Default the middle of the shapes. */
  seeds?: readonly Vec2[];
  /** Ends lines at ink already drawn, such as `doc.mask.hiddenTest()`. */
  stopAt?: HiddenTest;
  /** See `streamlines`. Default 0.01. */
  simplify?: number;
}

/**
 * Fills closed shapes with lines that follow a flow field, evenly spaced
 * (see `streamlines`): wood grain, hair, water. The spacing can come from a
 * tone, constant or varying, so lines crowd where it's dark and thin out
 * where it's light, with none where it's lighter than `pen / maxSpacing`.
 *
 * Coverage is approximate, within about 10% of `tone`: dark tones run a
 * little dark, since lines end where they come within half a spacing of
 * others, and light ones a little light, since the strip a line leaves along
 * the outline is a bigger share of the area when lines are far apart.
 */
export function flowHatch(
  shapes: Polyline | readonly Polyline[],
  options: FlowHatchOptions,
): Polyline[] {
  const separation = flowSeparation(options);
  if (separation === null) return [];
  const rule = options.rule ?? "nonzero";
  const inset = options.inset ?? 0;
  if (!(inset >= 0) || !Number.isFinite(inset)) {
    throw new RangeError("flowHatch: inset must be a non-negative number");
  }
  const given = asList(shapes).filter((p) => p.closed && p.pointCount >= 3);
  if (given.length === 0) return [];
  const region =
    inset > 0 ? insetShapes(given, inset, rule, options.resolution) : given;
  if (region.length === 0) return [];
  return streamlines(options.field, {
    region,
    // Level lines never cross, so the inset outline fills the same either way.
    rule: inset > 0 ? "evenodd" : rule,
    separation,
    test: options.test,
    step: options.step,
    minLength: options.minLength,
    maxLength: options.maxLength,
    seeds: options.seeds,
    stopAt: options.stopAt,
    simplify: options.simplify,
  });
}

/** The separation from `spacing` or `tone`, or null if there are no lines. */
function flowSeparation(
  options: FlowHatchOptions,
): number | ScalarField | null {
  const { spacing, tone, pen } = options;
  if (spacing !== undefined) {
    if (!(spacing > 0)) {
      throw new RangeError("flowHatch: spacing must be positive");
    }
    return spacing;
  }
  if (tone === undefined || pen === undefined) {
    throw new RangeError("flowHatch: give spacing, or tone and pen");
  }
  if (!(pen > 0)) throw new RangeError("flowHatch: pen must be positive");
  const maxSpacing = options.maxSpacing ?? 4;
  const at = (t: number) => {
    const s = pen / t;
    return t > 0 && s <= maxSpacing ? s : Infinity;
  };
  if (typeof tone === "number") {
    const s = at(tone);
    return s < Infinity ? s : null;
  }
  return (x, y) => at(tone(x, y));
}
