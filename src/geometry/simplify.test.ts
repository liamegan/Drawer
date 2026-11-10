import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Random } from "../random/Random.js";
import { Polyline } from "./Polyline.js";
import { circle, rect } from "./shapes.js";
import { segmentDistance, simplify, smooth } from "./simplify.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** Largest distance from any point of `from` to the path `to`. */
function deviation(from: Polyline, to: Polyline): number {
  const q = to.points;
  const segments = to.closed ? q.length : q.length - 1;
  let worst = 0;
  for (const p of from.points) {
    let best = Infinity;
    for (let i = 0; i < segments; i++) {
      const a = q[i];
      const b = q[(i + 1) % q.length];
      best = Math.min(best, segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

function wiggle(random: Random, closed: boolean): Polyline {
  const n = 400;
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = 10 + Math.sin(a * 5) * 2 + random.range(-0.05, 0.05);
      return closed ? v(Math.cos(a) * r, Math.sin(a) * r) : v(i * 0.1, r);
    }),
    closed,
  );
}

describe("simplify", () => {
  it("keeps every original point within the tolerance", () => {
    const random = new Random("simplify");
    for (const closed of [false, true]) {
      const path = wiggle(random, closed);
      for (const tol of [0.01, 0.05, 0.3]) {
        const out = simplify(path, tol);
        expect(out.closed).toBe(closed);
        expect(out.pointCount).toBeLessThan(path.pointCount);
        expect(deviation(path, out)).toBeLessThanOrEqual(tol + 1e-12);
      }
    }
  });

  it("keeps the end points of open paths", () => {
    const path = wiggle(new Random("ends"), false);
    const out = simplify(path, 1);
    expect(out.start!.distance(path.start!)).toBe(0);
    expect(out.end!.distance(path.end!)).toBe(0);
  });

  it("reduces straight runs to their corners", () => {
    const pts: Vec2[] = [];
    for (let i = 0; i < 10; i++) pts.push(v(i, 0));
    for (let i = 0; i < 10; i++) pts.push(v(10, i));
    for (let i = 0; i < 10; i++) pts.push(v(10 - i, 10));
    for (let i = 0; i < 10; i++) pts.push(v(0, 10 - i));
    const out = simplify(new Polyline(pts, true), 1e-9);
    expect(out.pointCount).toBe(4);
    expect(out.closed).toBe(true);
  });

  it("returns thin rings unchanged rather than collapsing them", () => {
    const sliver = new Polyline([v(0, 0), v(10, 0.001), v(20, 0)], true);
    expect(simplify(sliver, 0.1)).toBe(sliver);
  });

  it("returns the path itself when nothing can go", () => {
    const square = rect(0, 0, 5, 5);
    expect(simplify(square, 0.01)).toBe(square);
  });
});

describe("smooth", () => {
  it("doubles the points of a closed path each pass and stays near it", () => {
    const square = rect(0, 0, 10, 10);
    const once = smooth(square);
    expect(once.pointCount).toBe(8);
    expect(once.closed).toBe(true);
    expect(smooth(square, 3).pointCount).toBe(32);
    expect(deviation(once, square)).toBeLessThan(1e-12);
  });

  it("keeps the end points of open paths", () => {
    const path = new Polyline([v(0, 0), v(5, 5), v(10, 0)]);
    const out = smooth(path, 2);
    expect(out.start!.distance(path.start!)).toBe(0);
    expect(out.end!.distance(path.end!)).toBe(0);
  });

  it("barely moves a fine circle", () => {
    const c = circle(v(0, 0), 10);
    const out = smooth(c, 2);
    for (const p of out.points) expect(Math.abs(p.length - 10)).toBeLessThan(0.02);
  });
});
