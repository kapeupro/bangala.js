// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportError, type HydrationError } from "../../src/client/errors.js";
import { mountIsland, resetBody } from "./dom.js";

beforeEach(resetBody);

describe("reportError", () => {
  it("marks data-hydrated='error' and data-hydration-error=<code>", () => {
    const el = mountIsland();
    reportError({ el, code: "missing-entry" });
    expect(el.dataset.hydrated).toBe("error");
    expect(el.dataset.hydrationError).toBe("missing-entry");
  });

  it("calls onError with the full HydrationError", () => {
    const el = mountIsland();
    const onError = vi.fn();
    const cause = new Error("boom");
    reportError({ el, code: "mount-failed", entry: "./X", cause }, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toEqual({
      el, code: "mount-failed", entry: "./X", cause,
    });
  });

  it("dispatches bangala:island-error that bubbles to document", () => {
    const el = mountIsland();
    const seen: HydrationError[] = [];
    document.addEventListener("bangala:island-error", (e) => {
      seen.push((e as CustomEvent<HydrationError>).detail);
    }, { once: true });

    reportError({ el, code: "import-failed", entry: "./X" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: "import-failed", entry: "./X" });
  });

  it("dispatches the event AFTER calling onError", () => {
    const el = mountIsland();
    const order: string[] = [];
    const onError = () => order.push("callback");
    document.addEventListener("bangala:island-error", () => order.push("event"), { once: true });

    reportError({ el, code: "unknown-strategy" }, onError);

    expect(order).toEqual(["callback", "event"]);
  });

  it("swallows a throw in onError and still dispatches the event", () => {
    const el = mountIsland();
    const onError = () => { throw new Error("user bug"); };
    let dispatched = false;
    document.addEventListener("bangala:island-error", () => { dispatched = true; }, { once: true });

    expect(() => reportError({ el, code: "invalid-props" }, onError)).not.toThrow();
    expect(dispatched).toBe(true);
  });
});
