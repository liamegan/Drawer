import { describe, expect, it } from "vitest";
import { Vec2, Vec3 } from "wtc-math";
import { shade } from "../fill/tone.js";
import { shapeContains } from "../geometry/clip.js";
import type { Polyline } from "../geometry/Polyline.js";
import { segmentDistance } from "../geometry/simplify.js";
import { Random } from "../random/Random.js";
import { box, breakCorners, extrude, lathe } from "./builders.js";
import type { Mesh } from "./Mesh.js";
import { oblique, orthographic, type Projection } from "./projection.js";
import { renderMesh } from "./renderMesh.js";
import { compose3, rotateX, rotateY } from "./transforms3.js";

const v2 = (x: number, y: number) => new Vec2(x, y);
const at = v2(50, 60);
const pen = 0.3;
const Y = new Vec3(0, 1, 0);

const ell = extrude(
  [v2(0, 0), v2(6, 0), v2(6, 2), v2(2, 2), v2(2, 5), v2(0, 5)],
  3,
);
const urn = lathe(
  [v2(2.5, 0), v2(3, 1), v2(1.2, 4), v2(1.2, 6), v2(3.2, 8), v2(2.6, 8.4)],
  { sides: 10 },
);

const views: Projection[] = [
  oblique(),
  oblique({ factor: 0.6, angle: 2.2 }),
  orthographic(),
  orthographic({ elevation: 0.3, azimuth: -0.7 }),
  orthographic({ elevation: 0.15, azimuth: -1.1 }),
];

/** Distance from `q` to the nearest of `paths`. */
function distanceTo(paths: readonly Polyline[], q: Vec2): number {
  let best = Infinity;
  for (const path of paths) {
    const p = path.points;
    for (let i = 0; i + 1 < p.length; i++) {
      best = Math.min(
        best,
        segmentDistance(q.x, q.y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y),
      );
    }
  }
  return best;
}

