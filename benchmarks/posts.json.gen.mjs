// One-shot generator for benchmarks/posts.json.
// Re-run when you want to regenerate (uses a fixed "today" so output is stable).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris " +
  "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in " +
  "reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla " +
  "pariatur. Excepteur sint occaecat cupidatat non proident.";

const EXCERPT = LOREM.slice(0, 200);
const BASE = new Date("2026-05-23T00:00:00Z");

const posts = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1;
  const d = new Date(BASE.getTime() - n * 24 * 60 * 60 * 1000);
  return {
    id: n,
    title: `Post ${n}`,
    date: d.toISOString().slice(0, 10),
    excerpt: EXCERPT,
  };
});

writeFileSync(join(here, "posts.json"), JSON.stringify(posts, null, 2) + "\n");
console.log(`wrote ${posts.length} posts to posts.json`);
