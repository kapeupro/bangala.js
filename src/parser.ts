import type { Template, TemplateNode, Attribute } from "./types.js";

export class ParseError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "ParseError";
  }
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

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
    throw new ParseError(message, line, column);
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
      if (this.src[this.pos] === "<") {
        nodes.push(this.parseTag());
        continue;
      }
      if (this.src[this.pos] === "{") {
        nodes.push(this.parseExpression());
        continue;
      }
      // Future tasks add: blocks.
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

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private readName(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9:-]/.test(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) this.error("Expected a tag or attribute name");
    return this.src.slice(start, this.pos);
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
    const directive = attributes.find((a) => a.name.startsWith("client:"));
    const props = attributes.filter((a) => !a.name.startsWith("client:"));
    if (directive && directive.name !== "client:load") {
      this.error(`Unknown directive '${directive.name}' (v1 supports only client:load)`);
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
      strategy: directive ? "client:load" : null,
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

