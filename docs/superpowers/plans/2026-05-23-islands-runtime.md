# bangala.js Islands Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side islands runtime — a `hydrate(root?, options?)` function exported from `bangala/client` that scans `<bangala-island>` markers in the DOM, dynamic-imports each island module, and mounts it according to its strategy (`load` / `idle` / `visible`).

**Architecture:** Six tiny single-responsibility files under `src/client/`. `scanner.ts` parses DOM markers. `strategies.ts` decides _when_ to hydrate. `errors.ts` writes the DOM, calls `onError`, and dispatches `bangala:island-error`. `hydrator.ts` orchestrates the four (scan → schedule → import → mount). `index.ts` re-exports the pure public API. `auto.ts` is the only side-effecting entry point (DOMContentLoaded → `hydrate()`).

**Tech Stack:** TypeScript (existing tsconfig), ESM, Vitest, **happy-dom** (new dev dep) for browser-environment unit tests. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-23-islands-runtime-design.md`

**Plan-level refinements of the spec** (consistency fixes locked in during planning):
- The `hydrate(root?, options?)` function is a thin wrapper over an internal `hydrateWith(loader, root, options)` that takes a module loader function as its first arg. The default loader is `(entry) => import(entry)`. The injectable form is **not** documented as public API — it lives in `hydrator.ts` next to `hydrate()` so tests can import it directly, keeping the public surface from `bangala/client` identical to spec §3.1.
- `data-strategy` is **optional** on the marker. When absent, the scanner defaults to `"load"` (matches spec §4.1 step 2.d "data-strategy ?? load"). When present but invalid, the scanner emits `unknown-strategy`.
- The DOM error attribute is `data-hydration-error="<code>"` where `<code>` is the `ErrorCode` string verbatim (kebab-case). The element's `data-hydrated` becomes `"error"` simultaneously.
- The SSR helper `island()` in `src/runtime.ts` (sub-project 1) already accepts `(Comp, props, entry, strategy)`. No signature change is needed there for the section 8 compiler extension — only the **value** of `strategy` flowing through.
- Vitest environment split: client tests use the **per-file** comment `// @vitest-environment happy-dom` at the top of each `tests/client/**.test.ts`. No workspace config; no `environmentMatchGlobs`. Keeps the existing root vitest config one-line.
- Test code never uses `innerHTML` to set up DOM. A `tests/client/dom.ts` helper provides `mountIsland(attrs, children?)` built on `createElement` / `setAttribute` / `appendChild`. This mirrors spec §6.3's recommendation for island authors.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Adds `./client` and `./client/auto` to `exports`. Adds `happy-dom` devDep. |
| `src/types.ts` | Extends `ClientDirective` to all three values; widens `IslandRef.strategy`. |
| `src/parser.ts` | `VALID_DIRECTIVES` set; propagates the actual directive name to `ComponentNode.strategy`. |
| `src/analyzer.ts` | Propagates `node.strategy` into `IslandRef` instead of hardcoding `"client:load"`. |
| `src/generator.ts` | Emits the actual strategy string into `island(...)`. |
| `src/client/errors.ts` | `ErrorCode` / `HydrationError` / `HydrateOptions` types + `reportError()` (mark DOM, log, call `onError`, dispatch event). |
| `src/client/strategies.ts` | `StrategyName` / `Schedule` types + `load` / `idle` / `visible` schedulers + `getStrategy(name)`. |
| `src/client/scanner.ts` | `scan(root)` → list of typed parse results (`ok` or error). Reads `data-entry` / `data-props` / `data-strategy`. |
| `src/client/hydrator.ts` | `hydrate(root?, options?)` + internal `hydrateWith(loader, root, options)`. Orchestrates scan → schedule → import → mount. Marks DOM transitions. |
| `src/client/index.ts` | Pure re-exports. No side-effects. |
| `src/client/auto.ts` | The only side-effecting module: `DOMContentLoaded` → `hydrate()`. |
| `tests/client/dom.ts` | Helper: `mountIsland(attrs, children?)`. Used by every client test. No `innerHTML`. |
| `tests/client/errors.test.ts` | Unit tests for `reportError`. |
| `tests/client/strategies.test.ts` | Unit tests for each scheduler (fake timers, mocked `IntersectionObserver` / `requestIdleCallback`). |
| `tests/client/scanner.test.ts` | Unit tests for marker parsing + error codes. |
| `tests/client/hydrator.test.ts` | Unit tests for orchestration, all error paths, idempotence, `onError` + event. |
| `tests/client/integration.test.ts` | E2E: real fixture module hydrated via real `import()`. |
| `tests/client/fixtures/Counter-island.ts` | Real island module: `export function mount(el, props, ctx)`. |

