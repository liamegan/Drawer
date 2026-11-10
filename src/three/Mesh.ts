import { Vec3, type Mat4 } from "wtc-math";

/** An edge between two vertices, with the faces that share it. */
export interface MeshEdge {
  /** Vertex indices, in the direction of the first face's ring. */
  readonly a: number;
  readonly b: number;
  /** Faces using this edge, in order: two on a closed mesh. */
  readonly faces: readonly number[];
  /** True if it borders a hole or a cut, so isn't drawn as an edge. */
  readonly open: boolean;
}

/** Options for a new {@link Mesh}. */
export interface MeshOptions {
  /**
   * Edges to treat as open even if two faces share them, as vertex index
   * pairs in either order. Edges used by one face are always open.
   */
  open?: Iterable<readonly [number, number]>;
}

/**
 * A polygon mesh: shared vertices and faces as rings of vertex indices.
 *
 * World axes are x right, y up and z towards the viewer, in mm. Each face's
 * ring runs counter-clockwise seen from outside, so its normal (by Newell's
 * method, which tolerates slightly bent faces) points out.
 *
 * Immutable, like Polyline: the constructor copies its input and
 * `transform` returns a new mesh.
 */
export class Mesh {
  readonly vertices: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
  readonly #open: ReadonlySet<string>;
  #normals?: readonly Vec3[];
  #edges?: readonly MeshEdge[];

  constructor(
    vertices: Iterable<Vec3>,
    faces: Iterable<Iterable<number>>,
    options: MeshOptions = {},
  ) {
    this.vertices = Array.from(vertices, (v) => v.clone());
    const n = this.vertices.length;
    this.faces = Array.from(faces, (f, i) => {
      const ring = Array.from(f);
      if (ring.length < 3) {
        throw new RangeError(`Mesh: face ${i} has fewer than 3 vertices`);
      }
      for (let k = 0; k < ring.length; k++) {
        const v = ring[k];
        if (!Number.isInteger(v) || v < 0 || v >= n) {
          throw new RangeError(`Mesh: face ${i} uses missing vertex ${v}`);
        }
        if (v === ring[(k + 1) % ring.length]) {
          throw new RangeError(`Mesh: face ${i} repeats vertex ${v}`);
        }
      }
      return ring;
    });
    const open = new Set<string>();
    for (const [a, b] of options.open ?? []) open.add(edgeKey(a, b));
    this.#open = open;
  }

