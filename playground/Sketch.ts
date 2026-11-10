import type { Vec2 } from "wtc-math";
import type { Sheet, SheetOptions, Polyline, Random } from "wtc-drawer";
import type { Traits } from "./traits.js";

/**
 * Construction guides a sketch can show over its preview: the shapes behind
 * a boolean, a label on each part, and so on. Toggled with `d` (or start with
 * `?debug` in the URL). Guides are drawn on the preview only, never into the
 * document, so they don't reach the SVG, the occlusion mask or the stats.
 *
 * Sketches record guides every time, whether or not they're showing, so
 * debug mode can't change the artwork. Keep them cheap and don't draw random
 * numbers for them.
 */
export interface Debug {
  /** Dashed outlines, in mm. Default colour magenta. */
  path(paths: Polyline | readonly Polyline[], color?: string): void;
  /** A short label centred on `at`, in mm. */
  label(text: string, at: Vec2, color?: string): void;
}

/**
 * One parameter a sketch exposes in the panel. The kind follows from the
 * spec: a number (slider when it has `min` and `max`), a checkbox, a list of
 * `options` (strings, or `{ label: value }`), or a colour (`color: true`).
 */
export type ParamSpec =
  | {
      value: number;
      min?: number;
      max?: number;
      step?: number;
      label?: string;
    }
  | { value: boolean; label?: string }
  | {
      value: string;
      options: readonly string[] | Readonly<Record<string, string>>;
      label?: string;
    }
  | { value: string; color: true; label?: string };

export type ParamSpecs = Readonly<Record<string, ParamSpec>>;

/** The values a sketch's params take, typed from their specs. */
export type ParamValues<S extends ParamSpecs> = {
  readonly [K in keyof S]: S[K] extends { options: readonly (infer O)[] }
    ? O
    : S[K] extends { options: Readonly<Record<string, infer O>> }
      ? O
      : S[K]["value"] extends number
        ? number
        : S[K]["value"] extends boolean
          ? boolean
          : string;
};

/** What a sketch's `draw` gets besides the document, randomness and guides. */
export interface SketchContext<S extends ParamSpecs = ParamSpecs> {
  /** The panel's current values (the defaults, unless changed). */
  params: ParamValues<S>;
  /** Records this seed's traits: weighted choices worth naming. */
  traits: Traits;
}

/**
 * A playground artwork. Its SheetOptions (paper, orientation, margin,
 * paperColor) set up the sheet, then `draw` fills it. All randomness should
 * come from `random` so the seed reproduces the piece exactly.
 *
 * `params` declares values to tweak in the panel; they reach `draw` through
 * its fourth argument, as do `traits`. Use `defineSketch` so the params are
 * typed. Params change the artwork, so a seed reproduces a piece only with
 * the same params: the SVG's description records any that aren't defaults.
 */
export interface Sketch<S extends ParamSpecs = ParamSpecs>
  extends SheetOptions {
  title: string;
  params?: S;
  draw(
    doc: Sheet,
    random: Random,
    debug: Debug,
    context: SketchContext<S>,
  ): void;
}

/**
 * Declares a sketch, typing `draw`'s params from the specs:
 * `{ halo: { value: 0.6, min: 0, max: 2 } }` gives `params.halo: number`,
 * and `{ view: { value: "a", options: ["a", "b"] } }` gives `"a" | "b"`.
 */
export function defineSketch<const S extends ParamSpecs>(
  sketch: Sketch<S>,
): Sketch<S> {
  return sketch;
}
