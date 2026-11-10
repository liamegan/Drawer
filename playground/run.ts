import {
  Sheet,
  optimize,
  plotStats,
  Random,
  toSVG,
  type PlotStats,
} from "wtc-drawer";
import { Guides } from "./guides.js";
import { changed, formatParam, type Values } from "./params.js";
import type { ParamValues, Sketch } from "./Sketch.js";
import { Traits } from "./traits.js";

/** One build of a sketch at a seed: what the preview and exports show. */
export interface Run {
  seed: string;
  params: Values;
  /** The drawing as the sketch built it. */
  raw: Sheet;
  /** The same drawing optimised for plotting. */
  plotted: Sheet;
  rawStats: PlotStats;
  plottedStats: PlotStats;
  guides: Guides;
  traits: Traits;
  buildMs: number;
  optimizeMs: number;
}

/**
 * Builds `sketch` at `seed` with `params`, then optimises it. The preview
 * and the batch export both come through here, so they can't disagree.
 */
export function runSketch(sketch: Sketch, seed: string, params: Values): Run {
  const raw = new Sheet(sketch);
  const guides = new Guides();
  const traits = new Traits();
  const t0 = performance.now();
  sketch.draw(raw, new Random(seed), guides, {
    params: params as ParamValues<NonNullable<Sketch["params"]>>,
    traits,
  });
  const t1 = performance.now();
  const plotted = optimize(raw);
  const t2 = performance.now();
  return {
    seed,
    params,
    raw,
    plotted,
    rawStats: plotStats(raw),
    plottedStats: plotStats(plotted),
    guides,
    traits,
    buildMs: t1 - t0,
    optimizeMs: t2 - t1,
  };
}

/**
 * The SVG for a run: optimised unless `raw`, titled with the sketch and
 * seed, with the traits and any changed params in its description.
 * `background` fills the paper colour in, for viewing rather than plotting.
 */
export function runSVG(
  sketch: Sketch,
  run: Run,
  { raw = false, background = false } = {},
): string {
  const lines = [`Seed: ${run.seed}`];
  for (const [name, value] of run.traits.entries()) {
    lines.push(`${name}: ${value}`);
  }
  const tweaks = changed(sketch.params, run.params);
  if (tweaks.length > 0) {
    lines.push(
      "Params: " + tweaks.map(([n, v]) => `${n}=${formatParam(v)}`).join(" "),
    );
  }
  return toSVG(raw ? run.raw : run.plotted, {
    title: `${sketch.title} — seed ${run.seed}`,
    description: lines.join("\n"),
    background,
  });
}
