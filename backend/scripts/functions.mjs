// Le funzioni del backend: ogni cartella di src/functions/<nome> è una Lambda (entry: index.ts).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(fileURLToPath(import.meta.url), "..", "..");

export const functionNames = readdirSync(join(root, "src", "functions"))
  .filter((n) => statSync(join(root, "src", "functions", n)).isDirectory())
  .sort();
