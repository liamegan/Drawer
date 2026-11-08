import { Vec2 } from "wtc-math";
import {
  circle,
  contourHatch,
  contourSpiral,
  hatch,
  isolines,
  paper,
  Polyline,
  sdf,
  shade,
  sine,
  type Random,
  type SDF,
} from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/** How a shape is filled. Every kind appears at least once per seed. */
const FILLS = [
  "contours", // contourHatch: rings that follow the outline
  "spiral", // contourSpiral: one stroke per lobe
  "shade", // shade({ contour: true }): rings, then cross-hatching as it darkens
  "metaball", // contourHatch({ exact: false }): creases where blobs met
  "inset", // parallel hatching kept 1.2 mm inside the outline
  "plain", // the same hatching without the inset, to compare
  "wave", // parallel hatching with the `sine` line style
] as const;
type Fill = (typeof FILLS)[number];

/**
 * Outline-following fills from distance fields. Each shape is an organic
 * blob, a cluster of blobs smooth-unioned together, or a blob with a bite
 * taken out of it, built as an SDF and outlined with `isolines`. Shapes are
 * drawn front to back (lowest on the page first) with the outline and fill
 * on separate pens. The nearest shape also gets a halo of grown outlines,
 * which hides whatever sits behind it.
 *
 * Debug (`d`) shows the blobs behind each smooth union and the circle taken
 * out of each bitten shape, dashed, and labels every shape with its fill and,
 * for a combined shape, its kind. "metaball" contours the combined field as
 * it is; every other contour fill re-traces its outline first.
 */
const sketch: Sketch = {
  title: "Contours",
  paper: paper.A5,
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.15 },

  draw(doc, random, debug) {
    const area = doc.drawArea;
    const rng = random.fork("shapes");

    doc.layer("outline", { color: "#1b1b1b", width: 0.3 });
    const fillLayer = doc.layer("fill", { color: "#3a3a3a", width: 0.25 });
    doc.layer("halo", { color: "#2f5d7c", width: 0.25 });
    const pen = fillLayer.pen.width;
    const light = new Vec2(-1, -1).normalise();

    // Spread the shapes out inside the area, letting them overlap a little.
    const placed: { center: Vec2; radius: number }[] = [];
    for (let tries = 0; tries < 400 && placed.length < 11; tries++) {
      const radius = rng.range(11, 21);
      const center = rng.pointIn(area.inset(radius * 1.25));
      const clear = placed.every(
        (p) => p.center.distance(center) > 0.7 * (p.radius + radius),
      );
      if (clear) placed.push({ center, radius });
    }
    const fills = [
      ...FILLS,
      ...Array.from({ length: placed.length }, () => rng.pick(FILLS)),
    ].slice(0, placed.length);

    const items = rng.shuffle(fills).map((fill, i) => {
      const { center, radius } = placed[i];
      const kind =
        fill === "metaball"
          ? "cluster"
          : rng.pick(["blob", "blob", "cluster", "bitten"] as const);
      return {
        fill,
        kind,
        center,
        radius,
        ...shapeField(rng, kind, center, radius),
      };
    });

    // Nearest first: the lower a shape sits on the page, the closer it is.
    items.sort((a, b) => b.center.y - a.center.y);

    for (const { fill, kind, center, parts, cuts } of items) {
      debug.path(parts);
      debug.path(cuts, "#e07a21");
      debug.label(kind === "blob" ? fill : `${fill} · ${kind}`, center);
    }

    items.forEach(({ fill, center, radius, field }, i) => {
      const outline = isolines(field, 0);
      doc.draw("outline", outline, { silhouette: false, bounds: area });
      const tone = (x: number, y: number) =>
        0.45 -
        0.4 * (((x - center.x) * light.x + (y - center.y) * light.y) / radius);
      doc.draw("fill", fillShape(fill, field, outline, rng, pen, tone), {
        silhouette: outline,
        bounds: area,
      });
      if (i === 0) {
        const halo = isolines(field, [1.5, 3, 4.5], { smooth: 1 });
        // Stamping the outermost ring hides what's behind the whole halo.
        doc.draw("halo", halo, {
          silhouette: isolines(field, 4.5),
          bounds: area,
        });
      }
    });
  },
};

function fillShape(
  fill: Fill,
  field: SDF,
  outline: Polyline[],
  rng: Random,
  pen: number,
  tone: (x: number, y: number) => number,
): Polyline[] {
  const spacing = 1.1;
  const angle = rng.range(0, Math.PI);
  switch (fill) {
    case "contours":
      return contourHatch(field, { spacing, smooth: 1 });
    case "spiral":
      return contourSpiral(field, { spacing, smooth: 1 });
    case "shade":
      return shade(outline, { tone, pen, contour: true, inset: 0.4 });
    case "metaball":
      return contourHatch(field, { spacing, exact: false, smooth: 1 });
    case "inset":
      return hatch(outline, { spacing: 0.9, angle, inset: 1.2 });
    case "plain":
      return hatch(outline, { spacing: 0.9, angle });
    case "wave":
      // Amplitude under half the spacing, so neighbouring waves never touch.
      return hatch(outline, {
        spacing: 1.2,
        angle,
        style: sine({ amplitude: 0.4, wavelength: 4 }),
      });
  }
}

/**
 * A shape's field, with the shapes it was built from: `parts` are unioned,
 * `cuts` subtracted.
 */
function shapeField(
  rng: Random,
  kind: "blob" | "cluster" | "bitten",
  center: Vec2,
  radius: number,
): { field: SDF; parts: Polyline[]; cuts: Polyline[] } {
  if (kind === "blob") {
    const blob = organic(rng, center, radius);
    return { field: sdf(blob), parts: [blob], cuts: [] };
  }
  if (kind === "cluster") {
    const parts = [organic(rng, center, radius * 0.65)];
    let field = sdf(parts[0]);
    for (let k = rng.int(1, 2); k > 0; k--) {
      const a = rng.range(0, Math.PI * 2);
      const offset = new Vec2(Math.cos(a), Math.sin(a)).scale(radius * 0.55);
      const blob = organic(
        rng,
        center.addNew(offset),
        radius * rng.range(0.35, 0.55),
      );
      parts.push(blob);
      field = field.union(sdf(blob), rng.range(3, 7));
    }
    return { field, parts, cuts: [] };
  }
  const a = rng.range(0, Math.PI * 2);
  const bite = circle(
    center.addNew(new Vec2(Math.cos(a), Math.sin(a)).scale(radius * 0.9)),
    radius * rng.range(0.35, 0.5),
  );
  const blob = organic(rng, center, radius);
  return {
    field: sdf(blob).subtract(sdf(bite), 1.5),
    parts: [blob],
    cuts: [bite],
  };
}

/** A circle with its radius rippled by a few random harmonics. */
function organic(rng: Random, center: Vec2, radius: number): Polyline {
  const waves = Array.from({ length: 4 }, (_, k) => ({
    amount: rng.range(0.04, 0.22) / (k + 1),
    phase: rng.range(0, Math.PI * 2),
    frequency: k + 2,
  }));
  const n = 240;
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      let r = radius;
      for (const w of waves)
        r *= 1 + w.amount * Math.sin(w.frequency * a + w.phase);
      return new Vec2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
    }),
    true,
  );
}

export default sketch;
