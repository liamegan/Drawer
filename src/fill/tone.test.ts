import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import type { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
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
});

describe("vanDerCorput", () => {
  it("runs 0, 1/2, 1/4, 3/4, 1/8 and wraps negative indices", () => {
    expect([0, 1, 2, 3, 4].map(vanDerCorput)).toEqual([0, 0.5, 0.25, 0.75, 0.125]);
    expect(vanDerCorput(-1)).toBe(vanDerCorput(65535));
  });
});
