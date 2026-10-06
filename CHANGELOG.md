# Changelog

All notable changes to bangala.js are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Islands work end to end.** `<Counter client:load/>` is hydrated by the sibling `Counter.client.ts` (or `.tsx`, `.mts`, `.js`, `.jsx`, `.mjs`) exporting `mount()`. The dev server serves it as source; `buildBangala()` / `bangala build` bundles only the islands that pages use into `assets/islands/` and rewrites each `data-entry`. A missing client module is a clear error. Before, the compiler emitted `data-entry="./Counter"`, which no browser could load, and the starter hand-wrote its `<bangala-island>` marker.
- **Live reload in `bangala dev`.** Editing a `.bangala` file reloads the page. The dev server no longer disables Vite's WebSocket, which logged connection errors on every page.
- `compile()` options `islandEntry` (map an island component to its `data-entry` URL) and `rewriteBangalaImports` (keep `.bangala` specifiers for bundlers that load them).
- `emptyOutDir` option for `buildBangala()`, mirroring Vite: defaults to `true` when `outDir` is inside the project root; an `outDir` outside the root is only emptied when `emptyOutDir: true` is passed (otherwise existing files are kept and a single warning is printed).

### Fixed

- TypeScript in the frontmatter now works through the Vite plugin (dev and build); the generated module is transpiled before Vite sees it.
- `buildBangala()` applies `options.vite` (plugins, `define`, aliases…) when prerendering pages, not only to the client bundle, and prefixes asset URLs with `vite.base`.
- **The frontmatter is parsed as JavaScript, not as lines of text.** A small JavaScript/TypeScript lexer (`src/jslex.ts`) now drives the frontmatter fence, `import`/`export` hoisting and template `{expr}` scanning, so strings, template literals, comments and regex literals can hold `---`, `{`, `}`, `import` or `export` safely.
  - The frontmatter is emitted byte for byte. Multi-line template literals and line continuations are no longer re-indented (#2).
  - Imports work with CRLF line endings, on several lines, several per line, without spaces (`import{a}from"x"`), with `with { type: "json" }`, and in every clause form (`import X, { y }`, `import { default as X }`, `import * as X`).
  - Multi-line exports are hoisted whole: `export const x = {…}`, `export interface`, `export type`, `export enum`, overloads, functions with braces in strings, comments or regexes, and multi-line signatures.
  - Text that only looks like `import`/`export` (in a string, comment or object key) is no longer hoisted.
  - `.bangala` specifiers are rewritten in re-exports and literal `import()` calls, and every imported `.bangala` file is listed in `dependencies`.
  - The fence scan now also understands regex literals and braces inside `${…}`: `/\/*$/`, `` /`/ `` or `` `${"{"}` `` no longer make it swallow the template (#1 was fixed in 1.0.0 for strings, template literals and comments). Fences may carry surrounding spaces, and CR-only line endings work.
- **A frontmatter binding can no longer disable HTML escaping.** The generated module reaches its helpers through the reserved `$$bangala` namespace, so a local or imported `escape`, `island`, `renderComponent`, `render` or `Promise` (including an `{#each}` item) no longer replaces them. Before, `function escape()` in the frontmatter turned off escaping for the whole page.
- **An island's `children` prop is no longer rendered as raw HTML.** `island()` strips it, and the compiler rejects a `children` prop on any component.
- Static attribute values keep the character references the author wrote (`href="?a=1&amp;b=2"` was emitted as `&amp;amp;`), and static component props are decoded (`title="Fish &amp; Chips"` passes `Fish & Chips`; numeric references and common named ones such as `&copy;` and `&mdash;` are supported).
- Template `{expr}`, dynamic attributes and `{#if}`/`{#each}` headers handle braces in strings, template literals, regexes and comments, and a trailing `//` comment no longer breaks the generated code.
- `{#each}` accepts multi-line lists, Unicode and `$` item names, and TypeScript `as` casts in the list.
- Block tokens tolerate whitespace (`{/if }`, `{:else }`), and closing tags accept whitespace and any letter case (`</div >`, `</DIV>`).
- Errors are clearer and point at the cause: unclosed tags, blocks and braces are reported at their opener with the real closing tag as suggestion; unterminated strings, template literals and comments in the frontmatter are located; `{:else if}`, `{@html}`, unknown blocks (`{#iff}`), misplaced `{:else}`, mismatched block closers, `{#each}` destructuring or index, and components imported from non-`.bangala` modules get dedicated messages.
- The docs blog recipe exported `getStaticPaths()` without exporting the `posts` it reads.
- `buildBangala()` / `bangala build` no longer delete project sources when `outDir` points at the wrong place. An `outDir` that is the project root (`.`), an ancestor of it (`..`), the filesystem root, or that overlaps the pages directory or Vite's `public/` directory is now rejected with an error naming the resolved path, before anything is removed. An `outDir` outside the project root is no longer silently emptied.
- Prerendering can no longer write outside `outDir` or overwrite other pages. `getStaticPaths()` param values (and each catch-all item) must be single, non-empty path segments: empty strings, `.`, `..`, `/`, `\` and NUL bytes are rejected with an error naming the route file. Pathnames from the `prerender` option are checked the same way (including percent-encoded `%2E%2E`), and every output file is verified to resolve inside `outDir`.

### Changed

- The client runtime is only injected into pages that contain an island, so static pages ship no JavaScript (dev and build).
- `bangala create` scaffolds `<Counter start={0} client:load/>` with `components/Counter.client.js` instead of a hand-written marker and `public/islands/Counter.client.js`.
- The Vite plugin keeps `.bangala` import specifiers and no longer redirects `./x.js` imports to a sibling `x.bangala`, which hid real `.js` modules; root-absolute and package `.bangala` imports now resolve.
- A frontmatter without a closing `---` line is now an error instead of swallowing the whole template.
- `export default`, exporting `render`, `export { local }` for a non-exported frontmatter local, a `children` component prop and the identifiers `$$bangala` / `$$render` are now compile errors.
- `{}` is an error, and `{/* comment */}` renders nothing (it used to render `undefined`).
- The generated module's shape changed (`$$bangala.escape(…)`, `$$render`); it still exports `render` and a default `{ render }`. The runtime helpers `escape`, `island` and `renderComponent` are no longer implicitly in scope in the frontmatter: import what you use from `bangala/runtime` (an unimported `escape()` would now call the browser's legacy global).
- An `{#each}` item may not be named `props`.

## [1.0.0] - 2026-05-24

### Added

- **Routed layouts.** `_layout.bangala` files are discovered by the router, attached to descendant routes, and rendered outermost-first by the Vite dev server and static build.
- **Dynamic static generation.** Dynamic routes can export `getStaticPaths()` to prerender concrete paths during `buildBangala()` / `bangala build`.
- **Browser e2e coverage.** Added Playwright smoke, hydration, playground, and responsive checks, wired into CI after the unit/typecheck/build matrix.

### Fixed

- Frontmatter parsing now ignores `---` fences inside JavaScript strings, template literals, and comments.
- Exported frontmatter declarations, including `export async function getStaticPaths()`, are emitted at module scope instead of inside `render()`.
- Static HTML attributes and generated `data-props` are escaped correctly before they are embedded in rendered HTML.
- The docs live demo no longer imports the bare specifier `bangala/client/auto` from inline browser code; the build-injected client runtime handles hydration.

## [0.5.0] - 2026-05-23

### Added

- **CLI polish.** Colored terminal output (honors `NO_COLOR` / `FORCE_COLOR`), banner, clickable URLs via OSC 8 hyperlinks, build timing, runtime bundle size (raw + gzip).
- **`bangala dev --open`** opens the dev URL in the default browser after the server starts.
- **Automatic port picking.** When `--port` is not set, `bangala dev` finds the next free port starting from 5173. An explicit `--port` is still respected.
- **Pedagogic parser errors.** `ParseError.format()` renders the source line, surrounding context, a caret marker, and a suggested fix for common mistakes (missing condition in `{#if}`, unclosed tags, quoted attributes, unknown `client:*` directive, malformed `{#each}`).
- **New `bangala create` template.** Scaffolds a real working starter with an interactive `<Counter>` island: `pages/index.bangala`, `components/Counter.bangala`, `public/islands/Counter.client.js`, styles, README, `.gitignore`. `npm install && npm run dev` produces a hydrated counter immediately.
- **`/play` page on bangala.eu** — the bangala compiler running in your browser. Live recompile on every keystroke, three tabs (rendered HTML, generated module, islands manifest), three preset snippets.
- **`/benchmarks` page on bangala.eu** with reproducible measurements: same blog page implemented in bangala / Next.js / Astro. Methodology in `benchmarks/SPEC.md`, measurement script in `benchmarks/measure.js`.
- **`/vs/nextjs` honest comparison page.**

### Fixed

- `docs/islands/*.js` were not being served in production (Vite only copies `public/`). Moved to `public/islands/`. Affects the live demo on the homepage.
- Parser: `<textarea>` content is now treated as raw text (joins `<script>`, `<style>`) so editor hosts can hold `{` / `<` literals without being re-parsed as bangala syntax.

## [0.4.0] - 2026-05-23

### Added

- `bangala` CLI binary with `dev`, `build`, `create`, and `deploy` commands.
- `bangala create` basic starter scaffold with `pages/index.bangala`, styles, package scripts, and optional deploy adapter config.
- `bangala/adapters` public export with `static`, `netlify`, `vercel`, and `cloudflare-pages` deployment helpers.

## [0.3.0] - 2026-05-23

### Added

- `bangala/vite` public export with the `bangala()` Vite plugin.
- `createBangalaDevServer()` programmable dev server using Vite middleware and the file-route manifest.
- `buildBangala()` production build helper that bundles the client runtime and prerenders static routes plus explicit dynamic paths.

## [0.2.0] - 2026-05-23

### Added

- `bangala/router` public export with `discoverRoutes`, `createRoutes`, `routePathFromFile`, and `matchRoute`.
- File-based route conventions for `index.bangala`, static routes, `[param]`, and `[...catchAll]`.
- Deterministic route specificity sorting and duplicate route detection.

## [0.1.1] - 2026-05-23

### Fixed

- Correct npm package metadata to point to `kapeupro/bangala.js`.
- Make the GitHub Actions workflow run the production build after tests.
- Make Vitest resolve `bangala/runtime` from source so tests pass on a fresh checkout before `dist/` exists.

## [0.1.0] - 2026-05-23

First public release.

### Added

- `compile(source, options)` entry point that turns a `.bangala` source into an ESM module, returning `{ code, islands, dependencies }`.
- `.bangala` file format support: server frontmatter (`---`) with `await`, `{expr}` interpolation with automatic HTML escaping, `{#if}` / `{:else}` / `{/if}`, `{#each list as item}` / `{/each}`, capitalized component tags with a default `<slot/>`, and the `client:load` / `client:idle` / `client:visible` directives.
- Three-stage compiler pipeline (parser, analyzer, code generator) with localized syntax errors (line/column).
- Server runtime helpers exported from `bangala/runtime`: `escape`, `renderComponent`, and `island` (emits the inert `<bangala-island>` marker with `data-entry`, `data-props`, `data-strategy`).
- Client islands runtime exported from `bangala/client`: `hydrate(root?, options?)` plus typed `HydrateOptions`, `ErrorCode`, `HydrationError`, and `MountContext`.
- Auto-start entrypoint `bangala/client/auto` that calls `hydrate()` on `DOMContentLoaded` when imported in a browser.
- Three hydration strategies — `load` (immediate), `idle` (`requestIdleCallback` with a 2s timeout, `setTimeout(fn, 1)` fallback for Safari), and `visible` (`IntersectionObserver` with a 200px `rootMargin`, immediate fallback when unavailable).
- Idempotent hydration via a tri-state `data-hydrated` attribute (`scheduled` / `true` / `error`).
- Full error pipeline with six stable error codes (`missing-entry`, `invalid-props`, `unknown-strategy`, `import-failed`, `missing-mount`, `mount-failed`), surfaced via `console.error`, `data-hydration-error`, the optional `onError` callback, and a bubbling `bangala:island-error` CustomEvent.
- Public island module contract: `mount(el, props, { strategy, entry })`.
