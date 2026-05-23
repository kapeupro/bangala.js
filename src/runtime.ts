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
