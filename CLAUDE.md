# wtc-drawer

A publishable, plotter-oriented vector generative art library. `src/` is the library (published as `wtc-drawer`); `playground/` is a dev harness of sketches that import it by package name.

`examples/GM/` is third-party reference code (Zancan's *Garden, Monoliths*). It's for study only: it's gitignored, and nothing should import it.

## Commands
- `npm run dev`: playground at `/?sketch=<file-name>#seed=<seed>`. Keys: `s` saves the SVG, `r` picks a new seed, `←/→` steps the seed, `o` switches the preview and `s` between the optimised and raw drawing (optimised by default), `t` overlays pen-up travel, `m` toggles the mask overlay, `d` toggles debug guides. `o`, `t` and `d` are kept in the URL (`?raw`, `?travel`, `?debug`). Sketches record guides through the third `draw` argument; they show on the preview only, never in the SVG.
- `npm test`: Vitest. Tests live next to the code as `src/**/*.test.ts`.
- `npm run typecheck`: checks the app (`tsconfig.json`) and `vite.config.ts` (`tsconfig.node.json`).
- `npm run build`: `vite build` (lib mode, emits `dist/index.es.js`), then `tsc -p tsconfig.build.json` (emits `.d.ts` files only).

## Conventions
- Strict TS, `verbatimModuleSyntax` (use `import type` for types), and `erasableSyntaxOnly` (no enums or parameter properties).
- Relative imports in `src/` use **`.js` extensions** (`./Polyline.js`) so the emitted `.d.ts` files resolve for consumers.
- Units are **millimetres**. The origin is at the top-left and y points down. Pixels exist only inside `renderToCanvas`.
- Geometry is immutable: `Polyline` copies its input and its methods return new instances. `Document` and `Layer` are mutable containers.
- `wtc-math` provides `Vec2` and `Mat3`. It is external in the build; don't re-export it.
- All randomness in a sketch goes through `Random`. Use `random.fork(label)` for independent streams.
- Keep `src/` free of DOM globals. Renderers take a context; the playground owns `document` and `window`.
- Occlusion: draw **front to back**. `doc.draw()` clips paths against `doc.mask` and then stamps their silhouette; `doc.add()` does neither. Mask pixel (i, j) is centred at `((i+0.5)/res, (j+0.5)/res)` mm, and fills default to `nonzero`, as in SVG. Hot loops (the rasteriser, `clipPolyline`) use raw numbers, not `Vec2`.
- Hatching:
  - **Angles:** positive turns clockwise on screen, and 0 gives horizontal lines.
  - **Lattice:** `hatch` and `shade` pin lines to a **page lattice** by default (`anchor: "page"`, `offset` ½ spacing), so shapes hatched alike line up.
  - **Clipping:** clipping to a shape is exact (`ScanlineSweep` or `clipToShape`), never via the mask.
  - **Spirals:** `spiral` shrinks the outline towards a centre, so it is always local and needs a star-shaped outline. Spacing is exact only when the outline has an inscribed circle.
  - **Separate pens for outline and hatch:** draw the outline with `doc.draw("ink", outline, { silhouette: false })`, then the hatch with `doc.draw("shade", lines, { silhouette: outline })`.
- Distance fields (`src/sdf/`):
  - **Sign:** negative inside, in mm, and signed by the fill rule (default `nonzero`). Distances are measured to the true boundary under that rule.
  - **Grid:** nodes sit on a page lattice at multiples of `1 / resolution` (default 5 nodes per mm), so grids of different fields line up index for index.
  - **Exactness:** a leaf from `sdf()` is exact. `union`, `intersect`, `subtract` and growing `offset`s are not exact inside, so contour fills (`contourHatch`, `contourSpiral`) re-trace a combined field's outline into an exact leaf first, unless `exact: false`. `SDF.exact` means "inside distances are true", which shrinking `offset`s keep.
  - **Isolines:** outer rings run clockwise on screen, holes the other way, so either fill rule fills them. Inset outlines (`hatch({ inset })`) are hatched with even-odd.
- Noise and fields: noise is seeded through `Random` (`new Noise(random.fork("noise"))`) and never uses `Math.random`. A `VectorField` is a plain `(x, y) => [dx, dy]` function in mm; streamlines follow its direction only, and treat a zero vector as a stop. Use `Region` (`src/geometry/region.ts`) for repeated point-in-shape and segment-exit queries on the same shapes.
- Curves and sweeps: curves (`src/geometry/curves.ts`) return Polylines within a `tolerance` (default 0.02 mm, as `circle`). A `Sweep` (`src/sweep/`) has its own coordinates: t runs along the spine by arc length, 0 at the base and 1 at the tip; v runs across it, −1 on the left edge to 1 on the right (the right is the tangent turned clockwise on screen). A `Profile` gives the half-width as a fraction of `width / 2` for each t; `parametric` outlines use unit space, with y along the spine and x across. `sweepHatch` lays lines out and clips them in `Sweep.unrolled`, never on the page, so curled sweeps can't pick up stray pieces. Keep the half-width under the tightest bend's radius, or the inner edge folds. Draw shapes that grow out of something with `openOutline` and use `outline` as the silhouette.
- 3D objects (`src/three/`):
  - **Axes:** the world is x right, y up, z towards the viewer, in mm. Face rings run counter-clockwise seen from outside.
  - **Rotations:** `rotateX/Y/Z` follow the right-hand rule (`rotateY(+)` takes +z to +x), the opposite sense to the 2D helpers. `compose3` applies its arguments in order.
  - **Drawing:** a mesh becomes 2D paths only through `renderMesh`, which removes hidden lines exactly in vectors (no face sort, no mask). The mask is for occlusion between the object and the rest of the page: draw `edges`, `creases` and `hatch` with `silhouette: false` except the last call, which takes `silhouette` (and a `gap` for the halo).
  - **Limits:** faces mustn't pass through each other, and back faces are culled, so view a `clipBelow` mesh from above. Faces narrower than the hatch spacing can get no first-pass lines.
- Plotting (`src/plot/`): `optimize(doc)` returns a new Document and never touches the input. It never reorders or mixes layers (a layer is a pen). Each layer starts from home at the page's top-left (0, 0) and returns there, as AxiDraw does. Test helpers shared between test files go in `*.test-util.ts`, which the declaration build excludes.
- New files follow Prettier defaults (80 columns), which is what the editor applies.

## wtc-math gotchas (verified on 1.4.0, pinned by `transforms.test.ts`)
- Mat3 is column-major, with the translation in `a31/a32`. `Vec2.transformByMat3` applies the translation.
- `m.multiply(n)` computes `m × n`, so `n` is applied first. The chained `identity().translate(t).rotate(r)` rotates first.
- `Mat3.fromAngle(θ)` and `Mat3.identity().rotate(θ)` rotate in **opposite** directions. Use the helpers in `src/geometry/transforms.ts`: a positive angle turns clockwise on screen, and `compose(a, b, c)` applies `a` first.

## Roadmap
See `roadmap.md`, which lists phases, status, completion criteria and open decisions. Keep it up to date as phases land.
