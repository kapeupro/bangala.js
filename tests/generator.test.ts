import { describe, it, expect } from "vitest";
import { parse } from "../src/parser.js";
import { extractImports } from "../src/imports.js";
import { generate } from "../src/generator.js";

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

  it("emits an island() call for an island component", () => {
    const code = gen(
      `---\nimport Counter from "./Counter.bangala"\n---\n<Counter start={1} client:load/>`,
    );
    expect(code).toContain(`await island(Counter, {"start": 1}, "./Counter", "client:load")`);
  });
});
