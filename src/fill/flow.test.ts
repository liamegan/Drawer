import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { curlField } from "../field/fields.js";
import { insideTest } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { rect } from "../geometry/shapes.js";
import { Noise } from "../noise/Noise.js";
import { Random } from "../random/Random.js";
import { sdf } from "../sdf/SDF.js";
import { flowHatch } from "./flow.js";

const noise = new Noise(new Random("flow"));
const field = curlField((x, y) =>
  noise.fbm2(x, y, { frequency: 0.04, octaves: 3 }),
);

const blob = new Polyline(
  Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2;
    const r = 22 * (1 + 0.15 * Math.sin(3 * a + 1));
    return new Vec2(30 + Math.cos(a) * r, 30 + Math.sin(a) * r);
  }),
  true,
);

/** Ink length inside x0 ≤ x < x1, by segment midpoints. */
function inkBetween(
  lines: readonly Polyline[],
  x0: number,
  x1: number,
): number {
  let sum = 0;
  for (const line of lines) {
    const pts = line.points;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i].x + pts[i - 1].x) / 2;
      if (mx >= x0 && mx < x1) sum += pts[i].distance(pts[i - 1]);
    }
  }
  return sum;
}

describe("flowHatch", () => {
  it("keeps lines inside the shape and its inset", () => {
    const distance = sdf(blob);
    for (const inset of [0, 1.5]) {
      const lines = flowHatch(blob, { field, spacing: 1, inset });
      expect(lines.length).toBeGreaterThan(10);
      const inside = insideTest(blob);
      for (const line of lines) {
        for (const p of line.points) {
          expect(inside(p.x, p.y) || distance.at(p.x, p.y) > -1e-6).toBe(true);
          expect(distance.at(p.x, p.y)).toBeLessThan(-inset + 0.02 + 1e-6);
        }
      }
    }
  });

  it("covers about `tone` of the paper", () => {
    const square = rect(0, 0, 50, 50);
    for (const tone of [0.15, 0.3, 0.5]) {
      const lines = flowHatch(square, { field, tone, pen: 0.3 });
      const coverage = (0.3 * inkBetween(lines, -1, 51)) / 2500;
      expect(coverage / tone).toBeGreaterThan(0.9);
      expect(coverage / tone).toBeLessThan(1.15);
    }
  });

  it("crowds lines where a tone field is dark, and leaves light areas bare", () => {
    const square = rect(0, 0, 60, 30);
    const lines = flowHatch(square, {
      field,
      tone: (x) => x / 60,
      pen: 0.3,
    });
    const light = inkBetween(lines, 5, 20);
    const dark = inkBetween(lines, 40, 55);
    expect(dark).toBeGreaterThan(2.5 * light);
    // Lighter than pen / maxSpacing (0.075, so x < 4.5): no lines.
    for (const line of lines) {
      for (const p of line.points) expect(p.x).toBeGreaterThan(4.5 - 0.6);
    }
    expect(flowHatch(square, { field, tone: 0.05, pen: 0.3 })).toEqual([]);
  });

  it("draws dashes with maxLength, and checks its options", () => {
    const dashes = flowHatch(blob, { field, spacing: 1.2, maxLength: 5 });
    for (const d of dashes) expect(d.length).toBeLessThanOrEqual(5 + 1e-9);
    expect(dashes.length).toBeGreaterThan(50);
    expect(() => flowHatch(blob, { field })).toThrow(RangeError);
    expect(() => flowHatch(blob, { field, spacing: -1 })).toThrow(RangeError);
    expect(() => flowHatch(blob, { field, tone: 0.5, pen: 0 })).toThrow(
      RangeError,
    );
    expect(flowHatch([], { field, spacing: 1 })).toEqual([]);
  });
});
