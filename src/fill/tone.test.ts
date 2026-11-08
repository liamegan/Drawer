import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import type { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { sdf } from "../sdf/SDF.js";
import {
  DEFAULT_THRESHOLDS,
  passCoverage,
  shade,
  toneSpacing,
  vanDerCorput,
} from "./tone.js";

/** Direction of each line, folded into [0, π), rounded to avoid float noise. */
const lineAngles = (lines: Polyline[]) =>
  new Set(
    lines.map((l) => {
      const a = Math.atan2(l.end!.y - l.start!.y, l.end!.x - l.start!.x);
      return Number((((a % Math.PI) + Math.PI) % Math.PI).toFixed(6));
    }),
  );

const lineYs = (lines: Polyline[]) =>
  [...new Set(lines.map((l) => Number(l.start!.y.toFixed(6))))].sort(
    (a, b) => a - b,
  );

describe("toneSpacing", () => {
  it("gives the spacing that covers `tone` of the paper", () => {
    expect(toneSpacing(0.5, { pen: 0.3, aligned: false })).toBeCloseTo(0.6);
    expect(toneSpacing(1, { pen: 0.3, aligned: false })).toBeCloseTo(0.3);
    expect(toneSpacing(0.05, { pen: 0.3, aligned: false })).toBeNull();
    expect(toneSpacing(0, { pen: 0.3 })).toBeNull();
    expect(() => toneSpacing(0.5, { pen: 0 })).toThrow(RangeError);
  });

  it("aligned spacings are whole fractions of maxSpacing", () => {
    for (let t = 0.05; t <= 1; t += 0.05) {
      const s = toneSpacing(t, { pen: 0.3, maxSpacing: 4 });
      if (s === null) continue;
      const n = 4 / s;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
      expect(s).toBeGreaterThanOrEqual(0.3);
    }
    expect(toneSpacing(1, { pen: 0.3, maxSpacing: 4 })).toBeCloseTo(4 / 13);
  });
});

describe("passCoverage", () => {
  it("adds up to the tone, and no pass ever thins out as tone rises", () => {
    let previous = DEFAULT_THRESHOLDS.map(() => 0);
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const passes = DEFAULT_THRESHOLDS.map((_, i) =>
        passCoverage(t, DEFAULT_THRESHOLDS, i),
      );
      const total = 1 - passes.reduce((left, c) => left * (1 - c), 1);
      expect(total).toBeCloseTo(Math.min(t, 1), 9);
      passes.forEach((c, i) => expect(c).toBeGreaterThanOrEqual(previous[i] - 1e-12));
      previous = passes;
    }
  });

  it("keeps each pass off until its threshold", () => {
    expect(passCoverage(0.39, DEFAULT_THRESHOLDS, 1)).toBe(0);
    expect(passCoverage(0.41, DEFAULT_THRESHOLDS, 1)).toBeGreaterThan(0);
    expect(passCoverage(1, DEFAULT_THRESHOLDS, 3)).toBe(1);
  });
});

