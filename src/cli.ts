#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  applyDeployAdapter,
  createDeployAdapter,
  listDeployAdapters,
  type DeployAdapter,
} from "./adapters.js";
import {
  banner,
  buildSummary,
  color,
  devSummary,
  nextStepsBlock,
} from "./cli-format.js";
import { findFreePort } from "./cli-net.js";
import { buildBangala, createBangalaDevServer } from "./vite.js";

export interface CliIO {
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export interface CreateProjectOptions {
  force?: boolean;
  name?: string;
  adapter?: string | false;
  packageVersion?: string;
}

interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
  booleans: Set<string>;
}

const VERSION = readPackageVersion();
const DEFAULT_PORT = 5173;

export async function main(
  argv = process.argv.slice(2),
  io: CliIO = {},
): Promise<number> {
  try {
    await run(argv, io);
    return 0;
  } catch (error) {
    printError(io, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function run(argv: string[], io: CliIO = {}): Promise<void> {
  const command = argv[0];
  const args = argv.slice(1);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    print(io, helpText());
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    print(io, VERSION);
    return;
  }

  switch (command) {
    case "dev":
      await runDev(args, io);
      return;
    case "build":
      await runBuild(args, io);
      return;
    case "create":
      await runCreate(args, io);
      return;
    case "deploy":
      await runDeploy(args, io);
      return;
    default:
      throw new Error(`Unknown command '${command}'. Run 'bangala --help'.`);
  }
}

export async function createProject(
  root: string,
  options: CreateProjectOptions = {},
): Promise<{ root: string; files: string[]; adapter: DeployAdapter | null }> {
  const projectRoot = resolve(root);
  const name = packageName(options.name ?? (basename(projectRoot) || "bangala-app"));
  const version = options.packageVersion ?? VERSION;
  const force = options.force ?? false;

  if (existsSync(projectRoot) && !force) {
    const entries = await readdir(projectRoot);
    if (entries.length > 0) {
      throw new Error(`Directory '${projectRoot}' is not empty. Use --force to write into it.`);
    }
  }

  const files = templateFiles(name, version);
  for (const file of files) {
    await writeProjectFile(projectRoot, file.path, file.contents, force);
  }

  const adapter = options.adapter
    ? await applyDeployAdapter(projectRoot, options.adapter, {
      force,
      projectName: name,
      outDir: "dist",
    })
    : null;

  return { root: projectRoot, files: files.map((file) => file.path), adapter };
}

async function runDev(args: string[], io: CliIO): Promise<void> {
  const parsed = parseArgs(args, {
    values: ["root", "pages", "host", "port"],
    booleans: ["help", "no-inject-client", "open"],
  });
  if (parsed.booleans.has("help")) {
    print(io, devHelpText());
    return;
  }

  const root = resolve(io.cwd ?? process.cwd(), option(parsed, "root") ?? ".");
  const pages = option(parsed, "pages") ?? "pages";
  const host = option(parsed, "host") ?? "127.0.0.1";
  const injectClient = !parsed.booleans.has("no-inject-client");
  const shouldOpen = parsed.booleans.has("open");

  const explicitPort = optionalNumberOption(parsed, "port");
  const requestedPort = explicitPort ?? DEFAULT_PORT;
  const port = explicitPort !== undefined
    ? explicitPort
    : await findFreePort(DEFAULT_PORT);

  const server = await createBangalaDevServer({
    root,
    pages,
    injectClient,
    vite: { server: { host, port } },
  });

  await server.listen(port);
  const url = server.resolvedUrls?.local[0] ?? `http://${host}:${port}/`;
  const network = server.resolvedUrls?.network[0];

  print(io, banner(VERSION));
  print(
    io,
    devSummary({
      url,
      network,
      pages,
      portChangedFrom: port !== requestedPort ? requestedPort : undefined,
    }),
  );

  if (shouldOpen) openBrowser(url);
}

async function runBuild(args: string[], io: CliIO): Promise<void> {
  const parsed = parseArgs(args, {
    values: ["root", "pages", "out-dir", "outDir", "prerender", "adapter"],
    booleans: ["help", "no-client", "no-inject-client", "force"],
  });
  if (parsed.booleans.has("help")) {
    print(io, buildHelpText());
    return;
  }

  const root = resolve(io.cwd ?? process.cwd(), option(parsed, "root") ?? ".");
  const outDir = option(parsed, "out-dir") ?? option(parsed, "outDir") ?? "dist";

  const t0 = Date.now();
  const result = await buildBangala({
    root,
    pages: option(parsed, "pages") ?? "pages",
    outDir,
    prerender: options(parsed, "prerender"),
    client: !parsed.booleans.has("no-client"),
    injectClient: !parsed.booleans.has("no-inject-client"),
  });
  const durationMs = Date.now() - t0;

  const adapterName = option(parsed, "adapter");
  if (adapterName) {
    await applyDeployAdapter(root, adapterName, {
      outDir,
      force: parsed.booleans.has("force"),
      projectName: packageName(basename(root) || "bangala-app"),
    });
  }

  // Keep the plain machine-readable line so existing tests / scripts keep working.
  print(
    io,
    `built ${result.pages.length} page(s) to ${relative(root, result.outDir) || "."}`,
  );

  let clientBytes: number | undefined;
  let clientGzipBytes: number | undefined;
  if (result.clientEntry) {
    try {
      clientBytes = statSync(result.clientEntry).size;
      const contents = await readFile(result.clientEntry);
      clientGzipBytes = gzipSync(contents).length;
    } catch {
      // Bundle file may not exist if a custom Vite config redirected output;
      // skip the size line rather than crashing the CLI.
    }
  }

  print(
    io,
    buildSummary({
      pages: result.pages.length,
      outDir: relative(root, result.outDir) || ".",
      durationMs,
      clientBytes,
      clientGzipBytes,
    }),
  );
}

async function runCreate(args: string[], io: CliIO): Promise<void> {
  const parsed = parseArgs(args, {
    values: ["template", "adapter"],
    booleans: ["help", "force"],
  });
  if (parsed.booleans.has("help")) {
    print(io, createHelpText());
    return;
  }

  const template = option(parsed, "template") ?? "basic";
  if (template !== "basic") {
    throw new Error(`Unknown template '${template}'. Available templates: basic`);
  }

  const target = parsed.positionals[0] ?? "bangala-app";
  const projectRoot = resolve(io.cwd ?? process.cwd(), target);
  const result = await createProject(projectRoot, {
    force: parsed.booleans.has("force"),
    adapter: option(parsed, "adapter") ?? false,
  });

  const displayPath = relative(io.cwd ?? process.cwd(), result.root) || ".";
  // Plain status line preserved for tests/scripts that grep for "created ...".
  print(io, `created ${displayPath}`);
  if (result.adapter) print(io, `configured ${result.adapter.name} deploy adapter`);
  print(io, "");
  print(io, nextStepsBlock(displayPath));
}

async function runDeploy(args: string[], io: CliIO): Promise<void> {
  const parsed = parseArgs(args, {
    values: ["root", "out-dir", "outDir", "build-command", "project-name"],
    booleans: ["help", "list", "force"],
  });
  if (parsed.booleans.has("help")) {
    print(io, deployHelpText());
    return;
  }
  if (parsed.booleans.has("list")) {
    print(io, listDeployAdapters().join("\n"));
    return;
  }

  const name = parsed.positionals[0];
  if (!name) throw new Error("Missing deploy adapter. Run 'bangala deploy --list'.");

  const root = resolve(io.cwd ?? process.cwd(), option(parsed, "root") ?? ".");
  const outDir = option(parsed, "out-dir") ?? option(parsed, "outDir") ?? "dist";
  const adapter = await applyDeployAdapter(root, name, {
    outDir,
    force: parsed.booleans.has("force"),
    buildCommand: option(parsed, "build-command") ?? "npm run build",
    projectName: option(parsed, "project-name") ?? packageName(basename(root) || "bangala-app"),
  });

  const files = adapter.files.length === 0
    ? "no files needed"
    : adapter.files.map((file) => file.path).join(", ");
  print(io, `configured ${adapter.name}: ${files}`);
}

function parseArgs(
  args: string[],
  schema: { values: string[]; booleans: string[] },
): ParsedArgs {
  const valueFlags = new Set(schema.values);
  const booleanFlags = new Set(schema.booleans);
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2) as [string, string?];
    if (booleanFlags.has(rawName)) {
      if (inlineValue !== undefined) throw new Error(`--${rawName} does not take a value`);
      booleans.add(rawName);
      continue;
    }
    if (!valueFlags.has(rawName)) throw new Error(`Unknown option '--${rawName}'`);

    const value = inlineValue ?? args[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for '--${rawName}'`);
    }
    const list = values.get(rawName) ?? [];
    list.push(value);
    values.set(rawName, list);
  }

  return { positionals, values, booleans };
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.values.get(name)?.at(-1);
}

function options(parsed: ParsedArgs, name: string): string[] {
  return parsed.values.get(name) ?? [];
}

function numberOption(parsed: ParsedArgs, name: string, fallback: number): number {
  const value = option(parsed, name);
  if (value === undefined) return fallback;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsedValue;
}

function optionalNumberOption(parsed: ParsedArgs, name: string): number | undefined {
  const value = option(parsed, name);
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsedValue;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // Best effort: don't crash if the OS handler is missing.
    });
    child.unref();
  } catch {
    // Best effort: never let a failing browser open kill the dev server.
  }
}

async function writeProjectFile(
  root: string,
  file: string,
  contents: string,
  force: boolean,
): Promise<void> {
  const full = join(root, file);
  if (existsSync(full) && !force) {
    throw new Error(`Refusing to overwrite '${file}' without --force`);
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

function templateFiles(name: string, version: string): { path: string; contents: string }[] {
  return [
    {
      path: "package.json",
      contents: `${JSON.stringify({
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: {
          dev: "bangala dev",
          build: "bangala build --out-dir _site",
          preview: "bangala build --out-dir _site && npx serve _site",
        },
        dependencies: {
          bangala: `^${version}`,
        },
        devDependencies: {
          vite: "^7.3.3",
        },
      }, null, 2)}\n`,
    },
    {
      path: "pages/index.bangala",
      contents:
        `---\n` +
        `import Counter from "../components/Counter.bangala"\n` +
        `const title = "Welcome to bangala.js"\n` +
        `---\n` +
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `  <meta charset="utf-8"/>\n` +
        `  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n` +
        `  <title>{title}</title>\n` +
        `  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>\n` +
        `  <link rel="stylesheet" href="/styles.css"/>\n` +
        `</head>\n` +
        `<body>\n` +
        `  <main>\n` +
        `    <p class="eyebrow">HTML-first · islands on demand</p>\n` +
        `    <h1>{title}</h1>\n` +
        `    <p class="lede">\n` +
        `      This page is static HTML. The counter below is the only piece of JavaScript on this page —\n` +
        `      it hydrates as soon as the runtime sees it. Click it.\n` +
        `    </p>\n` +
        `\n` +
        `    <bangala-island\n` +
        `      data-entry="/islands/Counter.client.js"\n` +
        `      data-props={JSON.stringify({ start: 0 })}\n` +
        `      data-strategy="load">\n` +
        `      <Counter start={0}/>\n` +
        `    </bangala-island>\n` +
        `\n` +
        `    <p class="hint">Edit <code>pages/index.bangala</code> and save — the dev server picks it up.</p>\n` +
        `  </main>\n` +
        `</body>\n` +
        `</html>\n`,
    },
    {
      path: "components/Counter.bangala",
      contents:
        `---\n` +
        `// SSR shell for the Counter island. The button label is rendered on the server\n` +
        `// so users see the initial value before any JavaScript runs.\n` +
        `// The interactive behaviour lives in public/islands/Counter.client.js.\n` +
        `const start = props.start ?? 0\n` +
        `---\n` +
        `<button class="counter" type="button">Counter: {start}</button>\n`,
    },
    {
      path: "public/islands/Counter.client.js",
      contents:
        `// bangala island: Counter\n` +
        `// Strategy: client:load — hydrates immediately on page load.\n` +
        `// Props: { start?: number }\n` +
        `\n` +
        `export async function mount(el, props) {\n` +
        `  const button = el.querySelector("button");\n` +
        `  if (!button) throw new Error("Counter island: missing <button> child");\n` +
        `  let count = typeof props?.start === "number" ? props.start : 0;\n` +
        `  const render = () => {\n` +
        `    button.textContent = \`Counter: \${count}\`;\n` +
        `  };\n` +
        `  render();\n` +
        `  button.addEventListener("click", () => {\n` +
        `    count += 1;\n` +
        `    render();\n` +
        `  });\n` +
        `}\n`,
    },
    {
      path: "public/favicon.svg",
      contents: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#f97316"/><text x="16" y="22" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20" font-weight="800" text-anchor="middle" fill="#fff">b</text></svg>\n`,
    },
    {
      path: "public/styles.css",
      contents:
        `:root {\n` +
        `  color-scheme: dark;\n` +
        `  --bg: #0b0b0d;\n` +
        `  --fg: #e7e7ea;\n` +
        `  --muted: #9a9aa3;\n` +
        `  --accent: #f97316;\n` +
        `  --card: #16161a;\n` +
        `  --border: #26262d;\n` +
        `  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;\n` +
        `  background: var(--bg);\n` +
        `  color: var(--fg);\n` +
        `}\n` +
        `* { box-sizing: border-box; }\n` +
        `body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }\n` +
        `main { width: 100%; max-width: 720px; }\n` +
        `.eyebrow {\n` +
        `  font-size: 12px; font-weight: 700; letter-spacing: 0.16em;\n` +
        `  text-transform: uppercase; color: var(--accent); margin: 0 0 12px;\n` +
        `}\n` +
        `h1 { font-size: clamp(36px, 6vw, 56px); line-height: 1.05; margin: 0 0 16px; letter-spacing: -0.02em; }\n` +
        `.lede { font-size: 18px; line-height: 1.6; color: var(--muted); margin: 0 0 28px; }\n` +
        `.hint { font-size: 14px; color: var(--muted); margin-top: 24px; }\n` +
        `.hint code { background: var(--card); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; }\n` +
        `button.counter {\n` +
        `  font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;\n` +
        `  background: var(--accent); color: #1a0f00; border: 0; padding: 12px 20px;\n` +
        `  border-radius: 10px; transition: transform 0.06s ease, filter 0.15s ease;\n` +
        `}\n` +
        `button.counter:hover { filter: brightness(1.06); }\n` +
        `button.counter:active { transform: translateY(1px); }\n`,
    },
    {
      path: "README.md",
      contents:
        `# ${name}\n` +
        `\n` +
        `A starter [bangala.js](https://github.com/kapeupro/bangala) project. HTML first, islands on demand.\n` +
        `\n` +
        `## Get going\n` +
        `\n` +
        `\`\`\`sh\n` +
        `npm install\n` +
        `npm run dev\n` +
        `\`\`\`\n` +
        `\n` +
        `Open http://localhost:5173/ — click the counter and watch the number go up. That's a single\n` +
        `interactive island; the rest of the page is plain static HTML.\n` +
        `\n` +
        `## The four files that matter\n` +
        `\n` +
        `- \`pages/index.bangala\` — the home page. Static markup plus a \`<bangala-island>\` marker that\n` +
        `  embeds the SSR shell and tells the runtime where to find the JS.\n` +
        `- \`components/Counter.bangala\` — the **SSR shell** for the counter island. It renders the\n` +
        `  initial button on the server so users see the starting value before any JS runs.\n` +
        `- \`public/islands/Counter.client.js\` — the **interactive code**. Exports \`mount(el, props)\`.\n` +
        `  Files under \`public/\` are served as-is, so the marker can reach this at\n` +
        `  \`/islands/Counter.client.js\`.\n` +
        `- \`public/styles.css\` — global styles.\n` +
        `\n` +
        `## Build\n` +
        `\n` +
        `\`\`\`sh\n` +
        `npm run build\n` +
        `\`\`\`\n` +
        `\n` +
        `Emits a static site to \`_site/\`. Use \`npm run preview\` to serve it locally.\n`,
    },
    {
      path: ".gitignore",
      contents: `node_modules/\ndist/\n_site/\n.DS_Store\n`,
    },
  ];
}

