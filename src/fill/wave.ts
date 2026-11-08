import type { Polyline } from "../geometry/Polyline.js";
import { simplify } from "../geometry/simplify.js";
import { hatchWith, type HatchOptions, type LineStyle } from "./hatch.js";
import type { ToneField } from "./tone.js";

export interface WaveToneOptions {
  /** Distance between lines, in mm. */
  spacing: number;
  /** Pen width in mm. */
  pen: number;
  /**
   * Largest wave height either side of the line, in mm. Default, and most,
   * `(spacing - pen) / 2`, so neighbouring lines never touch.
   */
  amplitude?: number;
  /** Wavelength while the waves grow, in mm. Default 2 × spacing. */
  wavelength?: number;
  /**
   * Shortest wavelength, reached at the darkest tone, in mm. At least `pen`.
   * Default `pen`, where the wave's flanks merge into a band that's solid
   * but for small scallops between the crests. Raise it to keep the darkest
   * waves open (2 × pen reaches about 0.75 at the default amplitude).
   */
  minWavelength?: number;
}

export interface WaveShadeOptions
  extends Omit<HatchOptions, "spacing" | "style">, WaveToneOptions {
  /** A tone from 0 (paper) to 1 (solid), or a function giving the tone at each point. */
  tone: number | ToneField;
  /** Phase of the waves in radians. Default 0. */
  phase?: number;
  /** Extra phase per lattice line, in radians. Default 0 (waves stacked in step). */
  phaseStep?: number;
  /** How often a tone field is sampled along each line, in mm. Default 0.25. */
  toneStep?: number;
}

/**
 * Shades closed shapes with continuous wavy lines, one every `spacing`, whose
 * waves carry the tone: as it darkens they first grow taller (at
 * `wavelength`), then tighten (down to `minWavelength`). Lines never break,
 * so gradients shade without lines dropping out.
 *
 * Tone is ink coverage, as for `shade`: each wave is chosen so its stroke,
 * `pen` wide, covers `tone` of the paper. The range is limited (see
 * `waveToneRange`): a straight line already covers `pen / spacing`, so
 * lighter tones get straight lines, and darker ones than the densest wave
 * get that wave.
 *
 * Lines sit on the same lattice as `hatch` (`anchor`, `offset`, `angle`).
 * The phase is pinned to the page, so a constant tone gives waves that run
 * on across neighbouring shapes. In a tone field the phase is summed along
 * each line, so the wave never kinks where its wavelength changes.
 */
export function waveShade(
  shapes: Polyline | readonly Polyline[],
  options: WaveShadeOptions,
): Polyline[] {
  const { tone } = options;
  const model = waveModel(options);
  const angle = options.angle ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const phase0 = options.phase ?? 0;
  const phaseStep = options.phaseStep ?? 0;
  const toneStep = options.toneStep ?? 0.25;
  if (!(toneStep > 0)) {
    throw new RangeError("waveShade: toneStep must be positive");
  }
  const TAU = Math.PI * 2;
  const wave = { amplitude: 0, wavelength: 0 };

  const style: LineStyle = ({ k, v, u0, u1 }) => {
    // The modulation parameter at even steps along the line.
    const n = Math.max(1, Math.ceil((u1 - u0) / toneStep));
    const params = new Float64Array(n + 1);
    if (typeof tone === "number") {
      params.fill(model.paramFor(tone));
    } else {
      for (let i = 0; i <= n; i++) {
        const u = u0 + ((u1 - u0) * i) / n;
        params[i] = model.paramFor(tone(u * cos - v * sin, u * sin + v * cos));
      }
    }
    if (params.every((t) => t === 0)) {
      return [
        [u0, v],
        [u1, v],
      ];
    }
    const paramAt = (u: number) => {
      const f = ((u - u0) / (u1 - u0)) * n;
      const i = Math.min(n - 1, Math.max(0, Math.floor(f)));
      return params[i] + (params[i + 1] - params[i]) * (f - i);
    };

    // Pin the phase to the page at the start of the line, then sum it along
    // the line: a constant wavelength gives exactly 2π·u / λ.
    model.at(params[0], wave);
    let phase = (TAU * u0) / wave.wavelength + phase0 + k * phaseStep;
    let inverse = 1 / wave.wavelength;
    const points: [number, number][] = [
      [u0, v + wave.amplitude * Math.sin(phase)],
    ];
    let u = u0;
    while (u < u1) {
      const step = Math.min(wave.wavelength / 16, toneStep, u1 - u);
      u = step < u1 - u ? u + step : u1;
      model.at(paramAt(u), wave);
      const next = 1 / wave.wavelength;
      phase += TAU * step * 0.5 * (inverse + next);
      inverse = next;
      points.push([u, v + wave.amplitude * Math.sin(phase)]);
    }
    return points;
  };

  const lines: HatchOptions = {
    spacing: options.spacing,
    angle,
    anchor: options.anchor,
    offset: options.offset,
    rule: options.rule,
    alternate: options.alternate,
    join: options.join,
    maxJoin: options.maxJoin,
    minLength: options.minLength,
    inset: options.inset,
    resolution: options.resolution,
    style,
  };
  return hatchWith(shapes, lines, (_k, piece) => [
    // Straight stretches, where the wave has flattened out, need few points.
    simplify(piece, 0.005),
  ]);
}

