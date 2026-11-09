import { Vec2 } from "wtc-math";
import {
  catmullRom,
  Noise,
  paper,
  Polyline,
  profiles,
  Sweep,
  sweepHatch,
  type Document,
  type Profile,
  type Random,
  type SweepProfile,
} from "wtc-drawer";
import type { Debug, Sketch } from "../Sketch.js";
import {
  grassRows,
  ground,
  horizonLine,
  lerp,
  type Item,
} from "./lib/meadow-kit.js";

/** Leaf shapes; each plant uses one. */
const KINDS = ["leaf", "serrated", "clover"] as const;
type Kind = (typeof KINDS)[number];

/** GM's clover: a heart whose lobes rise past a notched tip. */
const CLOVER = profiles.parametric((t) => [
  Math.sin(t ** 0.8 * Math.PI),
  Math.sin(t * Math.PI * 0.8),
]);

/** The light comes from the top left; this points towards it. */
const LIGHT = new Vec2(-1, -1).normalise();

/**
 * A meadow. Rows of grass run from the horizon to the front of the page,
 * each blade a sweep along a straight spine bent by the wind (curl from
 * `bend`, lean from noise), hatched along its length so the lines thin out
 * towards the tip. Among them stand a few plants: a tapering stem through
 * noisy points, with leaves that droop off it, hatched across in bowed
 * veins, with a midrib, and denser on the side away from the light.
 *
 * Everything is drawn front to back, outline and hatching on separate pens,
 * so occlusion does the layering. Nearer rows are taller, wider and darker.
 *
 * Debug (`d`) shows each plant's stem and leaf spines, a tick across each
 * leaf at its middle (the sweep's frame), and labels the leaf shape.
 */
const sketch: Sketch = {
  title: "Meadow",
  paper: paper.A5,
  orientation: "landscape",
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.4 },

  draw(doc, random, debug, { traits }) {
    const area = doc.drawArea;
    const noise = new Noise(random.fork("noise"));
    const rng = random.fork("meadow");

    doc.layer("ink", { color: "#1b1b1b", width: 0.3 });
    const shadeLayer = doc.layer("shade", { color: "#3d5a3a", width: 0.25 });
    const pen = shadeLayer.pen.width;

    const { horizon, groundAt } = ground(area);

    // Everything to draw, by depth, nearest first.
    const items: Item[] = [];
    grassRows(doc, noise, rng, groundAt, items);

    // A few plants, each at its own depth among the rows.
    const plants = traits.set("Plants", rng.int(3, 5));
    // Every kind first, trimmed before shuffling so each one appears.
    const kinds = rng.shuffle(
      [...KINDS, rng.pick(KINDS), rng.pick(KINDS)].slice(0, plants),
    );
    traits.set("Leaves", [...new Set(kinds)].sort().join(", "));
    for (let i = 0; i < plants; i++) {
      const d = rng.range(0.45, 0.95);
      const span = area.width / plants;
      const root = new Vec2(
        area.x + span * (i + rng.range(0.25, 0.75)),
        groundAt(d) + 1,
      );
      const kind = kinds[i];
      const draw = plant(doc, noise, rng, root, d, kind, pen, debug);
      items.push({ depth: d + 0.01, draw });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) item.draw();

    // The horizon, behind everything.
    horizonLine(doc, noise, horizon);
  },
};

/**
 * A stem with leaves. Returns the drawing, so it happens in depth order;
 * its random numbers are all drawn now, so the seed stays stable.
 */
function plant(
  doc: Document,
  noise: Noise,
  rng: Random,
  root: Vec2,
  depth: number,
  kind: Kind,
  pen: number,
  debug: Debug,
): () => void {
  const area = doc.drawArea;
  const scale = lerp(0.65, 1.1, depth);
  const height = Math.min(rng.range(65, 95) * scale, root.y - area.y - 6);
  const wobble = rng.range(0, 100);
  const stemPoints = Array.from({ length: 5 }, (_, i) => {
    const f = i / 4;
    const sway = 5 * scale * noise.fbm2(wobble, f * 3, { octaves: 2 });
    return new Vec2(root.x + sway * f, root.y - height * f);
  });
  const stem = new Sweep(catmullRom(stemPoints), {
    width: 1.9 * scale,
    profile: profiles.taper(1, 0.4),
  });

  const count = rng.int(3, 6);
  const leaves: Sweep[] = [];
  const shadow: (readonly [number, number])[] = [];
  for (let i = 0; i < count; i++) {
    const t = lerp(0.3, 0.95, count > 1 ? i / (count - 1) : 1);
    const side = i % 2 === 0 ? 1 : -1;
    const f = stem.frame(t);
    const turn = side * rng.range(0.6, 1.1);
    const dir = rotate(f.tangent, turn);
    const length = rng.range(14, 21) * scale * (1 - 0.3 * t);
    // Clover hearts are wide, so they droop less to keep from folding.
    const droop =
      kind === "clover" ? rng.range(0.05, 0.25) : rng.range(0.3, 0.8);
    const leaf = new Sweep(
      new Polyline([f.point, f.point.addNew(dir.scaleNew(length))]),
      {
        width: length * (kind === "clover" ? 0.75 : rng.range(0.4, 0.55)),
        profile: leafProfile(kind, length, rng),
        bend: side * droop, // away from the stem
        step: kind === "serrated" ? 0.1 : 0.2,
      },
    );
    leaves.push(leaf);
    // Shade the half whose normal faces away from the light.
    shadow.push(leaf.frame(0.5).normal.dot(LIGHT) > 0 ? [-1, 0] : [0, 1]);
  }

  // Guides are recorded now, while the shapes are at hand.
  debug.path(stem.spine, "#e07a21");
  for (const leaf of leaves) {
    debug.path(leaf.spine, "#e07a21");
    debug.path(
      new Polyline([leaf.point(0.5, -1), leaf.point(0.5, 1)]),
      "#2a9df4",
    );
  }
  debug.label(kind, stem.frame(1).point.addNew(new Vec2(0, -3)));

  return () => {
    const area = doc.drawArea;
    // Leaves first: they're in front of the stem.
    leaves.forEach((leaf, i) => {
      const veins = kind === "clover" ? 0 : leaf.length * 0.12;
      const spacing = kind === "clover" ? 0.8 : 1.1;
      const ribs = kind === "clover" ? [] : [leaf.midrib(0, 0.85)];
      doc.draw("ink", [leaf.outline, ...ribs], {
        silhouette: false,
        bounds: area,
      });
      const lines = [
        ...sweepHatch(leaf, { spacing, bow: veins }),
        // A second set between the first, on the shaded half.
        ...sweepHatch(leaf, {
          spacing,
          bow: veins,
          offset: 0,
          span: shadow[i],
        }),
      ];
      doc.draw("shade", lines, { silhouette: leaf.outline, bounds: area });
    });
    doc.draw("ink", stem.openOutline, { silhouette: false, bounds: area });
    const lines = sweepHatch(stem, { direction: "along", tone: 0.3, pen });
    doc.draw("shade", lines, { silhouette: stem.outline, bounds: area });
  };
}

function leafProfile(kind: Kind, length: number, rng: Random): SweepProfile {
  if (kind === "clover") return CLOVER;
  const base: Profile = profiles.leaf({ widest: rng.range(0.3, 0.45) });
  if (kind === "leaf") return base;
  return profiles.serrate(base, Math.max(5, Math.round(length / 1.6)), 0.18);
}

/** `v` turned by `a` radians, clockwise on screen. */
function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

export default sketch;
