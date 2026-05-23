import type { Template, TemplateNode } from "./types.js";

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
      if (this.src[this.pos] === "{") {
        nodes.push(this.parseExpression());
        continue;
      }
      // Future tasks add: comments, tags, blocks.
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

  private parseText(): TemplateNode {
    let value = "";
    while (!this.eof() && this.src[this.pos] !== "<" && this.src[this.pos] !== "{") {
      value += this.src[this.pos++];
    }
    if (value === "") this.error("Unexpected character");
    return { type: "Text", value };
  }
}

