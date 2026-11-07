import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { circle, polygon, rect } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { spiral } from "./spiral.js";

const v = (x: number, y: number) => new Vec2(x, y);
const closed = (...pts: [number, number][]) =>
  new Polyline(
    pts.map(([x, y]) => v(x, y)),
    true,
  );

/** A five-pointed star outline: concave, but every point is visible from its centre. */
const star = new Polyline(
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 15 : 7;
    return v(20 + Math.cos(a) * r, 20 + Math.sin(a) * r);
  }),
  true,
);

/** A U shape: no point inside sees all of it. */
const uShape = closed([0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]);

/** Signed distance of p inside the line through a → b, for a shape whose inside is at `inside`. */
function depth(p: Vec2, a: Vec2, b: Vec2, inside: Vec2): number {
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const len = Math.hypot(nx, ny);
  const sign = Math.sign(nx * (inside.x - a.x) + ny * (inside.y - a.y));
  return (sign * (nx * (p.x - a.x) + ny * (p.y - a.y))) / len;
}

function properlyCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Points strictly inside every segment, including the closing one. */
function samples(lines: Polyline[]): Vec2[] {
  const out: Vec2[] = [];
  for (const l of lines) {
    const pts = l.closed ? [...l.points, l.points[0]] : l.points;
    for (let i = 1; i < pts.length; i++) {
      for (const t of [0.02, 0.5, 0.98]) {
        out.push(
          v(
            pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
            pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
          ),
        );
      }
    }
  }
  return out;
}

/** A random triangle that isn't too thin. */
function triangle(random: Random): Polyline {
  for (;;) {
    const t = closed(
      [random.range(0, 40), random.range(0, 40)],
      [random.range(0, 40), random.range(0, 40)],
      [random.range(0, 40), random.range(0, 40)],
    );
    const [a, b, c] = t.points;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    if (area > 150) return t;
  }
}

function incentre(t: Polyline): Vec2 {
  const [a, b, c] = t.points;
  const la = b.distance(c);
  const lb = a.distance(c);
  const lc = a.distance(b);
  const sum = la + lb + lc;
  return v((la * a.x + lb * b.x + lc * c.x) / sum, (la * a.y + lb * b.y + lc * c.y) / sum);
}

