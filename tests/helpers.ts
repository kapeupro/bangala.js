import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { compile } from "../src/index.js";

/**
 * Compiles a .bangala source, transpiles the generated module via esbuild,
 * writes it inside `tests/.tmp/` (so `bangala/runtime` resolves via Node
 * self-referencing through the package's exports map), and executes
 * `render(props)`.
 */
const TMP_DIR = join(dirname(fileURLToPath(import.meta.url)), ".tmp");
let counter = 0;

export async function compileAndRender(
  source: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  const { code } = compile(source, { filename: "test.bangala" });
  const js = (await transform(code, { loader: "ts", format: "esm" })).code;
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  const file = join(TMP_DIR, `mod-${counter++}-${Date.now()}.mjs`);
  writeFileSync(file, js);
  const mod = (await import(pathToFileURL(file).href)) as {
    render: (p: Record<string, unknown>) => Promise<string>;
  };
  return mod.render(props);
}
