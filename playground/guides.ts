import type { Vec2 } from "wtc-math";
import type { Polyline } from "wtc-drawer";
import type { Debug } from "./Sketch.js";

/** Records a sketch's debug guides, and draws them over the preview. */
export class Guides implements Debug {
  readonly #paths: { paths: readonly Polyline[]; color: string }[] = [];
  readonly #labels: { text: string; at: Vec2; color: string }[] = [];

  path(paths: Polyline | readonly Polyline[], color = "#e0218a"): void {
    this.#paths.push({
      paths: Array.isArray(paths) ? paths : [paths as Polyline],
      color,
    });
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
