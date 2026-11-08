import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import type { Polyline } from "../geometry/Polyline.js";
import { rect } from "../geometry/shapes.js";
import { segmentDistance } from "../geometry/simplify.js";
import { Random } from "../random/Random.js";
import { strokeCoverage, waveShade, waveToneRange } from "./wave.js";

/**
 * The share of the box [x0, x1] × [y0, y1] inked by `lines` drawn `pen`
 * wide, from random points: a point is inked when it's within half a pen of
 * a line. Independent of how `waveShade` models coverage.
 */
function measuredCoverage(
  lines: readonly Polyline[],
  pen: number,
  box: [number, number, number, number],
  samples = 12000,
): number {
  const cell = 0.5;
  const buckets = new Map<string, number[][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const line of lines) {
    const pts = line.points;
    for (let s = 1; s < pts.length; s++) {
      const seg = [pts[s - 1].x, pts[s - 1].y, pts[s].x, pts[s].y];
      const i0 = Math.floor((Math.min(seg[0], seg[2]) - pen) / cell);
      const i1 = Math.floor((Math.max(seg[0], seg[2]) + pen) / cell);
      const j0 = Math.floor((Math.min(seg[1], seg[3]) - pen) / cell);
      const j1 = Math.floor((Math.max(seg[1], seg[3]) + pen) / cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(seg);
        }
      }
    }
  }
  const random = new Random("coverage");
  const [x0, y0, x1, y1] = box;
  let inked = 0;
  for (let n = 0; n < samples; n++) {
    const x = random.range(x0, x1);
    const y = random.range(y0, y1);
    const near = buckets.get(key(Math.floor(x / cell), Math.floor(y / cell)));
    if (
      near?.some(
        ([ax, ay, bx, by]) => segmentDistance(x, y, ax, ay, bx, by) <= pen / 2,
      )
    ) {
      inked++;
    }
  }
  return inked / samples;
}

