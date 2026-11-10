import { describe, expect, it } from "vitest";
import { Noise } from "../noise/Noise.js";
import { Random } from "../random/Random.js";
import { angleField, curlField } from "./fields.js";

describe("angleField", () => {
  it("gives unit vectors at the angle, turning clockwise on screen", () => {
    const field = angleField((x) => x);
    for (const a of [0, 0.5, 2, -1.3]) {
      const [dx, dy] = field(a, 0);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
      expect(Math.atan2(dy, dx)).toBeCloseTo(a, 12);
    }
    // A quarter turn points down the page (+y).
    expect(field(Math.PI / 2, 0)[1]).toBeCloseTo(1, 12);
  });
});

describe("curlField", () => {
  it("matches the exact curl of an analytic potential", () => {
    // ψ = sin(x)·cos(y/2) → curl = (−½ sin x sin(y/2), −cos x cos(y/2)).
    const field = curlField((x, y) => Math.sin(x) * Math.cos(y / 2));
    for (const [x, y] of [
      [0.3, 1.2],
      [2, -0.7],
      [-1.5, 4],
    ]) {
      const [dx, dy] = field(x, y);
      // Central differences at eps = 0.01 are good to about eps² ≈ 1e-4.
      expect(dx).toBeCloseTo(-0.5 * Math.sin(x) * Math.sin(y / 2), 4);
      expect(dy).toBeCloseTo(-Math.cos(x) * Math.cos(y / 2), 4);
    }
  });

  it("runs along the potential's contours, with no divergence", () => {
    const noise = new Noise(new Random("curl"));
    const potential = (x: number, y: number) =>
      noise.fbm2(x, y, { frequency: 0.05 });
    const field = curlField(potential);
    // The same step as `curlField`, so the differences are exact partners.
    const h = 0.01;
    for (let k = 0; k < 200; k++) {
      const x = (k * 7.31) % 100;
      const y = (k * 3.17) % 80;
      const [dx, dy] = field(x, y);
      // Orthogonal to the gradient (taken with the same step), so ψ is
      // constant along the flow.
      const e = 0.01;
      const gx = (potential(x + e, y) - potential(x - e, y)) / (2 * e);
      const gy = (potential(x, y + e) - potential(x, y - e)) / (2 * e);
      expect(Math.abs(dx * gx + dy * gy)).toBeLessThan(1e-9);
      expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(gx, gy), 9);
      // Divergence by central differences: its two terms cancel.
      const ux = (field(x + h, y)[0] - field(x - h, y)[0]) / (2 * h);
      const vy = (field(x, y + h)[1] - field(x, y - h)[1]) / (2 * h);
      expect(Math.abs(ux + vy)).toBeLessThan(
        1e-9 * (Math.abs(ux) + Math.abs(vy)) + 1e-12,
      );
    }
    expect(() => curlField(potential, { eps: 0 })).toThrow(RangeError);
  });
});