---

## Task 1: Extend compiler parser + types for `client:idle` / `client:visible`

**Why first:** Section 8 of the spec mandates the compiler can emit `data-strategy="idle"` / `data-strategy="visible"`. Today the parser throws on those directives. The runtime tests in later tasks won't need this, but the integration story does, and the change is one line plus two type-widenings — do it now to avoid two PRs.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/parser.ts`
- Modify: `tests/parser.test.ts`

- [ ] **Step 1: Write the failing test in `tests/parser.test.ts`**

Append to the `describe("parse — components", ...)` block (after the existing `client:load` test, around line 83):

```ts
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
```

- [ ] **Step 2: Run the tests and verify the two new "accepts" tests fail**

Run: `npm test -- tests/parser.test.ts`
Expected: the two new "accepts" tests fail with an error matching `/Unknown directive 'client:idle' \(v1 supports only client:load\)/` (and the visible equivalent). The third test (`client:hover`) passes today by coincidence — that's fine.

- [ ] **Step 3: Update `src/types.ts` — widen `ClientDirective`**

Replace the `ComponentNode` interface (lines 28–35) and the `IslandRef` interface (lines 75–78):

```ts
export type ClientDirective = "client:load" | "client:idle" | "client:visible";

export interface ComponentNode {
  type: "Component";
  name: string;
  attributes: Attribute[];
  children: TemplateNode[];
  island: boolean;
  strategy: ClientDirective | null;
}
```

And:

```ts
export interface IslandRef {
  componentPath: string;
  strategy: ClientDirective;
}
```

- [ ] **Step 4: Update `src/parser.ts` — accept all three directives**

In `finishComponent` (around line 215–223), replace the rejection block:

```ts
const VALID_DIRECTIVES = new Set(["client:load", "client:idle", "client:visible"]);
const directive = attributes.find((a) => a.name.startsWith("client:"));
const props = attributes.filter((a) => !a.name.startsWith("client:"));
if (directive && !VALID_DIRECTIVES.has(directive.name)) {
  this.error(`Unknown directive '${directive.name}'`);
}
```

And update the returned object so `strategy` propagates the real directive name (was hardcoded `"client:load"`):

```ts
return {
  type: "Component",
  name: tag,
  attributes: props,
  children,
  island: directive !== undefined,
  strategy: directive ? (directive.name as "client:load" | "client:idle" | "client:visible") : null,
};
```

- [ ] **Step 5: Run the parser tests and verify they all pass**

Run: `npm test -- tests/parser.test.ts`
Expected: PASS, all three new tests green plus the existing `client:load` test still green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/parser.ts tests/parser.test.ts
git commit -m "feat(parser): accept client:idle and client:visible directives"
```

---

## Task 2: Propagate the real strategy through analyzer + generator

**Files:**
- Modify: `src/analyzer.ts:32`
- Modify: `src/generator.ts:70`
- Modify: `tests/analyzer.test.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 1: Write the failing analyzer test in `tests/analyzer.test.ts`**

Append to the `describe("analyze", ...)` block:

```ts
it("propagates client:idle into the IslandRef", () => {
  const result = analyzeSource(
    `---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:idle/>`,
  );
  expect(result.islands).toEqual([
    { componentPath: "./Counter.bangala", strategy: "client:idle" },
  ]);
});

it("propagates client:visible into the IslandRef", () => {
  const result = analyzeSource(
    `---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:visible/>`,
  );
  expect(result.islands).toEqual([
    { componentPath: "./Counter.bangala", strategy: "client:visible" },
  ]);
});
```

- [ ] **Step 2: Write the failing render test in `tests/render.test.ts`**

Append to the `describe("compile — island markers", ...)` block:

