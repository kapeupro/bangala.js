import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { compileAndRender } from "./helpers.js";
import { compile } from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("render — integration", () => {
  it("interpolates and HTML-escapes expressions", async () => {
    const html = await compileAndRender("<p>{props.name}</p>", { name: "<b>x</b>" });
    expect(html).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
  });

  it("renders both branches of {#if}", async () => {
    const src = "{#if props.ok}<p>yes</p>{:else}<p>no</p>{/if}";
    expect(await compileAndRender(src, { ok: true })).toBe("<p>yes</p>");
    expect(await compileAndRender(src, { ok: false })).toBe("<p>no</p>");
  });

  it("renders {#each} over empty and non-empty lists", async () => {
    const src = "<ul>{#each props.items as it}<li>{it}</li>{/each}</ul>";
    expect(await compileAndRender(src, { items: [] })).toBe("<ul></ul>");
    expect(await compileAndRender(src, { items: ["a", "b"] })).toBe(
      "<ul><li>a</li><li>b</li></ul>",
    );
  });

  it("uses the frontmatter (with await) at render time", async () => {
    const src = "---\nconst total = await Promise.resolve(7)\n---\n<span>{total}</span>";
    expect(await compileAndRender(src)).toBe("<span>7</span>");
  });
});

describe("compile — island markers", () => {
  it("produces a bangala-island marker for an island component", () => {
    const src =
      `---\nimport Counter from "./Counter.bangala"\n---\n<Counter start={5} client:load/>`;
    const result = compile(src, { filename: "page.bangala" });
    expect(result.islands).toEqual([
      { componentPath: "./Counter.bangala", strategy: "client:load" },
    ]);
    expect(result.code).toContain(
      `await island(Counter, {"start": 5}, "./Counter", "client:load")`,
    );
  });
});

describe("compile — reference example", () => {
  it("compiles the reference fixtures without error", () => {
    for (const name of ["Counter", "Layout", "index"]) {
      const src = readFileSync(join(FIXTURES, `${name}.bangala`), "utf8");
      const result = compile(src, { filename: `${name}.bangala` });
      expect(result.code).toContain("export { render };");
    }
  });
});
