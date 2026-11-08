/**
 * A direction at each point of the page: (x, y) in mm to a vector [dx, dy].
 * Any function of this shape is a field. Streamlines follow its direction
 * only; a vector of (near) zero length marks a point with no direction,
 * where streamlines stop.
 */
export type VectorField = (x: number, y: number) => readonly [number, number];

/** A scalar at each point of the page, such as noise. */
export type ScalarField = (x: number, y: number) => number;

/**
 * Unit vectors at `angle(x, y)` radians. 0 points along +x, and positive
 * angles turn clockwise on screen, as everywhere else.
 */
export function angleField(angle: ScalarField): VectorField {
  return (x, y) => {
    const a = angle(x, y);
    return [Math.cos(a), Math.sin(a)];
  };
}

export interface CurlOptions {
  /** Step for the central differences, in mm. Default 0.01. */
  eps?: number;
}

/**
 * The curl of a potential: (∂ψ/∂y, −∂ψ/∂x), by central differences. It runs
 * along the potential's contour lines, so it has no divergence: its
 * streamlines never bunch together or spread apart, which suits evenly
 * spaced lines. With noise as the potential, it gives swirling,
 * fluid-looking flow. Where the potential is flat, the curl is zero.
 */
export function curlField(
  potential: ScalarField,
  options: CurlOptions = {},
): VectorField {
  const eps = options.eps ?? 0.01;
  if (!(eps > 0)) throw new RangeError("curlField: eps must be positive");
  const inv = 1 / (2 * eps);
  return (x, y) => [
    (potential(x, y + eps) - potential(x, y - eps)) * inv,
    -(potential(x + eps, y) - potential(x - eps, y)) * inv,
  ];
}