```ts
it("emits the actual strategy into the island() call for client:idle", () => {
  const src =
    `---\nimport Counter from "./Counter.bangala"\n---\n<Counter start={5} client:idle/>`;
  const result = compile(src, { filename: "page.bangala" });
  expect(result.islands).toEqual([
    { componentPath: "./Counter.bangala", strategy: "client:idle" },
  ]);
  expect(result.code).toContain(
    `await island(Counter, {"start": 5}, "./Counter", "client:idle")`,
  );
});

it("emits the actual strategy into the island() call for client:visible", () => {
  const src =
    `---\nimport Counter from "./Counter.bangala"\n---\n<Counter client:visible/>`;
  const result = compile(src, { filename: "page.bangala" });
  expect(result.code).toContain(`"./Counter", "client:visible"`);
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npm test -- tests/analyzer.test.ts tests/render.test.ts`
Expected: FAIL — the analyzer tests show `strategy: "client:load"` instead of `"client:idle"`/`"client:visible"`; the render tests find `"client:load"` in the generated code.

- [ ] **Step 4: Fix `src/analyzer.ts`**

Replace the island push (line 32):

```ts
islands.push({ componentPath: path, strategy: node.strategy! });
```

The `!` is safe because `node.island === true` ⇒ `node.strategy !== null` (parser invariant, enforced in Task 1).

- [ ] **Step 5: Fix `src/generator.ts`**

Replace the island emission (line 70):

```ts
return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, ${JSON.stringify(node.strategy!)})}`;
```

- [ ] **Step 6: Run the full test suite and verify all green**

Run: `npm test`
Expected: PASS — every test green. (The original `client:load` render test still passes because `JSON.stringify("client:load") === '"client:load"'`.)

- [ ] **Step 7: Commit**

```bash
git add src/analyzer.ts src/generator.ts tests/analyzer.test.ts tests/render.test.ts
git commit -m "feat(compiler): propagate client:idle and client:visible to island markers"
```

---

## Task 3: Project setup — happy-dom + `bangala/client` exports + DOM helper + DOM lib

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `tests/client/dom.ts`

- [ ] **Step 1: Install `happy-dom`**

Run: `npm install --save-dev happy-dom@^15.0.0`
Expected: `node_modules/happy-dom` exists, `package.json` lists it under `devDependencies`.

- [ ] **Step 2: Update `package.json` exports**

Replace the `exports` block:

```json
"exports": {
  ".":               "./src/index.ts",
  "./runtime":       "./src/runtime.ts",
  "./client":        "./src/client/index.ts",
  "./client/auto":   "./src/client/auto.ts"
}
```

- [ ] **Step 3: Add the DOM lib to `tsconfig.json`**

The client code uses `HTMLElement`, `IntersectionObserver`, `document`, etc. The current `tsconfig.json` only loads the default lib for `target: ES2023` (no DOM types). Replace the `compilerOptions` block to add an explicit `lib`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
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

Server-only files (`src/parser.ts`, `src/analyzer.ts`, …) gain DOM globals in their type scope. That's harmless — they don't reference DOM types today, and accidental usage would still be caught at code review.

- [ ] **Step 4: Create `tests/client/dom.ts` — the shared DOM-building helper**

The helper is used by every client test, so unifying it once avoids `innerHTML` everywhere and aligns with spec §6.3.

```ts
/** Build a <bangala-island> element with the given data-* attributes
 *  and append it to document.body. Optionally, append children built
 *  via the provided builder (e.g. a <button> for SSR fallback tests). */
export interface IslandAttrs {
  entry?: string | null;     // data-entry; null means "do not set the attribute"
  props?: string | null;     // data-props (raw string, JSON or not)
  strategy?: string | null;  // data-strategy
  hydrated?: string | null;  // data-hydrated (for "already processed" tests)
}

export function mountIsland(
  attrs: IslandAttrs = {},
  buildChildren?: (el: HTMLElement) => void,
): HTMLElement {
  const el = document.createElement("bangala-island");
  setIfDefined(el, "data-entry",    attrs.entry);
  setIfDefined(el, "data-props",    attrs.props);
  setIfDefined(el, "data-strategy", attrs.strategy);
  setIfDefined(el, "data-hydrated", attrs.hydrated);
  buildChildren?.(el);
  document.body.appendChild(el);
  return el;
}

function setIfDefined(el: HTMLElement, name: string, value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  el.setAttribute(name, value);
}

/** Replace the document.body contents with nothing — call between tests
 *  to avoid leaking state from previous mountIsland() calls. */
export function resetBody(): void {
  document.body.replaceChildren();
}
```

- [ ] **Step 5: Verify the typecheck still passes (no client files yet — only the manifest + tsconfig changed)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tests/client/dom.ts
git commit -m "chore(client): add happy-dom, bangala/client exports, DOM lib, helper"
```

