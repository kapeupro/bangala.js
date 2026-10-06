import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBangala, createBangalaDevServer, findIslandClientModule } from "../src/vite.js";

/**
 * The islands pipeline end to end: `<Counter client:load/>` is hydrated by
 * the sibling `Counter.client.ts`, served as source in dev and bundled (only
 * when used) in build.
 */

let roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bangala-islands-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const full = join(root, file);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const COUNTER = {
  "components/Counter.bangala": `<button>{props.start}</button>`,
  "components/Counter.client.ts": [
    "export async function mount(el: { dataset: Record<string, string> }, props: { start: number }): Promise<void> {",
    "  el.dataset.mounted = String(props.start + 1);",
    "}",
  ].join("\n"),
};

const PAGE_WITH_ISLAND = [
  "---",
  'import Counter from "../components/Counter.bangala"',
  "---",
  "<html><body><Counter start={1} client:load/></body></html>",
].join("\n");

class MockRequest extends Readable {
  method = "GET";
  headers = {};
  constructor(public url: string) {
    super();
  }
  _read(): void {
    this.push(null);
  }
}

class MockResponse extends Writable {
  statusCode = 200;
  headers = new Map<string, string>();
  body = "";
  setHeader(name: string, value: number | string | string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
    return this;
  }
  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }
  end(chunk?: unknown): this {
    if (chunk !== undefined) this.body += String(chunk);
    super.end();
    return this;
  }
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.body += String(chunk);
    callback();
  }
}

async function devRender(root: string, url: string): Promise<string> {
  const vite = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
  try {
    const res = new MockResponse();
    await new Promise<void>((resolve, reject) => {
      vite.middlewares(new MockRequest(url) as never, res as never, (error?: unknown) =>
        error ? reject(error) : reject(new Error(`no route for ${url}`)));
      res.on("finish", resolve);
    });
    return res.body;
  } finally {
    await vite.close();
  }
}

function dataEntry(html: string): string {
  const match = html.match(/data-entry="([^"]+)"/);
  if (!match) throw new Error(`no island in:\n${html}`);
  return match[1]!;
}

describe("findIslandClientModule", () => {
  it("finds the sibling client module, TypeScript first", () => {
    const root = project({ "C.bangala": "<b/>", "C.client.js": "", "C.client.ts": "" });
    expect(findIslandClientModule(join(root, "C.bangala"))).toBe(join(root, "C.client.ts"));
    expect(findIslandClientModule(join(root, "Missing.bangala"))).toBeNull();
  });
});

describe("islands in the dev server", () => {
  it("points data-entry at the client module and injects the runtime", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    const html = await devRender(root, "/");
    expect(dataEntry(html)).toBe("/components/Counter.client.ts");
    expect(html).toContain('data-props="{&quot;start&quot;:1}"');
    expect(html).toContain('data-strategy="load"');
    expect(html).toContain("<button>1</button>");
    // Vite serves the injected inline module script through its html-proxy.
    expect(html).toContain("html-proxy");
  });

  it("serves the client module transpiled", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    const vite = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
    try {
      const result = await vite.transformRequest("/components/Counter.client.ts");
      expect(result?.code).toContain("export async function mount(el, props)");
    } finally {
      await vite.close();
    }
  });

  it("does not inject the runtime into pages without islands", async () => {
    const root = project({ "pages/index.bangala": "<html><body><h1>Static</h1></body></html>" });
    const html = await devRender(root, "/");
    expect(html).toContain("<h1>Static</h1>");
    expect(html).not.toContain("html-proxy");
  });

  it("explains a missing client module", async () => {
    const root = project({
      "components/Counter.bangala": "<button>0</button>",
      "pages/index.bangala": PAGE_WITH_ISLAND,
    });
    // In the browser this surfaces through Vite's error overlay.
    const vite = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
    try {
      await expect(vite.ssrLoadModule(join(root, "pages/index.bangala")))
        .rejects.toThrow(/Island <Counter> .* has no client module\. Create 'Counter\.client\.ts'/);
    } finally {
      await vite.close();
    }
  });

  it("transpiles TypeScript frontmatter", async () => {
    const root = project({
      "pages/index.bangala": "---\ninterface Item { name: string }\nconst items: Item[] = [{ name: \"ts\" }]\n---\n<p>{items[0]!.name}</p>",
    });
    expect(await devRender(root, "/")).toContain("<p>ts</p>");
  });

  it("resolves root-absolute .bangala imports", async () => {
    const root = project({
      "components/Card.bangala": "<div class=\"card\">{props.title}</div>",
      "pages/index.bangala": "---\nimport Card from \"/components/Card.bangala\"\n---\n<Card title=\"abs\"/>",
    });
    expect(await devRender(root, "/")).toContain('<div class="card">abs</div>');
  });

  it("imports a real .js module even when a .bangala sibling exists", async () => {
    const root = project({
      "lib/util.js": "export const kind = \"js\";",
      "lib/util.bangala": "<p>bangala</p>",
      "pages/index.bangala": "---\nimport { kind } from \"../lib/util.js\"\n---\n<p>{kind}</p>",
    });
    expect(await devRender(root, "/")).toContain("<p>js</p>");
  });
});

