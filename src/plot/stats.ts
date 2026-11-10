import { Vec2 } from "wtc-math";
import type { Sheet } from "../sheet/Sheet.js";
import type { Polyline } from "../geometry/Polyline.js";
import { travelLength } from "./sort.js";

/** Options for {@link plotStats} and {@link pathStats}. */
export interface PlotStatsOptions {
  /** Pen-down speed, mm/s. Default 50. */
  drawSpeed?: number;
  /** Pen-up speed, mm/s. Default 150. */
  travelSpeed?: number;
  /** Seconds to lift and lower the pen once. Default 0.3. */
  liftTime?: number;
  /** Where the pen starts and finishes each layer. Default (0, 0). */
  home?: Vec2;
}

/** Distances, pen lifts and time for a set of paths. */
export interface PathStats {
  /** Paths drawn: one pen lift each. */
  paths: number;
  /** Points across all paths. */
  points: number;
  /** Pen-down distance, mm. */
  penDown: number;
  /** Pen-up distance, mm, from home through every path and back. */
  penUp: number;
  /** Estimated plotting time, seconds. */
  seconds: number;
}

/** {@link PathStats} for a whole sheet, with a breakdown per layer. */
export interface PlotStats extends PathStats {
  layers: (PathStats & { name: string })[];
}

/**
 * Pen-down and pen-up distance, pen lifts and an estimated plotting time,
 * per layer and in total. Each layer is timed as its own run from `home` and
 * back, the way a plotter runs one pen.
 *
 * The time is `penDown / drawSpeed + penUp / travelSpeed + paths ·
 * liftTime`. It ignores acceleration, so plots of many short strokes take
 * longer than it says. The defaults are rough AxiDraw-like figures:
 * calibrate them by timing one real plot.
 */
export function plotStats(
  sheet: Sheet,
  options: PlotStatsOptions = {},
): PlotStats {
  const layers = sheet.layers.map((layer) => ({
    name: layer.name,
    ...pathStats(layer.paths, options),
  }));
  const sum = (key: keyof PathStats) =>
    layers.reduce((total, layer) => total + layer[key], 0);
  return {
    paths: sum("paths"),
    points: sum("points"),
    penDown: sum("penDown"),
    penUp: sum("penUp"),
    seconds: sum("seconds"),
    layers,
  };
}

/** `plotStats` for one list of paths, drawn in order. */
export function pathStats(
  paths: readonly Polyline[],
  options: PlotStatsOptions = {},
): PathStats {
  const drawSpeed = options.drawSpeed ?? 50;
  const travelSpeed = options.travelSpeed ?? 150;
  const liftTime = options.liftTime ?? 0.3;
  if (!(drawSpeed > 0) || !(travelSpeed > 0) || !(liftTime >= 0)) {
    throw new RangeError(
      "plotStats: speeds must be positive and liftTime non-negative",
    );
  }
  let count = 0;
  let points = 0;
  let penDown = 0;
  for (const path of paths) {
    if (path.pointCount < 2) continue;
    count++;
    points += path.pointCount;
    penDown += path.length;
  }
  const penUp =
    count > 0 ? travelLength(paths, options.home ?? new Vec2(0, 0)) : 0;
  return {
    paths: count,
    points,
    penDown,
    penUp,
    seconds: penDown / drawSpeed + penUp / travelSpeed + count * liftTime,
  };
}
