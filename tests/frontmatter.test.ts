import { describe, it, expect } from "vitest";
import {
  analyzeFrontmatter,
  moduleStatements,
  renderStatements,
} from "../src/frontmatter.js";

function model(source: string) {
  const m = analyzeFrontmatter(source);
  return { ...m, module: moduleStatements(m), render: renderStatements(m) };
}

describe("analyzeFrontmatter — imports", () => {
  it("hoists imports and rewrites .bangala specifiers to .js", () => {
    const m = model(`import Layout from "./Layout.bangala"\nconst x = 1`);
    expect(m.module).toEqual([`import Layout from "./Layout.js"`]);
    expect(m.render).toBe(";\nconst x = 1");
  });

  it("records .bangala components by local name and original path", () => {
    const m = model(`import Counter from "../c/Counter.bangala"`);
    expect(m.components).toEqual([{ name: "Counter", path: "../c/Counter.bangala" }]);
    expect(m.dependencies).toEqual(["../c/Counter.bangala"]);
  });

  it("leaves non-.bangala imports intact and untracked", () => {
    const m = model(`import { db } from "./db"`);
    expect(m.module).toEqual([`import { db } from "./db"`]);
    expect(m.components).toEqual([]);
    expect(m.dependencies).toEqual([]);
  });

  it("hoists a multi-line import as one statement (K2)", () => {
    const m = model(`import {\n  join,\n  sep,\n} from "node:path"\nconst x = join("a", "b")`);
    expect(m.module).toEqual([`import {\n  join,\n  sep,\n} from "node:path"`]);
    expect(m.render).toBe(`;\n\n\n\nconst x = join("a", "b")`);
  });

  it("recognises imports in CRLF files", () => {
    const m = model(`import { a } from "./a.js"\r\nimport Card from "./Card.bangala"\r\nconst x = a\r\n`);
    expect(m.module).toEqual([`import { a } from "./a.js"`, `import Card from "./Card.js"`]);
    expect(m.components).toEqual([{ name: "Card", path: "./Card.bangala" }]);
  });

  it("supports every import clause form", () => {
    const m = model([
      `import Card, { render as r } from "./Card.bangala"`,
      `import { default as Box } from "./Box.bangala"`,
      `import * as Ns from "./Ns.bangala"`,
      `import type { T } from "./Types.bangala"`,
      `import{ v }from"./side.js"; import "./side-effect.js"`,
      `import data from "./data.json" with { type: "json" }`,
    ].join("\n"));
    expect(m.components).toEqual([
      { name: "Card", path: "./Card.bangala" },
      { name: "Box", path: "./Box.bangala" },
      { name: "Ns", path: "./Ns.bangala" },
    ]);
    expect(m.module).toHaveLength(7);
    expect(m.module[5]).toBe(`import "./side-effect.js"`);
    expect(m.module[6]).toBe(`import data from "./data.json" with { type: "json" }`);
    expect(m.render.trim()).toBe(";\n;\n;\n;\n; ;\n;");
  });

  it("only hoists the import statement, not code sharing its line", () => {
    const m = model(`import { sep } from "node:path"; const who = props.name`);
    expect(m.module).toEqual([`import { sep } from "node:path";`]);
    expect(m.render).toBe("; const who = props.name");
  });

  it("ignores import-like text in strings, templates and comments", () => {
    const m = model([
      "const sample = `",
      `import Card from "./Card.bangala"`,
      "`",
      "/*",
      `import Old from "./Old.bangala"`,
      "*/",
      `const s = "x\\`,
      `import y from 'y'"`,
    ].join("\n"));
    expect(m.module).toEqual([]);
    expect(m.dependencies).toEqual([]);
  });

  it("keeps dynamic import() and import.meta in render, rewriting .bangala literals", () => {
    const m = model(`const { default: Card } = await import("./Card.bangala")\nconst u = import.meta.url`);
    expect(m.module).toEqual([]);
    expect(m.render).toBe(`const { default: Card } = await import("./Card.js")\nconst u = import.meta.url`);
    expect(m.dependencies).toEqual(["./Card.bangala"]);
  });
});

