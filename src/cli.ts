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

export type CreateProjectTemplate = "starter" | "blog" | "docs";

export interface CreateProjectOptions {
  force?: boolean;
  name?: string;
  adapter?: string | false;
  packageVersion?: string;
  template?: CreateProjectTemplate | "basic";
}

interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
  booleans: Set<string>;
}

const VERSION = readPackageVersion();
const DEFAULT_PORT = 5173;
const CREATE_TEMPLATES = ["starter", "blog", "docs"] as const;

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
  const template = normalizeTemplate(options.template);

  if (existsSync(projectRoot) && !force) {
    const entries = await readdir(projectRoot);
    if (entries.length > 0) {
      throw new Error(`Directory '${projectRoot}' is not empty. Use --force to write into it.`);
    }
  }

  const files = templateFiles(name, version, template);
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

  const template = normalizeTemplate(option(parsed, "template"));
  const target = parsed.positionals[0] ?? "bangala-app";
  const projectRoot = resolve(io.cwd ?? process.cwd(), target);
  const result = await createProject(projectRoot, {
    force: parsed.booleans.has("force"),
    adapter: option(parsed, "adapter") ?? false,
    template,
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

function normalizeTemplate(value: string | undefined): CreateProjectTemplate {
  const template = value ?? "starter";
  if (template === "basic") return "starter";
  if ((CREATE_TEMPLATES as readonly string[]).includes(template)) {
    return template as CreateProjectTemplate;
  }
  throw new Error(
    `Unknown template '${template}'. Available templates: ${CREATE_TEMPLATES.join(", ")}`,
  );
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

function templateFiles(
  name: string,
  version: string,
  template: CreateProjectTemplate,
): { path: string; contents: string }[] {
  if (template === "blog") return blogTemplateFiles(name, version);
  if (template === "docs") return docsTemplateFiles(name, version);

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
      contents: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="80" height="110" fill="none" role="img" aria-label="bangala.js"><ellipse cx="26" cy="104" rx="16" ry="8" fill="none" stroke="#f97316" stroke-width="3" stroke-opacity="0.6"/><ellipse cx="54" cy="104" rx="16" ry="8" fill="none" stroke="#f97316" stroke-width="3" stroke-opacity="0.6"/><rect x="18" y="52" width="44" height="52" rx="3" fill="none" stroke="#f97316" stroke-width="3"/><rect x="31" y="76" width="18" height="28" rx="3" fill="#f97316" fill-opacity="0.25" stroke="#f97316" stroke-width="2"/><path d="M12 54 C12 54 12 8 40 2 C68 8 68 54 68 54 Z" fill="none" stroke="#f97316" stroke-width="3"/><path d="M16 54 Q40 50 64 54" stroke="#f97316" stroke-width="2.5" fill="none"/><rect x="50" y="2" width="9" height="15" rx="2" fill="none" stroke="#f97316" stroke-width="2.5"/><rect x="48" y="0" width="13" height="5" rx="2" fill="#f97316" stroke="#f97316" stroke-width="2"/></svg>\n`,
    },
    {
      path: "public/logo.svg",
      contents: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="80" height="110" fill="none" role="img" aria-label="bangala.js logo"><ellipse cx="26" cy="104" rx="16" ry="8" fill="none" stroke="#f97316" stroke-width="1.5" stroke-opacity="0.5"/><ellipse cx="54" cy="104" rx="16" ry="8" fill="none" stroke="#f97316" stroke-width="1.5" stroke-opacity="0.5"/><rect x="18" y="52" width="44" height="52" rx="3" fill="none" stroke="#f97316" stroke-width="1.5"/><rect x="31" y="76" width="18" height="28" rx="3" fill="#f97316" fill-opacity="0.15" stroke="#f97316" stroke-width="1.2"/><path d="M12 54 C12 54 12 8 40 2 C68 8 68 54 68 54 Z" fill="none" stroke="#f97316" stroke-width="1.5"/><path d="M16 54 Q40 50 64 54" stroke="#f97316" stroke-width="1.5" fill="none"/><rect x="50" y="2" width="9" height="15" rx="2" fill="none" stroke="#f97316" stroke-width="1.3"/><rect x="48" y="0" width="13" height="5" rx="2" fill="#f97316" fill-opacity="0.4" stroke="#f97316" stroke-width="1.2"/></svg>\n`,
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

function blogTemplateFiles(name: string, version: string): { path: string; contents: string }[] {
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
      path: "pages/_layout.bangala",
      contents:
        `---\n` +
        `const siteTitle = "Field Notes"\n` +
        `const nav = [\n` +
        `  { href: "/", label: "Home" },\n` +
        `  { href: "/blog/launch-notes", label: "Latest" },\n` +
        `]\n` +
        `---\n` +
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `  <meta charset="utf-8"/>\n` +
        `  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n` +
        `  <title>{siteTitle}</title>\n` +
        `  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>\n` +
        `  <link rel="stylesheet" href="/styles.css"/>\n` +
        `</head>\n` +
        `<body>\n` +
        `  <header class="site-header">\n` +
        `    <a class="brand" href="/">{siteTitle}</a>\n` +
        `    <nav aria-label="Main navigation">\n` +
        `      {#each nav as item}<a href={item.href}>{item.label}</a>{/each}\n` +
        `    </nav>\n` +
        `  </header>\n` +
        `  <slot/>\n` +
        `  <footer class="site-footer">Built with bangala.js. Static by default, interactive by choice.</footer>\n` +
        `</body>\n` +
        `</html>\n`,
    },
    {
      path: "pages/index.bangala",
      contents:
        `---\n` +
        `import PostList from "../components/PostList.bangala"\n` +
        `const posts = [\n` +
        `  { slug: "launch-notes", title: "Launch notes", date: "2026-05-27", excerpt: "A short dispatch on shipping a fast content site with almost no client JavaScript." },\n` +
        `  { slug: "content-pipeline", title: "A tiny content pipeline", date: "2026-05-20", excerpt: "Use plain data in frontmatter, dynamic routes, and static generation for editorial pages." },\n` +
        `  { slug: "islands-for-writers", title: "Islands for writers", date: "2026-05-13", excerpt: "Keep essays static and reserve hydration for the few controls that need it." },\n` +
        `]\n` +
        `const featured = posts[0]\n` +
        `---\n` +
        `<main>\n` +
        `  <section class="hero">\n` +
        `    <p class="eyebrow">Bangala blog template</p>\n` +
        `    <h1>Write, publish, and keep the page light.</h1>\n` +
        `    <p class="lede">A realistic starter for notes, changelogs, and product essays with file-based routes and generated post pages.</p>\n` +
        `    <a class="button" href={"/blog/" + featured.slug}>Read {featured.title}</a>\n` +
        `  </section>\n` +
        `  <PostList posts={posts}/>\n` +
        `</main>\n`,
    },
    {
      path: "pages/blog/[slug].bangala",
      contents:
        `---\n` +
        `export function getPosts() {\n` +
        `  return [\n` +
        `    {\n` +
        `      slug: "launch-notes",\n` +
        `      title: "Launch notes",\n` +
        `      date: "2026-05-27",\n` +
        `      excerpt: "A short dispatch on shipping a fast content site with almost no client JavaScript.",\n` +
        `      sections: [\n` +
        `        { heading: "Static first", body: "Bangala prerenders this post from getStaticPaths, so the route can ship as plain HTML." },\n` +
        `        { heading: "Add islands when needed", body: "Interactive controls can live in public/islands and hydrate only where a page asks for them." },\n` +
        `      ],\n` +
        `    },\n` +
        `    {\n` +
        `      slug: "content-pipeline",\n` +
        `      title: "A tiny content pipeline",\n` +
        `      date: "2026-05-20",\n` +
        `      excerpt: "Use plain data in frontmatter, dynamic routes, and static generation for editorial pages.",\n` +
        `      sections: [\n` +
        `        { heading: "Data close to the route", body: "This template keeps starter content in the route file so the generated project is easy to understand." },\n` +
        `        { heading: "Move when it grows", body: "When the site grows, move the same shape into JSON or a small content loader." },\n` +
        `      ],\n` +
        `    },\n` +
        `    {\n` +
        `      slug: "islands-for-writers",\n` +
        `      title: "Islands for writers",\n` +
        `      date: "2026-05-13",\n` +
        `      excerpt: "Keep essays static and reserve hydration for the few controls that need it.",\n` +
        `      sections: [\n` +
        `        { heading: "Start with markup", body: "Most writing pages do not need a client runtime beyond analytics or a few optional widgets." },\n` +
        `        { heading: "Hydrate deliberately", body: "Use bangala-island markers for comments, filters, or demos that truly need browser state." },\n` +
        `      ],\n` +
        `    },\n` +
        `  ]\n` +
        `}\n` +
        `export async function getStaticPaths() {\n` +
        `  return getPosts().map((post) => ({ params: { slug: post.slug } }))\n` +
        `}\n` +
        `const posts = getPosts()\n` +
        `const post = posts.find((entry) => entry.slug === props.params.slug) ?? posts[0]\n` +
        `---\n` +
        `<main>\n` +
        `  <article class="post">\n` +
        `    <a class="back-link" href="/">Back to all posts</a>\n` +
        `    <p class="eyebrow"><time datetime={post.date}>{post.date}</time></p>\n` +
        `    <h1>{post.title}</h1>\n` +
        `    <p class="lede">{post.excerpt}</p>\n` +
        `    {#each post.sections as section}\n` +
        `      <section class="post-section">\n` +
        `        <h2>{section.heading}</h2>\n` +
        `        <p>{section.body}</p>\n` +
        `      </section>\n` +
        `    {/each}\n` +
        `  </article>\n` +
        `</main>\n`,
    },
    {
      path: "components/PostList.bangala",
      contents:
        `---\n` +
        `const posts = props.posts ?? []\n` +
        `---\n` +
        `<section class="post-list" aria-labelledby="latest-posts">\n` +
        `  <div class="section-heading">\n` +
        `    <p class="eyebrow">Latest</p>\n` +
        `    <h2 id="latest-posts">Recent posts</h2>\n` +
        `  </div>\n` +
        `  <div class="cards">\n` +
        `    {#each posts as post}\n` +
        `      <article class="post-card">\n` +
        `        <time datetime={post.date}>{post.date}</time>\n` +
        `        <h3><a href={"/blog/" + post.slug}>{post.title}</a></h3>\n` +
        `        <p>{post.excerpt}</p>\n` +
        `      </article>\n` +
        `    {/each}\n` +
        `  </div>\n` +
        `</section>\n`,
    },
    {
      path: "public/favicon.svg",
      contents: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Field Notes"><rect width="64" height="64" rx="14" fill="#111827"/><path d="M18 18h28v28H18z" fill="#f97316"/><path d="M24 25h16M24 32h16M24 39h10" stroke="#111827" stroke-width="3" stroke-linecap="round"/></svg>\n`,
    },
    {
      path: "public/styles.css",
      contents:
        `:root {\n` +
        `  color-scheme: light;\n` +
        `  --bg: #f8fafc;\n` +
        `  --fg: #111827;\n` +
        `  --muted: #64748b;\n` +
        `  --accent: #f97316;\n` +
        `  --panel: #ffffff;\n` +
        `  --border: #e2e8f0;\n` +
        `  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;\n` +
        `  background: var(--bg);\n` +
        `  color: var(--fg);\n` +
        `}\n` +
        `* { box-sizing: border-box; }\n` +
        `body { margin: 0; min-height: 100vh; }\n` +
        `a { color: inherit; }\n` +
        `.site-header, main, .site-footer { width: min(1040px, calc(100% - 32px)); margin-inline: auto; }\n` +
        `.site-header { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 24px 0; }\n` +
        `.brand { font-weight: 800; text-decoration: none; }\n` +
        `nav { display: flex; gap: 16px; color: var(--muted); }\n` +
        `nav a { text-decoration: none; font-weight: 650; }\n` +
        `.hero { padding: 72px 0 52px; max-width: 760px; }\n` +
        `.eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }\n` +
        `h1 { margin: 0; font-size: clamp(42px, 8vw, 80px); line-height: 0.98; }\n` +
        `.lede { color: var(--muted); font-size: 20px; line-height: 1.6; margin: 22px 0 0; }\n` +
        `.button { display: inline-flex; margin-top: 28px; padding: 12px 18px; border-radius: 8px; background: var(--fg); color: white; text-decoration: none; font-weight: 750; }\n` +
        `.section-heading { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 18px; }\n` +
        `.section-heading h2 { margin: 0; font-size: 28px; }\n` +
        `.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }\n` +
        `.post-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 22px; }\n` +
        `.post-card time, .site-footer { color: var(--muted); font-size: 14px; }\n` +
        `.post-card h3 { margin: 10px 0; font-size: 22px; }\n` +
        `.post-card p { color: var(--muted); line-height: 1.55; margin: 0; }\n` +
        `.post { max-width: 760px; padding: 48px 0 72px; }\n` +
        `.back-link { color: var(--muted); font-weight: 700; text-decoration: none; }\n` +
        `.post-section { margin-top: 36px; }\n` +
        `.post-section h2 { font-size: 26px; margin: 0 0 10px; }\n` +
        `.post-section p { color: var(--muted); font-size: 18px; line-height: 1.7; margin: 0; }\n` +
        `.site-footer { padding: 56px 0 32px; }\n` +
        `@media (max-width: 640px) { .site-header { align-items: flex-start; flex-direction: column; } .hero { padding-top: 40px; } }\n`,
    },
    {
      path: "README.md",
      contents:
        `# ${name}\n` +
        `\n` +
        `A blog starter built with [bangala.js](https://github.com/kapeupro/bangala). It includes a home page, generated post routes, a shared layout, and componentized post cards.\n` +
        `\n` +
        `## Run locally\n` +
        `\n` +
        `\`\`\`sh\n` +
        `npm install\n` +
        `npm run dev\n` +
        `\`\`\`\n` +
        `\n` +
        `## Content map\n` +
        `\n` +
        `- \`pages/index.bangala\` lists posts and highlights the latest entry.\n` +
        `- \`pages/blog/[slug].bangala\` owns the starter post data and exports \`getStaticPaths()\`.\n` +
        `- \`pages/_layout.bangala\` wraps every route with the document shell.\n` +
        `- \`components/PostList.bangala\` renders reusable post cards.\n` +
        `\n` +
        `Build output goes to \`_site/\`.\n`,
    },
    {
      path: ".gitignore",
      contents: `node_modules/\ndist/\n_site/\n.DS_Store\n`,
    },
  ];
}

function docsTemplateFiles(name: string, version: string): { path: string; contents: string }[] {
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
      path: "pages/_layout.bangala",
      contents:
        `---\n` +
        `const product = "Acme Docs"\n` +
        `const nav = [\n` +
        `  { href: "/", label: "Overview" },\n` +
        `  { href: "/docs", label: "Docs" },\n` +
        `  { href: "/docs/deployment", label: "Deploy" },\n` +
        `]\n` +
        `---\n` +
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `  <meta charset="utf-8"/>\n` +
        `  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n` +
        `  <title>{product}</title>\n` +
        `  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>\n` +
        `  <link rel="stylesheet" href="/styles.css"/>\n` +
        `</head>\n` +
        `<body>\n` +
        `  <header class="topbar">\n` +
        `    <a class="brand" href="/">{product}</a>\n` +
        `    <nav aria-label="Main navigation">\n` +
        `      {#each nav as item}<a href={item.href}>{item.label}</a>{/each}\n` +
        `    </nav>\n` +
        `  </header>\n` +
        `  <slot/>\n` +
        `</body>\n` +
        `</html>\n`,
    },
    {
      path: "pages/index.bangala",
      contents:
        `---\n` +
        `const highlights = [\n` +
        `  { title: "Install", body: "Start with a small static site and add routes as the product grows.", href: "/docs/getting-started" },\n` +
        `  { title: "Structure", body: "Use layouts, dynamic docs pages, and shared CSS without extra runtime code.", href: "/docs/project-structure" },\n` +
        `  { title: "Deploy", body: "Build to a static directory that can go to any CDN or static host.", href: "/docs/deployment" },\n` +
        `]\n` +
        `---\n` +
        `<main class="home">\n` +
        `  <section class="hero">\n` +
        `    <p class="eyebrow">Docs template</p>\n` +
        `    <h1>Ship a clear documentation site without hauling a framework to every page.</h1>\n` +
        `    <p class="lede">This scaffold includes an overview, a docs index, nested layouts, and statically generated article routes.</p>\n` +
        `    <a class="button" href="/docs">Browse docs</a>\n` +
        `  </section>\n` +
        `  <section class="feature-grid" aria-label="Documentation highlights">\n` +
        `    {#each highlights as item}\n` +
        `      <article class="feature-card">\n` +
        `        <h2><a href={item.href}>{item.title}</a></h2>\n` +
        `        <p>{item.body}</p>\n` +
        `      </article>\n` +
        `    {/each}\n` +
        `  </section>\n` +
        `</main>\n`,
    },
    {
      path: "pages/docs/_layout.bangala",
      contents:
        `---\n` +
        `const items = [\n` +
        `  { href: "/docs/getting-started", label: "Getting started" },\n` +
        `  { href: "/docs/project-structure", label: "Project structure" },\n` +
        `  { href: "/docs/deployment", label: "Deployment" },\n` +
        `]\n` +
        `---\n` +
        `<div class="docs-shell">\n` +
        `  <aside class="docs-sidebar" aria-label="Docs navigation">\n` +
        `    <a class="docs-index" href="/docs">Documentation</a>\n` +
        `    {#each items as item}<a href={item.href}>{item.label}</a>{/each}\n` +
        `  </aside>\n` +
        `  <main class="docs-content"><slot/></main>\n` +
        `</div>\n`,
    },
    {
      path: "pages/docs/index.bangala",
      contents:
        `---\n` +
        `const entries = [\n` +
        `  { href: "/docs/getting-started", title: "Getting started", body: "Install dependencies and run the local dev server." },\n` +
        `  { href: "/docs/project-structure", title: "Project structure", body: "Learn where pages, layouts, components, and public assets live." },\n` +
        `  { href: "/docs/deployment", title: "Deployment", body: "Build a static site and publish the generated output." },\n` +
        `]\n` +
        `---\n` +
        `<section class="docs-intro">\n` +
        `  <p class="eyebrow">Start here</p>\n` +
        `  <h1>Documentation</h1>\n` +
        `  <p class="lede">A small but complete docs structure for a product, library, or internal tool.</p>\n` +
        `</section>\n` +
        `<section class="doc-list">\n` +
        `  {#each entries as entry}\n` +
        `    <article class="doc-card">\n` +
        `      <h2><a href={entry.href}>{entry.title}</a></h2>\n` +
        `      <p>{entry.body}</p>\n` +
        `    </article>\n` +
        `  {/each}\n` +
        `</section>\n`,
    },
    {
      path: "pages/docs/[slug].bangala",
      contents:
        `---\n` +
        `export function getPages() {\n` +
        `  return [\n` +
        `    {\n` +
        `      slug: "getting-started",\n` +
        `      title: "Getting started",\n` +
        `      description: "Install the project and run the Bangala dev server.",\n` +
        `      sections: [\n` +
        `        { id: "install", title: "Install", body: "Run npm install, then start the local server with npm run dev." },\n` +
        `        { id: "edit", title: "Edit content", body: "Change files under pages and components. The dev server reloads rendered HTML as you work." },\n` +
        `      ],\n` +
        `    },\n` +
        `    {\n` +
        `      slug: "project-structure",\n` +
        `      title: "Project structure",\n` +
        `      description: "Understand how this documentation template is organized.",\n` +
        `      sections: [\n` +
        `        { id: "pages", title: "Pages", body: "Route files live in pages. The docs folder adds a nested layout for article navigation." },\n` +
        `        { id: "assets", title: "Assets", body: "Static files live in public and are served from the site root." },\n` +
        `      ],\n` +
        `    },\n` +
        `    {\n` +
        `      slug: "deployment",\n` +
        `      title: "Deployment",\n` +
        `      description: "Build static output for any CDN or static host.",\n` +
        `      sections: [\n` +
        `        { id: "build", title: "Build", body: "npm run build writes prerendered HTML and the optional client runtime to _site." },\n` +
        `        { id: "publish", title: "Publish", body: "Upload _site to Netlify, Vercel, Cloudflare Pages, or any static file server." },\n` +
        `      ],\n` +
        `    },\n` +
        `  ]\n` +
        `}\n` +
        `export async function getStaticPaths() {\n` +
        `  return getPages().map((page) => ({ params: { slug: page.slug } }))\n` +
        `}\n` +
        `const pages = getPages()\n` +
        `const page = pages.find((entry) => entry.slug === props.params.slug) ?? pages[0]\n` +
        `---\n` +
        `<article class="doc-article">\n` +
        `  <p class="eyebrow">Guide</p>\n` +
        `  <h1>{page.title}</h1>\n` +
        `  <p class="lede">{page.description}</p>\n` +
        `  {#each page.sections as section}\n` +
        `    <section class="doc-section" id={section.id}>\n` +
        `      <h2>{section.title}</h2>\n` +
        `      <p>{section.body}</p>\n` +
        `    </section>\n` +
        `  {/each}\n` +
        `</article>\n`,
    },
    {
      path: "public/favicon.svg",
      contents: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Docs"><rect width="64" height="64" rx="12" fill="#0f172a"/><path d="M20 14h18l8 8v28H20z" fill="#38bdf8"/><path d="M38 14v10h8M26 32h14M26 39h14M26 46h9" stroke="#0f172a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
    },
    {
      path: "public/styles.css",
      contents:
        `:root {\n` +
        `  color-scheme: light;\n` +
        `  --bg: #ffffff;\n` +
        `  --fg: #111827;\n` +
        `  --muted: #64748b;\n` +
        `  --accent: #0284c7;\n` +
        `  --panel: #f8fafc;\n` +
        `  --border: #e5e7eb;\n` +
        `  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;\n` +
        `  background: var(--bg);\n` +
        `  color: var(--fg);\n` +
        `}\n` +
        `* { box-sizing: border-box; }\n` +
        `body { margin: 0; min-height: 100vh; }\n` +
        `a { color: inherit; }\n` +
        `.topbar { height: 64px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 max(24px, calc((100vw - 1120px) / 2)); }\n` +
        `.brand { font-weight: 850; text-decoration: none; }\n` +
        `nav { display: flex; gap: 16px; color: var(--muted); font-size: 14px; font-weight: 700; }\n` +
        `nav a, .docs-sidebar a, .button { text-decoration: none; }\n` +
        `.home { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }\n` +
        `.hero { padding: 72px 0 48px; max-width: 860px; }\n` +
        `.eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 850; letter-spacing: 0.12em; text-transform: uppercase; }\n` +
        `h1 { margin: 0; font-size: clamp(40px, 7vw, 72px); line-height: 1; }\n` +
        `.lede { color: var(--muted); font-size: 20px; line-height: 1.6; margin: 20px 0 0; }\n` +
        `.button { display: inline-flex; margin-top: 28px; border-radius: 8px; background: var(--fg); color: white; padding: 12px 18px; font-weight: 800; }\n` +
        `.feature-grid, .doc-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; padding-bottom: 64px; }\n` +
        `.feature-card, .doc-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 22px; }\n` +
        `.feature-card h2, .doc-card h2 { font-size: 20px; margin: 0 0 10px; }\n` +
        `.feature-card p, .doc-card p, .doc-section p { color: var(--muted); line-height: 1.65; margin: 0; }\n` +
        `.docs-shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 40px; padding: 40px 0 72px; }\n` +
        `.docs-sidebar { position: sticky; top: 88px; align-self: start; display: grid; gap: 8px; border-right: 1px solid var(--border); padding-right: 24px; }\n` +
        `.docs-sidebar a { color: var(--muted); font-weight: 700; padding: 8px 0; }\n` +
        `.docs-sidebar .docs-index { color: var(--fg); }\n` +
        `.docs-content { min-width: 0; }\n` +
        `.docs-intro, .doc-article { max-width: 760px; }\n` +
        `.docs-intro { margin-bottom: 28px; }\n` +
        `.doc-section { margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--border); }\n` +
        `.doc-section h2 { margin: 0 0 10px; font-size: 26px; }\n` +
        `@media (max-width: 760px) { .topbar { height: auto; align-items: flex-start; flex-direction: column; padding-block: 18px; } .docs-shell { grid-template-columns: 1fr; } .docs-sidebar { position: static; border-right: 0; border-bottom: 1px solid var(--border); padding: 0 0 18px; } }\n`,
    },
    {
      path: "README.md",
      contents:
        `# ${name}\n` +
        `\n` +
        `A documentation starter built with [bangala.js](https://github.com/kapeupro/bangala). It includes nested docs layouts, an index, and generated article routes.\n` +
        `\n` +
        `## Run locally\n` +
        `\n` +
        `\`\`\`sh\n` +
        `npm install\n` +
        `npm run dev\n` +
        `\`\`\`\n` +
        `\n` +
        `## Structure\n` +
        `\n` +
        `- \`pages/_layout.bangala\` is the site shell.\n` +
        `- \`pages/docs/_layout.bangala\` adds the documentation sidebar.\n` +
        `- \`pages/docs/[slug].bangala\` exports \`getStaticPaths()\` for static article pages.\n` +
        `- \`public/styles.css\` contains the complete starter styling.\n` +
        `\n` +
        `Build output goes to \`_site/\`.\n`,
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
    "  bangala create [DIR] [--template starter|blog|docs] [--adapter NAME] [--force]",
    "  bangala deploy <adapter> [--root DIR] [--out-dir DIR] [--force]",
    "",
    "Commands:",
    "  dev       Start the Vite-powered Bangala dev server",
    "  build     Prerender pages and bundle the client runtime",
    "  create    Scaffold a Bangala project",
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
    "  --template NAME        Template: starter, blog, docs (default: starter)",
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