describe("shade", () => {
  const square = rect(0, 0, 30, 30);

  it("adds cross-hatching passes as the tone darkens", () => {
    expect(lineAngles(shade(square, { tone: 0.3, pen: 0.3 })).size).toBe(1);
    expect(lineAngles(shade(square, { tone: 0.5, pen: 0.3 })).size).toBe(2);
    expect(lineAngles(shade(square, { tone: 0.9, pen: 0.3 })).size).toBe(4);
    expect(shade(square, { tone: 0, pen: 0.3 })).toEqual([]);
  });

  it("dithers a tone field: half density keeps every other lattice line", () => {
    const lines = shade(square, {
      tone: () => 0.5,
      pen: 0.25,
      angles: [0],
      thresholds: [0],
    });
    const ys = lineYs(lines);
    expect(ys.length).toBeGreaterThan(50);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(0.5, 6);
  });

  it("only adds lines as a tone field darkens", () => {
    const at = (tone: number) =>
      lineYs(shade(square, { tone: () => tone, pen: 0.25, angles: [0], thresholds: [0] }));
    for (const [light, dark] of [
      [0.2, 0.3],
      [0.3, 0.6],
      [0.6, 0.9],
    ]) {
      const darker = new Set(at(dark));
      expect(at(light).every((y) => darker.has(y))).toBe(true);
      expect(darker.size).toBeGreaterThan(at(light).length);
    }
  });

  it("cuts lines where a tone gradient fades out, without leaving the shape", () => {
    const disc = circle(new Vec2(20, 20), 15);
    const lines = shade(disc, {
      tone: (x) => (x - 5) / 30,
      pen: 0.3,
    });
    const inside = insideTest(disc);
    for (const l of lines) {
      for (const p of l.points) expect(inside(p.x, p.y) || isOnEdge(p)).toBe(true);
    }
    // Lighter on the left: fewer line ends start there.
    const left = lines.filter((l) => Math.max(l.start!.x, l.end!.x) < 15).length;
    const right = lines.filter((l) => Math.min(l.start!.x, l.end!.x) > 25).length;
    expect(right).toBeGreaterThan(left);

    function isOnEdge(p: Vec2) {
      return Math.abs(Math.hypot(p.x - 20, p.y - 20) - 15) < 0.05;
    }
  });

  it("follows the outline with its first pass when `contour` is set", () => {
    const split = (tone: number) => {
      const out = shade(square, { tone, pen: 0.3, contour: true });
      return {
        rings: out.filter((l) => l.closed),
        lines: out.filter((l) => !l.closed),
      };
    };
    const light = split(0.3);
    expect(light.lines).toEqual([]);
    // Nested squares, outermost half a spacing in.
    const spacing = toneSpacing(0.3, { pen: 0.3 })!;
    expect(light.rings.length).toBe(Math.floor(15 / spacing - 0.5) + 1);
    light.rings.forEach((ring, k) => {
      expect(ring.bounds.min.x).toBeCloseTo((k + 0.5) * spacing, 6);
    });
    // Then cross-hatching on top, starting at `angle`.
    const mid = split(0.5);
    expect(mid.rings.length).toBeGreaterThan(0);
    expect([...lineAngles(mid.lines)]).toEqual([Number((Math.PI / 4).toFixed(6))]);
    // Three parallel passes by default, so four in all.
    expect(lineAngles(split(0.95).lines).size).toBe(3);
  });

  it("dithers contours ring by ring for a tone field", () => {
    const depths = (tone: number) =>
      shade(square, {
        tone: () => tone,
        pen: 0.25,
        contour: true,
        angles: [],
        thresholds: [0],
      }).map((ring) => Number(ring.bounds.min.x.toFixed(6)));
    const half = depths(0.5);
    expect(half.length).toBeGreaterThan(20);
    // Every other ring of the pen-width lattice.
    for (let i = 1; i < half.length; i++) {
      expect(half[i] - half[i - 1]).toBeCloseTo(0.5, 6);
    }
    const darker = new Set(depths(0.8));
    expect(half.every((d) => darker.has(d))).toBe(true);
    expect(darker.size).toBeGreaterThan(half.length);
  });

  it("insets every pass, contours included", () => {
    const disc = circle(new Vec2(20, 20), 12);
    const field = sdf(disc);
    for (const tone of [0.9, (x: number) => x / 40]) {
      const out = shade(disc, { tone, pen: 0.3, contour: true, inset: 1.5 });
      expect(out.some((l) => l.closed)).toBe(true);
      expect(out.some((l) => !l.closed)).toBe(true);
      for (const l of out) {
        for (const p of l.points) {
          expect(field.at(p.x, p.y)).toBeLessThan(-1.5 + 0.02);
        }
      }
    }
    // The first contour is half a spacing in from the inset outline.
    const spacing = toneSpacing(0.3, { pen: 0.3 })!;
    const [outer] = shade(disc, { tone: 0.3, pen: 0.3, contour: true, inset: 1.5 });
    for (const p of outer.points) {
      expect(-field.at(p.x, p.y)).toBeCloseTo(1.5 + spacing / 2, 1);
    }
    expect(() => shade(disc, { tone: 0.5, pen: 0.3, inset: -1 })).toThrow(
      RangeError,
    );
  });
});

describe("vanDerCorput", () => {
  it("runs 0, 1/2, 1/4, 3/4, 1/8 and wraps negative indices", () => {
    expect([0, 1, 2, 3, 4].map(vanDerCorput)).toEqual([0, 0.5, 0.25, 0.75, 0.125]);
    expect(vanDerCorput(-1)).toBe(vanDerCorput(65535));
  });
});
