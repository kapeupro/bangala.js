/**
 * Presentational helpers for the bangala CLI.
 *
 * Pure functions only: no process I/O, no side effects beyond reading
 * `process.stdout.isTTY` to decide whether ANSI escape codes are emitted.
 *
 * Color support degrades gracefully on non-TTY (CI logs) and when the
 * NO_COLOR / FORCE_COLOR environment variables are set per the de-facto
 * conventions (https://no-color.org, https://force-color.org).
 */

export type ColorName = "cyan" | "green" | "yellow" | "red" | "orange" | "dim" | "bold";

const CODES: Record<ColorName, string> = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  // bright yellow approximates "orange" in most palettes (no truecolor needed)
  orange: "\x1b[38;5;208m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};
const RESET = "\x1b[0m";

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

export function color(name: ColorName, text: string): string {
  if (!colorsEnabled()) return text;
  return `${CODES[name]}${text}${RESET}`;
}

/**
 * Renders a URL as an OSC 8 hyperlink. Terminals that don't support the
 * sequence ignore the wrapping escapes and just display the URL.
 */
export function clickableUrl(url: string): string {
  if (!colorsEnabled()) return url;
  return `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
}

/**
 * Compact, tasteful header. Two lines: the brand and a short tagline.
 */
export function banner(version: string): string {
  const brand = color("orange", color("bold", "bangala.js"));
  const ver = color("dim", `v${version}`);
  const tag = color("dim", "HTML-first, ship minimal JavaScript.");
  return `\n  ${brand}  ${ver}\n  ${tag}\n`;
}

export interface BuildSummaryOpts {
  pages: number;
  outDir: string;
  durationMs: number;
  clientBytes?: number;
  clientGzipBytes?: number;
}

export function buildSummary(opts: BuildSummaryOpts): string {
  const lines: string[] = [];
  const check = color("green", "OK");
  lines.push(`  ${check} ${color("bold", "build complete")} ${color("dim", `in ${formatDuration(opts.durationMs)}`)}`);
  lines.push(`     ${color("dim", "pages   ")} ${opts.pages}`);
  lines.push(`     ${color("dim", "output  ")} ${opts.outDir}`);
  if (opts.clientBytes !== undefined) {
    const sizes = opts.clientGzipBytes !== undefined
      ? `${formatBytes(opts.clientBytes)} ${color("dim", `(${formatBytes(opts.clientGzipBytes)} gzip)`)}`
      : formatBytes(opts.clientBytes);
    lines.push(`     ${color("dim", "client  ")} ${sizes}`);
  }
  return lines.join("\n");
}

export interface DevSummaryOpts {
  url: string;
  network?: string;
  pages: string;
  portChangedFrom?: number;
}

export function devSummary(opts: DevSummaryOpts): string {
  const lines: string[] = [];
  const arrow = color("cyan", ">");
  lines.push(`  ${arrow} ${color("bold", "Local")}    ${clickableUrl(opts.url)}`);
  if (opts.network) {
    lines.push(`  ${arrow} ${color("bold", "Network")}  ${clickableUrl(opts.network)}`);
  }
  lines.push(`  ${arrow} ${color("bold", "Pages")}    ${color("dim", opts.pages)}`);
  if (opts.portChangedFrom !== undefined) {
    lines.push(color("dim", `    port ${opts.portChangedFrom} was busy, using next free port`));
  }
  lines.push("");
  lines.push(color("dim", "  press Ctrl+C to stop"));
  return lines.join("\n");
}

export function nextStepsBlock(projectDir: string): string {
  return [
    color("green", `Created ${projectDir}/`),
    "",
    color("dim", "Next steps:"),
    color("dim", `  cd ${projectDir}`),
    color("dim", `  npm install`),
    color("dim", `  npm run dev`),
  ].join("\n");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}
