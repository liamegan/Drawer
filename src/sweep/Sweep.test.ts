import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { catmullRom } from "../geometry/curves.js";
import { Polyline } from "../geometry/Polyline.js";
import { segmentDistance } from "../geometry/simplify.js";
import { leaf, parametric, taper } from "./profiles.js";
import { Sweep } from "./Sweep.js";

const v = (x: number, y: number) => new Vec2(x, y);
const straight = new Polyline([v(0, 0), v(20, 0)]);
const curvy = catmullRom([v(0, 0), v(10, -6), v(22, -4), v(30, 6)]);

function signedArea(ring: Polyline): number {
  const p = ring.points;
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

describe("Sweep", () => {
  it("sweeps a constant profile along a line into a rectangle", () => {
    const s = new Sweep(straight, { width: 6, profile: taper(1, 1) });
    expect(s.length).toBe(20);
    expect(s.outline.closed).toBe(true);
    const b = s.outline.bounds;
    expect([b.min.x, b.min.y, b.max.x, b.max.y]).toEqual([0, -3, 20, 3]);
    expect(signedArea(s.outline)).toBeCloseTo(120, 9); // clockwise on screen
    expect(s.outline.pointCount).toBe(4);
    // v = 1 is the right of the walker heading +x, which is +y (down).
    expect(s.point(0.5, 1)).toEqual(v(10, 3));
    expect(s.point(0.5, -1)).toEqual(v(10, -3));
    expect(s.point(0.25, 0.5)).toEqual(v(5, 1.5));
    expect(s.extent).toEqual([0, 1]);
    // Open, it runs base-left, round the tip, to base-right.
    const open = s.openOutline;
    expect(open.closed).toBe(false);
    expect(open.start).toEqual(v(0, -3));
    expect(open.end).toEqual(v(0, 3));
    expect(open.length).toBeCloseTo(46, 9);
  });

  it("puts the edges a half-width out along the normal, clockwise", () => {
    const s = new Sweep(curvy, { width: 5, profile: leaf() });
    expect(signedArea(s.outline)).toBeGreaterThan(0);
    for (let t = 0.02; t < 1; t += 0.07) {
      const f = s.frame(t);
      for (const side of [-1, 1] as const) {
        const p = s.point(t, side);
        const d = p.subtractNew(f.point);
        expect(d.length).toBeCloseTo(s.halfWidth(t, side), 9);
        expect(Math.abs(d.dot(f.tangent))).toBeLessThan(1e-9);
        // The right side is the tangent turned clockwise on screen.
        const cross = f.tangent.x * d.y - f.tangent.y * d.x;
        expect(Math.sign(cross)).toBe(side);
      }
    }
    // Pointed ends: the outline touches the spine's ends.
    const near = (q: Vec2) =>
      Math.min(...s.outline.points.map((p) => p.distance(q)));
    expect(near(curvy.start!)).toBeLessThan(1e-9);
    expect(near(curvy.end!)).toBeLessThan(1e-9);
  });

  it("follows the true edge within tolerance", () => {
    const s = new Sweep(curvy, { width: 8, profile: leaf({ widest: 0.3 }) });
    const ring = s.outline.points;
    const gap = (q: Vec2) => {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        best = Math.min(best, segmentDistance(q.x, q.y, a.x, a.y, b.x, b.y));
      }
      return best;
    };
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      worst = Math.max(worst, gap(s.point(t, 1)), gap(s.point(t, -1)));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it("bends a straight spine into an arc that turns by `bend`", () => {
    const bend = Math.PI / 2;
    const s = new Sweep(new Polyline([v(0, 0), v(30, 0)]), { width: 4, bend });
    expect(s.length).toBeCloseTo(30, 3);
    const end = s.frame(1).tangent;
    expect(Math.atan2(end.y, end.x)).toBeCloseTo(bend, 9); // clockwise: down
    // On a circle of radius L / bend, centred below the start.
    const r = 30 / bend;
    for (const p of s.spine.points) {
      expect(p.distance(v(0, r))).toBeCloseTo(r, 3);
    }
    expect(s.frame(0.5).tangent.x).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("turns its frame smoothly through the spine's corners", () => {
    const vee = new Polyline([v(0, 0), v(10, 0), v(20, 10)]);
    const s = new Sweep(vee, { width: 2, profile: taper(1, 1) });
    let prev = s.frame(0).normal;
    let biggest = 0;
    for (let i = 1; i <= 2000; i++) {
      const n = s.frame(i / 2000).normal;
      biggest = Math.max(biggest, Math.acos(Math.min(1, n.dot(prev))));
      prev = n;
    }
    // 45° spread over ~24 mm, sampled every ~0.012 mm: well under 0.1°.
    expect(biggest).toBeLessThan(0.0017);
    expect(Math.atan2(prev.y, prev.x)).toBeCloseTo((3 * Math.PI) / 4, 9);
  });

  it("carries straight on past the ends", () => {
    const s = new Sweep(curvy, { width: 3 });
    const a = s.frame(0);
    const before = s.frame(-0.1);
    const back = a.point.subtractNew(a.tangent.scaleNew(0.1 * s.length));
    expect(before.point.distance(back)).toBeLessThan(1e-9);
    expect(before.tangent.distance(a.tangent)).toBe(0);
    const z = s.frame(1);
    const after = s.frame(1.2);
    const on = z.point.addNew(z.tangent.scaleNew(0.2 * s.length));
    expect(after.point.distance(on)).toBeLessThan(1e-9);
  });

  it("takes a profile per side", () => {
    const s = new Sweep(straight, {
      width: 6,
      profile: { left: taper(1, 1), right: taper(0.5, 0.5) },
    });
    expect(s.halfWidth(0.3, -1)).toBe(3);
    expect(s.halfWidth(0.3, 1)).toBe(1.5);
    expect(s.widest(-1)).toBe(3);
    expect(s.widest(1)).toBe(1.5);
    const b = s.outline.bounds;
    expect([b.min.y, b.max.y]).toEqual([-3, 1.5]);
  });

  it("draws an outline profile as given, notch and all", () => {
    const heart = parametric((t) => [
      Math.sin(t ** 0.8 * Math.PI),
      Math.sin(t * Math.PI * 0.8),
    ]);
    const s = new Sweep(straight, { width: 10, profile: heart });
    expect(signedArea(s.outline)).toBeGreaterThan(0);
    expect(s.extent[1]).toBeCloseTo(1, 4);
    const b = s.outline.bounds;
    expect(b.max.x).toBeCloseTo(20, 2); // the lobes reach the tip
    expect(b.max.y).toBeCloseTo(5, 2);
    // The notch: the outline comes back to the spine short of the tip.
    const notch = heart.outline[heart.outline.length - 1][1] * 20;
    const onSpine = s.outline.points.filter((p) => Math.abs(p.y) < 1e-9);
    expect(onSpine.some((p) => Math.abs(p.x - notch) < 1e-6)).toBe(true);
    // halfWidth reads the widest part, including the lobes.
    expect(s.halfWidth(0.9)).toBeCloseTo(5 * heart.width(0.9), 9);
  });

  it("gives a midrib along the spine", () => {
    const s = new Sweep(curvy, { width: 3 });
    const rib = s.midrib(0, 0.8);
    expect(rib.length).toBeCloseTo(0.8 * s.length, 6);
    expect(rib.start!.distance(curvy.start!)).toBeLessThan(1e-9);
    expect(rib.end!.distance(s.frame(0.8).point)).toBeLessThan(1e-9);
    expect(() => s.midrib(0.5, 0.5)).toThrow(RangeError);
  });

  it("checks its inputs", () => {
    expect(() => new Sweep(straight, { width: 0 })).toThrow(RangeError);
    expect(() => new Sweep(straight.close(), { width: 2 })).toThrow(RangeError);
    const dot = new Polyline([v(1, 1), v(1, 1)]);
    expect(() => new Sweep(dot, { width: 2 })).toThrow(RangeError);
    expect(
      () => new Sweep(straight, { width: 2, profile: () => Number.NaN }),
    ).toThrow(RangeError);
  });
});
