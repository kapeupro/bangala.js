import { describe, it, expect } from "vitest";
import { parse } from "../src/parser.js";
import { extractImports } from "../src/imports.js";
import { generate } from "../src/generator.js";
import { compileAndRender } from "./helpers.js";

function gen(source: string): string {
  const tpl = parse(source);
  const { components } = extractImports(tpl.frontmatter);
  return generate(tpl, components, { filename: "test.bangala" });
}

describe("generate", () => {
  it("emits a module exporting render (named + default)", () => {
    const code = gen("<p>hello</p>");
    expect(code).toContain("async function render(props)");
    expect(code).toContain("export { render };");
    expect(code).toContain("export default { render };");
  });

  it("escapes interpolated expressions", () => {
    expect(gen("{name}")).toContain("${escape(name)}");
  });

  it("emits void elements without closing tags", () => {
    expect(gen(`<meta charset="UTF-8"/><link rel="stylesheet" href="/home.css"/>`)).toContain(
      `<meta charset="UTF-8"><link rel="stylesheet" href="/home.css">`,
    );
  });

  it("emits an island() call for an island component", () => {
    const code = gen(
      `---\nimport Counter from "./Counter.bangala"\n---\n<Counter start={1} client:load/>`,
    );
    expect(code).toContain(`await island(Counter, {"start": 1}, "./Counter", "client:load")`);
  });

  it("keeps exported frontmatter declarations at module scope", () => {
    const code = gen([
      "---",
      "export async function getStaticPaths() {",
      "  return [{ params: { slug: \"hello\" } }]",
      "}",
      "const title = \"Post\"",
      "---",
      "<h1>{title}</h1>",
    ].join("\n"));

    expect(code).toContain("export async function getStaticPaths()");
    expect(code).toContain("async function render(props)");
    expect(code.indexOf("export async function getStaticPaths()")).toBeLessThan(
      code.indexOf("async function render(props)"),
    );
    expect(code).toContain("  const title = \"Post\"");
  });

  it("preserves multiline template literal values in frontmatter", async () => {
    const html = await compileAndRender([
      "---",
      "const greeting = `Hello",
      "World`",
      "---",
      "<pre>{greeting}</pre>",
    ].join("\n"));

    expect(html).toBe("<pre>Hello\nWorld</pre>");
  });

  it("escapes static attribute values for HTML attributes and JS template literals", () => {
    const code = gen(`<div data-props="{&quot;name&quot;:&quot;Ada&quot;}" data-template="\${x}"></div>`);

    expect(code).toContain('data-props="{&amp;quot;name&amp;quot;:&amp;quot;Ada&amp;quot;}"');
    expect(code).toContain('data-template="\\${x}"');
  });
});
