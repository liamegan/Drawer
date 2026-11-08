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
- [x] Tone-driven waves (added 2026-11-08): `waveShade(shapes, { tone, pen, spacing })` draws unbroken wavy lines whose waves carry the tone, growing taller at `wavelength`, then tightening down to `minWavelength`. Tone is true ink coverage: a table measures the stroke's area, counting overlaps once, and is checked against point sampling to within about 0.01. The range runs from `pen / spacing` (a straight line) to about 0.94–0.97 (`waveToneRange`). The phase is summed along each line, so changing wavelength never kinks, and constant tones stay page-aligned.
- [x] Sketches: `swatches.ts` (a pen calibration sheet: tone ramps per style, spirals against concentric circles, gradients, page versus local anchors) and `shading.ts` (lit shapes, cross-hatched tone fields, occlusion)

**Done when:** any simple or self-intersecting closed polyline can be hatched with tone-driven spacing, with nothing outside the shape. Met: `hatch.test.ts` samples every line in random concave blobs, a pentagram and shapes with holes under both rules, and all line ends sit on edges to 1e-9. The smoke run found no shading point outside its silhouette, and both sketches build in under 65 ms.

**Global versus local:** global costs nothing extra (each shape takes its own `k` range from its projected extent). Its real cost comes with tone that varies inside a shape, which is dithered on a fine lattice rather than given varying spacing. That walks about `avgSpacing / pen` times more lattice lines and samples tone along each one. Densities other than 1/2^n give a mild repeating rhythm, which shows as a faint banding in gradients.

---

## Phase 3: SDF and contour hatching ✅

Outline-following fills for any shape, the general form of GM's leaf hatching. Chosen over repeated inset offsets.

- [x] `SDF` grid (`src/sdf/`): exact distance to segments, at a chosen resolution (default 5 nodes/mm). Nodes sit on a page lattice, so grids of different shapes line up. **Changed from the plan:** the sign follows the fill rule (default `nonzero`, as everywhere else), not even-odd only. Distances are measured to the true boundary under that rule, so overlapping rings under nonzero leave no internal edges.
  - Exact distances in a band round each segment, then closest-segment propagation (8SSEDT-style sweeps, two rounds) with a walk along each ring's segments to catch thin Voronoi wedges. Against brute force on a 1500-point outline the worst error is 0.00009 mm. A 60 mm shape takes 12–30 ms.
- [x] SDF combinators: `union`, `intersect`, `subtract` (each with an optional smooth radius, a polynomial smooth min) and `offset`. A lazy expression tree: nothing is computed until something samples it.
- [x] Marching squares (`isolines(field, levels)`): every level in one pass, crossings interpolated linearly, saddles decided by the cell mean. Outer rings run clockwise and holes the other way, so either fill rule fills them. Sharp inward corners are cut by up to half a cell's diagonal (0.14 mm by default).
- [x] Contour hatching: `contourHatch(shapes | field, { spacing, offset })`, rings at `d = −(offset + k)·spacing`. Combined fields are re-distanced from their outline first so rings stay evenly spaced; `exact: false` keeps the "metaball" creases where the shapes met.
- [x] Bonus features that come for free:
  - [x] boolean outlines (the isoline at `d = 0` of a combined SDF)
  - [x] offsets and insets (the isoline at `d = r`)
