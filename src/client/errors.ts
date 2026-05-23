export type ErrorCode =
  | "missing-entry"
  | "invalid-props"
  | "unknown-strategy"
  | "import-failed"
  | "missing-mount"
  | "mount-failed";

export interface HydrationError {
  el: HTMLElement;
  code: ErrorCode;
  entry?: string;
  cause?: unknown;
}

export interface HydrateOptions {
  onError?: (error: HydrationError) => void;
}

export function reportError(
  error: HydrationError,
  onError?: HydrateOptions["onError"],
): void {
  error.el.dataset.hydrated = "error";
  error.el.dataset.hydrationError = error.code;
  console.error(`[bangala] hydration ${error.code}`, error.cause ?? error);
  if (onError) {
    try {
      onError(error);
    } catch {
      // A throw from user code must never abort the rest of the page's hydration.
    }
  }
  error.el.dispatchEvent(
    new CustomEvent<HydrationError>("bangala:island-error", {
      detail: error,
      bubbles: true,
    }),
  );
}
