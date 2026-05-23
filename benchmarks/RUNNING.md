# Running the benchmarks

The full reproduction script (one-line per framework) is in
[`SPEC.md`](./SPEC.md). This file documents the actual layout of the three
sub-apps and the quirks we hit while scaffolding them.

## Quickstart

```bash
# from the repo root
cd benchmarks/bangala-blog && npm install && npm run build && cd ../..
cd benchmarks/nextjs-blog  && npm install && npm run build && cd ../..
cd benchmarks/astro-blog   && npm install && npm run build && cd ../..
node benchmarks/measure.js
```

`measure.js` writes `benchmarks/results.json`. It has zero npm dependencies
and only reads from each app's build output. If a sub-app failed to build,
its row in `results.json` is `buildOk: false` with an `error` string; the
script does not throw.

## Sub-app layouts

### `bangala-blog/`

Already shipped with the repo. Uses the local bangala (`file:../..`) and
Vite. Build output: `bangala-blog/_site/`.

- HTML: `_site/index.html`
- JS: `_site/assets/*.js` (only `bangala-client.js` is referenced on first
  load; the newsletter island is fetched dynamically and intentionally NOT
  counted as first-load JS — see `measure.js` for the rationale)

### `nextjs-blog/`

Scaffolded **without** `create-next-app` because the version of the network
sandbox the agent runs under blocks fresh `npx` registry fetches outside
already-cached directories. Instead, we wrote a minimal `package.json` by
hand pinning `next@14.2.18`, `react@18`, `react-dom@18`, then `npm install`
inside the directory. The result is functionally equivalent to a stock
App Router scaffold (App Router enabled, `src/` enabled, TypeScript on,
no Tailwind, no ESLint, no Turbo).

If you want to regenerate from scratch and you have a network-enabled
shell:

```bash
cd benchmarks
npx create-next-app@latest nextjs-blog --typescript --app --no-tailwind \
  --no-eslint --src-dir --import-alias '@/*' --use-npm --no-turbo
```

Then replace `src/app/page.tsx` and add `src/app/Newsletter.tsx` from this
repo.

Build output: `nextjs-blog/.next/`.

- HTML: `.next/server/app/index.html` (App Router does emit a static HTML
  for prerendered routes, which `/` is.)
- JS: we parse `.next/app-build-manifest.json` and `.next/build-manifest.json`
  and sum the polyfill plus the chunks Next.js lists for `/page` and
  `/layout` — i.e. **what the `/` route actually ships**, not every JS file
  in `.next/static/`. This matches what Next reports as "First Load JS".

### `astro-blog/`

Scaffolded by hand for the same sandbox reason. Stock Astro 4 install, no
framework integration (no `@astrojs/react`/`@astrojs/preact`), because the
spec's newsletter is the **vanilla `<script>` flavour of an Astro island**
— the closest equivalent to bangala's island model. With this setup Astro
inlines the few hundred bytes of newsletter JS into the HTML and emits zero
external `.js` files.

Build output: `astro-blog/dist/`.

- HTML: `dist/index.html`
- JS: `dist/_astro/*.js` (empty in our config; the inline script is
  measured as part of HTML)

## Caveats

- HTML metric for Astro **includes** the inlined newsletter script. That's
  the right call: it's still bytes the browser has to download.
- JS metric for Next.js is "what `/` ships", not "everything in `.next`".
  See `measureNextjs()` in `measure.js`.
- Next.js's "First Load JS" headline (e.g. `87.6 kB`) uses Next's own
  size estimator. We report Node's `gzipSync` over the on-disk files,
  which lands a bit higher because gzip beats Next's estimator on certain
  chunks. The orders of magnitude are right; the exact number won't match
  the build log.

## Re-generating posts.json

```bash
node benchmarks/posts.json.gen.mjs
```
