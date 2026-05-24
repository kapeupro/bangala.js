import { readdir } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";

export type RouteSegment =
  | { type: "static"; value: string }
  | { type: "dynamic"; name: string }
  | { type: "catch-all"; name: string };

export interface FileRoute {
  /** Stable id derived from the route path. Useful as a manifest key. */
  id: string;
  /** Original file path. Absolute when returned by discoverRoutes(). */
  file: string;
  /** Public route pattern: '/', '/blog/:slug', '/docs/*parts'. */
  path: string;
  segments: RouteSegment[];
  /** Higher scores are more specific and are matched first. */
  score: number;
  /**
   * Layout files (absolute paths) to wrap this route with, outermost first.
   * Each `_layout.bangala` in the route's ancestor directories (from the pages
   * root down to the route file's directory) is included in order.
   */
  layouts: string[];
}

export interface RouteMatch {
  route: FileRoute;
  pathname: string;
  params: Record<string, string | string[]>;
}

export interface RouteOptions {
  /** Directory to make file paths relative to. */
  root?: string;
  /** Route file extensions. Defaults to ['.bangala']. */
  extensions?: readonly string[];
}

const DEFAULT_EXTENSIONS = [".bangala"] as const;
const LAYOUT_BASENAME = "_layout";

export async function discoverRoutes(
  root: string,
  options: Omit<RouteOptions, "root"> = {},
): Promise<FileRoute[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const { files, layouts } = await walk(root, extensions);
  return createRoutes(files, { ...options, root, extensions, layouts });
}

export function createRoutes(
  files: Iterable<string>,
  options: RouteOptions & { layouts?: Iterable<string> } = {},
): FileRoute[] {
  const fileList = [...files];
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const layoutSet = new Set(
    (options.layouts ? [...options.layouts] : findLayouts(fileList, extensions)),
  );

  const routes: FileRoute[] = [];
  const seen = new Map<string, string>();

  for (const file of fileList) {
    if (layoutSet.has(file)) continue;
    const path = routePathFromFile(file, options);
    if (path === null) continue;
    const previous = seen.get(path);
    if (previous) {
      throw new Error(`Duplicate route '${path}' for '${previous}' and '${file}'`);
    }
    seen.set(path, file);
    const segments = parseRoutePath(path);
    routes.push({
      id: routeId(path),
      file,
      path,
      segments,
      score: scoreSegments(segments),
      layouts: layoutsForFile(file, layoutSet, options.root),
    });
  }

  return routes.sort(compareRoutes);
}

function findLayouts(files: Iterable<string>, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (isLayoutFile(file, extensions)) out.push(file);
  }
  return out;
}

function isLayoutFile(file: string, extensions: readonly string[]): boolean {
  const ext = extensions.find((candidate) => file.endsWith(candidate));
  if (!ext) return false;
  const posix = file.replace(/\\/g, "/");
  const base = posix.slice(posix.lastIndexOf("/") + 1, posix.length - ext.length);
  return base === LAYOUT_BASENAME;
}