---

## Task 4: `errors.ts` — types + `reportError()`

**Files:**
- Create: `src/client/errors.ts`
- Create: `tests/client/errors.test.ts`

- [ ] **Step 1: Write the failing tests in `tests/client/errors.test.ts`**

```ts
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
    expect(onError.mock.calls[0][0]).toEqual({
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
```

- [ ] **Step 2: Run the tests and verify they fail with "module not found"**

Run: `npm test -- tests/client/errors.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/errors.js'` (or similar).

- [ ] **Step 3: Create `src/client/errors.ts`**

```ts
export type ErrorCode =
  | "missing-entry"
  | "invalid-props"
  | "unknown-strategy"
  | "import-failed"
  | "missing-mount"
  | "mount-failed";

export interface HydrationError {
  el: HTMLElement;
  code: ErrorCode;
  entry?: string;
  cause?: unknown;
}

export interface HydrateOptions {
  onError?: (error: HydrationError) => void;
}

export function reportError(
  error: HydrationError,
  onError?: HydrateOptions["onError"],
): void {
  error.el.dataset.hydrated = "error";
  error.el.dataset.hydrationError = error.code;
  console.error(`[bangala] hydration ${error.code}`, error.cause ?? error);
  if (onError) {
    try {
      onError(error);
    } catch {
      // A throw from user code must never abort the rest of the page's hydration.
    }
  }
  error.el.dispatchEvent(
    new CustomEvent<HydrationError>("bangala:island-error", {
      detail: error,
      bubbles: true,
    }),
  );
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- tests/client/errors.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/client/errors.ts tests/client/errors.test.ts
git commit -m "feat(client): errors module — reportError, types, event dispatch"
```

---

## Task 5: `strategies.ts` — `load` / `idle` / `visible` + fallbacks

**Files:**
- Create: `src/client/strategies.ts`
- Create: `tests/client/strategies.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/client/strategies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/strategies.ts`**

```ts
export type StrategyName = "load" | "idle" | "visible";

export type Schedule = (el: HTMLElement, run: () => void) => void;

export const load: Schedule = (_el, run) => {
  run();
};

export const idle: Schedule = (_el, run) => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    // Safari has no requestIdleCallback; a 1ms timeout yields to the next tick.
    setTimeout(run, 1);
  }
};

export const visible: Schedule = (el, run) => {
  if (typeof IntersectionObserver !== "function") {
    run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io.disconnect();
          run();
          return;
        }
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(el);
};

const TABLE: Record<StrategyName, Schedule> = { load, idle, visible };

export function getStrategy(name: StrategyName): Schedule {
  return TABLE[name];
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- tests/client/strategies.test.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/client/strategies.ts tests/client/strategies.test.ts
git commit -m "feat(client): hydration strategies — load, idle, visible"
```

---

## Task 6: `scanner.ts` — DOM marker parsing

**Files:**
- Create: `src/client/scanner.ts`
- Create: `tests/client/scanner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/client/scanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/scanner.ts`**

```ts
import type { ErrorCode } from "./errors.js";
import type { StrategyName } from "./strategies.js";

const SELECTOR = "bangala-island:not([data-hydrated])";
const VALID_STRATEGIES: ReadonlySet<string> = new Set(["load", "idle", "visible"]);

export type ScanResult =
  | { el: HTMLElement; ok: true; entry: string; props: Record<string, unknown>; strategy: StrategyName }
  | { el: HTMLElement; ok: false; code: ErrorCode; entry?: string };

export function scan(root: ParentNode): ScanResult[] {
  const out: ScanResult[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    out.push(parseOne(el));
  }
  return out;
}

function parseOne(el: HTMLElement): ScanResult {
  const entry = el.dataset.entry;
  if (!entry) {
    return { el, ok: false, code: "missing-entry" };
  }

  const stratRaw = el.dataset.strategy ?? "load";
  if (!VALID_STRATEGIES.has(stratRaw)) {
    return { el, ok: false, code: "unknown-strategy", entry };
  }
  const strategy = stratRaw as StrategyName;

  const propsRaw = el.dataset.props ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(propsRaw);
  } catch {
    return { el, ok: false, code: "invalid-props", entry };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { el, ok: false, code: "invalid-props", entry };
  }

  return { el, ok: true, entry, props: parsed as Record<string, unknown>, strategy };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- tests/client/scanner.test.ts`
