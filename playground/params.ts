import type { ParamSpec, ParamSpecs } from "./Sketch.js";

/*
 * Sketch params: their defaults, and how they live in the URL. Only values
 * that differ from the default are written, as `?p.<name>=<value>`, so a
 * link carries exactly what was changed. Pure functions, no DOM.
 */

export type ParamValue = number | boolean | string;
export type Values = Record<string, ParamValue>;

/** URL query keys for params start with this. */
export const PREFIX = "p.";

export type ParamKind = "number" | "boolean" | "options" | "color";

export function kindOf(spec: ParamSpec): ParamKind {
  if ("options" in spec) return "options";
  if ("color" in spec) return "color";
  return typeof spec.value === "number" ? "number" : "boolean";
}

/** The values an options param allows. */
export function optionValues(spec: ParamSpec): readonly string[] {
  if (!("options" in spec)) return [];
  const o = spec.options;
  return Array.isArray(o) ? o : Object.values(o);
}

export function defaults(specs: ParamSpecs | undefined): Values {
  const out: Values = {};
  for (const [name, spec] of Object.entries(specs ?? {})) {
    out[name] = spec.value;
  }
  return out;
}

/**
 * Parses one value from the URL, or returns undefined if it doesn't fit the
 * spec (an unknown option, a number that isn't one), so the default stands.
 * Numbers are clamped to `min`/`max`.
 */
export function parseParam(
  spec: ParamSpec,
  text: string,
): ParamValue | undefined {
  switch (kindOf(spec)) {
    case "number": {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n)) return undefined;
      const s = spec as { min?: number; max?: number };
      return Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, n));
    }
    case "boolean":
      return text === "1" || text === "true"
        ? true
        : text === "0" || text === "false"
          ? false
          : undefined;
    case "options":
      return optionValues(spec).includes(text) ? text : undefined;
    case "color":
      return /^#[0-9a-f]{3,8}$/i.test(text) ? text : undefined;
  }
}

export function formatParam(value: ParamValue): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

/** The defaults, overridden by any valid `p.<name>` values in `query`. */
export function readParams(
  specs: ParamSpecs | undefined,
  query: URLSearchParams,
): Values {
  const out = defaults(specs);
  for (const [name, spec] of Object.entries(specs ?? {})) {
    const text = query.get(PREFIX + name);
    if (text === null) continue;
    const value = parseParam(spec, text);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Writes the values that differ from their defaults into `query` and
 * removes the rest, along with any `p.` keys the sketch doesn't have.
 */
export function writeParams(
  specs: ParamSpecs | undefined,
  values: Values,
  query: URLSearchParams,
): void {
  for (const key of [...query.keys()]) {
    if (key.startsWith(PREFIX)) query.delete(key);
  }
  for (const [name, value] of changed(specs, values)) {
    query.set(PREFIX + name, formatParam(value));
  }
}

/** The params whose values differ from their defaults, in spec order. */
export function changed(
  specs: ParamSpecs | undefined,
  values: Values,
): [string, ParamValue][] {
  const out: [string, ParamValue][] = [];
  for (const [name, spec] of Object.entries(specs ?? {})) {
    const value = values[name];
    if (value !== undefined && value !== spec.value) out.push([name, value]);
  }
  return out;
}
