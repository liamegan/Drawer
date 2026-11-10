import { describe, expect, it } from "vitest";
import {
  blade,
  leaf,
  lobed,
  parametric,
  petal,
  serrate,
  taper,
  type Profile,
} from "./profiles.js";

const ts = Array.from({ length: 1001 }, (_, i) => i / 1000);

function argmax(profile: Profile): number {
  let best = 0;
  for (const t of ts) if (profile(t) > profile(best)) best = t;
  return best;
}

describe("profiles", () => {
  it("stay within [0, 1]", () => {
    const all = [
      leaf(),
      leaf({ widest: 0.7 }),
      blade(),
      blade({ taper: 1 }),
      petal(),
      taper(),
      taper(0.3, 0.8),
      serrate(leaf(), 9),
      lobed(leaf(), 5),
    ];
    for (const profile of all) {
      for (const t of [...ts, -0.5, 1.5]) {
        const w = profile(t);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it("are widest where asked, and pointed where they should be", () => {
    for (const widest of [0.25, 0.4, 0.6]) {
      expect(argmax(leaf({ widest }))).toBeCloseTo(widest, 2);
      expect(leaf({ widest })(widest)).toBeCloseTo(1, 9);
    }
    expect(leaf()(0)).toBe(0);
    expect(leaf()(1)).toBeCloseTo(0, 9);
    expect(argmax(petal({ widest: 0.7 }))).toBeCloseTo(0.7, 2);
    expect(petal()(0)).toBe(0);
    expect(petal()(1)).toBe(0);
    expect(blade()(0)).toBe(1);
    expect(blade()(1)).toBe(0);
    // A higher taper keeps the blade wide for longer.
    expect(blade({ taper: 5 })(0.6)).toBeGreaterThan(blade({ taper: 1 })(0.6));
    expect(taper(1, 0)(0.25)).toBeCloseTo(0.75);
  });

  it("serrate and lobed cut into the edge without widening it", () => {
    const base = leaf();
    const saw = serrate(base, 8, 0.2);
    const lobes = lobed(base, 4, 0.6);
    let sawCut = 0;
    let lobeCut = 0;
    for (const t of ts) {
      if (base(t) < 1e-3) continue;
      expect(saw(t)).toBeLessThanOrEqual(base(t) + 1e-12);
      expect(lobes(t)).toBeLessThanOrEqual(base(t) + 1e-12);
      sawCut = Math.max(sawCut, 1 - saw(t) / base(t));
      lobeCut = Math.max(lobeCut, 1 - lobes(t) / base(t));
    }
    expect(sawCut).toBeCloseTo(0.2, 2);
    expect(lobeCut).toBeCloseTo(0.6, 2);
    // Lobes are full width midway between the gaps.
    expect(lobes(0.375)).toBeCloseTo(base(0.375), 9);
    expect(() => serrate(base, 0)).toThrow(RangeError);
    expect(() => lobed(base, 3, 2)).toThrow(RangeError);
    expect(() => leaf({ widest: 1 })).toThrow(RangeError);
  });
});

describe("parametric", () => {
  it("works out the width per height of a monotone outline", () => {
    // GM's herb leaf, with its hand-written inverse to compare against.
    const herb = parametric((t) => [
      Math.sin(t ** 0.4 * Math.PI),
      Math.sin((t * Math.PI) / 2),
    ]);
    expect(herb.yMin).toBe(0);
    expect(herb.yMax).toBeCloseTo(1, 12);
    for (const y of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const t = Math.asin(y) / (Math.PI / 2);
      expect(herb.width(y)).toBeCloseTo(Math.sin(t ** 0.4 * Math.PI), 2);
    }
    expect(herb.width(-0.1)).toBe(0);
    expect(herb.width(1.1)).toBe(0);
  });

  it("takes the widest part where the outline turns back", () => {
    const curve = (t: number): [number, number] => [
      Math.sin(t ** 0.8 * Math.PI),
      Math.sin(t * Math.PI * 0.8),
    ];
    const heart = parametric(curve);
    expect(heart.yMax).toBeCloseTo(1, 4);
    // The tip notch sits below the top of the lobes.
    const [xEnd, yEnd] = heart.outline[heart.outline.length - 1];
    expect(xEnd).toBeCloseTo(0, 9);
    expect(yEnd).toBeLessThan(0.65);
    // Brute force: the widest x at each height over a dense sampling.
    for (const y of [0.1, 0.4, 0.62, 0.8, 0.97]) {
      let widest = 0;
      for (let i = 1; i <= 20000; i++) {
        const [x0, y0] = curve((i - 1) / 20000);
        const [x1, y1] = curve(i / 20000);
        if ((y0 - y) * (y1 - y) <= 0 && y1 !== y0) {
          widest = Math.max(widest, x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
        }
      }
      expect(Math.abs(heart.width(y) - widest)).toBeLessThan(0.01);
    }
  });
});
