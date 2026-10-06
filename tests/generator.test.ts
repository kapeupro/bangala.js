import { describe, it, expect } from "vitest";
import { parse } from "../src/parser.js";
import { analyzeFrontmatter } from "../src/frontmatter.js";
import { generate } from "../src/generator.js";

function gen(source: string): string {
  const tpl = parse(source);
  return generate(tpl, analyzeFrontmatter(tpl.frontmatter), { filename: "test.bangala" });
}

describe("generate", () => {
  it("emits a module exporting render (named + default)", () => {
    const code = gen("<p>hello</p>");
    expect(code).toContain("async function $$render(props)");
    expect(code).toContain("export { $$render as render };");
    expect(code).toContain("export default { render: $$render };");
  });

  it("escapes interpolated expressions through the namespaced runtime", () => {
    expect(gen("{name}")).toContain("${$$bangala.escape((name))}");
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
    expect(code).toContain(`await $$bangala.island(Counter, {"start": (1)}, "./Counter", "client:load")`);
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
    expect(code).toContain("async function $$render(props)");
    expect(code.indexOf("export async function getStaticPaths()")).toBeLessThan(
      code.indexOf("async function $$render(props)"),
    );
    expect(code).toContain("\nconst title = \"Post\"\n");
  });

  it("escapes static attribute values for HTML attributes and JS template literals", () => {
    const code = gen(`<div data-props="{&quot;name&quot;:&quot;Ada&quot;}" data-template="\${x}" title="Fish & Chips"></div>`);

    expect(code).toContain('data-props="{&quot;name&quot;:&quot;Ada&quot;}"');
    expect(code).toContain('title="Fish &amp; Chips"');
    expect(code).toContain('data-template="\\${x}"');
  });
});
