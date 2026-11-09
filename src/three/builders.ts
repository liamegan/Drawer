import { Vec2, Vec3 } from "wtc-math";
import type { Random } from "../random/Random.js";
import { Mesh } from "./Mesh.js";

/**
 * A box `size` big, centred on x and z, standing on y = 0.
 */
export function box(size: Vec3): Mesh {
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) {
    throw new RangeError("box: every side must be above 0");
  }
  const vertices: Vec3[] = [];
  // Vertex (ix, iy, iz) is index ix + 2·iy + 4·iz.
  for (let iz = 0; iz < 2; iz++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        vertices.push(
          new Vec3((ix - 0.5) * size.x, iy * size.y, (iz - 0.5) * size.z),
        );
      }
    }
  }
  return new Mesh(vertices, [
    [4, 5, 7, 6], // front, +z
    [0, 2, 3, 1], // back, −z
    [5, 1, 3, 7], // right, +x
    [0, 4, 6, 2], // left, −x
    [6, 7, 3, 2], // top, +y
    [0, 1, 5, 4], // bottom, −y
  ]);
}

/**
 * A 2D outline (x right, y up) pushed `depth` along z, centred on z = 0:
 * stairs, plinths, an L. The outline must be simple (not cross itself);
 * either winding works.
 */
export function extrude(profile: readonly Vec2[], depth: number): Mesh {
  if (!(depth > 0)) throw new RangeError("extrude: depth must be above 0");
  const ring = distinct(profile, true);
  if (ring.length < 3) {
    throw new RangeError("extrude: the outline needs 3 distinct points");
  }
  if (signedArea(ring) < 0) ring.reverse(); // counter-clockwise, y up
  const n = ring.length;
  const vertices = [
    ...ring.map((p) => new Vec3(p.x, p.y, -depth / 2)), // back: 0..n−1
    ...ring.map((p) => new Vec3(p.x, p.y, depth / 2)), // front: n..2n−1
  ];
  const faces: number[][] = [
    ring.map((_, i) => n + i), // front, counter-clockwise from +z
    ring.map((_, i) => n - 1 - i), // back, the other way
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
  }
  return new Mesh(vertices, faces);
}

export interface LatheOptions {
  /** Points round each ring. Default 12. */
  sides?: number;
  /**
   * Moves each ring's centre by up to `amount` × its radius on x and z,
   * for GM's slightly wobbly trunks. Side faces stay flat. Default amount
   * 1/16.
   */
  jitter?: { random: Random; amount?: number };
}

/**
 * A profile of `(radius, y)` points spun round the y axis: urns, columns,
 * trunks. A radius of 0 at either end closes it to a point; otherwise that
 * end gets a flat cap. Radii in between must be above 0.
 */
export function lathe(
  profile: readonly Vec2[],
  options: LatheOptions = {},
): Mesh {
  const { sides = 12, jitter } = options;
  if (!Number.isInteger(sides) || sides < 3) {
    throw new RangeError("lathe: sides must be a whole number, 3 or more");
  }
  const rings = distinct(profile, false);
  if (rings.length < 2) {
    throw new RangeError("lathe: the profile needs 2 distinct points");
  }
  rings.forEach((p, i) => {
    const end = i === 0 || i === rings.length - 1;
    if (!(p.x > 0 || (end && p.x === 0))) {
      throw new RangeError(
        "lathe: radii must be above 0, or 0 at the ends only",
      );
    }
  });
  if (rings.length === 2 && rings[0].x === 0 && rings[1].x === 0) {
    throw new RangeError("lathe: the profile has no width");
  }

  const vertices: Vec3[] = [];
  // Each ring's vertex indices: one index for a point, `sides` otherwise.
  const index: number[][] = rings.map((p) => {
    const amount = jitter?.amount ?? 1 / 16;
    const cx = jitter ? jitter.random.range(-1, 1) * amount * p.x : 0;
    const cz = jitter ? jitter.random.range(-1, 1) * amount * p.x : 0;
    const start = vertices.length;
    if (p.x === 0) {
      vertices.push(new Vec3(cx, p.y, cz));
      return [start];
    }
    for (let s = 0; s < sides; s++) {
      const a = (2 * Math.PI * s) / sides;
      vertices.push(
        new Vec3(cx + p.x * Math.cos(a), p.y, cz + p.x * Math.sin(a)),
      );
    }
    return Array.from({ length: sides }, (_, s) => start + s);
  });

  // Ring to ring, going up the profile: (k, s), (k+1, s), (k+1, s+1),
  // (k, s+1) winds outwards. A point ring makes the quads triangles.
  const faces: number[][] = [];
  for (let k = 0; k + 1 < index.length; k++) {
    const lo = index[k];
    const hi = index[k + 1];
    for (let s = 0; s < sides; s++) {
      const t = (s + 1) % sides;
      const quad = [
        lo[s % lo.length],
        hi[s % hi.length],
        hi[t % hi.length],
        lo[t % lo.length],
      ];
      faces.push(quad.filter((v, i) => v !== quad[(i + 1) % quad.length]));
    }
  }
  const first = index[0];
  const last = index[index.length - 1];
  if (first.length > 1) faces.push([...first]);
  if (last.length > 1) faces.push([...last].reverse());
  const mesh = new Mesh(vertices, faces);
  // A profile running downwards winds everything inwards.
  return mesh.volume < 0 ? mesh.reversed() : mesh;
}

