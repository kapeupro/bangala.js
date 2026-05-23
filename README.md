<div align="center">

<img src="./docs/logo.svg" width="96" alt="bangala.js logo" />

# bangala.js

### The full-stack framework that ships minimal JavaScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-v0.5.0-blue.svg)](https://www.npmjs.com/package/bangala)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

## Why bangala.js?

Most frameworks ship a runtime to the browser even when the page is plain
content. bangala.js inverts the default: your pages are HTML, and JavaScript
only travels to the client where you explicitly ask for it.

- **HTML-first.** A `.bangala` file is HTML enriched with a server frontmatter,
  `{expr}` interpolation, and `{#if}` / `{#each}` blocks. The compiler emits an
  ESM module whose `render()` is pure string concatenation — the fastest SSR
  primitive there is.
- **Framework-agnostic islands.** Interactive components are isolated islands.
  Each island is just a module that exports `mount(el, props, ctx)`. Use
  vanilla DOM, Preact, Lit, htmx, or a web component — bangala does not impose
  a UI library.
- **Near-zero JS by default.** A static page ships zero framework bytes. Only
  islands fetch their own module, on demand, with the strategy you pick
  (`load`, `idle`, or `visible`).

## Status

v0.5.0 ships **sub-project 1** (the `.bangala` compiler and server runtime),
**sub-project 2** (the client islands runtime), **sub-project 3**
(file-based routing), and **sub-project 4** (Vite dev server + build helpers).
It also ships **sub-project 5**: CLI, scaffolding, and deploy adapters. Design specs live under
[`docs/superpowers/specs/`](./docs/superpowers/specs).

## Install

```bash
npm install bangala
```

Requires Node.js 22 or newer.

## Quickstart

**1. Create a project.**

```bash
npx bangala create my-site --adapter netlify
cd my-site
npm install
npm run dev
```

**2. Write a `.bangala` page.** `pages/index.bangala`:

```bangala
---
const { user } = props
---
<h1>Hello {user.name}</h1>
```

**3. Build or deploy from the CLI.**

```bash
npx bangala build
npx bangala deploy vercel --force
```

**4. Compile on the server.** `compile()` takes a source string and returns the
generated ESM module text plus the island manifest:

```ts
import { compile } from "bangala";

const source = await fs.readFile("pages/index.bangala", "utf8");
const result = compile(source, { filename: "pages/index.bangala" });

// result.code         — the ESM module source (string)
// result.islands      — [{ componentPath, strategy }, ...]
// result.dependencies — paths of imported .bangala files (for watch mode)
```

**5. Execute the compiled module.** It exports `render(props)` returning a
Promise of HTML. How you transpile and import the emitted code is your call
(Vite, esbuild, tsx, or another ESM loader). Once you have the module:

```ts
const html = await page.render({ user: { name: "Ada" } });
// <h1>Hello Ada</h1>
```

**6. Build a route manifest.** The routing core is published as
`bangala/router`. It is framework-agnostic and does not start an HTTP server;
the Vite helpers and CLI wire it into dev/build tooling:

```ts
import { discoverRoutes, matchRoute } from "bangala/router";

const routes = await discoverRoutes("pages");
const match = matchRoute(routes, "/blog/hello-world");

// pages/index.bangala          -> /
// pages/blog/[slug].bangala    -> /blog/:slug
// pages/docs/[...parts].bangala -> /docs/*parts
```

**7. Wire the client runtime in the page HTML.** The runtime is published as
`bangala/client/auto`. The Vite build helper bundles it automatically; if you
are wiring your own bundler, include it as a module script:

```html
<script type="module" src="/bangala-client.js"></script>
```

Or call `hydrate()` yourself for fine-grained control:

```ts
import { hydrate } from "bangala/client";

hydrate(document, {
  onError: (error) => reportToMonitoring(error),
});
```

**8. Use the Vite helpers.** `bangala/vite` ships the plugin and programmable
dev/build helpers used by the CLI:

```ts
import { createBangalaDevServer, buildBangala } from "bangala/vite";

const dev = await createBangalaDevServer({ root: process.cwd() });
await dev.listen(5173);

await buildBangala({
  root: process.cwd(),
  outDir: "dist",
  prerender: ["/blog/hello-world"], // dynamic routes opt in explicitly
});
```

## API reference

### `compile(source, options)`

Compiles a `.bangala` source string into an ESM module.

| Parameter | Type | Description |
|---|---|---|
| `source` | `string` | The `.bangala` source. |
| `options.filename` | `string` | File path, used in error messages. |

Returns `CompileResult`:

```ts
interface CompileResult {
  code: string;             // generated ESM module source
  islands: IslandRef[];     // islands found in this file
  dependencies: string[];   // absolute/relative paths of imported .bangala files
}

interface IslandRef {
  componentPath: string;
  strategy: "client:load" | "client:idle" | "client:visible";
}
```

The compiled module exports `render(props): Promise<string>`.

### `discoverRoutes(root, options?)`

Walks a directory and returns a sorted manifest of `.bangala` page routes.
Private files and folders starting with `_` or `.` are ignored.

```ts
import { discoverRoutes, createRoutes, matchRoute } from "bangala/router";

const routes = await discoverRoutes("pages");
const match = matchRoute(routes, "/docs/install");
```

Supported file conventions:

