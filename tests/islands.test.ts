import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
