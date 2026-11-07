import { Vec2 } from "wtc-math";

/**
 * An axis-aligned rectangle described by its `min` (top-left) and `max`
 * (bottom-right) corners. Immutable: every operation returns a new Bounds.
 */
export class Bounds {
  readonly min: Vec2;
  readonly max: Vec2;

  constructor(min: Vec2, max: Vec2) {
    this.min = new Vec2(Math.min(min.x, max.x), Math.min(min.y, max.y));
    this.max = new Vec2(Math.max(min.x, max.x), Math.max(min.y, max.y));
  }

  static fromRect(x: number, y: number, width: number, height: number): Bounds {
    return new Bounds(new Vec2(x, y), new Vec2(x + width, y + height));
  }

  /** Smallest Bounds containing every point. Throws on an empty list. */
  static fromPoints(points: readonly Vec2[]): Bounds {
    if (points.length === 0) throw new RangeError("Bounds.fromPoints needs at least one point");
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return new Bounds(new Vec2(minX, minY), new Vec2(maxX, maxY));
  }

  get x(): number {
    return this.min.x;
  }
  get y(): number {
    return this.min.y;
  }
  get width(): number {
    return this.max.x - this.min.x;
  }
  get height(): number {
    return this.max.y - this.min.y;
  }
  get size(): Vec2 {
    return new Vec2(this.width, this.height);
  }
  get center(): Vec2 {
    return new Vec2((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2);
  }

  /**
   * Shrinks the bounds by `dx` on the left and right and `dy` on the top and bottom
   * (`dy` defaults to `dx`). Negative values grow it. Never inverts: an over-inset
   * collapses to the centre line.
   */
  inset(dx: number, dy: number = dx): Bounds {
    const c = this.center;
    const hw = Math.max(0, this.width / 2 - dx);
    const hh = Math.max(0, this.height / 2 - dy);
    return new Bounds(new Vec2(c.x - hw, c.y - hh), new Vec2(c.x + hw, c.y + hh));
  }

  /** True when `p` is inside or on the edge. */
  contains(p: Vec2): boolean {
    return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y;
  }

  union(other: Bounds): Bounds {
    return new Bounds(
      new Vec2(Math.min(this.min.x, other.min.x), Math.min(this.min.y, other.min.y)),
      new Vec2(Math.max(this.max.x, other.max.x), Math.max(this.max.y, other.max.y)),
    );
  }

  /** Point at normalised coordinates (0,0 = top-left, 1,1 = bottom-right). */
  at(u: number, v: number): Vec2 {
    return new Vec2(this.min.x + u * this.width, this.min.y + v * this.height);
  }
}
