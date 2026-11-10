import { renderToCanvas, type Sheet, type Mask } from "wtc-drawer";
import { exportRange, renderPNG } from "./export.js";
import { Panel, type ViewFlags } from "./panel.js";
import { readParams, writeParams, type Values } from "./params.js";
import { runSketch, runSVG, type Run } from "./run.js";
import type { Sketch } from "./Sketch.js";
import { sketches as initialSketches } from "./sketches.js";

const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const panelBox = document.querySelector<HTMLElement>("#panel")!;
const ctx = canvas.getContext("2d")!;

const query = new URLSearchParams(location.search);
const sketchName = query.get("sketch") ?? "hello";
let sketches = initialSketches;
let sketch: Sketch | undefined = sketches.get(sketchName);

/** The current build: raw and optimised drawings, guides, traits, stats. */
let run: Run | null = null;
let params: Values = readParams(sketch?.params, query);
let showMask = query.has("mask");
let showDebug = query.has("debug");
let showRaw = query.has("raw");
let showTravel = query.has("travel");
let showPanel = !query.has("nopanel");
let maskImage: HTMLCanvasElement | null = null;
/** Shown in the HUD instead of the stats while set: export progress, errors. */
let status = "";
let exporting = false;
let stopExport = false;

/** The document being previewed and saved. */
const shown = (): Sheet | null =>
  run ? (showRaw ? run.raw : run.plotted) : null;

function readSeed(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("seed");
  if (fromHash) return fromHash;
  const fresh = String(Math.floor(Math.random() * 1e9));
  history.replaceState(null, "", `#seed=${fresh}`);
  return fresh;
}

function setSeed(next: string): void {
  // Triggers `hashchange`, which rebuilds.
  location.hash = `seed=${next}`;
}

function build(): void {
  if (!sketch) return;
  run = runSketch(sketch, readSeed(), params);
  maskImage = null;
  const traits = run.traits.entries().map(([n, v]) => `${n}: ${v}`);
  panel.showRun(run.seed, traits.join("\n"));
  render();
  updateHud();
}

function render(): void {
  const doc = shown();
  if (!doc || !run) return;
  const dpr = window.devicePixelRatio || 1;
  const pad = 32;
  const fit = Math.min(
    (stage.clientWidth - pad * 2) / doc.width,
    (stage.clientHeight - pad * 2) / doc.height,
  );
  const cssScale = Math.max(fit, 0.1);
  canvas.style.width = `${doc.width * cssScale}px`;
  canvas.style.height = `${doc.height * cssScale}px`;
  canvas.width = Math.round(doc.width * cssScale * dpr);
  canvas.height = Math.round(doc.height * cssScale * dpr);
  const scale = cssScale * dpr;
  renderToCanvas(doc, ctx, { scale });
  if (showTravel) drawTravel(doc, scale);
  // The mask and guides belong to the drawing as built.
  if (showMask) drawMaskOverlay(run.raw.mask, scale);
  if (showDebug) run.guides.render(ctx, scale);
}

/**
 * Draws the pen-up moves: from home (top-left) to each path's start, from
 * its end to the next, and back home after each layer.
 */
function drawTravel(doc: Sheet, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineWidth = Math.max(0.15, 1 / scale);
  // Green, to stand apart from ink pens, the red mask and magenta guides.
  ctx.strokeStyle = "rgb(0 170 80 / 0.8)";
  ctx.beginPath();
  for (const layer of doc.layers) {
    let x = 0;
    let y = 0;
    for (const path of layer.paths) {
      if (path.pointCount < 2) continue;
      const start = path.start!;
      ctx.moveTo(x, y);
      ctx.lineTo(start.x, start.y);
      const exit = path.closed ? start : path.end!;
      x = exit.x;
      y = exit.y;
    }
    ctx.moveTo(x, y);
    ctx.lineTo(0, 0);
  }
  ctx.stroke();
  ctx.restore();
}

