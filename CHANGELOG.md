# Changelog

All notable changes to bangala.js are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