export interface BreakCornersOptions {
  /** How many times to cut the corners. Default 2, as GM's blocks. */
  passes?: number;
  /**
   * How far along each edge, as a share of its length, a cut lands from
   * each end, picked per edge end. Both must be in (0, 0.5). Default
   * [0.05, 0.48].
   */
  amount?: readonly [number, number];
}

/**
 * Knocks the corners off a closed mesh, as GM's blocks and rocks. Each pass
 * cuts every edge near both ends, a random share of its length in from
 * each, then replaces every corner with a facet through its cuts. One pass
 * on a box gives 14 faces and two give 38.
 *
 * Every corner the first pass makes joins 3 faces, so the new facets are
 * triangles and flat. A corner of more than 3 faces (the tip of a cone)
 * gets a fan of triangles.
 */
export function breakCorners(
  mesh: Mesh,
  random: Random,
  options: BreakCornersOptions = {},
): Mesh {
  const { passes = 2, amount = [0.05, 0.48] } = options;
  const [lo, hi] = amount;
  if (!(lo > 0 && hi >= lo && hi < 0.5)) {
    throw new RangeError("breakCorners: amount must be within (0, 0.5)");
  }
  if (!Number.isInteger(passes) || passes < 0) {
    throw new RangeError("breakCorners: passes must be a whole number");
  }
  let out = mesh;
  for (let i = 0; i < passes; i++) out = cutCorners(out, random, lo, hi);
  return out;
}

function cutCorners(mesh: Mesh, random: Random, lo: number, hi: number) {
  const src = mesh.vertices;
  // One new vertex per edge end: `near.get("a>b")` is on edge ab, near a.
  const near = new Map<string, number>();
  const vertices: Vec3[] = [];
  for (const e of mesh.edges) {
    if (e.faces.length !== 2) {
      throw new RangeError("breakCorners: the mesh must be closed");
    }
    for (const [p, q] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const k = random.range(lo, hi);
      const a = src[p];
      const b = src[q];
      near.set(`${p}>${q}`, vertices.push(lerp3(a, b, k)) - 1);
    }
  }
  const at = (p: number, q: number) => near.get(`${p}>${q}`)!;

  // Each face keeps its plane, with its corners cut off. Round a corner v
  // with neighbours u → v → w on the face, `around[v]` maps w to u; the
  // corner's facet then walks the cuts as w → u, which winds outwards.
  const faces: number[][] = [];
  const around = new Map<number, Map<number, number>>();
  for (const ring of mesh.faces) {
    const out: number[] = [];
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const u = ring[(k + n - 1) % n];
      const v = ring[k];
      const w = ring[(k + 1) % n];
      out.push(at(v, w), at(w, v));
      let links = around.get(v);
      if (!links) around.set(v, (links = new Map()));
      links.set(w, u);
    }
    faces.push(out);
  }
  for (const [v, links] of around) {
    const start = links.keys().next().value!;
    const facet: number[] = [];
    let w = start;
    do {
      facet.push(at(v, w));
      const u = links.get(w);
      if (u === undefined || facet.length > links.size) {
        throw new RangeError("breakCorners: the mesh must be manifold");
      }
      w = u;
    } while (w !== start);
    if (facet.length !== links.size) {
      throw new RangeError("breakCorners: the mesh must be manifold");
    }
    for (let k = 1; k + 1 < facet.length; k++) {
      faces.push([facet[0], facet[k], facet[k + 1]]);
    }
  }
  return new Mesh(vertices, faces);
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return new Vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/** Points without repeats in a row (or round the ring, if `closed`). */
function distinct(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push(p.clone());
  }
  while (
    closed &&
    out.length > 1 &&
    out[0].x === out[out.length - 1].x &&
    out[0].y === out[out.length - 1].y
  ) {
    out.pop();
  }
  return out;
}

function signedArea(ring: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
