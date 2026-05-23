import type { Template, TemplateNode, Attribute } from "./types.js";

/**
 * Pedagogic error thrown by the parser. `message` keeps the short form
 * ("X (line N, column N)") so existing test matchers and consumers stay
 * stable; call `format()` to get the rich rendering with the source line,
 * a caret marker, and a suggestion when one is available.
 */
export class ParseError extends Error {
  public reason: string;

  constructor(
    message: string,
    public line: number,
    public column: number,
    public source = "",
    public offset = 0,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "ParseError";
    this.reason = message;
  }

  /** Returns a multi-line rendering: header, source context, caret, suggestion. */
  format(): string {
    const header = `ParseError: ${this.reason} (line ${this.line}, column ${this.column})`;
    const context = renderSourceContext(this.source, this.line, this.column);
    const suggestion = suggestFor(this.reason);
    const parts = [header];
    if (context) parts.push("", context);
    if (suggestion) parts.push("", `Suggested: ${suggestion}`);
    return parts.join("\n");
  }
}

/** Small table of common parse errors → human-friendly fixes. */
const SUGGESTIONS: { match: (reason: string) => boolean; suggestion: string }[] = [
  {
    match: (r) => r === "{#if} requires a condition",
    suggestion: "write '{#if condition}' — e.g. '{#if user.isAdmin}'",
  },
  {
    match: (r) => r.startsWith("Unclosed <"),
    suggestion: "add a matching closing tag, e.g. '</div>'",
  },
  {
    match: (r) => r === "Expected quoted attribute value",
    suggestion: "quote the value: e.g. id=\"main\" or use a dynamic id={value}",
  },
  {
    match: (r) => r.startsWith("Unknown directive"),
    suggestion: "valid directives: client:load, client:idle, client:visible",
  },
  {
    match: (r) => r.startsWith("{#each} must be"),
    suggestion: "use '{#each list as item}' — e.g. '{#each posts as post}'",
  },
];

function suggestFor(reason: string): string | null {
  for (const entry of SUGGESTIONS) {
    if (entry.match(reason)) return entry.suggestion;
  }
  return null;
}