| File | Route |
|---|---|
| `pages/index.bangala` | `/` |
| `pages/about.bangala` | `/about` |
| `pages/blog/index.bangala` | `/blog` |
| `pages/blog/[slug].bangala` | `/blog/:slug` |
| `pages/docs/[...parts].bangala` | `/docs/*parts` |

`matchRoute(routes, pathname)` returns `{ route, pathname, params }` or `null`.
Dynamic params are strings; catch-all params are string arrays.

### `bangala()` Vite plugin

The Vite plugin compiles `.bangala` files on demand, resolves component imports,
and installs a route middleware when `pages` is enabled.

```ts
import { defineConfig } from "vite";
import { bangala } from "bangala/vite";

export default defineConfig({
  plugins: [bangala({ pages: "pages" })],
});
```

### `createBangalaDevServer(options?)`

Creates a Vite dev server configured for Bangala routes. It does not call
`listen()` for you, so CLIs and custom servers can decide the host/port.

```ts
const server = await createBangalaDevServer({ root: process.cwd() });
await server.listen(5173);
```

### `buildBangala(options?)`

Bundles `bangala/client/auto` and prerenders HTML files into `outDir`.
Static routes are prerendered by default. Dynamic routes must be passed through
`prerender`.

```ts
await buildBangala({
  root: process.cwd(),
  pages: "pages",
  outDir: "dist",
  prerender: ["/blog/first-post"],
});
```

### CLI

The package exposes a `bangala` binary:

```bash
bangala dev --port 5173
bangala build --out-dir dist --prerender /blog/first-post
bangala create my-site --adapter netlify
bangala deploy cloudflare-pages --force
```

The generated project uses the same Vite helpers under the hood:

```json
{
  "scripts": {
    "dev": "bangala dev",
    "build": "bangala build"
  }
}
```

### `bangala/adapters`

Deployment adapters are plain file writers for static hosts:

```ts
import { applyDeployAdapter, listDeployAdapters } from "bangala/adapters";

console.log(listDeployAdapters());
await applyDeployAdapter(process.cwd(), "vercel", { outDir: "dist" });
```

Built-in adapters: `static`, `netlify`, `vercel`, `cloudflare-pages`.

### `hydrate(root?, options?)`

Scans `root` (default: `document`) for `<bangala-island>` markers and hydrates
each one according to its `data-strategy`. The call is idempotent — already
hydrated markers are skipped.

```ts
interface HydrateOptions {
  onError?: (error: HydrationError) => void;
}

interface HydrationError {
  el: HTMLElement;
  code: ErrorCode;
  entry?: string;
  cause?: unknown;
}
```

Every error also dispatches a bubbling `bangala:island-error` `CustomEvent`
on the affected `<bangala-island>` element, whose `detail` matches the
`HydrationError` passed to `onError`. A throw from `onError` is swallowed so it
cannot break the rest of the page.

### Island module contract

An island is an ESM module that exports an async `mount` function:

```ts
export async function mount(
  el: HTMLElement,
  props: Record<string, unknown>,
  ctx: { strategy: "load" | "idle" | "visible"; entry: string },
): Promise<void> {
  // `el` still contains the SSR HTML — read it, augment it, or replace it.
  el.querySelector("button")!.addEventListener("click", () => {
    // ...
  });
}
```

The runtime guarantees that `props` has been parsed from `data-props` before
`mount` is called. The return value is currently ignored; a cleanup function
return is reserved for a future unmount/HMR signal.

## Hydration strategies

| Directive | When it hydrates |
|---|---|
| `client:load` | Immediately, in the same tick as the scan. |
| `client:idle` | At `requestIdleCallback` with a 2s timeout. Safari falls back to `setTimeout(fn, 1)`. |
| `client:visible` | When the element enters the viewport, with a 200px `rootMargin`. Falls back to immediate hydration when `IntersectionObserver` is unavailable. |

## Error codes

Each error sets `data-hydrated="error"` and `data-hydration-error="<code>"` on
the `<bangala-island>` element, logs to `console.error`, invokes `onError`,
then dispatches `bangala:island-error`.

| Code | When it fires |
|---|---|
| `missing-entry` | The `<bangala-island>` element has no `data-entry` (or it is empty). |
| `invalid-props` | `JSON.parse(data-props)` threw. (A missing `data-props` defaults to `{}` and is not an error.) |
| `unknown-strategy` | `data-strategy` is present but not one of `load`, `idle`, `visible`. |
| `import-failed` | `import(data-entry)` rejected (404, syntax error, network failure). |
| `missing-mount` | The imported module did not expose a callable `mount` export. |
| `mount-failed` | `mount(el, props, ctx)` threw or returned a rejected promise. |

The string codes are stable across versions; the human messages logged
alongside them are free to evolve.

## Roadmap

bangala.js is structured as five sub-projects, each with its own spec/plan
cycle. v0.5.0 delivers all five planned v1 foundations:

| # | Sub-project | Status |
|---|---|---|
| 1 | `.bangala` compiler + server runtime | Shipped in v0.1.0 |
| 2 | Client islands runtime | Shipped in v0.1.0 |
| 3 | File-based routing | Shipped in v0.2.0 |
| 4 | Dev server + build (Vite) | Shipped in v0.3.0 |
| 5 | CLI + scaffolding + deploy adapters | Shipped in v0.5.0 |

Designs live in [`docs/superpowers/specs/`](./docs/superpowers/specs).

## Contributing

bangala.js is being built in the open. See
[CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) (c) bangala.js contributors
