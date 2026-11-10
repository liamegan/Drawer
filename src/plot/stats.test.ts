import { describe, expect, it } from "vitest";
import { Sheet } from "../sheet/Sheet.js";
import { Polyline } from "../geometry/Polyline.js";
import { rect } from "../geometry/shapes.js";
import { open, v } from "./ink.test-util.js";
import { pathStats, plotStats } from "./stats.js";

describe("plotStats", () => {
  it("adds up ink, travel, lifts and time per layer, each from home and back", () => {
    const sheet = new Sheet();
    sheet.add("a", open([10, 0], [20, 0]), open([20, 10], [20, 30]));
    sheet.add("b", rect(0, 0, 10, 10), new Polyline([v(5, 5)]));
    const stats = plotStats(sheet, {
      drawSpeed: 10,
      travelSpeed: 20,
      liftTime: 1,
    });
    const [a, b] = stats.layers;
    // a: home → (10,0), draw 10, → (20,10), draw 20, → home.
    expect(a).toMatchObject({ name: "a", paths: 2, points: 4 });
    expect(a.penDown).toBeCloseTo(30, 9);
    expect(a.penUp).toBeCloseTo(10 + 10 + Math.hypot(20, 30), 9);
    expect(a.seconds).toBeCloseTo(30 / 10 + a.penUp / 20 + 2, 9);
    // b: the square starts and ends at home; the lone point draws nothing.
    expect(b).toMatchObject({ name: "b", paths: 1, points: 4, penUp: 0 });
    expect(b.penDown).toBeCloseTo(40, 9);
    expect(stats.penDown).toBeCloseTo(70, 9);
    expect(stats.paths).toBe(3);
    expect(stats.seconds).toBeCloseTo(a.seconds + b.seconds, 9);
  });

  it("starts from `home`, and is zero for nothing", () => {
    const line = [open([10, 0], [20, 0])];
    expect(pathStats(line, { home: v(10, 0) }).penUp).toBeCloseTo(10, 9);
    expect(pathStats([])).toEqual({
      paths: 0,
      points: 0,
      penDown: 0,
      penUp: 0,
      seconds: 0,
    });
    expect(() => pathStats(line, { drawSpeed: 0 })).toThrow(RangeError);
  });
});
