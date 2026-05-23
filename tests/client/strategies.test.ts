// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { load, idle, visible, getStrategy } from "../../src/client/strategies.js";

const el = () => document.createElement("bangala-island");

describe("load", () => {
  it("runs the callback synchronously", () => {
    const run = vi.fn();
    load(el(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("idle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  });

  it("uses requestIdleCallback when available", () => {
    const ric = vi.fn((cb: () => void) => { setTimeout(cb, 0); return 1; });
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = ric;

    const run = vi.fn();
    idle(el(), run);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to setTimeout when requestIdleCallback is missing (Safari)", () => {
    const run = vi.fn();
    idle(el(), run);
    expect(run).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("visible", () => {
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it("runs immediately when IntersectionObserver is missing", () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const run = vi.fn();
    visible(el(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("observes the element and runs once it intersects, then disconnects", () => {
    let captured: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = vi.fn((cb) => {
      captured = cb;
      return { observe, disconnect } as unknown as IntersectionObserver;
    });

    const target = el();
    const run = vi.fn();
    visible(target, run);
    expect(observe).toHaveBeenCalledWith(target);
    expect(run).not.toHaveBeenCalled();

    captured!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(run).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);

    captured!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run while entries are not intersecting", () => {
    let captured: IntersectionObserverCallback | null = null;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = vi.fn((cb) => {
      captured = cb;
      return { observe: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
    });
    const run = vi.fn();
    visible(el(), run);
    captured!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("getStrategy", () => {
  it("returns the matching scheduler", () => {
    expect(getStrategy("load")).toBe(load);
    expect(getStrategy("idle")).toBe(idle);
    expect(getStrategy("visible")).toBe(visible);
  });
});
