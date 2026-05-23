/**
 * Tiny network helpers for the CLI. No dependencies beyond `node:net`.
 */

import { createServer } from "node:net";

/**
 * Returns the first free TCP port starting at `preferred`, scanning up to
 * `maxAttempts` consecutive ports. Throws if none are free.
 */
export async function findFreePort(preferred: number, maxAttempts = 20): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = preferred + i;
    if (await tryListen(candidate)) return candidate;
  }
  throw new Error(`No free port found in range ${preferred}-${preferred + maxAttempts - 1}`);
}

function tryListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
