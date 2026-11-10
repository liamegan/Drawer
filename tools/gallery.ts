import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";

/**
 * Renders the README gallery: each sketch below at its seed and default
 * params, optimised, written to `docs/gallery/<sketch>-<seed>.svg`. It loads
 * the playground through Vite (so the `wtc-drawer` alias works) and builds
 * with `runSketch`, as the playground's batch export does.
 *
 *     npm run gallery
 *     npm run gallery -- --out /tmp/try stones:1 stones:2 meadow:7
 */
const GALLERY = [
  "stones:3",
  "meadow:4",
  "flow:2",
  "contours:2",
  "occlusion:1",
  "shading:6",
];

// What the script uses from playground/{run,params,sketches}.ts. The
// playground is typed against the DOM, so it isn't imported for types here.
interface Run {
  traits: { toString(): string };
  buildMs: number;
}
interface Playground {
  run: {
    runSketch(sketch: unknown, seed: string, params: unknown): Run;
    runSVG(sketch: unknown, run: Run, options: { background: boolean }): string;
  };
  params: { defaults(specs: unknown): unknown };
  sketches: { sketches: ReadonlyMap<string, { params?: unknown }> };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "docs/gallery" } },
});
const picks = positionals.length > 0 ? positionals : GALLERY;

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "warn",
});
try {
  const load = (path: string) => server.ssrLoadModule(path);
  const pg = {
    run: await load("/playground/run.ts"),
    params: await load("/playground/params.ts"),
    sketches: await load("/playground/sketches.ts"),
  } as unknown as Playground;

  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  for (const pick of picks) {
    const [name, seed = "1"] = pick.split(":");
    const sketch = pg.sketches.sketches.get(name);
    if (!sketch) throw new Error(`no sketch called "${name}"`);
    const params = pg.params.defaults(sketch.params);
    const run = pg.run.runSketch(sketch, seed, params);
    const svg = pg.run.runSVG(sketch, run, { background: true });
    await writeFile(resolve(out, `${name}-${seed}.svg`), svg);
    const traits = String(run.traits);
    const ms = Math.round(run.buildMs);
    console.log(`${name}-${seed}.svg  ${ms} ms  ${traits}`.trimEnd());
  }
} finally {
  await server.close();
}