/** Paints the occlusion mask over the preview: red where covered. */
function drawMaskOverlay(mask: Mask, scale: number): void {
  if (!maskImage) {
    maskImage = document.createElement("canvas");
    maskImage.width = mask.cols;
    maskImage.height = mask.rows;
    const mctx = maskImage.getContext("2d")!;
    const image = mctx.createImageData(mask.cols, mask.rows);
    const { data } = mask;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0) continue;
      const o = i * 4;
      image.data[o] = 230;
      image.data[o + 1] = 40;
      image.data[o + 2] = 40;
      image.data[o + 3] = data[i] >> 1;
    }
    mctx.putImageData(image, 0, 0);
  }
  const pxPerCell = scale / mask.resolution;
  ctx.drawImage(maskImage, 0, 0, mask.cols * pxPerCell, mask.rows * pxPerCell);
}

function updateHud(): void {
  if (status) {
    hud.textContent = status;
    return;
  }
  const doc = shown();
  if (!doc || !sketch || !run) return;
  const a = run.rawStats;
  const b = run.plottedStats;
  const m = (mm: number) => (mm / 1000).toFixed(2);
  const minutes = (s: number) => (s / 60).toFixed(s < 600 ? 1 : 0);
  const layers = doc.layers
    .map((l) => `${l.name} (${l.paths.length})`)
    .join(", ");
  const on = (flag: boolean) => (flag ? " (on)" : "");
  const traits = run.traits.size > 0 ? ` · ${run.traits}` : "";
  hud.textContent =
    `${sketch.title} · seed ${run.seed}${traits}` +
    ` · ${doc.paper.name} ${doc.orientation} · ${layers}` +
    ` · ink ${m(a.penDown)} → ${m(b.penDown)} m` +
    ` · travel ${m(a.penUp)} → ${m(b.penUp)} m` +
    ` · lifts ${a.paths} → ${b.paths}` +
    ` · ~${minutes(a.seconds)} → ${minutes(b.seconds)} min` +
    ` · built in ${run.buildMs.toFixed(0)} ms,` +
    ` optimised in ${run.optimizeMs.toFixed(0)} ms` +
    ` · showing ${showRaw ? "raw" : "optimised"}` +
    `   —   [s] save SVG  [p] save PNG  [r] new seed  [←/→] step seed` +
    `  [o] optimised/raw  [t] travel${on(showTravel)}` +
    `  [m] mask${on(showMask)}  [d] debug${on(showDebug)}  [h] panel`;
}

/** Shows `text` in the HUD for a while (or until cleared with ""). */
function say(text: string, ms = 0): void {
  status = text;
  updateHud();
  if (ms > 0) {
    setTimeout(() => {
      if (status === text) say("");
    }, ms);
  }
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const fileBase = () => `${sketchName}-${run?.seed}${showRaw ? "-raw" : ""}`;

function downloadSVG(): void {
  if (!run || !sketch) return;
  const svg = runSVG(sketch, run, { raw: showRaw });
  download(`${fileBase()}.svg`, new Blob([svg], { type: "image/svg+xml" }));
}

async function downloadPNG(dpi: number): Promise<void> {
  const doc = shown();
  if (!doc) return;
  say(`Rendering a ${dpi} dpi PNG…`);
  try {
    download(`${fileBase()}.png`, await renderPNG(doc, dpi));
    say("");
  } catch (error) {
    say(`PNG failed: ${(error as Error).message}`, 6000);
  }
}

/** Builds and saves every seed in a range into exports/<sketch>/. */
async function batch(from: number, to: number, png: boolean, dpi: number) {
  if (!sketch || exporting) return;
  exporting = true;
  stopExport = false;
  try {
    const result = await exportRange({
      sketch,
      name: sketchName,
      from,
      to,
      params,
      raw: showRaw,
      png,
      dpi,
      progress: (done, total, r) =>
        say(`Exporting ${done} / ${total} (seed ${r.seed})… stop in the panel`),
      stopped: () => stopExport,
    });
    const how = result.stopped ? "Stopped after" : "Exported";
    const tally = result.tally.toString();
    say(
      `${how} ${result.done} of ${result.total} seeds` +
        ` to exports/${sketchName}/${tally ? ` · ${tally}` : ""}`,
      15000,
    );
  } catch (error) {
    say(`Export failed: ${(error as Error).message}`, 10000);
  } finally {
    exporting = false;
  }
}

/** Rewrites the query string (flags and params) without reloading. */
function updateURL(edit: (q: URLSearchParams) => void): void {
  const url = new URL(location.href);
  edit(url.searchParams);
  history.replaceState(null, "", url);
}

/**
 * Sets a view flag, keeps it in the URL so a reload or a new seed keeps it,
 * mirrors it in the panel, and redraws.
 */
function setView(flag: keyof ViewFlags, on: boolean): void {
  if (flag === "raw") showRaw = on;
  else if (flag === "travel") showTravel = on;
  else if (flag === "mask") showMask = on;
  else showDebug = on;
  updateURL((q) => (on ? q.set(flag, "") : q.delete(flag)));
  panel.setView(flag, on);
  render();
  updateHud();
}

function togglePanel(): void {
  showPanel = !showPanel;
  panelBox.hidden = !showPanel;
  updateURL((q) => (showPanel ? q.delete("nopanel") : q.set("nopanel", "")));
  render();
}

/**
 * Changes params, keeps the changed ones in the URL, and rebuilds once per
 * frame, so dragging a slider doesn't queue up builds.
 */
let pending = false;
function setParams(next: Values): void {
  params = next;
  updateURL((q) => writeParams(sketch?.params, params, q));
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    build();
  });
}

