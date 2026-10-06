import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build as viteBuild,
  createServer as createViteServer,
  mergeConfig,
  transformWithEsbuild,
  type InlineConfig,
  type Plugin,
  type Rollup,
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
  /**
   * Empty outDir before building. Mirrors Vite: defaults to true when outDir is
   * inside root; an outDir outside root is only emptied when this is true.
   */
  emptyOutDir?: boolean;
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

/** Extensions tried, in order, for an island's client module. */
const CLIENT_MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

/**
 * Finds the client module of an island component: `Counter.bangala` is
 * hydrated by the sibling `Counter.client.ts` (or `.tsx`, `.mts`, `.js`,
 * `.jsx`, `.mjs`), which exports `mount(el, props, ctx)`.
 */
export function findIslandClientModule(componentFile: string): string | null {
  const base = componentFile.replace(/\.bangala$/, "");
  for (const extension of CLIENT_MODULE_EXTENSIONS) {
    const candidate = `${base}.client${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Maps an island's client module (absolute path) to its `data-entry` URL. */
type IslandUrl = (clientModule: string) => string;

export function bangala(options: BangalaPluginOptions = {}): Plugin {
  return bangalaPlugin(options);
}

function bangalaPlugin(options: BangalaPluginOptions, buildIslandUrl?: IslandUrl): Plugin {
  let projectRoot = process.cwd();
  let base = "/";
  let pagesRoot: string | null = null;
  const injectClient = options.injectClient ?? true;

  // In dev, Vite serves source files at their root-relative URL (or under
  // /@fs/ outside the root) and transpiles TypeScript on request.
  const devIslandUrl: IslandUrl = (file) => {
    const fromRoot = relative(projectRoot, file);
    const url = isWithin(file, projectRoot) ? toPosix(fromRoot) : `@fs/${toPosix(file).replace(/^\//, "")}`;
    return `${base}${url}`;
  };

  return {
    name: "bangala",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      base = config.base.endsWith("/") ? config.base : `${config.base}/`;
      pagesRoot = options.pages === false
        ? null
        : resolve(projectRoot, options.pages ?? "pages");
    },
    resolveId(source) {
      return resolveBangalaInternal(source);
    },
    async load(id) {
      const file = cleanId(id);
      if (!file.endsWith(".bangala")) return null;
      const source = await readFile(file, "utf8");
      const islandUrl = buildIslandUrl ?? devIslandUrl;
      const result = compile(source, {
        filename: file,
        // Vite resolves `.bangala` imports itself, through this plugin's load().
        rewriteBangalaImports: false,
        islandEntry: (specifier) => islandUrl(islandClientModule(file, specifier, projectRoot)),
      });
      for (const dependency of result.dependencies) {
        if (/^\.{1,2}\//.test(dependency)) this.addWatchFile(resolve(dirname(file), dependency));
      }
      // The frontmatter may be TypeScript; Vite only transpiles .ts ids.
      const { code } = await transformWithEsbuild(result.code, `${file}.ts`, { loader: "ts" });
      return { code, map: null };
    },
    handleHotUpdate({ file, server }) {
      // Pages and components render on the server, so no client module can
      // accept their update: reload the page instead.
      if (!file.endsWith(".bangala")) return undefined;
      server.ws.send({ type: "full-reload" });
      return [];
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
            if (injectClient && hasIsland(html)) html = injectDevClient(html);
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
  // A standalone dev server reloads the page when a .bangala file changes.
  // In middleware mode the host server owns the connection, so live reload
  // stays off unless the caller configures it.
  const live = !options.vite?.server?.middlewareMode;
  const config = mergeConfig(
    {
      root,
      configFile: false,
      appType: "custom",
      server: live ? {} : { hmr: false, ws: false },
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

  // Vite copies publicDir into outDir, so the two must not overlap either.
  const publicDir = options.vite?.publicDir === false
    ? null
    : resolve(root, options.vite?.publicDir || "public");
  assertSafeOutDir(outDir, root, pagesRoot, publicDir);
  const emptyOutDir = options.emptyOutDir ?? isWithin(outDir, root);
  if (options.emptyOutDir === undefined && !emptyOutDir) {
    console.warn(
      `bangala: outDir '${outDir}' is outside the project root '${root}' and will not be emptied. ` +
        "Pass emptyOutDir: true to empty it before building.",
    );
  }

  // Pages render first, so the islands they actually use are known before
  // the client bundle is built. Their `data-entry` holds a placeholder until
  // the bundle names the files.
  const islandModules: string[] = [];
  const islandUrl: IslandUrl = (file) => {
    let index = islandModules.indexOf(file);
    if (index === -1) index = islandModules.push(file) - 1;
    return `${ISLAND_PLACEHOLDER}${index}/`;
  };

  const server = await createViteServer(mergeConfig(
    {
      root,
      configFile: false,
      appType: "custom",
      server: { middlewareMode: true, hmr: false, ws: false },
      plugins: [bangalaPlugin({ pages: false }, islandUrl)],
    } satisfies InlineConfig,
    options.vite ?? {},
  ));

  const routes = await discoverRoutes(pagesRoot);
  const rendered: { pathname: string; file: string; match: RouteMatch; html: string }[] = [];
  try {
    const pathnames = await pathnamesToPrerender(server, routes, options.prerender ?? []);
    for (const pathname of pathnames) {
      const match = matchRoute(routes, pathname);
      if (!match) throw new Error(`No route matches prerender path '${pathname}'`);
      const file = outputFileForPathname(outDir, pathname);
      assertSafePrerenderTarget(outDir, pathname, match, file);
      rendered.push({ pathname, file, match, html: await renderMatchedRoute(server, match) });
    }
  } finally {
    await server.close();
  }

  const base = normalizeBase(options.vite?.base);
  const islandFiles = new Map<string, string>();
  if (buildClient) {
    const input: Record<string, string> = { [CLIENT_ENTRY_NAME]: "bangala/client/auto" };
    const islandInputs = new Set<string>();
    islandModules.forEach((file, index) => {
      // Rollup input names must be unique; the file name stays readable.
      let name = `islands/${basename(file).replace(/\.[^.]+$/, "")}`;
      if (islandInputs.has(name)) name = `${name}-${index}`;
      islandInputs.add(name);
      input[name] = file;
    });
    const output = await viteBuild(mergeConfig(
      {
        root,
        configFile: false,
        appType: "custom",
        logLevel: "warn",
        plugins: [bangala({ pages: false })],
        build: {
          outDir,
          emptyOutDir,
          rollupOptions: {
            input,
            // Keep island exports (`mount`) even though no other entry imports them.
            preserveEntrySignatures: "exports-only",
            output: {
              entryFileNames: (chunk) =>
                chunk.name === CLIENT_ENTRY_NAME ? "assets/[name].js" : "assets/[name]-[hash].js",
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
      } satisfies InlineConfig,
      options.vite ?? {},
    ));
    for (const result of Array.isArray(output) ? output : [output as Rollup.RollupOutput]) {
      for (const item of result.output ?? []) {
        if (item.type === "chunk" && item.isEntry && item.facadeModuleId) {
          islandFiles.set(item.facadeModuleId, item.fileName);
        }
      }
    }
  } else {
    if (emptyOutDir) await rm(outDir, { recursive: true, force: true });
    if (islandModules.length > 0) {
      console.warn(
        `bangala: ${islandModules.length} island client module(s) are not bundled because the client build is disabled; ` +
          "their data-entry points at the source files.",
      );
    }
  }

  const pages: BuiltPage[] = [];
  for (const { pathname, file, match, html: renderedHtml } of rendered) {
    let html = renderedHtml.replace(ISLAND_PLACEHOLDER_RE, (_, index: string) => {
      const source = islandModules[Number(index)]!;
      const built = islandFiles.get(source);
      return built ? `${base}${built}` : `${base}${toPosix(relative(root, source))}`;
    });
    if (injectClient && buildClient && hasIsland(html)) html = injectBuildClient(html, `${base}${CLIENT_ENTRY_FILE}`);
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
}

/** Placeholder written in `data-entry` while pages prerender, before islands are bundled. */
const ISLAND_PLACEHOLDER = "/@bangala-island/";
const ISLAND_PLACEHOLDER_RE = /\/@bangala-island\/(\d+)\//g;

function normalizeBase(base: string | undefined): string {
  if (!base || base === "./" || base === "") return "/";
  const withLeading = base.startsWith("/") || /^[a-z]+:\/\//i.test(base) ? base : `/${base}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

async function renderMatchedRoute(
  server: ViteDevServer,
  match: RouteMatch,
): Promise<string> {
  const props = { params: match.params, url: match.pathname };
  const page = await loadRenderable(server, match.route.file);
  const layouts = await Promise.all(
    match.route.layouts.map((file) => loadRenderable(server, file)),
  );
  return wrapWithLayouts(layouts, page, props);
}

interface Renderable {
  render: (props: Record<string, unknown>) => string | Promise<string>;
}

async function loadRenderable(server: ViteDevServer, file: string): Promise<Renderable> {
  const mod = await server.ssrLoadModule(file);
  if (typeof (mod as Record<string, unknown>).render !== "function") {
    throw new Error(`Module '${file}' does not export render()`);
  }
  return mod as unknown as Renderable;
}

/**
 * Composes a page render with its layout chain. `layouts` is ordered
 * outermost-first: layouts[0] wraps everything, layouts[last] wraps the page
 * most tightly. Each layout's `props.children` is the pre-rendered HTML of
 * the inner content.
 */
export async function wrapWithLayouts(
  layouts: Renderable[],
  page: Renderable,
  props: Record<string, unknown>,
): Promise<string> {
  let html = String(await page.render(props));
  for (let i = layouts.length - 1; i >= 0; i--) {
    html = String(await layouts[i]!.render({ ...props, children: html }));
  }
  return html;
}

interface StaticPathEntry {
  params?: Record<string, string | string[]>;
}

/**
 * Builds the list of pathnames to prerender. Static routes are always
 * included. Dynamic routes (`[slug]`, `[...rest]`) are included if their
 * module exports `getStaticPaths()` — its return value is a list of
 * `{ params }` objects that get substituted into the route's pattern.
 *
 * Pages with dynamic segments and no `getStaticPaths` export are silently
 * skipped: they may exist for dev-server-only or SSR-at-request-time use later,
 * while today's build remains static-first.
 */
async function pathnamesToPrerender(
  server: ViteDevServer,
  routes: FileRoute[],
  extra: string[],
): Promise<string[]> {
  const out = new Set<string>();
  for (const route of routes) {
    const isStatic = route.segments.every((segment) => segment.type === "static");
    if (isStatic) {
      out.add(route.path);
      continue;
    }
    const mod = await server.ssrLoadModule(route.file);
    const getStaticPaths = (mod as { getStaticPaths?: () => unknown }).getStaticPaths;
    if (typeof getStaticPaths !== "function") continue;
    const result = await getStaticPaths();
    if (!Array.isArray(result)) {
      throw new Error(
        `getStaticPaths() in '${route.file}' must return an array of { params }`,
      );
    }
    for (const entry of result as StaticPathEntry[]) {
      const params = entry?.params ?? {};
      out.add(buildPathnameFromRoute(route, params));
    }
  }
  for (const pathname of extra) out.add(normalizePublicPath(pathname));
  return [...out].sort((a, b) => a.localeCompare(b));
}

function buildPathnameFromRoute(
  route: FileRoute,
  params: Record<string, string | string[]>,
): string {
  const parts: string[] = [];
  for (const seg of route.segments) {
    if (seg.type === "static") {
      parts.push(seg.value);
    } else if (seg.type === "dynamic") {
      const v = params[seg.name];
      if (typeof v !== "string") {
        throw new Error(
          `getStaticPaths for '${route.file}': param '${seg.name}' must be a string`,
        );
      }
      assertStaticPathSegment(route, seg.name, v);
      parts.push(encodeURIComponent(v));
    } else {
      // catch-all
      const v = params[seg.name];
      if (!Array.isArray(v)) {
        throw new Error(
          `getStaticPaths for '${route.file}': catch-all param '${seg.name}' must be a string[]`,
        );
      }
      // Each item becomes one path segment, so it obeys the same rules.
      for (const s of v) assertStaticPathSegment(route, seg.name, String(s));
      parts.push(...v.map((s) => encodeURIComponent(s)));
    }
  }
  return parts.length === 0 ? "/" : "/" + parts.join("/");
}

function assertStaticPathSegment(route: FileRoute, name: string, value: string): void {
  const reason = unsafeSegmentReason(value);
  if (reason) {
    throw new Error(
      `getStaticPaths for '${route.file}': param '${name}' ${reason} (got ${JSON.stringify(value)}); ` +
        "each value must be a single, non-empty path segment",
    );
  }
}

/**
 * Explains why a param value cannot be written as exactly one directory under
 * outDir (it would collapse, climb out, or split into several), or null.
 */
function unsafeSegmentReason(value: string): string | null {
  if (value === "") return "is empty";
  if (value === "." || value === "..") return `is a '${value}' path segment`;
  if (value.includes("/")) return "contains '/'";
  if (value.includes("\\")) return "contains '\\'";
  if (value.includes("\0")) return "contains a NUL byte";
  return null;
}

/**
 * Last check before a prerendered page is written: the file must stay inside
 * outDir, and every matched param (decoded, so `%2E%2E` counts as `..`) must
 * be a plain segment. Covers both getStaticPaths and the `prerender` option.
 */
function assertSafePrerenderTarget(
  outDir: string,
  pathname: string,
  match: RouteMatch,
  file: string,
): void {
  const where = `Prerender path '${pathname}' for '${match.route.file}'`;
  if (!isWithin(file, outDir)) {
    throw new Error(
      `${where} (params ${JSON.stringify(match.params)}) resolves to '${file}', ` +
        `which is outside outDir '${outDir}'`,
    );
  }
  for (const [name, value] of Object.entries(match.params)) {
    for (const segment of Array.isArray(value) ? value : [value]) {
      const reason = unsafeSegmentReason(segment);
      if (reason) throw new Error(`${where}: param '${name}' ${reason}`);
    }
  }
}

/**
 * Refuses output directories whose emptying or overwriting would destroy
 * project sources: the filesystem root, the project root or any ancestor of
 * it, and anything overlapping the pages or public directory.
 */
function assertSafeOutDir(
  outDir: string,
  root: string,
  pagesRoot: string,
  publicDir: string | null,
): void {
  const refuse = (why: string) =>
    new Error(`Refusing to use outDir '${outDir}': ${why}. Pick a dedicated folder such as 'dist'.`);
  if (outDir === parse(outDir).root) {
    throw refuse("it is the filesystem root");
  }
  if (relative(root, outDir) === "") {
    throw refuse("it is the project root, and emptying it would delete your sources");
  }
  if (isWithin(root, outDir)) {
    throw refuse(`it contains the project root '${root}', and emptying it would delete your sources`);
  }
  if (isWithin(outDir, pagesRoot) || isWithin(pagesRoot, outDir)) {
    throw refuse(`it overlaps the pages directory '${pagesRoot}'`);
  }
  if (publicDir && (isWithin(outDir, publicDir) || isWithin(publicDir, outDir))) {
    throw refuse(`it overlaps the public directory '${publicDir}', whose files Vite copies into outDir`);
  }
}

/** True when `child` is `parent` itself or somewhere below it. */
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
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

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** True when the HTML holds an island marker, i.e. needs the client runtime. */
function hasIsland(html: string): boolean {
  return /<bangala-island[\s>]/i.test(html);
}

/**
 * Resolves the client module of the island component imported as
 * `specifier` from `importer`, or explains what is missing.
 */
function islandClientModule(importer: string, specifier: string, root: string): string {
  let componentFile: string;
  if (/^\.{1,2}\//.test(specifier)) componentFile = resolve(dirname(importer), specifier);
  else if (specifier.startsWith("/")) componentFile = join(root, specifier);
  else {
    throw new Error(
      `Island component "${specifier}" in '${importer}' must be imported with a relative path ` +
        `('./' or '../') so its client module can be found next to it`,
    );
  }
  const clientModule = findIslandClientModule(componentFile);
  if (clientModule) return clientModule;
  const name = basename(componentFile).replace(/\.bangala$/, "");
  throw new Error(
    `Island <${name}> in '${importer}' has no client module. Create '${name}.client.ts' (or .js) ` +
      `next to '${componentFile}', exporting mount(el, props).`,
  );
}

export { type FileRoute } from "./router.js";
