import { describe, expect, it } from "vitest";
import { Sheet } from "../sheet/Sheet.js";
import { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { contourSpiral } from "../fill/contourSpiral.js";
import { hatch } from "../fill/hatch.js";
import { Random } from "../random/Random.js";
import { inkDistance, inkLength, v } from "./ink.test-util.js";
import { optimize, optimizePaths } from "./optimize.js";
import { plotStats } from "./stats.js";

/** A small occluded drawing on two pens, like the playground sketches. */
function drawing(): Sheet {
  const sheet = new Sheet({ margin: 10, occlusion: { gap: 0.2 } });
  sheet.layer("ink", { color: "#111", width: 0.3 });
  sheet.layer("shade", { color: "#555", width: 0.25 });
  const random = new Random("optimize");
  for (let k = 0; k < 12; k++) {
    const c = random.pointIn(sheet.drawArea.inset(20));
    const outline = circle(c, random.range(6, 18));
    sheet.draw("ink", outline, { silhouette: false });
    sheet.draw("shade", hatch(outline, { spacing: 0.8, angle: k }), {
      silhouette: outline,
    });
  }
  // Touching frames share edges.
  for (let i = 0; i < 4; i++) sheet.add("ink", rect(20 + i * 10, 250, 10, 10));
  return sheet;
}

describe("optimize", () => {
  it("keeps the sheet, layers and pens, and leaves the input alone", () => {
    const sheet = drawing();
    const before = sheet.layers.map((l) => [...l.paths]);
    const out = optimize(sheet);
    expect(out).not.toBe(sheet);
    expect(out.paper).toEqual(sheet.paper);
    expect(out.margin).toBe(sheet.margin);
    expect(out.layers.map((l) => [l.name, l.pen])).toEqual(
      sheet.layers.map((l) => [l.name, l.pen]),
    );
    sheet.layers.forEach((l, i) => expect(l.paths).toEqual(before[i]));
  });

  it("draws the same ink with far less travel and fewer lifts", () => {
    const sheet = drawing();
    const out = optimize(sheet);
    sheet.layers.forEach((layer, i) => {
      const paths = out.layers[i].paths;
      // Every bit of ink is still drawn, and nothing new is.
      expect(inkDistance(layer.paths, paths)).toBeLessThan(0.06);
      expect(inkDistance(paths, layer.paths)).toBeLessThan(0.06);
      expect(inkLength(paths)).toBeLessThanOrEqual(
        inkLength(layer.paths) + 1e-6,
      );
    });
    const raw = plotStats(sheet);
    const plotted = plotStats(out);
    // Hatching already zigzags within each disc, so the gain is mostly in
    // the order of the shapes and outlines.
    expect(plotted.penUp).toBeLessThan(raw.penUp * 0.75);
    expect(plotted.layers[0].penUp).toBeLessThan(raw.layers[0].penUp * 0.6);
    expect(plotted.paths).toBeLessThanOrEqual(raw.paths);
    expect(plotted.seconds).toBeLessThan(raw.seconds);
    // The shared frame edges are drawn once: three of 10 mm each.
    expect(raw.layers[0].penDown - plotted.layers[0].penDown).toBeGreaterThan(
      29,
    );
  });

  it("turns a contour spiral's there-and-back centre lines into single strokes", () => {
    // A U's arms are too thin for their last turn, which runs up the middle
    // and back.
    const u = new Polyline(
      [
        v(5, 5),
        v(55, 5),
        v(55, 55),
        v(41, 55),
        v(41, 19),
        v(19, 19),
        v(19, 55),
        v(5, 55),
      ],
      true,
    );
    const strokes = contourSpiral(u, { spacing: 1.5 });
    const out = optimizePaths(strokes);
    expect(inkLength(out)).toBeLessThan(inkLength(strokes) - 30);
    expect(inkDistance(strokes, out)).toBeLessThan(0.06);
  });

  it("lets each step be turned off", () => {
    const sheet = drawing();
    const paths = sheet.layers[1].paths;
    expect(
      optimizePaths(paths, {
        simplify: false,
        dedupe: false,
        merge: false,
        sort: false,
      }),
    ).toEqual(paths);
  });
});
