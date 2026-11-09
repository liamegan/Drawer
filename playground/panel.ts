import { Pane, type FolderApi } from "tweakpane";
import { defaults, kindOf, optionValues, type Values } from "./params.js";
import type { ParamSpec, Sketch } from "./Sketch.js";

/** View toggles the panel and the keys share. */
export interface ViewFlags {
  raw: boolean;
  travel: boolean;
  mask: boolean;
  debug: boolean;
}

/** What the panel asks the playground to do. */
export interface PanelHooks {
  params(values: Values): void;
  seed(seed: string): void;
  step(delta: number): void;
  randomSeed(): void;
  view(flag: keyof ViewFlags, on: boolean): void;
  saveSVG(): void;
  savePNG(dpi: number): void;
  exportRange(from: number, to: number, png: boolean, dpi: number): void;
  stop(): void;
}

/**
 * The playground's side panel (Tweakpane): the sketch's params, the seed,
 * its traits, view toggles and export. It holds no state of its own beyond
 * what it shows; every change goes out through `hooks`.
 */
export class Panel {
  readonly #pane: Pane;
  readonly #seed = { seed: "" };
  readonly #traits = { traits: "" };
  readonly #view: ViewFlags;
  readonly #export = { dpi: 300, from: 1, to: 20, png: false };
  #params: Values = {};
  #paramsFolder: FolderApi | null = null;
  readonly hooks: PanelHooks;

  constructor(container: HTMLElement, hooks: PanelHooks, view: ViewFlags) {
    this.hooks = hooks;
    this.#view = { ...view };
    this.#pane = new Pane({ container, title: "Drawer" });

    const seed = this.#pane.addFolder({ title: "Seed" });
    seed
      .addBinding(this.#seed, "seed", { label: "seed" })
      .on("change", (e) => {
        if (e.last && e.value.trim()) hooks.seed(e.value.trim());
      });
    seed.addButton({ title: "← previous" }).on("click", () => hooks.step(-1));
    seed.addButton({ title: "next →" }).on("click", () => hooks.step(1));
    seed.addButton({ title: "random" }).on("click", () => hooks.randomSeed());
    seed.addBinding(this.#traits, "traits", {
      label: "traits",
      readonly: true,
      multiline: true,
      rows: 4,
      interval: 0,
    });

    const views = this.#pane.addFolder({ title: "View", expanded: false });
    const labels: Record<keyof ViewFlags, string> = {
      raw: "raw (o)",
      travel: "travel (t)",
      mask: "mask (m)",
      debug: "debug (d)",
    };
    for (const flag of Object.keys(labels) as (keyof ViewFlags)[]) {
      views
        .addBinding(this.#view, flag, { label: labels[flag] })
        .on("change", (e) => hooks.view(flag, e.value));
    }

    const out = this.#pane.addFolder({ title: "Export" });
    out.addButton({ title: "save SVG (s)" }).on("click", () => hooks.saveSVG());
    out.addBinding(this.#export, "dpi", {
      label: "PNG dpi",
      options: { "150": 150, "300": 300, "600": 600 },
    });
    out
      .addButton({ title: "save PNG (p)" })
      .on("click", () => hooks.savePNG(this.#export.dpi));
    out.addBinding(this.#export, "from", { step: 1 });
    out.addBinding(this.#export, "to", { step: 1 });
    out.addBinding(this.#export, "png", { label: "also PNG" });
    out.addButton({ title: "export range" }).on("click", () => {
      const { from, to, png, dpi } = this.#export;
      hooks.exportRange(Math.round(from), Math.round(to), png, dpi);
    });
    out.addButton({ title: "stop" }).on("click", () => hooks.stop());
  }

  /** The PNG resolution chosen in the panel. */
  get dpi(): number {
    return this.#export.dpi;
  }

  /** Rebuilds the params folder for `sketch` (after a hot update too). */
  setSketch(sketch: Sketch, values: Values): void {
    this.#paramsFolder?.dispose();
    this.#paramsFolder = null;
    this.#params = { ...values };
    const specs = Object.entries(sketch.params ?? {});
    if (specs.length === 0) return;
    const folder = this.#pane.addFolder({ title: "Params", index: 0 });
    for (const [name, spec] of specs) {
      folder
        .addBinding(this.#params, name, bindingOptions(name, spec))
        .on("change", () => this.hooks.params({ ...this.#params }));
    }
    folder.addButton({ title: "reset" }).on("click", () => {
      Object.assign(this.#params, defaults(sketch.params));
      folder.refresh();
      this.hooks.params({ ...this.#params });
    });
    this.#paramsFolder = folder;
  }

  /** Shows a new seed's value and traits. */
  showRun(seed: string, traits: string): void {
    this.#seed.seed = seed;
    this.#traits.traits = traits || "(none recorded)";
    this.#pane.refresh();
  }

  /** Mirrors a view flag changed by a key. */
  setView(flag: keyof ViewFlags, on: boolean): void {
    this.#view[flag] = on;
    this.#pane.refresh();
  }
}

function bindingOptions(name: string, spec: ParamSpec) {
  const label = spec.label ?? name;
  switch (kindOf(spec)) {
    case "number": {
      const s = spec as { min?: number; max?: number; step?: number };
      return { label, min: s.min, max: s.max, step: s.step };
    }
    case "options": {
      const values = optionValues(spec);
      const o = (spec as { options: object }).options;
      const options = Array.isArray(o)
        ? Object.fromEntries(values.map((v) => [v, v]))
        : (o as Record<string, string>);
      return { label, options };
    }
    case "color":
      return { label, view: "color" };
    default:
      return { label };
  }
}
