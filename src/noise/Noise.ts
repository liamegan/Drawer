import type { Random } from "../random/Random.js";

export interface FbmOptions {
  /** Layers of noise summed. Default 4. */
  octaves?: number;
  /**
   * Frequency of the first octave. Features are about `1 / frequency` across,
   * in the units of x and y (mm on a page), so 0.05 gives blobs ~20 mm wide.
   * Default 1.
   */
  frequency?: number;
  /** Frequency multiplier from one octave to the next. Default 2. */
  lacunarity?: number;
  /** Amplitude multiplier from one octave to the next. Default 0.5. */
  gain?: number;
}

// Gradients: the 12 edge midpoints of a cube. 2D noise uses their x and y.
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0,
  -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

/**
 * Seeded simplex noise in 2D and 3D (Stefan Gustavson's formulation), with
 * fractal Brownian motion on top. Values run from about -1 to 1 and vary
 * smoothly, with features about one unit across.
 *
 * The permutation table is shuffled with `random`, so the same seed gives the
 * same noise. Pass a fork (`random.fork("noise")`) so making noise doesn't
 * shift the rest of a sketch's random numbers.
 */
export class Noise {
  readonly #perm = new Uint8Array(512);
  readonly #grad = new Uint8Array(512);

  constructor(random: Random) {
    const table = random.shuffle(Array.from({ length: 256 }, (_, i) => i));
    for (let i = 0; i < 512; i++) {
      this.#perm[i] = table[i & 255];
      this.#grad[i] = (table[i & 255] % 12) * 3;
    }
  }

  /** 2D simplex noise at (x, y), in [-1, 1]. */
  simplex2(x: number, y: number): number {
    const perm = this.#perm;
    const grad = this.#grad;
    // Skew to find the simplex cell, then unskew to its first corner.
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    // The middle corner: across x first or across y first.
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = grad[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = grad[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = grad[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
    }
    // Scales the sum to about [-1, 1].
    return 70 * n;
  }

  /** 3D simplex noise at (x, y, z), in [-1, 1]. Use z for time or a layer. */
  simplex3(x: number, y: number, z: number): number {
    const perm = this.#perm;
    const grad = this.#grad;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    // Which of the six tetrahedra: the order the axes are crossed in.
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else {
      if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
      else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    const corner = (g: number, dx: number, dy: number, dz: number) => {
      let c = 0.6 - dx * dx - dy * dy - dz * dz;
      if (c <= 0) return 0;
      c *= c;
      return c * c * (GRAD3[g] * dx + GRAD3[g + 1] * dy + GRAD3[g + 2] * dz);
    };
    const n =
      corner(grad[ii + perm[jj + perm[kk]]], x0, y0, z0) +
      corner(grad[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1) +
      corner(grad[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2) +
      corner(grad[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3);
    return 32 * n;
  }

  /**
   * Fractal Brownian motion: octaves of 2D noise, each finer and fainter,
   * summed and scaled back to [-1, 1].
   */
  fbm2(x: number, y: number, options: FbmOptions = {}): number {
    const { octaves, lacunarity, gain } = fbmSettings(options);
    let frequency = options.frequency ?? 1;
    let amplitude = 1;
    let sum = 0;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.simplex2(x * frequency, y * frequency);
      total += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return sum / total;
  }

  /** `fbm2` in 3D. */
  fbm3(x: number, y: number, z: number, options: FbmOptions = {}): number {
    const { octaves, lacunarity, gain } = fbmSettings(options);
    let frequency = options.frequency ?? 1;
    let amplitude = 1;
    let sum = 0;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      sum +=
        amplitude * this.simplex3(x * frequency, y * frequency, z * frequency);
      total += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return sum / total;
  }
}

function fbmSettings(options: FbmOptions) {
  const octaves = Math.max(1, Math.floor(options.octaves ?? 4));
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  if (!(gain > 0)) throw new RangeError("fbm: gain must be positive");
  return { octaves, lacunarity, gain };
}
