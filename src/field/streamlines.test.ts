import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { insideTest } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { Region } from "../geometry/region.js";
import { circle, rect } from "../geometry/shapes.js";
import { segmentDistance } from "../geometry/simplify.js";
import { Mask } from "../mask/Mask.js";
import { Noise } from "../noise/Noise.js";
import { Random } from "../random/Random.js";
import { angleField, curlField, type VectorField } from "./fields.js";
import { streamlines } from "./streamlines.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** Distance from (x, y) to the nearest line, skipping line `skip`. */
function nearestLine(lines: readonly Polyline[]) {
  const cell = 1;
  const buckets = new Map<string, number[][]>();
  lines.forEach((line, id) => {
    const p = line.points;
    for (let i = 1; i < p.length; i++) {
      const seg = [p[i - 1].x, p[i - 1].y, p[i].x, p[i].y, id];
      const x0 = Math.floor(Math.min(seg[0], seg[2]) / cell) - 1;
      const x1 = Math.floor(Math.max(seg[0], seg[2]) / cell) + 1;
      const y0 = Math.floor(Math.min(seg[1], seg[3]) / cell) - 1;
      const y1 = Math.floor(Math.max(seg[1], seg[3]) / cell) + 1;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(seg);
        }
      }
    }
  });
  return (x: number, y: number, skip = -1) => {
    let best = Infinity;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (const s of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (s[4] === skip) continue;
          best = Math.min(best, segmentDistance(x, y, s[0], s[1], s[2], s[3]));
        }
      }
    }
    return best;
  };
}

/** Closest approach between different lines, and gaps at random points. */
function spacing(lines: readonly Polyline[], region: Region, samples = 3000) {
  const near = nearestLine(lines);
  let closest = Infinity;
  lines.forEach((line, id) => {
    for (const p of line.points)
      closest = Math.min(closest, near(p.x, p.y, id));
  });
  const box = region.bounds!;
  const random = new Random("gaps");
  const gaps: number[] = [];
  while (gaps.length < samples) {
    const x = random.range(box.min.x, box.max.x);
    const y = random.range(box.min.y, box.max.y);
    if (region.contains(x, y)) gaps.push(near(x, y));
  }
  gaps.sort((a, b) => a - b);
  return {
    closest,
    p99: gaps[Math.floor(samples * 0.99)],
    widest: gaps[samples - 1],
  };
}

const noise = new Noise(new Random("streamlines"));
const curl = curlField((x, y) =>
  noise.fbm2(x, y, { frequency: 0.03, octaves: 3 }),
);

const blob = new Polyline(
  Array.from({ length: 300 }, (_, i) => {
    const a = (i / 300) * Math.PI * 2;
    const r = 25 * (1 + 0.2 * Math.sin(3 * a) + 0.1 * Math.cos(5 * a));
    return v(40 + Math.cos(a) * r, 40 + Math.sin(a) * r);
  }),
  true,
);

