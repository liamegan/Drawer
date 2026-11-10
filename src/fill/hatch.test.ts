import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import { circle, polygon, rect } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { sdf } from "../sdf/SDF.js";
import { hatch, sine } from "./hatch.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** Distance across the hatch direction, as hatch measures it. */
const lineYs = (lines: Polyline[]) =>
  [...new Set(lines.map((l) => Number(l.start!.y.toFixed(6))))];

const across = (p: Vec2, angle: number) =>
  -p.x * Math.sin(angle) + p.y * Math.cos(angle);

/** A random, possibly concave polygon around a centre. */
function blob(random: Random, cx: number, cy: number): Polyline {
  const n = random.int(5, 14);
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = random.range(4, 20);
      return v(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }),
    true,
  );
}

const pentagram = new Polyline(
  Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    return v(30 + Math.cos(a) * 20, 30 + Math.sin(a) * 20);
  }),
  true,
);

/** A U shape opening downwards: arms at x 0–3 and 7–10, joined along the top. */
const uShape = new Polyline(
  [
    v(0, 0),
    v(10, 0),
    v(10, 10),
    v(7, 10),
    v(7, 3),
    v(3, 3),
    v(3, 10),
    v(0, 10),
  ],
  true,
);

function distanceToEdges(p: Vec2, shapes: Polyline[]): number {
  let best = Infinity;
  for (const s of shapes) {
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
  }
  return best;
}

