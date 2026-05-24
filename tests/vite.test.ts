import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "vite";
import {
  bangala,
  buildBangala,
  createBangalaDevServer,
} from "../src/vite.js";

let tmpRoots: string[] = [];

afterEach(async () => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots = [];
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bangala-vite-"));
  tmpRoots.push(root);
  return root;
}

function write(root: string, file: string, contents: string): string {
  const full = join(root, file);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

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

async function renderMiddleware(server: Awaited<ReturnType<typeof createBangalaDevServer>>, url: string) {
  const req = new MockRequest(url);
  const res = new MockResponse();
  let nextCalled = false;
  await new Promise<void>((resolve, reject) => {
    server.middlewares(req as never, res as never, (error?: unknown) => {
      if (error) reject(error);
      nextCalled = true;
      resolve();
    });
    res.on("finish", resolve);
    res.on("error", reject);
  });
  return { status: res.statusCode, contentType: res.getHeader("content-type"), html: res.body, nextCalled };
}

describe("bangala Vite plugin", () => {
  it("loads .bangala files as SSR modules", async () => {
    const root = tmpRoot();
    const page = write(root, "pages/index.bangala", "<h1>Hello {props.name}</h1>");

    const server = await createServer({
      root,
      appType: "custom",
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
      plugins: [bangala({ pages: false })],
    });

    try {
      const mod = await server.ssrLoadModule(page);
      expect(await mod.render({ name: "<Ada>" })).toBe("<h1>Hello &lt;Ada&gt;</h1>");
    } finally {
      await server.close();
    }
  });
});

describe("createBangalaDevServer", () => {
  it("serves matched .bangala routes through Vite middleware", async () => {
    const root = tmpRoot();
    write(root, "pages/blog/[slug].bangala", "<h1>{props.params.slug}</h1>");

    const vite = await createBangalaDevServer({
      root,
      vite: { server: { middlewareMode: true } },
    });

    try {
      const response = await renderMiddleware(vite, "/blog/hello");

      expect(response.status).toBe(200);
      expect(response.contentType).toContain("text/html");
      expect(response.html).toContain("<h1>hello</h1>");
      expect(response.html).toContain("/@vite/client");
      expect(response.html).toContain("html-proxy");
      expect(response.nextCalled).toBe(false);
    } finally {
      await vite.close();
    }
  });

  it("renders routes through discovered layouts without escaping child HTML", async () => {
    const root = tmpRoot();
    write(root, "pages/_layout.bangala", "<html><body><main><slot/></main></body></html>");
    write(root, "pages/about.bangala", "<h1>About</h1><p>Ready</p>");

    const vite = await createBangalaDevServer({
      root,
      vite: { server: { middlewareMode: true } },
    });

    try {
      const response = await renderMiddleware(vite, "/about");

      expect(response.status).toBe(200);
      expect(response.html).toContain("<main><h1>About</h1><p>Ready</p></main>");
      expect(response.html).not.toContain("&lt;h1");
    } finally {
      await vite.close();
    }
  });
});

describe("buildBangala", () => {
  it("prerenders static routes and bundles the client runtime", async () => {
    const root = tmpRoot();
    write(root, "pages/index.bangala", "<h1>Home</h1>");
    write(root, "pages/about.bangala", "<p>About</p>");
    write(root, "pages/blog/[slug].bangala", "<h1>{props.params.slug}</h1>");

    const result = await buildBangala({
      root,
      outDir: "public",
      prerender: ["/blog/first-post"],
    });

    expect(result.pages.map((page) => page.pathname)).toEqual(["/", "/about", "/blog/first-post"]);
    expect(await readFile(join(root, "public/index.html"), "utf8")).toContain("<h1>Home</h1>");
    expect(await readFile(join(root, "public/about/index.html"), "utf8")).toContain(
      "<p>About</p>",
    );
    expect(await readFile(join(root, "public/blog/first-post/index.html"), "utf8")).toContain(
      "<h1>first-post</h1>",
    );
    await expect(stat(join(root, "public/assets/bangala-client.js"))).resolves.toBeTruthy();
  });

  it("prerenders nested layouts outermost first", async () => {
    const root = tmpRoot();
    write(root, "pages/_layout.bangala", "<html><body><slot/></body></html>");
    write(root, "pages/docs/_layout.bangala", "<section data-docs><slot/></section>");
    write(root, "pages/docs/index.bangala", "<h1>Docs</h1>");

    const result = await buildBangala({ root, outDir: "out", client: false });

    expect(result.pages.map((page) => page.pathname)).toEqual(["/docs"]);
    expect(await readFile(join(root, "out/docs/index.html"), "utf8")).toBe(
      '<html><body><section data-docs=""><h1>Docs</h1></section></body></html>',
    );
  });

  it("prerenders dynamic routes via getStaticPaths()", async () => {
    const root = tmpRoot();
    write(root, "pages/index.bangala", "<h1>Home</h1>");
    write(
      root,
      "pages/posts/[slug].bangala",
      [
        "---",
        "export async function getStaticPaths() {",
        '  return [{ params: { slug: "hello" } }, { params: { slug: "world" } }]',
        "}",
        "---",
        "<article>{props.params.slug}</article>",
      ].join("\n"),
    );

    const result = await buildBangala({ root, outDir: "out" });

    const pathnames = result.pages.map((p) => p.pathname).sort();
    expect(pathnames).toEqual(["/", "/posts/hello", "/posts/world"]);
    expect(await readFile(join(root, "out/posts/hello/index.html"), "utf8")).toContain(
      "<article>hello</article>",
    );
    expect(await readFile(join(root, "out/posts/world/index.html"), "utf8")).toContain(
      "<article>world</article>",
    );
  });

  it("skips dynamic routes that do not export getStaticPaths()", async () => {
    const root = tmpRoot();
    write(root, "pages/index.bangala", "<h1>Home</h1>");
    write(root, "pages/blog/[slug].bangala", "<p>{props.params.slug}</p>");

    const result = await buildBangala({ root, outDir: "out" });

    expect(result.pages.map((p) => p.pathname).sort()).toEqual(["/"]);
  });
});
