/**
 * Width profiles for sweeps. A profile gives the half-width at each point
 * along the spine as a fraction of the widest, from t = 0 at the base to
 * t = 1 at the tip, and stays within [0, 1].
 */
export type Profile = (t: number) => number;

/**
 * A profile drawn as an outline in unit leaf space instead of a width per
 * t: y runs along the spine (0 at the base, 1 at the tip, though it may go
 * past either or turn back) and x across it, from 0 on the spine to 1 at
 * the widest. Made by `parametric`.
 */
export interface OutlineProfile {
  /** The right half's outline as [x, y] pairs, from base to tip, x ≥ 0. */
  readonly outline: readonly (readonly [number, number])[];
  /** Lowest and highest y the outline reaches. */
  readonly yMin: number;
  readonly yMax: number;
  /** Widest x at height y, over every part of the outline; 0 outside it. */
  width(y: number): number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface LeafOptions {
  /** Where along the leaf it's widest, between 0 and 1. Default 0.4. */
  widest?: number;
}

/**
 * A leaf: pointed at both ends and widest at `widest`, `sin(π t^p)` with p
 * set by `widest`. GM's mint and herb leaves are this shape.
 */
export function leaf(options: LeafOptions = {}): Profile {
  const widest = options.widest ?? 0.4;
  if (!(widest > 0 && widest < 1)) {
    throw new RangeError("leaf: widest must be between 0 and 1");
  }
  // sin(π t^p) peaks where t^p = 1/2.
  const p = Math.log(0.5) / Math.log(widest);
  return (t) => clamp01(Math.sin(Math.PI * clamp01(t) ** p));
}

export interface BladeOptions {
  /**
   * How long the sides stay nearly parallel before the point: 1 gives a
   * straight taper (a triangle), higher keeps the blade wide for longer
   * and shortens the point. Default 3.
   */
  taper?: number;
}

/** A grass blade: widest at the base, narrowing to a point at the tip. */
export function blade(options: BladeOptions = {}): Profile {
  const taper = options.taper ?? 3;
  if (!(taper > 0)) throw new RangeError("blade: taper must be positive");
  return (t) => clamp01(1 - clamp01(t) ** taper);
}

export interface PetalOptions {
  /** Where along the petal it's widest, between 0 and 1. Default 0.65. */
  widest?: number;
}

/**
 * A petal: a narrow, pointed base widening to a round tip. The tip is a
 * quarter ellipse, so it meets the spine square.
 */
export function petal(options: PetalOptions = {}): Profile {
  const c = options.widest ?? 0.65;
  if (!(c > 0 && c < 1)) {
    throw new RangeError("petal: widest must be between 0 and 1");
  }
  return (t) => {
    const u = clamp01(t);
    if (u <= c) return Math.sin((Math.PI / 2) * (u / c));
    const s = (u - c) / (1 - c);
    return Math.sqrt(Math.max(0, 1 - s * s));
  };
}

/** A straight taper from `from` at the base to `to` at the tip. */
export function taper(from = 1, to = 0): Profile {
  if (!(from >= 0 && from <= 1 && to >= 0 && to <= 1)) {
    throw new RangeError("taper: widths must be between 0 and 1");
  }
  return (t) => {
    const u = clamp01(t);
    return from + (to - from) * u;
  };
}

/**
 * Cuts saw teeth into a profile's edge, pointing towards the tip, as on a
 * mint or nettle leaf. Each tooth rises over most of its length and drops
 * back over the rest; `depth` is how far it drops, as a fraction of the
 * width there. Never wider than `profile`.
 */
export function serrate(
  profile: Profile,
  teeth: number,
  depth = 0.12,
): Profile {
  if (!(teeth > 0)) throw new RangeError("serrate: teeth must be positive");
  if (!(depth >= 0 && depth <= 1)) {
    throw new RangeError("serrate: depth must be between 0 and 1");
  }
  const RISE = 0.8;
  return (t) => {
    const f = clamp01(t) * teeth;
    const frac = f - Math.floor(f);
    const tooth = frac < RISE ? frac / RISE : (1 - frac) / (1 - RISE);
    return profile(t) * (1 - depth * (1 - tooth));
  };
}

/**
 * Scallops a profile's edge into `lobes` rounded lobes, as on a dandelion
 * or oak leaf: the gaps fall at t = k / lobes, so each lobe is centred
 * between two of them, and `depth` is how deep they cut, as a fraction of
 * the width there. Never wider than `profile`.
 */
export function lobed(profile: Profile, lobes: number, depth = 0.5): Profile {
  if (!(lobes > 0)) throw new RangeError("lobed: lobes must be positive");
  if (!(depth >= 0 && depth <= 1)) {
    throw new RangeError("lobed: depth must be between 0 and 1");
  }
  return (t) => {
    const gap = Math.abs(Math.cos(Math.PI * lobes * clamp01(t)));
    return profile(t) * (1 - depth * gap);
  };
}

export interface ParametricOptions {
  /** Points sampled along the curve. Default 256. */
  samples?: number;
}

/**
 * A profile from a curve `t → [x, y]` in unit leaf space, for t from 0 to
 * 1: y along the spine and x across it (see `OutlineProfile`). Unlike a
 * `Profile`, y may go past 1 or turn back, so a heart whose lobes rise past
 * a notched tip works. The width at each y, which across-the-spine hatching
 * needs, is worked out from the samples, so there's no inverse to write.
 *
 * GM's clover: `parametric(t => [Math.sin(t ** 0.8 * Math.PI),
 * Math.sin(t * Math.PI * 0.8)])`.
 */
export function parametric(
  curve: (t: number) => readonly [number, number],
  options: ParametricOptions = {},
): OutlineProfile {
  const samples = Math.max(2, Math.floor(options.samples ?? 256));
  const outline: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const [x, y] = curve(i / (samples - 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("parametric: the curve gave a non-finite point");
    }
    outline.push([Math.max(0, x), y]);
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [, y] of outline) {
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  // The widest x at each of `bins` evenly spaced heights, from every
  // segment that spans that height, then read off by linear interpolation.
  const bins = samples * 2;
  const table = new Float64Array(bins + 1);
  const span = yMax - yMin;
  if (span > 0) {
    const toBin = (y: number) => ((y - yMin) / span) * bins;
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i - 1];
      const [x1, y1] = outline[i];
      const lo = Math.ceil(toBin(Math.min(y0, y1)));
      const hi = Math.floor(toBin(Math.max(y0, y1)));
      for (let b = lo; b <= hi; b++) {
        const y = yMin + (b / bins) * span;
        const x =
          y1 === y0
            ? Math.max(x0, x1)
            : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        if (x > table[b]) table[b] = x;
      }
    }
  }

  return {
    outline,
    yMin,
    yMax,
    width(y: number): number {
      if (!(span > 0) || y < yMin || y > yMax) return 0;
      const f = ((y - yMin) / span) * bins;
      const b = Math.min(bins - 1, Math.floor(f));
      const w = f - b;
      return table[b] * (1 - w) + table[b + 1] * w;
    },
  };
}
