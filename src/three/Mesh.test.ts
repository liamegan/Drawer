import { describe, expect, it } from "vitest";
import { Vec2, Vec3 } from "wtc-math";
import { Random } from "../random/Random.js";
import { box, breakCorners, extrude, lathe } from "./builders.js";
import { Mesh } from "./Mesh.js";
import {
  compose3,
  rotateX,
  rotateY,
  scale3,
  translate3,
} from "./transforms3.js";

const v2 = (x: number, y: number) => new Vec2(x, y);

/** Every face is flat and its normal points away from the mesh's middle. */
function expectWellFormed(mesh: Mesh) {
  const edges = mesh.edges;
  // Closed and manifold: two faces per edge, and V − E + F = 2.
  expect(edges.every((e) => e.faces.length === 2 && !e.open)).toBe(true);
  expect(mesh.vertices.length - edges.length + mesh.faces.length).toBe(2);
  expect(mesh.volume).toBeGreaterThan(0);
  mesh.faces.forEach((ring, f) => {
    const n = mesh.normals[f];
    const o = mesh.vertices[ring[0]];
    for (const i of ring) {
      expect(Math.abs(mesh.vertices[i].subtractNew(o).dot(n))).toBeLessThan(
        1e-9,
      );
    }
  });
  // Each edge is walked once each way by its two faces: consistent winding.
  for (const e of edges) {
    const [f, g] = e.faces;
    const forward = (ring: readonly number[]) =>
      ring.some((v, k) => v === e.a && ring[(k + 1) % ring.length] === e.b);
    expect(forward(mesh.faces[f])).not.toBe(forward(mesh.faces[g]));
  }
}

