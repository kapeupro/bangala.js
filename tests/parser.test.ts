import { describe, it, expect } from "vitest";
import { parse, ParseError } from "../src/parser.js";

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

  it("parses hyphenated and namespaced HTML/SVG attributes", () => {
    expect(parse(`<svg data-target="logo" stroke-width="2" aria-label="Logo"></svg>`).nodes).toEqual([
      {
        type: "Element",
        tag: "svg",
        attributes: [
          { name: "data-target", value: "logo", dynamic: false },
          { name: "stroke-width", value: "2", dynamic: false },
          { name: "aria-label", value: "Logo", dynamic: false },
        ],
        children: [],
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

  it("preserves document declarations as text", () => {
    expect(parse("<!DOCTYPE html><html></html>").nodes).toEqual([
      { type: "Text", value: "<!DOCTYPE html>" },
      { type: "Element", tag: "html", attributes: [], children: [] },
    ]);
  });

  it("preserves raw style and script contents", () => {
    expect(parse("<style>body{color:red}</style><script>if (ok) { run() }</script>").nodes).toEqual([
      {
        type: "Element",
        tag: "style",
        attributes: [],
        children: [{ type: "Text", value: "body{color:red}" }],
      },
      {
        type: "Element",
        tag: "script",
        attributes: [],
        children: [{ type: "Text", value: "if (ok) { run() }" }],
      },
    ]);
  });

  it("preserves raw textarea contents (no nested parsing)", () => {
    expect(parse("<textarea><h1>{user}</h1>\n{#if a}b{/if}</textarea>").nodes).toEqual([
      {
        type: "Element",
        tag: "textarea",
        attributes: [],
        children: [{ type: "Text", value: "<h1>{user}</h1>\n{#if a}b{/if}" }],
      },
    ]);
  });

  it("errors on an unclosed element", () => {
    expect(() => parse("<div>")).toThrow(/Unclosed <div>/);
  });
});

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

  it("accepts client:idle and records it as the strategy", () => {
    const node = parse(`<Counter client:idle/>`).nodes[0];
    expect(node).toMatchObject({ type: "Component", island: true, strategy: "client:idle" });
  });

  it("accepts client:visible and records it as the strategy", () => {
    const node = parse(`<Counter client:visible/>`).nodes[0];
    expect(node).toMatchObject({ type: "Component", island: true, strategy: "client:visible" });
  });

  it("errors on an unknown client: directive", () => {
    expect(() => parse(`<Counter client:hover/>`)).toThrow(/Unknown directive 'client:hover'/);
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

describe("parse — pedagogic errors", () => {
  function caught(source: string): ParseError {
    try {
      parse(source);
    } catch (error) {
      if (error instanceof ParseError) return error;
      throw error;
    }
    throw new Error("expected parse to throw");
  }

  it("ParseError exposes the source and offset so callers can render context", () => {
    const err = caught("<div>");
    expect(err).toBeInstanceOf(ParseError);
    expect(err.source).toBe("<div>");
    expect(typeof err.offset).toBe("number");
    expect(err.reason).toMatch(/Unclosed <div>/);
  });

  it("format() includes the source line, a caret marker, and a suggestion", () => {
    const err = caught("<div>");
    const rich = err.format();
    expect(rich).toContain("ParseError:");
    expect(rich).toContain("<div>");
    expect(rich).toContain("^");
    expect(rich).toContain("Suggested:");
  });

  it("format() suggests the three valid directives for an unknown client: directive", () => {
    const err = caught("<Counter client:hover/>");
    const rich = err.format();
    expect(rich).toContain("Unknown directive");
    expect(rich).toContain("client:load");
    expect(rich).toContain("client:idle");
    expect(rich).toContain("client:visible");
  });

  it("format() suggests adding a condition for an empty {#if}", () => {
    const err = caught("{#if}body{/if}");
    const rich = err.format();
    expect(rich).toContain("{#if condition}");
  });

  it("format() suggests the {#each list as item} shape", () => {
    const err = caught("{#each items}body{/each}");
    const rich = err.format();
    expect(rich).toContain("{#each list as item}");
  });

  it("format() surfaces neighbouring lines so errors are easy to locate", () => {
    const source = "<main>\n  <h1>Hi</h1>\n  {#if}\n  <p>x</p>\n</main>";
    const err = caught(source);
    const rich = err.format();
    expect(rich).toContain("<h1>Hi</h1>");
    expect(rich).toContain("{#if}");
    expect(rich).toContain("<p>x</p>");
  });

  it("keeps .message short so existing error matchers still work", () => {
    const err = caught("<div>");
    expect(err.message).toBe("Unclosed <div> (line 1, column 6)");
  });
});
