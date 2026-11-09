import type { Sketch } from "./Sketch.js";

// Every file directly in ./sketches is a sketch, keyed by file name:
// sketches/hello.ts → ?sketch=hello. Shared code lives in ./sketches/lib.
// main.ts accepts hot updates of this module, so editing a sketch rebuilds
// the preview in place.
const modules = import.meta.glob<{ default: Sketch }>("./sketches/*.ts", {
  eager: true,
});

export const sketches: ReadonlyMap<string, Sketch> = new Map(
  Object.entries(modules).map(([path, mod]) => [
    path.replace(/^.*\/(.+)\.ts$/, "$1"),
    mod.default,
  ]),
);
