import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Bounds } from "./Bounds.js";
import {
  clipPolyline,
  clipToShape,
  insideTest,
  outsideBounds,
  shapeContains,
  type HiddenTest,
} from "./clip.js";
import { Polyline } from "./Polyline.js";
import { line, rect } from "./shapes.js";

const v = (x: number, y: number) => new Vec2(x, y);
const coords = (p: Polyline) => p.points.map((q) => [q.x, q.y]);
const expectPoint = (p: Vec2 | undefined, x: number, y: number) => {
  expect(p).toBeDefined();
  expect(p!.x).toBeCloseTo(x, 4);
  expect(p!.y).toBeCloseTo(y, 4);
};
const band =
  (...ranges: [number, number][]): HiddenTest =>
  (x) =>
    ranges.some(([a, b]) => x >= a && x <= b);

describe("clipPolyline", () => {
  it("splits a line around a hidden stretch with exact cut points", () => {
    const pieces = clipPolyline(line(v(0, 0), v(10, 0)), band([3, 6]));
    expect(pieces).toHaveLength(2);
    expectPoint(pieces[0].start, 0, 0);
    expectPoint(pieces[0].end, 3, 0);
    expectPoint(pieces[1].start, 6, 0);
    expectPoint(pieces[1].end, 10, 0);
    expect(pieces.every((p) => !p.closed)).toBe(true);
  });

  it("finds cut points on a curved boundary", () => {
    const disc: HiddenTest = (x, y) => Math.hypot(x - 5, y - 1) < 2;
    const pieces = clipPolyline(line(v(0, 0), v(10, 2)), disc);
    expect(pieces).toHaveLength(2);
    for (const cut of [pieces[0].end!, pieces[1].start!]) {
      expect(Math.hypot(cut.x - 5, cut.y - 1)).toBeCloseTo(2, 4);
    }
  });

  it("keeps the vertices inside a visible run", () => {
    const path = new Polyline([v(0, 0), v(10, 0), v(10, 10)]);
    const pieces = clipPolyline(path, (_x, y) => y > 5);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].pointCount).toBe(3);
    expectPoint(pieces[0].points[1], 10, 0);
    expectPoint(pieces[0].end, 10, 5);
  });

  it("returns an untouched path as itself, still closed", () => {
    const square = rect(0, 0, 10, 10);
    const pieces = clipPolyline(square, () => false);
    expect(pieces).toEqual([square]);
    expect(pieces[0]).toBe(square);
  });

  it("returns nothing for a fully hidden path or one with under two points", () => {
    expect(clipPolyline(rect(0, 0, 10, 10), () => true)).toEqual([]);
    expect(clipPolyline(new Polyline([v(1, 1)]), () => false)).toEqual([]);
  });

  it("joins the run that wraps through the start of a closed path", () => {
    const pieces = clipPolyline(rect(0, 0, 10, 10), (x) => x > 8);
    expect(pieces).toHaveLength(1);
    const [piece] = pieces;
    expect(piece.closed).toBe(false);
    expect(piece.length).toBeCloseTo(26, 4);
    const pts = coords(piece);
    expect(pts[0][0]).toBeCloseTo(8, 4);
    expect(pts[0][1]).toBeCloseTo(10, 4);
    expect(pts.at(-1)![0]).toBeCloseTo(8, 4);
    expect(pts.at(-1)![1]).toBeCloseTo(0, 4);
  });

  it("does not join runs on a closed path whose start is hidden", () => {
    const pieces = clipPolyline(rect(0, 0, 10, 10), (x, y) => x < 2 && y < 2);
    expect(pieces).toHaveLength(1);
    expectPoint(pieces[0].start, 2, 0);
    expectPoint(pieces[0].end, 0, 2);
  });

  it("drops clipped pieces shorter than minLength", () => {
    const path = line(v(0, 0), v(10, 0));
    expect(clipPolyline(path, band([0.1, 10]))).toEqual([]);
    expect(clipPolyline(path, band([0.1, 10]), { minLength: 0 })).toHaveLength(1);
  });

  it("stopOnCollide returns only the visible prefix", () => {
    const path = line(v(0, 0), v(10, 0));
    const pieces = clipPolyline(path, band([3, 4], [6, 7]), { stopOnCollide: true });
    expect(pieces).toHaveLength(1);
    expectPoint(pieces[0].end, 3, 0);
    expect(clipPolyline(path, band([-1, 1]), { stopOnCollide: true })).toEqual([]);
    expect(clipPolyline(path, () => false, { stopOnCollide: true })).toEqual([path]);
  });

  it("finds hidden stretches longer than the step, but not shorter ones", () => {
    const path = line(v(0, 0), v(10, 0));
    expect(clipPolyline(path, band([5, 5.6]), { step: 0.5 })).toHaveLength(2);
    expect(clipPolyline(path, band([5.1, 5.2]), { step: 0.5 })).toHaveLength(1);
  });

  it("rejects a non-positive step", () => {
    expect(() => clipPolyline(line(v(0, 0), v(1, 0)), () => false, { step: 0 })).toThrow(RangeError);
  });
});

