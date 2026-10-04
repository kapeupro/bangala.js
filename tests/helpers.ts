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

/**
 * Writes `files` into a fresh directory under `tests/.tmp/`, compiles every
 * `.bangala` file to a sibling `.js` module (compile() + esbuild), copies
 * the other files verbatim, then imports `entry` and renders it.
 */
export async function compileAndRenderProject(
  files: Record<string, string>,
  entry: string,
  props: Record<string, unknown> = {},
): Promise<{ html: string; mod: Record<string, unknown>; code: string }> {
  const dir = join(TMP_DIR, `project-${counter++}-${Date.now()}`);
  let entryCode = "";
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    if (!name.endsWith(".bangala")) {
      writeFileSync(file, content);
      continue;
    }
    const { code } = compile(content, { filename: name });
    if (name === entry) entryCode = code;
    const js = (await transform(code, { loader: "ts", format: "esm" })).code;
    writeFileSync(file.replace(/\.bangala$/, ".js"), js);
  }
  const mod = (await import(pathToFileURL(join(dir, entry.replace(/\.bangala$/, ".js"))).href)) as {
    render: (p: Record<string, unknown>) => Promise<string>;
  };
  return { html: await mod.render(props), mod, code: entryCode };
}