function packageName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bangala-app";
}

function helpText(): string {
  return [
    `bangala ${VERSION}`,
    "",
    "Usage:",
    "  bangala dev [--root DIR] [--pages DIR] [--host HOST] [--port PORT] [--open]",
    "  bangala build [--root DIR] [--pages DIR] [--out-dir DIR] [--prerender PATH]",
    "  bangala create [DIR] [--adapter NAME] [--force]",
    "  bangala deploy <adapter> [--root DIR] [--out-dir DIR] [--force]",
    "",
    "Commands:",
    "  dev       Start the Vite-powered Bangala dev server",
    "  build     Prerender pages and bundle the client runtime",
    "  create    Scaffold a minimal Bangala project",
    "  deploy    Write deployment config for static hosts",
  ].join("\n");
}

function devHelpText(): string {
  return [
    "Usage: bangala dev [options]",
    "",
    "Options:",
    "  --root DIR             Project root (default: .)",
    "  --pages DIR            Pages directory (default: pages)",
    "  --host HOST            Host (default: 127.0.0.1)",
    "  --port PORT            Port (default: 5173, auto-picks next free if busy)",
    "  --open                 Open the dev URL in the default browser",
    "  --no-inject-client     Do not inject bangala/client/auto",
  ].join("\n");
}

