import { describe, it, expect } from "vitest";
import { parse } from "../src/parser.js";
import { extractImports } from "../src/imports.js";
import { analyze } from "../src/analyzer.js";

function analyzeSource(source: string) {
  const tpl = parse(source);
  const { components } = extractImports(tpl.frontmatter);
  return analyze(tpl, components);
}

describe("analyze", () => {
  it("collects island references with their component path", () => {
    const result = analyzeSource(
      `---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:load/>`,
    );
    expect(result.islands).toEqual([
      { componentPath: "./Counter.bangala", strategy: "client:load" },
    ]);
  });

  it("reports .bangala dependencies", () => {
    const result = analyzeSource(
      `---\nimport Counter from "./Counter.bangala"\n---\n<Counter/>`,
    );
    expect(result.dependencies).toEqual(["./Counter.bangala"]);
  });

  it("errors when a component tag has no matching import", () => {
    expect(() => analyzeSource("<Mystery/>")).toThrow(/<Mystery> is not imported/);
  });

  it("errors when an island component has children", () => {
    expect(() =>
      analyzeSource(
        `---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:load>x</Counter>`,
      ),
    ).toThrow(/island.*children/i);
  });
});
