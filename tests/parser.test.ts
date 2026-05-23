import { describe, it, expect } from "vitest";
import { parse } from "../src/parser.js";

describe("parse — frontmatter", () => {
  it("extracts the frontmatter block", () => {
    const tpl = parse("---\nconst x = 1\n---\nhello");
    expect(tpl.frontmatter).toBe("const x = 1");
  });

  it("returns empty frontmatter when there is none", () => {
    const tpl = parse("hello");
    expect(tpl.frontmatter).toBe("");
    expect(tpl.nodes).toEqual([{ type: "Text", value: "hello" }]);
  });
});