describe("spiral", () => {
  it("keeps turns exactly `spacing` apart on every edge of shapes with an inscribed circle", () => {
    const random = new Random("spiral-exact");
    const shapes = [
      ...[3, 4, 5, 6, 8].map((n) => polygon(v(20, 20), 15, n, random.range(0, 6))),
      circle(v(20, 20), 15),
      triangle(random),
      triangle(random),
      closed([20, 0], [32, 20], [20, 40], [8, 20]), // rhombus
      closed([20, 0], [30, 10], [20, 40], [10, 10]), // kite
    ];
    const spacing = 0.7;
    for (const shape of shapes) {
      const [path] = spiral(shape, { spacing });
      const outline = shape.points;
      const n = outline.length;
      const inside = path.end!;
      const pts = path.points;
      // Chord j runs over edge j mod n; chord j + n is the same edge one turn in.
      let checked = 0;
      for (let j = 0; j + n + 1 < pts.length - 1; j++) {
        const a = outline[j % n];
        const b = outline[(j + 1) % n];
        for (const s of [0, 0.5, 1]) {
          const p = v(
            pts[j].x + (pts[j + 1].x - pts[j].x) * s,
            pts[j].y + (pts[j + 1].y - pts[j].y) * s,
          );
          const q = v(
            pts[j + n].x + (pts[j + n + 1].x - pts[j + n].x) * s,
            pts[j + n].y + (pts[j + n + 1].y - pts[j + n].y) * s,
          );
          expect(depth(q, a, b, inside) - depth(p, a, b, inside)).toBeCloseTo(spacing, 7);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(n * 3);
    }
  });

  it("stays inside without crossing itself, even in a concave star", () => {
    const random = new Random("spiral-inside");
    const shapes = [star, triangle(random), rect(0, 0, 40, 12), circle(v(20, 20), 12)];
    // Random convex polygons: sorted angles around a centre.
    for (let i = 0; i < 6; i++) {
      const angles = Array.from({ length: random.int(4, 9) }, () => random.range(0, Math.PI * 2)).sort(
        (a, b) => a - b,
      );
      shapes.push(
        new Polyline(
          angles.map((a) => v(20 + Math.cos(a) * 15, 20 + Math.sin(a) * 15)),
          true,
        ),
      );
    }
    for (const shape of shapes) {
      const paths = spiral(shape, { spacing: 0.8 });
      expect(paths).toHaveLength(1);
      const inside = insideTest(shape);
      for (const p of samples(paths)) expect(inside(p.x, p.y)).toBe(true);
      const pts = paths[0].points;
      for (let i = 1; i < pts.length; i++) {
        for (let j = i + 2; j < pts.length; j++) {
          expect(properlyCross(pts[i - 1], pts[i], pts[j - 1], pts[j])).toBe(false);
        }
      }
    }
  });

  it("starts at the chosen vertex, half a spacing in, and ends at the centre", () => {
    const hexagon = polygon(v(20, 20), 10, 6);
    const apothem = 10 * Math.cos(Math.PI / 6);
    const [path] = spiral(hexagon, { spacing: 1, start: 2 });
    const t0 = 1 - 0.5 / apothem;
    const corner = hexagon.points[2];
    expect(path.start!.x).toBeCloseTo(20 + (corner.x - 20) * t0, 9);
    expect(path.start!.y).toBeCloseTo(20 + (corner.y - 20) * t0, 9);
    expect(path.end!.x).toBeCloseTo(20, 9);
    expect(path.end!.y).toBeCloseTo(20, 9);
  });

  it("finds the incentre of a triangle and the middle of a rectangle", () => {
    const random = new Random("spiral-centre");
    for (let i = 0; i < 5; i++) {
      const t = triangle(random);
      const end = spiral(t, { spacing: 0.5 })[0].end!;
      const c = incentre(t);
      expect(end.distance(c)).toBeLessThan(1e-6);
    }
    const end = spiral(rect(3, 5, 40, 10), { spacing: 0.5 })[0].end!;
    expect(end.distance(v(23, 10))).toBeLessThan(1e-6);
  });

  it("averages `spacing` over shapes without an inscribed circle", () => {
    const shapes = [rect(0, 0, 40, 10), closed([0, 0], [30, 2], [36, 20], [10, 28], [-4, 14])];
    for (const shape of shapes) {
      const spacing = 0.4;
      const [path] = spiral(shape, { spacing });
      const pts = shape.points;
      const area = Math.abs(
        pts.reduce((sum, p, i) => {
          const q = pts[(i + 1) % pts.length];
          return sum + p.x * q.y - q.x * p.y;
        }, 0) / 2,
      );
      // Ink length × spacing ≈ area when the average spacing is right.
      expect((path.length * spacing) / area).toBeCloseTo(1, 1);
    }
  });

  it("draws concentric rings, each `spacing` further in", () => {
    const hexagon = polygon(v(20, 20), 10, 6);
    const apothem = 10 * Math.cos(Math.PI / 6);
    const rings = spiral(hexagon, { spacing: 1, rings: true });
    expect(rings.length).toBe(Math.ceil(apothem - 0.5));
    const [a, b] = hexagon.points;
    rings.forEach((ring, m) => {
      expect(ring.closed).toBe(true);
      const mid = v((ring.points[0].x + ring.points[1].x) / 2, (ring.points[0].y + ring.points[1].y) / 2);
      expect(depth(mid, a, b, v(20, 20))).toBeCloseTo(m + 0.5, 9);
    });
  });

  it("rejects shapes it can't spiral", () => {
    expect(() => spiral(uShape, { spacing: 1 })).toThrow(RangeError);
    expect(() => spiral(new Polyline(rect(0, 0, 5, 5).points), { spacing: 1 })).toThrow(RangeError);
    expect(() => spiral(rect(0, 0, 5, 5), { spacing: 0 })).toThrow(RangeError);
    // The star's tips can't see each other.
    expect(() => spiral(star, { spacing: 1, center: v(20, 7) })).toThrow(RangeError);
    // Too wide a spacing for the shape: nothing to draw.
    expect(spiral(rect(0, 0, 2, 2), { spacing: 5 })).toEqual([]);
  });
});
