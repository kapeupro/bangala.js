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
