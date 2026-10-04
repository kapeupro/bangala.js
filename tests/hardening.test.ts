import { describe, it, expect } from "vitest";
import { compile, ParseError } from "../src/index.js";
import { island, each, type Component } from "../src/runtime.js";
import { compileAndRender, compileAndRenderProject } from "./helpers.js";

/**
 * Regression tests for the compiler hardening pass: the frontmatter and the
 * template expressions are JavaScript, not lines of text.
 */

const FILES: Record<string, string> = {
  "Card.bangala": `<div class="card">{props.title}</div>`,
  "Counter.bangala": `<button>{props.start}</button>`,
  "Html.bangala": `<div class="box"><slot/></div>`,
  "Promise.bangala": `<b>p</b>`,
  "side.js": `export const v = 42; globalThis.__side = "ok";`,
  "sql.js": "export default (s) => `'${s}'`",
  "r.js": `export function render(x) { return "lib-render:" + typeof x }`,
  "data.json": `{"a":"json-ok"}`,
};

function project(source: string, props: Record<string, unknown> = {}) {
  return compileAndRenderProject({ ...FILES, "page.bangala": source }, "page.bangala", props);
}

function parseError(source: string): ParseError {
  try {
    compile(source, { filename: "test.bangala" });
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  throw new Error("expected a ParseError");
}

describe("frontmatter fences", () => {
  it.each([
    ["a regex ending in /*", '---\nconst base = props.base.replace(/\\/*$/, "")\n---\n<a href={base + "/about"}>About</a>', { base: "/docs/" }, '<a href="/docs/about">About</a>'],
    ["a regex class with / and *", "---\nconst re = /[/*]/g\nconst x = 'a*b'.replace(re, '')\n---\n<p>{x}</p>", {}, "<p>ab</p>"],
    ["a division then a regex holding a backtick", "---\nconst half = 4 / 2\nconst tick = /`/.source\n---\n<p>{half}{tick}</p>", {}, "<p>2`</p>"],
    ["a string with { inside ${}", '---\nconst open = `${"{"}`\n---\n<p>{open}</p>', {}, "<p>{</p>"],
    ["a nested template inside ${}", "---\nconst s = `${ `}` }`\n---\n<p>{s}</p>", {}, "<p>}</p>"],
    ["a comment inside ${}", "---\nconst s = `${ 1 /* { */ }`\n---\n<p>{s}</p>", {}, "<p>1</p>"],
    ["a closing fence with trailing spaces", "---\nconst x = 1\n--- \n<p>{x}</p>", {}, "<p>1</p>"],
    ["indented fences", "  ---\n  const x = 1\n  ---\n<p>{x}</p>", {}, "<p>1</p>"],
    ["an opening fence with trailing spaces", "--- \nconst x = 1\n---\n<p>{x}</p>", {}, "<p>1</p>"],
    ["a byte-order mark", "﻿---\nconst x = 1\n---\n<p>{x}</p>", {}, "<p>1</p>"],
  ])("handles %s", async (_name, source, props, expected) => {
    expect(await compileAndRender(source, props)).toBe(expected);
  });

  it("reports a missing closing fence at the opener", () => {
    const err = parseError("---\nconst x = 1\n<p>{x}</p>");
    expect(err.message).toMatch(/^Unclosed frontmatter/);
    expect([err.line, err.column]).toEqual([1, 1]);
  });

  it("reports unterminated constructs where they start", () => {
    expect(parseError("---\nconst s = `abc\n---\n<p>x</p>").message)
      .toBe("Unterminated template literal (line 2, column 11)");
    expect(parseError("---\nconst s = 'it's'\n---\n<p>x</p>").message)
      .toBe("Unterminated string literal (line 2, column 16)");
    expect(parseError("---\n/* note\n---\n<p>x</p>").message)
      .toBe("Unterminated comment (line 2, column 1)");
  });
});

describe("CRLF line endings", () => {
  it("hoists imports", async () => {
    const source = '---\r\nimport { join } from "node:path"\r\nimport { sep } from "node:path"\r\nconst x = join("a", "b") + sep\r\n---\r\n<p>{x}</p>\r\n';
    expect(await compileAndRender(source)).toBe("<p>a/b/</p>\n");
  });

  it("hoists type-only imports", async () => {
    const source = '---\r\nimport type { A } from "./a.js"\r\nconst x: A = 1\r\n---\r\n<p>{x}</p>';
    expect(await compileAndRender(source)).toBe("<p>1</p>");
  });

  it("registers components", async () => {
    const source = '---\r\nimport Card from "./Card.bangala"\r\nconst t = "Hi"\r\n---\r\n<Card title={t}/>\r\n';
    expect((await project(source)).html).toBe('<div class="card">Hi</div>\n');
  });

  it("hoists exported functions holding braces in strings", async () => {
    const source = "---\r\nexport function f() {\r\n  return '}'\r\n}\r\nconst y = f()\r\n---\r\n<p>{y}</p>";
    expect(await compileAndRender(source)).toBe("<p>}</p>");
  });
});

describe("frontmatter imports", () => {
  it("does not hoist import-like lines inside a template literal", async () => {
    const { html, code } = await project('---\nconst sample = `\nimport Card from "./Card.bangala"\n<Card/>\n`\n---\n<pre>{sample}</pre>');
    expect(html).toBe("<pre>\nimport Card from &quot;./Card.bangala&quot;\n&lt;Card/&gt;\n</pre>");
    expect(compile('---\nconst sample = `\nimport Card from "./Card.bangala"\n`\n---\n<pre>{sample}</pre>', { filename: "p.bangala" }).dependencies).toEqual([]);
    expect(code).not.toContain('from "./Card.js"');
  });

  it("does not activate commented-out imports", async () => {
    const source = '---\n/*\nimport Old from "./Old.bangala"\n*/\nconst x = 1\n---\n<p>{x}</p>';
    expect(await compileAndRender(source)).toBe("<p>1</p>");
    const code = compile(source, { filename: "p.bangala" }).code;
    expect(code.slice(0, code.indexOf("async function $$render"))).not.toContain("import Old");
    expect(() => compile('---\n// import Old from "./Old.bangala"\n---\n<Old/>', { filename: "p.bangala" }))
      .toThrow(/<Old> is not imported/);
  });

  it("does not hoist an import continued inside a string", async () => {
    const source = "---\nconst s = \"line1\\\nimport x from 'y'\"\n---\n<p>{s}</p>";
    expect(await compileAndRender(source)).toBe("<p>line1import x from &#39;y&#39;</p>");
  });

  it("keeps a spaced dynamic import( in render", async () => {
    const { html } = await project('---\nconst mods = [\n  import ("./side.js"),\n]\nconst m = await mods[0]\n---\n<p>{m.v}</p>');
    expect(html).toBe("<p>42</p>");
  });

  it("keeps object keys named import/export", async () => {
    const source = '---\nconst labels = {\n  import: "Import",\n  export: "Export",\n}\n---\n<p>{labels.export}</p>';
    expect(await compileAndRender(source)).toBe("<p>Export</p>");
  });

  it.each([
    ["default + named", '---\nimport Card, { render as r } from "./Card.bangala"\n---\n<Card title={typeof r}/>', '<div class="card">function</div>'],
    ["{ default as X }", '---\nimport { default as Card } from "./Card.bangala"\n---\n<Card title="d"/>', '<div class="card">d</div>'],
    ["namespace", '---\nimport * as Card from "./Card.bangala"\n---\n<Card title="ns"/>', '<div class="card">ns</div>'],
    ["two imports on one line", '---\nimport { v } from "./side.js"; import Card from "./Card.bangala"\n---\n<Card title={v}/>', '<div class="card">42</div>'],
    ["no space before the specifier", '---\nimport Card from"./Card.bangala"\n---\n<Card title="ns"/>', '<div class="card">ns</div>'],
    ["no space after import", '---\nimport{ v } from "./side.js"\n---\n<p>{v}</p>', "<p>42</p>"],
    ["a side-effect import without space", '---\nimport"./side.js"\n---\n<p>{globalThis.__side}</p>', "<p>ok</p>"],
    ["an import sharing its line with render code", '---\nimport { sep } from "node:path"; const who = props.name\n---\n<p>{who}</p>', "<p>Ada</p>"],
    ["a multi-line import (K2)", '---\nimport {\n  join,\n  sep,\n} from "node:path"\nconst x = join("a", "b") + sep\n---\n<p>{x}</p>', "<p>a/b/</p>"],
    ["import attributes", '---\nimport data from "./data.json" with { type: "json" }\n---\n<p>{data.a}</p>', "<p>json-ok</p>"],
    ["import.meta", "---\nconst u = typeof import.meta.url\n---\n<p>{u}</p>", "<p>string</p>"],
    ["a dynamic .bangala import", '---\nconst { default: Card } = await import("./Card.bangala")\n---\n<p>{typeof Card.render}</p>', "<p>function</p>"],
  ])("supports %s", async (_name, source, expected) => {
    expect((await project(source, { name: "Ada" })).html).toBe(expected);
  });

  it("lists every imported .bangala file as a dependency", () => {
    const deps = (source: string) => compile(source, { filename: "p.bangala" }).dependencies;
    expect(deps('---\nimport Card from "./Card.bangala"\nconst html = await Card.render({})\n---\n<div>{html}</div>')).toEqual(["./Card.bangala"]);
    expect(deps('---\nimport "./Setup.bangala"\n---\n<p>x</p>')).toEqual(["./Setup.bangala"]);
  });

  it("explains a component imported from a non-.bangala module", () => {
    expect(() => compile('---\nimport Counter from "./Counter.js"\n---\n<Counter client:load/>', { filename: "p.bangala" }))
      .toThrow(/<Counter> is imported from "\.\/Counter\.js"; components must be default imports of \.bangala files/);
  });
});

describe("frontmatter exports", () => {
  it("does not export text inside template literals or comments", async () => {
    const fromString = await project("---\nconst sample = `\nexport const answer = 42\n`\n---\n<pre>{sample}</pre>");
    expect(fromString.html).toBe("<pre>\nexport const answer = 42\n</pre>");
    expect("answer" in fromString.mod).toBe(false);
    const fromComment = await project("---\n/*\nexport const answer = 42\n*/\n---\n<p>x</p>");
    expect(fromComment.html).toBe("<p>x</p>");
    expect("answer" in fromComment.mod).toBe(false);
  });

  it.each([
    ["export interface", "---\nexport interface Props {\n  title: string\n}\nconst { title } = props as Props\n---\n<h1>{title}</h1>", "<h1>T</h1>"],
    ["export type", "---\nexport type Props = {\n  title: string\n}\nconst { title } = props as Props\n---\n<h1>{title}</h1>", "<h1>T</h1>"],
    ["export enum", '---\nexport enum Color {\n  Red = "red",\n  Blue = "blue",\n}\n---\n<p>{Color.Red}</p>', "<p>red</p>"],
    ["export abstract class", "---\nexport abstract class Base {\n  x = 1\n}\nclass D extends Base {}\nconst d = new D()\n---\n<p>{d.x}</p>", "<p>1</p>"],
    ["a regex with { in an exported function", '---\nexport function stripOpen(s: string) {\n  return s.replace(/{/g, "")\n}\nconst name = stripOpen(props.title)\n---\n<p>{name}</p>', "<p>T</p>"],
    ["a } in a comment of an exported function", "---\nexport function double(n) {\n  // returns n } doubled\n  return n * 2\n}\n---\n<p>{double(2)}</p>", "<p>4</p>"],
    ["a { in a trailing comment of an exported function", "---\nexport function f() { // {\n  return 1\n}\nconst t = props.title\n---\n<p>{t}{f()}</p>", "<p>T1</p>"],
    ["a { in a string of an exported function", '---\nexport function br(n) {\n  const open = "{"\n  return open + n\n}\nconst z = br(2)\n---\n<p>{z}</p>', "<p>{2</p>"],
    ["TS overloads", '---\nexport function f(a: string): string\nexport function f(a: any) {\n  return a\n}\n---\n<p>{f("z")}</p>', "<p>z</p>"],
    ["a multi-line TS union", '---\nexport type U =\n  | "a"\n  | "b"\nconst u: U = "a"\n---\n<p>{u}</p>', "<p>a</p>"],
    ["continuation lines", "---\nexport const xs = [3, 1, 2]\n  .sort()\n  .map(String)\nconst y = 1\n---\n<p>{xs.join()}{y}</p>", "<p>1,2,31</p>"],
    ["a multi-line export const (K3)", "---\nexport const x = {\n  a: 1,\n}\n---\n<p>{x.a}</p>", "<p>1</p>"],
    ["a trailing comment after an export", "---\nexport const x = 1 // c\nconst y = x + 1\n---\n<p>{y}</p>", "<p>2</p>"],
  ])("hoists %s whole", async (_name, source, expected) => {
    expect((await project(source, { title: "T" })).html).toBe(expected);
  });

  it("runs an IIFE following an exported function at render time", async () => {
    const source = "---\nexport function f() {\n  return 2\n}\n(async () => { globalThis.__iife = (globalThis.__iife ?? 0) + 1 })()\n---\n<p>{f()}</p>";
    const before = (globalThis as { __iife?: number }).__iife ?? 0;
    const { html } = await project(source);
    expect(html).toBe("<p>2</p>");
    expect((globalThis as { __iife?: number }).__iife).toBe(before + 1);
  });

  it("exports getStaticPaths with a multi-line signature", async () => {
    const source = "---\nexport function getStaticPaths(\n  { limit } = {}\n) {\n  return [{ params: { slug: 'x' } }].slice(0, limit ?? 10)\n}\n---\n<p>{props.params.slug}</p>";
    const { html, mod } = await project(source, { params: { slug: "x" } });
    expect(html).toBe("<p>x</p>");
    expect(await (mod.getStaticPaths as () => unknown)()).toEqual([{ params: { slug: "x" } }]);
  });

  it("exports getStaticPaths with a multi-line TS return type", async () => {
    const source = '---\nexport async function getStaticPaths(): Promise<\n  { params: { slug: string } }[]\n> {\n  return [{ params: { slug: "x" } }]\n}\nconst s: string = props.params.slug\n---\n<p>{s}</p>';
    expect((await project(source, { params: { slug: "x" } })).html).toBe("<p>x</p>");
  });

  it("re-exports .bangala modules with rewritten specifiers", async () => {
    const source = '---\nexport { default as Card } from "./Card.bangala"\n---\n<p>x</p>';
    const { html, mod, code } = await project(source);
    expect(html).toBe("<p>x</p>");
    expect(typeof (mod.Card as Component).render).toBe("function");
    expect(code).toContain('from "./Card.js"');
    expect(compile(source, { filename: "p.bangala" }).dependencies).toEqual(["./Card.bangala"]);
  });

  it("allows an export list naming an import", async () => {
    const { html, mod } = await project('---\nimport { v } from "./side.js"\nexport { v }\n---\n<p>{v}</p>');
    expect(html).toBe("<p>42</p>");
    expect(mod.v).toBe(42);
  });

  it("rejects exports the compiled module defines itself, with a location", () => {
    expect(parseError("---\nexport default function helper() {\n  return 1\n}\n---\n<p>x</p>").message)
      .toMatch(/^'export default' is not allowed in frontmatter.*\(line 2, column 1\)$/);
    expect(parseError('---\nexport default { title: "x" }\n---\n<p>x</p>').message).toMatch(/export default/);
    expect(parseError("---\nexport const render = 1\n---\n<p>x</p>").message).toMatch(/Exporting 'render'/);
  });

  it("rejects an export list naming a frontmatter local (esbuild would drop it silently)", () => {
    const err = parseError('---\nconst getStaticPaths = async () => [{ params: { slug: "a" } }]\nexport { getStaticPaths }\n---\n<p>x</p>');
    expect(err.message).toMatch(/not declared at module scope.*\(line 3, column 1\)$/);
  });
});

describe("frontmatter text is preserved (issue #2)", () => {
  it("keeps multi-line template literals intact", async () => {
    const source = "---\nconst s = `a\n  b\nc`\n---\n<pre>{s}</pre>";
    expect(await compileAndRender(source)).toBe("<pre>a\n  b\nc</pre>");
    expect(compile(source, { filename: "p.bangala" }).code).toContain("const s = `a\n  b\nc`");
  });

  it("keeps backslash line continuations intact", async () => {
    expect(await compileAndRender('---\nconst msg = "Hello \\\nworld"\n---\n<p>{msg}</p>')).toBe("<p>Hello world</p>");
  });

  it("supports TypeScript generics, casts and non-null assertions", async () => {
    expect(await compileAndRender('---\nconst xs: Array<{ a: string }> = [{ a: "q" }]\nconst y = xs.map((x) => x.a as string)\n---\n<p>{y}</p>')).toBe("<p>q</p>");
    expect(await compileAndRender("---\nconst n = props.count! / 2 / 1\n---\n<p>{n}</p>", { count: 8 })).toBe("<p>4</p>");
  });

  it("supports Unicode identifiers and nested templates", async () => {
    expect(await compileAndRender('---\nconst entrée = `${`${"x"}`}`\n---\n<p>{entrée}</p>')).toBe("<p>x</p>");
  });
});

describe("generated identifiers cannot be shadowed", () => {
  const xss = "<svg onload=alert`1`>";

  it.each([
    ["a local escape() helper", '---\nfunction escape(s) {\n  return String(s).replace(/[.*+?^${}()[\\]\\\\]/g, "\\\\$&")\n}\nconst re = new RegExp(escape(props.q))\n---\n<p>Hello {props.name}</p>', { q: "a.b", name: xss }, "<p>Hello &lt;svg onload=alert`1`&gt;</p>"],
    ["an imported escape", '---\nimport escape from "./sql.js"\n---\n<p>{props.name}</p>', { name: xss }, "<p>&lt;svg onload=alert`1`&gt;</p>"],
    ["a named escape import", '---\nimport { escape } from "node:querystring"\n---\n<p>{props.name}</p>', { name: "<b>" }, "<p>&lt;b&gt;</p>"],
    ["a destructured escape prop", "---\nconst { escape, name } = props\n---\n<p>{name}</p>", { escape: (s: string) => s, name: "<b>bold</b>" }, "<p>&lt;b&gt;bold&lt;/b&gt;</p>"],
    ["an escape used in an attribute", "---\nconst escape = (s) => s\n---\n<a title={props.name}>x</a>", { name: '"><script>alert(1)</script>' }, '<a title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">x</a>'],
    ["an exported escape", "---\nexport function escape(s) { return s }\n---\n<p>{props.name}</p>", { name: "<b>" }, "<p>&lt;b&gt;</p>"],
    ["a boolean escape prop", "---\nconst { code, escape = true } = props\n---\n<pre>{code}</pre>", { code: "<b>x</b>", escape: true }, "<pre>&lt;b&gt;x&lt;/b&gt;</pre>"],
    ["a local named island", '---\nimport Counter from "./Counter.bangala"\nconst island = "Hawaii"\n---\n<p>{island}</p><Counter start={1} client:load/>', {}, '<p>Hawaii</p><bangala-island data-entry="./Counter" data-props="{&quot;start&quot;:1}" data-strategy="load"><button>1</button></bangala-island>'],
    ["a local named renderComponent", '---\nimport Counter from "./Counter.bangala"\nconst renderComponent = "x"\n---\n<p>{renderComponent}</p><Counter start={1}/>', {}, "<p>x</p><button>1</button>"],
    ["an each item named island", '---\nimport Counter from "./Counter.bangala"\n---\n{#each props.islands as island}<h2>{island.name}</h2><Counter start={2} client:visible/>{/each}', { islands: [{ name: "Goree" }] }, '<h2>Goree</h2><bangala-island data-entry="./Counter" data-props="{&quot;start&quot;:2}" data-strategy="visible"><button>2</button></bangala-island>'],
    ["an each item named escape", "{#each props.xs as escape}<li>{escape}</li>{/each}", { xs: ["<a>"] }, "<li>&lt;a&gt;</li>"],
    ["a component named Promise", '---\nimport Promise from "./Promise.bangala"\n---\n<Promise/>{#each [1] as x}<i>{x}</i>{/each}', {}, "<b>p</b><i>1</i>"],
    ["an imported render function", '---\nimport { render } from "./r.js"\nconst out = render("vnode")\n---\n<div>{out}</div>', {}, "<div>lib-render:string</div>"],
  ])("with %s", async (_name, source, props, expected) => {
    expect((await project(source, props)).html).toBe(expected);
  });

  it("reserves the generated module's identifiers", () => {
    expect(parseError("---\nconst $$bangala = {}\n---\n<p>x</p>").message).toMatch(/reserved/);
    expect(parseError("{#each props.xs as $$render}{/each}").message).toMatch(/reserved/);
  });
});

describe("slot content", () => {
  it("rejects a children prop on components", () => {
    const withIsland = '---\nimport Html from "./Html.bangala"\n---\n<Html children={props.bio} client:load/>';
    expect(() => compile(withIsland, { filename: "p.bangala" })).toThrow(/'children' prop is reserved/);
    expect(() => compile(withIsland.replace(" client:load", ""), { filename: "p.bangala" })).toThrow(/'children' prop is reserved/);
  });

  it("never renders an island's children prop as HTML", async () => {
    const Html: Component = { render: (p) => `<div class="box">${p.children ?? ""}</div>` };
    const html = await island(Html, { children: "<img src=x onerror=alert(1)>" }, "./Html", "client:load");
    expect(html).toBe('<bangala-island data-entry="./Html" data-props="{}" data-strategy="load"><div class="box"></div></bangala-island>');
  });

  it("accepts whitespace between the tags of an island", () => {
    const result = compile('---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:load>\n</Counter>', { filename: "p.bangala" });
    expect(result.islands).toHaveLength(1);
  });
});

describe("static attributes", () => {
  it("keeps character references and escapes bare ampersands", async () => {
    expect(await compileAndRender('<a href="/s?a=1&amp;b=2" title="Fish &amp; Chips">x</a><b title="Fish & Chips"></b>'))
      .toBe('<a href="/s?a=1&amp;b=2" title="Fish &amp; Chips">x</a><b title="Fish &amp; Chips"></b>');
    const meta = '<meta name="copyright" content="&copy; 2026 Kaps"><div data-props="{&quot;start&quot;:1}"></div>';
    expect(await compileAndRender(meta)).toBe(meta);
  });

  it("decodes character references in static component props", async () => {
    expect((await project('---\nimport Card from "./Card.bangala"\n---\n<Card title="Fish &amp; Chips &#38; &#x26;"/>')).html)
      .toBe('<div class="card">Fish &amp; Chips &amp; &amp;</div>');
  });
});

describe("runtime each()", () => {
  it("renders any iterable in order", async () => {
    expect(await each(new Set([1, 2]), async (x) => String(x))).toBe("12");
  });
});

describe("template expressions", () => {
  it.each([
    ["a } in a string (K5)", '<p>{"}"}</p>', {}, "<p>}</p>"],
    ["a { in a string", '<p>{"{"}</p><p>{props.x}</p>', { x: 1 }, "<p>{</p><p>1</p>"],
    ["a { in a regex", '<p>{props.s.replace(/\\{/g, "")}</p>', { s: "{a" }, "<p>a</p>"],
    ["a } in a comment", "<p>{props.x /* } */}</p>", { x: 1 }, "<p>1</p>"],
    ["a } in an {#if} header", '{#if props.s === "}"}yes{/if}', { s: "}" }, "yes"],
    ["a } in a dynamic attribute", '<a title={"}"}>x</a>', {}, '<a title="}">x</a>'],
    ["an expression starting with a regex", '<p>{/^\\d+$/.test(props.code) ? "num" : "alpha"}</p>', { code: "42" }, "<p>num</p>"],
    ["a comment-only expression", "<div>{/* TODO */}<p>x</p></div>{/* top */}", {}, "<div><p>x</p></div>"],
    ["line comments in multi-line expressions", "<p>{props.x // fallback\n}</p><p class={props.c // c\n}>t</p>{#if props.a // show\n}A{/if}", { x: 1, c: "k", a: true }, '<p>1</p><p class="k">t</p>A'],
    ["a line comment holding balanced braces", "<p>{props.x // keep {}\n}</p>", { x: 1 }, "<p>1</p>"],
    ["a line comment in an {#each} list", "{#each props.xs // list\n as x}<i>{x}</i>{/each}", { xs: [1] }, "<i>1</i>"],
  ])("handles %s", async (_name, source, props, expected) => {
    expect(await compileAndRender(source, props)).toBe(expected);
  });

  it("handles a line comment in a component prop", async () => {
    expect((await project('---\nimport Card from "./Card.bangala"\n---\n<Card title={props.t // c\n}/>', { t: "T" })).html)
      .toBe('<div class="card">T</div>');
  });

  it("rejects a // comment that hides the closing brace", () => {
    expect(parseError("<p>{props.x // fallback}</p>\n<p>{props.y}</p>").message)
      .toBe("A // comment hides the closing '}' of this expression: use /* … */ instead (line 1, column 13)");
    expect(parseError("<a title={props.t // c}>x</a>").message).toMatch(/^A \/\/ comment hides/);
  });

  it("rejects empty expressions", () => {
    expect(parseError("<p>{}</p>").message).toBe("Empty expression (line 1, column 4)");
    expect(parseError("<p>{ }</p>").message).toBe("Empty expression (line 1, column 4)");
    expect(parseError("<p title={ }>x</p>").message).toMatch(/^Empty expression in attribute 'title'/);
  });

  it("reports an unclosed brace at the brace, even with quotes later on", () => {
    expect(parseError("<p>{props.a</p>\n<p>it's</p>\n<p>c</p>").message).toBe("Unclosed '{' (line 1, column 4)");
  });
});

describe("{#each}", () => {
  it.each([
    ["a non-ASCII item name", "{#each props.articles as entrée}<li>{entrée}</li>{/each}", { articles: ["a"] }, "<li>a</li>"],
    ["a $-prefixed item name", "{#each props.items as $item}<li>{$item}</li>{/each}", { items: ["a"] }, "<li>a</li>"],
    ["a multi-line list", "{#each props.posts\n  .filter((p) => p.ok)\n  .slice(0, 2) as post}<li>{post.t}</li>{/each}", { posts: [{ ok: true, t: "A" }, { ok: false, t: "B" }] }, "<li>A</li>"],
    ["a TS cast in the list", "{#each (props.xs as string[]) as x}<i>{x}</i>{/each}", { xs: ["a"] }, "<i>a</i>"],
  ])("supports %s", async (_name, source, props, expected) => {
    expect(await compileAndRender(source, props)).toBe(expected);
  });

  it("explains unsupported item forms", () => {
    expect(parseError("{#each props.xs as class}{class}{/each}").message).toMatch(/'class' is a reserved word/);
    expect(parseError("{#each xs as item, i}{/each}").message).toMatch(/index in \{#each\} is not supported/);
    expect(parseError("{#each xs as { a }}{/each}").message).toMatch(/Destructuring in \{#each\} is not supported/);
    expect(parseError("{#each xs}{/each}").message).toMatch(/must be '\{#each <list> as <item>\}'/);
  });
});

describe("block tokens", () => {
  it("tolerates whitespace inside block tokens", async () => {
    expect(await compileAndRender("{#if props.a}A{/if }", { a: true })).toBe("A");
    expect(await compileAndRender("{#if props.a}A{:else }B{/ if}", { a: false })).toBe("B");
    expect(await compileAndRender("{#each props.xs as x}{x}{/each }", { xs: [1] })).toBe("1");
  });

  it("explains unsupported or misplaced block tokens", () => {
    expect(parseError("{#if props.a}A{:else if props.b}B{:else}C{/if}").message)
      .toBe("{:else if} is not supported: nest an {#if} block inside {:else} (line 1, column 15)");
    expect(parseError("<p>{:else}</p>").message).toMatch(/^Unexpected '\{:else\}' inside <p>/);
    expect(parseError("{:else}").message).toMatch(/^Unexpected \{:else\} outside of an \{#if\} block/);
    expect(parseError("{#each props.items as i}{i}{:else}empty{/each}").message).toMatch(/\{:else\} is not supported inside \{#each\}/);
    expect(parseError("{#if a}x{/each}").message).toMatch(/^Unexpected '\{\/each\}': expected \{\/if\}/);
    expect(parseError("{#iff props.a}A{/if}").message).toMatch(/^Unknown block '\{#iff\}'/);
    expect(parseError("{#snippet foo}x{/snippet}").message).toMatch(/^Unknown block '\{#snippet\}'/);
    expect(parseError("{@html x}").message).toMatch(/'\{@html\}' is not supported/);
    expect(parseError("{#if props.a}\n  <p>a</p>\n  <p>b</p>").message).toBe("Unclosed {#if} (line 1, column 1)");
  });
});

describe("closing tags", () => {
  it.each([
    ["whitespace before >", "<div>t</div >", "<div>t</div>"],
    ["a line break before >", '<div\n  class="a"\n>t</div\n>', '<div class="a">t</div>'],
    ["a different case", "<div>t</DIV>", "<div>t</div>"],
    ["an uppercase raw-text close", "<script>a()</SCRIPT>", "<script>a()</script>"],
  ])("accepts %s", async (_name, source, expected) => {
    expect(await compileAndRender(source)).toBe(expected);
  });
});
