import { Vec2 } from "wtc-math";
import { Sheet } from "../sheet/Sheet.js";
import type { Polyline } from "../geometry/Polyline.js";
import { simplify } from "../geometry/simplify.js";
import { dedupePaths, type DedupeOptions } from "./dedupe.js";
import { mergePaths } from "./merge.js";
import { sortPaths } from "./sort.js";

/** Options for {@link optimize} and {@link optimizePaths}. */
export interface OptimizeOptions {
  /**
   * Drop points within this many mm of the path (RDP), or false to keep
   * every point. Default 0.02, far below any pen width.
   */
  simplify?: number | false;
  /** Remove ink drawn twice (see `dedupePaths`), or false. Default on. */
  dedupe?: DedupeOptions | false;
  /** Join paths whose ends are this close (mm), or false. Default 0.05. */
  merge?: number | false;
  /**
   * Reorder paths to cut pen-up travel (see `sortPaths`), or false.
   * `rotateClosed` starts each closed path at its vertex nearest the pen.
   * Default on, with `rotateClosed`.
   */
  sort?: { rotateClosed?: boolean } | false;
  /** Where the pen starts each layer, mm. Default (0, 0), the top-left corner. */
  home?: Vec2;
}

/**
 * A copy of `sheet` made for plotting: the same sheet and layers, in the same
 * order with the same pens, but each layer's paths simplified, cleared of
 * ink drawn twice, joined where their ends meet and sorted to cut pen-up
 * travel (see `optimizePaths`). Layers are never mixed or reordered, since
 * each is a pen. `sheet` is left as it is; the copy has a fresh, empty mask.
 */
export function optimize(
  sheet: Sheet,
  options: OptimizeOptions = {},
): Sheet {
  const out = new Sheet({
    paper: sheet.paper,
    orientation: sheet.orientation,
    margin: sheet.margin,
    paperColor: sheet.paperColor,
    occlusion: sheet.occlusion,
  });
  for (const layer of sheet.layers) {
    const copy = out.layer(layer.name, layer.pen);
    // One at a time: a dense layer can have more paths than a call takes
    // arguments.
    for (const path of optimizePaths(layer.paths, options)) copy.add(path);
  }
  return out;
}

/**
 * Prepares one pen's paths for plotting, in this order:
 * 1. `simplify` each path (RDP);
 * 2. `dedupe`: remove ink drawn on top of earlier ink;
 * 3. `merge`: join paths whose ends meet, including the pieces dedupe left;
 * 4. `sort`: order them, nearest first, from `home`.
 *
 * Any step can be turned off. Paths with fewer than two points are dropped.
 */
export function optimizePaths(
  paths: readonly Polyline[],
  options: OptimizeOptions = {},
): Polyline[] {
  let out = paths.filter((p) => p.pointCount >= 2);
  const tolerance = options.simplify ?? 0.02;
  if (tolerance !== false && tolerance > 0) {
    out = out.map((p) => simplify(p, tolerance));
  }
  if (options.dedupe !== false) out = dedupePaths(out, options.dedupe);
  const merge = options.merge ?? 0.05;
  if (merge !== false) out = mergePaths(out, { tolerance: merge });
  if (options.sort !== false) {
    out = sortPaths(out, {
      start: options.home ?? new Vec2(0, 0),
      rotateClosed: options.sort?.rotateClosed,
    });
  }
  return out;
}