Expected: PASS, 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/client/scanner.ts tests/client/scanner.test.ts
git commit -m "feat(client): scanner — parse bangala-island markers"
```

---

## Task 7: `hydrator.ts` — orchestration with injectable loader

**Files:**
- Create: `src/client/hydrator.ts`
- Create: `tests/client/hydrator.test.ts`

- [ ] **Step 1: Write the failing tests (full orchestration + every error path)**

```ts
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
    // 'idle' falls back to setTimeout(_, 1) when requestIdleCallback is absent.
    expect(mount).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    await nextTick();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/client/hydrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/hydrator.ts`**

```ts
import { scan, type ScanResult } from "./scanner.js";
import { getStrategy, type StrategyName } from "./strategies.js";
import { reportError, type HydrateOptions, type HydrationError } from "./errors.js";

export type Loader = (entry: string) => Promise<unknown>;

const defaultLoader: Loader = (entry) => import(/* @vite-ignore */ entry);

export interface MountContext {
  strategy: StrategyName;
  entry: string;
}

type IslandModule = {
  mount: (el: HTMLElement, props: Record<string, unknown>, ctx: MountContext) => unknown;
};

export function hydrate(root: ParentNode = document, options: HydrateOptions = {}): void {
  hydrateWith(defaultLoader, root, options);
}

/** Same as hydrate(), but with an injectable module loader. Exported for tests. */
export function hydrateWith(
  loader: Loader,
  root: ParentNode = document,
  options: HydrateOptions = {},
): void {
  for (const result of scan(root)) {
    if (!result.ok) {
      reportError(
        { el: result.el, code: result.code, entry: result.entry },
        options.onError,
      );
      continue;
    }
    result.el.dataset.hydrated = "scheduled";
    const ctx: MountContext = { strategy: result.strategy, entry: result.entry };
    getStrategy(result.strategy)(result.el, () => {
      void runMount(loader, result, ctx, options);
    });
  }
}

async function runMount(
  loader: Loader,
  scanned: Extract<ScanResult, { ok: true }>,
  ctx: MountContext,
  options: HydrateOptions,
): Promise<void> {
  let mod: unknown;
  try {
    mod = await loader(scanned.entry);
  } catch (cause) {
    return fail(scanned.el, "import-failed", scanned.entry, cause, options);
  }

  const mount = (mod as Partial<IslandModule>)?.mount;
  if (typeof mount !== "function") {
    return fail(scanned.el, "missing-mount", scanned.entry, undefined, options);
  }

  try {
    await mount(scanned.el, scanned.props, ctx);
  } catch (cause) {
    return fail(scanned.el, "mount-failed", scanned.entry, cause, options);
  }

  scanned.el.dataset.hydrated = "true";
}

function fail(
  el: HTMLElement,
  code: HydrationError["code"],
  entry: string,
  cause: unknown,
  options: HydrateOptions,
): void {
  reportError({ el, code, entry, cause }, options.onError);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- tests/client/hydrator.test.ts`
Expected: PASS, 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/client/hydrator.ts tests/client/hydrator.test.ts
git commit -m "feat(client): hydrator — orchestrate scan → schedule → import → mount"
```

---

## Task 8: Public `index.ts` + side-effecting `auto.ts`

**Files:**
- Create: `src/client/index.ts`
- Create: `src/client/auto.ts`

- [ ] **Step 1: Create `src/client/index.ts` (pure re-exports, no side-effects)**

```ts
export { hydrate } from "./hydrator.js";
export type { HydrateOptions, ErrorCode, HydrationError } from "./errors.js";
export type { MountContext } from "./hydrator.js";
```

- [ ] **Step 2: Create `src/client/auto.ts`**

```ts
import { hydrate } from "./hydrator.js";

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrate(), { once: true });
  } else {
    hydrate();
  }
}
```

- [ ] **Step 3: Verify the typecheck still passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify `bangala/client` resolves through the package self-reference**

Run:
```bash
node --import tsx --eval "import('bangala/client').then((m) => console.log(typeof m.hydrate));"
```

If `tsx` is not available locally, alternative one-liner using esbuild's runner-equivalent:
```bash
node --input-type=module -e "
  import { transform } from 'esbuild';
  import { readFile } from 'node:fs/promises';
  const src = await readFile('./src/client/index.ts', 'utf8');
  const out = (await transform(src, { loader: 'ts', format: 'esm' })).code;
  await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));
"
```

Expected: `function` printed (the `hydrate` export). If neither works, skip this step and rely on Task 9's integration test instead.

- [ ] **Step 5: Commit**

```bash
git add src/client/index.ts src/client/auto.ts
git commit -m "feat(client): public entry (pure) + auto-start (DOMContentLoaded)"
```

---

## Task 9: Integration test with a real island fixture

**Files:**
- Create: `tests/client/fixtures/Counter-island.ts`
- Create: `tests/client/integration.test.ts`

- [ ] **Step 1: Create the fixture `tests/client/fixtures/Counter-island.ts`**

```ts
export async function mount(
  el: HTMLElement,
  props: Record<string, unknown>,
  _ctx: { strategy: string; entry: string },
): Promise<void> {
  const start = typeof props.start === "number" ? props.start : 0;
  let n = start;
  const button = el.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Counter island: missing <button> in SSR HTML");
  button.textContent = `count=${n}`;
  button.addEventListener("click", () => {
    n += 1;
    button.textContent = `count=${n}`;
  });
}
```

- [ ] **Step 2: Write the failing integration test in `tests/client/integration.test.ts`**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hydrate } from "../../src/client/index.js";
import { mountIsland, resetBody } from "./dom.js";

