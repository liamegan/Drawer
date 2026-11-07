// Geometry
export { Bounds } from "./geometry/Bounds.js";
export { Polyline } from "./geometry/Polyline.js";
export { line, rect, polygon, circle, circleSegments, type CircleOptions } from "./geometry/shapes.js";
export { identity, translation, rotation, scaling, compose } from "./geometry/transforms.js";
export {
  clipPolyline,
  clipToShape,
  insideTest,
  outsideBounds,
  shapeContains,
  type ClipOptions,
  type HiddenTest,
  type ShapeClipOptions,
} from "./geometry/clip.js";
export { ScanlineSweep, type FillRule } from "./geometry/scanline.js";

// Document
export { Document, type DocumentOptions, type DrawOptions, type OcclusionOptions } from "./document/Document.js";
export { Layer, DEFAULT_PEN, type Pen } from "./document/Layer.js";
export { paper, customPaper, orient, type PaperSize, type Orientation } from "./document/paper.js";

// Occlusion
export { Mask, type MaskClipOptions } from "./mask/Mask.js";

// Hatching and tone
export {
  hatch,
  sine,
  straight,
  type HatchAnchor,
  type HatchLine,
  type HatchOptions,
  type LineStyle,
  type SineOptions,
} from "./fill/hatch.js";
export {
  DEFAULT_THRESHOLDS,
  passCoverage,
  shade,
  toneSpacing,
  type ShadeOptions,
  type ToneField,
  type ToneSpacingOptions,
} from "./fill/tone.js";
export { spiral, type SpiralOptions } from "./fill/spiral.js";

// Randomness
export { Random } from "./random/Random.js";

// Rendering
export { toSVG, pathData, formatNumber, type SVGOptions } from "./render/svg.js";
export { renderToCanvas, type CanvasRenderOptions } from "./render/canvas.js";
