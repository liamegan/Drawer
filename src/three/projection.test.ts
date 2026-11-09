import { describe, expect, it } from "vitest";
import { Vec3 } from "wtc-math";
import { box } from "./builders.js";
import { oblique, orthographic, type Projection } from "./projection.js";

const front = (mesh: ReturnType<typeof box>, p: Projection) =>
  mesh.normals.filter((n) => n.dot(p.toEye) > 1e-9).length;

describe("oblique", () => {
  it("matches GM's projection", () => {
    const p = oblique();
    const q = p.project(new Vec3(3, 4, 6));
    expect(q.x).toBeCloseTo(3, 9);
    expect(q.y).toBeCloseTo(-4 + 6 * 0.5, 9);
  });

  it("draws depth in the direction given", () => {
    const p = oblique({ factor: 0.4, angle: Math.PI / 4 });
    const q = p.project(new Vec3(0, 0, 10));
    expect(q.x).toBeCloseTo(4 * Math.SQRT1_2, 9);
    expect(q.y).toBeCloseTo(4 * Math.SQRT1_2, 9);
  });

  it("looks along toEye, which lands on one page point", () => {
    for (const p of [oblique(), oblique({ factor: 0.7, angle: 2.5 })]) {
      expect(p.toEye.length).toBeCloseTo(1, 12);
      const q = p.project(p.toEye.scaleNew(7));
      expect(q.x).toBeCloseTo(0, 9);
      expect(q.y).toBeCloseTo(0, 9);
      expect(p.toEye.z).toBeGreaterThan(0); // from the front
    }
  });

  it("shows a box's front and top", () => {
    const p = oblique();
    const b = box(new Vec3(10, 10, 10));
    expect(front(b, p)).toBe(2);
    // Angled off the vertical, a side shows too.
    expect(front(b, oblique({ angle: Math.PI / 3 }))).toBe(3);
  });
});

describe("orthographic", () => {
  it("keeps a front face true from straight ahead", () => {
    const p = orthographic({ elevation: 0, azimuth: 0 });
    const q = p.project(new Vec3(3, 4, 9));
    expect(q.x).toBeCloseTo(3, 9);
    expect(q.y).toBeCloseTo(-4, 9);
    expect(p.toEye.z).toBeCloseTo(1, 12);
  });

  it("is a rotation: page axes are unit and square to the view", () => {
    const p = orthographic({ elevation: 0.4, azimuth: -1.1 });
    expect(p.u.length).toBeCloseTo(1, 12);
    expect(p.v.length).toBeCloseTo(1, 12);
    expect(p.u.dot(p.v)).toBeCloseTo(0, 12);
    expect(p.u.dot(p.toEye)).toBeCloseTo(0, 12);
    expect(p.v.dot(p.toEye)).toBeCloseTo(0, 12);
    // Verticals stay vertical, pointing up the page.
    expect(p.project(new Vec3(0, 1, 0)).x).toBeCloseTo(0, 12);
    expect(p.project(new Vec3(0, 1, 0)).y).toBeLessThan(0);
  });

  it("shows a box's front, right side and top by default", () => {
    const p = orthographic();
    const b = box(new Vec3(10, 10, 10));
    const shown = b.normals.map((n) => n.dot(p.toEye) > 0);
    // Faces in box order: front, back, right, left, top, bottom.
    expect(shown).toEqual([true, false, true, false, true, false]);
    // The front-right corner is nearer than the back-left one.
    expect(p.depth(new Vec3(5, 0, 5))).toBeGreaterThan(
      p.depth(new Vec3(-5, 0, -5)),
    );
  });

  it("puts things on the right further right as it walks round", () => {
    const p = orthographic({ azimuth: 0.3 });
    expect(p.project(new Vec3(1, 0, 0)).x).toBeGreaterThan(0);
    // Walking right, the front face's right edge comes towards the viewer.
    expect(p.depth(new Vec3(1, 0, 0))).toBeGreaterThan(0);
  });
});
