import { Vec2 } from "wtc-math";
import {
  circle,
  compose,
  paper,
  polygon,
  rect,
  rotation,
  shade,
  translation,
  type Polyline,
} from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/**
 * Hatching and occlusion together. Shapes are drawn front to back (lowest on
 * the page first), each lit from the top left: a tone field makes the side
 * away from the light darker, and cross-hatching passes switch on as it
 * darkens. Outlines and shading go on separate pens. A faint gradient on the
 * ground goes in last, so it only shows between the shapes. Every pass is
 * pinned to the page lattice, so lines at the same angle run on across
 * neighbouring shapes.
 */
const sketch: Sketch = {
  title: "Shading",
  paper: paper.A5,
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.15 },

  draw(doc, random) {
    const area = doc.drawArea;
    const rng = random.fork("shapes");

    doc.layer("outline", { color: "#1b1b1b", width: 0.3 });
    const shading = doc.layer("shading", { color: "#3a3a3a", width: 0.25 });
    doc.layer("ground", { color: "#2f5d7c", width: 0.25 });
    const pen = shading.pen.width;

    // Unit vector pointing towards the light.
    const light = new Vec2(-1, -1).normalise();
    const origin = new Vec2(0, 0);

    const items = Array.from({ length: rng.int(10, 16) }, () => {
      const radius = rng.range(7, 24);
      const kind = rng.pick(["circle", "square", "polygon"] as const);
      const unit: Polyline =
        kind === "circle"
          ? circle(origin, radius)
          : kind === "square"
            ? rect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6)
            : polygon(origin, radius, rng.int(5, 7));
      return {
        outline: unit.transform(
          compose(rotation(rng.range(0, Math.PI * 2)), translation(rng.pointIn(area))),
        ),
        radius,
        base: rng.range(0.3, 0.55),
      };
    });

    // Nearest first: the lower a shape sits on the page, the closer it is.
    items.sort((a, b) => b.outline.bounds.center.y - a.outline.bounds.center.y);

    for (const { outline, radius, base } of items) {
      const c = outline.bounds.center;
      const tone = (x: number, y: number) =>
        base - 0.45 * (((x - c.x) * light.x + (y - c.y) * light.y) / radius);
      doc.draw("outline", outline, { silhouette: false, bounds: area });
      doc.draw("shading", shade(outline, { tone, pen }), {
        silhouette: outline,
        bounds: area,
      });
    }

    const ground = rect(area.x, area.y, area.width, area.height);
    doc.draw(
      "ground",
      shade(ground, {
        tone: (_x, y) => 0.05 + 0.25 * ((y - area.y) / area.height),
        pen: 0.25,
        angles: [0],
        thresholds: [0],
      }),
      { silhouette: false },
    );
  },
};

export default sketch;