describe("islands in the build", () => {
  it("bundles used islands, rewrites data-entry and injects the runtime only where needed", async () => {
    const root = project({
      ...COUNTER,
      "components/Unused.bangala": "<i/>",
      "components/Unused.client.ts": "export function mount() {}",
      "pages/index.bangala": PAGE_WITH_ISLAND,
      "pages/about.bangala": "<html><body><h1>About</h1></body></html>",
    });
    await buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } });

    const index = await readFile(join(root, "dist/index.html"), "utf8");
    const entry = dataEntry(index);
    expect(entry).toMatch(/^\/assets\/islands\/Counter\.client-[\w-]+\.js$/);
    expect(index).toContain('<script type="module" src="/assets/bangala-client.js"></script>');

    // The bundled island is a working module.
    const mod = await import(pathToFileURL(join(root, "dist", entry)).href) as {
      mount: (el: { dataset: Record<string, string> }, props: { start: number }) => Promise<void>;
    };
    const el = { dataset: {} as Record<string, string> };
    await mod.mount(el, { start: 1 });
    expect(el.dataset.mounted).toBe("2");

    // A static page ships no JavaScript, and unused islands are not bundled.
    const about = await readFile(join(root, "dist/about/index.html"), "utf8");
    expect(about).not.toContain("<script");
    expect(readdirSync(join(root, "dist/assets/islands"))).toEqual([entry.split("/").pop()]);
  });

  it("keeps islands with the same file name apart", async () => {
    const root = project({
      "a/Widget.bangala": "<b>a</b>",
      "a/Widget.client.js": "export function mount(el) { el.dataset.from = 'a' }",
      "b/Widget.bangala": "<b>b</b>",
      "b/Widget.client.js": "export function mount(el) { el.dataset.from = 'b' }",
      "pages/index.bangala": "---\nimport A from \"../a/Widget.bangala\"\nimport B from \"../b/Widget.bangala\"\n---\n<A client:load/><B client:visible/>",
    });
    await buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const entries = [...html.matchAll(/data-entry="([^"]+)"/g)].map((m) => m[1]!);
    expect(entries).toHaveLength(2);
    expect(new Set(entries).size).toBe(2);
    for (const entry of entries) expect(existsSync(join(root, "dist", entry))).toBe(true);
  });

  it("prefixes island and runtime URLs with the Vite base", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    await buildBangala({ root, outDir: "dist", vite: { base: "/sub/", logLevel: "silent" } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    expect(dataEntry(html)).toMatch(/^\/sub\/assets\/islands\//);
    expect(html).toContain('src="/sub/assets/bangala-client.js"');
  });

  it("applies the vite options when prerendering pages", async () => {
    const root = project({ "pages/index.bangala": "<p>{__BUILD__}</p>" });
    await buildBangala({ root, outDir: "dist", vite: { define: { __BUILD__: JSON.stringify("v9") }, logLevel: "silent" } });
    expect(await readFile(join(root, "dist/index.html"), "utf8")).toContain("<p>v9</p>");
  });

  it("points at the source files when the client build is disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    await buildBangala({ root, outDir: "dist", client: false, vite: { logLevel: "silent" } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    expect(dataEntry(html)).toBe("/components/Counter.client.ts");
    expect(html).not.toContain("<script");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not bundled because the client build is disabled/));
  });
});

