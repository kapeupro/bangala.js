import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

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

export async function discoverRoutes(
  root: string,
  options: Omit<RouteOptions, "root"> = {},
): Promise<FileRoute[]> {
  const files = await walk(root, options.extensions ?? DEFAULT_EXTENSIONS);
  return createRoutes(files, { ...options, root });
}

export function createRoutes(
  files: Iterable<string>,
  options: RouteOptions = {},
): FileRoute[] {
  const routes: FileRoute[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
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
    });
  }

  return routes.sort(compareRoutes);
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

async function walk(root: string, extensions: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (isPrivateSegment(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(full, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }

  return out;
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
