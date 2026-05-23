import { describe, it, expect } from "vitest";
import { escape, renderComponent, island, type Component } from "../src/runtime.js";

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