beforeEach(resetBody);

const FIXTURE_ENTRY = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "Counter-island.ts"),
).href;

describe("islands runtime — integration", () => {
  it("hydrates a real fixture module and makes it interactive", async () => {
    const el = mountIsland(
      { entry: FIXTURE_ENTRY, props: '{"start":10}', strategy: "load" },
      (host) => {
        const button = document.createElement("button");
        button.textContent = "count=?";
        host.appendChild(button);
      },
    );

    hydrate(document);
    await new Promise((r) => setTimeout(r, 20));

    expect(el.dataset.hydrated).toBe("true");
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("count=10");
    button.click();
    expect(button.textContent).toBe("count=11");
  });

  it("preserves the SSR HTML even when hydration fails (import-failed)", async () => {
    const el = mountIsland(
      { entry: "./does-not-exist.js" },
      (host) => {
        const span = document.createElement("span");
        span.textContent = "ssr-still-here";
        host.appendChild(span);
      },
    );

    hydrate(document);
    await new Promise((r) => setTimeout(r, 20));

    expect(el.dataset.hydrationError).toBe("import-failed");
    expect(el.querySelector("span")?.textContent).toBe("ssr-still-here");
  });
});
```

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npm test -- tests/client/integration.test.ts`
Expected: PASS, 2 tests green.

Note: Vitest natively handles `import()` of `.ts` files. The fixture is referenced by an absolute `file://` URL (via `pathToFileURL`) so the dynamic import resolves regardless of the test's working directory.

- [ ] **Step 4: Commit**

```bash
git add tests/client/fixtures/Counter-island.ts tests/client/integration.test.ts
git commit -m "test(client): integration — hydrate a real island module via dynamic-import"
```

---

## Task 10: Whole-suite verification + size canary

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every previously-green test still green, plus all 36+ new client tests green.

- [ ] **Step 2: Run the typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Measure the runtime size canary**

Run:
```bash
npx esbuild src/client/auto.ts --bundle --minify --format=esm --platform=browser --target=es2020 | wc -c
```
Expected: under ~3000 bytes (raw minified, pre-gzip). The spec's <2KB target is post-gzip — if raw minified is under 3KB, gzip will land well under 2KB. If it doesn't, investigate before declaring complete (likely culprits: accidental Node API import, dead code from a wrong tree-shake).

For a gzip-true measurement:
```bash
npx esbuild src/client/auto.ts --bundle --minify --format=esm --platform=browser --target=es2020 | gzip -9 | wc -c
```
Expected: under 2048 bytes.

- [ ] **Step 4: Verify the example still compiles (smoke test for sub-project 1)**

Run: `npm test -- tests/render.test.ts`
Expected: PASS, the "compiles the reference fixtures" test still green.

- [ ] **Step 5: No code commit needed — implementation is feature-complete**

If any earlier task left an uncommitted dev artefact, commit it now under `chore:`. Otherwise, this task closes out the sub-project.
