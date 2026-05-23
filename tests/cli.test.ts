import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, main } from "../src/cli.js";
import {
  banner,
  buildSummary,
  color,
  devSummary,
  formatBytes,
  formatDuration,
} from "../src/cli-format.js";
import { findFreePort } from "../src/cli-net.js";

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

describe("cli-net findFreePort", () => {
  it("returns the preferred port when it is free", async () => {
    // Pick a high port unlikely to be bound on a fresh machine.
    const port = await findFreePort(45123);
    expect(port).toBe(45123);
  });

  it("skips a busy port and returns the next free one", async () => {
    const occupied = 45200;
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(occupied, "127.0.0.1", () => resolve());
    });

    try {
      const port = await findFreePort(occupied);
      expect(port).toBeGreaterThan(occupied);
      expect(port).toBeLessThanOrEqual(occupied + 20);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("cli-format helpers", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it("color() returns plain text when not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    expect(color("cyan", "hello")).toBe("hello");
  });

  it("color() respects NO_COLOR even on a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.NO_COLOR = "1";
    expect(color("red", "warn")).toBe("warn");
  });

  it("color() wraps with ANSI escapes when colors are enabled", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.NO_COLOR;
    const out = color("cyan", "hi");
    expect(out.startsWith("\x1b[")).toBe(true);
    expect(out.endsWith("\x1b[0m")).toBe(true);
    expect(out).toContain("hi");
  });

  it("buildSummary renders pages, output, duration, and bundle size", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    delete process.env.NO_COLOR;
    const out = buildSummary({
      pages: 3,
      outDir: "dist",
      durationMs: 1234,
      clientBytes: 2048,
      clientGzipBytes: 900,
    });
    expect(out).toContain("build complete");
    expect(out).toContain("1.23s");
    expect(out).toContain("3");
    expect(out).toContain("dist");
    expect(out).toContain("2.00 kB");
    expect(out).toContain("gzip");
  });

  it("buildSummary omits client line when no bundle size given", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const out = buildSummary({ pages: 1, outDir: "dist", durationMs: 50 });
    expect(out).toContain("build complete");
    expect(out).not.toContain("client");
  });

  it("devSummary mentions port change when provided", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const out = devSummary({
      url: "http://127.0.0.1:5174/",
      pages: "pages",
      portChangedFrom: 5173,
    });
    expect(out).toContain("Local");
    expect(out).toContain("http://127.0.0.1:5174/");
    expect(out).toContain("5173");
  });

  it("banner includes the version", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(banner("9.9.9")).toContain("bangala.js");
    expect(banner("9.9.9")).toContain("v9.9.9");
  });

  it("formatDuration scales correctly", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(125000)).toMatch(/2m/);
  });

  it("formatBytes scales correctly", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.00 kB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });
});