function stepSeed(delta: number): void {
  const n = Number.parseInt(run?.seed ?? "", 10);
  setSeed(String((Number.isNaN(n) ? 0 : n) + delta));
}

const randomSeed = () => setSeed(String(Math.floor(Math.random() * 1e9)));

const panel = new Panel(
  panelBox,
  {
    params: setParams,
    seed: setSeed,
    step: stepSeed,
    randomSeed,
    view: setView,
    saveSVG: downloadSVG,
    savePNG: (dpi) => void downloadPNG(dpi),
    exportRange: (from, to, png, dpi) => void batch(from, to, png, dpi),
    stop: () => (stopExport = true),
  },
  { raw: showRaw, travel: showTravel, mask: showMask, debug: showDebug },
);
panelBox.hidden = !showPanel;

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Typing in the panel (a seed, a number) isn't a shortcut.
  if (e.target instanceof HTMLInputElement) return;
  switch (e.key) {
    case "s":
      downloadSVG();
      break;
    case "p":
      void downloadPNG(panel.dpi);
      break;
    case "r":
      randomSeed();
      break;
    case "m":
      setView("mask", !showMask);
      break;
    case "d":
      setView("debug", !showDebug);
      break;
    case "o":
      setView("raw", !showRaw);
      break;
    case "t":
      setView("travel", !showTravel);
      break;
    case "h":
      togglePanel();
      break;
    case "ArrowRight":
      stepSeed(1);
      break;
    case "ArrowLeft":
      stepSeed(-1);
      break;
  }
});
window.addEventListener("hashchange", build);
window.addEventListener("resize", render);

// Editing a sketch (or sketches/lib) swaps the new code in and rebuilds at
// the same seed and params, keeping every view setting and the panel. Library
// edits reach main.ts directly and reload the page, which the URL survives.
if (import.meta.hot) {
  import.meta.hot.accept("./sketches.ts", (mod) => {
    if (!mod) return;
    sketches = mod.sketches as typeof sketches;
    sketch = sketches.get(sketchName);
    if (!sketch) return;
    params = readParams(sketch.params, new URLSearchParams(location.search));
    panel.setSketch(sketch, params);
    build();
  });
}

if (sketch) {
  panel.setSketch(sketch, params);
  build();
} else {
  hud.textContent =
    `No sketch "${sketchName}". ` +
    `Available: ${[...sketches.keys()].join(", ")}`;
}
