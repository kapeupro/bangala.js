/**
 * A small, dependency-free JavaScript/TypeScript lexer.
 *
 * The compiler never needs a full parser: it only has to know where strings,
 * template literals, comments and regex literals start and end, so that the
 * braces, fences (`---`) and `import`/`export` keywords it looks for are the
 * real ones. Template literals are lexed as a single opaque token (their
 * `${}` substitutions are lexed recursively to find the closing backtick).
 */

export type TokenKind = "ident" | "punct" | "string" | "template" | "regex" | "number";

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
  /** A line terminator was crossed between the previous token and this one. */
  nl: boolean;
  /** Postfix `!` (TypeScript non-null assertion). */
  postfix?: boolean;
}

/** Thrown on unterminated strings, template literals, comments and braces. */
export class JsLexError extends Error {
  constructor(
    message: string,
    /** Offset of the offending construct in the lexed source. */
    public offset: number,
  ) {
    super(message);
    this.name = "JsLexError";
  }
}

export function isLineTerminator(ch: string | undefined): boolean {
  return ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
}

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
];

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

const IDENT_RE =
  /#?(?:[\p{ID_Start}$_]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})(?:[\p{ID_Continue}$\u200c\u200d]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})*/uy;
const NUMBER_RE =
  /(?:0[xXoObB][0-9a-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/y;
const REGEX_FLAGS_RE = /[\p{ID_Continue}$]*/uy;

export class Lexer {
  pos: number;
  private prev: Token | null = null;
  /** Called with the bounds of every `//` comment that is skipped. */
  onLineComment: ((start: number, end: number) => void) | null = null;

  constructor(
    readonly src: string,
    pos = 0,
    readonly limit = src.length,
  ) {
    this.pos = pos;
  }

  /** Skips whitespace and comments. Returns true when a line terminator was crossed. */
  skipTrivia(): boolean {
    const s = this.src;
    let nl = false;
    while (this.pos < this.limit) {
      const ch = s[this.pos]!;
      if (isLineTerminator(ch)) {
        nl = true;
        this.pos++;
      } else if (ch === "/" && s[this.pos + 1] === "/") {
        const start = this.pos;
        while (this.pos < this.limit && !isLineTerminator(s[this.pos])) this.pos++;
        this.onLineComment?.(start, this.pos);
      } else if (ch === "/" && s[this.pos + 1] === "*") {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1 || end + 2 > this.limit) {
          throw new JsLexError("Unterminated comment", this.pos);
        }
        if (/[\n\r\u2028\u2029]/.test(s.slice(this.pos, end))) nl = true;
        this.pos = end + 2;
      } else if (/\s/.test(ch)) {
        this.pos++;
      } else {
        break;
      }
    }
    return nl;
  }

  /** Scans one token at `pos`; trivia must already be skipped. */
  scan(nl: boolean): Token | null {
    const s = this.src;
    const start = this.pos;
    if (start >= this.limit) return null;
    const ch = s[start]!;
    let token: Token | null = null;
    if (ch === '"' || ch === "'") {
      token = this.string(ch, start);
    } else if (ch === "`") {
      token = this.template(start);
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[start + 1] ?? ""))) {
      NUMBER_RE.lastIndex = start;
      const value = NUMBER_RE.exec(s)![0];
      token = { kind: "number", value, start, end: start + value.length, nl };
    } else {
      IDENT_RE.lastIndex = start;
      const ident = IDENT_RE.exec(s);
      if (ident) {
        token = { kind: "ident", value: ident[0], start, end: start + ident[0].length, nl };
      } else if (ch === "/" && this.regexAllowed()) {
        token = this.regex(start);
      }
      token ??= this.punct(start);
    }
    token.nl = nl;
    this.pos = token.end;
    this.prev = token;
    return token;
  }

  next(): Token | null {
    const nl = this.skipTrivia();
    return this.scan(nl);
  }

  private regexAllowed(): boolean {
    const p = this.prev;
    if (!p) return true;
    switch (p.kind) {
      case "number":
      case "string":
      case "template":
      case "regex":
        return false;
      case "ident":
        return REGEX_AFTER_KEYWORD.has(p.value);
      case "punct":
        if (p.postfix) return false;
        return !(p.value === ")" || p.value === "]" || p.value === "++" || p.value === "--");
    }
  }

  private string(quote: string, start: number): Token {
    const s = this.src;
    let i = start + 1;
    for (;;) {
      if (i >= this.limit) throw new JsLexError("Unterminated string literal", start);
      const ch = s[i]!;
      if (ch === "\\") {
        i += s[i + 1] === "\r" && s[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (ch === quote) return { kind: "string", value: s.slice(start, i + 1), start, end: i + 1, nl: false };
      if (ch === "\n" || ch === "\r") throw new JsLexError("Unterminated string literal", start);
      i++;
    }
  }

  private template(start: number): Token {
    const s = this.src;
    let i = start + 1;
    for (;;) {
      if (i >= this.limit) throw new JsLexError("Unterminated template literal", start);
      const ch = s[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") return { kind: "template", value: s.slice(start, i + 1), start, end: i + 1, nl: false };
      if (ch === "$" && s[i + 1] === "{") {
        const savedPrev = this.prev;
        this.prev = null;
        this.pos = i + 2;
        let depth = 0;
        for (;;) {
          const t = this.next();
          if (!t) throw new JsLexError("Unterminated template literal", start);
          if (t.kind !== "punct") continue;
          if (t.value === "{") depth++;
          else if (t.value === "}") {
            if (depth === 0) break;
            depth--;
          }
        }
        i = this.pos;
        this.prev = savedPrev;
        continue;
      }
      i++;
    }
  }

  /** Returns null when this `/` turns out not to start a regex (it is then a division). */
  private regex(start: number): Token | null {
    const s = this.src;
    let i = start + 1;
    let inClass = false;
    for (;;) {
      if (i >= this.limit) return null;
      const ch = s[i]!;
      if (isLineTerminator(ch)) return null;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (inClass) {
        if (ch === "]") inClass = false;
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "/") {
        i++;
        break;
      }
      i++;
    }
    REGEX_FLAGS_RE.lastIndex = i;
    i += REGEX_FLAGS_RE.exec(s)![0].length;
    return { kind: "regex", value: s.slice(start, i), start, end: i, nl: false };
  }

  private punct(start: number): Token {
    const s = this.src;
    for (const p of PUNCTUATORS) {
      if (!s.startsWith(p, start)) continue;
      // `a?.5:b` is a conditional, not optional chaining.
      if (p === "?." && /[0-9]/.test(s[start + 2] ?? "")) break;
      return { kind: "punct", value: p, start, end: start + p.length, nl: false };
    }
    const ch = s[start]!;
    const token: Token = { kind: "punct", value: ch, start, end: start + 1, nl: false };
    const p = this.prev;
    if (
      ch === "!" && p && !/\s/.test(s[start - 1] ?? " ") &&
      (p.kind === "ident" || p.value === ")" || p.value === "]")
    ) {
      token.postfix = true;
    }
    return token;
  }
}

/** Tokenizes `src[start, end)`. Template literals come back as single tokens. */
export function tokenize(src: string, start = 0, end = src.length): Token[] {
  const lexer = new Lexer(src, start, end);
  const tokens: Token[] = [];
  for (let t = lexer.next(); t; t = lexer.next()) tokens.push(t);
  return tokens;
}

/**
 * `afterOpen` points just past an opening `{`. Returns the index of the
 * matching `}`, skipping braces inside strings, templates, comments and
 * regex literals.
 */
export function findClosingBrace(src: string, afterOpen: number): number {
  const lexer = new Lexer(src, afterOpen);
  let depth = 0;
  // `{value // note}` is JavaScript in which the comment hides the `}`.
  // Reject it instead of silently reading on into the template.
  lexer.onLineComment = (start, end) => {
    let d = depth;
    for (let i = start; i < end; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}" && --d < 0) {
        throw new JsLexError("A // comment hides the closing '}' of this expression: use /* … */ instead", start);
      }
    }
  };
  for (;;) {
    const t = lexer.next();
    if (!t) throw new JsLexError("Unclosed '{'", afterOpen - 1);
    if (t.kind !== "punct") continue;
    if (t.value === "{") depth++;
    else if (t.value === "}") {
      if (depth === 0) return t.start;
      depth--;
    }
  }
}

