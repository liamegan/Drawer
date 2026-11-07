import { Vec2 } from "wtc-math";
import { circle, compose, paper, rect, rotation, translation } from "wtc-drawer";
import type { Sketch } from "../Sketch.js";

/**
 * A first smoke test of the core: a grid of cells, each holding either a
 * square that is rotated more the closer it is to a random focal point, or a
 * small set of concentric rings. Squares and rings go on separate pen layers.
 */
const sketch: Sketch = {
  title: "Hello grid",
  paper: paper.A5,
  margin: 12,
  paperColor: "#f4f1ea",

  draw(doc, random) {
    const area = doc.drawArea;
    const cols = 8;
    const cell = area.width / cols;
    const rows = Math.floor(area.height / cell);
    const top = area.y + (area.height - rows * cell) / 2;

    const focus = random.pointIn(area);
    const choose = random.fork("choose");
    const jitter = random.fork("jitter");

    const squares = doc.layer("squares", { color: "#1b1b1b", width: 0.3 });
    const rings = doc.layer("rings", { color: "#c8432b", width: 0.5 });

    const size = cell * 0.72;
    const unitSquare = rect(-size / 2, -size / 2, size, size);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const center = new Vec2(area.x + (c + 0.5) * cell, top + (r + 0.5) * cell);
        const nearness = 1 - Math.min(center.distance(focus) / (area.width * 0.8), 1);

        if (choose.bool(0.8)) {
          const angle = jitter.gaussian(0, 0.08 + nearness * 0.7);
          const nudge = new Vec2(jitter.gaussian(0, nearness), jitter.gaussian(0, nearness));
          squares.add(unitSquare.transform(compose(rotation(angle), translation(center.addNew(nudge)))));
        } else {
          const count = choose.int(1, 4);
          for (let i = 1; i <= count; i++) rings.add(circle(center, (size / 2) * (i / count)));
        }
      }
    }
  },
};

export default sketch;
