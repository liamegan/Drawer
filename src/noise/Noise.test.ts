import { describe, expect, it } from "vitest";
import { Random } from "../random/Random.js";
import { Noise } from "./Noise.js";

const grid = (
  n: number,
  scale: number,
  f: (x: number, y: number) => number,
) => {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) out.push(f(i * scale + 0.37, j * scale - 4.1));
  }
  return out;
};

describe("Noise", () => {
  const noise = new Noise(new Random("noise"));

  it("stays within [-1, 1], centred on 0, and uses most of the range", () => {
    for (const values of [
      grid(200, 0.137, (x, y) => noise.simplex2(x, y)),
      grid(200, 0.137, (x, y) => noise.simplex3(x, y, x * 0.3 - y)),
    ]) {
      const max = Math.max(...values.map(Math.abs));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(max).toBeLessThanOrEqual(1);
      expect(max).toBeGreaterThan(0.75);
      expect(Math.abs(mean)).toBeLessThan(0.03);
    }
  });

  it("is reproducible from the seed, and different for another", () => {
    const again = new Noise(new Random("noise"));
    const other = new Noise(new Random("other"));
    const a = grid(20, 0.31, (x, y) => noise.fbm2(x, y));
    expect(grid(20, 0.31, (x, y) => again.fbm2(x, y))).toEqual(a);
    const b = grid(20, 0.31, (x, y) => other.fbm2(x, y));
    expect(
      b.filter((value, i) => Math.abs(value - a[i]) > 0.05).length,
    ).toBeGreaterThan(300);
  });

  it("varies smoothly: nearby samples differ by little", () => {
    const h = 1e-3;
    let steepest = 0;
    for (const [x, y] of grid(60, 0.53, (x, y) => x * 1000 + y).map((_, k) => [
      (k % 60) * 0.53 + 0.1,
      Math.floor(k / 60) * 0.53 - 2,
    ])) {
      steepest = Math.max(
        steepest,
        Math.abs(noise.simplex2(x + h, y) - noise.simplex2(x, y)) / h,
        Math.abs(noise.simplex3(x, y + h, 0.5) - noise.simplex3(x, y, 0.5)) / h,
      );
    }
    // Simplex noise's slope is bounded (a few units per unit).
    expect(steepest).toBeLessThan(10);
  });

  it("normalises fBm, and adds finer detail with more octaves", () => {
    const one = grid(100, 0.21, (x, y) => noise.fbm2(x, y, { octaves: 1 }));
    expect(one).toEqual(grid(100, 0.21, (x, y) => noise.simplex2(x, y)));
    const six = grid(100, 0.21, (x, y) =>
      noise.fbm2(x, y, { octaves: 6, frequency: 0.5 }),
    );
    expect(Math.max(...six.map(Math.abs))).toBeLessThanOrEqual(1);
    // Rougher: bigger differences between neighbouring samples at fine scale.
    const roughness = (f: (x: number) => number) => {
      let sum = 0;
      for (let i = 0; i < 2000; i++)
        sum += Math.abs(f(i * 0.01 + 0.005) - f(i * 0.01));
      return sum;
    };
    expect(roughness((x) => noise.fbm2(x, 3, { octaves: 6 }))).toBeGreaterThan(
      roughness((x) => noise.fbm2(x, 3, { octaves: 1 })),
    );
    expect(noise.fbm3(1.2, 3.4, 5.6, { frequency: 0.5 })).toBeCloseTo(
      noise.fbm3(0.6, 1.7, 2.8, { frequency: 1 }),
      12,
    );
    expect(() => noise.fbm2(0, 0, { gain: 0 })).toThrow(RangeError);
  });
});