/** Points strictly inside every segment of every line. */
function samples(lines: Polyline[]): Vec2[] {
  const out: Vec2[] = [];
  for (const l of lines) {
    const pts = l.points;
    for (let i = 1; i < pts.length; i++) {
      for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
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

describe("hatch", () => {
  it("never puts ink outside the shape, and ends exactly on its edges", () => {
    const random = new Random("hatch-inside");
    const cases: [Polyline[], FillRule][] = [
      [[pentagram], "nonzero"],
      [[pentagram], "evenodd"],
      [[rect(0, 0, 40, 40), rect(10, 10, 20, 20).reversed()], "nonzero"],
      [[rect(0, 0, 40, 40), rect(10, 10, 20, 20)], "evenodd"],
      [[uShape], "nonzero"],
    ];
    for (let i = 0; i < 20; i++) cases.push([[blob(random, 30, 30)], "nonzero"]);

    for (const [shapes, rule] of cases) {
      const inside = insideTest(shapes, rule);
      const angle = random.range(-Math.PI, Math.PI);
      const lines = hatch(shapes, { spacing: 0.7, angle, rule });
      expect(lines.length).toBeGreaterThan(0);
      for (const p of samples(lines)) expect(inside(p.x, p.y)).toBe(true);
      for (const l of lines) {
        expect(distanceToEdges(l.start!, shapes)).toBeLessThan(1e-9);
        expect(distanceToEdges(l.end!, shapes)).toBeLessThan(1e-9);
      }
    }
  });

  it("spaces lines exactly and keeps them off grid-aligned edges by default", () => {
    const lines = hatch(rect(0, 0, 10, 10), { spacing: 1 });
    const ys = lines.map((l) => l.start!.y).sort((a, b) => a - b);
    expect(ys).toHaveLength(10);
    ys.forEach((y, i) => expect(y).toBeCloseTo(0.5 + i, 9));
    const onGrid = hatch(rect(0, 0, 10, 10), { spacing: 1, offset: 0 });
    expect(onGrid.some((l) => l.start!.y === 0)).toBe(true);
  });

  it("lines up separate shapes on the page lattice", () => {
    const angle = 0.3;
    const spacing = 1.3;
    const a = hatch(circle(v(20, 20), 9), { spacing, angle });
    const b = hatch(polygon(v(61, 37), 12, 5), { spacing, angle });
    for (const l of [...a, ...b]) {
      const k = across(l.start!, angle) / spacing - 0.5;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });

  it("centres a local lattice on the shape", () => {
    const shape = rect(3.3, 7.1, 20, 12.4);
    const lines = hatch(shape, { spacing: 1.1, anchor: "local", offset: 0 });
    const ys = lines.map((l) => l.start!.y);
    const centre = shape.bounds.center.y;
    expect(Math.min(...ys) - centre).toBeCloseTo(centre - Math.max(...ys), 9);
    expect(ys.some((y) => Math.abs(y - centre) < 1e-9)).toBe(true);
  });

  it("turns lines clockwise for a positive angle, like rotation()", () => {
    const vertical = hatch(rect(0, 0, 10, 10), { spacing: 1, angle: Math.PI / 2 });
    for (const l of vertical) expect(l.start!.x).toBeCloseTo(l.end!.x, 9);
    const tilted = hatch(rect(0, 0, 10, 10), {
      spacing: 1,
      angle: 0.2,
      alternate: false,
    });
    for (const l of tilted) {
      expect(l.end!.x).toBeGreaterThan(l.start!.x);
      expect(l.end!.y).toBeGreaterThan(l.start!.y);
    }
  });

  it("alternates direction line by line unless told not to", () => {
    const zigzag = hatch(rect(0, 0, 10, 10), { spacing: 1 });
    const dirs = zigzag
      .sort((a, b) => a.start!.y - b.start!.y)
      .map((l) => Math.sign(l.end!.x - l.start!.x));
    for (let i = 1; i < dirs.length; i++) expect(dirs[i]).toBe(-dirs[i - 1]);
    const same = hatch(rect(0, 0, 10, 10), { spacing: 1, alternate: false });
    expect(same.every((l) => l.end!.x > l.start!.x)).toBe(true);
  });

  it("joins lines into zigzags that stay inside, even in a concave shape", () => {
    const disc = circle(v(20, 20), 10);
    const joined = hatch(disc, { spacing: 1, join: true });
    // Chains break near the top and bottom, where connectors exceed maxJoin.
    expect(joined.length).toBeLessThan(hatch(disc, { spacing: 1 }).length / 3);
    const insideDisc = insideTest(disc);
    for (const p of samples(joined)) expect(insideDisc(p.x, p.y)).toBe(true);

    const insideU = insideTest(uShape);
    const arms = hatch(uShape, { spacing: 0.5, join: true });
    for (const p of samples(arms)) expect(insideU(p.x, p.y)).toBe(true);
    expect(arms.length).toBeGreaterThanOrEqual(2);
  });

  it("drops pieces shorter than minLength and ignores open paths", () => {
    const thin = rect(0, 0, 0.1, 10);
    expect(hatch(thin, { spacing: 1 })).toEqual([]);
    expect(hatch(thin, { spacing: 1, minLength: 0 })).toHaveLength(10);
    expect(hatch(new Polyline(rect(0, 0, 10, 10).points), { spacing: 1 })).toEqual(
      [],
    );
  });

  it("draws sine waves inside the shape, in phase across shapes", () => {
    const amplitude = 0.3;
    const wavelength = 4;
    const style = sine({ amplitude, wavelength });
    const shapes = [circle(v(20, 20), 9), rect(40, 5, 15, 30)];
    for (const shape of shapes) {
      const lines = hatch(shape, { spacing: 1, style });
      const inside = insideTest(shape);
      for (const p of samples(lines)) expect(inside(p.x, p.y)).toBe(true);
      // Every interior point sits on its lattice line's wave, phase taken from page x.
      for (const l of lines) {
        for (const p of l.points.slice(1, -1)) {
          const base = Math.round(p.y - 0.5) + 0.5;
          const wave = amplitude * Math.sin((p.x * Math.PI * 2) / wavelength);
          expect(p.y - base).toBeCloseTo(wave, 9);
        }
      }
    }
  });

  it("keeps lines `inset` inside the outline, measured square to it", () => {
    const random = new Random("inset");
    const inset = 0.8;
    for (let trial = 0; trial < 5; trial++) {
      const shape = blob(random, 30, 30);
      const field = sdf(shape);
      for (const angle of [0, 0.4, 1.3]) {
        for (const style of [undefined, sine({ amplitude: 0.3, wavelength: 3 })]) {
          const lines = hatch(shape, { spacing: 1, angle, inset, style });
          expect(lines.length).toBeGreaterThan(5);
          const depths = lines.flatMap((l) =>
            [l.start!, l.end!].map((p) => -field.at(p.x, p.y)),
          );
          // Ends sit on the inset outline, whatever angle they meet it at.
          // Never nearer the edge; a little further only where the inset
          // outline's sharp corners are cut (half a cell's diagonal at most).
          for (const depth of depths) {
            expect(depth).toBeGreaterThan(inset - 0.02);
            expect(depth).toBeLessThan(inset + 0.15);
          }
          depths.sort((a, b) => a - b);
          expect(depths[depths.length >> 1]).toBeCloseTo(inset, 2);
          for (const p of samples(lines)) {
            expect(field.at(p.x, p.y)).toBeLessThan(-inset + 0.02);
          }
        }
      }
    }
  });

  it("insets without moving the lattice, and joins inside the inset", () => {
    for (const anchor of ["page", "local"] as const) {
      const shape = rect(0.3, 0.3, 20, 13);
      const all = new Set(lineYs(hatch(shape, { spacing: 1, anchor })));
      const inset = lineYs(hatch(shape, { spacing: 1, anchor, inset: 2 }));
      expect(inset.length).toBeGreaterThan(5);
      for (const y of inset) expect(all.has(y)).toBe(true);
    }
    const field = sdf(uShape);
    const joined = hatch(uShape, { spacing: 0.4, join: true, inset: 0.5 });
    for (const p of samples(joined)) {
      expect(field.at(p.x, p.y)).toBeLessThan(-0.5 + 0.02);
    }
  });

  it("returns nothing when the inset swallows the shape, and rejects a negative one", () => {
    expect(hatch(rect(0, 0, 4, 4), { spacing: 0.5, inset: 2.5 })).toEqual([]);
    expect(() => hatch(rect(0, 0, 4, 4), { spacing: 1, inset: -1 })).toThrow(
      RangeError,
    );
  });

  it("rejects a bad spacing", () => {
    expect(() => hatch(rect(0, 0, 1, 1), { spacing: 0 })).toThrow(RangeError);
  });
});
