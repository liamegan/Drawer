import type { Bounds } from "../geometry/Bounds.js";
import { clipPolyline, outsideBounds, type ClipOptions, type HiddenTest } from "../geometry/clip.js";
import { asList, type Polyline } from "../geometry/Polyline.js";
import { fillRings, strokeRings, toPixelRing, type CoverageGrid, type FillRule } from "./rasterize.js";

/** Options for {@link Mask.clip}. */
export interface MaskClipOptions extends ClipOptions {
  /** Also hide everything outside these bounds (mm). */
  bounds?: Bounds;
}

/**
 * A coverage raster over a region of the page, used to hide lines behind
 * shapes that were drawn earlier. Draw front to back: clip each new path
 * against the mask, then stamp the new shape's silhouette into it.
 *
 * Covers `width` × `height` mm from the origin at `resolution` pixels per mm.
 * Pixel (i, j) is centred on ((i + 0.5) / resolution, (j + 0.5) / resolution).
 * Pixels store anti-aliased coverage, and `coverage()` interpolates between
 * them bilinearly, so cut points land within a fraction of a pixel of the
 * true edge. Anything outside the mask counts as uncovered.
 *
 * Pure TypeScript with no DOM, so it gives identical results in Node and the browser.
 */
export class Mask implements CoverageGrid {
  readonly width: number;
  readonly height: number;
  /** Pixels per mm. */
  readonly resolution: number;
  readonly cols: number;
  readonly rows: number;
  /** Row-major coverage, 0 (clear) to 255 (covered). */
  readonly data: Uint8Array;

  constructor(width: number, height: number, resolution = 10) {
    if (!(width > 0 && height > 0)) throw new RangeError("Mask needs a positive width and height");
    if (!(resolution > 0)) throw new RangeError("Mask resolution must be positive");
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.cols = Math.ceil(width * resolution);
    this.rows = Math.ceil(height * resolution);
    this.data = new Uint8Array(this.cols * this.rows);
  }

  /** Sampling step for clipping against this mask: half a pixel, in mm. */
  get step(): number {
    return 0.5 / this.resolution;
  }

  /** Marks everything as uncovered. */
  clear(): this {
    this.data.fill(0);
    return this;
  }

  /**
   * Covers the inside of the closed paths in `shapes`; open paths are
   * ignored. All the rings are filled together under `rule`. The default,
   * nonzero, matches SVG: rings running the same way merge, and a ring
   * running the opposite way inside another cuts a hole.
   */
  fill(shapes: Polyline | readonly Polyline[], rule: FillRule = "nonzero"): this {
    const rings: Float64Array[] = [];
    for (const shape of asList(shapes)) {
      if (shape.closed && shape.pointCount >= 3) rings.push(toPixelRing(shape, this.resolution));
    }
    fillRings(this, rings, rule);
    return this;
  }

  /** Covers a band `width` mm wide along each path, with round caps and joins. */
  stroke(paths: Polyline | readonly Polyline[], width: number): this {
    const rings: Float64Array[] = [];
    const radius = (width / 2) * this.resolution;
    for (const path of asList(paths)) rings.push(...strokeRings(path, this.resolution, radius));
    fillRings(this, rings, "nonzero");
    return this;
  }

  /** Coverage at (x, y) mm, from 0 to 1, bilinearly interpolated between pixel centres. */
  coverage(x: number, y: number): number {
    return this.#sample(x, y) / 255;
  }

  /** True where coverage is at least one half: the point is behind something. */
  covered(x: number, y: number): boolean {
    return this.#sample(x, y) >= 127.5;
  }

  /**
   * The visible pieces of `path`: the parts not covered by the mask, and
   * inside `options.bounds` if given. See `clipPolyline` for the details.
   */
  clip(path: Polyline, options: MaskClipOptions = {}): Polyline[] {
    return clipPolyline(path, this.hiddenTest(options.bounds), { step: this.step, ...options });
  }

  /** The visibility test `clip` uses, for use with `clipPolyline` directly. */
  hiddenTest(bounds?: Bounds): HiddenTest {
    const covered: HiddenTest = (x, y) => this.#sample(x, y) >= 127.5;
    if (!bounds) return covered;
    const outside = outsideBounds(bounds);
    return (x, y) => outside(x, y) || covered(x, y);
  }

  /** Bilinear sample in 0–255 units. */
  #sample(x: number, y: number): number {
    const u = x * this.resolution - 0.5;
    const v = y * this.resolution - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const top = this.#pixel(i, j) * (1 - fu) + this.#pixel(i + 1, j) * fu;
    const bottom = this.#pixel(i, j + 1) * (1 - fu) + this.#pixel(i + 1, j + 1) * fu;
    return top * (1 - fv) + bottom * fv;
  }

  #pixel(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return 0;
    return this.data[j * this.cols + i];
  }
}
