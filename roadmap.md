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

## Phase 5: Noise and fields ✅

The raw material for organic sketches. (GM's `perlin.js` was empty in the copy we have; its noise came from a global `noise.simplex2`.)

- [x] Seeded noise: `new Noise(random.fork("noise"))`, with 2D and 3D simplex noise (Gustavson) in [−1, 1] and fBm (`fbm2`, `fbm3`; octaves, frequency, lacunarity, gain), normalised back to [−1, 1].
  - About 15 ms per million `simplex2` calls, and 75 ms per million 4-octave `fbm2` calls.
- [x] Vector fields: a `VectorField` is any `(x, y) => [dx, dy]`. `angleField(angle)` gives unit vectors at an angle; `curlField(potential)` takes the curl by central differences, which is divergence-free, so lines never bunch.
- [x] Evenly spaced streamlines: `streamlines(field, { region, separation, test, step, minLength, maxLength, seeds, stopAt })`, after Jobard and Lefer.
  - **Tracing:** RK4 on the unit field, both ways from each seed. New seeds are tried a separation either side of every line, and a scan afterwards picks up any part the flow didn't reach, such as a separate part of the region.
  - **Self-collision:** each grid point stores its arc position along its line. A growing line ignores its own points within two separations of arc, so closed orbits end as rings.
  - **Lines stop at:**
    - the region's edge, exactly: `Region` (`src/geometry/region.ts`) is a banded edge index that classifies the stretches between crossings by exact winding;
    - other lines (half a separation away);
    - sinks and saddles, where a step reverses or stalls;
    - ink, via `stopAt` (for example `doc.mask.hiddenTest()`);
    - `maxLength`, after which the flow carries on in dashes.
  - **Separation:** can vary with position, and an infinite separation leaves an area empty.
  - **Measured on curl noise:**
    - Closest approach between lines: 0.48 of the separation. Collisions are checked between points a quarter separation apart, which allows √(½² − ⅛²) ≈ 0.484.
    - Gaps: 99% of points are within 0.77 separation of a line, and the worst gap is 1.2.
    - Speed: an A5 page (24 m of line) takes 180 ms.
  - Fixed during the work: a stall at sinks, where RK4's samples cancel within half a step of the centre. It now stops on no progress.
- [x] Flow-field hatching: `flowHatch(shapes, { field, spacing } | { field, tone, pen })`, with `inset`, `maxLength` and `stopAt`. Tone sets the spacing (`pen / tone`, none lighter than `pen / maxSpacing`), and tone fields work. Coverage is within about 10% of the tone: dark tones run a little dark, light ones a little light.
- [x] Sketch: `flow.ts`, noise-warped blobs filled with curl, grain (angle field), tone, dashed and inset flow, occluded front to back, over a slow curl-noise background that ends at the blobs. Debug shows the background field's direction and labels each fill. It builds in 160–440 ms; optimising cuts pen-up travel from about 23 m to 4 m.

**Done when:** seeded noise and fields drive evenly spaced streamlines that fill any region without crowding or large gaps, and flow-field hatching works as a tone-aware fill that stops at existing ink. Met: `streamlines.test.ts` checks spacing, gaps, field-following, exact edge ends, holes and fill rules, rings, sinks, `stopAt`, variable density, dashes and determinism. 228 tests pass.

---

## Phase 6: Curves and swept shapes ✅

GM's best trick: shapes built in their own parameter space, so their hatching follows their form. (GM: `M_drawLeaf` and `M_hatchFuncLeaf`.)

- [x] Curve sampling to polylines (`src/geometry/curves.ts`): `quadratic`, `cubic`, `catmullRom` (centripetal by default, so no cusps or loops; open or closed) and `arc`, all within `tolerance` (default 0.02 mm, as `circle`). Béziers are split adaptively, so a straight run costs two points.
- [x] `Sweep` (`src/sweep/Sweep.ts`): a spine (any open `Polyline`) plus a width profile and an optional `bend`, giving a closed outline (clockwise) and an `openOutline` without the base, for shapes that grow out of something.
  - **Coordinates:** t runs along the spine by arc length, base to tip; v across it, −1 on the left edge to 1 on the right. `point(t, v)`, `pointAtOffset(t, mm)`, `frame(t)`, `halfWidth`, `widest` and `midrib(from, to)`. Past the ends, the spine carries on straight.
  - **Frame:** normals are blended between the spine's vertices, so outlines don't kink at corners.
  - **Bend:** turns the spine by `bend` radians spread evenly along it. Each piece becomes an exact arc, and the end tangent turns by exactly `bend`.
  - **Fold limit:** where the half-width is more than the radius of a bend, the inner edge folds over. This is documented, not prevented.
  - **Accuracy:** the outline is within 0.02 mm of the true edge on a curved spine.
- [x] Parameter-space hatching (`sweepHatch`): lines are laid out and clipped in the unrolled sweep (`Sweep.unrolled`), then carried onto the page. They end at the true edge, and a sweep that curls past itself (tested at 1.6 turns) can't pick up stray pieces. That replaced the plan's "run long and clip to the outline on the page".
  - **Across:** lines `spacing` apart along the spine, with `bow` (vein chevrons that fade at the ends), `slant`, `offset` and `span` (part of the width, such as `[0, 1]` for a shaded half).
  - **Along:** lines split the widest point evenly, with the outline counted as the outermost line.
    - **Thinning (`thin`):** a line ends where it would come within ½ spacing of the line it defers to (2^j steps away for line m · 2^j) or of the edge. Line ends are staggered by van der Corput within each level, so tone doesn't step. Tested: gaps stay at least ½ spacing right to the tip, and no two lines end together. `thin: 0.72` gives an even tone; `false` runs every line to the tip.
  - **Shared:** `tone` and `pen` (coverage within 10%), and `inset`.
  - **Speed:** 500 hatched grass blades take about 150 ms.
- [x] Profile library (`profiles.*`): `leaf({ widest })`, `blade({ taper })`, `petal({ widest })` and `taper(from, to)`; `serrate` and `lobed` edges, which never widen the profile. `parametric(t => [x, y])` takes an outline that can turn back, like GM's clover heart, and works out the width per height itself, so there's no inverse profile to write.
- [x] Sketch: `meadow.ts`, A5 landscape.
  - **Grass:** eight rows from the horizon to the front, of `blade` sweeps leaning and curling with noise, hatched `along`. Nearer rows are taller, wider and darker.
  - **Plants:** three to five, each a `catmullRom` stem with drooping leaves (`leaf`, `serrate` or clover hearts), hatched `across` in bowed veins, with midribs and a denser half on the side away from the light.
  - **Drawing:** everything is occluded front to back. Debug shows spines and leaf frames, and labels each plant's leaf kind.
  - **Measured:** it builds in 200–260 ms, and optimising cuts pen-up travel from about 72 m to 6 m.

**Done when:** curves sample within tolerance, sweeps give clean outlines with their own parameter space, hatching follows the form across and along it with clean tips, and the meadow shows layered grass and leaves. Met: 263 tests pass, including `curves.test.ts`, `profiles.test.ts`, `Sweep.test.ts` and `sweepHatch.test.ts`.

---

## Phase 7: Small 3D objects ✅

3D only inside each object, placed on a 2D page, as GM does. (GM: `M_putObject3D` and `Mesh` in `Math.js`.) World axes are x right, y up and z towards the viewer, in mm. The result of drawing a mesh is ordinary 2D paths for `doc.draw`.

- [x] `Mesh` (`src/three/Mesh.ts`): shared vertices and faces as index rings, counter-clockwise from outside. It gives Newell normals, each edge once with its faces (`edges`), open edges, bounds and volume. `transform(Mat4)` keeps faces outward through mirrors.
- [x] Builders (`src/three/builders.ts`):
  - `box` stands on y = 0, centred on x and z.
  - `extrude` takes a 2D outline either way round.
  - `lathe` spins a `(radius, y)` profile into rings; a radius of 0 at an end makes a point. `jitter` moves ring centres, as GM's trunks, and side faces stay flat.
  - `breakCorners` is GM's broken corners: each pass cuts every edge near both ends, a random share in from each, and replaces each corner with a facet. A box gets 14 faces after one pass and 38 after two, all flat. A corner of more than 3 faces is fanned into triangles.
- [x] Projections (`src/three/projection.ts`): `oblique({ factor, angle })`, GM's, and `orthographic({ elevation, azimuth })`, both linear, with `toEye` and `depth`. 3D transforms are in `transforms3.ts` (`rotateX/Y/Z`, `translate3`, `scale3`, `compose3`), with wtc-math's Mat4 behaviour pinned by tests. Rotations follow the right-hand rule, the opposite sense to the 2D helpers.
- [x] Hidden lines (`renderMesh`): back faces are culled, then hidden parts are removed **exactly, in vectors**, instead of the planned front-to-back face sort.
  - Every path is cut where it crosses a visible face's outline (`clipWhere`, split out of `clipToEdges`), and a piece is kept unless a face nearer than it (by that face's plane) covers its middle.
  - It needs no sort and is exact for any overlaps, as long as faces don't pass through each other. Tested against a brute-force ray cast on concave shapes (an L and an urn) in five views.
