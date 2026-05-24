import { describe, expect, it } from "vitest";
import { wrapWithLayouts } from "../src/vite.js";

interface Renderable {
  render: (props: Record<string, unknown>) => string | Promise<string>;
}

describe("wrapWithLayouts", () => {
  const page: Renderable = {
    render: async (props) => `<h1>${props.title ?? "Home"}</h1>`,
  };

  const outer: Renderable = {
    render: async (props) => `<html><body>${props.children}</body></html>`,
  };

  const inner: Renderable = {
    render: async (props) => `<main>${props.children}</main>`,
  };

  it("renders a page with no layouts", async () => {
    const html = await wrapWithLayouts([], page, { title: "Home" });
    expect(html).toBe("<h1>Home</h1>");
  });

  it("wraps with a single layout", async () => {
    const html = await wrapWithLayouts([outer], page, { title: "Home" });
    expect(html).toBe("<html><body><h1>Home</h1></body></html>");
  });

  it("wraps with nested layouts outermost first", async () => {
    const html = await wrapWithLayouts([outer, inner], page, { title: "Home" });
    expect(html).toBe("<html><body><main><h1>Home</h1></main></body></html>");
  });

  it("propagates props (excluding children) to every layout", async () => {
    const seen: Record<string, unknown>[] = [];
    const tracking: Renderable = {
      render: async (props) => {
        seen.push({ ...props, children: typeof props.children });
        return `<wrap>${props.children}</wrap>`;
      },
    };
    await wrapWithLayouts([tracking, tracking], page, { title: "X", path: "/x" });
    // Each layout received title + path
    expect(seen.map((p) => p.title)).toEqual(["X", "X"]);
    expect(seen.map((p) => p.path)).toEqual(["/x", "/x"]);
    // Children is a string for both
    expect(seen.map((p) => p.children)).toEqual(["string", "string"]);
  });

  it("supports async page render", async () => {
    const asyncPage: Renderable = {
      render: async () => Promise.resolve("<p>async</p>"),
    };
    const html = await wrapWithLayouts([outer], asyncPage, {});
    expect(html).toBe("<html><body><p>async</p></body></html>");
  });
});
