import { renderToCanvas, type Sheet } from "wtc-drawer";
import { changed, type Values } from "./params.js";
import { runSketch, runSVG, type Run } from "./run.js";
import type { Sketch } from "./Sketch.js";
import { TraitTally, type TraitValue } from "./traits.js";

/**
 * Renders the artwork (no guides, travel or mask) at `dpi`, on the paper
 * colour, as a PNG. Very large sheets can exceed what the browser allows for
 * a canvas; then this rejects.
 */
export function renderPNG(doc: Sheet, dpi: number): Promise<Blob> {
  const scale = dpi / 25.4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no 2D canvas at this size"));
  renderToCanvas(doc, ctx, { scale });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                `${canvas.width}×${canvas.height} px is too big a canvas`,
              ),
            ),
      "image/png",
    ),
  );
}

/** Writes a file under `exports/` through the dev server's export plugin. */
async function save(file: string, body: Blob | string): Promise<void> {
  const res = await fetch(`/__export?file=${encodeURIComponent(file)}`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const why = res.status === 404 ? "is the dev server running?" : "";
    throw new Error(`couldn't write ${file}: ${res.status} ${why}`.trim());
  }
}

export interface BatchOptions {
  sketch: Sketch;
  /** The sketch's file name: files go in `exports/<name>/`. */
  name: string;
  from: number;
  to: number;
  params: Values;
  /** Save the raw drawing instead of the optimised one. */
  raw: boolean;
  /** Also save a PNG of each seed, at `dpi`. */
  png: boolean;
  dpi: number;
  /** Called after each seed, with how many are done. */
  progress(done: number, total: number, run: Run): void;
  /** Checked between seeds; return true to stop early. */
  stopped(): boolean;
}

export interface BatchResult {
  done: number;
  total: number;
  stopped: boolean;
  tally: TraitTally;
}

/**
 * Builds every seed from `from` to `to` (inclusive) with the same params
 * and writes `<name>-<seed>.svg` (and `.png`) to `exports/<name>/`, then
 * `traits.json` with each seed's traits and how often each came up. It
 * yields to the browser between seeds, so the page stays live and `stopped`
 * can end it early; what's done by then is still written up.
 */
export async function exportRange(o: BatchOptions): Promise<BatchResult> {
  const lo = Math.min(o.from, o.to);
  const hi = Math.max(o.from, o.to);
  const total = hi - lo + 1;
  const tally = new TraitTally();
  const seeds: Record<string, Record<string, TraitValue>> = {};
  let done = 0;
  let stopped = false;
  for (let seed = lo; seed <= hi; seed++) {
    if (o.stopped()) {
      stopped = true;
      break;
    }
    const run = runSketch(o.sketch, String(seed), o.params);
    const base = `${o.name}/${o.name}-${seed}${o.raw ? "-raw" : ""}`;
    await save(`${base}.svg`, runSVG(o.sketch, run, { raw: o.raw }));
    if (o.png) {
      const doc = o.raw ? run.raw : run.plotted;
      await save(`${base}.png`, await renderPNG(doc, o.dpi));
    }
    tally.add(run.traits);
    seeds[run.seed] = run.traits.toJSON();
    done++;
    o.progress(done, total, run);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const report = {
    sketch: o.name,
    seeds: { from: lo, to: lo + done - 1 },
    params: Object.fromEntries(changed(o.sketch.params, o.params)),
    tally: tally.toJSON(),
    traits: seeds,
  };
  await save(`${o.name}/traits.json`, JSON.stringify(report, null, 2));
  return { done, total, stopped, tally };
}
