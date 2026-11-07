import type { Document, DocumentOptions, Random } from "wtc-drawer";

/**
 * A playground artwork. Its DocumentOptions (paper, orientation, margin,
 * paperColor) set up the sheet, then `draw` fills it. All randomness should
 * come from `random` so the seed reproduces the piece exactly.
 */
export interface Sketch extends DocumentOptions {
  title: string;
  draw(doc: Document, random: Random): void;
}