  /** Outward unit normals, one per face. */
  get normals(): readonly Vec3[] {
    return (this.#normals ??= this.faces.map((ring, i) => {
      const n = newell(this.vertices, ring);
      const len = n.length;
      if (!(len > 1e-12)) {
        throw new RangeError(`Mesh: face ${i} has no area`);
      }
      return n.scale(1 / len);
    }));
  }

  /** Each edge once, in order of first use. */
  get edges(): readonly MeshEdge[] {
    if (this.#edges) return this.#edges;
    const byKey = new Map<string, { a: number; b: number; faces: number[] }>();
    this.faces.forEach((ring, f) => {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const key = edgeKey(a, b);
        const edge = byKey.get(key);
        if (edge) edge.faces.push(f);
        else byKey.set(key, { a, b, faces: [f] });
      }
    });
    this.#edges = Array.from(byKey, ([key, e]) => ({
      a: e.a,
      b: e.b,
      faces: e.faces,
      open: e.faces.length < 2 || this.#open.has(key),
    }));
    return this.#edges;
  }

  /** The open edges given to the constructor, as index pairs. */
  get openPairs(): [number, number][] {
    return [...this.#open].map((k) => {
      const [a, b] = k.split(",");
      return [Number(a), Number(b)];
    });
  }

  /** The mean of a face's vertices. */
  faceCentre(face: number): Vec3 {
    const ring = this.faces[face];
    const c = new Vec3(0, 0, 0);
    for (const i of ring) c.add(this.vertices[i]);
    return c.scale(1 / ring.length);
  }

  /** The smallest box around the vertices. */
  get bounds(): { min: Vec3; max: Vec3 } {
    const min = new Vec3(Infinity, Infinity, Infinity);
    const max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (const v of this.vertices) {
      min.x = Math.min(min.x, v.x);
      min.y = Math.min(min.y, v.y);
      min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x);
      max.y = Math.max(max.y, v.y);
      max.z = Math.max(max.z, v.z);
    }
    return { min, max };
  }

  /**
   * The enclosed volume (by the divergence theorem), in mm³. Negative if
   * the faces wind inwards; only meaningful for a closed mesh.
   */
  get volume(): number {
    let sum = 0;
    for (const ring of this.faces) {
      const o = this.vertices[ring[0]];
      for (let k = 1; k + 1 < ring.length; k++) {
        const b = this.vertices[ring[k]];
        const c = this.vertices[ring[k + 1]];
        sum += o.dot(b.crossNew(c));
      }
    }
    return sum / 6;
  }

  /**
   * The mesh moved by `m`. A mirroring transform (negative determinant)
   * reverses every ring, so faces keep winding outwards.
   */
  transform(m: Mat4): Mesh {
    const vertices = this.vertices.map((v) => v.transformByMat4New(m));
    const flip = m.determinant < 0;
    const faces = flip ? this.faces.map((r) => [...r].reverse()) : this.faces;
    return new Mesh(vertices, faces, { open: this.openPairs });
  }

  /** The same mesh with every face turned inside out. */
  reversed(): Mesh {
    const faces = this.faces.map((r) => [...r].reverse());
    return new Mesh(this.vertices, faces, { open: this.openPairs });
  }

  /**
   * The mesh above the plane at height `y`, for objects sunk into the
   * ground. Each face is cut where it crosses the plane and faces wholly
   * below go. The hole isn't capped, and every edge lying in the plane is
   * open, so nothing is drawn where the object meets the ground.
   */
  clipBelow(y = 0): Mesh {
    const src = this.vertices;
    const vertices: Vec3[] = [];
    const kept = new Map<number, number>();
    const cuts = new Map<string, number>();
    const keep = (i: number) => {
      let j = kept.get(i);
      if (j === undefined) {
        j = vertices.push(src[i].clone()) - 1;
        kept.set(i, j);
      }
      return j;
    };
    // Shared by both faces of an edge, and worked out the same way for each.
    const cut = (a: number, b: number) => {
      const key = edgeKey(a, b);
      let j = cuts.get(key);
      if (j === undefined) {
        const p = src[Math.min(a, b)];
        const q = src[Math.max(a, b)];
        const t = (y - p.y) / (q.y - p.y);
        const at = new Vec3(p.x + (q.x - p.x) * t, y, p.z + (q.z - p.z) * t);
        j = vertices.push(at) - 1;
        cuts.set(key, j);
      }
      return j;
    };

    const faces: number[][] = [];
    for (const ring of this.faces) {
      const out: number[] = [];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const inA = src[a].y >= y;
        if (inA) out.push(keep(a));
        if (inA !== src[b].y >= y) {
          // A crossing, unless the end above sits on the plane already.
          const top = inA ? src[a] : src[b];
          if (top.y > y) out.push(cut(a, b));
        }
      }
      const clean = out.filter((v, i) => v !== out[(i + 1) % out.length]);
      if (clean.length < 3) continue;
      if (!(newell(vertices, clean).length > 1e-12)) continue;
      faces.push(clean);
    }

    const open: [number, number][] = [];
    for (const [a, b] of this.openPairs) {
      const ka = kept.get(a);
      const kb = kept.get(b);
      if (ka !== undefined && kb !== undefined) open.push([ka, kb]);
    }
    for (const ring of faces) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        if (vertices[a].y === y && vertices[b].y === y) open.push([a, b]);
      }
    }
    // Drop vertices only a removed face used.
    const used = new Set(faces.flat());
    if (used.size === vertices.length) {
      return new Mesh(vertices, faces, { open });
    }
    const remap = new Map<number, number>();
    const compact: Vec3[] = [];
    vertices.forEach((v, i) => {
      if (used.has(i)) remap.set(i, compact.push(v) - 1);
    });
    return new Mesh(
      compact,
      faces.map((ring) => ring.map((v) => remap.get(v)!)),
      {
        open: open
          .filter(([a, b]) => used.has(a) && used.has(b))
          .map(([a, b]) => [remap.get(a)!, remap.get(b)!] as const),
      },
    );
  }
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Newell's normal: the ring's area vector, twice its area long. */
function newell(vertices: readonly Vec3[], ring: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = vertices[ring[k]];
    const q = vertices[ring[(k + 1) % ring.length]];
    x += (p.y - q.y) * (p.z + q.z);
    y += (p.z - q.z) * (p.x + q.x);
    z += (p.x - q.x) * (p.y + q.y);
  }
  return new Vec3(x, y, z);
}
