import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Document } from "../document/Document.js";
import { paper } from "../document/paper.js";
import { Polyline } from "../geometry/Polyline.js";
import { line, rect } from "../geometry/shapes.js";
import { formatNumber, pathData, toSVG } from "./svg.js";

const makeDoc = () => {
  const doc = new Document({ paper: paper.A5, margin: 5 });
  doc.layer("outline", { color: "#112233", width: 0.5 }).add(rect(10, 10, 20, 20));
  doc.layer("detail <&>").add(line(new Vec2(0, 0), new Vec2(1.23456, 2)));
  return doc;
};

describe("formatNumber / pathData", () => {
  it("rounds and trims trailing zeros, without emitting -0", () => {
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(1.23456, 1)).toBe("1.2");
    expect(formatNumber(-0.0001)).toBe("0");
  });

  it("ends closed paths with Z and leaves open paths unterminated", () => {
    expect(pathData(rect(0, 0, 1, 1))).toBe("M0,0 L1,0 L1,1 L0,1 Z");
    expect(pathData(line(new Vec2(0, 0), new Vec2(2, 3)))).toBe("M0,0 L2,3");
  });
});

describe("toSVG", () => {
  const svg = toSVG(makeDoc());

  it("sizes the sheet in mm with a matching viewBox", () => {
    expect(svg).toContain('width="148mm" height="210mm" viewBox="0 0 148 210"');
  });

  it("writes one Inkscape layer per Layer, numbered in plotting order", () => {
    const groups = svg.match(/inkscape:groupmode="layer"/g) ?? [];
    expect(groups.length).toBe(2);
    expect(svg).toContain('inkscape:label="1-outline"');
    expect(svg.indexOf('id="layer1"')).toBeLessThan(svg.indexOf('id="layer2"'));
  });

  it("strokes with the pen and never fills", () => {
    expect(svg).toContain('fill="none" stroke="#112233" stroke-width="0.5"');
    expect(svg).not.toMatch(/fill="(?!none)/);
  });

  it("escapes layer names", () => {
    expect(svg).toContain('inkscape:label="2-detail &lt;&amp;&gt;"');
  });

  it("applies precision to coordinates", () => {
    expect(svg).toContain('d="M0,0 L1.235,2"');
    expect(toSVG(makeDoc(), { precision: 1 })).toContain('d="M0,0 L1.2,2"');
  });

  it("skips degenerate paths", () => {
    const doc = new Document();
    doc.add("x", new Polyline([new Vec2(1, 1)]));
    expect(toSVG(doc)).not.toContain("<path");
  });

  it("writes a title and an escaped description only when given", () => {
    expect(svg).not.toContain("<desc>");
    const described = toSVG(makeDoc(), {
      title: "Stones — seed 4",
      description: "View: oblique\nKinds: urn & block",
    });
    expect(described).toContain("<title>Stones — seed 4</title>");
    expect(described).toContain("<desc>View: oblique\nKinds: urn &amp; block</desc>");
  });

  it("only adds a background when asked", () => {
    expect(svg).not.toContain("<rect");
    expect(toSVG(makeDoc(), { background: true })).toContain('fill="#ffffff"');
    expect(toSVG(makeDoc(), { background: "#eee" })).toContain('fill="#eee"');
  });
});