describe("islands review follow-ups", () => {
  async function devGet(root: string, url: string, vite?: Record<string, unknown>) {
    const server = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent", ...vite } });
    try {
      const res = new MockResponse();
      await new Promise<void>((resolve, reject) => {
        server.middlewares(new MockRequest(url) as never, res as never, (error?: unknown) =>
          error ? reject(error) : reject(new Error(`no handler for ${url}`)));
        res.on("finish", resolve);
      });
      return { body: res.body, type: res.getHeader("content-type"), config: server.config };
    } finally {
      await server.close();
    }
  }

  it("refuses vite.build.outDir instead of emptying it unchecked", async () => {
    const parent = project({ "www/keep-me.txt": "precious", ...prefix("proj/", { ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND }) });
    await expect(buildBangala({ root: join(parent, "proj"), outDir: "dist", vite: { build: { outDir: "../www" } } }))
      .rejects.toThrow(/not vite\.build\.outDir/);
    expect(existsSync(join(parent, "www/keep-me.txt"))).toBe(true);
    await expect(buildBangala({ root: join(parent, "proj"), vite: { build: { rollupOptions: { input: "x.ts" } } } }))
      .rejects.toThrow(/rollupOptions\.input is not supported/);
  });

  it("bundles islands whose folder is a symlink", async () => {
    const parent = project({ ...prefix("shared/", COUNTER), "app/pages/index.bangala": PAGE_WITH_ISLAND });
    symlinkSync(join(parent, "shared/components"), join(parent, "app/components"), "dir");
    await buildBangala({ root: join(parent, "app"), outDir: "dist", vite: { logLevel: "silent" } });
    const entry = dataEntry(await readFile(join(parent, "app/dist/index.html"), "utf8"));
    expect(entry).toMatch(/^\/assets\/islands\/Counter\.client-/);
    expect(existsSync(join(parent, "app/dist", entry))).toBe(true);
  });

  it("refuses a relative base", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    await expect(buildBangala({ root, outDir: "dist", vite: { base: "./" } })).rejects.toThrow(/relative vite\.base/);
  });

  it("only rewrites its own data-entry placeholders", async () => {
    const text = "the build marker /@bangala-island/0/ stays";
    const root = project({
      ...COUNTER,
      "pages/index.bangala": `---\nimport Counter from "../components/Counter.bangala"\n---\n<p>${text}</p><Counter start={1} label="/@bangala-island/0/" client:load/>`,
      "pages/plain.bangala": `<p>${text}</p>`,
    });
    await buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    expect(html).toContain(`<p>${text}</p>`);
    expect(html).toContain("&quot;label&quot;:&quot;/@bangala-island/0/&quot;");
    expect(await readFile(join(root, "dist/plain/index.html"), "utf8")).toContain(`<p>${text}</p>`);
  });

  it("fails the build when an island module has no mount export", async () => {
    const root = project({
      "components/B.bangala": "<i>b</i>",
      "components/B.client.ts": "export default function mount() {}",
      "pages/index.bangala": "---\nimport B from \"../components/B.bangala\"\n---\n<B client:load/>",
    });
    await expect(buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } }))
      .rejects.toThrow(/B\.client\.ts' must export a named mount\(el, props\) function \(it exports default\)/);
  });

  it("follows the runtime file the bundle actually emits", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    const result = await buildBangala({
      root,
      outDir: "dist",
      vite: { logLevel: "silent", build: { rollupOptions: { output: { entryFileNames: "js/[name].js" } } } },
    });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    expect(html).toContain('<script type="module" src="/js/bangala-client.js"></script>');
    expect(result.clientEntry).toBe(join(root, "dist/js/bangala-client.js"));
    expect(existsSync(join(root, "dist", dataEntry(html)))).toBe(true);
  });

  it("bundles only islands that are rendered", async () => {
    const root = project({
      ...COUNTER,
      "components/Heavy.bangala": "<i>heavy</i>",
      "components/Heavy.client.ts": "export function mount() {}",
      "pages/index.bangala": "---\nimport Counter from \"../components/Counter.bangala\"\nconst show = false\n---\n<html><body>{#if show}<Counter start={1} client:load/>{/if}</body></html>",
      "pages/[id].bangala": "---\nimport Heavy from \"../components/Heavy.bangala\"\n---\n<Heavy client:load/>",
    });
    const result = await buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } });
    expect(existsSync(join(root, "dist/assets/islands"))).toBe(false);
    expect(result.islands).toEqual([]);
    expect(result.clientEntry).toBeNull();
    expect(await readFile(join(root, "dist/index.html"), "utf8")).not.toContain("<script");
  });

  it("reports the runtime and the islands it bundled", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    const result = await buildBangala({ root, outDir: "dist", vite: { logLevel: "silent" } });
    expect(result.clientEntry).toBe(join(root, "dist/assets/bangala-client.js"));
    expect(result.islands).toHaveLength(1);
    expect(result.islands[0]).toMatch(/assets\/islands\/Counter\.client-[\w-]+\.js$/);
  });

  it("serves hand-written markers' public/ modules to the dev runtime", async () => {
    const root = project({ "public/islands/X.client.js": "export function mount() {}", "pages/index.bangala": "<p>x</p>" });
    const response = await devGet(root, "/islands/X.client.js?import");
    expect(response.type).toBe("text/javascript");
    expect(response.body).toBe("export function mount() {}");
  });

  it("refreshes data-entry when an island's client module is created", async () => {
    const root = project({
      "components/Counter.bangala": "<button>0</button>",
      "components/Counter.client.js": "export function mount() {}",
      "pages/index.bangala": PAGE_WITH_ISLAND,
    });
    const server = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
    try {
      const page = join(root, "pages/index.bangala");
      const render = async () => ((await server.ssrLoadModule(page)) as { render: (p: object) => Promise<string> }).render({});
      expect(dataEntry(await render())).toBe("/components/Counter.client.js");
      writeFileSync(join(root, "components/Counter.client.ts"), "export function mount() {}");
      server.watcher.emit("add", join(root, "components/Counter.client.ts"));
      expect(dataEntry(await render())).toBe("/components/Counter.client.ts");
    } finally {
      await server.close();
    }
  });

  it("reloads the browser when a server-only import changes", async () => {
    const root = project({
      "lib/data.js": "export const title = \"v1\";",
      "pages/index.bangala": "---\nimport { title } from \"../lib/data.js\"\n---\n<h1>{title}</h1>",
    });
    const server = await createBangalaDevServer({ root, vite: { logLevel: "silent" } });
    try {
      await server.ssrLoadModule(join(root, "pages/index.bangala"));
      const send = vi.spyOn(server.ws, "send");
      writeFileSync(join(root, "lib/data.js"), "export const title = \"v2\";");
      server.watcher.emit("change", join(root, "lib/data.js"));
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "full-reload" }));
    } finally {
      await server.close();
    }
  });

  it("allows Vite to serve islands from outside the root", async () => {
    const parent = project({ ...prefix("ui/", COUNTER), "site/pages/index.bangala": PAGE_WITH_ISLAND.replace("../components/", "../../ui/components/") });
    const { body, config } = await devGet(join(parent, "site"), "/");
    expect(dataEntry(body)).toBe(`/@fs/${join(parent, "ui/components/Counter.client.ts").replace(/^\//, "")}`);
    expect(config.server.fs.allow).toContain(join(parent, "ui/components"));
  });

  it("serves pages with the plugin in a plain Vite config", async () => {
    const root = project({ "pages/index.bangala": "<h1>home</h1>" });
    const { createServer } = await import("vite");
    const server = await createServer({ root, configFile: false, logLevel: "silent", server: { middlewareMode: true }, plugins: [(await import("../src/vite.js")).bangala()] });
    try {
      expect(server.config.appType).toBe("custom");
    } finally {
      await server.close();
    }
  });

  it("lets a middleware host opt into live reload", async () => {
    const root = project({ "pages/index.bangala": "<h1>home</h1>" });
    const server = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true, hmr: { port: 0 } }, logLevel: "silent" } });
    try {
      expect(server.config.server.ws).not.toBe(false);
    } finally {
      await server.close();
    }
  });

  it("does not depend on unrelated tsconfig files", async () => {
    const root = project({
      "tsconfig.json": "{\"extends\": \"@tsconfig/does-not-exist/tsconfig.json\"}",
      "pages/index.bangala": "---\nconst n: number = 1\n---\n<p>{n}</p>",
    });
    expect((await devGet(root, "/")).body).toContain("<p>1</p>");
  });

  it("warns when the plugin builds islands outside buildBangala", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND });
    const { build } = await import("vite");
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      plugins: [(await import("../src/vite.js")).bangala({ pages: false })],
      build: { ssr: "pages/index.bangala", outDir: "dist-ssr", write: false },
    });
    expect(warn.mock.calls.flat().join("\n")).toMatch(/islands are only bundled by buildBangala\(\)/);
  });
});

