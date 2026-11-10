import { Vec2, Vec3 } from "wtc-math";
import { shade, type ShadeOptions } from "../fill/tone.js";
import { clipWhere, shapeEdges, windingAt } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import type { Mesh } from "./Mesh.js";
import type { Projection } from "./projection.js";

/** A face facing the viewer, as `renderMesh` shaded it. */
export interface MeshFace {
  /** Index into `mesh.faces`. */
  readonly index: number;
  /** Outward unit normal, in the world. */
  readonly normal: Vec3;
  /** The mean of its vertices, in the world. */
  readonly centre: Vec3;
  /** The face on the page: closed, clockwise on screen. */
  readonly ring: Polyline;
  /** ((1 + N·L) / 2)²: 1 facing the light, 0 facing away. */
  readonly lighting: number;
  /** The tone it was shaded to. */
  readonly tone: number;
  /** The first pass's hatch angle, on the page (clockwise from +x). */
  readonly angle: number;
  /**
   * Every pass's angle, in order (see `shade`): the first direction, the
   * face's other axis, then its two diagonals, all as drawn on the page.
   */
  readonly angles: readonly number[];
}

/** Options for {@link renderMesh}. */
export interface RenderMeshOptions {
  /** How the world lands on the page. */
  projection: Projection;
  /** Page position (mm) of the mesh's origin. Default (0, 0). */
  at?: Vec2;
  /**
   * Direction towards the light, in the world (x right, y up, z towards
   * the viewer). Default (−1, 2, 0.6), GM's: above, left and in front.
   */
  light?: Vec3;
  /**
   * Tones for a face facing the light and one facing away; faces between
   * go by `lighting`. Default [0.08, 0.55].
   */
  tone?: readonly [number, number];
  /** Pen width (mm) the hatching is spaced for. */
  pen: number;
  /**
   * Edges between two visible faces whose normals differ by less than this
   * (radians) go to `creases` instead of `edges`. Default 15°.
   */
  crease?: number;
  /**
   * Which way a face's lines run, instead of the default: a direction in
   * the world (it is laid into the face's plane) or a page angle. Return
   * undefined to keep the default.
   */
  hatch?: (
    face: Omit<MeshFace, "angle" | "angles">,
  ) => Vec3 | number | undefined;
  /**
   * Passed on to `shade` (thresholds, spacing limits, line style...).
   * `angles` here replaces the per-face ones for every face.
   */
  shading?: Omit<ShadeOptions, "tone" | "pen" | "angle">;
  /** Pieces shorter than this (mm) left by hiding are dropped. Default 0.2. */
  minLength?: number;
}

/**
 * What {@link renderMesh} returns: the visible lines, sorted by kind, and the
 * silhouette.
 */
export interface MeshDrawing {
  /** Outline and sharp edges, each once, with hidden parts removed. */
  edges: Polyline[];
  /** Edges between nearly flat neighbours, for a lighter pen. */
  creases: Polyline[];
  /** Each face's shading, with hidden parts removed. */
  hatch: Polyline[];
  /**
   * The visible faces' rings, clockwise on screen: together they are the
   * object's silhouette, for `sheet.draw`'s `silhouette` (and `gap`).
   */
  silhouette: Polyline[];
  /** The faces facing the viewer, with their shading. */
  faces: MeshFace[];
}

/** Faces nearer flat than this (|N·up|) are hatched into the depth. */
const FLAT = 0.95;
/** Faces this close to edge-on are left out. */
const EDGE_ON = 1e-6;

/** A visible face, ready for depth tests. */
interface Front {
  index: number;
  edges: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Depth of the face's plane at page (x, y) is a·x + b·y + c. */
  a: number;
  b: number;
  c: number;
}

