<div align="center">

<img src="./docs/logo.svg" width="96" alt="bangala.js logo" />

# bangala.js

### The full-stack framework that doesn't make you pay for JavaScript you don't use.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Status: Design Phase](https://img.shields.io/badge/status-design%20phase-orange.svg)](./docs/superpowers/specs)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

> ⚠️ **Early development.** bangala.js is in its design phase. There is no
> usable release yet — what lives here today is the architecture and the spec
> of the first sub-project. Follow along, open issues, and shape the framework
> while it's still clay. The roadmap is below.

---

## Why bangala.js?

Your visitors download hundreds of kilobytes of JavaScript today just to render
text. bangala.js flips the default: **your pages are HTML. JavaScript only ships
where you explicitly ask for it.**

- 🪨 **Zero JS by default** — a component renders on the server and sends
  *nothing* to the browser. No runtime, no hydration, no bundle. A content page
  weighs what it displays.
- 🏝️ **Islands, not an ocean** — need interactivity? Mark a component with
  `client:load` and only that component becomes an interactive island, loaded
  independently. The rest of the page stays inert, instant HTML.
- 📄 **The `.bangala` format** — HTML enriched with a server frontmatter, `{}`
  expressions, and `{#if}` / `{#each}` blocks. You write pages, not component
  trees.
- ⚡ **Compiled, not interpreted** — every `.bangala` file compiles to a plain
  JavaScript module. Server rendering is pure string concatenation — the
  fastest SSR operation there is.

## A taste

```bangala
---
const posts = await db.posts.recent()
---
<h1>The blog</h1>

{#each posts as post}
  <article>{post.title}</article>
{/each}

<Newsletter client:load />   <!-- the only piece of JS on the page -->
```

> **Next.js ships the framework. bangala.js ships the page.**

## Roadmap

bangala.js is built as five focused sub-projects, each with its own design spec
and implementation cycle.

| # | Sub-project | Status |
|---|---|---|
| 1 | **`.bangala` compiler + server renderer** | 🎯 Design done — [spec](./docs/superpowers/specs/2026-05-22-bangala-compiler-design.md) |
| 2 | Client-side islands runtime | 📋 Planned |
| 3 | File-based routing | 📋 Planned |
| 4 | Dev server + build (Vite) | 📋 Planned |
| 5 | CLI + scaffolding + deploy adapters | 📋 Planned |

The current design document lives in
[`docs/superpowers/specs/`](./docs/superpowers/specs).

## Contributing

bangala.js is being built in the open and contributions are welcome — code,
design feedback, issues, docs. Start with [CONTRIBUTING.md](./CONTRIBUTING.md)
and our [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © bangala.js contributors
