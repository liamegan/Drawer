import type { Vec2 } from "wtc-math";
import {
  Document,
  optimize,
  plotStats,
  Random,
  renderToCanvas,
  toSVG,
  type Mask,
  type PlotStats,
  type Polyline,
} from "wtc-drawer";
import type { Debug, Sketch } from "./Sketch.js";

// Every file in ./sketches is a sketch, keyed by file name: sketches/hello.ts → ?sketch=hello
const modules = import.meta.glob<{ default: Sketch }>("./sketches/*.ts", { eager: true });
const sketches = new Map(
  Object.entries(modules).map(([path, mod]) => [path.replace(/^.*\/(.+)\.ts$/, "$1"), mod.default]),
);

const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const ctx = canvas.getContext("2d")!;

const query = new URLSearchParams(location.search);
const sketchName = query.get("sketch") ?? "hello";
const sketch = sketches.get(sketchName);

/** The drawing as the sketch built it, and the copy optimised for plotting. */
let raw: Document | null = null;
let plotted: Document | null = null;
let rawStats: PlotStats | null = null;
let plottedStats: PlotStats | null = null;
let seed = "";
let showMask = false;
let showDebug = query.has("debug");
let showRaw = query.has("raw");
let showTravel = query.has("travel");
let guides: Guides | null = null;
let maskImage: HTMLCanvasElement | null = null;
let lastBuildMs = 0;
let lastOptimizeMs = 0;

/** The document being previewed and saved. */
const shown = () => (showRaw ? raw : plotted);

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
  seed = readSeed();
  raw = new Document(sketch);
  maskImage = null;
  guides = new Guides();
  const t0 = performance.now();
  sketch.draw(raw, new Random(seed), guides);
  const t1 = performance.now();
  plotted = optimize(raw);
  const t2 = performance.now();
  lastBuildMs = t1 - t0;
  lastOptimizeMs = t2 - t1;
  rawStats = plotStats(raw);
  plottedStats = plotStats(plotted);
  render();
  updateHud();
}

function render(): void {
  const doc = shown();
  if (!doc || !raw) return;
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
  if (showMask) drawMaskOverlay(raw.mask, scale);
  if (showDebug) guides?.render(ctx, scale);
}

/**
 * Draws the pen-up moves: from home (top-left) to each path's start, from
 * its end to the next, and back home after each layer.
 */
function drawTravel(doc: Document, scale: number): void {
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

/** Records a sketch's debug guides, and draws them over the preview. */
class Guides implements Debug {
  readonly #paths: { paths: readonly Polyline[]; color: string }[] = [];
  readonly #labels: { text: string; at: Vec2; color: string }[] = [];

  path(paths: Polyline | readonly Polyline[], color = "#e0218a"): void {
    this.#paths.push({ paths: Array.isArray(paths) ? paths : [paths as Polyline], color });
  }

  label(text: string, at: Vec2, color = "#e0218a"): void {
    this.#labels.push({ text, at, color });
  }

  render(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.scale(scale, scale);
    // At least 1.5 device pixels, so guides read at any zoom.
    const px = 1 / scale;
    ctx.lineWidth = Math.max(0.2, 1.5 * px);
    ctx.setLineDash([1.2, 0.8]);
    ctx.lineJoin = "round";
    for (const { paths, color } of this.#paths) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const path of paths) {
        const pts = path.points;
        if (pts.length < 2) continue;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (path.closed) ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = `${Math.max(2.6, 11 * px)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(0.5, 3 * px);
    ctx.strokeStyle = "rgb(255 255 255 / 0.85)";
    for (const { text, at, color } of this.#labels) {
      // A pale halo keeps labels readable over dense hatching.
      ctx.strokeText(text, at.x, at.y);
      ctx.fillStyle = color;
      ctx.fillText(text, at.x, at.y);
    }
    ctx.restore();
  }
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
  const doc = shown();
  if (!doc || !sketch || !rawStats || !plottedStats) return;
  const a = rawStats;
  const b = plottedStats;
  const m = (mm: number) => (mm / 1000).toFixed(2);
  const minutes = (s: number) => (s / 60).toFixed(s < 600 ? 1 : 0);
  const layers = doc.layers.map((l) => `${l.name} (${l.paths.length})`).join(", ");
  const on = (flag: boolean) => (flag ? " (on)" : "");
  hud.textContent =
    `${sketch.title} · seed ${seed} · ${doc.paper.name} ${doc.orientation} · ${layers}` +
    ` · ink ${m(a.penDown)} → ${m(b.penDown)} m · travel ${m(a.penUp)} → ${m(b.penUp)} m` +
    ` · lifts ${a.paths} → ${b.paths} · ~${minutes(a.seconds)} → ${minutes(b.seconds)} min` +
    ` · built in ${lastBuildMs.toFixed(0)} ms, optimised in ${lastOptimizeMs.toFixed(0)} ms` +
    ` · showing ${showRaw ? "raw" : "optimised"}` +
    `   —   [s] save SVG  [r] new seed  [←/→] step seed  [o] optimised/raw  [t] travel${on(showTravel)}` +
    `  [m] mask${on(showMask)}  [d] debug${on(showDebug)}`;
}

function downloadSVG(): void {
  const doc = shown();
  if (!doc || !sketch) return;
  const svg = toSVG(doc, { title: `${sketch.title} — seed ${seed}` });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sketchName}-${seed}${showRaw ? "-raw" : ""}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Sets a view flag, keeps it in the URL so a reload or a new seed keeps it,
 * and redraws.
 */
function keepFlag(name: string, on: boolean): boolean {
  const url = new URL(location.href);
  if (on) url.searchParams.set(name, "");
  else url.searchParams.delete(name);
  history.replaceState(null, "", url);
  queueMicrotask(() => {
    render();
    updateHud();
  });
  return on;
}

function stepSeed(delta: number): void {
  const n = Number.parseInt(seed, 10);
  setSeed(String((Number.isNaN(n) ? 0 : n) + delta));
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case "s":
      downloadSVG();
      break;
    case "r":
      setSeed(String(Math.floor(Math.random() * 1e9)));
      break;
    case "m":
      showMask = !showMask;
      render();
      updateHud();
      break;
    case "d":
      showDebug = keepFlag("debug", !showDebug);
      break;
    case "o":
      showRaw = keepFlag("raw", !showRaw);
      break;
    case "t":
      showTravel = keepFlag("travel", !showTravel);
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

if (sketch) {
  build();
} else {
  hud.textContent = `No sketch "${sketchName}". Available: ${[...sketches.keys()].join(", ")}`;
}
