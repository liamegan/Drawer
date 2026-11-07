import { Vec2 } from "wtc-math";
import {
  circle,
  compose,
  line,
  paper,
  polygon,
  rect,
  rotation,
  scaling,
  translation,
  type Polyline,
} from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/**
 * Hidden-line removal with the occlusion mask. Shapes are drawn front to
 * back: the lowest on the page counts as nearest and goes first. Each one is
 * an outline with a few concentric copies inside it. Shapes further back are
 * hidden where they pass behind it, and stop a small gap short of its outline.
 * Horizontal "ground" lines go in last on a second pen, so they only show in
 * the space left between the shapes.
 */
const sketch: Sketch = {
  title: "Occlusion stack",
  paper: paper.A5,
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.05 },

  draw(doc, random) {
    const area = doc.drawArea;
    const rng = random.fork("shapes");

    // Create the layers up front to fix their plotting order.
    doc.layer("shapes", { color: "#1b1b1b", width: 0.3 });
    doc.layer("ground", { color: "#2f5d7c", width: 0.3 });

    const origin = new Vec2(0, 0);
    const count = rng.int(15, 25);
    const items = Array.from({ length: count }, () => {
      const radius = rng.range(6, 24);
      const kind = rng.pick(["circle", "square", "polygon"] as const);
      const unit: Polyline =
        kind === "circle"
          ? circle(origin, radius)
          : kind === "square"
            ? rect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6)
            : polygon(origin, radius, rng.int(5, 7));
      return {
        unit,
        center: rng.pointIn(area),
        angle: rng.range(0, Math.PI * 2),
        rings: rng.int(2, 5),
      };
    });

    // Nearest first: the lower a shape sits on the page, the closer it is.
    items.sort((a, b) => b.center.y - a.center.y);

    for (const { unit, center, angle, rings } of items) {
      const place = (k: number) =>
        unit.transform(
          compose(scaling(k), rotation(angle), translation(center)),
        );
      const outline = place(1);
      const inner = Array.from({ length: rings }, (_, i) =>
        place(1 - (i + 1) / (rings + 1)),
      );
      doc.draw("shapes", [outline, ...inner], {
        silhouette: outline,
        bounds: area,
      });
    }

    for (let y = area.y + 1; y < area.max.y; y += 2) {
      doc.draw("ground", line(new Vec2(area.x, y), new Vec2(area.max.x, y)), {
        silhouette: false,
        bounds: area,
      });
    }
  },
};

export default sketch;