describe("streamlines", () => {
  it("lays a uniform field out as parallel lines exactly a separation apart", () => {
    const square = rect(0, 0, 40, 40);
    const lines = streamlines(
      angleField(() => 0.3),
      {
        region: square,
        separation: 1.5,
      },
    );
    const stats = spacing(lines, new Region(square));
    expect(stats.closest).toBeCloseTo(1.5, 6);
    expect(stats.widest).toBeLessThan(1.5);
    // Every line runs straight across, edge to edge.
    for (const line of lines) {
      const d = line.end!.subtractNew(line.start!);
      expect(Math.atan2(d.y, d.x)).toBeCloseTo(0.3, 6);
    }
  });

  it("fills curl noise without crowding or leaving gaps", () => {
    for (const [region, separation] of [
      [rect(0, 0, 60, 60), 1],
      [blob, 0.8],
    ] as const) {
      const lines = streamlines(curl, { region, separation });
      const stats = spacing(lines, new Region(region));
      // Growing lines stop half a separation from others. Collisions are
      // checked between points a quarter separation apart, so the true
      // closest approach can be √(½² − ⅛²) ≈ 0.484 of it.
      expect(stats.closest).toBeGreaterThan(0.47 * separation);
      // New lines are tried a separation from every line, so no point is
      // much further than that from one.
      expect(stats.p99).toBeLessThan(0.85 * separation);
      expect(stats.widest).toBeLessThan(1.3 * separation);
    }
  });

  it("follows the field, and ends exactly on the region's edge", () => {
    const lines = streamlines(curl, {
      region: blob,
      separation: 1,
      simplify: 0,
    });
    const inside = insideTest(blob);
    const edge = blob.points;
    const toEdge = (p: Vec2) => {
      let best = Infinity;
      for (let i = 0; i < edge.length; i++) {
        const a = edge[i];
        const b = edge[(i + 1) % edge.length];
        best = Math.min(best, segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y));
      }
      return best;
    };
    let onEdge = 0;
    for (const line of lines) {
      const pts = line.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const [fx, fy] = curl((a.x + b.x) / 2, (a.y + b.y) / 2);
        const cos =
          ((b.x - a.x) * fx + (b.y - a.y) * fy) /
          (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(fx, fy));
        expect(cos).toBeGreaterThan(0.99);
      }
      for (const p of pts)
        expect(inside(p.x, p.y) || toEdge(p) < 1e-9).toBe(true);
      for (const end of [line.start!, line.end!])
        if (toEdge(end) < 1e-9) onEdge++;
    }
    expect(onEdge).toBeGreaterThan(20);
  });

  it("stops at ink already drawn", () => {
    const mask = new Mask(80, 80, 10);
    const disc = circle(v(40, 40), 12);
    mask.fill(disc);
    const lines = streamlines(
      angleField(() => 0),
      {
        region: rect(10, 10, 60, 60),
        separation: 1,
        stopAt: mask.hiddenTest(),
      },
    );
    for (const line of lines) {
      for (const p of line.points) {
        expect(Math.hypot(p.x - 40, p.y - 40)).toBeGreaterThan(12 - 0.1);
      }
    }
    // Lines through the disc's band end at it on both sides.
    const across = lines.filter((l) => Math.abs(l.start!.y - 40) < 8);
    expect(
      across.some(
        (l) =>
          Math.abs(l.end!.x - (40 - Math.sqrt(144 - (l.end!.y - 40) ** 2))) <
          0.15,
      ),
    ).toBe(true);
    expect(across.some((l) => l.start!.x > 45)).toBe(true);
  });

  it("closes orbits into rings, and stops at sinks", () => {
    const centre = v(30, 30);
    const swirl: VectorField = (x, y) => [-(y - centre.y), x - centre.x];
    const disc = circle(centre, 20);
    const rings = streamlines(swirl, { region: disc, separation: 2 });
    // One ring per separation out from the centre, each nearly closed.
    expect(rings.length).toBeGreaterThanOrEqual(9);
    expect(rings.length).toBeLessThanOrEqual(11);
    for (const ring of rings) {
      const r = Math.hypot(ring.start!.x - 30, ring.start!.y - 30);
      expect(ring.start!.distance(ring.end!)).toBeLessThan(2);
      expect(ring.length).toBeGreaterThan(2 * Math.PI * r - 2);
    }
    const sink: VectorField = (x, y) => [centre.x - x, centre.y - y];
    const spokes = streamlines(sink, { region: disc, separation: 2 });
    expect(spokes.length).toBeGreaterThan(5);
    for (const line of spokes) expect(line.length).toBeLessThanOrEqual(20.01);
  });

  it("fills every part of the region, holes and overlaps by the fill rule", () => {
    const parts = [
      circle(v(15, 15), 10),
      circle(v(60, 40), 10),
      circle(v(60, 40), 4).reversed(),
    ];
    const lines = streamlines(curl, { region: parts, separation: 1 });
    const near = nearestLine(lines);
    expect(near(15, 15)).toBeLessThan(1);
    expect(near(60, 49)).toBeLessThan(1);
    // Nothing inside the hole: a polygon, so test against it, not r = 4,
    // and at segment midpoints, since ends sit exactly on its edge.
    const inHole = insideTest(parts[2]);
    for (const line of lines) {
      const pts = line.points;
      for (let i = 1; i < pts.length; i++) {
        const mx = (pts[i].x + pts[i - 1].x) / 2;
        const my = (pts[i].y + pts[i - 1].y) / 2;
        expect(inHole(mx, my)).toBe(false);
      }
    }
    // Two overlapping squares under nonzero: one region, no edge between.
    const overlap = [rect(0, 0, 30, 30), rect(15, 15, 30, 30)];
    const flat = streamlines(
      angleField(() => 0),
      { region: overlap, separation: 1 },
    );
    expect(flat.some((l) => l.start!.x < 1 && l.end!.x > 44)).toBe(true);
  });

  it("crowds lines where the separation is small", () => {
    const square = rect(0, 0, 60, 30);
    const lines = streamlines(curl, {
      region: square,
      separation: (x) => (x < 30 ? 0.6 : 2),
    });
    const inkIn = (x0: number, x1: number) =>
      lines.reduce((sum, l) => {
        const pts = l.points;
        for (let i = 1; i < pts.length; i++) {
          const mx = (pts[i].x + pts[i - 1].x) / 2;
          if (mx >= x0 && mx < x1) sum += pts[i].distance(pts[i - 1]);
        }
        return sum;
      }, 0);
    // Ink per area goes as 1 / separation: about 3.3 times as much.
    const ratio = inkIn(2, 28) / inkIn(32, 58);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(4.2);
    // Nothing where the separation is infinite.
    const half = streamlines(curl, {
      region: square,
      separation: (x) => (x < 30 ? 1 : Infinity),
    });
    for (const l of half)
      for (const p of l.points) expect(p.x).toBeLessThan(30.6);
  });

  it("breaks the flow into dashes with maxLength", () => {
    const square = rect(0, 0, 40, 40);
    const dashes = streamlines(
      angleField(() => 0),
      {
        region: square,
        separation: 1,
        maxLength: 6,
      },
    );
    for (const d of dashes) expect(d.length).toBeLessThanOrEqual(6 + 1e-9);
    // Dashes carry on along the flow. The next dash grows back towards the
    // last until it's `test` separations away, so gaps are between half a
    // separation and one.
    const row = dashes
      .filter((d) => Math.abs(d.start!.y - dashes[0].start!.y) < 1e-9)
      .sort((a, b) => a.start!.x - b.start!.x);
    expect(row.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].start!.x - row[i - 1].end!.x;
      expect(gap).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(gap).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("is deterministic, and checks its options", () => {
    const a = streamlines(curl, { region: blob, separation: 1.2 });
    const b = streamlines(curl, { region: blob, separation: 1.2 });
    expect(a.map((l) => l.points)).toEqual(b.map((l) => l.points));
    expect(streamlines(curl, { region: [], separation: 1 })).toEqual([]);
    expect(() => streamlines(curl, { region: blob, separation: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      streamlines(curl, { region: blob, separation: 1, test: 0 }),
    ).toThrow(RangeError);
  });
});
