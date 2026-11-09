import { Vec2, Vec3 } from "wtc-math";
import {
  box,
  breakCorners,
  compose3,
  lathe,
  Noise,
  oblique,
  orthographic,
  paper,
  Polyline,
  renderMesh,
  rotateX,
  rotateY,
  rotateZ,
  translate3,
  type Mesh,
  type Projection,
  type Random,
} from "wtc-drawer";
import type { Debug, Sketch } from "../Sketch.js";
import {
  grassRows,
  ground,
  horizonLine,
  lerp,
  ROWS,
  type Item,
} from "./lib/meadow-kit.js";

const KINDS = ["block", "urn", "column"] as const;
type Kind = (typeof KINDS)[number];

/** Towards the light, in the world (x right, y up, z out): top left. */
const LIGHT = new Vec3(-1, 2, 0.6);

/**
 * Stones in the meadow: broken-corner blocks, an urn and a column standing
 * among the grass rows, sunk into the ground.
 *
 * Each object is a small mesh, turned and tipped a little, cut off at the
 * ground (`clipBelow`) and drawn with `renderMesh`: edges on `ink`; creases
 * and shading on a lighter `stone` pen, with the faces shaded from the light
 * and lines painted on each face. It joins the grass in one depth-sorted
 * list, so the blades in front of its base cover the cut, and its halo
 * (`gap`) keeps the grass behind from touching its outline.
 *
 * Most seeds use GM's oblique view; about one in three uses an
 * orthographic camera instead.
 *
 * Debug (`d`) shows each visible face's normal as a tick from its centre,
 * the faces turned away (dashed), and labels each object and the view.
 */
const sketch: Sketch = {
  title: "Stones",
  paper: paper.A5,
  orientation: "landscape",
  margin: 12,
  paperColor: "#f4f1ea",
  occlusion: { gap: 0.4 },

  draw(doc, random, debug) {
    const area = doc.drawArea;
    const noise = new Noise(random.fork("noise"));
    const rng = random.fork("meadow");
    const stones = random.fork("stones");

    doc.layer("ink", { color: "#1b1b1b", width: 0.3 });
    doc.layer("shade", { color: "#3d5a3a", width: 0.25 });
    // Stones get their own pen, which also takes their creases.
    const stonePen = doc.layer("stone", { color: "#3b4250", width: 0.25 });

    const { horizon, groundAt } = ground(area);
    const items: Item[] = [];
    grassRows(doc, noise, rng, groundAt, items);

    const orthographicView = stones.value() < 1 / 3;
    const projection = orthographicView
      ? orthographic({ elevation: 0.35, azimuth: 0 })
      : oblique();
    debug.label(
      orthographicView ? "orthographic" : "oblique",
      new Vec2(area.max.x - 14, area.y + 4),
    );

    const count = stones.int(2, 4);
    const kinds = stones.shuffle([...KINDS, "block" as const]).slice(0, count);
    const span = area.width / count;
    for (let i = 0; i < count; i++) {
      // On a row, so that row's grass hides the cut at its base.
      const row = stones.int(2, ROWS - 1);
      const d = row / (ROWS - 1);
      const at = new Vec2(
        area.x + span * (i + stones.range(0.3, 0.7)),
        groundAt(d) + stones.range(0.5, 2.5),
      );
      const room = at.y - area.y - 4;
      const mesh = stone(stones, kinds[i], lerp(1, 1.7, d), room);
      const drawing = renderMesh(mesh, {
        projection,
        at,
        pen: stonePen.pen.width,
        light: LIGHT,
        tone: [0.04, 0.5],
      });
      guides(debug, mesh, projection, at, kinds[i]);
      items.push({
        // Lower bases are nearer, as for the grass.
        depth: d + at.y * 1e-6,
        draw: () => {
          const bounds = area;
          doc.draw("ink", drawing.edges, { silhouette: false, bounds });
          doc.draw("stone", drawing.creases, { silhouette: false, bounds });
          doc.draw("stone", drawing.hatch, {
            silhouette: drawing.silhouette,
            gap: 0.6,
            bounds,
          });
        },
      });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) item.draw();
    horizonLine(doc, noise, horizon);
  },
};

/**
 * One object, standing on y = 0 at its origin, turned, tipped and sunk, and
 * cut off at the ground. `room` caps its height on the page.
 */
function stone(rng: Random, kind: Kind, scale: number, room: number): Mesh {
  let mesh: Mesh;
  let tip = 0;
  if (kind === "block") {
    const h = Math.min(rng.range(24, 42) * scale, room);
    const size = new Vec3(
      rng.range(14, 26) * scale,
      h,
      rng.range(12, 20) * scale,
    );
    mesh = breakCorners(box(size), rng);
    tip = rng.range(-0.12, 0.12);
  } else if (kind === "urn") {
    const r = rng.range(5, 7) * scale;
    const h = Math.min(rng.range(24, 32) * scale, room);
    mesh = lathe(
      [
        new Vec2(r * 0.75, 0),
        new Vec2(r, h * 0.12),
        new Vec2(r * 0.95, h * 0.45),
        new Vec2(r * 0.45, h * 0.72),
        new Vec2(r * 0.42, h * 0.86),
        new Vec2(r * 0.8, h * 0.97),
        new Vec2(r * 0.72, h),
      ],
      { sides: 14, jitter: { random: rng, amount: 0.03 } },
    );
  } else {
    const r = rng.range(3.5, 5) * scale;
    const h = Math.min(rng.range(46, 64) * scale, room);
    const drums = rng.int(4, 6);
    const profile = [new Vec2(r * 1.35, 0), new Vec2(r * 1.35, h * 0.05)];
    for (let k = 0; k <= drums; k++) {
      const f = 0.06 + (0.84 * k) / drums;
      profile.push(new Vec2(r * (1 - 0.12 * f), h * f));
    }
    profile.push(new Vec2(r * 1.3, h * 0.95), new Vec2(r * 1.3, h));
    mesh = lathe(profile, {
      sides: rng.int(9, 13),
      jitter: { random: rng, amount: 0.05 },
    });
    tip = rng.range(-0.06, 0.06);
  }
  // Tipped objects sink further, so no corner lifts off the ground.
  const width = Math.max(mesh.bounds.max.x - mesh.bounds.min.x, 1);
  const sink = rng.range(0.5, 2) * scale + Math.abs(Math.sin(tip)) * width;
  return mesh
    .transform(
      compose3(
        rotateY(rng.range(0, Math.PI)),
        rotateZ(tip),
        rotateX(rng.range(-0.06, 0.06)),
        translate3(0, -sink, 0),
      ),
    )
    .clipBelow(0);
}

/** Debug guides: normals of visible faces, the faces turned away, a label. */
function guides(
  debug: Debug,
  mesh: Mesh,
  projection: Projection,
  at: Vec2,
  kind: Kind,
): void {
  const page = (p: Vec3) => projection.project(p).add(at);
  mesh.faces.forEach((ring, f) => {
    const n = mesh.normals[f];
    if (n.dot(projection.toEye) > 0) {
      const c = mesh.faceCentre(f);
      debug.path(
        new Polyline([page(c), page(c.addNew(n.scaleNew(3)))]),
        "#e07a21",
      );
    } else {
      debug.path(
        new Polyline(
          ring.map((i) => page(mesh.vertices[i])),
          true,
        ),
        "#2a9df4",
      );
    }
  });
  const top = page(new Vec3(0, mesh.bounds.max.y, 0));
  debug.label(kind, top.addNew(new Vec2(0, -4)));
}

export default sketch;
