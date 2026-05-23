import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

describe("docs home page", () => {
  it("compiles the bangala homepage", async () => {
    const source = await readFile(new URL("../docs/index.bangala", import.meta.url), "utf8");
    const result = compile(source, { filename: "docs/index.bangala" });

    expect(result.code).toContain('import Layout from "./components/Layout.js"');
    expect(result.code).toContain("HTML-first");
    expect(result.islands).toEqual([]);
  });
});
