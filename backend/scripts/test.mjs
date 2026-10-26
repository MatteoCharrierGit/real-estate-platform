// Compila i test (test/*.test.ts) con esbuild in .test-dist/ e li esegue con node:test.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root } from "./functions.mjs";

const out = join(root, ".test-dist");
rmSync(out, { recursive: true, force: true });
const tests = readdirSync(join(root, "test")).filter((f) => f.endsWith(".test.ts"));
await build({
  entryPoints: tests.map((f) => join(root, "test", f)),
  outdir: out,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  loader: { ".sql": "text", ".pem": "text" },
  logLevel: "warning",
});
const r = spawnSync(process.execPath, ["--test", ...tests.map((f) => join(out, f.replace(/\.ts$/, ".js")))], { stdio: "inherit" });
process.exit(r.status ?? 1);