function layoutsForFile(
  file: string,
  layoutSet: Set<string>,
  root?: string,
): string[] {
  if (layoutSet.size === 0) return [];
  const fileDir = dirname(file);
  const rootDir = root ? normalizeDir(root) : null;

  const chain: string[] = [];
  // Walk from file's directory up. We must stop at the route root (inclusive),
  // never going above it. If no root was given, we collect every ancestor
  // layout we can find — this is used in unit tests with synthetic file paths.
  let current = fileDir;
  // Safety bound: 100 levels is far more than any real project.
  for (let i = 0; i < 100; i++) {
    const matches = findLayoutInDir(current, layoutSet);
    if (matches) chain.push(matches);
    if (rootDir !== null && normalizeDir(current) === rootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    if (rootDir !== null && !isWithinOrEqual(current, rootDir)) break;
  }

  // chain is innermost → outermost; reverse to outermost-first.
  return chain.reverse();
}

function findLayoutInDir(dir: string, layoutSet: Set<string>): string | null {
  for (const layout of layoutSet) {
    if (dirname(layout) === dir) return layout;
  }
  return null;
}

function normalizeDir(dir: string): string {
  return dir.endsWith(sep) ? dir.slice(0, -1) : dir;
}

function isWithinOrEqual(candidate: string, root: string): boolean {
  const c = normalizeDir(candidate);
  const r = normalizeDir(root);
  if (c === r) return true;
  return c.startsWith(`${r}${sep}`) || c.startsWith(`${r}/`);
}

export function routePathFromFile(
  file: string,
  options: RouteOptions = {},
): string | null {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const ext = extensions.find((candidate) => file.endsWith(candidate));
  if (!ext) return null;

  const rel = normalizeRelativeFile(file, options.root);
  const withoutExt = rel.slice(0, -ext.length);
  const parts = withoutExt.split("/").filter(Boolean);
  if (parts.some(isPrivateSegment)) return null;
  if (parts.at(-1) === "index") parts.pop();

  const segments = parts.map(parseFileSegment);
  if (segments.some((segment) => segment.type === "catch-all")) {
    const catchAllIndex = segments.findIndex((segment) => segment.type === "catch-all");
    if (catchAllIndex !== segments.length - 1) {
      throw new Error(`Catch-all route segment must be last in '${file}'`);
    }
  }

  return routePath(segments);
}

export function matchRoute(
  routes: Iterable<FileRoute>,
  pathname: string,
): RouteMatch | null {
  const normalized = normalizePathname(pathname);
  const parts = splitPathname(normalized);

  for (const route of routes) {
    const params: Record<string, string | string[]> = {};
    if (matches(route.segments, parts, params)) {
      return { route, pathname: normalized, params };
    }
  }

  return null;
}

async function walk(
  root: string,
  extensions: readonly string[],
): Promise<{ files: string[]; layouts: string[] }> {
  const files: string[] = [];
  const layouts: string[] = [];

  async function recurse(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isPrivateSegment(entry.name)) continue;
        await recurse(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue;
      if (isLayoutFile(entry.name, extensions)) {
        layouts.push(full);
        continue;
      }
      if (isPrivateSegment(entry.name)) continue;
      files.push(full);
    }
  }

  await recurse(root);
  return { files, layouts };
}

function normalizeRelativeFile(file: string, root?: string): string {
  const value = root ? relative(root, file) : file;
  const posix = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (posix === "" || posix.startsWith("../") || posix === "..") {
    throw new Error(`Route file '${file}' is outside root '${root}'`);
  }
  return posix;
}

function isPrivateSegment(segment: string): boolean {
  return segment.startsWith("_") || segment.startsWith(".");
}

function parseFileSegment(segment: string): RouteSegment {
  const catchAll = segment.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAll) return { type: "catch-all", name: catchAll[1]! };
  const dynamic = segment.match(/^\[(\w+)\]$/);
  if (dynamic) return { type: "dynamic", name: dynamic[1]! };
  if (segment.includes("[") || segment.includes("]")) {
    throw new Error(`Invalid route segment '${segment}'`);
  }
  return { type: "static", value: segment };
}

function parseRoutePath(path: string): RouteSegment[] {
  return splitPathname(path).map((part) => {
    if (part.startsWith(":")) return { type: "dynamic", name: part.slice(1) };
    if (part.startsWith("*")) return { type: "catch-all", name: part.slice(1) };
    return { type: "static", value: part };
  });
}

function routePath(segments: RouteSegment[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.map((segment) => {
    switch (segment.type) {
      case "static":
        return segment.value;
      case "dynamic":
        return `:${segment.name}`;
      case "catch-all":
        return `*${segment.name}`;
    }
  }).join("/")}`;
}

function routeId(path: string): string {
  return path === "/" ? "root" : path.slice(1).replace(/[:*]/g, "$").replace(/\//g, "_");
}

function scoreSegments(segments: RouteSegment[]): number {
  return segments.reduce((score, segment) => {
    switch (segment.type) {
      case "static":
        return score + 100;
      case "dynamic":
        return score + 50;
      case "catch-all":
        return score;
    }
  }, segments.length);
}

function compareRoutes(a: FileRoute, b: FileRoute): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.segments.length !== b.segments.length) return b.segments.length - a.segments.length;
  return a.path.localeCompare(b.path);
}

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (withLeadingSlash.length > 1) return withLeadingSlash.replace(/\/+$/, "");
  return "/";
}

function splitPathname(pathname: string): string[] {
  if (pathname === "/") return [];
  return pathname.split("/").filter(Boolean).map(decodePathSegment);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matches(
  routeSegments: RouteSegment[],
  parts: string[],
  params: Record<string, string | string[]>,
): boolean {
  let partIndex = 0;

  for (const segment of routeSegments) {
    if (segment.type === "catch-all") {
      const rest = parts.slice(partIndex);
      if (rest.length === 0) return false;
      params[segment.name] = rest;
      return true;
    }

    const part = parts[partIndex];
    if (part === undefined) return false;

    if (segment.type === "static") {
      if (segment.value !== part) return false;
    } else {
      params[segment.name] = part;
    }
    partIndex++;
  }

  return partIndex === parts.length;
}
