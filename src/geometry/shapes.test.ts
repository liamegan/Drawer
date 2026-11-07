import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Bounds } from "./Bounds.js";
import { circle, circleSegments, line, polygon, rect } from "./shapes.js";

describe("shapes", () => {
  it("line is an open two-point polyline", () => {
    const l = line(new Vec2(0, 0), new Vec2(3, 4));
    expect(l.closed).toBe(false);
    expect(l.length).toBeCloseTo(5);
  });

  it("rect accepts numbers or Bounds and is closed", () => {
    const a = rect(1, 2, 10, 20);
    const b = rect(Bounds.fromRect(1, 2, 10, 20));
    expect(a.closed).toBe(true);
    expect(a.pointCount).toBe(4);
    expect(a.length).toBeCloseTo(60);
    expect(b.points.map((p) => [p.x, p.y])).toEqual(a.points.map((p) => [p.x, p.y]));
  });

  it("polygon has one vertex per side, all at the radius", () => {
    const c = new Vec2(5, 5);
    const hex = polygon(c, 10, 6);
    expect(hex.closed).toBe(true);
    expect(hex.pointCount).toBe(6);
    for (const p of hex.points) expect(p.distance(c)).toBeCloseTo(10);
    expect(() => polygon(c, 1, 2)).toThrow(RangeError);
  });

  it("circle picks enough segments to stay within tolerance", () => {
    const r = 50;
    const tol = 0.02;
    const n = circleSegments(r, tol);
    // the sagitta of each chord must be inside the tolerance
    expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(tol);
    // and one fewer segment would not be
    expect(r * (1 - Math.cos(Math.PI / (n - 1)))).toBeGreaterThan(tol);
    expect(circle(new Vec2(0, 0), r).pointCount).toBe(n);
  });

  it("circle never goes below 8 segments and honours an explicit count", () => {
    expect(circleSegments(0.01)).toBe(8);
    expect(circle(new Vec2(0, 0), 10, { segments: 5 }).pointCount).toBe(5);
  });
});