describe("outsideBounds", () => {
  it("hides points outside the bounds, keeping the edge", () => {
    const outside = outsideBounds(Bounds.fromRect(0, 0, 10, 5));
    expect(outside(5, 2)).toBe(false);
    expect(outside(10, 5)).toBe(false);
    expect(outside(-0.1, 2)).toBe(true);
    expect(outside(5, 5.1)).toBe(true);
  });
});

/** A U shape opening downwards: arms at x 0–3 and 7–10, joined along the top. */
const uShape = () =>
  new Polyline(
    [
      v(0, 0),
      v(10, 0),
      v(10, 10),
      v(7, 10),
      v(7, 3),
      v(3, 3),
      v(3, 10),
      v(0, 10),
    ],
    true,
  );

describe("shapeContains / insideTest", () => {
  it("tests a concave shape", () => {
    expect(shapeContains(uShape(), 1, 5)).toBe(true);
    expect(shapeContains(uShape(), 5, 5)).toBe(false);
    expect(shapeContains(uShape(), 5, 1)).toBe(true);
    expect(shapeContains(uShape(), 11, 5)).toBe(false);
  });

  it("combines rings by rule and ignores open paths", () => {
    const outer = rect(0, 0, 10, 10);
    const inner = rect(3, 3, 4, 4);
    expect(insideTest([outer, inner])(5, 5)).toBe(true);
    expect(insideTest([outer, inner.reversed()])(5, 5)).toBe(false);
    expect(insideTest([outer, inner], "evenodd")(5, 5)).toBe(false);
    expect(insideTest([outer, inner], "evenodd")(1, 1)).toBe(true);
    expect(insideTest(line(v(0, 0), v(10, 10)))(5, 5)).toBe(false);
  });
});

describe("clipToShape", () => {
  it("cuts a line exactly where it crosses a concave shape", () => {
    const pieces = clipToShape(line(v(-5, 6), v(15, 6)), uShape());
    expect(pieces).toHaveLength(2);
    expect(coords(pieces[0])).toEqual([
      [0, 6],
      [3, 6],
    ]);
    expect(coords(pieces[1])).toEqual([
      [7, 6],
      [10, 6],
    ]);
  });

  it("keeps vertices, and returns a path entirely inside as itself", () => {
    const zig = new Polyline([v(-2, 1), v(5, 2), v(12, 1)]);
    const [piece] = clipToShape(zig, rect(0, 0, 10, 10));
    expect(piece.pointCount).toBe(3);
    expect(piece.start!.x).toBeCloseTo(0, 9);
    expectPoint(piece.points[1], 5, 2);
    expect(piece.end!.x).toBeCloseTo(10, 9);
    const inside = new Polyline([v(1, 1), v(9, 9)]);
    expect(clipToShape(inside, rect(0, 0, 10, 10))).toEqual([inside]);
  });

  it("joins the run that wraps through the start of a closed path", () => {
    const loop = new Polyline([v(5, 2), v(15, 2), v(15, 8), v(5, 8)], true);
    const pieces = clipToShape(loop, rect(0, 0, 10, 10));
    expect(pieces).toHaveLength(1);
    expect(coords(pieces[0])).toEqual([
      [10, 8],
      [5, 8],
      [5, 2],
      [10, 2],
    ]);
  });

  it("returns nothing for a line that only touches a corner", () => {
    expect(clipToShape(line(v(5, 15), v(15, 5)), rect(0, 0, 10, 10))).toEqual(
      [],
    );
  });

  it("respects the fill rule and minLength", () => {
    const shapes = [rect(0, 0, 10, 10), rect(3, 3, 4, 4)];
    const across = line(v(-1, 5), v(11, 5));
    expect(clipToShape(across, shapes)).toHaveLength(1);
    expect(clipToShape(across, shapes, { rule: "evenodd" })).toHaveLength(2);
    const nick = line(v(-1, 5), v(0.1, 5));
    expect(clipToShape(nick, shapes)).toEqual([]);
    expect(clipToShape(nick, shapes, { minLength: 0 })).toHaveLength(1);
  });
});