/**
 * The tones `waveShade` can reach with these options: from a straight line
 * (`pen / spacing`) to the densest wave.
 */
export function waveToneRange(options: WaveToneOptions): [number, number] {
  const { coverage } = waveModel(options);
  return [coverage[0], coverage[coverage.length - 1]];
}

/** Wave shape along the modulation parameter t, and its ink coverage. */
interface WaveModel {
  /** Coverage at evenly spaced t from 0 to 1, never decreasing. */
  readonly coverage: Float64Array;
  /** The t that gives `tone`, clamped to what the waves can reach. */
  paramFor(tone: number): number;
  /** The wave at t. */
  at(t: number, out: { amplitude: number; wavelength: number }): void;
}

const TABLE_SIZE = 65;
const models = new Map<string, WaveModel>();

function waveModel(options: WaveToneOptions): WaveModel {
  const { spacing, pen } = options;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("waveShade: spacing must be a positive number");
  }
  if (!(pen > 0) || !(pen < spacing)) {
    throw new RangeError("waveShade: pen must be positive and under spacing");
  }
  const most = (spacing - pen) / 2;
  const amplitude = options.amplitude ?? most;
  if (!(amplitude > 0) || amplitude > most + 1e-12) {
    throw new RangeError(
      "waveShade: amplitude must be positive and at most (spacing - pen) / 2",
    );
  }
  const wavelength = options.wavelength ?? 2 * spacing;
  const minWavelength = Math.min(options.minWavelength ?? pen, wavelength);
  if (!(wavelength > 0) || !(minWavelength >= pen)) {
    throw new RangeError(
      "waveShade: wavelengths must be positive, and minWavelength at least pen",
    );
  }

  const key = `${spacing}|${pen}|${amplitude}|${wavelength}|${minWavelength}`;
  const cached = models.get(key);
  if (cached) return cached;

  // Waves grow at `wavelength` over the first half of t, then tighten
  // geometrically down to `minWavelength`.
  const at = (t: number, out: { amplitude: number; wavelength: number }) => {
    if (t <= 0.5) {
      out.amplitude = amplitude * 2 * t;
      out.wavelength = wavelength;
    } else {
      out.amplitude = amplitude;
      out.wavelength =
        wavelength * (minWavelength / wavelength) ** ((t - 0.5) * 2);
    }
  };
  const coverage = new Float64Array(TABLE_SIZE);
  const wave = { amplitude: 0, wavelength: 0 };
  for (let i = 0; i < TABLE_SIZE; i++) {
    at(i / (TABLE_SIZE - 1), wave);
    const c = strokeCoverage(wave.amplitude, wave.wavelength, pen, spacing);
    coverage[i] = i > 0 ? Math.max(c, coverage[i - 1]) : c;
  }
  const paramFor = (tone: number) => {
    const c = Number.isFinite(tone) ? tone : 0;
    if (c <= coverage[0]) return 0;
    const last = TABLE_SIZE - 1;
    if (c >= coverage[last]) return 1;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (coverage[mid] <= c) lo = mid;
      else hi = mid;
    }
    const span = coverage[hi] - coverage[lo];
    const f = span > 0 ? (c - coverage[lo]) / span : 0;
    return (lo + f) / last;
  };

  const model: WaveModel = { coverage, paramFor, at };
  if (models.size > 64) models.clear();
  models.set(key, model);
  return model;
}

