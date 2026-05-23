/** Build a <bangala-island> element with the given data-* attributes
 *  and append it to document.body. Optionally append children via the
 *  provided builder (e.g. a <button> for SSR fallback tests). */
export interface IslandAttrs {
  entry?: string | null;
  props?: string | null;
  strategy?: string | null;
  hydrated?: string | null;
}

export function mountIsland(
  attrs: IslandAttrs = {},
  buildChildren?: (el: HTMLElement) => void,
): HTMLElement {
  const el = document.createElement("bangala-island");
  setIfDefined(el, "data-entry", attrs.entry);
  setIfDefined(el, "data-props", attrs.props);
  setIfDefined(el, "data-strategy", attrs.strategy);
  setIfDefined(el, "data-hydrated", attrs.hydrated);
  buildChildren?.(el);
  document.body.appendChild(el);
  return el;
}

function setIfDefined(el: HTMLElement, name: string, value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  el.setAttribute(name, value);
}

export function resetBody(): void {
  document.body.replaceChildren();
}
