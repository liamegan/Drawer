/** A sheet size in millimetres, given in portrait (width ≤ height). */
export interface PaperSize {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Which way a sheet is turned. Square sheets ignore it. */
export type Orientation = "portrait" | "landscape";

/**
 * ISO A sizes, and US Letter, in portrait. Use {@link orient} or a sheet's
 * `orientation` to turn them.
 */
export const paper = {
  A6: { name: "A6", width: 105, height: 148 },
  A5: { name: "A5", width: 148, height: 210 },
  A4: { name: "A4", width: 210, height: 297 },
  A3: { name: "A3", width: 297, height: 420 },
  Letter: { name: "Letter", width: 215.9, height: 279.4 },
} as const satisfies Record<string, PaperSize>;

/** A custom sheet, e.g. `customPaper(200, 200)` for a square print. */
export function customPaper(width: number, height: number, name = `${width}×${height}mm`): PaperSize {
  return { name, width, height };
}

/** Width and height of `size` in the requested orientation. */
export function orient(size: PaperSize, orientation: Orientation): { width: number; height: number } {
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  // Square sheets have no orientation; keep them as given.
  if (short === long) return { width: size.width, height: size.height };
  return orientation === "landscape" ? { width: long, height: short } : { width: short, height: long };
}
