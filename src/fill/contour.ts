import type { Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import { DEFAULT_RESOLUTION } from "../sdf/grid.js";
import {
  finishPaths,
  isolines,
  traceLevels,
  type PathFinishOptions,
} from "../sdf/isolines.js";
import { SDF, sdf } from "../sdf/SDF.js";

/** What contour fills accept: closed paths, or a distance field. */
export type ContourShape = Polyline | readonly Polyline[] | SDF;

/**
 * How a shape becomes the distance field its contours follow, for
 * {@link contourHatch} and {@link contourSpiral}.
 */
export interface ContourFieldOptions {
  /** How the shapes' rings combine, for paths. Default "nonzero", as in SVG. */
  rule?: FillRule;
  /** Grid nodes per mm. Default 5 (0.2 mm cells). */
  resolution?: number;
  /**
   * Measure from the outline of a combined field, so contours are evenly
   * spaced from its edge. Default true. `false` contours the field as it is:
   * where shapes were unioned, the contours of each shape meet in creases.
   */
  exact?: boolean;
}

/** Options for {@link contourHatch}. */
export interface ContourHatchOptions
  extends ContourFieldOptions,
    PathFinishOptions {
  /** Distance between contours, in mm. */
  spacing: number;
  /**
   * Gap between the outline and the first contour, as a fraction of the
   * spacing. Default 0.5, half a spacing, as for `hatch`.
   */
  offset?: number;
}

/**
 * Fills a shape with contours: closed rings that follow its outline, each
 * `spacing` further in, until the shape runs out. Works for any shape,
 * concave or with holes; where a shape narrows, its contours split into
 * separate rings. Rings come back outermost first.
 *
 * Contours are traced from a distance field on a grid (`resolution`), so
 * they sit within a fraction of a cell of the true offsets. Sharp corners in
 * them can be cut off by up to half a cell's diagonal; `smooth` rounds them
 * deliberately. Pass an `SDF` to contour a boolean combination of shapes.
 */
export function contourHatch(
  shapes: ContourShape,
  options: ContourHatchOptions,
): Polyline[] {
  return contourHatchWith(shapes, options);
}

/**
 * `contourHatch`, with a hook that can cut up each ring before it is
 * returned, given the ring's index (0 is outermost). Used by tone fields.
 */
export function contourHatchWith(
  shapes: ContourShape,
  options: ContourHatchOptions,
  filter?: (k: number, ring: Polyline) => Polyline[],
): Polyline[] {
  const { spacing } = options;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("contourHatch: spacing must be a positive number");
  }
  const offset = options.offset ?? 0.5;
  const field = contourField(shapes, options);
  if (!field.bounds) return [];
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const grid = field.sample({ resolution });

  const deepest = grid.min;
  const levels: number[] = [];
  for (let k = 0; ; k++) {
    const level = -(offset + k) * spacing;
    if (!(level > deepest)) break;
    levels.push(level);
  }
  const out: Polyline[] = [];
  traceLevels(grid, levels).forEach((paths, k) => {
    for (const ring of finishPaths(paths, options)) {
      if (filter) out.push(...filter(k, ring));
      else out.push(ring);
    }
  });
  return out;
}

/**
 * The field contour fills measure from: the exact field of paths, or of the
 * outline of a combined field unless `exact` is false.
 */
export function contourField(
  shapes: ContourShape,
  options: ContourFieldOptions = {},
): SDF {
  if (!(shapes instanceof SDF)) return sdf(shapes, { rule: options.rule });
  if (shapes.exact || options.exact === false) return shapes;
  const outline = isolines(shapes, 0, {
    resolution: options.resolution,
    simplify: 0.01,
    minLength: 0,
  });
  // Level lines never cross, and they run in opposite directions round
  // holes, so either rule fills them correctly; even-odd skips the overlap
  // checks nonzero needs.
  return sdf(outline, { rule: "evenodd" });
}
