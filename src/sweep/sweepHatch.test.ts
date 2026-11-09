import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { catmullRom } from "../geometry/curves.js";
import { Polyline } from "../geometry/Polyline.js";
import { segmentDistance } from "../geometry/simplify.js";
import { sdf } from "../sdf/SDF.js";
import { leaf, parametric, taper } from "./profiles.js";
import { Sweep } from "./Sweep.js";
import { sweepHatch } from "./sweepHatch.js";

const v = (x: number, y: number) => new Vec2(x, y);
const straight = (length: number) => new Polyline([v(0, 0), v(length, 0)]);
const curvy = catmullRom([v(0, 0), v(10, -6), v(22, -4), v(30, 6)]);

/** Distance from q to the closed ring. */
function ringGap(ring: Polyline, q: Vec2): number {
  const p = ring.points;
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    best = Math.min(best, segmentDistance(q.x, q.y, a.x, a.y, b.x, b.y));
  }
  return best;
}

function ink(lines: readonly Polyline[]): number {
  return lines.reduce((sum, l) => sum + l.length, 0);
}

/** True if any segments of two different lines cross. */
function anyCross(lines: readonly Polyline[]): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i].points;
      const q = lines[j].points;
      for (let a = 1; a < p.length; a++) {
        for (let b = 1; b < q.length; b++) {
          const d1 = cross(q[b - 1], q[b], p[a - 1]);
          const d2 = cross(q[b - 1], q[b], p[a]);
          const d3 = cross(p[a - 1], p[a], q[b - 1]);
          const d4 = cross(p[a - 1], p[a], q[b]);
          if (d1 * d2 < 0 && d3 * d4 < 0) return true;
        }
      }
    }
  }
  return false;
}

/** y on `line` at x, or null if it doesn't reach x (lines run along +x). */
function yAt(line: Polyline, x: number): number | null {
  const p = line.points;
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1], p[i]];
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return null;
}

describe("sweepHatch across", () => {
  it("lays lines `spacing` apart along the spine, edge to edge", () => {
    const s = new Sweep(straight(20), { width: 6, profile: taper(1, 1) });
    const lines = sweepHatch(s, { spacing: 1 });
    expect(lines).toHaveLength(20);
    lines.forEach((line, i) => {
      expect(line.pointCount).toBe(2);
      for (const p of line.points) expect(p.x).toBeCloseTo(0.5 + i, 9);
      const ys = line.points.map((p) => p.y).sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(-3, 9);
      expect(ys[1]).toBeCloseTo(3, 9);
    });
    const shifted = sweepHatch(s, { spacing: 2, offset: 0.25 });
    expect(shifted[0].points[0].x).toBeCloseTo(0.25, 9);
  });

  it("ends lines on the outline of a curved leaf, square to the spine", () => {
    const s = new Sweep(curvy, { width: 8, profile: leaf() });
    const lines = sweepHatch(s, { spacing: 0.8 });
    expect(lines.length).toBeGreaterThan(30);
    for (const line of lines) {
      expect(line.pointCount).toBe(2);
      expect(ringGap(s.outline, line.start!)).toBeLessThan(0.02);
      expect(ringGap(s.outline, line.end!)).toBeLessThan(0.02);
    }
    expect(anyCross(lines)).toBe(false);
  });

  it("bows lines towards the tip without crossing", () => {
    const s = new Sweep(straight(24), { width: 10, profile: leaf() });
    const lines = sweepHatch(s, { spacing: 1, bow: 3 });
    expect(lines.length).toBeGreaterThan(15);
    expect(anyCross(lines)).toBe(false);
    // A line near the middle: its ends lie further along than its centre.
    const mid = lines.find((l) => Math.abs(l.points[0].x - 13) < 1.5)!;
    const centre = yAt(new Polyline(mid.points.map((p) => v(p.y, p.x))), 0)!;
    expect(mid.start!.x).toBeGreaterThan(centre + 1);
    expect(mid.end!.x).toBeGreaterThan(centre + 1);
    for (const line of lines) {
      expect(ringGap(s.outline, line.start!)).toBeLessThan(0.02);
      expect(ringGap(s.outline, line.end!)).toBeLessThan(0.02);
    }
  });

  it("slants lines, and hatches only the span asked for", () => {
    const s = new Sweep(straight(20), { width: 6, profile: taper(1, 1) });
    const slanted = sweepHatch(s, { spacing: 1, slant: 2 });
    expect(anyCross(slanted)).toBe(false);
    const right = sweepHatch(s, { spacing: 1, span: [0, 1] });
    expect(right).toHaveLength(20);
    for (const line of right) {
      const ys = line.points.map((p) => p.y).sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(0, 9);
      expect(ys[1]).toBeCloseTo(3, 9);
    }
    expect(() => sweepHatch(s, { spacing: 1, span: [0.5, 0.2] })).toThrow(
      RangeError,
    );
  });

  it("doesn't pick up stray pieces where the sweep curls round", () => {
    const flat = new Sweep(straight(40), { width: 4, profile: leaf() });
    const curled = new Sweep(straight(40), {
      width: 4,
      profile: leaf(),
      bend: 1.6 * Math.PI, // nearly a full ring: radius 8, ends 4.8 mm apart
    });
    const a = sweepHatch(flat, { spacing: 0.7 });
    const b = sweepHatch(curled, { spacing: 0.7 });
    expect(b).toHaveLength(a.length);
    for (const line of b) expect(line.length).toBeLessThanOrEqual(4 + 1e-6);
  });

  it("cuts lines at a heart's notch", () => {
    const heart = parametric((t) => [
      Math.sin(t ** 0.8 * Math.PI),
      Math.sin(t * Math.PI * 0.8),
    ]);
    const s = new Sweep(straight(20), { width: 12, profile: heart });
    const lines = sweepHatch(s, { spacing: 0.5 });
    const inside = sdf(s.outline);
    for (const line of lines) {
      for (const p of line.points) {
        expect(inside.at(p.x, p.y)).toBeLessThan(0.03);
      }
    }
    // Above the notch, lines come in pairs, one per lobe.
    const notch = heart.outline[heart.outline.length - 1][1] * 20;
    const high = lines.filter((l) => l.start!.x > notch + 0.5);
    expect(high.length).toBeGreaterThan(4);
    const xs = new Set(high.map((l) => l.start!.x.toFixed(6)));
    expect(high.length).toBe(2 * xs.size);
  });
});

