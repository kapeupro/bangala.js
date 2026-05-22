# bangala.js Compiler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `.bangala` compiler — a function `compile(source, options)` that turns a `.bangala` source string into an executable ESM module that server-renders to HTML and marks islands.

**Architecture:** Three-stage pipeline — `parse` (source → AST) → `analyze` (resolve components, detect islands, validate) → `generate` (AST → ESM module using template-literal concatenation). A small server runtime (`escape`, `renderComponent`, `island`) is imported by the generated code.

**Tech Stack:** TypeScript, ESM, Node 24, Vitest (tests), esbuild (transpile generated module for render tests).

**Spec:** `docs/superpowers/specs/2026-05-22-bangala-compiler-design.md`

**Plan-level refinements of the spec** (consistency fixes locked in during planning):
- The generated module exports **both** `export { render }` (named — for `compile()` consumers) and `export default { render }` (for component default-imports). Spec §4.2 only mentioned the named export.
- The runtime `island()` helper takes **4 arguments**: `island(Comp, props, entry, strategy)`. Spec §3.3's example showed 3; the `entry` (module path) is required to write `data-entry`.
- Components are imported with **default imports** (`import Counter from "..."`), as written in the user's frontmatter. The compiled module's default export is the component object `{ render }`.
- **v1 limitation:** `import` statements in the frontmatter must be single-line. Multi-line imports are out of scope.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Project scaffold. |
| `src/types.ts` | AST node types + public interfaces (`CompileResult`, `IslandRef`, `CompileOptions`). No behavior. |
| `src/runtime.ts` | Server runtime: `escape`, `renderComponent`, `island`. Imported by generated code as `bangala/runtime`. |
| `src/parser.ts` | `parse(source, filename) → Template`. Custom scanner for HTML + `{}` + blocks. |
| `src/imports.ts` | `extractImports(frontmatter) → { imports, body, components }`. Line-based import hoisting + `.bangala`→`.js` rewrite. |
| `src/analyzer.ts` | `analyze(template, components) → AnalyzedTemplate`. Resolves component tags, detects islands, validates. |
| `src/generator.ts` | `generate(template, analysis, options) → CompileResult`. AST → ESM module string. |
| `src/index.ts` | `compile(source, options)` — wires parse → imports → analyze → generate. Public entry point. |
| `tests/*.test.ts` | One test file per module + `render.test.ts` integration tests. |
| `tests/helpers.ts` | `compileAndRender()` — compile, transpile via esbuild, import, execute. |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "bangala",
  "version": "0.0.0",
  "type": "module",
  "description": "The full-stack framework that ships minimal JavaScript.",
  "license": "MIT",
  "exports": {
    ".": "./src/index.ts",
    "./runtime": "./src/runtime.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "esbuild": "^0.24.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold bangala compiler package"
```

---

## Task 2: AST and interface types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
// --- AST node types ---

export interface Attribute {
  name: string;
  /** Static text, or JS expression source if `dynamic` is true. */
  value: string;
  dynamic: boolean;
}

export interface TextNode {
  type: "Text";
  value: string;
}

export interface ExpressionNode {
  type: "Expression";
  /** Raw JS source between the braces. Not parsed. */
  code: string;
}

export interface ElementNode {
  type: "Element";
  tag: string;
  attributes: Attribute[];
  children: TemplateNode[];
}

export interface ComponentNode {
  type: "Component";
  name: string;
  attributes: Attribute[];
  children: TemplateNode[];
  island: boolean;
  strategy: "client:load" | null;
}

export interface IfBlockNode {
  type: "IfBlock";
  condition: string;
  then: TemplateNode[];
  otherwise: TemplateNode[] | null;
}

export interface EachBlockNode {
  type: "EachBlock";
  list: string;
  item: string;
  body: TemplateNode[];
}

export interface SlotNode {
  type: "Slot";
}

export type TemplateNode =
  | TextNode
  | ExpressionNode
  | ElementNode
  | ComponentNode
  | IfBlockNode
  | EachBlockNode
  | SlotNode;

export interface Template {
  frontmatter: string;
  nodes: TemplateNode[];
}

// --- Public compiler interfaces ---

export interface CompileOptions {
  filename: string;
}

export interface IslandRef {
  componentPath: string;
  strategy: "client:load";
}

export interface CompileResult {
  code: string;
  islands: IslandRef[];
  dependencies: string[];
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: AST and compiler interface types"
```

---

## Task 3: Server runtime — `escape`

**Files:**
- Create: `src/runtime.ts`
- Test: `tests/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { escape } from "../src/runtime.js";

describe("escape", () => {
  it("escapes HTML-significant characters", () => {
    expect(escape(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands and single quotes", () => {
    expect(escape("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("coerces non-strings to string", () => {
    expect(escape(42)).toBe("42");
    expect(escape(null)).toBe("null");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime.test.ts`
Expected: FAIL — cannot find module `../src/runtime.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime.ts
const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escape(value: unknown): string {
  return String(value).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "feat: runtime escape() for HTML output"
```

---

## Task 4: Server runtime — `renderComponent` and `island`

**Files:**
- Modify: `src/runtime.ts`
- Test: `tests/runtime.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/runtime.test.ts`:

```ts
import { renderComponent, island, type Component } from "../src/runtime.js";

const Greeting: Component = {
  render: (props) => `<p>Hi ${props.name}</p>`,
};

const Layout: Component = {
  render: (props) => `<main>${props.children ?? ""}</main>`,
};

describe("renderComponent", () => {
  it("renders a component with props", async () => {
    expect(await renderComponent(Greeting, { name: "Ada" })).toBe("<p>Hi Ada</p>");
  });

  it("passes rendered children into the slot", async () => {
    const html = await renderComponent(Layout, {}, async () => "<h1>Title</h1>");
    expect(html).toBe("<main><h1>Title</h1></main>");
  });
});

describe("island", () => {
  it("wraps SSR HTML in a bangala-island marker", async () => {
    const html = await island(Greeting, { name: "Ada" }, "components/Greeting", "client:load");
    expect(html).toBe(
      `<bangala-island data-entry="components/Greeting" ` +
      `data-props="{&quot;name&quot;:&quot;Ada&quot;}" ` +
      `data-strategy="load"><p>Hi Ada</p></bangala-island>`,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/runtime.test.ts`
Expected: FAIL — `renderComponent`, `island`, `Component` not exported.

- [ ] **Step 3: Add implementation to `src/runtime.ts`**

```ts
export interface Component {
  render(props: Record<string, unknown>): string | Promise<string>;
}

export async function renderComponent(
  Comp: Component,
  props: Record<string, unknown>,
  children?: () => string | Promise<string>,
): Promise<string> {
  const slot = children ? await children() : "";
  return Comp.render({ ...props, children: slot });
}

export async function island(
  Comp: Component,
  props: Record<string, unknown>,
  entry: string,
  strategy: string,
): Promise<string> {
  const html = await Comp.render(props);
  const serialized = escape(JSON.stringify(props));
  const strat = strategy.replace(/^client:/, "");
  return (
    `<bangala-island data-entry="${entry}" data-props="${serialized}" ` +
    `data-strategy="${strat}">${html}</bangala-island>`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runtime.test.ts`
Expected: PASS — all runtime tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "feat: runtime renderComponent() and island()"
```

---

## Task 5: Parser — frontmatter extraction and scanner skeleton

**Files:**
- Create: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — cannot find module `../src/parser.js`.

- [ ] **Step 3: Write `src/parser.ts`**

```ts
import type { Template, TemplateNode } from "./types.js";

export class ParseError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "ParseError";
  }
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function parse(source: string, _filename = "<unknown>"): Template {
  const fm = source.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = fm ? fm[1]!.trim() : "";
  const body = fm ? source.slice(fm[0].length) : source;
  const offset = fm ? fm[0].length : 0;
  const scanner = new Scanner(body, offset, source);
  const nodes = scanner.parseNodes(false);
  return { frontmatter, nodes };
}

