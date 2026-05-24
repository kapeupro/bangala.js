# bangala.js end-to-end tests

Playwright suite that exercises a freshly built `_site/` in a real Chromium
browser. Catches regressions that the unit suite (in `tests/*.test.ts`) cannot:
hydration races, runtime console errors, layout overflow on mobile, and the
client-side playground.

## What's covered

- `smoke.spec.ts` — every emitted page (`/`, `/docs`, `/docs/*`, `/play`,
  `/vs/nextjs`, `/benchmarks`) returns 200, has the expected `<title>`, and
  produces zero browser console errors after `networkidle`.
- `hydration.spec.ts` — the three islands on `/` (counter, theme-toggle,
  bytes-counter) actually hydrate, and `data-hydrated="true"` is set on each
  custom element.
- `playground.spec.ts` — `/play` boots, the bundled compiler loads from
  esm.sh, edits to the textarea re-render the iframe, and presets swap the
  source.
- `responsive.spec.ts` — at iPhone 13 viewport, no page produces horizontal
  overflow and the nav stays reachable.

## Run

```bash
npm run e2e         # headless, list reporter
npm run e2e:ui      # interactive UI mode
```

The `webServer` declared in `playwright.config.ts` will:

1. Build the docs site (`node ./dist/cli.js build --pages docs --out-dir _site`).
2. Serve `_site/` over a tiny dependency-free Node HTTP server at
   `http://127.0.0.1:4173` (`static-server.ts`).

We deliberately avoid a `serve` / `http-server` devDependency — see
`static-server.ts`. It supports directory `index.html` fallback and the MIME
types we actually emit.

## Why Chromium only

bangala.js's runtime is plain ES2022 + Custom Elements. We rely on `WebKit`/
`Firefox` cross-browser behaviour being uniform enough that Chromium gates
caught everything in practice. Adding more projects costs CI minutes; opt
back in later if a Safari-specific bug appears.

## CI

The `e2e` job in `.github/workflows/test.yml` runs `npx playwright install
--with-deps chromium` then `npm run e2e`. It needs the `test` job to pass first
so we don't waste browser-install time on broken builds.