/** Arc length of one period of a sine wave, numerically. */
function arcLength(amplitude: number, wavelength: number): number {
  const n = 4000;
  let length = 0;
  let px = 0;
  let py = 0;
  for (let i = 1; i <= n; i++) {
    const x = (wavelength * i) / n;
    const y = amplitude * Math.sin((Math.PI * 2 * x) / wavelength);
    length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return length;
}

describe("strokeCoverage", () => {
  it("is pen × length where the stroke doesn't overlap itself", () => {
    for (const [amplitude, wavelength] of [
      [0.2, 3],
      [0.35, 2],
      [0.6, 5],
    ]) {
      const expected =
        (0.3 * arcLength(amplitude, wavelength)) / wavelength / 1.5;
      expect(strokeCoverage(amplitude, wavelength, 0.3, 1.5)).toBeCloseTo(
        expected,
        3,
      );
    }
    expect(strokeCoverage(0, 2, 0.3, 1.5)).toBeCloseTo(0.2, 12);
  });

  it("counts ink once where the flanks crowd into a band", () => {
    // So tight the stroke is a band 2A + pen tall, less the scallops
    // between crests, while pen × length would ink more than the paper.
    const band = (2 * 0.35 + 0.3) / 1;
    const tight = strokeCoverage(0.35, 0.3, 0.3, 1);
    expect((0.3 * arcLength(0.35, 0.3)) / 0.3).toBeGreaterThan(1.4);
    expect(tight).toBeLessThanOrEqual(band);
    expect(tight).toBeGreaterThan(0.9 * band);
  });
});

describe("waveShade", () => {
  const square = rect(0, 0, 40, 40);
  const inner: [number, number, number, number] = [8, 8, 32, 32];

  it("inks the paper to the tone asked for", () => {
    for (const [pen, spacing] of [
      [0.3, 1],
      [0.25, 1.5],
    ]) {
      const [lightest, darkest] = waveToneRange({ pen, spacing });
      const tested: number[] = [];
      for (const tone of [0.25, 0.4, 0.6, 0.8, 0.9]) {
        if (tone < lightest || tone > darkest) continue;
        tested.push(tone);
        const lines = waveShade(square, { tone, pen, spacing });
        expect(
          Math.abs(measuredCoverage(lines, pen, inner) - tone),
        ).toBeLessThan(0.025);
      }
      expect(tested.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("reaches from a straight line to nearly solid", () => {
    const [lightest, darkest] = waveToneRange({ pen: 0.3, spacing: 1 });
    expect(lightest).toBeCloseTo(0.3, 12);
    expect(darkest).toBeGreaterThan(0.9);
    // Lighter than a straight line: straight lines.
    const light = waveShade(square, { tone: 0.1, pen: 0.3, spacing: 1 });
    for (const line of light) expect(line.pointCount).toBe(2);
    // Darker than the densest wave: the densest wave.
    const solid = waveShade(square, { tone: 1, pen: 0.3, spacing: 1 });
    expect(measuredCoverage(solid, 0.3, inner)).toBeCloseTo(darkest, 1);
  });

  it("keeps each wave in its own band, inside the shape", () => {
    const pen = 0.3;
    const spacing = 1.2;
    const amplitude = (spacing - pen) / 2;
    const angle = 0.5;
    const lines = waveShade(rect(3, 3, 30, 30), {
      tone: (x) => x / 35,
      pen,
      spacing,
      angle,
    });
    const inside = insideTest(rect(3, 3, 30, 30));
    for (const line of lines) {
      const across = (p: Vec2) =>
        -p.x * Math.sin(angle) + p.y * Math.cos(angle);
      // The line's lattice position, from the page anchor and ½ offset.
      const k = Math.round(across(line.points[0]) / spacing - 0.5);
      const v = (k + 0.5) * spacing;
      for (const p of line.points) {
        expect(Math.abs(across(p) - v)).toBeLessThanOrEqual(amplitude + 1e-9);
        expect(inside(p.x, p.y) || nearEdge(p)).toBe(true);
      }
    }
    function nearEdge(p: Vec2) {
      return (
        Math.min(
          Math.abs(p.x - 3),
          Math.abs(p.x - 33),
          Math.abs(p.y - 3),
          Math.abs(p.y - 33),
        ) < 1e-6
      );
    }
  });

  it("runs waves on across neighbouring shapes at a constant tone", () => {
    const options = { tone: 0.55, pen: 0.3, spacing: 1 };
    const ends = (lines: Polyline[], x: number) =>
      lines
        .flatMap((l) => [l.start!, l.end!])
        .filter((p) => Math.abs(p.x - x) < 1e-9)
        .map((p) => p.y)
        .sort((a, b) => a - b);
    const left = ends(waveShade(rect(0, 0, 20, 20), options), 20);
    const right = ends(waveShade(rect(20, 0, 20, 20), options), 20);
    expect(left.length).toBeGreaterThan(15);
    expect(right).toHaveLength(left.length);
    // Equal up to how each side's samples straddle the seam.
    left.forEach((y, i) => expect(Math.abs(right[i] - y)).toBeLessThan(0.01));
  });

  it("shades a gradient with unbroken lines and no kinks", () => {
    const lines = waveShade(square, {
      tone: (x) => x / 40,
      pen: 0.3,
      spacing: 1,
      alternate: false,
    });
    // One unbroken line per lattice line.
    expect(lines).toHaveLength(40);
    // The wave's slope never exceeds the densest wave's, so no phase jumps.
    const steepest = (2 * Math.PI * 0.35) / 0.3;
    for (const line of lines) {
      const pts = line.points;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(
          dx * steepest * 1.05 + 1e-9,
        );
      }
    }
    // Darker on the right: more ink there.
    const left = measuredCoverage(lines, 0.3, [2, 2, 12, 38], 8000);
    const right = measuredCoverage(lines, 0.3, [28, 2, 38, 38], 8000);
    expect(right).toBeGreaterThan(left + 0.3);
  });

  it("rejects options it can't draw", () => {
    const shade = (o: object) => () =>
      waveShade(square, { tone: 0.5, pen: 0.3, spacing: 1, ...o });
    expect(shade({ spacing: 0 })).toThrow(RangeError);
    expect(shade({ pen: 1.2 })).toThrow(RangeError);
    expect(shade({ amplitude: 0.5 })).toThrow(RangeError);
    expect(shade({ minWavelength: 0.1 })).toThrow(RangeError);
  });
});
