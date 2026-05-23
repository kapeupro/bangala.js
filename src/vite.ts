import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build as viteBuild,
  createServer as createViteServer,
  mergeConfig,
  type InlineConfig,
  type Plugin,
  type ViteDevServer,
} from "vite";
import { compile } from "./index.js";
import {
  discoverRoutes,
  matchRoute,
  type FileRoute,
  type RouteMatch,
} from "./router.js";

export interface BangalaPluginOptions {
  /** Pages directory, relative to Vite root. Set false to disable route middleware. */
  pages?: string | false;
  /** Inject bangala/client/auto in rendered pages. Defaults to true. */
  injectClient?: boolean;
}

export interface BangalaDevServerOptions {
  root?: string;
  pages?: string;
  injectClient?: boolean;
  vite?: InlineConfig;
}

export interface BangalaBuildOptions {
  root?: string;
  pages?: string;
  outDir?: string;
  /** Extra pathnames to prerender, usually dynamic routes such as /blog/hello. */
  prerender?: string[];
  injectClient?: boolean;
  client?: boolean;
  vite?: InlineConfig;
}

export interface BuiltPage {
  pathname: string;
  file: string;
  route: FileRoute;
  params: Record<string, string | string[]>;
}

export interface BangalaBuildResult {
  outDir: string;
  routes: FileRoute[];
  pages: BuiltPage[];
  clientEntry: string | null;
}

const CLIENT_ENTRY_NAME = "bangala-client";
const CLIENT_ENTRY_FILE = `assets/${CLIENT_ENTRY_NAME}.js`;

export function bangala(options: BangalaPluginOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let pagesRoot: string | null = null;
  const injectClient = options.injectClient ?? true;

  return {
    name: "bangala",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      pagesRoot = options.pages === false
        ? null
        : resolve(projectRoot, options.pages ?? "pages");
    },
    resolveId(source, importer) {
      const internal = resolveBangalaInternal(source);
      if (internal) return internal;
      if (importer && source.endsWith(".js")) {
        const candidate = resolve(dirname(cleanId(importer)), source.replace(/\.js$/, ".bangala"));
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
    async load(id) {
      const file = cleanId(id);
      if (!file.endsWith(".bangala")) return null;
      const source = await readFile(file, "utf8");
      const result = compile(source, { filename: file });
      for (const dependency of result.dependencies) {
        this.addWatchFile(resolve(dirname(file), dependency));
      }
      return { code: result.code, map: null };
    },
    configureServer(server) {
      if (!pagesRoot) return undefined;
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url || (req.method !== "GET" && req.method !== "HEAD")) {
            next();
            return;
          }

          try {
            const routes = await discoverRoutes(pagesRoot!);
            const match = matchRoute(routes, req.url);
            if (!match) {
              next();
              return;
            }

            let html = await renderMatchedRoute(server, match);
            if (injectClient) html = injectDevClient(html);
            html = await server.transformIndexHtml(match.pathname, html);

            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            if (req.method === "HEAD") {
              res.end();
            } else {
              res.end(html);
            }
          } catch (error) {
            server.ssrFixStacktrace(error as Error);
            next(error);
          }
        });
      };
    },
  };
}

export async function createBangalaDevServer(
  options: BangalaDevServerOptions = {},
): Promise<ViteDevServer> {
  const root = resolve(options.root ?? process.cwd());
  const config = mergeConfig(
    {
      root,
      configFile: false,
      appType: "custom",
      server: { hmr: false, ws: false },
      plugins: [bangala({ pages: options.pages ?? "pages", injectClient: options.injectClient })],
    } satisfies InlineConfig,
    options.vite ?? {},
  );
  return createViteServer(config);
}