describe("islands review follow-ups (second pass)", () => {
  async function devPage(root: string, page = "pages/index.bangala"): Promise<string> {
    const server = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
    try {
      return await ((await server.ssrLoadModule(join(root, page))) as { render: (p: object) => Promise<string> }).render({});
    } finally {
      await server.close();
    }
  }

  it("keeps JavaScript semantics in frontmatter: side-effect imports and class fields", async () => {
    const root = project({
      "lib/register.js": "globalThis.__registered = (globalThis.__registered ?? 0) + 1; export const marker = 1;",
      "pages/index.bangala": [
        "---",
        "import { marker } from \"../lib/register.js\"",
        "class Base { set value(v) { this._v = \"setter\" } get value() { return this._v } }",
        "class Child extends Base { value = \"field\" }",
        "const own = Object.prototype.hasOwnProperty.call(new Child(), \"value\")",
        "---",
        "<p>{String(globalThis.__registered > 0)} {String(own)}</p>",
      ].join("\n"),
    });
    expect(await devPage(root)).toBe("<p>true true</p>");
  });

  it("still accepts types imported without `import type`", async () => {
    const root = project({
      "lib/types.ts": "export interface Props { title: string }",
      "pages/index.bangala": "---\nimport { Props } from \"../lib/types.ts\"\nconst p: Props = { title: \"typed\" }\n---\n<p>{p.title}</p>",
    });
    expect(await devPage(root)).toBe("<p>typed</p>");
  });

  it("serves islands of a project reached through a symlink", async () => {
    const parent = project(prefix("real/", { ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND }));
    symlinkSync(join(parent, "real"), join(parent, "link"), "dir");
    expect(dataEntry(await devPage(join(parent, "link")))).toBe("/components/Counter.client.ts");
  });

  it("percent-encodes island URLs", async () => {
    const root = project({
      "components/100%off.bangala": "<b/>",
      "components/100%off.client.js": "export function mount() {}",
      "pages/index.bangala": "---\nimport A from \"../components/100%off.bangala\"\n---\n<A client:load/>",
    });
    expect(dataEntry(await devPage(root))).toBe("/components/100%25off.client.js");
  });

  it("reports a missing island component, not a missing client module", async () => {
    const root = project({ ...COUNTER, "pages/index.bangala": PAGE_WITH_ISLAND.replace(/Counter/g, "Countr") });
    await expect(devPage(root)).rejects.toThrow(/Island component "\.\.\/components\/Countr\.bangala" imported in .* was not found/);
  });

  it("unescapes import specifiers", async () => {
    const root = project({
      "components/it's.bangala": "<b/>",
      "components/it's.client.js": "export function mount() {}",
      "pages/index.bangala": "---\nimport A from '../components/it\\'s.bangala'\n---\n<A client:load/>",
    });
    expect(dataEntry(await devPage(root))).toBe("/components/it&#39;s.client.js");
  });

  it("does not serve .bangala modules to the browser", async () => {
    const root = project({ "pages/index.bangala": "<p>secret</p>" });
    const server = await createBangalaDevServer({ root, vite: { server: { middlewareMode: true }, logLevel: "silent" } });
    try {
      await expect(server.transformRequest("/pages/index.bangala")).rejects.toThrow(/server-rendered \.bangala module/);
    } finally {
      await server.close();
    }
  });

  it("builds the repo's benchmark app with its island", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "bangala-bench-"));
    roots.push(outDir);
    const root = join(import.meta.dirname, "../benchmarks/bangala-blog");
    await buildBangala({ root, outDir, emptyOutDir: true, vite: { logLevel: "silent" } });
    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(existsSync(join(outDir, dataEntry(html)))).toBe(true);
  });
});

function prefix(dir: string, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([file, contents]) => [`${dir}${file}`, contents]));
}
