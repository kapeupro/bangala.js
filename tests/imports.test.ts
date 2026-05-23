import { describe, it, expect } from "vitest";
import { extractImports } from "../src/imports.js";

describe("extractImports", () => {
  it("hoists imports and rewrites .bangala specifiers to .js", () => {
    const result = extractImports(
      `import Layout from "./Layout.bangala"\nconst x = 1`,
    );
    expect(result.imports).toEqual([`import Layout from "./Layout.js"`]);
    expect(result.body).toBe("const x = 1");
  });

  it("records .bangala components by local name and original path", () => {
    const result = extractImports(`import Counter from "../c/Counter.bangala"`);
    expect(result.components).toEqual([
      { name: "Counter", path: "../c/Counter.bangala" },
    ]);
  });

  it("leaves non-.bangala imports intact and untracked", () => {
    const result = extractImports(`import { db } from "./db"`);
    expect(result.imports).toEqual([`import { db } from "./db"`]);
    expect(result.components).toEqual([]);
  });
});
