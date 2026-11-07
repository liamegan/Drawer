import type { Document } from "../document/Document.js";

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasRenderOptions {
  /** Pixels per millimetre. Include devicePixelRatio for crisp output. */
  scale: number;
  /** Fill the sheet with the document's paper colour first. Default true. */
  background?: boolean;
  /**
   * Thinnest line drawn, in device pixels, so fine pens stay visible at
   * small preview sizes. Default 1.
   */
  minLineWidth?: number;
}

/**
 * Draws a preview of `doc` into a 2D context, with the sheet's top-left at the
 * context's current origin. Layers are drawn in plotting order, each with its
 * own pen colour and width.
 */
export function renderToCanvas(doc: Document, ctx: Context2D, options: CanvasRenderOptions): void {
  const { scale } = options;
  const minWidthMm = (options.minLineWidth ?? 1) / scale;

  ctx.save();
  ctx.scale(scale, scale);

  if (options.background ?? true) {
    ctx.fillStyle = doc.paperColor;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const layer of doc.layers) {
    ctx.strokeStyle = layer.pen.color;
    ctx.lineWidth = Math.max(layer.pen.width, minWidthMm);
    // One path per layer: far faster than stroking each polyline separately.
    ctx.beginPath();
    for (const path of layer.paths) {
      const pts = path.points;
      if (pts.length < 2) continue;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (path.closed) ctx.closePath();
    }
    ctx.stroke();
  }

  ctx.restore();
}
