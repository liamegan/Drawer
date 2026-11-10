import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Bounds } from "../geometry/Bounds.js";
import { line, rect } from "../geometry/shapes.js";
import { Sheet } from "./Sheet.js";
import { DEFAULT_PEN } from "./Layer.js";
import { customPaper, paper } from "./paper.js";

describe("Sheet", () => {
  it("defaults to A4 portrait with a 10 mm margin", () => {
    const sheet = new Sheet();
    expect([sheet.width, sheet.height, sheet.margin]).toEqual([210, 297, 10]);
    const a = sheet.drawArea;
    expect([a.x, a.y, a.width, a.height]).toEqual([10, 10, 190, 277]);
  });

  it("swaps width and height for landscape", () => {
    const sheet = new Sheet({ paper: paper.A3, orientation: "landscape", margin: 0 });
    expect([sheet.width, sheet.height]).toEqual([420, 297]);
  });

  it("leaves square custom paper alone", () => {
    const sheet = new Sheet({ paper: customPaper(200, 200), orientation: "landscape" });
    expect([sheet.width, sheet.height]).toEqual([200, 200]);
  });

  it("layer() creates once, keeps order and merges pens", () => {
    const sheet = new Sheet();
    const ink = sheet.layer("ink", { color: "red" });
    sheet.layer("wash");
    expect(sheet.layer("ink")).toBe(ink);
    expect(sheet.layers.map((l) => l.name)).toEqual(["ink", "wash"]);
    expect(ink.pen).toEqual({ color: "red", width: DEFAULT_PEN.width });
    sheet.layer("ink", { width: 0.5 });
    expect(ink.pen).toEqual({ color: "red", width: 0.5 });
  });

  it("add() creates layers on demand and totals paths and length", () => {
    const sheet = new Sheet();
    sheet.add("a", line(new Vec2(0, 0), new Vec2(10, 0)));
    sheet.add("b", line(new Vec2(0, 0), new Vec2(0, 5)), line(new Vec2(0, 0), new Vec2(3, 4)));
    expect(sheet.pathCount).toBe(3);
    expect(sheet.length).toBeCloseTo(20);
    sheet.clear();
    expect(sheet.layers.length).toBe(0);
  });

  it("defaults the occlusion settings and creates the page mask on first use", () => {
    const sheet = new Sheet({ paper: paper.A6, occlusion: { gap: 0.4 } });
    expect(sheet.occlusion).toEqual({ resolution: 10, gap: 0.4, minLength: 0.2 });
    expect(sheet.mask).toBe(sheet.mask);
    expect([sheet.mask.width, sheet.mask.height, sheet.mask.cols]).toEqual([105, 148, 1050]);
  });
});

describe("Sheet.draw", () => {
  const v = (x: number, y: number) => new Vec2(x, y);
  const horizontal = (y: number) => line(v(0, y), v(100, y));

  it("hides what is behind earlier shapes and leaves the front shape whole", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    const front = rect(20, 20, 40, 40);
    expect(sheet.draw("ink", front)).toEqual([front]);
    const behind = sheet.draw("ink", horizontal(40));
    expect(behind).toHaveLength(2);
    expect(behind[0].end!.x).toBeCloseTo(20, 1);
    expect(behind[1].start!.x).toBeCloseTo(60, 1);
    expect(sheet.layer("ink").paths).toEqual([front, ...behind]);
  });

  it("clips a shape behind another and returns exactly what it added", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    sheet.draw("ink", rect(20, 20, 40, 40));
    const added = sheet.draw("other", rect(40, 40, 40, 40));
    expect(added.length).toBeGreaterThan(0);
    for (const piece of added) {
      for (const p of piece.points) expect(p.x >= 59.9 || p.y >= 59.9).toBe(true);
    }
    expect(sheet.layer("other").paths).toEqual(added);
  });

  it("occlude: false draws everything but still stamps the silhouette", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    sheet.draw("ink", rect(20, 20, 40, 40));
    const square = rect(40, 40, 40, 40);
    expect(sheet.draw("ink", square, { occlude: false })).toEqual([square]);
    expect(sheet.mask.covered(70, 70)).toBe(true);
  });

  it("silhouette: false stamps nothing; an explicit silhouette is used instead", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    sheet.draw("ink", rect(20, 20, 40, 40), { silhouette: false });
    expect(sheet.draw("ink", horizontal(40))).toHaveLength(1);
    sheet.draw("ink", horizontal(80), { silhouette: rect(70, 70, 10, 10) });
    expect(sheet.draw("ink", horizontal(75))).toHaveLength(2);
  });

  it("keeps later lines a gap away from the outline", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100), occlusion: { gap: 0.5 } });
    sheet.draw("ink", rect(20, 20, 40, 40));
    const [left, right] = sheet.draw("ink", horizontal(40));
    expect(left.end!.x).toBeCloseTo(19.5, 1);
    expect(right.start!.x).toBeCloseTo(60.5, 1);
    const [tight] = sheet.draw("ink", horizontal(10), { gap: 0 });
    expect(tight.length).toBeCloseTo(100, 4);
  });

  it("an open silhouette with a gap keeps later lines from crossing it", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    sheet.draw("ink", line(v(50, 0), v(50, 100)), { silhouette: line(v(50, 0), v(50, 100)), gap: 1 });
    const pieces = sheet.draw("ink", horizontal(30));
    expect(pieces).toHaveLength(2);
    expect(pieces[0].end!.x).toBeCloseTo(49, 1);
  });

  it("clips to bounds, with or without occlusion", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    const bounds = Bounds.fromRect(10, 0, 80, 100);
    for (const occlude of [true, false]) {
      const [piece] = sheet.draw("ink", horizontal(50), { bounds, occlude });
      expect(piece.start!.x).toBeCloseTo(10, 4);
      expect(piece.end!.x).toBeCloseTo(90, 4);
    }
  });

  it("clear() also clears the mask", () => {
    const sheet = new Sheet({ paper: customPaper(100, 100) });
    sheet.draw("ink", rect(20, 20, 40, 40));
    sheet.clear();
    expect(sheet.draw("ink", horizontal(40))).toHaveLength(1);
  });
});
