import type { Template, TemplateNode, Attribute } from "./types.js";
import { findClosingBrace, findFrontmatter, JsLexError, tokenize } from "./jslex.js";

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
const SUGGESTIONS: {
  match: (reason: string) => boolean;
  suggestion: string | ((reason: string) => string);
}[] = [
  {
    match: (r) => r === "{#if} requires a condition",
    suggestion: "write '{#if condition}' — e.g. '{#if user.isAdmin}'",
  },
  {
    match: (r) => /^Unclosed <[^>]+>$/.test(r),
    suggestion: (r) => `add the matching closing tag '</${r.slice("Unclosed <".length, -1)}>'`,
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
    if (!entry.match(reason)) continue;
    return typeof entry.suggestion === "function" ? entry.suggestion(reason) : entry.suggestion;
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
  const fm = extractFrontmatter(source);
  const frontmatter = fm ? fm.frontmatter : "";
  const frontmatterOffset = fm ? fm.frontmatterOffset : 0;
  const offset = fm ? fm.bodyOffset : 0;
  const body = source.slice(offset);
  const scanner = new Scanner(body, offset, source);
  const nodes = scanner.parseNodes(false);
  return { frontmatter, frontmatterOffset, nodes };
}

/** Builds a ParseError located at `offset` in `source`. */
export function parseErrorAt(message: string, source: string, offset: number): ParseError {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return new ParseError(message, line, column, source, offset);
}

/**
 * Locates the frontmatter with a JavaScript-aware scan (see findFrontmatter):
 * a `---` inside a string, template literal, comment or regex literal never
 * closes it. Returns null when there is no frontmatter; throws a located
 * ParseError when it is unclosed or holds an unterminated construct.
 */
export function extractFrontmatter(
  source: string,
): { frontmatter: string; frontmatterOffset: number; bodyOffset: number } | null {
  try {
    const bounds = findFrontmatter(source);
    if (!bounds) return null;
    return {
      frontmatter: source.slice(bounds.start, bounds.end),
      frontmatterOffset: bounds.start,
      bodyOffset: bounds.bodyOffset,
    };
  } catch (error) {
    if (error instanceof JsLexError) throw parseErrorAt(error.message, source, error.offset);
    throw error;
  }
}

/** Closing tokens of `{#if}` / `{#each}` blocks, whitespace-tolerant. */
const CLOSE_IF_RE = /\{\/\s*if\s*\}/y;
const CLOSE_EACH_RE = /\{\/\s*each\s*\}/y;
const ELSE_RE = /\{:\s*else\s*\}/y;
const ELSE_IF_RE = /\{:\s*else\s+if\b/y;
/** Any `{/name}` or `{:…}` token: these never start a JavaScript expression. */
const BLOCK_CLOSER_RE = /\{(?:\/\s*[A-Za-z]\w*\s*\}|:)/y;
const OPEN_BLOCK_RE = /\{#(if|each)(?![\p{ID_Continue}$])/uy;
const IDENTIFIER_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;
/** Matches `</tag>`; HTML tag names are case-insensitive, component names are not. */
function closingTagRe(tag: string): RegExp {
  return new RegExp(`</${tag}\\s*>`, /^[A-Z]/.test(tag) ? "y" : "iy");
}

const RESERVED_WORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function",
  "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null",
  "package", "private", "protected", "public", "return", "static", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

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

  /** Length of the match of a sticky regex at the current position, or -1. */
  private match(re: RegExp): number {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    return m ? m[0].length : -1;
  }

  private error(message: string): never {
    this.errorAt(message, this.pos);
  }

  /** Throws a ParseError located at `pos` (an offset in the template body). */
  private errorAt(message: string, pos: number): never {
    throw parseErrorAt(message, this.full, this.offset + pos);
  }

  /** The `{…}` token at the current position, for error messages. */
  private blockToken(): string {
    const end = this.src.indexOf("}", this.pos);
    return end === -1 ? this.src.slice(this.pos, this.pos + 12) : this.src.slice(this.pos, end + 1);
  }

  /**
   * Parse nodes until a closing token: an end tag, `{/…}` or `{:…}`.
   * `nested` is true inside a block/element; at the top level a closing
   * token is an error.
   */
  parseNodes(nested: boolean): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (!this.eof()) {
      if (this.startsWith("</") || this.match(BLOCK_CLOSER_RE) >= 0) {
        if (!nested) {
          if (this.match(ELSE_RE) >= 0) this.error("Unexpected {:else} outside of an {#if} block");
          this.error(`Unexpected closing token '${this.startsWith("</") ? "</" : this.blockToken()}'`);
        }
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
      if (this.src[this.pos] === "{") {
        const node = this.parseBrace();
        if (node) nodes.push(node);
        continue;
      }
      nodes.push(this.parseText());
    }
    return nodes;
  }

  /** Dispatches a `{` that is not a closing token. */
  private parseBrace(): TemplateNode | null {
    const block = this.match(OPEN_BLOCK_RE) >= 0 ? this.src.slice(this.pos + 2).match(/^\w+/)![0] : null;
    if (block === "if") return this.parseIf();
    if (block === "each") return this.parseEach();
    if (this.startsWith("{#")) {
      const name = this.src.slice(this.pos + 2).match(/^[\w$]*/)![0];
      this.error(`Unknown block '{#${name}}': supported blocks are {#if} and {#each}`);
    }
    if (this.startsWith("{@")) {
      const name = this.src.slice(this.pos + 2).match(/^[\w$]*/)![0];
      this.error(`'{@${name}}' is not supported: bangala has no raw HTML interpolation`);
    }
    return this.parseExpression();
  }

  /** Reads from `{` to its matching `}` and returns the inner source. */
  private readBraced(): string {
    const open = this.pos;
    if (this.src[open] !== "{") this.error("Expected '{'");
    let close: number;
    try {
      close = findClosingBrace(this.src, open + 1);
    } catch (error) {
      if (!(error instanceof JsLexError)) throw error;
      // A quote or backtick in later text can make the lexer fail far away
      // from the real problem, which is the unclosed brace.
      const sameLine = !/[\n\r\u2028\u2029]/.test(this.src.slice(open, error.offset));
      if (sameLine) this.errorAt(error.message, error.offset);
      this.errorAt("Unclosed '{'", open);
    }
    this.pos = close + 1;
    return this.src.slice(open + 1, close);
  }

  private parseExpression(): TemplateNode | null {
    const open = this.pos;
    const code = this.readBraced();
    if (tokenize(code).length === 0) {
      // `{/* note */}` is a template comment; `{}` and `{ }` are mistakes.
      if (code.trim() === "") this.errorAt("Empty expression", open);
      return null;
    }
    return { type: "Expression", code };
  }

  private parseIf(): TemplateNode {
    const open = this.pos;
    const condition = this.readBraced().replace(/^#if/, "").trim();
    if (condition === "") this.errorAt("{#if} requires a condition", open);
    const then = this.parseNodes(true);
    let otherwise: TemplateNode[] | null = null;
    const elseLength = this.match(ELSE_RE);
    if (elseLength >= 0) {
      this.pos += elseLength;
      otherwise = this.parseNodes(true);
    } else if (this.match(ELSE_IF_RE) >= 0) {
      this.error("{:else if} is not supported: nest an {#if} block inside {:else}");
    }
    this.closeBlock("if", CLOSE_IF_RE, open);
    return { type: "IfBlock", condition, then, otherwise };
  }

  private parseEach(): TemplateNode {
    const open = this.pos;
    const header = this.readBraced().replace(/^#each/, "");
    const { list, item } = this.parseEachHeader(header, open);
    const body = this.parseNodes(true);
    if (this.match(ELSE_RE) >= 0) this.error("{:else} is not supported inside {#each}");
    this.closeBlock("each", CLOSE_EACH_RE, open);
    return { type: "EachBlock", list, item, body };
  }

  /** Splits `<list> as <item>` at the last top-level `as`. */
  private parseEachHeader(header: string, open: number): { list: string; item: string } {
    const usage = "{#each} must be '{#each <list> as <item>}'";
    const tokens = tokenize(header);
    let depth = 0;
    let asIndex = -1;
    tokens.forEach((t, i) => {
      if (t.kind === "punct" && "([{".includes(t.value)) depth++;
      else if (t.kind === "punct" && ")]}".includes(t.value)) depth--;
      else if (depth === 0 && t.kind === "ident" && t.value === "as" && i > 0) asIndex = i;
    });
    if (asIndex === -1) this.errorAt(usage, open);
    const binding = tokens.slice(asIndex + 1);
    const first = binding[0];
    if (!first) this.errorAt(usage, open);
    if (first.kind === "punct" && (first.value === "{" || first.value === "[")) {
      this.errorAt("Destructuring in {#each} is not supported: write '{#each list as item}' and read item.field", open);
    }
    if (binding.length > 1 && binding[1]!.kind === "punct" && binding[1]!.value === ",") {
      this.errorAt("An index in {#each} is not supported: write '{#each list as item}'", open);
    }
    if (binding.length > 1 || first.kind !== "ident" || !IDENTIFIER_RE.test(first.value)) {
      this.errorAt(usage, open);
    }
    if (RESERVED_WORDS.has(first.value) || /^\$\$(?:bangala|render)$/.test(first.value)) {
      this.errorAt(`'${first.value}' is a reserved word and cannot name the {#each} item`, open);
    }
    const list = header.slice(0, tokens[asIndex]!.start).trim();
    if (list === "") this.errorAt(usage, open);
    return { list, item: first.value };
  }

  /** Consumes `{/if}` / `{/each}`, or reports what is wrong. */
  private closeBlock(name: string, closer: RegExp, open: number): void {
    const length = this.match(closer);
    if (length >= 0) {
      this.pos += length;
      return;
    }
    if (!this.eof() && this.match(BLOCK_CLOSER_RE) >= 0) {
      this.error(`Unexpected '${this.blockToken()}': expected {/${name}}`);
    }
    this.errorAt(`Unclosed {#${name}}`, open);
  }

  /** Consumes `</tag>` (whitespace before `>` allowed), or reports what is wrong. */
  private closeTag(tag: string, open: number): void {
    const length = this.match(closingTagRe(tag));
    if (length >= 0) {
      this.pos += length;
      return;
    }
    if (!this.eof() && this.match(BLOCK_CLOSER_RE) >= 0) {
      this.error(`Unexpected '${this.blockToken()}' inside <${tag}>`);
    }
    this.errorAt(`Unclosed <${tag}>`, open);
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
          const open = this.pos;
          const value = this.readBraced();
          if (tokenize(value).length === 0) this.errorAt(`Empty expression in attribute '${name}'`, open);
          attributes.push({ name, value, dynamic: true });
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
    const open = this.pos;
    this.pos++; // consume "<"
    const tag = this.readName();
    if (tag === "slot") {
      const { selfClosing } = this.parseAttributes();
      if (!selfClosing) this.closeTag("slot", open);
      return { type: "Slot" };
    }
    const { attributes, selfClosing } = this.parseAttributes();
    const isComponent = /^[A-Z]/.test(tag);
    if (isComponent) {
      return this.finishComponent(tag, attributes, selfClosing, open);
    }
    if (selfClosing || VOID_ELEMENTS.has(tag.toLowerCase())) {
      return { type: "Element", tag, attributes, children: [] };
    }
    if (RAW_TEXT_ELEMENTS.has(tag.toLowerCase())) {
      const close = new RegExp(`</${tag}\\s*>`, "gi");
      close.lastIndex = this.pos;
      const end = close.exec(this.src);
      if (!end) this.errorAt(`Unclosed <${tag}>`, open);
      const value = this.src.slice(this.pos, end.index);
      this.pos = end.index + end[0].length;
      return { type: "Element", tag, attributes, children: [{ type: "Text", value }] };
    }
    const children = this.parseNodes(true);
    this.closeTag(tag, open);
    return { type: "Element", tag, attributes, children };
  }

  private finishComponent(
    tag: string,
    attributes: Attribute[],
    selfClosing: boolean,
    open: number,
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
      this.closeTag(tag, open);
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
