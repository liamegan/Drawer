import { Vec2 } from "wtc-math";
import {
  Noise,
  Polyline,
  profiles,
  Sweep,
  sweepHatch,
  type Bounds,
  type Document,
  type Random,
} from "wtc-drawer";

/*
 * The meadow's ground and grass, shared by the meadow and stones sketches.
 * It isn't a sketch itself: only files directly in ./sketches are.
 *
 * Both sketches draw with layers "ink" (outlines) and "shade" (hatching).
 */

/** Something to draw, at a depth: 0 at the back, 1 at the front. */
export interface Item {
  depth: number;
  draw: () => void;
}

/** Rows of grass from the horizon to the front of the page. */
export const ROWS = 8;

/** Where the horizon sits, and how a depth maps to a height on the page. */
export function ground(area: Bounds) {
  const horizon = area.y + area.height * 0.32;
  // Where a row at depth d (0 at the back, 1 at the front) stands.
  const groundAt = (d: number) =>
    horizon + (area.max.y - 1 - horizon) * (0.06 + 0.94 * d ** 1.5);
  return { horizon, groundAt };
}

/**
 * Adds every blade of every row to `items`. Nearer rows are taller, wider
 * and darker.
 */
export function grassRows(
  doc: Document,
  noise: Noise,
  rng: Random,
  groundAt: (d: number) => number,
  items: Item[],
): void {
  const area = doc.drawArea;
  const pen = doc.layer("shade").pen.width;
  for (let r = 0; r < ROWS; r++) {
    const d = r / (ROWS - 1);
    const y = groundAt(d);
    const height = lerp(6, 26, d);
    const width = lerp(1, 3, d);
    const tone = lerp(0.14, 0.42, d);
    let x = area.x + rng.range(0, width);
    while (x < area.max.x) {
      const root = new Vec2(x, y + rng.range(0, lerp(1.5, 5, d)));
      const blade = grassBlade(noise, rng, root, height, width, d);
      // Within a row, lower roots are nearer.
      items.push({
        depth: d + root.y * 1e-6,
        draw: () => {
          // Open at the base, which is in the ground.
          doc.draw("ink", blade.openOutline, {
            silhouette: false,
            bounds: area,
          });
          const lines = sweepHatch(blade, { direction: "along", tone, pen });
          doc.draw("shade", lines, {
            silhouette: blade.outline,
            bounds: area,
          });
        },
      });
      x += width * rng.range(1, 2.4);
    }
  }
}

/** One blade: leaning with the wind and curling a little further. */
export function grassBlade(
  noise: Noise,
  rng: Random,
  root: Vec2,
  height: number,
  width: number,
  depth: number,
): Sweep {
  const wind = noise.fbm2(root.x, depth * 40, { frequency: 0.02, octaves: 2 });
  const lean = 0.45 * wind + rng.range(-0.15, 0.15);
  const h = height * rng.range(0.75, 1.15);
  const tip = root.addNew(new Vec2(Math.sin(lean), -Math.cos(lean)).scale(h));
  return new Sweep(new Polyline([root, tip]), {
    width: width * rng.range(0.8, 1.2),
    profile: profiles.blade({ taper: rng.range(1.5, 4) }),
    bend: 0.9 * lean + rng.range(-0.25, 0.25),
  });
}

/** The horizon, a gently rolling line; draw it last, behind everything. */
export function horizonLine(doc: Document, noise: Noise, horizon: number) {
  const area = doc.drawArea;
  const line: Vec2[] = [];
  for (let x = area.x; x <= area.max.x; x += 1) {
    const hill = 3 * noise.fbm2(x, 0, { frequency: 0.015 });
    line.push(new Vec2(x, horizon - 1 - hill));
  }
  doc.draw("ink", new Polyline(line), { silhouette: false, bounds: area });
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