- [x] Post-processing: `smooth` (Chaikin) and `simplify` (RDP), applied to every traced path (`smooth`, `simplify`, `minLength` options)
- [x] Per-shape choice between contour and parallel hatching: `shade(shape, { tone, pen, contour: true })` makes the first pass contours, with parallel passes cross-hatching over them as the tone darkens. Tone fields dither the rings like lines (van der Corput threshold per ring).
- [x] Contour spiral: `contourSpiral(shapes | field, { spacing, start })`. Each turn walks a contour ring and sinks towards the next one along the field's gradient, giving one continuous stroke in any simply connected shape. Where the shape splits, the stroke carries on into one lobe and each other lobe gets its own spiral. Shapes with holes fall back to contour rings. Phase 2's `spiral` stays as the cheap, exact option for outlines with an inscribed circle.
  - Turn spacing, in spacings (5th percentile, where 1 is exact): circle 0.99, square and hexagon 0.98, triangle 0.96, organic blobs 0.98, a U 0.91. A lobe that runs out between turns (a hand's fingers) leaves one turn up to 18% tight at the 1st percentile, so the extra machinery to fix that wasn't added.
  - Parts too thin for another turn get a centre line, drawn there and back.
- [x] Perpendicular inset for hatching: `hatch({ inset })` and `shade({ inset })` keep lines a set distance inside the outline, measured square to it (the isoline `d = −inset`). Line ends sit within 0.01 mm of the inset, or further in at sharp corners; never nearer the edge. The lattice doesn't move.
- [x] Sketch: `contours.ts`, organic blobs (single, smooth-unioned clusters, and bitten), filled with contours, spirals, contour shading, metaball contours, and parallel hatching with and without an inset, `sine` wave hatching and `waveShade`, occluded front to back, with a halo of grown outlines round the nearest shape

**Done when:** contour hatching follows the outline of arbitrary shapes and of boolean combinations, and stays within the SDF resolution of the true geometry. Met: `contour.test.ts` checks every ring point's depth to 0.1 mm (most within 0.01) on random concave blobs, holes, unions and grown fields, and the spiral tests check spacing, coverage and containment. 172 tests pass. The sketch builds in 150–225 ms in Node.

---

## Phase 4: Plot optimisation ✅

Makes real plots faster and cleaner. Plotting is AxiDraw straight from the SVG, with no vpype, so this is the only optimiser. `optimize(doc)` returns a new document with the same sheet, layers and pens. Layers are never reordered, since each is a pen.

- [x] Path ordering: `sortPaths`, greedy nearest-neighbour per layer from home (top-left), reversing open paths and starting closed paths at their nearest vertex. Uses a removable point grid (`src/plot/grid.ts`).
- [x] Merging: `mergePaths` joins paths whose ends meet within 0.05 mm, reversing as needed. Chains that loop become closed paths.
- [x] Simplify (RDP) at 0.02 mm, well below any pen width
- [x] Removing duplicate and overlapping ink: `dedupePaths` removes stretches that follow earlier ink within 0.05 mm for at least 1 mm.
  - This catches repeated paths, shared edges and the contour spiral's there-and-back centre lines.
  - Lines that only cross are never cut: segments must be within 15°, and a stretch whose sideways offset drifts by more than the tolerance is a shallow crossing.
  - Texture is left alone. A stretch must follow one stretch of partner ink, so `waveShade`'s overlapping flanks and densely sampled curves stay as drawn.
- [x] Stats: `plotStats` gives pen-down and pen-up distance, lifts, points and an estimated time per layer, each layer from home and back. Defaults are rough AxiDraw-like figures (50 mm/s drawing, 150 mm/s travel, 0.3 s per lift); calibrate them by timing a real plot. Acceleration is ignored.
- [x] Playground:
  - The HUD shows raw → optimised ink, travel, lifts and time, plus build and optimise times.
  - `s` saves the optimised SVG, and `o` toggles preview and save back to raw.
  - `t` overlays the pen-up moves.

**Done when:** every sketch's optimised SVG draws the same ink with clearly less pen-up travel. Met (seed 1 unless stated):

| Sketch | Travel (m) | Lifts | Estimated time (min) | Optimise |
| --- | --- | --- | --- | --- |
| shading | 33.8 → 3.3 | 1408 → 1307 | 19.3 → 15.4 | 16 ms |
| occlusion | 15.8 → 2.1 | — | 6.7 → 5.2 | 9 ms |
| swatches | 17.8 → 5.7 | — | 29.0 → 26.8 | 56 ms |
| hello | 3.7 → 2.0 | — | — | 14 ms |
| contours (seed 2) | 4.3 → 2.1 | — | — | 49 ms |

- **Ink is the same:** every sketch's raw and optimised renders are pixel-identical at 150 dpi, and no point of either is more than 0.055 mm from the other's ink.
- **Speed:** the optimiser takes 8–57 ms. On the fast sketches that's longer than the build, so the "a quarter of build time" target was off, though it's small in absolute terms.
- **2-opt:** greedy ordering leaves short, local moves (checked with `t` renders), so 2-opt wasn't added.

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

- [x] Debug guides: sketches record construction shapes and labels through `draw(doc, random, debug)`, and `d` shows them over the preview only (added 2026-11-08 for the contours sketch's metaballs)
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
| Sign the SDF with even-odd, or with the fill rule? | The fill rule, default `nonzero` (Phase 3). Distances are measured to the true boundary under it, so overlapping rings leave no internal edges. |
| How does the contour spiral handle splits? | It carries on into one lobe and starts a new spiral in each other one (Phase 3). Shapes with holes get contour rings instead. |
| Contour spiral: arc length per ring, or carry the position along from the previous turn? | Arc length per ring (Phase 3). Carrying it only helps where a lobe runs out between turns, and there the error stayed under the 15% bar except in the 1st percentile. |