describe("analyzeFrontmatter — exports", () => {
  it("hoists multi-line export declarations whole (K3)", () => {
    const m = model(`export const x = {\n  a: 1,\n}\nconst y = 2`);
    expect(m.module).toEqual([`export const x = {\n  a: 1,\n}`]);
    expect(m.render).toBe(";\n\n\nconst y = 2");
  });

  it("is not fooled by braces in strings, comments and regexes (K4)", () => {
    const source = [
      "export function f() {",
      "  // returns } early?",
      "  return '}' + \"{\" + /{/.source",
      "}",
      "const y = 1",
    ].join("\n");
    const m = model(source);
    expect(m.module).toEqual([source.slice(0, source.indexOf("\nconst y"))]);
    expect(m.render.endsWith("const y = 1")).toBe(true);
  });

  it("hoists multi-line TypeScript declarations", () => {
    const m = model([
      "export interface Props {",
      "  title: string",
      "}",
      "export type U =",
      "  | \"a\"",
      "  | \"b\"",
      "export enum Color {",
      "  Red = \"red\",",
      "}",
      "const { title } = props as Props",
    ].join("\n"));
    expect(m.module).toEqual([
      "export interface Props {\n  title: string\n}",
      "export type U =\n  | \"a\"\n  | \"b\"",
      "export enum Color {\n  Red = \"red\",\n}",
    ]);
    expect(m.render.endsWith("const { title } = props as Props")).toBe(true);
  });

  it("ends a block declaration at its closing brace", () => {
    const m = model("export function f() {\n  return 2\n}\n(async () => {})()");
    expect(m.module).toEqual(["export function f() {\n  return 2\n}"]);
    expect(m.render).toBe(";\n\n\n(async () => {})()");
  });

  it("follows continuation lines of an exported expression", () => {
    const m = model("export const xs = [3, 1, 2]\n  .sort()\n  .map(String)\nconst y = 1");
    expect(m.module).toEqual(["export const xs = [3, 1, 2]\n  .sort()\n  .map(String)"]);
  });

  it("ignores export-like text in strings, comments and object keys", () => {
    const m = model("const s = `\nexport const a = 1\n`\n/*\nexport const b = 2\n*/\nconst o = {\n  export: 1,\n}");
    expect(m.module).toEqual([]);
  });

  it("rewrites .bangala specifiers in re-exports", () => {
    const m = model(`export { default as Card } from "./Card.bangala"`);
    expect(m.module).toEqual([`export { default as Card } from "./Card.js"`]);
    expect(m.dependencies).toEqual(["./Card.bangala"]);
  });

  it("rejects export default and exporting render", () => {
    expect(() => model("export default { a: 1 }")).toThrow(/export default/);
    expect(() => model("export const render = 1")).toThrow(/Exporting 'render'/);
    expect(() => model("export function render() {}")).toThrow(/Exporting 'render'/);
    expect(() => model("const x = 1\nexport { x as default }")).toThrow(/Exporting 'default'/);
  });

  it("rejects export lists naming frontmatter locals", () => {
    expect(() => model("const getStaticPaths = () => []\nexport { getStaticPaths }"))
      .toThrow(/not declared at module scope/);
  });

  it("allows export lists naming imports and exported declarations", () => {
    const m = model(`import { v } from "./side.js"\nexport { v }`);
    expect(m.module).toEqual([`import { v } from "./side.js"`, "export { v }"]);
  });

  it("reports the offset of a rejected statement", () => {
    try {
      model("const a = 1\nexport default a");
      expect.unreachable();
    } catch (error) {
      expect((error as { offset: number }).offset).toBe(12);
    }
  });

  it("reserves the generated module's own identifiers", () => {
    expect(() => model("const $$bangala = 1")).toThrow(/reserved/);
    expect(() => model("function $$render() {}")).toThrow(/reserved/);
  });
});

describe("analyzeFrontmatter — render code", () => {
  it("keeps the frontmatter byte for byte (issue #2)", () => {
    const source = "const s = `a\n  b\nc`\nconst msg = \"Hello \\\nworld\"";
    expect(model(source).render).toBe(source);
  });
});
