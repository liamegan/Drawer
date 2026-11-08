import type { Vec2 } from "wtc-math";
import type { Document, DocumentOptions, Polyline, Random } from "wtc-drawer";

/**
 * Construction guides a sketch can show over its preview: the shapes behind
 * a boolean, a label on each part, and so on. Toggled with `d` (or start with
 * `?debug` in the URL). Guides are drawn on the preview only, never into the
 * document, so they don't reach the SVG, the occlusion mask or the stats.
 *
 * Sketches record guides every time, whether or not they're showing, so
 * debug mode can't change the artwork. Keep them cheap and don't draw random
 * numbers for them.
 */
export interface Debug {
  /** Dashed outlines, in mm. Default colour magenta. */
  path(paths: Polyline | readonly Polyline[], color?: string): void;
  /** A short label centred on `at`, in mm. */
  label(text: string, at: Vec2, color?: string): void;
}

/**
 * A playground artwork. Its DocumentOptions (paper, orientation, margin,
 * paperColor) set up the sheet, then `draw` fills it. All randomness should
 * come from `random` so the seed reproduces the piece exactly.
 */
export interface Sketch extends DocumentOptions {
  title: string;
  draw(doc: Document, random: Random, debug: Debug): void;
}
