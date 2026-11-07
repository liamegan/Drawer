import { describe, expect, it } from "vitest";
import { ScanlineSweep, type FillRule } from "./scanline.js";

const square = (x: number, y: number, size: number) =>
  Float64Array.of(x, y, x + size, y, x + size, y + size, x, y + size);
const reversed = (ring: Float64Array) => {
  const out = new Float64Array(ring.length);
  for (let i = 0; i < ring.length; i += 2) {
    out[ring.length - 2 - i] = ring[i];
    out[ring.length - 1 - i] = ring[i + 1];
  }
  return out;
};
const pentagram = (cx: number, cy: number, r: number) =>
  Float64Array.from(
    Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }).flat(),
  );

/** All spans at `y`, from a fresh sweep, as [[xa, xb], ...]. */
function spansAt(rings: Float64Array[], y: number, rule: FillRule) {
  const sweep = new ScanlineSweep(rings);
  const out = new Float64Array(Math.max(2, sweep.edgeCount));
  const n = sweep.spans(y, rule, out);
  return Array.from({ length: n }, (_, i) => [out[2 * i], out[2 * i + 1]]);
}

describe("ScanlineSweep", () => {
  it("reports its extents and skips horizontal edges", () => {
    const sweep = new ScanlineSweep([square(1, 2, 3)]);
    expect([sweep.minX, sweep.maxX, sweep.minY, sweep.maxY]).toEqual([
      1, 4, 2, 5,
    ]);
    expect(sweep.edgeCount).toBe(2);
  });

  it("spans a square, counting the top edge but not the bottom", () => {
    const ring = [square(0, 0, 10)];
    expect(spansAt(ring, 5, "nonzero")).toEqual([[0, 10]]);
    expect(spansAt(ring, 0, "nonzero")).toEqual([[0, 10]]);
    expect(spansAt(ring, 10, "nonzero")).toEqual([]);
    expect(spansAt(ring, -1, "nonzero")).toEqual([]);
  });

  it("fills a pentagram's middle under nonzero but not even-odd", () => {
    const star = [pentagram(10, 10, 8)];
    const nonzero = spansAt(star, 10.5, "nonzero");
    const evenodd = spansAt(star, 10.5, "evenodd");
    expect(nonzero).toHaveLength(1);
    expect(nonzero[0][0]).toBeLessThan(10);
    expect(nonzero[0][1]).toBeGreaterThan(10);
    expect(evenodd).toHaveLength(2);
    expect(evenodd.every(([a, b]) => b < 10 || a > 10)).toBe(true);
  });

  it("merges or cuts nested rings by orientation and rule", () => {
    const outer = square(0, 0, 10);
    const inner = square(3, 3, 4);
    expect(spansAt([outer, inner], 5, "nonzero")).toEqual([[0, 10]]);
    expect(spansAt([outer, reversed(inner)], 5, "nonzero")).toEqual([
      [0, 3],
      [7, 10],
    ]);
    expect(spansAt([outer, inner], 5, "evenodd")).toEqual([
      [0, 3],
      [7, 10],
    ]);
  });

  it("walks many scanlines with one sweep, top to bottom only", () => {
    const sweep = new ScanlineSweep([square(0, 0, 10), square(20, 5, 10)]);
    const out = new Float64Array(sweep.edgeCount);
    expect(sweep.spans(2, "nonzero", out)).toBe(1);
    expect(sweep.spans(7, "nonzero", out)).toBe(2);
    expect([out[2], out[3]]).toEqual([20, 30]);
    expect(sweep.spans(12, "nonzero", out)).toBe(1);
    expect(() => sweep.spans(3, "nonzero", out)).toThrow(RangeError);
  });
});
