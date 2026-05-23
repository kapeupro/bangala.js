import { hydrate } from "./hydrator.js";

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrate(), { once: true });
  } else {
    hydrate();
  }
}
