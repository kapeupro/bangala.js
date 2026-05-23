#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyDeployAdapter,
  createDeployAdapter,
  listDeployAdapters,
  type DeployAdapter,
} from "./adapters.js";
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
    booleans: ["help", "no-inject-client"],
  });
  if (parsed.booleans.has("help")) {
    print(io, devHelpText());
    return;
  }

  const root = resolve(io.cwd ?? process.cwd(), option(parsed, "root") ?? ".");
  const pages = option(parsed, "pages") ?? "pages";
  const host = option(parsed, "host") ?? "127.0.0.1";
  const port = numberOption(parsed, "port", DEFAULT_PORT);
  const injectClient = !parsed.booleans.has("no-inject-client");

  const server = await createBangalaDevServer({
    root,
    pages,
    injectClient,
    vite: { server: { host, port } },
  });

  await server.listen(port);
  const url = server.resolvedUrls?.local[0] ?? `http://${host}:${port}/`;
  print(io, `bangala dev server running at ${url}`);
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
  const result = await buildBangala({
    root,
    pages: option(parsed, "pages") ?? "pages",
    outDir,
    prerender: options(parsed, "prerender"),
    client: !parsed.booleans.has("no-client"),
    injectClient: !parsed.booleans.has("no-inject-client"),
  });

  const adapterName = option(parsed, "adapter");
  if (adapterName) {
    await applyDeployAdapter(root, adapterName, {
      outDir,
      force: parsed.booleans.has("force"),
      projectName: packageName(basename(root) || "bangala-app"),
    });
  }

  print(
    io,
    `built ${result.pages.length} page(s) to ${relative(root, result.outDir) || "."}`,
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

  print(io, `created ${relative(io.cwd ?? process.cwd(), result.root) || "."}`);
  if (result.adapter) print(io, `configured ${result.adapter.name} deploy adapter`);
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
        private: true,
        type: "module",
        scripts: {
          dev: "bangala dev",
          build: "bangala build",
        },
        dependencies: {
          bangala: `^${version}`,
        },
        devDependencies: {
          typescript: "^5.7.0",
          vite: "^7.3.3",
        },
      }, null, 2)}\n`,
    },
    {
      path: "pages/index.bangala",
      contents:
        `---\n` +
        `const title = props.title ?? "bangala.js"\n` +
        `---\n` +
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `  <meta charset="utf-8"/>\n` +
        `  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n` +
        `  <title>{title}</title>\n` +
        `  <link rel="stylesheet" href="/styles.css"/>\n` +
        `</head>\n` +
        `<body>\n` +
        `  <main>\n` +
        `    <p class="eyebrow">HTML-first</p>\n` +
        `    <h1>{title}</h1>\n` +
        `    <p>Build fast pages first, then add islands only where interaction is needed.</p>\n` +
        `  </main>\n` +
        `</body>\n` +
        `</html>\n`,
    },
    {
      path: "public/styles.css",
      contents:
        `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#161616;background:#fafafa}\n` +
        `body{margin:0;min-height:100vh;display:grid;place-items:center}\n` +
        `main{width:min(720px,calc(100vw - 48px));padding:64px 0}\n` +
        `.eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#d65f00}\n` +
        `h1{font-size:clamp(42px,8vw,88px);line-height:.95;margin:0 0 24px;letter-spacing:0}\n` +
        `p{font-size:20px;line-height:1.6;color:#444;max-width:560px}\n`,
    },
    {
      path: ".gitignore",
      contents: `node_modules/\ndist/\n.env\n`,
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
    "  bangala dev [--root DIR] [--pages DIR] [--host HOST] [--port PORT]",
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
    "  --port PORT            Port (default: 5173)",
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
