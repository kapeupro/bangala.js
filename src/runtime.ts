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
  const html = await Comp.render(props);
  const serialized = escape(JSON.stringify(props));
  const strat = strategy.replace(/^client:/, "");
  return (
    `<bangala-island data-entry="${entry}" data-props="${serialized}" ` +
    `data-strategy="${strat}">${html}</bangala-island>`
  );
}