export interface FrontmatterBounds {
  /** Offset of the opening `---`. */
  opener: number;
  /** Frontmatter code is `source.slice(start, end)`. */
  start: number;
  end: number;
  /** Offset where the template body starts. */
  bodyOffset: number;
}

const OPENING_FENCE_RE = /^\uFEFF?\s*?(---)[ \t]*(?:\r\n|\r|\n)/;
const CLOSING_FENCE_RE = /---[ \t]*(?:\r\n|\r|\n|$)/y;

/**
 * Locates the frontmatter block. The closing fence is a line holding only
 * `---` (surrounding spaces and tabs allowed). It is only recognised in
 * plain code, never inside a string, template literal, comment or regex
 * literal. A line holding only `---` is never valid JavaScript, so the
 * relaxed whitespace rule cannot misread real code.
 *
 * Returns null when the source has no frontmatter. Throws JsLexError when
 * the frontmatter is not closed or holds an unterminated construct.
 */
export function findFrontmatter(source: string): FrontmatterBounds | null {
  const opening = OPENING_FENCE_RE.exec(source);
  if (!opening) return null;
  const opener = opening[0].indexOf("---");
  const start = opening[0].length;
  const lexer = new Lexer(source, start);
  for (;;) {
    lexer.skipTrivia();
    if (lexer.pos >= source.length) {
      throw new JsLexError("Unclosed frontmatter: expected a line containing only '---'", opener);
    }
    if (atLineStart(source, lexer.pos, start)) {
      CLOSING_FENCE_RE.lastIndex = lexer.pos;
      const fence = CLOSING_FENCE_RE.exec(source);
      if (fence) {
        return {
          opener,
          start,
          end: endOfCode(source, start, lexer.pos),
          bodyOffset: lexer.pos + fence[0].length,
        };
      }
    }
    lexer.scan(false);
  }
}

/** True when only spaces/tabs separate `pos` from the previous line break (or `start`). */
function atLineStart(source: string, pos: number, start: number): boolean {
  let i = pos;
  while (i > start && (source[i - 1] === " " || source[i - 1] === "\t")) i--;
  return i === start || isLineTerminator(source[i - 1]);
}

/** Frontmatter code ends before the line break that precedes the closing fence line. */
function endOfCode(source: string, start: number, fencePos: number): number {
  let end = fencePos;
  while (end > start && (source[end - 1] === " " || source[end - 1] === "\t")) end--;
  if (end === start) return end;
  if (source[end - 1] === "\n" && source[end - 2] === "\r" && end - 1 > start) return end - 2;
  return isLineTerminator(source[end - 1]) ? end - 1 : end;
}
