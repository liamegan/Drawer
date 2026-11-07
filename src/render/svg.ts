import type { Document } from "../document/Document.js";
import type { Polyline } from "../geometry/Polyline.js";

export interface SVGOptions {
  /** Decimal places kept on coordinates. Default 3 (1 µm). */
  precision?: number;
  /**
   * Adds a background rect: `true` uses the document's paper colour, or pass a
   * colour. Off by default. It is for on-screen viewing only, because plotter
   * software would draw it.
   */
  background?: boolean | string;
  /** Written to the SVG's <title>. */
  title?: string;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXML(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** Rounds to `precision` places and drops trailing zeros (and `-0`). */
export function formatNumber(n: number, precision = 3): string {
  const rounded = Number(n.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** The `d` attribute for one polyline, e.g. `M0,0 L10,0 L10,10 Z`. */
export function pathData(polyline: Polyline, precision = 3): string {
  const f = (n: number) => formatNumber(n, precision);
  const parts = polyline.points.map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x)},${f(p.y)}`);
  if (polyline.closed) parts.push("Z");
  return parts.join(" ");
}

/**
 * Serialises a Document as a plotter-ready SVG string.
 *
 * - The size is given in mm, and the viewBox is in mm, so 1 user unit = 1 mm.
 * - Each Layer becomes an Inkscape layer (`inkscape:groupmode="layer"`) labelled
 *   "<n>-<name>" in plotting order. AxiDraw, vpype and Inkscape read these as
 *   pen layers.
 * - Strokes only (`fill="none"`), with the colour and width of the layer's pen.
 */
export function toSVG(doc: Document, options: SVGOptions = {}): string {
  const precision = options.precision ?? 3;
  const f = (n: number) => formatNumber(n, precision);
  const w = f(doc.width);
  const h = f(doc.height);

  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
  ];

  if (options.title) out.push(`  <title>${escapeXML(options.title)}</title>`);

  if (options.background) {
    const fill = options.background === true ? doc.paperColor : options.background;
    out.push(`  <rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXML(fill)}" stroke="none"/>`);
  }

  doc.layers.forEach((layer, i) => {
    const n = i + 1;
    out.push(
      `  <g id="layer${n}" inkscape:groupmode="layer" inkscape:label="${n}-${escapeXML(layer.name)}"` +
        ` fill="none" stroke="${escapeXML(layer.pen.color)}" stroke-width="${f(layer.pen.width)}"` +
        ` stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const path of layer.paths) {
      if (path.pointCount < 2) continue;
      out.push(`    <path d="${pathData(path, precision)}"/>`);
    }
    out.push(`  </g>`);
  });

  out.push(`</svg>`, ``);
  return out.join("\n");
}
