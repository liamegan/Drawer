import { Mat4, Vec3 } from "wtc-math";

/*
 * 3D transforms for meshes. The world is right-handed: x right, y up, z
 * towards the viewer, in mm.
 *
 * Positive angles follow the right-hand rule: they turn counter-clockwise
 * when you look down the axis towards the origin. So `rotateY(+)` takes +x
 * towards −z, and `rotateZ(+)` takes +x towards +y (up). That is the
 * opposite sense to the 2D helpers, whose positive angles turn clockwise on
 * a y-down page.
 *
 * wtc-math's Mat4 is column-major (translation in `a41..a43`), and
 * `m.multiply(n)` computes m × n, so `n` applies first. `compose3` hides
 * that: its arguments apply in the order given. Pinned by
 * `transforms3.test.ts`.
 */

/** A turn of `rad` about the x axis: +y goes towards +z. */
export function rotateX(rad: number): Mat4 {
  return Mat4.fromXRotation(rad);
}

/** A turn of `rad` about the y axis: +z goes towards +x. */
export function rotateY(rad: number): Mat4 {
  return Mat4.fromYRotation(rad);
}

/** A turn of `rad` about the z axis: +x goes towards +y. */
export function rotateZ(rad: number): Mat4 {
  return Mat4.fromZRotation(rad);
}

/** A move by `(x, y, z)` or by a Vec3. */
export function translate3(x: number | Vec3, y = 0, z = 0): Mat4 {
  const v = x instanceof Vec3 ? x : new Vec3(x, y, z);
  return Mat4.fromTranslatingVec3(v);
}

/** A scale about the origin: one factor for all axes, or one per axis. */
export function scale3(s: number | Vec3): Mat4 {
  const v = s instanceof Vec3 ? s : new Vec3(s, s, s);
  return Mat4.fromScalingVec3(v);
}

/** The transforms combined, applying the first one first. */
export function compose3(...transforms: Mat4[]): Mat4 {
  let m = new Mat4();
  for (const t of transforms) m = t.multiplyNew(m);
  return m;
}

/** `p` transformed by `m`, as a new Vec3. */
export function apply3(m: Mat4, p: Vec3): Vec3 {
  return p.transformByMat4New(m);
}