describe("Mesh", () => {
  it("builds a box that stands on the ground, faces outwards", () => {
    const b = box(new Vec3(4, 6, 8));
    expectWellFormed(b);
    expect(b.vertices.length).toBe(8);
    expect(b.edges.length).toBe(12);
    expect(b.volume).toBeCloseTo(192, 9);
    const { min, max } = b.bounds;
    expect([min.x, min.y, min.z, max.x, max.y, max.z]).toEqual([
      -2, 0, -4, 2, 6, 4,
    ]);
    const normals = b.normals.map((n) => [n.x, n.y, n.z]);
    expect(normals).toEqual([
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ]);
    // Normals point from the middle out through each face.
    const middle = new Vec3(0, 3, 0);
    b.normals.forEach((n, f) => {
      expect(b.faceCentre(f).subtractNew(middle).dot(n)).toBeGreaterThan(0);
    });
  });

  it("extrudes an outline either way round", () => {
    const ell = [v2(0, 0), v2(6, 0), v2(6, 2), v2(2, 2), v2(2, 5), v2(0, 5)];
    for (const outline of [ell, [...ell].reverse()]) {
      const m = extrude(outline, 3);
      expectWellFormed(m);
      expect(m.faces.length).toBe(8);
      expect(m.volume).toBeCloseTo((12 + 6) * 3, 9);
      expect(m.normals[0].z).toBeCloseTo(1, 12); // the front cap
    }
    // A repeated closing point is dropped.
    const square = [v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1), v2(0, 0)];
    expect(extrude(square, 1).faces.length).toBe(6);
  });

  it("lathes a profile into rings, with caps or points", () => {
    const cylinder = lathe([v2(5, 0), v2(5, 10)], { sides: 64 });
    expectWellFormed(cylinder);
    const exact = 0.5 * 64 * Math.sin((2 * Math.PI) / 64) * 25 * 10;
    expect(cylinder.volume).toBeCloseTo(exact, 9);
    // A cone: a point at the top, so triangles there.
    const cone = lathe([v2(4, 0), v2(0, 6)], { sides: 8 });
    expectWellFormed(cone);
    expect(cone.vertices.length).toBe(9);
    expect(cone.faces.filter((f) => f.length === 3).length).toBe(8);
    // Drawn top down, it still faces outwards.
    const urn = [v2(0, 12), v2(3, 11), v2(4, 6), v2(2, 2), v2(3, 0)];
    expectWellFormed(lathe(urn, { sides: 10 }));
  });

  it("keeps a jittered lathe's faces flat", () => {
    const random = new Random("trunk");
    const profile = [v2(4, 0), v2(3.5, 5), v2(3.8, 10), v2(3, 15)];
    const trunk = lathe(profile, {
      sides: 12,
      jitter: { random, amount: 0.2 },
    });
    expectWellFormed(trunk);
    // The rings really moved.
    const centre = (k: number) => {
      const ring = trunk.vertices.slice(k * 12, k * 12 + 12);
      return ring.reduce((c, p) => c.addNew(p), new Vec3(0, 0, 0)).x / 12;
    };
    expect(new Set([0, 1, 2, 3].map(centre)).size).toBe(4);
  });

  it("transforms vertices, and keeps faces outward through a mirror", () => {
    const b = box(new Vec3(2, 2, 2));
    const moved = b.transform(
      compose3(rotateY(Math.PI / 2), translate3(10, 0, 0)),
    );
    expectWellFormed(moved);
    // The front face (+z) now faces +x.
    expect(moved.normals[0].x).toBeCloseTo(1, 12);
    expect(moved.bounds.min.x).toBeCloseTo(9, 12);
    const mirrored = b.transform(scale3(new Vec3(-1, 1, 1)));
    expectWellFormed(mirrored);
    expect(b.vertices[0].x).toBe(-1); // the original is untouched
  });

  it("marks edges open where it's told to, or where a face is missing", () => {
    const b = box(new Vec3(1, 1, 1));
    const lid = new Mesh(b.vertices, b.faces.slice(0, 5));
    expect(lid.edges.filter((e) => e.open).length).toBe(4);
    const cut = new Mesh(b.vertices, b.faces, { open: [[1, 0]] });
    const open = cut.edges.filter((e) => e.open);
    expect(open.map((e) => [e.a, e.b].sort())).toEqual([[0, 1]]);
    expect(cut.transform(scale3(2)).edges.filter((e) => e.open).length).toBe(
      1,
    );
  });

  it("clips below a plane, leaving the cut open", () => {
    const b = box(new Vec3(4, 6, 8));
    const top = b.clipBelow(3);
    expect(top.faces.length).toBe(5); // the bottom has gone
    expect(top.vertices.length).toBe(8);
    expect(top.bounds.min.y).toBe(3);
    expect(top.bounds.max.y).toBe(6);
    const open = top.edges.filter((e) => e.open);
    expect(open.length).toBe(4);
    for (const e of open) {
      expect(top.vertices[e.a].y).toBe(3);
      expect(top.vertices[e.b].y).toBe(3);
    }
    // Standing on the plane: everything stays, but the base edges open.
    const standing = b.clipBelow(0);
    expect(standing.faces.length).toBe(6);
    expect(standing.edges.filter((e) => e.open).length).toBe(4);
    // Wholly above or below.
    expect(b.clipBelow(-1).faces.length).toBe(6);
    expect(b.clipBelow(-1).edges.some((e) => e.open)).toBe(false);
    expect(b.clipBelow(7).faces.length).toBe(0);
  });

  it("clips a tilted mesh, sharing each cut point between faces", () => {
    const tilted = box(new Vec3(4, 4, 4)).transform(
      compose3(translate3(0, -2, 0), rotateY(0.4), rotateX(0.5)),
    );
    const cut = tilted.clipBelow(0);
    expect(cut.vertices.every((p) => p.y >= 0)).toBe(true);
    // Open edges only along the cut; everything else has two faces.
    for (const e of cut.edges) {
      expect(e.open).toBe(e.faces.length === 1);
      if (e.open) {
        expect(cut.vertices[e.a].y).toBe(0);
        expect(cut.vertices[e.b].y).toBe(0);
      }
    }
    cut.faces.forEach((ring, f) => {
      const n = cut.normals[f];
      const o = cut.vertices[ring[0]];
      for (const i of ring) {
        expect(Math.abs(cut.vertices[i].subtractNew(o).dot(n))).toBeLessThan(
          1e-9,
        );
      }
    });
  });

  it("breaks a box's corners into flat facets", () => {
    const b = box(new Vec3(10, 14, 8));
    const once = breakCorners(b, new Random("rock"), { passes: 1 });
    expectWellFormed(once);
    expect(once.faces.length).toBe(14);
    expect(once.vertices.length).toBe(24);
    const twice = breakCorners(b, new Random("rock"));
    expectWellFormed(twice);
    expect(twice.faces.length).toBe(38);
    expect(twice.vertices.length).toBe(72);
    // Inside the box, and smaller.
    const { min, max } = b.bounds;
    for (const p of twice.vertices) {
      expect(p.x).toBeGreaterThanOrEqual(min.x - 1e-12);
      expect(p.x).toBeLessThanOrEqual(max.x + 1e-12);
      expect(p.y).toBeGreaterThanOrEqual(min.y - 1e-12);
      expect(p.y).toBeLessThanOrEqual(max.y + 1e-12);
      expect(p.z).toBeGreaterThanOrEqual(min.z - 1e-12);
      expect(p.z).toBeLessThanOrEqual(max.z + 1e-12);
    }
    expect(twice.volume).toBeLessThan(once.volume);
    expect(once.volume).toBeLessThan(b.volume);
    // The same seed breaks it the same way.
    const again = breakCorners(b, new Random("rock"));
    expect(again.vertices).toEqual(twice.vertices);
  });

  it("fans the facet at a corner of more than 3 faces", () => {
    const cone = lathe([v2(4, 0), v2(0, 6)], { sides: 8 });
    const broken = breakCorners(cone, new Random(1), { passes: 1 });
    expectWellFormed(broken);
    // The apex joins 8 faces: its facet is a fan of 6 triangles. The base
    // ring's corners join 3, so 8 more facets; plus the 9 original faces.
    expect(broken.faces.length).toBe(9 + 8 + 6);
  });

  it("only breaks closed meshes", () => {
    const b = box(new Vec3(1, 1, 1)).clipBelow(0.5);
    expect(() => breakCorners(b, new Random(1))).toThrow(RangeError);
    const whole = box(new Vec3(1, 1, 1));
    expect(() =>
      breakCorners(whole, new Random(1), { amount: [0.1, 0.5] }),
    ).toThrow(RangeError);
  });

  it("checks its input", () => {
    const p = [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)];
    expect(() => new Mesh(p, [[0, 1]])).toThrow(RangeError);
    expect(() => new Mesh(p, [[0, 1, 3]])).toThrow(RangeError);
    expect(() => new Mesh(p, [[0, 1, 1]])).toThrow(RangeError);
    const flat = [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(2, 0, 0)];
    expect(() => new Mesh(flat, [[0, 1, 2]]).normals).toThrow(RangeError);
    expect(() => box(new Vec3(1, 0, 1))).toThrow(RangeError);
    expect(() => extrude([v2(0, 0), v2(1, 0)], 1)).toThrow(RangeError);
    expect(() => lathe([v2(1, 0), v2(0, 1), v2(1, 2)])).toThrow(RangeError);
    expect(() => lathe([v2(1, 0), v2(1, 1)], { sides: 2 })).toThrow(
      RangeError,
    );
  });
});