/**
 * Draws a mesh as plotter paths: its edges, creases and shading, as seen
 * through `projection`, placed `at` a point on the page.
 *
 * Hidden lines are removed exactly, in vectors: every path is cut where it
 * crosses the outline of a face facing the viewer, and a piece is kept
 * unless a face nearer than it (by the face's plane) covers its middle.
 * That needs no sorting and is exact whatever the order or overlaps, as
 * long as faces don't pass through each other. Faces facing away are
 * culled, so look at an object clipped with `clipBelow` from above.
 *
 * Each face is shaded with `shade`, from the light, and its lines are
 * "painted on" the face: the first pass runs down its slope on walls and
 * into the depth on flat tops; darker tones add the face's other axis (round
 * a column, along a wall), then its diagonals. So parallel faces match and
 * planes read as planes. Spacing is set on the page, and the page lattice
 * keeps neighbouring faces' lines aligned.
 *
 * Draw the result with separate pens and stamp the silhouette last:
 *
 *     sheet.draw("ink", d.edges, { silhouette: false });
 *     sheet.draw("light", d.creases, { silhouette: false });
 *     sheet.draw("shade", d.hatch, { silhouette: d.silhouette, gap: 0.6 });
 */
export function renderMesh(
  mesh: Mesh,
  options: RenderMeshOptions,
): MeshDrawing {
  const { projection: proj, pen } = options;
  const at = options.at ?? new Vec2(0, 0);
  const light = (options.light ?? new Vec3(-1, 2, 0.6)).normaliseNew();
  const [lit, dark] = options.tone ?? [0.08, 0.55];
  const crease = options.crease ?? (15 * Math.PI) / 180;
  const shading = options.shading ?? {};
  const minLength = options.minLength ?? shading.minLength ?? 0.2;
  if (!(pen > 0)) throw new RangeError("renderMesh: pen must be above 0");
  if (!(lit >= 0 && lit <= 1 && dark >= 0 && dark <= 1)) {
    throw new RangeError("renderMesh: tones must be within [0, 1]");
  }

  const { u, v, toEye } = proj;
  const page = mesh.vertices.map((p) => proj.project(p).add(at));
  const normals = mesh.normals;
  const { min, max } = mesh.bounds;
  const eps = 1e-6 * Math.max(1, max.subtractNew(min).length);

  // The page axes' Gram matrix, for depth planes (see `plane`).
  const uu = u.dot(u);
  const uv = u.dot(v);
  const vv = v.dot(v);
  const det = uu * vv - uv * uv;

  const fronts: Front[] = [];
  const front = new Map<number, Front>();
  const rings = new Map<number, Polyline>();
  mesh.faces.forEach((ring, f) => {
    const n = normals[f];
    const facing = n.dot(toEye);
    if (!(facing > EDGE_ON)) return;
    // Counter-clockwise seen from outside is counter-clockwise on screen
    // too; turn it round to the library's clockwise.
    const onPage = new Polyline(
      ring.map((i) => page[i]),
      true,
    ).reversed();
    // With n = wx·u + wy·v + wz·toEye (toEye is square to u and v, and
    // wz = n·toEye), a point p on the plane n·p = d at page offset (x, y)
    // has wx·x + wy·y + wz·depth = d.
    const d = n.dot(mesh.vertices[ring[0]]);
    const nu = n.dot(u);
    const nv = n.dot(v);
    const wx = (nu * vv - nv * uv) / det;
    const wy = (nv * uu - nu * uv) / det;
    const b = onPage.bounds;
    const face: Front = {
      index: f,
      edges: shapeEdges(onPage),
      minX: b.min.x,
      minY: b.min.y,
      maxX: b.max.x,
      maxY: b.max.y,
      a: -wx / facing,
      b: -wy / facing,
      c: (d + wx * at.x + wy * at.y) / facing,
    };
    fronts.push(face);
    front.set(f, face);
    rings.set(f, onPage);
  });

  // Every visible face's outline: paths are cut wherever they cross one.
  let total = 0;
  for (const g of fronts) total += g.edges.length;
  const cuts = new Float64Array(total);
  total = 0;
  for (const g of fronts) {
    cuts.set(g.edges, total);
    total += g.edges.length;
  }

  /** Is (x, y) on a path in `own`'s plane free of nearer faces? */
  const visible =
    (own: readonly number[], plane: Front) => (x: number, y: number) => {
      const depth = plane.a * x + plane.b * y + plane.c + eps;
      for (const g of fronts) {
        if (x < g.minX || x > g.maxX || y < g.minY || y > g.maxY) continue;
        if (g.a * x + g.b * y + g.c <= depth) continue;
        if (own.includes(g.index)) continue;
        if (windingAt(g.edges, x, y) !== 0) return false;
      }
      return true;
    };
  const hide = (path: Polyline, own: readonly number[], plane: Front) =>
    clipWhere(path, cuts, visible(own, plane), { minLength });

  const edges: Polyline[] = [];
  const creases: Polyline[] = [];
  for (const e of mesh.edges) {
    if (e.open) continue;
    const seen = e.faces.filter((f) => front.has(f));
    if (seen.length === 0) continue;
    const path = new Polyline([page[e.a], page[e.b]]);
    const pieces = hide(path, e.faces, front.get(seen[0])!);
    const flat =
      e.faces.length === 2 &&
      seen.length === 2 &&
      angleBetween(normals[seen[0]], normals[seen[1]]) < crease;
    (flat ? creases : edges).push(...pieces);
  }

  const hatch: Polyline[] = [];
  const faces: MeshFace[] = [];
  for (const g of fronts) {
    const n = normals[g.index];
    const lighting = ((1 + n.dot(light)) / 2) ** 2;
    const base = {
      index: g.index,
      normal: n.clone(),
      centre: mesh.faceCentre(g.index),
      ring: rings.get(g.index)!,
      lighting,
      tone: dark + (lit - dark) * lighting,
    };
    const given = options.hatch?.(base);
    let angles: number[];
    if (typeof given === "number") {
      angles = [given, given + Math.PI / 2, given + Math.PI / 4];
      angles.push(given - Math.PI / 4);
    } else {
      // The first pass, then the face's other axis, then its diagonals:
      // every pass lies on the face.
      let d1 = given ? inPlane(given, n) : paintedOn(n);
      if (!(d1.length > 1e-9)) d1 = paintedOn(n);
      d1.normalise();
      const d2 = n.crossNew(d1);
      angles = [d1, d2, d1.addNew(d2), d1.subtractNew(d2)].map((d) =>
        pageAngle(d, u, v),
      );
    }
    faces.push({ ...base, angle: angles[0], angles });
    const lines = shade(base.ring, {
      ...shading,
      tone: base.tone,
      pen,
      angle: angles[0],
      angles: shading.angles ?? angles,
    });
    for (const line of lines) hatch.push(...hide(line, [g.index], g));
  }

  return {
    edges,
    creases,
    hatch,
    silhouette: fronts.map((g) => rings.get(g.index)!),
    faces,
  };
}

/**
 * The face's default line direction: down its slope, or into the depth (z)
 * on a face that's nearly flat.
 */
function paintedOn(n: Vec3): Vec3 {
  return Math.abs(n.y) > FLAT
    ? inPlane(new Vec3(0, 0, 1), n)
    : inPlane(new Vec3(0, 1, 0), n);
}

/** `d` laid into the plane with normal `n`. */
function inPlane(d: Vec3, n: Vec3): Vec3 {
  return d.subtractNew(n.scaleNew(d.dot(n)));
}

/** The page angle a world direction is drawn at. */
function pageAngle(d: Vec3, u: Vec3, v: Vec3): number {
  const x = u.dot(d);
  const y = v.dot(d);
  return Math.hypot(x, y) > 1e-12 ? Math.atan2(y, x) : 0;
}

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
}
