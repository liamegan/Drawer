import type { Vec2 } from "wtc-math";
import { Document, Random, renderToCanvas, toSVG, type Mask, type Polyline } from "wtc-drawer";
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

let doc: Document | null = null;
let seed = "";
let showMask = false;
let showDebug = query.has("debug");
let guides: Guides | null = null;
let maskImage: HTMLCanvasElement | null = null;
let lastBuildMs = 0;

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
  doc = new Document(sketch);
  maskImage = null;
  guides = new Guides();
  const t0 = performance.now();
  sketch.draw(doc, new Random(seed), guides);
  lastBuildMs = performance.now() - t0;
  render();
  updateHud();
}

function render(): void {
  if (!doc) return;
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
  if (showMask) drawMaskOverlay(doc.mask, scale);
  if (showDebug) guides?.render(ctx, scale);
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
  if (!doc || !sketch) return;
  const metres = (doc.length / 1000).toFixed(2);
  const layers = doc.layers.map((l) => `${l.name} (${l.paths.length})`).join(", ");
  hud.textContent =
    `${sketch.title} · seed ${seed} · ${doc.paper.name} ${doc.orientation} · ` +
    `${doc.pathCount} paths, ${metres} m of ink · ${layers} · ${lastBuildMs.toFixed(1)} ms` +
    `   —   [s] save SVG  [r] new seed  [←/→] step seed  [m] mask${showMask ? " (on)" : ""}` +
    `  [d] debug${showDebug ? " (on)" : ""}`;
}

function downloadSVG(): void {
  if (!doc || !sketch) return;
  const svg = toSVG(doc, { title: `${sketch.title} — seed ${seed}` });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sketchName}-${seed}.svg`;
  a.click();
  URL.revokeObjectURL(url);
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
    case "d": {
      showDebug = !showDebug;
      // Kept in the URL, so a reload or a new seed keeps the setting.
      const url = new URL(location.href);
      if (showDebug) url.searchParams.set("debug", "");
      else url.searchParams.delete("debug");
      history.replaceState(null, "", url);
      render();
      updateHud();
      break;
    }
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