- [x] Per-face shading: tone from ((1 + N·L) / 2)², GM's lighting, spread over a `tone` range and drawn with `shade`. Lines are **painted on** each face, every pass of them:
  - the first runs down the slope on walls and into the depth on near-flat tops;
  - the second runs along the face's other axis (along a wall, round a column);
  - the third and fourth run along its diagonals.

  Planes read as planes and parallel faces match. Spacing is set on the page, so the page lattice keeps neighbours aligned. `hatch` overrides the direction per face.
- [x] Creases: an edge between two visible faces whose normals differ by less than `crease` (default 15°) goes to `creases`, for a lighter pen. The outline and sharp edges go to `edges`, each drawn once.
- [x] Mask: `silhouette` is the visible faces' rings, so `doc.draw(…, { silhouette, gap })` stamps the object with a halo that later drawing stops short of.
- [x] Ground: `mesh.clipBelow(y)` cuts faces at the plane. The hole isn't capped, and edges in the plane are open, so no line is drawn where the object meets the ground.
- [x] Sketch: `stones.ts`, A5 landscape. Broken-corner blocks, a lathed urn and a column stand on the meadow's grass rows (shared through `playground/sketches/lib/meadow-kit.ts`; the meadow's output is unchanged). Each object is sunk on a row, so that row's grass hides the cut, and goes on its own `stone` pen with its creases. About a third of the seeds use an orthographic view. Debug shows face normals, back faces and labels.
  - **Measured:** a test sheet of 12 objects renders in about 47 ms. The sketch builds in 180–290 ms, and optimising cuts pen-up travel from 50–67 m to about 6 m.

