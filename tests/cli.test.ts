import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, main } from "../src/cli.js";

let tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots = [];
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bangala-cli-"));
  tmpRoots.push(root);
  return root;
}

describe("bangala CLI", () => {
  it("prints help and version", async () => {
    const help: string[] = [];
    const version: string[] = [];

    await expect(main(["--help"], { stdout: (line) => help.push(line) })).resolves.toBe(0);
    await expect(main(["--version"], { stdout: (line) => version.push(line) })).resolves.toBe(0);

    expect(help.join("\n")).toContain("bangala dev");
    expect(version[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("scaffolds a minimal project", async () => {
    const root = join(tmpRoot(), "My App");

    const result = await createProject(root, {
      packageVersion: "0.4.0",
      adapter: "netlify",
    });

    expect(result.files).toContain("pages/index.bangala");
    await expect(readFile(join(root, "package.json"), "utf8")).resolves.toContain(
      '"bangala": "^0.4.0"',
    );
    await expect(readFile(join(root, "pages/index.bangala"), "utf8")).resolves.toContain(
      "<!doctype html>",
    );
    await expect(readFile(join(root, "netlify.toml"), "utf8")).resolves.toContain(
      'publish = "dist"',
    );
  });

  it("configures a deploy adapter through the CLI", async () => {
    const root = tmpRoot();
    const out: string[] = [];

    const code = await main(
      ["deploy", "cloudflare-pages", "--root", root, "--out-dir", "public"],
      { stdout: (line) => out.push(line) },
    );

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("configured cloudflare-pages");
    await expect(readFile(join(root, "wrangler.toml"), "utf8")).resolves.toContain(
      'pages_build_output_dir = "public"',
    );
  });

  it("builds a scaffolded project through the CLI", async () => {
    const root = join(tmpRoot(), "site");
    const out: string[] = [];
    await createProject(root, { packageVersion: "0.4.0" });

    const code = await main(["build", "--root", root], { stdout: (line) => out.push(line) });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("built 1 page(s)");
    await expect(stat(join(root, "dist/index.html"))).resolves.toBeTruthy();
    await expect(stat(join(root, "dist/assets/bangala-client.js"))).resolves.toBeTruthy();
  });
});
