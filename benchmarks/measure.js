#!/usr/bin/env node
// benchmarks/measure.js
// Walks each framework's build output and writes benchmarks/results.json.
// Zero npm deps: only node:fs, node:path, node:zlib.

import { readFileSync, statSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = __dirname;

function walkFiles(dir, predicate, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, predicate, acc);
    } else if (entry.isFile() && predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readBuffer(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function gzipBytes(buffer) {
  if (!buffer) return 0;
  return gzipSync(buffer).length;
}

function sumJs(files) {
  let raw = 0;
  let gz = 0;
  for (const file of files) {
    const buf = readBuffer(file);
    if (!buf) continue;
    raw += buf.length;
    gz += gzipBytes(buf);
  }
  return { raw, gz, count: files.length };
}

function measureHtml(path) {
  const buf = readBuffer(path);
  if (!buf) return { raw: 0, gz: 0 };
  return { raw: buf.length, gz: gzipBytes(buf) };
}

function readPackageVersion(pkgPath, depName) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const lockPath = join(dirname(pkgPath), "node_modules", depName, "package.json");
    if (existsSync(lockPath)) {
      const installed = JSON.parse(readFileSync(lockPath, "utf8"));
      return installed.version;
    }
    return (pkg.dependencies && pkg.dependencies[depName]) || (pkg.devDependencies && pkg.devDependencies[depName]) || null;
  } catch {
    return null;
  }
}

function measureBangala() {
  const root = join(ROOT, "bangala-blog");
  const site = join(root, "_site");
  const result = {
    name: "bangala.js",
    version: null,
    buildOk: false,
    jsRawBytes: 0,
    jsGzipBytes: 0,
    htmlRawBytes: 0,
    htmlGzipBytes: 0,
    jsFileCount: 0,
  };
  // Version: read root bangala package.json
  try {
    const rootPkg = JSON.parse(readFileSync(join(ROOT, "..", "package.json"), "utf8"));
    result.version = rootPkg.version || null;
  } catch {}
  if (!existsSync(site)) {
    result.error = "_site directory not found; run `npm run build` in benchmarks/bangala-blog";
    return result;
  }
  const htmlPath = join(site, "index.html");
  if (!existsSync(htmlPath)) {
    result.error = "_site/index.html not found";
    return result;
  }
  // JS files: only count what the page actually references on first load.
  // For bangala, the page <script> references /assets/bangala-client.js.
  // Islands are imported dynamically and not part of first-load JS.
  const jsFiles = walkFiles(join(site, "assets"), (p) => p.endsWith(".js"));
  const js = sumJs(jsFiles);
  const html = measureHtml(htmlPath);
  result.buildOk = true;
  result.jsRawBytes = js.raw;
  result.jsGzipBytes = js.gz;
  result.jsFileCount = js.count;
  result.htmlRawBytes = html.raw;
  result.htmlGzipBytes = html.gz;
  return result;
}

function measureNextjs() {
  const root = join(ROOT, "nextjs-blog");
  const next = join(root, ".next");
  const result = {
    name: "Next.js",
    version: null,
    buildOk: false,
    jsRawBytes: 0,
    jsGzipBytes: 0,
    htmlRawBytes: 0,
    htmlGzipBytes: 0,
    jsFileCount: 0,
  };
  result.version = readPackageVersion(join(root, "package.json"), "next");
  if (!existsSync(next)) {
    result.error = ".next directory not found; run `npm run build` in benchmarks/nextjs-blog";
    return result;
  }
  // Per SPEC: sum the JS files Next ships for the `/` route specifically,
  // not the entire app. App Router uses app-build-manifest.json which lists
  // the chunks per page. We add the polyfill from build-manifest.json so the
  // number reflects what a fresh browser actually downloads.
  const buildManifestPath = join(next, "build-manifest.json");
  const appManifestPath = join(next, "app-build-manifest.json");
  if (!existsSync(buildManifestPath) || !existsSync(appManifestPath)) {
    result.error = "Next.js build manifests missing";
    return result;
  }
  const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
  const appManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
  const chunks = new Set();
  for (const f of buildManifest.polyfillFiles || []) chunks.add(f);
  for (const f of appManifest.pages?.["/page"] || []) chunks.add(f);
  // /layout shares all its chunks with /page; include explicitly in case
  // a future config splits them apart.
  for (const f of appManifest.pages?.["/layout"] || []) chunks.add(f);
  const jsFiles = [];
  for (const rel of chunks) {
    const full = join(next, rel);
    if (existsSync(full)) jsFiles.push(full);
  }
  const js = sumJs(jsFiles);
  const htmlPath = join(next, "server", "app", "index.html");
  const html = existsSync(htmlPath)
    ? measureHtml(htmlPath)
    : { raw: 0, gz: 0 };
  result.buildOk = true;
  result.jsRawBytes = js.raw;
  result.jsGzipBytes = js.gz;
  result.jsFileCount = js.count;
  result.htmlRawBytes = html.raw;
  result.htmlGzipBytes = html.gz;
  if (!existsSync(htmlPath)) {
    result.htmlNote = ".next/server/app/index.html not emitted in this Next.js config";
  }
  return result;
}

function measureAstro() {
  const root = join(ROOT, "astro-blog");
  const dist = join(root, "dist");
  const result = {
    name: "Astro",
    version: null,
    buildOk: false,
    jsRawBytes: 0,
    jsGzipBytes: 0,
    htmlRawBytes: 0,
    htmlGzipBytes: 0,
    jsFileCount: 0,
  };
  result.version = readPackageVersion(join(root, "package.json"), "astro");
  if (!existsSync(dist)) {
    result.error = "dist directory not found; run `npm run build` in benchmarks/astro-blog";
    return result;
  }
  const jsFiles = walkFiles(dist, (p) => p.endsWith(".js"));
  const js = sumJs(jsFiles);
  const htmlPath = join(dist, "index.html");
  const html = existsSync(htmlPath) ? measureHtml(htmlPath) : { raw: 0, gz: 0 };
  result.buildOk = true;
  result.jsRawBytes = js.raw;
  result.jsGzipBytes = js.gz;
  result.jsFileCount = js.count;
  result.htmlRawBytes = html.raw;
  result.htmlGzipBytes = html.gz;
  return result;
}

function main() {
  const frameworks = [measureBangala(), measureNextjs(), measureAstro()];
  const payload = {
    generatedAt: new Date().toISOString(),
    frameworks,
  };
  const outPath = join(ROOT, "results.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
  for (const fw of frameworks) {
    if (fw.buildOk) {
      console.log(
        `  ${fw.name.padEnd(12)} v${fw.version || "?"} ` +
        `js=${fw.jsRawBytes}B (gz ${fw.jsGzipBytes}B, ${fw.jsFileCount} file${fw.jsFileCount === 1 ? "" : "s"}) ` +
        `html=${fw.htmlRawBytes}B (gz ${fw.htmlGzipBytes}B)`
      );
    } else {
      console.log(`  ${fw.name.padEnd(12)} BUILD MISSING: ${fw.error}`);
    }
  }
}

main();
