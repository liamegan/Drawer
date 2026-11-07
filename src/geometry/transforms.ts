import { Mat3, Vec2 } from "wtc-math";

/*
 * Small helpers for building 2D affine transforms as wtc-math Mat3s.
 *
 * Use these rather than Mat3's own constructors. In wtc-math (checked on 1.4.0):
 *  - Mat3 is column-major, with the translation in a31/a32.
 *  - `m.multiply(n)` computes m × n, so `n` is applied to a point first.
 *  - `Mat3.fromAngle(θ)` and `Mat3.identity().rotate(θ)` turn in OPPOSITE
 *    directions. Everything here is built from `identity().rotate()`.
 *
 * Coordinates are y-down (SVG / canvas), so a positive angle turns CLOCKWISE
 * on screen.
 */

function toVec(x: number | Vec2, y?: number): Vec2 {
  return typeof x === "number" ? new Vec2(x, y ?? x) : x;
}

export function identity(): Mat3 {
  return Mat3.identity();
}

/** `translation(v)` or `translation(x, y)`. */
export function translation(x: number | Vec2, y?: number): Mat3 {
  return Mat3.identity().translate(toVec(x, y ?? 0));
}

/** Rotation by `radians`, clockwise on screen, about `origin` (default 0,0). */
export function rotation(radians: number, origin?: Vec2): Mat3 {
  if (!origin) return Mat3.identity().rotate(radians);
  return Mat3.identity()
    .translate(origin)
    .rotate(radians)
    .translate(origin.scaleNew(-1));
}

/** `scaling(s)`, `scaling(sx, sy)` or `scaling(vec)`, about `origin` (default 0,0). */
export function scaling(sx: number | Vec2, sy?: number, origin?: Vec2): Mat3 {
  const s = toVec(sx, sy);
  if (!origin) return Mat3.identity().scaleByVec2(s);
  return Mat3.identity()
    .translate(origin)
    .scaleByVec2(s)
    .translate(origin.scaleNew(-1));
}

/**
 * Combines transforms so they apply to a point IN THE ORDER LISTED:
 * `compose(scaling(2), rotation(a), translation(p))` scales, then rotates,
 * then moves.
 */
export function compose(...transforms: Mat3[]): Mat3 {
  let acc = Mat3.identity();
  for (const m of transforms) acc = m.multiplyNew(acc);
  return acc;
}
