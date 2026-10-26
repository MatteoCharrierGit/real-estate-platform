// Un bundle per funzione: dist/<nome>/index.js, autosufficiente (dipendenze e AWS SDK incluse).
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { functionNames, root } from "./functions.mjs";

rmSync(join(root, "dist"), { recursive: true, force: true });

for (const name of functionNames) {
  await build({
    entryPoints: [join(root, "src", "functions", name, "index.ts")],
    outfile: join(root, "dist", name, "index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs", // handler = exports.handler, come "index.handler" in Lambda
    minify: false,
    sourcemap: false,
    legalComments: "none",
    loader: { ".sql": "text", ".pem": "text" }, // gli SQL e il certificato di db-migrate finiscono nel bundle
    logLevel: "warning",
  });
  console.log(`built dist/${name}/index.js`);
}
