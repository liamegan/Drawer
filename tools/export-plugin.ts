import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Lets the playground write files during `vite dev`: `POST
 * /__export?file=<path>` saves the request body to `<dir>/<path>`. Only
 * `.svg`, `.png` and `.json` files, and only inside `dir`. The batch export
 * uses it; nothing else is served or read.
 */
export function exportPlugin(dir = "exports"): Plugin {
  return {
    name: "drawer-export",
    apply: "serve",
    configureServer(server) {
      const root = resolve(server.config.root, dir);
      server.middlewares.use("/__export", (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.end(message);
        };
        if (req.method !== "POST") return fail(405, "POST only");
        const file = new URL(req.url ?? "", "http://local").searchParams.get(
          "file",
        );
        const target = resolve(root, file ?? "");
        if (
          !file ||
          !/\.(svg|png|json)$/i.test(file) ||
          !target.startsWith(root + sep)
        ) {
          return fail(400, "bad file name");
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          mkdir(dirname(target), { recursive: true })
            .then(() => writeFile(target, Buffer.concat(chunks)))
            .then(
              () => res.end(relative(server.config.root, target)),
              (error: unknown) => fail(500, String(error)),
            );
        });
      });
    },
  };
}
