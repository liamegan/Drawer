import { Vec2 } from "wtc-math";
import {
  circle,
  clipToShape,
  hatch,
  paper,
  polygon,
  Polyline,
  rect,
  shade,
  sine,
  spiral,
  toneSpacing,
} from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/**
 * A pen calibration sheet. Plot it with the pen you mean to use to see what
 * each tone looks like on paper. Tone runs from 0.1 to 1 across each row of
 * swatches:
 * 1. straight hatching, spaced by `toneSpacing`
 * 2. cross-hatching with `shade`
 * 3. sine hatching
 * 4. joined zigzag hatching in circles
 * 5. spirals in hexagons
 * 6. at one tone, concentric circles (left of each pair) against a spiral
 *    (right) in a triangle, square, pentagon, hexagon and octagon
 * 7. at one tone, spirals where the spacing is exact (a scalene triangle, a
 *    right triangle, a rhombus, a kite, a circle) and where it only averages
 *    out (a rectangle, an irregular pentagon, a star), then concentric rings
 *    in a square and a star
 * 8. a cross-hatched tone gradient (a tone field)
 * 9. a single-pass dithered gradient, which shows how lines drop out
 * 10. page-anchored (left) and locally anchored (right) hatching on touching
 *     squares. The page lattice carries straight across; local leaves seams.
 */
