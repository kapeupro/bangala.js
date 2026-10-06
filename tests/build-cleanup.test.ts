import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Records whether every Vite server buildBangala() creates gets closed.
const servers: { closed: boolean }[] = [];
vi.mock("vite", async (importOriginal) => {
  const vite = await importOriginal<typeof import("vite")>();
  return {
    ...vite,
    createServer: async (...args: Parameters<typeof vite.createServer>) => {
      const server = await vite.createServer(...args);
      const record = { closed: false };
      servers.push(record);
      const close = server.close.bind(server);
      server.close = async () => {
        record.closed = true;
        return close();
      };
      return server;
    },
  };
});

const { buildBangala } = await import("../src/vite.js");

let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("closes its Vite server when the build fails early", async () => {
  root = mkdtempSync(join(tmpdir(), "bangala-cleanup-"));
  await expect(buildBangala({ root, pages: "missing" })).rejects.toThrow(/ENOENT/);
  expect(servers.length).toBeGreaterThan(0);
  expect(servers.every((server) => server.closed)).toBe(true);
});