describe("sweepHatch along", () => {
  const blade = new Sweep(straight(30), { width: 8, profile: leaf() });

  it("keeps each line at a constant fraction of the width", () => {
    const lines = sweepHatch(blade, {
      direction: "along",
      spacing: 0.8,
      thin: false,
    });
    expect(lines.length).toBe(2 * Math.round(4 / 0.8) - 1);
    for (const line of lines) {
      const fractions = line.points
        .filter((p) => p.x > 0.5 && p.x < 29.5)
        .map((p) => p.y / blade.halfWidth(p.x / 30));
      for (const f of fractions) expect(f).toBeCloseTo(fractions[0], 6);
    }
    // Without thinning, the lines all run in to the tip.
    const gaps: number[] = [];
    for (const line of lines) {
      const y = yAt(line, 29.6);
      if (y !== null) gaps.push(y);
    }
    gaps.sort((a, b) => a - b);
    expect(gaps).toHaveLength(lines.length);
    expect(gaps[gaps.length - 1] - gaps[0]).toBeLessThan(0.5);
  });

  it("thins lines out in pairs so they never crowd, right to the tip", () => {
    for (const thin of [true, 0.72] as const) {
      const ratio = thin === true ? 0.5 : thin;
      const spacing = 0.6;
      const lines = sweepHatch(blade, { direction: "along", spacing, thin });
      for (let x = 0.05; x < 30; x += 0.1) {
        const w = blade.halfWidth(x / 30);
        const ys = lines
          .map((l) => yAt(l, x))
          .filter((y): y is number => y !== null)
          .sort((a, b) => a - b);
        expect(ys.length).toBeGreaterThan(0); // the spine always runs
        for (let i = 1; i < ys.length; i++) {
          expect(ys[i] - ys[i - 1]).toBeGreaterThan(ratio * spacing * 0.98);
        }
        // The edges count as lines too, for every line but the spine.
        const off = ys.filter((y) => Math.abs(y) > 1e-9);
        if (off.length > 0) {
          const least = Math.min(w - off[off.length - 1], off[0] + w);
          expect(least).toBeGreaterThan(ratio * spacing * 0.98);
        }
      }
    }
  });

  it("staggers where thinned lines end, instead of a step in tone", () => {
    const lines = sweepHatch(blade, { direction: "along", spacing: 0.4 });
    const ends = lines
      .filter((l) => l.points.some((p) => Math.abs(p.y) > 1e-9))
      .map((l) => l.end!.x);
    expect(ends.length).toBeGreaterThan(10);
    const sorted = [...ends].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.01);
    }
  });

  it("covers about `tone` of a straight sweep, either way", () => {
    const strip = new Sweep(straight(40), { width: 20, profile: taper(1, 1) });
    for (const direction of ["across", "along"] as const) {
      const lines = sweepHatch(strip, { direction, tone: 0.3, pen: 0.3 });
      const coverage = (0.3 * ink(lines)) / (40 * 20);
      expect(coverage / 0.3).toBeGreaterThan(0.9);
      expect(coverage / 0.3).toBeLessThan(1.05);
    }
    expect(sweepHatch(strip, { tone: 0.05, pen: 0.3 })).toEqual([]);
    expect(() => sweepHatch(strip, {})).toThrow(RangeError);
  });

  it("keeps to one side with span, and inside an inset", () => {
    const right = sweepHatch(blade, {
      direction: "along",
      spacing: 0.8,
      span: [0, 1],
    });
    for (const line of right) {
      for (const p of line.points) expect(p.y).toBeGreaterThanOrEqual(-1e-9);
    }
    const distance = sdf(blade.outline);
    for (const direction of ["across", "along"] as const) {
      const lines = sweepHatch(blade, { direction, spacing: 0.6, inset: 0.8 });
      expect(lines.length).toBeGreaterThan(5);
      for (const line of lines) {
        for (const p of line.points) {
          expect(distance.at(p.x, p.y)).toBeLessThan(-0.8 + 0.03);
        }
      }
    }
  });
});
