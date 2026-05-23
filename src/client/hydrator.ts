import { scan, type ScanResult } from "./scanner.js";
import { getStrategy, type StrategyName } from "./strategies.js";
import { reportError, type HydrateOptions, type HydrationError } from "./errors.js";

export type Loader = (entry: string) => Promise<unknown>;

const defaultLoader: Loader = (entry) => import(/* @vite-ignore */ entry);

export interface MountContext {
  strategy: StrategyName;
  entry: string;
}

type IslandModule = {
  mount: (el: HTMLElement, props: Record<string, unknown>, ctx: MountContext) => unknown;
};

export function hydrate(root: ParentNode = document, options: HydrateOptions = {}): void {
  hydrateWith(defaultLoader, root, options);
}

/** Same as hydrate(), but with an injectable module loader. Exported for tests. */
export function hydrateWith(
  loader: Loader,
  root: ParentNode = document,
  options: HydrateOptions = {},
): void {
  for (const result of scan(root)) {
    if (!result.ok) {
      reportError(
        { el: result.el, code: result.code, entry: result.entry },
        options.onError,
      );
      continue;
    }
    result.el.dataset.hydrated = "scheduled";
    const ctx: MountContext = { strategy: result.strategy, entry: result.entry };
    getStrategy(result.strategy)(result.el, () => {
      void runMount(loader, result, ctx, options);
    });
  }
}

async function runMount(
  loader: Loader,
  scanned: Extract<ScanResult, { ok: true }>,
  ctx: MountContext,
  options: HydrateOptions,
): Promise<void> {
  let mod: unknown;
  try {
    mod = await loader(scanned.entry);
  } catch (cause) {
    return fail(scanned.el, "import-failed", scanned.entry, cause, options);
  }

  const mount = (mod as Partial<IslandModule>)?.mount;
  if (typeof mount !== "function") {
    return fail(scanned.el, "missing-mount", scanned.entry, undefined, options);
  }

  try {
    await mount(scanned.el, scanned.props, ctx);
  } catch (cause) {
    return fail(scanned.el, "mount-failed", scanned.entry, cause, options);
  }

  scanned.el.dataset.hydrated = "true";
}

function fail(
  el: HTMLElement,
  code: HydrationError["code"],
  entry: string,
  cause: unknown,
  options: HydrateOptions,
): void {
  reportError({ el, code, entry, cause }, options.onError);
}