export async function buildBangala(
  options: BangalaBuildOptions = {},
): Promise<BangalaBuildResult> {
  const root = resolve(options.root ?? process.cwd());
  const pagesRoot = resolve(root, options.pages ?? "pages");
  const outDir = resolve(root, options.outDir ?? "dist");
  const injectClient = options.injectClient ?? true;
  const buildClient = options.client ?? true;

  if (buildClient) {
    await viteBuild(mergeConfig(
      {
        root,
        configFile: false,
        appType: "custom",
        plugins: [bangala({ pages: false })],
        build: {
          outDir,
          emptyOutDir: true,
          rollupOptions: {
            input: { [CLIENT_ENTRY_NAME]: "bangala/client/auto" },
            output: {
              entryFileNames: "assets/[name].js",
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
      } satisfies InlineConfig,
      options.vite ?? {},
    ));
  } else {
    await rm(outDir, { recursive: true, force: true });
  }

  const server = await createViteServer({
    root,
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [bangala({ pages: false })],
  });

  try {
    const routes = await discoverRoutes(pagesRoot);
    const pathnames = pathnamesToPrerender(routes, options.prerender ?? []);
    const pages: BuiltPage[] = [];

    for (const pathname of pathnames) {
      const match = matchRoute(routes, pathname);
      if (!match) throw new Error(`No route matches prerender path '${pathname}'`);
      let html = await renderMatchedRoute(server, match);
      if (injectClient && buildClient) html = injectBuildClient(html, `/${CLIENT_ENTRY_FILE}`);
      const file = outputFileForPathname(outDir, pathname);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      pages.push({ pathname: match.pathname, file, route: match.route, params: match.params });
    }

    return {
      outDir,
      routes,
      pages,
      clientEntry: buildClient ? join(outDir, CLIENT_ENTRY_FILE) : null,
    };
  } finally {
    await server.close();
  }
}

async function renderMatchedRoute(
  server: ViteDevServer,
  match: RouteMatch,
): Promise<string> {
  const mod = await server.ssrLoadModule(match.route.file);
  if (typeof mod.render !== "function") {
    throw new Error(`Route module '${match.route.file}' does not export render()`);
  }
  return String(await mod.render({ params: match.params, url: match.pathname }));
}

function pathnamesToPrerender(routes: FileRoute[], extra: string[]): string[] {
  const out = new Set<string>();
  for (const route of routes) {
    if (route.segments.every((segment) => segment.type === "static")) {
      out.add(route.path);
    }
  }
  for (const pathname of extra) out.add(normalizePublicPath(pathname));
  return [...out].sort((a, b) => a.localeCompare(b));
}

function outputFileForPathname(outDir: string, pathname: string): string {
  if (pathname === "/") return join(outDir, "index.html");
  return join(outDir, ...pathname.slice(1).split("/"), "index.html");
}

function injectDevClient(html: string): string {
  return injectBeforeBody(
    html,
    `<script type="module">import "bangala/client/auto";</script>`,
  );
}

function injectBuildClient(html: string, src: string): string {
  return injectBeforeBody(html, `<script type="module" src="${src}"></script>`);
}

function injectBeforeBody(html: string, snippet: string): string {
  const match = html.match(/<\/body\s*>/i);
  if (!match || match.index === undefined) return `${html}${snippet}`;
  return `${html.slice(0, match.index)}${snippet}${html.slice(match.index)}`;
}

function normalizePublicPath(pathname: string): string {
  const [path = "/"] = pathname.split(/[?#]/, 1);
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : "/";
}

function resolveBangalaInternal(source: string): string | null {
  switch (source) {
    case "bangala/runtime":
      return localFile("runtime");
    case "bangala/client/auto":
      return localFile("client/auto");
    case "bangala/client":
      return localFile("client/index");
    case "bangala/router":
      return localFile("router");
    default:
      return null;
  }
}

function localFile(name: string): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const js = join(base, `${name}.js`);
  if (existsSync(js)) return js;
  return join(base, `${name}.ts`);
}

function cleanId(id: string): string {
  return id.split("?", 1)[0]!;
}

export { type FileRoute } from "./router.js";
