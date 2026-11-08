import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Random } from "../random/Random.js";
import { segmentCrossings, shapeEdges, windingAt } from "./clip.js";
import { Polyline } from "./Polyline.js";
import { Region } from "./region.js";
import { circle, rect } from "./shapes.js";

const v = (x: number, y: number) => new Vec2(x, y);

const pentagram = new Polyline(
  Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    return v(30 + Math.cos(a) * 20, 30 + Math.sin(a) * 20);
  }),
  true,
);

function blob(random: Random): Polyline {
  const n = random.int(5, 40);
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = random.range(5, 25);
      return v(30 + Math.cos(a) * r, 30 + Math.sin(a) * r);
    }),
    true,
  );
}

describe("Region", () => {
  it("gives the same winding numbers as windingAt", () => {
    const random = new Random("region");
    const cases = [
      [pentagram],
      [rect(0, 0, 40, 40), rect(20, 20, 40, 40)],
      [circle(v(30, 30), 20), circle(v(30, 30), 8).reversed()],
      [blob(random), blob(random)],
    ];
    for (const shapes of cases) {
      const region = new Region(shapes);
      const edges = shapeEdges(shapes);
      for (let k = 0; k < 2000; k++) {
        const x = random.range(-5, 65);
        const y = random.range(-5, 65);
        expect(region.winding(x, y)).toBe(windingAt(edges, x, y));
      }
    }
  });

  it("applies the fill rule", () => {
    expect(new Region(pentagram).contains(30, 30)).toBe(true);
    expect(new Region(pentagram, "evenodd").contains(30, 30)).toBe(false);
  });

  it("finds where a step leaves the region", () => {
    const random = new Random("exit");
    const shapes = [blob(random), rect(10, 10, 20, 30)];
    const region = new Region(shapes);
    const edges = shapeEdges(shapes);
    let exits = 0;
    for (let k = 0; k < 3000; k++) {
      const px = random.range(0, 60);
      const py = random.range(0, 60);
      if (!region.contains(px, py)) continue;
      const a = random.range(0, Math.PI * 2);
      const length = random.range(0.1, 8);
      const qx = px + Math.cos(a) * length;
      const qy = py + Math.sin(a) * length;
      const t = region.exit(px, py, qx, qy);
      // Brute force: the first crossing after which the step is outside.
      const ts: number[] = [];
      segmentCrossings(edges, px, py, qx, qy, ts);
      ts.sort((p, q) => p - q);
      const outsideAfter = (s: number) => {
        const u = Math.min(1, s + 1e-9);
        return windingAt(edges, px + (qx - px) * u, py + (qy - py) * u) === 0;
      };
      const expected = ts.find(outsideAfter) ?? -1;
      if (expected >= 0) exits++;
      expect(t).toBeCloseTo(expected, 9);
    }
    expect(exits).toBeGreaterThan(100);
  });

  it("handles steps that start exactly on an edge", () => {
    // Two overlapping squares under nonzero: x = 30 is an inner edge.
    const region = new Region([rect(0, 0, 30, 30), rect(15, 15, 30, 30)]);
    expect(region.exit(30, 22.5, 30.25, 22.5)).toBe(-1);
    expect(region.exit(29.75, 22.5, 30, 22.5)).toBe(-1);
    // On the outer edge, heading out: leaves at once.
    expect(region.exit(45, 22.5, 45.25, 22.5)).toBe(0);
    expect(region.exit(44.75, 22.5, 45.25, 22.5)).toBeCloseTo(0.5, 12);
  });

  it("is empty for no shapes", () => {
    const region = new Region([]);
    expect(region.bounds).toBeNull();
    expect(region.contains(0, 0)).toBe(false);
  });
});