/**
 * The share of the paper inked by a sine wave of this amplitude and
 * wavelength, drawn `pen` wide on lines `spacing` apart. Measures the area
 * of the stroke itself, so where the wave's flanks crowd together and the
 * stroke overlaps, ink is counted once. Neighbouring lines must not touch
 * (amplitude at most (spacing - pen) / 2) and the wavelength must be at
 * least `pen`.
 */
export function strokeCoverage(
  amplitude: number,
  wavelength: number,
  pen: number,
  spacing: number,
): number {
  if (amplitude <= 0) return Math.min(1, pen / spacing);
  const r = pen / 2;
  // The wave over three periods, so the middle one sees its neighbours.
  const perPeriod = 96;
  const dx = wavelength / perPeriod;
  const count = 3 * perPeriod + 1;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const x = (j - perPeriod) * dx;
    xs[j] = x;
    ys[j] = amplitude * Math.sin((Math.PI * 2 * x) / wavelength);
  }

  // Integrate the stroke's height column by column over the middle period.
  const columns = 128;
  const width = wavelength / columns;
  const lows: number[] = [];
  const highs: number[] = [];
  const order: number[] = [];
  let area = 0;
  for (let i = 0; i < columns; i++) {
    const c = (i + 0.5) * width;
    const first = Math.max(0, Math.floor((c - r) / dx) + perPeriod - 1);
    const last = Math.min(count - 2, Math.ceil((c + r) / dx) + perPeriod);
    lows.length = 0;
    highs.length = 0;
    for (let j = first; j <= last; j++) {
      capsuleSpan(xs[j], ys[j], xs[j + 1], ys[j + 1], r, c, lows, highs);
    }
    order.length = 0;
    for (let m = 0; m < lows.length; m++) order.push(m);
    order.sort((a, b) => lows[a] - lows[b]);
    let covered = 0;
    let end = -Infinity;
    for (const m of order) {
      const lo = Math.max(lows[m], end);
      if (highs[m] > lo) covered += highs[m] - lo;
      end = Math.max(end, highs[m]);
    }
    area += covered * width;
  }
  return Math.min(1, area / (wavelength * spacing));
}

/**
 * Where the vertical line x = c crosses the stroke of segment a→b drawn with
 * radius r. The stroke is convex, so that's one interval, bounded by points
 * on its end caps or its sides. Pushes nothing when they miss.
 */
function capsuleSpan(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  c: number,
  lows: number[],
  highs: number[],
): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [px, py] of [
    [ax, ay],
    [bx, by],
  ]) {
    const d = px - c;
    if (Math.abs(d) <= r) {
      const h = Math.sqrt(r * r - d * d);
      lo = Math.min(lo, py - h);
      hi = Math.max(hi, py + h);
    }
  }
  const ex = bx - ax;
  const ey = by - ay;
  const length = Math.hypot(ex, ey);
  if (ex !== 0 && length > 0) {
    const nx = (-ey / length) * r;
    const ny = (ex / length) * r;
    for (const side of [1, -1]) {
      const t = (c - (ax + side * nx)) / ex;
      if (t >= 0 && t <= 1) {
        const y = ay + side * ny + t * ey;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  }
  if (lo <= hi) {
    lows.push(lo);
    highs.push(hi);
  }
}
