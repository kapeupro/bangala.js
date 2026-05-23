import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEPLOY_ADAPTERS = [
  "static",
  "netlify",
  "vercel",
  "cloudflare-pages",
] as const;

export type DeployAdapterName = (typeof DEPLOY_ADAPTERS)[number];

export interface DeployAdapterOptions {
  outDir?: string;
  buildCommand?: string;
  projectName?: string;
}

export interface ApplyDeployAdapterOptions extends DeployAdapterOptions {
  force?: boolean;
}

export interface DeployFile {
  path: string;
  contents: string;
}

export interface DeployAdapter {
  name: DeployAdapterName;
  files: DeployFile[];
  instructions: string[];
}

export function listDeployAdapters(): DeployAdapterName[] {
  return [...DEPLOY_ADAPTERS];
}

export function createDeployAdapter(
  name: string,
  options: DeployAdapterOptions = {},
): DeployAdapter {
  const adapter = normalizeAdapterName(name);
  const outDir = options.outDir ?? "dist";
  const buildCommand = options.buildCommand ?? "npm run build";
  const projectName = options.projectName ?? "bangala-app";

  switch (adapter) {
    case "static":
      return {
        name: adapter,
        files: [],
        instructions: [
          `Run '${buildCommand}'.`,
          `Upload '${outDir}/' to any static host.`,
        ],
      };
    case "netlify":
      return {
        name: adapter,
        files: [
          {
            path: "netlify.toml",
            contents:
              `[build]\n` +
              `  command = "${tomlString(buildCommand)}"\n` +
              `  publish = "${tomlString(outDir)}"\n\n` +
              `[[headers]]\n` +
              `  for = "/*"\n` +
              `  [headers.values]\n` +
              `    X-Content-Type-Options = "nosniff"\n`,
          },
        ],
        instructions: [
          "Connect the repo on Netlify.",
          `Netlify will run '${buildCommand}' and publish '${outDir}/'.`,
        ],
      };
    case "vercel":
      return {
        name: adapter,
        files: [
          {
            path: "vercel.json",
            contents: `${JSON.stringify({
              framework: null,
              buildCommand,
              outputDirectory: outDir,
            }, null, 2)}\n`,
          },
        ],
        instructions: [
          "Import the repo on Vercel.",
          `Vercel will run '${buildCommand}' and serve '${outDir}/'.`,
        ],
      };
    case "cloudflare-pages":
      return {
        name: adapter,
        files: [
          {
            path: "wrangler.toml",
            contents:
              `name = "${tomlString(projectName)}"\n` +
              `pages_build_output_dir = "${tomlString(outDir)}"\n`,
          },
        ],
        instructions: [
          "Create a Cloudflare Pages project connected to this repo.",
          `Cloudflare Pages will run '${buildCommand}' and serve '${outDir}/'.`,
        ],
      };
  }
}

export async function applyDeployAdapter(
  root: string,
  name: string,
  options: ApplyDeployAdapterOptions = {},
): Promise<DeployAdapter> {
  const adapter = createDeployAdapter(name, options);

  for (const file of adapter.files) {
    const full = join(root, file.path);
    if (existsSync(full) && !options.force) {
      throw new Error(`Refusing to overwrite '${file.path}' without --force`);
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.contents);
  }

  return adapter;
}

function normalizeAdapterName(name: string): DeployAdapterName {
  const normalized = name.trim().toLowerCase();
  if (normalized === "cloudflare" || normalized === "cf-pages") {
    return "cloudflare-pages";
  }
  if (isDeployAdapterName(normalized)) return normalized;
  throw new Error(
    `Unknown deploy adapter '${name}'. Available adapters: ${DEPLOY_ADAPTERS.join(", ")}`,
  );
}

function isDeployAdapterName(name: string): name is DeployAdapterName {
  return DEPLOY_ADAPTERS.includes(name as DeployAdapterName);
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
