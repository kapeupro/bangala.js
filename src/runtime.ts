const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escape(value: unknown): string {
  return String(value).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]!);
}

export interface Component {
  render(props: Record<string, unknown>): string | Promise<string>;
}

export async function renderComponent(
  Comp: Component,
  props: Record<string, unknown>,
  children?: () => string | Promise<string>,
): Promise<string> {
  const slot = children ? await children() : "";
  return Comp.render({ ...props, children: slot });
}

export async function island(
  Comp: Component,
  props: Record<string, unknown>,
  entry: string,
  strategy: string,
): Promise<string> {
  // `children` is slot content, i.e. trusted HTML. An island has no slot
  // content, so a `children` prop must never reach its <slot/> unescaped.
  const { children: _children, ...islandProps } = props;
  const html = await Comp.render({ ...islandProps, children: "" });
  const serialized = escape(JSON.stringify(islandProps));
  const strat = strategy.replace(/^client:/, "");
  return (
    `<bangala-island data-entry="${escape(entry)}" data-props="${serialized}" ` +
    `data-strategy="${escape(strat)}">${html}</bangala-island>`
  );
}

/** Renders `{#each}`: items render concurrently, output keeps list order. */
export async function each<T>(
  list: Iterable<T> | ArrayLike<T>,
  render: (item: T) => string | Promise<string>,
): Promise<string> {
  const parts = await Promise.all(Array.from(list, (item) => render(item)));
  return parts.join("");
}