const sketch: Sketch = {
  title: "Hatch swatches",
  paper: paper.A4,
  margin: 15,
  paperColor: "#f4f1ea",

  // No randomness: the sheet is the same for every seed.
  draw(doc) {
    const area = doc.drawArea;

    // Two pens. The frames show each swatch's true outline in a light pen;
    // the hatching goes on the pen being calibrated. Its width is what
    // `toneSpacing` and `shade` use to turn tone into line spacing.
    const frames = doc.layer("frames", { color: "#8a8478", width: 0.2 });
    const ink = doc.layer("hatch", { color: "#1b1b1b", width: 0.3 });
    const pen = ink.pen.width;

    // A grid of square cells, ten to a row, filling the width of the page.
    // `y` is the top of the next row, moved down as each row is drawn.
    const columns = 10;
    const gap = 2;
    const size = (area.width - gap * (columns - 1)) / columns;
    const rowGap = 7;
    let y = area.y;

    // --- Swatch shapes ------------------------------------------------------

    /** Makes the shape for column `i`, given the cell's top-left corner. */
    type Cell = (x: number, y: number, i: number) => Polyline;
    /** The whole cell. */
    const square: Cell = (x, y) => rect(x, y, size, size);
    /** The largest circle that fits the cell. */
    const disc: Cell = (x, y) =>
      circle(new Vec2(x + size / 2, y + size / 2), size / 2);
    /**
     * A regular polygon filling the cell, standing on a flat edge. Its first
     * vertex is the bottom-left corner, which is where spirals start.
     */
    const ngon =
      (sides: number): Cell =>
      (x, y) =>
        polygon(
          new Vec2(x + size / 2, y + size / 2),
          size / 2,
          sides,
          Math.PI / 2 + Math.PI / sides,
        );
    /** A closed shape from points given as fractions of the cell (0–1). */
    const unit =
      (...pts: [number, number][]): Cell =>
      (x, y) =>
        new Polyline(
          pts.map(([u, v]) => new Vec2(x + u * size, y + v * size)),
          true,
        );
    /**
     * A five-pointed star: concave, but every point of it can be seen from
     * its centre, so it can still be spiralled. Nudged down a little so it
     * sits in the middle of the cell.
     */
    const star: Cell = (x, y) =>
      new Polyline(
        Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = (i % 2 === 0 ? 0.5 : 0.22) * size; // tips, then notches
          return new Vec2(
            x + size / 2 + Math.cos(a) * r,
            y + size * 0.55 + Math.sin(a) * r,
          );
        }),
        true,
      );

    /**
     * Draws one row of ten swatches. Column `i` gets tone (i + 1) / 10, so
     * tones run 0.1 to 1 left to right. `cell` makes each swatch's shape,
     * which goes on the frames pen; `fill` returns the lines that fill it.
     * Rows that compare shapes at a single tone ignore `tone` and use `i`.
     */
    const swatchRow = (
      fill: (shape: Polyline, tone: number, i: number) => Polyline[],
      cell: Cell = square,
    ) => {
      for (let i = 0; i < columns; i++) {
        const tone = (i + 1) / columns;
        const x = area.x + i * (size + gap);
        const shape = cell(x, y, i);
        frames.add(shape);
        ink.add(...fill(shape, tone, i));
      }
      y += size + rowGap;
    };

    // Line spacing for a tone, rounded so every tone shares lines with the
    // lightest one on the page lattice. 0 means too light for any lines.
    const spacingFor = (tone: number) => toneSpacing(tone, { pen }) ?? 0;

    // --- Parallel hatching --------------------------------------------------

    // 1. Straight lines at 45°: the plain tone ramp.
    swatchRow((shape, tone) =>
      spacingFor(tone)
        ? hatch(shape, { spacing: spacingFor(tone), angle: Math.PI / 4 })
        : [],
    );

    // 2. Cross-hatching: `shade` adds passes at new angles as the tone
    //    passes 0.4, 0.65 and 0.85, so the ramp changes texture as it darkens.
    swatchRow((shape, tone) => shade(shape, { tone, pen }));

    // 3. Sine waves. The amplitude scales with the spacing so neighbouring
    //    waves never touch; the phase comes from page position, so the waves
    //    line up from one swatch to the next.
    swatchRow((shape, tone) => {
      const spacing = spacingFor(tone);
      if (!spacing) return [];
      return hatch(shape, {
        spacing,
        style: sine({ amplitude: spacing * 0.3, wavelength: 3 }),
      });
    });

    // 4. Joined zigzags at 30° in circles: line ends are linked into long
    //    strokes, breaking only where a link would be too long.
    swatchRow(
      (shape, tone) =>
        spacingFor(tone)
          ? hatch(shape, {
              spacing: spacingFor(tone),
              angle: Math.PI / 6,
              join: true,
            })
          : [],
      disc,
    );

    // --- Spirals ------------------------------------------------------------

    // Spirals are centred on their own shape, so their spacing needn't sit on
    // the page lattice's ladder.
    const spiralSpacing = (tone: number) =>
      toneSpacing(tone, { pen, aligned: false }) ?? 0;

    // 5. Spiral tone ramp in hexagons.
    swatchRow(
      (shape, tone) =>
        spiralSpacing(tone)
          ? spiral(shape, { spacing: spiralSpacing(tone) })
          : [],
      ngon(6),
    );

    // 6. Concentric circles against spirals, in pairs, at one tone. Each pair
    //    shares a polygon: columns 0–1 a triangle, 2–3 a square, and so on.
    //    Circles bigger than the polygon's inscribed circle are cut into arcs
    //    in the corners, which is the unevenness spirals avoid.
    const pairSides = [3, 4, 5, 6, 8];
    const fixed = spiralSpacing(0.4);
    swatchRow(
      (shape, _tone, i) => {
        if (i % 2 === 1) return spiral(shape, { spacing: fixed });
        // Circles around the polygon's centre (the mean of its vertices),
        // from half a spacing out to the corners, cut to the polygon.
        const pts = shape.points;
        const c = new Vec2(
          pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
          pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
        );
        const out: Polyline[] = [];
        for (let r = fixed / 2; r < size / 2; r += fixed) {
          out.push(...clipToShape(circle(c, r), shape));
        }
        return out;
      },
      (x, y, i) => ngon(pairSides[i >> 1])(x, y, i),
    );

    // 7. Where spirals are exact, and where they aren't, at one tone.
    const shapes: Cell[] = [
      // Exact: every one of these has an inscribed circle.
      unit([0.04, 0.94], [0.96, 0.86], [0.3, 0.06]), // scalene triangle
      unit([0.08, 0.06], [0.08, 0.94], [0.92, 0.94]), // right triangle
      unit([0.5, 0.02], [0.82, 0.5], [0.5, 0.98], [0.18, 0.5]), // rhombus
      unit([0.5, 0.02], [0.92, 0.34], [0.5, 0.98], [0.08, 0.34]), // kite
      disc,
      // Averaged: tighter on edges near the centre, looser on far ones.
      unit([0.02, 0.3], [0.98, 0.3], [0.98, 0.7], [0.02, 0.7]), // rectangle
      unit([0.1, 0.2], [0.7, 0.04], [0.96, 0.55], [0.6, 0.96], [0.04, 0.7]), // irregular pentagon
      star,
      // Rings instead of a spiral (see the `rings` option below).
      ngon(4),
      star,
    ];
    swatchRow(
      (shape, _tone, i) => spiral(shape, { spacing: fixed, rings: i >= 8 }),
      (x, y, i) => shapes[i](x, y, i),
    );

    // --- Tone fields --------------------------------------------------------

    // 8–9. Gradients across the full width, with tone rising left to right.
    //   The first bar is cross-hatched with every pass; the second uses one
    //   horizontal pass, so you can see how dithered lines start and stop as
    //   the tone changes.
    const ramp = (x: number) => (x - area.x) / area.width;
    for (const single of [false, true]) {
      const bar = rect(area.x, y, area.width, size);
      frames.add(bar);
      ink.add(
        ...shade(bar, {
          tone: (x) => ramp(x),
          pen,
          ...(single ? { angles: [0], thresholds: [0] } : {}),
        }),
      );
      y += size + rowGap;
    }

    // --- Anchoring ----------------------------------------------------------

    // 10. Page versus local anchoring on touching squares. Two groups of four
    //     squares, each stepped 1.7 mm lower than the last so their centres
    //     land at different places across the lines. The left group uses the page
    //     lattice, so lines run straight on from square to square. The right
    //     group centres each square's lines on itself, so they jump at every
    //     join.
    const block = (area.width - 10) / 2;
    const side = block / 4;
    for (const [group, anchor] of [
      [0, "page"],
      [1, "local"],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        const x = area.x + group * (block + 10) + i * side;
        const square = rect(x, y + i * 1.7, side, side);
        frames.add(square);
        ink.add(...hatch(square, { spacing: 1.6, angle: 0.5, anchor }));
      }
    }
  },
};

export default sketch;
