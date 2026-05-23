import type { ErrorCode } from "./errors.js";
import type { StrategyName } from "./strategies.js";

const SELECTOR = "bangala-island:not([data-hydrated])";
const VALID_STRATEGIES: ReadonlySet<string> = new Set(["load", "idle", "visible"]);

export type ScanResult =
  | { el: HTMLElement; ok: true; entry: string; props: Record<string, unknown>; strategy: StrategyName }
  | { el: HTMLElement; ok: false; code: ErrorCode; entry?: string };

export function scan(root: ParentNode): ScanResult[] {
  const out: ScanResult[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))) {
    out.push(parseOne(el));
  }
  return out;
}

function parseOne(el: HTMLElement): ScanResult {
  const entry = el.dataset.entry;
  if (!entry) {
    return { el, ok: false, code: "missing-entry" };
  }

  const stratRaw = el.dataset.strategy ?? "load";
  if (!VALID_STRATEGIES.has(stratRaw)) {
    return { el, ok: false, code: "unknown-strategy", entry };
  }
  const strategy = stratRaw as StrategyName;

  const propsRaw = el.dataset.props ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(propsRaw);
  } catch {
    return { el, ok: false, code: "invalid-props", entry };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { el, ok: false, code: "invalid-props", entry };
  }

  return { el, ok: true, entry, props: parsed as Record<string, unknown>, strategy };
}