class Scanner {
  private pos = 0;

  constructor(
    private src: string,
    private offset: number,
    private full: string,
  ) {}

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private error(message: string): never {
    const idx = this.offset + this.pos;
    let line = 1;
    let column = 1;
    for (let i = 0; i < idx && i < this.full.length; i++) {
      if (this.full[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new ParseError(message, line, column);
  }

  /** Parse nodes until a closing token. `nested` is true inside a block/element. */
  parseNodes(nested: boolean): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (!this.eof()) {
      if (this.startsWith("{/") || this.startsWith("{:") || this.startsWith("</")) {
        if (!nested) this.error("Unexpected closing token");
        break;
      }
      // Node parsers are added in later tasks.
      nodes.push(this.parseText());
    }
    return nodes;
  }

  private parseText(): TemplateNode {
    let value = "";
    while (!this.eof() && this.src[this.pos] !== "<" && this.src[this.pos] !== "{") {
      value += this.src[this.pos++];
    }
    if (value === "") this.error("Unexpected character");
    return { type: "Text", value };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser frontmatter extraction + scanner skeleton"
```

---

## Task 6: Parser — expressions

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("parse — expressions", () => {
  it("parses a {expression} into an Expression node", () => {
    expect(parse("Hi {user.name}!").nodes).toEqual([
      { type: "Text", value: "Hi " },
      { type: "Expression", code: "user.name" },
      { type: "Text", value: "!" },
    ]);
  });

  it("handles balanced braces inside an expression", () => {
    expect(parse("{ {a: 1}.a }").nodes).toEqual([
      { type: "Expression", code: " {a: 1}.a " },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — `{` is consumed as text / wrong node shape.

- [ ] **Step 3: In `parseNodes`, dispatch on `{` and add `parseExpression`**

In `parseNodes`, before the `parseText()` line, add:

```ts
      if (this.src[this.pos] === "{") {
        nodes.push(this.parseExpression());
        continue;
      }
```

Add the method to `Scanner`:

```ts
  /** Reads from `{` to its matching `}`, returns the inner source. */
  private readBraced(): string {
    if (this.src[this.pos] !== "{") this.error("Expected '{'");
    this.pos++;
    let depth = 1;
    let code = "";
    while (!this.eof()) {
      const ch = this.src[this.pos]!;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          this.pos++;
          return code;
        }
      }
      code += ch;
      this.pos++;
    }
    this.error("Unclosed '{'");
  }

  private parseExpression(): TemplateNode {
    return { type: "Expression", code: this.readBraced() };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — all parser tests so far.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser interpolation expressions"
```

---

## Task 7: Parser — HTML elements, attributes, comments

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("parse — elements", () => {
  it("parses an element with static and dynamic attributes", () => {
    expect(parse(`<div id="main" class={cls}>hi</div>`).nodes).toEqual([
      {
        type: "Element",
        tag: "div",
        attributes: [
          { name: "id", value: "main", dynamic: false },
          { name: "class", value: "cls", dynamic: true },
        ],
        children: [{ type: "Text", value: "hi" }],
      },
    ]);
  });

  it("parses a self-closing void element", () => {
    expect(parse("<br/>").nodes).toEqual([
      { type: "Element", tag: "br", attributes: [], children: [] },
    ]);
  });

  it("skips HTML comments", () => {
    expect(parse("a<!-- note -->b").nodes).toEqual([
      { type: "Text", value: "a" },
      { type: "Text", value: "b" },
    ]);
  });

  it("errors on an unclosed element", () => {
    expect(() => parse("<div>")).toThrow(/Unclosed <div>/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — `<` consumed as text.

- [ ] **Step 3: In `parseNodes`, dispatch on `<` and add tag parsing**

In `parseNodes`, before the `parseText()` line, add:

```ts
      if (this.startsWith("<!--")) {
        const end = this.src.indexOf("-->", this.pos);
        if (end === -1) this.error("Unclosed comment");
        this.pos = end + 3;
        continue;
      }
      if (this.src[this.pos] === "<") {
        nodes.push(this.parseTag());
        continue;
      }
```

Add to `Scanner` (component handling is finished in Task 8 — `parseTag` is added now and extended there):

```ts
  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private readName(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9:-]/.test(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) this.error("Expected a tag or attribute name");
    return this.src.slice(start, this.pos);
  }

  private parseAttributes(): { attributes: Attribute[]; selfClosing: boolean } {
    const attributes: Attribute[] = [];
    while (!this.eof()) {
      this.skipWhitespace();
      if (this.startsWith("/>")) {
        this.pos += 2;
        return { attributes, selfClosing: true };
      }
      if (this.src[this.pos] === ">") {
        this.pos++;
        return { attributes, selfClosing: false };
      }
      const name = this.readName();
      if (this.src[this.pos] === "=") {
        this.pos++;
        if (this.src[this.pos] === "{") {
          attributes.push({ name, value: this.readBraced(), dynamic: true });
        } else {
          const quote = this.src[this.pos];
          if (quote !== '"' && quote !== "'") this.error("Expected quoted attribute value");
          this.pos++;
          const end = this.src.indexOf(quote, this.pos);
          if (end === -1) this.error("Unclosed attribute value");
          attributes.push({ name, value: this.src.slice(this.pos, end), dynamic: false });
          this.pos = end + 1;
        }
      } else {
        // Valueless attribute / directive (e.g. client:load).
        attributes.push({ name, value: "", dynamic: false });
      }
    }
    this.error("Unclosed tag");
  }

  private parseTag(): TemplateNode {
    this.pos++; // consume "<"
    const tag = this.readName();
    const { attributes, selfClosing } = this.parseAttributes();
    const isComponent = /^[A-Z]/.test(tag);
    if (isComponent) {
      return this.finishComponent(tag, attributes, selfClosing);
    }
    if (selfClosing || VOID_ELEMENTS.has(tag)) {
      return { type: "Element", tag, attributes, children: [] };
    }
    const children = this.parseNodes(true);
    const close = `</${tag}>`;
    if (!this.startsWith(close)) this.error(`Unclosed <${tag}>`);
    this.pos += close.length;
    return { type: "Element", tag, attributes, children };
  }

  private finishComponent(
    tag: string,
    attributes: Attribute[],
    selfClosing: boolean,
  ): TemplateNode {
    // Replaced with full implementation in Task 8.
    void selfClosing;
    return { type: "Element", tag, attributes, children: [] };
  }
```

Add `Attribute` to the type import at the top of the file:

```ts
import type { Template, TemplateNode, Attribute } from "./types.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — all parser tests so far.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser HTML elements, attributes, comments"
```

---

## Task 8: Parser — components, island directive, slot

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("parse — components", () => {
  it("parses a self-closing component", () => {
    expect(parse(`<Counter start={3}/>`).nodes).toEqual([
      {
        type: "Component",
        name: "Counter",
        attributes: [{ name: "start", value: "3", dynamic: true }],
        children: [],
        island: false,
        strategy: null,
      },
    ]);
  });

  it("marks a component as an island via client:load", () => {
    const node = parse(`<Counter client:load/>`).nodes[0];
    expect(node).toMatchObject({ type: "Component", island: true, strategy: "client:load" });
  });

  it("parses a component with children", () => {
    expect(parse(`<Layout><h1>Hi</h1></Layout>`).nodes).toEqual([
      {
        type: "Component",
        name: "Layout",
        attributes: [],
        children: [
          { type: "Element", tag: "h1", attributes: [], children: [{ type: "Text", value: "Hi" }] },
        ],
        island: false,
        strategy: null,
      },
    ]);
  });

  it("parses <slot/>", () => {
    expect(parse("<slot/>").nodes).toEqual([{ type: "Slot" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — `finishComponent` is a stub; `<slot/>` parsed as Element.

- [ ] **Step 3: Replace `finishComponent` and special-case `slot`**

Replace the `finishComponent` stub with:

```ts
  private finishComponent(
    tag: string,
    attributes: Attribute[],
    selfClosing: boolean,
  ): TemplateNode {
    const directive = attributes.find((a) => a.name.startsWith("client:"));
    const props = attributes.filter((a) => !a.name.startsWith("client:"));
    if (directive && directive.name !== "client:load") {
      this.error(`Unknown directive '${directive.name}' (v1 supports only client:load)`);
    }
    let children: TemplateNode[] = [];
    if (!selfClosing) {
      children = this.parseNodes(true);
      const close = `</${tag}>`;
      if (!this.startsWith(close)) this.error(`Unclosed <${tag}>`);
      this.pos += close.length;
    }
    return {
      type: "Component",
      name: tag,
      attributes: props,
      children,
      island: directive !== undefined,
      strategy: directive ? "client:load" : null,
    };
  }
```

In `parseTag`, immediately after `const tag = this.readName();`, add the `slot` special case:

```ts
    if (tag === "slot") {
      const { selfClosing } = this.parseAttributes();
      if (!selfClosing) {
        const close = "</slot>";
        if (!this.startsWith(close)) this.error("Unclosed <slot>");
        this.pos += close.length;
      }
      return { type: "Slot" };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — all parser tests so far.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser components, island directive, slot"
```

---

## Task 9: Parser — `{#if}` and `{#each}` blocks

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("parse — blocks", () => {
  it("parses an {#if} with an {:else} branch", () => {
    expect(parse("{#if ok}<p>y</p>{:else}<p>n</p>{/if}").nodes).toEqual([
      {
        type: "IfBlock",
        condition: "ok",
        then: [{ type: "Element", tag: "p", attributes: [], children: [{ type: "Text", value: "y" }] }],
        otherwise: [{ type: "Element", tag: "p", attributes: [], children: [{ type: "Text", value: "n" }] }],
      },
    ]);
  });

  it("parses an {#if} with no else", () => {
    const node = parse("{#if ok}yes{/if}").nodes[0];
    expect(node).toMatchObject({ type: "IfBlock", condition: "ok", otherwise: null });
  });

  it("parses an {#each} block", () => {
    expect(parse("{#each items as item}<li>{item}</li>{/each}").nodes).toEqual([
      {
        type: "EachBlock",
        list: "items",
        item: "item",
        body: [
          {
            type: "Element",
            tag: "li",
            attributes: [],
            children: [{ type: "Expression", code: "item" }],
          },
        ],
      },
    ]);
  });

  it("errors on an unclosed {#if}", () => {
    expect(() => parse("{#if ok}yes")).toThrow(/Unclosed \{#if\}/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — `{#if` consumed by `parseExpression`.

- [ ] **Step 3: Dispatch blocks in `parseNodes` and add block parsers**

In `parseNodes`, replace the `{`-dispatch branch with:

```ts
      if (this.startsWith("{#if")) {
        nodes.push(this.parseIf());
        continue;
      }
      if (this.startsWith("{#each")) {
        nodes.push(this.parseEach());
        continue;
      }
      if (this.src[this.pos] === "{") {
        nodes.push(this.parseExpression());
        continue;
      }
```

Add to `Scanner`:

```ts
  private parseIf(): TemplateNode {
    const header = this.readBraced().trim(); // "#if condition"
    const condition = header.slice(3).trim();
    if (condition === "") this.error("{#if} requires a condition");
    const then = this.parseNodes(true);
    let otherwise: TemplateNode[] | null = null;
    if (this.startsWith("{:else}")) {
      this.pos += "{:else}".length;
      otherwise = this.parseNodes(true);
    }
    if (!this.startsWith("{/if}")) this.error("Unclosed {#if}");
    this.pos += "{/if}".length;
    return { type: "IfBlock", condition, then, otherwise };
  }

  private parseEach(): TemplateNode {
    const header = this.readBraced().trim(); // "#each list as item"
    const match = header.match(/^#each\s+(.+?)\s+as\s+(\w+)$/);
    if (!match) this.error("{#each} must be '{#each <list> as <item>}'");
    const body = this.parseNodes(true);
    if (!this.startsWith("{/each}")) this.error("Unclosed {#each}");
    this.pos += "{/each}".length;
    return { type: "EachBlock", list: match![1]!.trim(), item: match![2]!, body };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — all parser tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser {#if} and {#each} blocks"
```

---

## Task 10: Import extraction and rewriting

**Files:**
- Create: `src/imports.ts`
- Test: `tests/imports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/imports.test.ts`
Expected: FAIL — cannot find module `../src/imports.js`.

- [ ] **Step 3: Write `src/imports.ts`**

```ts
export interface ComponentImport {
  name: string;
  path: string;
}

export interface ExtractedImports {
  /** Import statements, hoisted, with .bangala specifiers rewritten to .js. */
  imports: string[];
  /** Frontmatter with the import lines removed. */
  body: string;
  /** Default-imported .bangala components, by local name and original path. */
  components: ComponentImport[];
}

const IMPORT_RE = /^\s*import\s.+$/;
const DEFAULT_BANGALA_RE = /^\s*import\s+(\w+)\s+from\s+["']([^"']+\.bangala)["']/;

export function extractImports(frontmatter: string): ExtractedImports {
  const imports: string[] = [];
  const components: ComponentImport[] = [];
  const bodyLines: string[] = [];

  for (const line of frontmatter.split("\n")) {
    if (!IMPORT_RE.test(line)) {
      bodyLines.push(line);
      continue;
    }
    const component = line.match(DEFAULT_BANGALA_RE);
    if (component) {
      components.push({ name: component[1]!, path: component[2]! });
    }
    imports.push(line.replace(/(\.bangala)(["'])/g, ".js$2").trim());
  }

  return { imports, body: bodyLines.join("\n").trim(), components };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/imports.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/imports.ts tests/imports.test.ts
git commit -m "feat: frontmatter import extraction and rewriting"
```

---

## Task 11: Analyzer

**Files:**
- Create: `src/analyzer.ts`
- Test: `tests/analyzer.test.ts`

The analyzer walks the AST, confirms every `Component` tag resolves to an imported `.bangala` component, collects island references, and validates v1 constraints.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzer.test.ts`
Expected: FAIL — cannot find module `../src/analyzer.js`.

- [ ] **Step 3: Write `src/analyzer.ts`**

```ts
import type { Template, TemplateNode, IslandRef } from "./types.js";
import type { ComponentImport } from "./imports.js";

export interface AnalyzedTemplate {
  islands: IslandRef[];
  dependencies: string[];
}

export function analyze(
  template: Template,
  components: ComponentImport[],
): AnalyzedTemplate {
  const byName = new Map(components.map((c) => [c.name, c.path]));
  const islands: IslandRef[] = [];
  const dependencies = new Set<string>();

  function walk(nodes: TemplateNode[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Component": {
          const path = byName.get(node.name);
          if (path === undefined) {
            throw new Error(`<${node.name}> is not imported in the frontmatter`);
          }
          dependencies.add(path);
          if (node.island) {
            if (node.children.length > 0) {
              throw new Error(
                `Island <${node.name}> cannot have children in v1`,
              );
            }
            islands.push({ componentPath: path, strategy: "client:load" });
          }
          walk(node.children);
          break;
        }
        case "Element":
          walk(node.children);
          break;
        case "IfBlock":
          walk(node.then);
          if (node.otherwise) walk(node.otherwise);
          break;
        case "EachBlock":
          walk(node.body);
          break;
        default:
          break;
      }
    }
  }

  walk(template.nodes);
  return { islands, dependencies: [...dependencies] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzer.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer.ts tests/analyzer.test.ts
git commit -m "feat: analyzer — component resolution and island detection"
```

---

## Task 12: Generator

**Files:**
- Create: `src/generator.ts`
- Test: `tests/generator.test.ts`

The generator turns a `Template` into the ESM module string. The render body is a single template literal built by `genNodes`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator.test.ts`
Expected: FAIL — cannot find module `../src/generator.js`.

- [ ] **Step 3: Write `src/generator.ts`**

```ts
import type {
  Template, TemplateNode, Attribute, CompileOptions,
} from "./types.js";
import { extractImports, type ComponentImport } from "./imports.js";

/** Escapes text for safe inclusion inside a JS template literal. */
function literal(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function attrsToObject(attributes: Attribute[]): string {
  const entries = attributes.map((a) => {
    const value = a.dynamic ? a.value : JSON.stringify(a.value);
    return `${JSON.stringify(a.name)}: ${value}`;
  });
  return `{${entries.join(", ")}}`;
}

export function generate(
  template: Template,
  components: ComponentImport[],
  options: CompileOptions,
): string {
  void options;
  const byName = new Map(components.map((c) => [c.name, c.path]));
  const { imports, body } = extractImports(template.frontmatter);

  function genNodes(nodes: TemplateNode[]): string {
    return nodes.map(genNode).join("");
  }

  function genElementAttrs(attributes: Attribute[]): string {
    return attributes
      .map((a) =>
        a.dynamic
          ? ` ${a.name}="\${escape(${a.value})}"`
          : ` ${a.name}="${literal(a.value)}"`,
      )
      .join("");
  }

  function genNode(node: TemplateNode): string {
    switch (node.type) {
      case "Text":
        return literal(node.value);
      case "Expression":
        return `\${escape(${node.code})}`;
      case "Slot":
        return `\${props.children ?? ""}`;
      case "Element": {
        const attrs = genElementAttrs(node.attributes);
        if (node.children.length === 0) return `<${node.tag}${attrs}></${node.tag}>`;
        return `<${node.tag}${attrs}>${genNodes(node.children)}</${node.tag}>`;
      }
      case "IfBlock": {
        const then = `\`${genNodes(node.then)}\``;
        const otherwise = node.otherwise ? `\`${genNodes(node.otherwise)}\`` : `""`;
        return `\${(${node.condition}) ? ${then} : ${otherwise}}`;
      }
      case "EachBlock": {
        const inner = `\`${genNodes(node.body)}\``;
        return (
          `\${(await Promise.all([...${node.list}]` +
          `.map(async (${node.item}) => ${inner}))).join("")}`
        );
      }
      case "Component": {
        const props = attrsToObject(node.attributes);
        if (node.island) {
          const path = byName.get(node.name)!.replace(/\.bangala$/, "");
          return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, "client:load")}`;
        }
        const children =
          node.children.length > 0
            ? `, async () => \`${genNodes(node.children)}\``
            : "";
        return `\${await renderComponent(${node.name}, ${props}${children})}`;
      }
    }
  }

  const renderBody = genNodes(template.nodes);
  return [
    `import { escape, renderComponent, island } from "bangala/runtime";`,
    ...imports,
    ``,
    `async function render(props) {`,
    body ? `  ${body.split("\n").join("\n  ")}` : "",
    `  return \`${renderBody}\`;`,
    `}`,
    ``,
    `export { render };`,
    `export default { render };`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/generator.ts tests/generator.test.ts
git commit -m "feat: generator — AST to ESM module"
```

---

## Task 13: `compile()` entry point and integration render tests

**Files:**
- Create: `src/index.ts`
- Create: `tests/helpers.ts`
- Create: `tests/render.test.ts`
- Create: `tests/fixtures/index.bangala`, `tests/fixtures/Layout.bangala`, `tests/fixtures/Counter.bangala`

- [ ] **Step 1: Write `src/index.ts`**

```ts
import { parse } from "./parser.js";
import { extractImports } from "./imports.js";
import { analyze } from "./analyzer.js";
import { generate } from "./generator.js";
import type { CompileOptions, CompileResult } from "./types.js";

export type { CompileOptions, CompileResult, IslandRef } from "./types.js";
export { ParseError } from "./parser.js";

export function compile(source: string, options: CompileOptions): CompileResult {
  const template = parse(source, options.filename);
  const { components } = extractImports(template.frontmatter);
  const analysis = analyze(template, components);
  const code = generate(template, components, options);
  return {
    code,
    islands: analysis.islands,
    dependencies: analysis.dependencies,
  };
}
```

- [ ] **Step 2: Write the `compileAndRender` test helper**

`tests/helpers.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { compile } from "../src/index.js";

/** Compiles a .bangala source, transpiles it, executes render(props). */
export async function compileAndRender(
  source: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  const { code } = compile(source, { filename: "test.bangala" });
  const js = (await transform(code, { loader: "ts", format: "esm" })).code;
  const dir = mkdtempSync(join(tmpdir(), "bangala-"));
  const file = join(dir, "module.mjs");
  writeFileSync(file, js);
  const mod = (await import(pathToFileURL(file).href)) as {
    render: (p: Record<string, unknown>) => Promise<string>;
  };
  return mod.render(props);
}
```

> Note: `import "bangala/runtime"` resolves inside the test run via the package's
> `exports` map (Node self-referencing). Component-composition is covered by the
> generator/analyzer tests; render tests here use componentless sources plus the
> island test, which stubs no external module.

- [ ] **Step 3: Write `tests/render.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { compileAndRender } from "./helpers.js";
import { compile } from "../src/index.js";

describe("render — integration", () => {
  it("interpolates and HTML-escapes expressions", async () => {
    const html = await compileAndRender("<p>{name}</p>", { name: "<b>x</b>" });
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
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS — every test file.

- [ ] **Step 5: Add the reference example fixtures**

`tests/fixtures/Counter.bangala`:

```bangala
---
const { start } = props
---
<button>Compteur : {start}</button>
```

`tests/fixtures/Layout.bangala`:

```bangala
---
const { title } = props
---
<html>
  <head><title>{title}</title></head>
  <body><slot/></body>
</html>
```

`tests/fixtures/index.bangala`:

```bangala
---
import Layout from "./Layout.bangala"
import Counter from "./Counter.bangala"
const { user } = props
---
<Layout title="Accueil">
  <h1>Bonjour {user.name}</h1>
  {#if user.posts.length === 0}
    <p>Aucun article pour l'instant.</p>
  {:else}
    <ul>
      {#each user.posts as post}
        <li>{post.title}</li>
      {/each}
    </ul>
  {/if}
  <Counter start={10} client:load />
</Layout>
```

- [ ] **Step 6: Add a reference-example test to `tests/render.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("compile — reference example", () => {
  it("compiles the reference fixtures without error", () => {
    for (const name of ["Counter", "Layout", "index"]) {
      const src = readFileSync(join(__dirname, "fixtures", `${name}.bangala`), "utf8");
      const result = compile(src, { filename: `${name}.bangala` });
      expect(result.code).toContain("export { render };");
    }
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS — every test, including the reference example.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts tests/helpers.ts tests/render.test.ts tests/fixtures
git commit -m "feat: compile() entry point + integration render tests"
```

---

## Self-Review

**Spec coverage** — every spec §5.1 v1 feature maps to a task:
- Frontmatter + `await` → Tasks 5, 10, 12; render test in Task 13.
- Interpolation + escaping → Tasks 6, 12; render test in Task 13.
- Elements + static/dynamic attributes → Tasks 7, 12.
- `{#if}`/`{:else}`/`{/if}` → Tasks 9, 12; render test in Task 13.
- `{#each}` → Tasks 9, 12; render test in Task 13.
- Component composition + `<slot/>` → Tasks 8, 11, 12.
- `client:load` island + `<bangala-island>` marker → Tasks 4, 8, 11, 12; test in Task 13.
- `CompileResult` output → Tasks 2, 13.
- Clear localized errors → Task 5 (`ParseError` with line/column), exercised in Tasks 7, 9.

**Placeholder scan** — the only forward reference is `finishComponent` (stubbed in Task 7, completed in Task 8); the stub is explicitly labelled and replaced. No TBD/TODO.

**Type consistency** — `Template`, `TemplateNode`, `Attribute`, `CompileResult`, `IslandRef`, `CompileOptions` defined once in Task 2 and imported everywhere. `ComponentImport`/`ExtractedImports` defined in Task 10, consumed by Tasks 11–12. `island(Comp, props, entry, strategy)` — 4 args — consistent across Tasks 4, 12, 13. `render(props)` exported named + default, consistent across Tasks 12, 13.