function buildHelpText(): string {
  return [
    "Usage: bangala build [options]",
    "",
    "Options:",
    "  --root DIR             Project root (default: .)",
    "  --pages DIR            Pages directory (default: pages)",
    "  --out-dir DIR          Output directory (default: dist)",
    "  --prerender PATH       Extra dynamic route to prerender (repeatable)",
    "  --adapter NAME         Also write deployment config",
    "  --no-client            Do not bundle bangala/client/auto",
    "  --no-inject-client     Do not inject the client script in HTML",
    "  --force                Allow adapter config overwrite",
  ].join("\n");
}

function createHelpText(): string {
  return [
    "Usage: bangala create [dir] [options]",
    "",
    "Options:",
    "  --template basic       Template to use (default: basic)",
    "  --adapter NAME         Also configure a deploy adapter",
    "  --force                Allow writing into a non-empty directory",
  ].join("\n");
}

function deployHelpText(): string {
  return [
    "Usage: bangala deploy <adapter> [options]",
    "",
    `Adapters: ${listDeployAdapters().join(", ")}`,
    "",
    "Options:",
    "  --list                 Print adapter names",
    "  --root DIR             Project root (default: .)",
    "  --out-dir DIR          Build output directory (default: dist)",
    "  --build-command CMD    Build command (default: npm run build)",
    "  --project-name NAME    Adapter project name",
    "  --force                Allow overwriting adapter config",
  ].join("\n");
}

function print(io: CliIO, message: string): void {
  (io.stdout ?? console.log)(message);
}

function printError(io: CliIO, message: string): void {
  (io.stderr ?? console.error)(message);
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // Try the next candidate.
    }
  }
  return "0.0.0";
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isCliEntrypoint()) {
  const code = await main();
  process.exitCode = code;
}

export { createDeployAdapter, listDeployAdapters };
