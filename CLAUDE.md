# wtc-drawer

A publishable, plotter-oriented vector generative art library. `src/` is the library (published as `wtc-drawer`); `playground/` is a dev harness of sketches that import it by package name.

`examples/GM/` is third-party reference code (Zancan's *Garden, Monoliths*). It's for study only: it's gitignored, and nothing should import it.

## Commands
- `npm run dev`: playground at `/?sketch=<file-name>#seed=<seed>`.
  - **Keys:**
    - `s` saves the SVG and `p` a PNG (at the panel's dpi, default 300).
    - `r` picks a new seed and `←/→` steps it.
    - `o` switches the preview and saves between the optimised and raw drawing (optimised by default).
    - `t` overlays pen-up travel, `m` the mask and `d` debug guides.
    - `h` hides the panel.
  - **URL:** view flags are kept in the URL (`?raw`, `?travel`, `?mask`, `?debug`, `?nopanel`), as are params that differ from their defaults (`?p.halo=1.2`).
  - **Hot reload:** editing a sketch or `sketches/lib/` rebuilds in place. Editing `src/` reloads the page, and the URL keeps the state.
  - **Panel** (Tweakpane, `playground/panel.ts`): the sketch's params, the seed and its traits, view toggles and export.
  - **Batch export:** "export range" builds seeds from–to and writes `exports/<sketch>/<sketch>-<seed>.svg` (and `.png`), plus `traits.json` with each seed's traits and a tally. It writes through a dev-only Vite plugin (`tools/export-plugin.ts`, `POST /__export`). `exports/` is gitignored.
- Sketches (`playground/Sketch.ts`):
  - **`draw(doc, random, debug, { params, traits })`.** Guides recorded through `debug` show on the preview only, never in the SVG.
  - **Params:** declare them with `defineSketch({ params: { halo: { value: 0.6, min: 0, max: 2 } }, ... })` so they're typed. A number, boolean, `options` list or `color: true` makes the matching control.
  - **Traits:** record a seed's character with `traits.pick(name, random, { a: 1, b: 2 })` (one draw, like `random.weighted`) or `traits.set(name, value)`. They go in the HUD, the panel, the SVG `<desc>` (with any changed params) and the batch tally.
  - **Shared code:** goes in `playground/sketches/lib/`. Only files directly in `sketches/` are sketches.
- `npm test`: Vitest. Tests live next to the code as `src/**/*.test.ts`.
- `npm run typecheck`: checks the app (`tsconfig.json`), and `vite.config.ts` with `tools/` (`tsconfig.node.json`).
- `npm run build`: `vite build` (lib mode, emits `dist/index.es.js`), then `tsc -p tsconfig.build.json` (emits `.d.ts` files only).
- `npm run docs`: TypeDoc into `docs/api/` (gitignored), with the README as its front page.
  - **TypeScript version:** TypeDoc needs TypeScript ≤ 6 and the repo builds with 7, so it lives in its own package, `tools/typedoc/` (config in `typedoc.json` there). The script installs it first.
  - **Docs required:** every top-level export needs a TSDoc comment, and `{@link}`s must point at exported names. CI runs it with `--treatWarningsAsErrors`.
- `npm run gallery`: re-renders the README gallery into `docs/gallery/` (`tools/gallery.ts`; the seeds are listed there). `node tools/gallery.ts --out <dir> stones:1 meadow:2` renders any sketch:seed list elsewhere.
- CI (`.github/workflows/ci.yml`) runs tests, the build and the docs on every push. `pages.yml` deploys the docs to GitHub Pages from `main`.
- README code blocks are meant to run as written. Keep them in step with the API.

## Conventions
- Strict TS, `verbatimModuleSyntax` (use `import type` for types), and `erasableSyntaxOnly` (no enums or parameter properties).
- Relative imports in `src/` use **`.js` extensions** (`./Polyline.js`) so the emitted `.d.ts` files resolve for consumers.
- Units are **millimetres**. The origin is at the top-left and y points down. Pixels exist only inside `renderToCanvas`.
- Geometry is immutable: `Polyline` copies its input and its methods return new instances. `Sheet` and `Layer` are mutable containers.
- `wtc-math` provides `Vec2`, `Vec3`, `Mat3` and `Mat4`. It is a peer dependency, external in the build; don't re-export it.
- All randomness in a sketch goes through `Random`. Use `random.fork(label)` for independent streams.
- Keep `src/` free of DOM globals. Renderers take a context; the playground owns `document` and `window`.
- Occlusion: draw **front to back**. `sheet.draw()` clips paths against `sheet.mask` and then stamps their silhouette; `sheet.add()` does neither. Mask pixel (i, j) is centred at `((i+0.5)/res, (j+0.5)/res)` mm, and fills default to `nonzero`, as in SVG. Hot loops (the rasteriser, `clipPolyline`) use raw numbers, not `Vec2`.
- Hatching:
  - **Angles:** positive turns clockwise on screen, and 0 gives horizontal lines.
  - **Lattice:** `hatch` and `shade` pin lines to a **page lattice** by default (`anchor: "page"`, `offset` ½ spacing), so shapes hatched alike line up.
  - **Clipping:** clipping to a shape is exact (`ScanlineSweep` or `clipToShape`), never via the mask.
  - **Spirals:** `spiral` shrinks the outline towards a centre, so it is always local and needs a star-shaped outline. Spacing is exact only when the outline has an inscribed circle.
  - **Separate pens for outline and hatch:** draw the outline with `sheet.draw("ink", outline, { silhouette: false })`, then the hatch with `sheet.draw("shade", lines, { silhouette: outline })`.
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
- Plotting (`src/plot/`): `optimize(sheet)` returns a new `Sheet` and never touches the input. It never reorders or mixes layers (a layer is a pen). Each layer starts from home at the page's top-left (0, 0) and returns there, as AxiDraw does. Test helpers shared between test files go in `*.test-util.ts`, which the declaration build excludes.
- New files follow Prettier defaults (80 columns), which is what the editor applies.

## wtc-math gotchas (verified on 1.4.0, pinned by `transforms.test.ts`)
- Mat3 is column-major, with the translation in `a31/a32`. `Vec2.transformByMat3` applies the translation.
- `m.multiply(n)` computes `m × n`, so `n` is applied first. The chained `identity().translate(t).rotate(r)` rotates first.
- `Mat3.fromAngle(θ)` and `Mat3.identity().rotate(θ)` rotate in **opposite** directions. Use the helpers in `src/geometry/transforms.ts`: a positive angle turns clockwise on screen, and `compose(a, b, c)` applies `a` first.

## Roadmap
See `roadmap.md`, which lists phases, status, completion criteria and open decisions. Keep it up to date as phases land.
