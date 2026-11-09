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
export { simplify, smooth } from "./geometry/simplify.js";

// Distance fields
export { SDF, sdf, type SDFOptions, type SampleOptions } from "./sdf/SDF.js";
export { SDFGrid, type GridWindow } from "./sdf/grid.js";
export {
  isolines,
  type IsolineOptions,
  type PathFinishOptions,
} from "./sdf/isolines.js";

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
export { flowHatch, type FlowHatchOptions } from "./fill/flow.js";
export {
  arc,
  catmullRom,
  cubic,
  quadratic,
  type CatmullRomOptions,
  type CurveOptions,
} from "./geometry/curves.js";
export * as profiles from "./sweep/profiles.js";
export type { OutlineProfile, Profile } from "./sweep/profiles.js";
export {
  Sweep,
  type SweepFrame,
  type SweepOptions,
  type SweepProfile,
} from "./sweep/Sweep.js";
export { sweepHatch, type SweepHatchOptions } from "./sweep/sweepHatch.js";
export { Mesh, type MeshEdge, type MeshOptions } from "./three/Mesh.js";
export {
  box,
  breakCorners,
  extrude,
  lathe,
  type BreakCornersOptions,
  type LatheOptions,
} from "./three/builders.js";
export {
  renderMesh,
  type MeshDrawing,
  type MeshFace,
  type RenderMeshOptions,
} from "./three/renderMesh.js";
export {
  oblique,
  orthographic,
  type ObliqueOptions,
  type OrthographicOptions,
  type Projection,
} from "./three/projection.js";
export {
  apply3,
  compose3,
  rotateX,
  rotateY,
  rotateZ,
  scale3,
  translate3,
} from "./three/transforms3.js";
export {
  waveShade,
  waveToneRange,
  type WaveShadeOptions,
  type WaveToneOptions,
} from "./fill/wave.js";
export {
  contourHatch,
  type ContourFieldOptions,
  type ContourHatchOptions,
  type ContourShape,
} from "./fill/contour.js";
export {
  contourSpiral,
  type ContourSpiralOptions,
} from "./fill/contourSpiral.js";

// Noise and fields
export { Noise, type FbmOptions } from "./noise/Noise.js";
export {
  angleField,
  curlField,
  type CurlOptions,
  type ScalarField,
  type VectorField,
} from "./field/fields.js";
export { streamlines, type StreamlineOptions } from "./field/streamlines.js";
export { Region } from "./geometry/region.js";

// Plotting
export {
  optimize,
  optimizePaths,
  type OptimizeOptions,
} from "./plot/optimize.js";
export { sortPaths, travelLength, type SortOptions } from "./plot/sort.js";
export { mergePaths, type MergeOptions } from "./plot/merge.js";
export { dedupePaths, type DedupeOptions } from "./plot/dedupe.js";
export {
  pathStats,
  plotStats,
  type PathStats,
  type PlotStats,
  type PlotStatsOptions,
} from "./plot/stats.js";

// Randomness
export { Random } from "./random/Random.js";

// Rendering
export { toSVG, pathData, formatNumber, type SVGOptions } from "./render/svg.js";
export { renderToCanvas, type CanvasRenderOptions } from "./render/canvas.js";
