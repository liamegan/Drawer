import { describe, expect, it } from "vitest";
import { Bounds } from "../geometry/Bounds.js";
import { Random } from "./Random.js";

const take = (r: Random, n: number) => Array.from({ length: n }, () => r.value());

describe("Random", () => {
  it("is deterministic for a given seed", () => {
    expect(take(new Random(42), 20)).toEqual(take(new Random(42), 20));
    expect(take(new Random("hello"), 20)).toEqual(take(new Random("hello"), 20));
  });

  it("differs between seeds, including number vs similar number", () => {
    expect(take(new Random(1), 5)).not.toEqual(take(new Random(2), 5));
  });

  it("treats a number seed and its string form as the same seed", () => {
    expect(take(new Random(123), 5)).toEqual(take(new Random("123"), 5));
  });

  it("keeps value() in [0, 1) and looks roughly uniform", () => {
    const vals = take(new Random(7), 10000);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThan(1);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it("int is inclusive at both ends and stays in range", () => {
    const r = new Random(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("fork depends on the seed and label, not on how much the parent has drawn", () => {
    const a = new Random("s");
    const b = new Random("s");
    take(b, 100); // advance b only
    expect(take(a.fork("grass"), 10)).toEqual(take(b.fork("grass"), 10));
    expect(take(a.fork("grass"), 10)).not.toEqual(take(a.fork("rocks"), 10));
  });

  it("shuffle returns a permutation without touching the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = new Random(9).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it("pick, bool, gaussian and pointIn behave", () => {
    const r = new Random(11);
    expect(["a", "b"]).toContain(r.pick(["a", "b"]));
    expect(() => r.pick([])).toThrow(RangeError);
    expect(r.bool(0)).toBe(false);
    expect(r.bool(1)).toBe(true);
    const g = Array.from({ length: 5000 }, () => r.gaussian(10, 2));
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    expect(mean).toBeGreaterThan(9.8);
    expect(mean).toBeLessThan(10.2);
    const b = Bounds.fromRect(5, 5, 10, 10);
    for (let i = 0; i < 100; i++) expect(b.contains(r.pointIn(b))).toBe(true);
  });
});