**Done when:** objects project in either view, with each visible edge drawn once and exactly; faces are shaded from the light with lines painted on the face; creases are on their own pen; objects sink into the ground and sit in the meadow, with later drawing kept clear by the halo. Met: 294 tests pass, including `Mesh.test.ts`, `projection.test.ts`, `transforms3.test.ts` and `renderMesh.test.ts`.

---

## Phase 8: Playground and tooling ✅

- [x] Debug guides: sketches record construction shapes and labels through `draw(doc, random, debug)`, and `d` shows them over the preview only (added 2026-11-08 for the contours sketch's metaballs)
- [x] Parameter panel (Tweakpane 4, a dev dependency, `playground/panel.ts`), built from a sketch's declared params.
  - **Declaring:** `defineSketch({ params: { … } })` types them in `draw(doc, random, debug, { params, traits })`. Specs are numbers (sliders), booleans, `options` lists and `color`s.
  - **Building:** changes rebuild once per frame.
  - **URL:** non-default values live in the URL (`?p.halo=1.2`), so reloads, new seeds and shared links keep them; bad values fall back to the default and numbers are clamped.
  - **Panel:** it also has the seed, its traits, view toggles and export.
- [x] Traits:
  - **Library:** `random.weighted({ a: 1, b: 2 })` (or `[value, weight]` pairs) draws once, in the order given, so it can replace a `value() < p` threshold without changing any seed.
  - **Playground:** `traits.pick` / `traits.set` record a seed's traits for the HUD and panel, and for the SVG's new `<desc>` (`toSVG({ description })`), with any changed params.
  - **Sketches:** stones (View, Stones, Kinds) and meadow (Plants, Leaves) record theirs. Both still produce byte-identical output at default params. Over stones seeds 1–60, View comes out 67% oblique to 33% orthographic, as weighted.
- [x] PNG export at print resolution: `p` or the panel renders the artwork alone at 150, 300 or 600 dpi; if the browser refuses a canvas that size, the HUD says so.
- [x] Batch export of a seed range from the panel, through a dev-only Vite plugin (`tools/export-plugin.ts`). It writes SVGs (and PNGs) into `exports/<sketch>/`, with `traits.json` holding each seed's traits and a tally; the tally also shows in the HUD. It yields between seeds and can be stopped. The plugin only writes `.svg`, `.png` and `.json` inside `exports/`.
  - The roadmap's open question (Node CLI or browser) went to the browser, so the export uses exactly the preview's code path (`playground/run.ts`) and can make PNGs.
- [x] Seed and state across hot reloads:
  - **What's kept:** the seed, view flags (now including `?mask` and `?nopanel`) and params live in the URL.
  - **Sketch edits:** editing a sketch (or `sketches/lib/`) is accepted by `main.ts` and rebuilds in place with the panel intact.
  - **Library edits:** these reload the page, and the URL survives.

**Done when:** sketches can expose typed params in a panel, seeds record traits, and a seed range exports to files with a trait tally. Met: 298 tests pass; typecheck covers `tools/`; the library build doesn't include Tweakpane. The export endpoint was checked against a running dev server; the panel itself is checked by hand.

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
