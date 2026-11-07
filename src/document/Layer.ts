import type { Polyline } from "../geometry/Polyline.js";

/** The physical pen a layer is plotted with. `width` is in mm. */
export interface Pen {
  color: string;
  width: number;
}

export const DEFAULT_PEN: Readonly<Pen> = { color: "#000000", width: 0.3 };

/**
 * A named group of strokes drawn with one pen. Each layer becomes one plotter
 * layer in the SVG, so it can be plotted, or swapped to a new pen, on its own.
 */
export class Layer {
  readonly name: string;
  pen: Pen;
  readonly paths: Polyline[] = [];

  constructor(name: string, pen: Partial<Pen> = {}) {
    this.name = name;
    this.pen = { ...DEFAULT_PEN, ...pen };
  }

  add(...paths: Polyline[]): this {
    this.paths.push(...paths);
    return this;
  }

  clear(): this {
    this.paths.length = 0;
    return this;
  }

  /** Total pen-down distance in mm. */
  get length(): number {
    let total = 0;
    for (const p of this.paths) total += p.length;
    return total;
  }
}
