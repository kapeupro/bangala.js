// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { scan } from "../../src/client/scanner.js";
import { mountIsland, resetBody } from "./dom.js";

beforeEach(resetBody);

describe("scan", () => {
  it("returns an empty array when there are no islands", () => {
    document.body.appendChild(document.createElement("p"));
    expect(scan(document)).toEqual([]);
  });

  it("skips islands already marked data-hydrated", () => {
    mountIsland({ entry: "./X", hydrated: "true" });
    expect(scan(document)).toEqual([]);
  });

  it("parses a minimal island (no props, no strategy → defaults)", () => {
    const el = mountIsland({ entry: "./X" });
    expect(scan(document)).toEqual([
      { el, ok: true, entry: "./X", props: {}, strategy: "load" },
    ]);
  });

  it("parses props as JSON", () => {
    const el = mountIsland({ entry: "./X", props: '{"n":7}' });
    expect(scan(document)).toEqual([
      { el, ok: true, entry: "./X", props: { n: 7 }, strategy: "load" },
    ]);
  });

  it("parses explicit strategies", () => {
    mountIsland({ entry: "./A", strategy: "load" });
    mountIsland({ entry: "./B", strategy: "idle" });
    mountIsland({ entry: "./C", strategy: "visible" });
    const results = scan(document).map((r) => (r.ok ? r.strategy : "err"));
    expect(results).toEqual(["load", "idle", "visible"]);
  });

  it("emits missing-entry when data-entry is absent", () => {
    const el = mountIsland({});
    expect(scan(document)).toEqual([
      { el, ok: false, code: "missing-entry" },
    ]);
  });

  it("emits missing-entry when data-entry is empty", () => {
    const el = mountIsland({ entry: "" });
    expect(scan(document)).toEqual([
      { el, ok: false, code: "missing-entry" },
    ]);
  });

  it("emits invalid-props when data-props is not valid JSON", () => {
    const el = mountIsland({ entry: "./X", props: "{nope}" });
    expect(scan(document)).toEqual([
      { el, ok: false, code: "invalid-props", entry: "./X" },
    ]);
  });

  it("emits invalid-props when data-props is not a plain object", () => {
    const el = mountIsland({ entry: "./X", props: "[1,2,3]" });
    expect(scan(document)).toEqual([
      { el, ok: false, code: "invalid-props", entry: "./X" },
    ]);
  });

  it("emits unknown-strategy for an unrecognised strategy value", () => {
    const el = mountIsland({ entry: "./X", strategy: "hover" });
    expect(scan(document)).toEqual([
      { el, ok: false, code: "unknown-strategy", entry: "./X" },
    ]);
  });

  it("scans only inside the provided root", () => {
    const outer = document.createElement("div");
    outer.id = "outer";
    document.body.appendChild(outer);
    const innerHost = document.createElement("div");
    innerHost.id = "inner";
    document.body.appendChild(innerHost);

    const a = document.createElement("bangala-island");
    a.setAttribute("data-entry", "./A");
    outer.appendChild(a);
    const b = document.createElement("bangala-island");
    b.setAttribute("data-entry", "./B");
    innerHost.appendChild(b);

    const results = scan(outer);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok && results[0]!.entry).toBe("./A");
  });
});
