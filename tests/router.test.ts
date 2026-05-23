import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoutes,
  discoverRoutes,
  matchRoute,
  routePathFromFile,
} from "../src/router.js";

let tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots = [];
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bangala-router-"));
  tmpRoots.push(root);
  return root;
}

function touch(root: string, file: string): string {
  const full = join(root, file);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "---\n---\n");
  return full;
}

describe("routePathFromFile", () => {
  it("maps index files to their directory route", () => {
    expect(routePathFromFile("pages/index.bangala", { root: "pages" })).toBe("/");
    expect(routePathFromFile("pages/blog/index.bangala", { root: "pages" })).toBe("/blog");
  });

  it("maps static, dynamic, and catch-all segments", () => {
    expect(routePathFromFile("pages/about.bangala", { root: "pages" })).toBe("/about");
    expect(routePathFromFile("pages/blog/[slug].bangala", { root: "pages" })).toBe(
      "/blog/:slug",
    );
    expect(routePathFromFile("pages/docs/[...parts].bangala", { root: "pages" })).toBe(
      "/docs/*parts",
    );
  });

  it("ignores private files and directories", () => {
    expect(routePathFromFile("pages/_layout.bangala", { root: "pages" })).toBeNull();
    expect(routePathFromFile("pages/blog/_shared/Card.bangala", { root: "pages" })).toBeNull();
  });
});

describe("createRoutes", () => {
  it("sorts routes by specificity", () => {
    const routes = createRoutes(
      [
        "pages/blog/[...rest].bangala",
        "pages/blog/[slug].bangala",
        "pages/blog/settings.bangala",
        "pages/index.bangala",
      ],
      { root: "pages" },
    );

    expect(routes.map((r) => r.path)).toEqual([
      "/blog/settings",
      "/blog/:slug",
      "/blog/*rest",
      "/",
    ]);
  });

  it("throws when two files map to the same route path", () => {
    expect(() =>
      createRoutes(["pages/blog.bangala", "pages/blog/index.bangala"], { root: "pages" }),
    ).toThrow("Duplicate route '/blog'");
  });
});

describe("matchRoute", () => {
  const routes = createRoutes(
    [
      "pages/index.bangala",
      "pages/about.bangala",
      "pages/blog/[slug].bangala",
      "pages/docs/[...parts].bangala",
    ],
    { root: "pages" },
  );

  it("matches static routes", () => {
    const match = matchRoute(routes, "/about");
    expect(match?.route.path).toBe("/about");
    expect(match?.params).toEqual({});
  });

  it("matches dynamic params and decodes values", () => {
    const match = matchRoute(routes, "/blog/hello%20world");
    expect(match?.route.path).toBe("/blog/:slug");
    expect(match?.params).toEqual({ slug: "hello world" });
  });

  it("matches catch-all params as arrays", () => {
    const match = matchRoute(routes, "/docs/guides/install");
    expect(match?.route.path).toBe("/docs/*parts");
    expect(match?.params).toEqual({ parts: ["guides", "install"] });
  });

  it("returns null when no route matches", () => {
    expect(matchRoute(routes, "/missing")).toBeNull();
    expect(matchRoute(routes, "/docs")).toBeNull();
  });
});

describe("discoverRoutes", () => {
  it("walks a directory and builds a stable manifest", async () => {
    const root = tmpRoot();
    touch(root, "index.bangala");
    touch(root, "blog/[slug].bangala");
    touch(root, "blog/_draft.bangala");
    touch(root, "_private/debug.bangala");
    touch(root, "about.txt");

    const routes = await discoverRoutes(root);

    expect(routes.map((r) => r.path)).toEqual(["/blog/:slug", "/"]);
    expect(routes.map((r) => r.file)).toEqual([
      join(root, "blog/[slug].bangala"),
      join(root, "index.bangala"),
    ]);
  });
});
