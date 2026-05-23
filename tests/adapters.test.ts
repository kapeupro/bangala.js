import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeployAdapter,
  createDeployAdapter,
  listDeployAdapters,
} from "../src/adapters.js";

let tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots = [];
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bangala-adapters-"));
  tmpRoots.push(root);
  return root;
}

describe("deploy adapters", () => {
  it("lists the built-in adapter names", () => {
    expect(listDeployAdapters()).toEqual([
      "static",
      "netlify",
      "vercel",
      "cloudflare-pages",
    ]);
  });

  it("creates provider config files with the selected outDir", () => {
    expect(createDeployAdapter("netlify", { outDir: "public" }).files[0]).toMatchObject({
      path: "netlify.toml",
      contents: expect.stringContaining('publish = "public"'),
    });
    expect(createDeployAdapter("vercel", { outDir: "public" }).files[0]).toMatchObject({
      path: "vercel.json",
      contents: expect.stringContaining('"outputDirectory": "public"'),
    });
    expect(createDeployAdapter("cloudflare", { outDir: "public" }).files[0]).toMatchObject({
      path: "wrangler.toml",
      contents: expect.stringContaining('pages_build_output_dir = "public"'),
    });
  });

  it("writes adapter files and refuses overwrite without force", async () => {
    const root = tmpRoot();

    await applyDeployAdapter(root, "vercel", { outDir: "dist" });
    await expect(readFile(join(root, "vercel.json"), "utf8")).resolves.toContain(
      '"outputDirectory": "dist"',
    );
    await expect(applyDeployAdapter(root, "vercel")).rejects.toThrow("without --force");

    writeFileSync(join(root, "vercel.json"), "{}\n");
    await applyDeployAdapter(root, "vercel", { outDir: "public", force: true });
    await expect(readFile(join(root, "vercel.json"), "utf8")).resolves.toContain(
      '"outputDirectory": "public"',
    );
  });
});