function renderSourceContext(source: string, line: number, column: number): string {
  if (!source) return "";
  const lines = source.split("\n");
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return "";
  const gutter = (n: number) => String(n).padStart(3, " ");
  const out: string[] = [];
  if (idx > 0) out.push(`${gutter(line - 1)} | ${lines[idx - 1]}`);
  const target = lines[idx] ?? "";
  out.push(`${gutter(line)} | ${target}`);
  const caretPad = " ".repeat(Math.max(0, column - 1));
  out.push(`${" ".repeat(3)} | ${caretPad}^`);
  if (idx + 1 < lines.length) out.push(`${gutter(line + 1)} | ${lines[idx + 1]}`);
  return out.join("\n");
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea"]);

export function parse(source: string, _filename = "<unknown>"): Template {
  const fm = source.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = fm ? fm[1]!.trim() : "";
  const body = fm ? source.slice(fm[0].length) : source;
  const offset = fm ? fm[0].length : 0;
  const scanner = new Scanner(body, offset, source);
  const nodes = scanner.parseNodes(false);
  return { frontmatter, nodes };
}

class Scanner {
  private pos = 0;

  constructor(
    private src: string,
    private offset: number,
    private full: string,
  ) {}

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private error(message: string): never {
    const idx = this.offset + this.pos;
    let line = 1;
    let column = 1;
    for (let i = 0; i < idx && i < this.full.length; i++) {
      if (this.full[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new ParseError(message, line, column, this.full, idx);
  }

  /** Parse nodes until a closing token. `nested` is true inside a block/element. */
  parseNodes(nested: boolean): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (!this.eof()) {
      if (this.startsWith("{/") || this.startsWith("{:") || this.startsWith("</")) {
        if (!nested) this.error("Unexpected closing token");
        break;
      }
      if (this.startsWith("<!--")) {
        const end = this.src.indexOf("-->", this.pos);
        if (end === -1) this.error("Unclosed comment");
        this.pos = end + 3;
        continue;
      }
      if (this.startsWith("<!")) {
        nodes.push(this.parseDeclaration());
        continue;
      }
      if (this.src[this.pos] === "<") {
        nodes.push(this.parseTag());
        continue;
      }
      if (this.startsWith("{#if")) {
        nodes.push(this.parseIf());
        continue;
      }
      if (this.startsWith("{#each")) {
        nodes.push(this.parseEach());
        continue;
      }
      if (this.src[this.pos] === "{") {
        nodes.push(this.parseExpression());
        continue;
      }
      nodes.push(this.parseText());
    }
    return nodes;
  }

  /** Reads from `{` to its matching `}`, returns the inner source. */
  private readBraced(): string {
    if (this.src[this.pos] !== "{") this.error("Expected '{'");
    this.pos++;
    let depth = 1;
    let code = "";
    while (!this.eof()) {
      const ch = this.src[this.pos]!;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          this.pos++;
          return code;
        }
      }
      code += ch;
      this.pos++;
    }
    this.error("Unclosed '{'");
  }

  private parseExpression(): TemplateNode {
    return { type: "Expression", code: this.readBraced() };
  }

  private parseIf(): TemplateNode {
    const header = this.readBraced().trim(); // "#if condition"
    const condition = header.slice(3).trim();
    if (condition === "") this.error("{#if} requires a condition");
    const then = this.parseNodes(true);
    let otherwise: TemplateNode[] | null = null;
    if (this.startsWith("{:else}")) {
      this.pos += "{:else}".length;
      otherwise = this.parseNodes(true);
    }
    if (!this.startsWith("{/if}")) this.error("Unclosed {#if}");
    this.pos += "{/if}".length;
    return { type: "IfBlock", condition, then, otherwise };
  }

  private parseEach(): TemplateNode {
    const header = this.readBraced().trim(); // "#each list as item"
    const match = header.match(/^#each\s+(.+?)\s+as\s+(\w+)$/);
    if (!match) this.error("{#each} must be '{#each <list> as <item>}'");
    const body = this.parseNodes(true);
    if (!this.startsWith("{/each}")) this.error("Unclosed {#each}");
    this.pos += "{/each}".length;
    return { type: "EachBlock", list: match![1]!.trim(), item: match![2]!, body };
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private readName(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9_:-]/.test(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) this.error("Expected a tag or attribute name");
    return this.src.slice(start, this.pos);
  }

  private parseDeclaration(): TemplateNode {
    const end = this.src.indexOf(">", this.pos);
    if (end === -1) this.error("Unclosed declaration");
    const value = this.src.slice(this.pos, end + 1);
    this.pos = end + 1;
    return { type: "Text", value };
  }

  private parseAttributes(): { attributes: Attribute[]; selfClosing: boolean } {
    const attributes: Attribute[] = [];
    while (!this.eof()) {
      this.skipWhitespace();
      if (this.startsWith("/>")) {
        this.pos += 2;
        return { attributes, selfClosing: true };
      }
      if (this.src[this.pos] === ">") {
        this.pos++;
        return { attributes, selfClosing: false };
      }
      const name = this.readName();
      if (this.src[this.pos] === "=") {
        this.pos++;
        if (this.src[this.pos] === "{") {
          attributes.push({ name, value: this.readBraced(), dynamic: true });
        } else {
          const quote = this.src[this.pos];
          if (quote !== '"' && quote !== "'") this.error("Expected quoted attribute value");
          this.pos++;
          const end = this.src.indexOf(quote, this.pos);
          if (end === -1) this.error("Unclosed attribute value");
          attributes.push({ name, value: this.src.slice(this.pos, end), dynamic: false });
          this.pos = end + 1;
        }
      } else {
        // Valueless attribute / directive (e.g. client:load).
        attributes.push({ name, value: "", dynamic: false });
      }
    }
    this.error("Unclosed tag");
  }

  private parseTag(): TemplateNode {
    this.pos++; // consume "<"
    const tag = this.readName();
    if (tag === "slot") {
      const { selfClosing } = this.parseAttributes();
      if (!selfClosing) {
        const close = "</slot>";
        if (!this.startsWith(close)) this.error("Unclosed <slot>");
        this.pos += close.length;
      }
      return { type: "Slot" };
    }
    const { attributes, selfClosing } = this.parseAttributes();
    const isComponent = /^[A-Z]/.test(tag);
    if (isComponent) {
      return this.finishComponent(tag, attributes, selfClosing);
    }
    if (selfClosing || VOID_ELEMENTS.has(tag)) {
      return { type: "Element", tag, attributes, children: [] };
    }
    if (RAW_TEXT_ELEMENTS.has(tag.toLowerCase())) {
      const close = `</${tag}>`;
      const end = this.src.indexOf(close, this.pos);
      if (end === -1) this.error(`Unclosed <${tag}>`);
      const value = this.src.slice(this.pos, end);
      this.pos = end + close.length;
      return { type: "Element", tag, attributes, children: [{ type: "Text", value }] };
    }
    const children = this.parseNodes(true);
    const close = `</${tag}>`;
    if (!this.startsWith(close)) this.error(`Unclosed <${tag}>`);
    this.pos += close.length;
    return { type: "Element", tag, attributes, children };
  }

  private finishComponent(
    tag: string,
    attributes: Attribute[],
    selfClosing: boolean,
  ): TemplateNode {
    const VALID_DIRECTIVES = new Set(["client:load", "client:idle", "client:visible"]);
    const directive = attributes.find((a) => a.name.startsWith("client:"));
    const props = attributes.filter((a) => !a.name.startsWith("client:"));
    if (directive && !VALID_DIRECTIVES.has(directive.name)) {
      this.error(`Unknown directive '${directive.name}'`);
    }
    let children: TemplateNode[] = [];
    if (!selfClosing) {
      children = this.parseNodes(true);
      const close = `</${tag}>`;
      if (!this.startsWith(close)) this.error(`Unclosed <${tag}>`);
      this.pos += close.length;
    }
    return {
      type: "Component",
      name: tag,
      attributes: props,
      children,
      island: directive !== undefined,
      strategy: directive ? (directive.name as "client:load" | "client:idle" | "client:visible") : null,
    };
  }

  private parseText(): TemplateNode {
    let value = "";
    while (!this.eof() && this.src[this.pos] !== "<" && this.src[this.pos] !== "{") {
      value += this.src[this.pos++];
    }
    if (value === "") this.error("Unexpected character");
    return { type: "Text", value };
  }
}
