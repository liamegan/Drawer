import { Bounds } from "../geometry/Bounds.js";
import { clipPolyline, outsideBounds, type HiddenTest } from "../geometry/clip.js";
import { asList, type Polyline } from "../geometry/Polyline.js";
import { Mask } from "../mask/Mask.js";
import { Layer, type Pen } from "./Layer.js";
import { orient, paper, type Orientation, type PaperSize } from "./paper.js";

export interface DocumentOptions {
  /** Sheet size. Default A4. */
  paper?: PaperSize;
  /** Default portrait. Ignored for square sheets. */
  orientation?: Orientation;
  /** Blank border kept around `drawArea`, in mm. Default 10. */
  margin?: number;
  /** Colour of the sheet, used by previews and the optional SVG background. */
  paperColor?: string;
  /** Settings for `draw()` and the occlusion mask. */
  occlusion?: OcclusionOptions;
}

export interface OcclusionOptions {
  /** Mask pixels per mm. Default 10 (0.1 mm pixels, finer than most pens). */
  resolution?: number;
  /**
   * Distance in mm that lines drawn behind a shape stop short of its
   * outline, which keeps the pen from bleeding over it. Default 0.
   */
  gap?: number;
  /** Clipped pieces shorter than this (mm) are dropped. Default 0.2. */
  minLength?: number;
}

export interface DrawOptions {
  /** Hide the parts of the paths that are behind earlier shapes. Default true. */
  occlude?: boolean;
  /**
   * What to stamp into the mask after drawing, so that later paths are hidden
   * behind it. Closed paths are filled (nonzero, as in SVG); when there is a
   * gap, every path is also stroked, so open paths keep later lines away
   * without hiding an area. Default: the closed paths being drawn. `false`
   * stamps nothing.
   */
  silhouette?: Polyline | readonly Polyline[] | false;
  /** Overrides the document's `occlusion.gap` for this silhouette. */
  gap?: number;
  /** Also hide everything outside these bounds, e.g. `doc.drawArea`. */
  bounds?: Bounds;
  /** Overrides the document's `occlusion.minLength`. */
  minLength?: number;
}

/**
 * One plottable sheet: its size in millimetres plus an ordered list of pen
 * layers. Coordinates are mm, with the origin at the top-left and y pointing down.
 */
export class Document {
  readonly paper: PaperSize;
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly paperColor: string;
  readonly occlusion: Readonly<Required<OcclusionOptions>>;
  readonly #layers: Layer[] = [];
  #mask: Mask | null = null;

  constructor(options: DocumentOptions = {}) {
    this.paper = options.paper ?? paper.A4;
    this.orientation = options.orientation ?? "portrait";
    const { width, height } = orient(this.paper, this.orientation);
    this.width = width;
    this.height = height;
    this.margin = options.margin ?? 10;
    this.paperColor = options.paperColor ?? "#ffffff";
    this.occlusion = {
      resolution: options.occlusion?.resolution ?? 10,
      gap: options.occlusion?.gap ?? 0,
      minLength: options.occlusion?.minLength ?? 0.2,
    };
  }

  /** The whole sheet. */
  get page(): Bounds {
    return Bounds.fromRect(0, 0, this.width, this.height);
  }

  /** The sheet minus the margin: where artwork is meant to go. */
  get drawArea(): Bounds {
    return this.page.inset(this.margin);
  }

  /** Layers in plotting order. */
  get layers(): readonly Layer[] {
    return this.#layers;
  }

  /**
   * Returns the layer called `name`, creating it at the end of the plotting
   * order if needed. A `pen` given for an existing layer is merged into its pen.
   */
  layer(name: string, pen?: Partial<Pen>): Layer {
    let layer = this.#layers.find((l) => l.name === name);
    if (!layer) {
      layer = new Layer(name, pen);
      this.#layers.push(layer);
    } else if (pen) {
      layer.pen = { ...layer.pen, ...pen };
    }
    return layer;
  }

  /**
   * The occlusion mask that `draw()` clips against and stamps into. Covers
   * the whole page, and is created on first use.
   */
  get mask(): Mask {
    return (this.#mask ??= new Mask(this.width, this.height, this.occlusion.resolution));
  }

  /**
   * Adds paths to the layer called `layerName` as they are, creating the
   * layer if needed. Nothing is hidden or stamped; see `draw()` for that.
   */
  add(layerName: string, ...paths: Polyline[]): Layer {
    return this.layer(layerName).add(...paths);
  }

  /**
   * Draws front to back with hidden-line removal: adds the parts of `paths`
   * not hidden by anything drawn earlier, then stamps their silhouette so
   * that later paths are hidden behind them. Returns the pieces added.
   *
   * To draw one object on several layers (say an outline and a hatch on
   * different pens), clip each layer's paths with `doc.mask.clip()`, add them,
   * then stamp the silhouette once with `doc.mask.fill()`.
   */
  draw(layerName: string, paths: Polyline | readonly Polyline[], options: DrawOptions = {}): Polyline[] {
    const list = asList(paths);
    const minLength = options.minLength ?? this.occlusion.minLength;

    let hidden: HiddenTest | null = null;
    if (options.occlude ?? true) hidden = this.mask.hiddenTest(options.bounds);
    else if (options.bounds) hidden = outsideBounds(options.bounds);

    const step = 0.5 / this.occlusion.resolution;
    const visible = hidden ? list.flatMap((p) => clipPolyline(p, hidden, { step, minLength })) : [...list];
    this.layer(layerName).add(...visible);

    const silhouette =
      options.silhouette === undefined
        ? list.filter((p) => p.closed)
        : options.silhouette === false
          ? []
          : asList(options.silhouette);
    if (silhouette.length > 0) {
      const gap = options.gap ?? this.occlusion.gap;
      this.mask.fill(silhouette);
      if (gap > 0) this.mask.stroke(silhouette, gap * 2);
    }

    return visible;
  }

  /** Removes every layer and clears the mask. */
  clear(): void {
    this.#layers.length = 0;
    this.#mask?.clear();
  }

  get pathCount(): number {
    return this.#layers.reduce((n, l) => n + l.paths.length, 0);
  }

  /** Total pen-down distance across all layers, in mm. */
  get length(): number {
    return this.#layers.reduce((n, l) => n + l.length, 0);
  }
}
