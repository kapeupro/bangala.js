// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hydrateWith, type Loader } from "../../src/client/hydrator.js";
import type { HydrationError } from "../../src/client/errors.js";
import { mountIsland, resetBody } from "./dom.js";

beforeEach(resetBody);

function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function fakeLoader(modules: Record<string, unknown>): Loader {
  return async (entry) => {
    if (!(entry in modules)) throw new Error(`no fake module for ${entry}`);
    return modules[entry]!;
  };
}

describe("hydrate — nominal flow", () => {
  it("imports the entry and awaits mount(el, props, ctx)", async () => {
    const el = mountIsland({ entry: "./X", props: '{"n":42}' });
    const mount = vi.fn(async () => {});
    hydrateWith(fakeLoader({ "./X": { mount } }));
    await nextTick();

    expect(mount).toHaveBeenCalledTimes(1);
    const [calledEl, calledProps, calledCtx] = mount.mock.calls[0]!;
    expect(calledEl).toBe(el);
    expect(calledProps).toEqual({ n: 42 });
    expect(calledCtx).toEqual({ strategy: "load", entry: "./X" });
    expect(el.dataset.hydrated).toBe("true");
  });

  it("marks data-hydrated='scheduled' before mount returns", async () => {
    const el = mountIsland({ entry: "./X" });
    let observed: string | undefined;
    const mount = vi.fn(async () => { observed = el.dataset.hydrated; });
    hydrateWith(fakeLoader({ "./X": { mount } }));
    await nextTick();
    expect(observed).toBe("scheduled");
    expect(el.dataset.hydrated).toBe("true");
  });

  it("is idempotent: a second hydrate() does nothing on already-marked islands", async () => {
    mountIsland({ entry: "./X" });
    const mount = vi.fn(async () => {});
    const loader = fakeLoader({ "./X": { mount } });
    hydrateWith(loader);
    await nextTick();
    hydrateWith(loader);
    await nextTick();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});

describe("hydrate — error paths", () => {
  it("missing-entry: marks the element and calls onError before dispatching the event", async () => {
    const el = mountIsland({});
    const onError = vi.fn();
    const seen: HydrationError[] = [];
    document.addEventListener(
      "bangala:island-error",
      (e) => seen.push((e as CustomEvent<HydrationError>).detail),
      { once: true },
    );

    hydrateWith(fakeLoader({}), document, { onError });
    await nextTick();

    expect(el.dataset.hydrated).toBe("error");
    expect(el.dataset.hydrationError).toBe("missing-entry");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "missing-entry" }));
    expect(seen[0]).toMatchObject({ code: "missing-entry" });
  });

  it("invalid-props: same flow, code='invalid-props'", async () => {
    mountIsland({ entry: "./X", props: "{nope}" });
    const onError = vi.fn();
    hydrateWith(fakeLoader({}), document, { onError });
    await nextTick();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid-props", entry: "./X" }),
    );
  });

  it("unknown-strategy: same flow, code='unknown-strategy'", async () => {
    mountIsland({ entry: "./X", strategy: "hover" });
    const onError = vi.fn();
    hydrateWith(fakeLoader({}), document, { onError });
    await nextTick();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unknown-strategy", entry: "./X" }),
    );
  });

  it("import-failed: when the loader rejects, reports 'import-failed' with the cause", async () => {
    const el = mountIsland({ entry: "./X" });
    const onError = vi.fn();
    const cause = new Error("404");
    const loader: Loader = () => Promise.reject(cause);

    hydrateWith(loader, document, { onError });
    await nextTick();

    expect(el.dataset.hydrationError).toBe("import-failed");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "import-failed", entry: "./X", cause }),
    );
  });

  it("missing-mount: when the module has no mount export", async () => {
    const el = mountIsland({ entry: "./X" });
    const onError = vi.fn();
    const loader = fakeLoader({ "./X": { somethingElse: () => {} } });

    hydrateWith(loader, document, { onError });
    await nextTick();

    expect(el.dataset.hydrationError).toBe("missing-mount");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "missing-mount", entry: "./X" }),
    );
  });

  it("missing-mount: when 'mount' is not a function", async () => {
    mountIsland({ entry: "./X" });
    const loader = fakeLoader({ "./X": { mount: 42 } });
    const onError = vi.fn();
    hydrateWith(loader, document, { onError });
    await nextTick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "missing-mount" }));
  });

  it("mount-failed: when mount throws synchronously", async () => {
    mountIsland({ entry: "./X" });
    const cause = new Error("oops");
    const loader = fakeLoader({ "./X": { mount: () => { throw cause; } } });
    const onError = vi.fn();
    hydrateWith(loader, document, { onError });
    await nextTick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "mount-failed", cause }));
  });

  it("mount-failed: when mount returns a rejected promise", async () => {
    mountIsland({ entry: "./X" });
    const cause = new Error("async oops");
    const loader = fakeLoader({ "./X": { mount: () => Promise.reject(cause) } });
    const onError = vi.fn();
    hydrateWith(loader, document, { onError });
    await nextTick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "mount-failed", cause }));
  });

  it("does not stop other islands when one fails", async () => {
    mountIsland({ entry: "./BAD" });
    mountIsland({ entry: "./OK" });
    const goodMount = vi.fn(async () => {});
    const loader: Loader = async (entry) => {
      if (entry === "./BAD") throw new Error("nope");
      return { mount: goodMount };
    };
    hydrateWith(loader);
    await nextTick();
    const [bad, ok] = Array.from(document.querySelectorAll<HTMLElement>("bangala-island"));
    expect(bad!.dataset.hydrationError).toBe("import-failed");
    expect(ok!.dataset.hydrated).toBe("true");
    expect(goodMount).toHaveBeenCalledTimes(1);
  });
});

describe("hydrate — strategy dispatch", () => {
  it("uses the scanned strategy to schedule mounting", async () => {
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    mountIsland({ entry: "./X", strategy: "idle" });
    const mount = vi.fn(async () => {});

    hydrateWith(fakeLoader({ "./X": { mount } }));
    expect(mount).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    await nextTick();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});
