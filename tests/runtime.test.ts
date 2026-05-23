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
