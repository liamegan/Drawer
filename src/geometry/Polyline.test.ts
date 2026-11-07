import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Bounds } from "./Bounds.js";
import { Polyline } from "./Polyline.js";
import { translation } from "./transforms.js";

const square = () =>
  new Polyline([new Vec2(0, 0), new Vec2(10, 0), new Vec2(10, 10), new Vec2(0, 10)], true);

describe("Polyline", () => {
  it("measures length, including the closing segment only when closed", () => {
    const open = new Polyline(square().points, false);
    expect(open.length).toBeCloseTo(30);
    expect(square().length).toBeCloseTo(40);
  });

  it("counts segments", () => {
    expect(square().segmentCount).toBe(4);
    expect(new Polyline(square().points).segmentCount).toBe(3);
    expect(new Polyline([new Vec2(1, 1)]).segmentCount).toBe(0);
  });

  it("reports bounds, start and end", () => {
    const p = new Polyline([new Vec2(-5, 2), new Vec2(3, 8), new Vec2(1, -4)]);
    const b = p.bounds;
    expect([b.min.x, b.min.y, b.max.x, b.max.y]).toEqual([-5, -4, 3, 8]);
    expect(p.start?.x).toBe(-5);
    expect(p.end?.y).toBe(-4);
  });

  it("copies its input, so mutating the source points doesn't affect it", () => {
    const pts = [new Vec2(0, 0), new Vec2(1, 0)];
    const p = new Polyline(pts);
    pts[0].x = 99;
    pts.push(new Vec2(5, 5));
    expect(p.points[0].x).toBe(0);
    expect(p.pointCount).toBe(2);
    expect(Object.isFrozen(p.points)).toBe(true);
  });

  it("transform, translate and reversed return new polylines and leave the original unchanged", () => {
    const p = square();
    const moved = p.transform(translation(5, 5));
    const shifted = p.translate(new Vec2(1, 2));
    const rev = p.reversed();

    expect(moved).not.toBe(p);
    expect(moved.points[0].x).toBe(5);
    expect(shifted.points[2].y).toBe(12);
    expect(rev.points[0].y).toBe(10);
    expect(rev.closed).toBe(true);
    // original untouched
    expect(p.points[0].x).toBe(0);
    expect(p.points[3].y).toBe(10);
  });

  it("close() returns a closed copy", () => {
    const open = new Polyline(square().points);
    expect(open.close().closed).toBe(true);
    expect(open.closed).toBe(false);
  });
});

describe("Bounds", () => {
  it("normalises min/max regardless of argument order", () => {
    const b = new Bounds(new Vec2(10, 10), new Vec2(0, 5));
    expect([b.x, b.y, b.width, b.height]).toEqual([0, 5, 10, 5]);
  });

  it("insets per axis and never inverts", () => {
    const b = Bounds.fromRect(0, 0, 100, 50).inset(10, 5);
    expect([b.x, b.y, b.width, b.height]).toEqual([10, 5, 80, 40]);
    const collapsed = Bounds.fromRect(0, 0, 10, 10).inset(20);
    expect([collapsed.width, collapsed.height]).toEqual([0, 0]);
    expect(collapsed.center.x).toBe(5);
  });

  it("contains, union and at", () => {
    const a = Bounds.fromRect(0, 0, 10, 10);
    expect(a.contains(new Vec2(10, 10))).toBe(true);
    expect(a.contains(new Vec2(10.01, 5))).toBe(false);
    const u = a.union(Bounds.fromRect(20, -5, 5, 5));
    expect([u.x, u.y, u.width, u.height]).toEqual([0, -5, 25, 15]);
    const mid = a.at(0.5, 0.25);
    expect([mid.x, mid.y]).toEqual([5, 2.5]);
  });

  it("fromPoints rejects an empty list", () => {
    expect(() => Bounds.fromPoints([])).toThrow(RangeError);
  });
});
