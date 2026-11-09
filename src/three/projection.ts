import { Vec2, Vec3 } from "wtc-math";

/**
 * A parallel projection from the world (x right, y up, z towards the
 * viewer) to the page (mm, y down), relative to the object's origin.
 *
 * It is linear: a point p lands at `(u · p, v · p)`. Everything along
 * `toEye` lands on the same page point, so `toEye` is the direction the
 * viewer looks from, and `depth(p)` (larger is nearer) orders points that
 * overlap on the page.
 */
export interface Projection {
  /** Page x of a point is `u · p`. */
  readonly u: Vec3;
  /** Page y of a point is `v · p`. */
  readonly v: Vec3;
  /** Unit vector from the object towards the viewer. */
  readonly toEye: Vec3;
  /** The page position of `p`, relative to the object's origin. */
  project(p: Vec3): Vec2;
  /** How near `p` is to the viewer: `p · toEye`. */
  depth(p: Vec3): number;
}

export interface ObliqueOptions {
  /** How much depth (z) shows, in page mm per mm. Default 0.5, as GM. */
  factor?: number;
  /**
   * The page direction depth is drawn in, clockwise from page +x. The
   * default π/2 draws things nearer the viewer lower down, so the top of
   * an object shows, as GM.
   */
  angle?: number;
}

/**
 * An oblique projection, GM's: faces square to z keep their true shape and
 * depth is drawn at a slant, shortened by `factor`.
 *
 * page = (x + z·factor·cos(angle), −y + z·factor·sin(angle))
 */
export function oblique(options: ObliqueOptions = {}): Projection {
  const { factor = 0.5, angle = Math.PI / 2 } = options;
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new RangeError("oblique: factor must be above 0");
  }
  const c = factor * Math.cos(angle);
  const s = factor * Math.sin(angle);
  // The direction that lands on the page origin is u × v; flip it to face
  // the viewer (+z).
  const toEye = new Vec3(-c, s, 1).normalise();
  return makeProjection(new Vec3(1, 0, c), new Vec3(0, -1, s), toEye);
}

export interface OrthographicOptions {
  /** How far the viewer is above the ground, in radians. Default π/6. */
  elevation?: number;
  /**
   * How far the viewer has walked round the y axis from the front (+z)
   * towards the right (+x), in radians. Default π/4.
   */
  azimuth?: number;
}

/**
 * A true parallel camera, looking at the object from `elevation` above the
 * ground and `azimuth` round it: isometric is an azimuth of π/4 and an
 * elevation of atan(1/√2). Verticals stay vertical on the page.
 */
export function orthographic(options: OrthographicOptions = {}): Projection {
  const { elevation = Math.PI / 6, azimuth = Math.PI / 4 } = options;
  if (!Number.isFinite(elevation) || !Number.isFinite(azimuth)) {
    throw new RangeError("orthographic: angles must be finite");
  }
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const toEye = new Vec3(sa * ce, se, ca * ce);
  const right = new Vec3(ca, 0, -sa);
  const up = new Vec3(-sa * se, ce, -ca * se);
  return makeProjection(right, up.scale(-1), toEye);
}

function makeProjection(u: Vec3, v: Vec3, toEye: Vec3): Projection {
  return Object.freeze({
    u,
    v,
    toEye,
    project: (p: Vec3) => new Vec2(u.dot(p), v.dot(p)),
    depth: (p: Vec3) => toEye.dot(p),
  });
}