/** Is `q` inside the planar face's ring? (In the plane, by the major axis.) */
function inFace(mesh: Mesh, f: number, q: Vec3): boolean {
  const n = mesh.normals[f];
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const flat = (p: Vec3): [number, number] =>
    ax >= ay && ax >= az ? [p.y, p.z] : ay >= az ? [p.z, p.x] : [p.x, p.y];
  const [x, y] = flat(q);
  const ring = mesh.faces[f].map((i) => flat(mesh.vertices[i]));
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Brute force: is the world point `p` (on the faces `own`) seen, or does a
 * ray from it to the viewer hit another face facing the viewer?
 */
function seen(mesh: Mesh, proj: Projection, p: Vec3, own: number[]) {
  const e = proj.toEye;
  return mesh.faces.every((ring, g) => {
    const n = mesh.normals[g];
    const facing = n.dot(e);
    if (facing <= 1e-6 || own.includes(g)) return true;
    const t = (n.dot(mesh.vertices[ring[0]]) - n.dot(p)) / facing;
    if (t <= 1e-7) return true;
    return !inFace(mesh, g, p.addNew(e.scaleNew(t)));
  });
}

/** The world point on face `f`'s plane that lands on page point `q`. */
function unproject(mesh: Mesh, proj: Projection, f: number, q: Vec2) {
  const { u, v, toEye: e } = proj;
  const x = q.x - at.x;
  const y = q.y - at.y;
  // Solve [u; v; e] p = (x, y, 0) by Cramer's rule, then slide along e.
  const det3 = (a: Vec3, b: Vec3, c: Vec3) => a.dot(b.crossNew(c));
  const cols = [
    new Vec3(u.x, v.x, e.x),
    new Vec3(u.y, v.y, e.y),
    new Vec3(u.z, v.z, e.z),
  ];
  const r = new Vec3(x, y, 0);
  const d = det3(cols[0], cols[1], cols[2]);
  const p0 = new Vec3(
    det3(r, cols[1], cols[2]) / d,
    det3(cols[0], r, cols[2]) / d,
    det3(cols[0], cols[1], r) / d,
  );
  const n = mesh.normals[f];
  const plane = n.dot(mesh.vertices[mesh.faces[f][0]]);
  return p0.addNew(e.scaleNew((plane - n.dot(p0)) / n.dot(e)));
}

/**
 * Checks samples along every edge and every face's full hatching against
 * the brute force: a sample is drawn exactly when it is seen. Samples
 * where the answer changes within a short step either way are skipped.
 * Returns the share of samples that were hidden.
 */
function checkAgainstBruteForce(mesh: Mesh, proj: Projection): number {
  const d = renderMesh(mesh, {
    projection: proj,
    at,
    pen,
    tone: [0.2, 0.35],
    minLength: 1e-9,
  });
  const isFront = (f: number) => mesh.normals[f].dot(proj.toEye) > 1e-6;
  const project = (p: Vec3) => proj.project(p).add(at);
  let hidden = 0;
  let total = 0;
  const check = (
    point: (s: number) => Vec3,
    own: number[],
    drawn: readonly Polyline[],
  ) => {
    for (let s = 0.01; s < 0.995; s += 0.02) {
      const now = seen(mesh, proj, point(s), own);
      if (
        now !== seen(mesh, proj, point(s - 0.004), own) ||
        now !== seen(mesh, proj, point(s + 0.004), own)
      ) {
        continue;
      }
      total++;
      if (!now) hidden++;
      const onPaper = distanceTo(drawn, project(point(s))) < 1e-6;
      expect(onPaper).toBe(now);
    }
  };

  const lines = [...d.edges, ...d.creases];
  for (const e of mesh.edges) {
    if (e.open || !e.faces.some(isFront)) continue;
    const a = mesh.vertices[e.a];
    const b = mesh.vertices[e.b];
    const point = (s: number) => a.addNew(b.subtractNew(a).scale(s));
    check(point, [...e.faces], lines);
  }
  for (const face of d.faces) {
    const full = shade(face.ring, {
      tone: face.tone,
      pen,
      angle: face.angle,
      angles: face.angles,
    });
    for (const line of full) {
      const a = line.start!;
      const b = line.end!;
      const point = (s: number) =>
        unproject(mesh, proj, face.index, a.addNew(b.subtractNew(a).scale(s)));
      check(point, [face.index], d.hatch);
    }
  }
  return hidden / total;
}

describe("renderMesh", () => {
  it("draws a box's visible edges once, with nothing hidden", () => {
    const b = box(new Vec3(10, 8, 6));
    const front = renderMesh(b, { projection: oblique(), at, pen });
    // Front and top: 4 + 4 edges, one of them shared.
    expect(front.faces.map((f) => f.index)).toEqual([0, 4]);
    expect(front.edges.length).toBe(7);
    expect(front.creases.length).toBe(0);
    const iso = renderMesh(b, { projection: orthographic(), at, pen });
    expect(iso.edges.length).toBe(9);
    // Each edge whole, and none twice.
    const keys = iso.edges.map((p) => {
      expect(p.pointCount).toBe(2);
      const [s, e] = [p.start!, p.end!].map((q) => `${q.x},${q.y}`).sort();
      return `${s}|${e}`;
    });
    expect(new Set(keys).size).toBe(9);
    // The silhouette is clockwise on screen, and the hatching inside it.
    for (const ring of iso.silhouette) {
      expect(ring.closed).toBe(true);
      expect(signedArea(ring)).toBeGreaterThan(0);
    }
    expect(iso.hatch.length).toBeGreaterThan(10);
    for (const line of iso.hatch) {
      const mid = line.start!.addNew(line.end!).scale(0.5);
      expect(shapeContains(iso.silhouette, mid.x, mid.y)).toBe(true);
    }
  });

  it("hides what a ray to the viewer would hit, on concave shapes", () => {
    let most = 0;
    for (const proj of views) {
      most = Math.max(most, checkAgainstBruteForce(ell, proj));
      most = Math.max(most, checkAgainstBruteForce(urn, proj));
    }
    // The views really do hide things.
    expect(most).toBeGreaterThan(0.05);
  });

  it("keeps a tilted, broken, sunk block right too", () => {
    const block = breakCorners(box(new Vec3(8, 12, 7)), new Random("block"))
      .transform(compose3(rotateY(0.5), rotateX(0.25)))
      .clipBelow(1.5);
    for (const proj of views) checkAgainstBruteForce(block, proj);
    // Nothing is drawn along the cut at the ground.
    const d = renderMesh(block, { projection: oblique(), at, pen });
    const open = block.edges.filter((e) => e.open);
    expect(open.length).toBeGreaterThan(3);
    for (const e of open) {
      const a = oblique().project(block.vertices[e.a]).add(at);
      const b = oblique().project(block.vertices[e.b]).add(at);
      const mid = a.addNew(b).scale(0.5);
      expect(distanceTo(d.edges, mid)).toBeGreaterThan(1e-6);
    }
  });

  it("sends nearly flat edges to creases", () => {
    const smooth = lathe([v2(4, 0), v2(4, 10)], { sides: 32 });
    const d = renderMesh(smooth, { projection: orthographic(), at, pen });
    expect(d.creases.length).toBeGreaterThan(5);
    // The outline (and the rim against the top) stays sharp.
    expect(d.edges.length).toBeGreaterThan(2);
    const coarse = renderMesh(smooth, {
      projection: orthographic(),
      at,
      pen,
      crease: 0.1,
    });
    expect(coarse.creases.length).toBe(0);
  });

  it("shades faces from the light", () => {
    const b = box(new Vec3(10, 10, 10));
    const d = renderMesh(b, {
      projection: orthographic(),
      at,
      pen,
      light: new Vec3(0, 0, 1),
      tone: [0.1, 0.6],
    });
    const byIndex = new Map(d.faces.map((f) => [f.index, f]));
    expect(byIndex.get(0)!.lighting).toBeCloseTo(1, 12); // the front faces it
    expect(byIndex.get(0)!.tone).toBeCloseTo(0.1, 12);
    // Side-on to the light: half way, squared.
    expect(byIndex.get(2)!.lighting).toBeCloseTo(0.25, 12);
    expect(byIndex.get(2)!.tone).toBeCloseTo(0.6 - 0.5 * 0.25, 12);
  });

  it("paints lines on each face: down walls, into the depth on tops", () => {
    const b = box(new Vec3(10, 10, 10));
    const along = (angle: number, dx: number, dy: number) =>
      Math.abs(Math.cos(angle) * dy - Math.sin(angle) * dx) /
      Math.hypot(dx, dy);
    for (const proj of [oblique({ angle: Math.PI / 4 }), orthographic()]) {
      const d = renderMesh(b, { projection: proj, at, pen });
      for (const face of d.faces) {
        const n = face.normal;
        // Walls: vertical on the page. Tops: along z as drawn.
        const z = proj.project(new Vec3(0, 0, 1));
        const [dx, dy] = Math.abs(n.y) > 0.5 ? [z.x, z.y] : [0, 1];
        expect(along(face.angle, dx, dy)).toBeLessThan(1e-12);
        // The second pass follows the face's other axis: along a wall,
        // across the depth on a top.
        const axis = Math.abs(n.y) > 0.5 ? new Vec3(1, 0, 0) : n.crossNew(Y);
        const other = proj.project(axis);
        expect(along(face.angles[1], other.x, other.y)).toBeLessThan(1e-12);
        // Then the diagonals, as they land on the page.
        expect(face.angles.length).toBe(4);
      }
    }
  });

  it("takes a direction or an angle per face", () => {
    const b = box(new Vec3(10, 10, 10));
    const d = renderMesh(b, {
      projection: orthographic(),
      at,
      pen,
      hatch: (f) => (f.index === 0 ? 0.3 : new Vec3(1, 1, 1)),
    });
    const byIndex = new Map(d.faces.map((f) => [f.index, f]));
    expect(byIndex.get(0)!.angle).toBe(0.3);
    // On the top (+y), (1, 1, 1) lies in the plane as (1, 0, 1).
    const p = orthographic().project(new Vec3(1, 0, 1));
    expect(byIndex.get(4)!.angle).toBeCloseTo(Math.atan2(p.y, p.x), 12);
  });
});

function signedArea(ring: Polyline): number {
  const p = ring.points;
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
