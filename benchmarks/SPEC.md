# Benchmark spec

This file describes the **exact same page** built three times — once in
bangala.js, once in Next.js (App Router), once in Astro — so the numbers in
`results.json` compare like for like.

## The page

A static blog homepage at `/`:

- 50 blog post cards, rendered server-side (no JS to render them)
- Each card: `<h2>` title, `<time>` date, `<p>` 2-line excerpt
- A **newsletter signup form** at the bottom: one `<input type="email">` and
  one `<button>` that intercepts submit, sets `disabled=true`, shows a thank-you
  message. **This is the only interactive thing on the page.**

That last point is the whole game. The newsletter form is the only thing that
needs JavaScript:

- In **bangala**, it is a `<Newsletter client:load/>` island. Cards are HTML.
- In **Next.js**, even though the cards are server components, the whole route
  ships the React runtime + a hydration shell because there is a `"use client"`
  leaf component anywhere in the tree.
- In **Astro**, it is `<Newsletter client:load/>` — same model as bangala.

## Data

All three projects read the **same** `benchmarks/posts.json`:

```json
[{ "id": 1, "title": "Post 1", "date": "2026-05-23", "excerpt": "Lorem…" }, …]
```

50 posts. Titles are `Post N`. Dates are today minus `N` days. Excerpts are
the first 200 chars of a standard Lorem Ipsum block.

## What we measure

`benchmarks/measure.js` reads each framework's build output and reports:

| Metric        | What it is                                                              |
| ------------- | ----------------------------------------------------------------------- |
| `jsRaw`       | Sum of `.js` bytes shipped on initial page load (raw).                  |
| `jsGzip`      | Same, but after `gzipSync` (level 9 default).                           |
| `htmlRaw`     | The rendered `index.html` for `/` (raw).                                |
| `htmlGzip`    | Same, gzipped.                                                          |
| `jsFileCount` | How many `.js` files the page references on first load.                 |

For bangala/Astro we walk their output dir for all `.js` files. For Next.js we
parse `.next/build-manifest.json` and sum the JS files listed for the `/` page
(plus the shared chunks — what Next ships for *that* route, not the entire app).

## What we don't measure (and why)

- **No Lighthouse.** Lighthouse requires a headless Chrome and is noisy in CI.
  Bundle size + HTML size are deterministic and strongly correlated with TTI
  for static blog pages, which is the workload we're showing.
- **No runtime CPU.** Same reason. Out of scope for v1.
- **No SPA navigation cost.** This is a static blog. Different frameworks
  shine on different workloads.

## Reproducing

See `benchmarks/RUNNING.md`. Short version:

```bash
# from the repo root
cd benchmarks/bangala-blog && npm install && npm run build && cd ../..
cd benchmarks/nextjs-blog  && npm install && npm run build && cd ../..
cd benchmarks/astro-blog   && npm install && npm run build && cd ../..
node benchmarks/measure.js
```

The script writes `benchmarks/results.json` which the marketing page reads at
build time.

## Caveats

- Numbers will drift with framework versions. We pin nothing in this spec on
  purpose — re-running the benchmarks against latest is part of the point.
- A 50-post static page is the **best case** for HTML-first frameworks.
  Frameworks optimized for SPA navigation will look worse here than they do
  on, say, a dashboard. That is a real difference, not a flaw of either side.
