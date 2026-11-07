# wtc-drawer roadmap

A plotter-first vector generative art library. Each phase ships something usable on its own, with tests and a playground sketch that shows it off.

References to `GM` point at the study code in `examples/GM/` (Zancan's *Garden, Monoliths*): the technique is borrowed, the code isn't.

**Status:** ✅ done · 🔜 next · ⬜ planned

---

## Phase 0: Core and export ✅

The foundation everything else draws through.

- [x] Vite library mode, strict TS, Vitest, publishable `wtc-drawer` package
- [x] `Polyline` (immutable, `Vec2` points, open or closed) and `Bounds`
- [x] Shapes: `line`, `rect`, `polygon`, `circle` (segment count from a tolerance)
- [x] Transform helpers over wtc-math `Mat3`, with its rotation-direction quirk pinned by tests
- [x] `Document` in mm: paper presets, orientation, margin, `drawArea`, pen layers
- [x] Seeded `Random` (sfc32 + cyrb128) with `fork(label)` for independent streams
- [x] `toSVG` (mm sizing, Inkscape layers per pen) and `renderToCanvas` preview
- [x] Playground: sketch auto-discovery, seed in the URL, `s` / `r` / `←→` keys

---

## Phase 1: Occlusion with a raster mask ✅

Hidden-line removal without vector booleans. Draw front to back, stamp each shape's silhouette into a mask, and cut later lines wherever the mask is already covered. (GM: `M_computeLineMask`, and the `m_mask` stamping in `Gr.js`.)

- [x] `Mask` (`src/mask/`): `Uint8Array` coverage at a set resolution (default 10 px/mm). It stores anti-aliased coverage and samples it bilinearly, so cuts land between pixels rather than on pixel borders.
- [x] DOM-free scanline rasteriser: an active-edge list with 4 sub-scanlines per row and exact coverage across x. It supports `nonzero` (the default, as in SVG) and `evenodd`. Strokes use round caps and joins and are filled as one exact union.
- [x] `clipPolyline(path, isHidden, opts)` in `src/geometry/clip.ts`, a generic clipper that later phases can reuse with an SDF or other tests. `mask.clip(path, opts)` wraps it.
  - [x] steps along each segment, then bisects each crossing; cut points always land on the visible side
  - [x] drops clipped fragments shorter than `minLength` (default 0.2 mm)
  - [x] walks the path as a single stroke: corners stay inside visible runs, and closed paths join the run that wraps through their start
- [x] Outline gaps: `occlusion.gap` (or `gap` on each `draw`) strokes the silhouette at 2 × gap, so lines behind stop that far from the edge (GM: `m_protectionStrokeWidth`)
- [x] `stopOnCollide` returns the visible run from the start up to the first hidden point
- [x] `doc.draw(layer, paths, { occlude, silhouette, gap, bounds, minLength })` clips, adds, then stamps. `doc.add` stays raw. `doc.mask` is created on first use and covers the page.
- [x] Debug view: the `m` key overlays the mask on the playground preview
- [x] Sketch: `occlusion.ts`, a stack of nested shapes drawn front to back over ground lines

**Done when:** overlapping closed shapes plot with no hidden lines, cut points sit within 0.05 mm of the true edge, and the tests run in Node. Met: the worst cut-point error in `Mask.test.ts` is about 0.024 mm. On the smoke run, no ground-line sample landed on the mask.

---

## Phase 2: Hatching ✅

Filling closed shapes with plottable lines. (GM: `M_hatchShape` and its distribution, spacing and hatch functions.)

- [x] `ScanlineSweep` (`src/geometry/scanline.ts`): one edge table and active-edge list, shared by the mask rasteriser and hatching
- [x] `hatch(shapes, { spacing, angle, anchor, offset, rule, alternate, join, style, minLength })`: parallel lines cut **exactly** at the edges, with both fill rules (default `nonzero`, matching `Mask.fill` and SVG)
- [x] **Page lattice by default** (`anchor: "page"`): shapes hatched alike share collinear lines. `"local"` centres the lattice on the shape, or you can pass a `Vec2`. A default `offset` of ½ spacing keeps lines off grid-aligned edges.
- [x] Lines alternate direction by lattice index (default on), and `join` makes zigzag connectors that are checked to stay inside the shape (no joins across concave notches)
- [x] Tone to spacing: `toneSpacing(tone, { pen, maxSpacing, aligned })`, where coverage = pen / spacing. Aligned spacings are `maxSpacing / n`, so different tones still share lines.
- [x] Line styles: `straight` (exact fast path) and `sine` (phase from page position, so waves line up across shapes). Custom `LineStyle`s are clipped exactly with `clipToShape`. Noise wobble waits for Phase 5.
- [x] Cross-hatching: `shade(shapes, { tone, pen })`. Passes fill in turn at their thresholds (`passCoverage`). No pass thins as tone rises, and together they cover `tone` of the paper.
- [x] Tone fields: `shade({ tone: (x, y) => t })` dithers lines on a lattice one pen width apart, with van der Corput thresholds per line. It only ever adds lines as tone rises, and stays aligned across shapes.
- [x] Works with Phase 1 through `doc.draw` with no new API. For separate pens, draw the outline with `silhouette: false`, then the hatch with `silhouette: outline`.
- [x] Exact helpers: `clipToShape`, `insideTest` and `shapeContains` (winding number)
- [x] Spirals: `spiral(shape, { spacing, center, offset, start, rings })` fills a star-shaped outline with one continuous stroke (or concentric rings, with `rings`). Each turn is the outline shrunk towards the centre, so turns keep the corners and run parallel to the edges.
  - The spacing is exact on every edge when the outline has an inscribed circle (all regular polygons and triangles, rhombi, kites, circles), and the default centre finds that circle.
  - On other shapes the spacing averages `spacing`, so ink coverage is still right.
  - Concentric circles clipped to an n-gon break into arcs in the corners, which is what this fixes.
  - Always centred on its own shape: the page lattice doesn't apply.
  - Throws for shapes that aren't star-shaped (a U); those wait for the Phase 3 contour spiral.
- [x] Sketches: `swatches.ts` (a pen calibration sheet: tone ramps per style, spirals against concentric circles, gradients, page versus local anchors) and `shading.ts` (lit shapes, cross-hatched tone fields, occlusion)

**Done when:** any simple or self-intersecting closed polyline can be hatched with tone-driven spacing, with nothing outside the shape. Met: `hatch.test.ts` samples every line in random concave blobs, a pentagram and shapes with holes under both rules, and all line ends sit on edges to 1e-9. The smoke run found no shading point outside its silhouette, and both sketches build in under 65 ms.

**Global versus local:** global costs nothing extra (each shape takes its own `k` range from its projected extent). Its real cost comes with tone that varies inside a shape, which is dithered on a fine lattice rather than given varying spacing. That walks about `avgSpacing / pen` times more lattice lines and samples tone along each one. Densities other than 1/2^n give a mild repeating rhythm, which shows as a faint banding in gradients.

---

## Phase 3: SDF and contour hatching ⬜

Outline-following fills for any shape, the general form of GM's leaf hatching. Chosen over repeated inset offsets.

- [ ] `SDF` grid: exact distance to segments, signed with even-odd, at a chosen resolution
- [ ] SDF combinators: union (`min`), intersection (`max`), subtraction and smooth union
- [ ] Marching squares that pull isolines out as polylines, with interpolated crossings
- [ ] Contour hatching: isolines at `d = k·spacing`, with spacing optionally driven by tone
- [ ] Bonus features that come for free:
  - [ ] boolean outlines (the isoline at `d = 0` of a combined SDF)
  - [ ] offsets and insets (the isoline at `d = r`)
- [ ] Post-processing: smoothing and simplification (RDP) of the extracted contours
- [ ] Per-shape choice between contour and parallel hatching
- [ ] Contour spiral: blend each contour ring into the next over one turn, giving one continuous stroke with even spacing in any shape, concave or irregular. This generalises Phase 2's `spiral`, which is exact only for outlines with an inscribed circle and needs a star-shaped outline.
- [ ] Perpendicular inset for hatching: keep hatch lines a set distance inside the outline, measured square to it (the SDF isoline `d = -inset`), rather than trimming along each line
- [ ] Sketch: organic blobs with contour fills, unioned and occluded

**Done when:** contour hatching follows the outline of arbitrary shapes and of boolean combinations, and stays within the SDF resolution of the true geometry.

---

## Phase 4: Plot optimisation ⬜

Makes real plots faster and cleaner. This can move ahead of Phases 2 and 3 if real plotting starts early.

- [ ] Path ordering: greedy nearest-neighbour per layer, allowing reversal, to cut pen-up travel
- [ ] Merge paths whose ends touch, within a tolerance
- [ ] Simplify (RDP) to a tolerance below the pen width
- [ ] Remove duplicate and overlapping segments
- [ ] Stats: pen-down and pen-up distance, and an estimated plot time from a configurable speed
- [ ] HUD in the playground showing the stats before and after optimising

---

## Phase 5: Noise and fields ⬜

The raw material for organic sketches. (GM's `perlin.js` was empty in the copy we have; its noise came from a global `noise.simplex2`.)

- [ ] Seeded 2D and 3D simplex noise, plus fBm, tied to `Random` so a seed reproduces it
- [ ] Vector fields: noise-based curl, and custom functions
- [ ] Streamlines with even spacing (Jobard–Lefer), using the Phase 1 mask for collision (`stopOnCollide`)
- [ ] Flow-field hatching as a fill style (GM: `M_hatchFuncFlowField`)

---

## Phase 6: Curves and swept shapes ⬜

GM's best trick: shapes built in their own parameter space, so their hatching follows their form. (GM: `M_drawLeaf` and `M_hatchFuncLeaf`.)

- [ ] Curve sampling to polylines: quadratic and cubic Bézier, Catmull-Rom, arcs (adaptive, tolerance-based)
- [ ] `Sweep`: spine curve + width profile + optional bend, giving its outline
- [ ] Parameter-space hatching: lines across the sweep (at constant position along the spine) and along it (at constant offset from the spine), drawn through the same transform as the outline. Hatch lines run slightly long and get clipped to the outline.
- [ ] Profile library: leaf, blade, petal and taper shapes, plus helpers for an inverse profile
- [ ] Sketch: a field of leaves or grass, occluded front to back

---

## Phase 7: Small 3D objects ⬜

3D only inside each object, placed on a 2D page, as GM does. (GM: `M_putObject3D` and `Mesh` in `Math.js`.)

- [ ] `Mesh`: faces and edges, with shared edges plotted once
- [ ] Builders: box, chamfered or "broken corner" block, extruded and lathed shapes
- [ ] Parallel oblique projection, using wtc-math `Vec3` / `Mat4`
- [ ] Back-face culling, then a front-to-back face sort (so non-convex meshes work too)
- [ ] Per-face shading: tone from `N·L` sets the hatch spacing, and each face gets a stable hatch angle
- [ ] Crease detection: edges between nearly flat neighbours go to a lighter pen
- [ ] Stamp the mask with outline gaps, so later 2D drawing tucks behind objects
- [ ] Clip at a ground plane (objects sunk into terrain)

---

## Phase 8: Playground and tooling ⬜

- [ ] Parameter panel (Tweakpane) built from a sketch's declared params
- [ ] Traits and features: weighted random choices recorded per seed, like fxhash features
- [ ] PNG export at print resolution
- [ ] Batch export of a seed range to SVG
- [ ] Keep the current seed across hot reloads

---

## Phase 9: Publishing ⬜

- [ ] README with a quick start and a gallery
- [ ] API docs generated from TSDoc
- [ ] CI: typecheck, test and build on every push
- [ ] Changesets or versioning, and the first `npm publish`

---

## Open decisions

| Question | Leaning | Decide by |
| --- | --- | --- |
| Rename `Document`? It hides the DOM `Document` type in any file that imports it | Open (`Sheet` is a candidate) | Before the first publish |
| `wtc-math` as a dependency or a peer dependency? | Peer, if consumers use `Vec2` directly alongside it | Phase 9 |

### Settled

| Question | Decision |
| --- | --- |
| Rasterise the mask with Canvas2D, or with our own scanline code? | Our own scanline code, with anti-aliased coverage (Phase 1). It's DOM-free, deterministic and testable in Node. |
| Use `Vec2` in hot inner loops? | No. Mask and clipping code works on raw numbers and typed arrays; `Vec2` stays at the API surface. The A5 occlusion sketch, about 10 m of line, builds in 15–50 ms in Node. |
| Default mask resolution | 10 px/mm, through `occlusion.resolution`. Cut points land within about 0.025 mm of the true edge. |
| Pin hatching to the page or to each shape? | The page by default, with `anchor: "local"` or a `Vec2` per call (Phase 2). Costs nothing for constant tone; tone fields use line dithering to stay aligned. |
