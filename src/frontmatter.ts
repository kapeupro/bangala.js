import { tokenize, type Token } from "./jslex.js";

/**
 * Frontmatter model.
 *
 * The frontmatter is JavaScript/TypeScript. Most of it runs inside the
 * page's `render(props)`, but ESM only allows `import` and `export` at the
 * top level of a module, so those statements are hoisted. Only statements
 * that START with `import` or `export` at bracket depth 0 are located (both
 * are reserved words, so they always begin a statement there); every other
 * byte of the frontmatter is emitted untouched, without re-indentation.
 */

export interface ComponentImport {
  /** Local binding used as a tag, e.g. `Card` in `<Card/>`. */
  name: string;
  /** Specifier as written, without query string, e.g. `./Card.bangala`. */
  path: string;
}

export interface ImportBinding {
  local: string;
  /** `"default"`, `"*"` or the imported name. */
  imported: string;
  typeOnly: boolean;
}

export interface ImportRecord {
  specifier: string;
  bindings: ImportBinding[];
  typeOnly: boolean;
}

export interface HoistedStatement {
  start: number;
  end: number;
}

export interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

export interface FrontmatterModel {
  /** The frontmatter text the offsets below refer to. */
  source: string;
  /** Statements emitted at module scope, in source order. */
  hoisted: HoistedStatement[];
  imports: ImportRecord[];
  /** Default (or namespace) imports of `.bangala` files, usable as tags. */
  components: ComponentImport[];
  /** Every `.bangala` file referenced by an import, re-export or literal `import()`. */
  dependencies: string[];
  /** `.bangala` → `.js` specifier rewrites. */
  edits: SourceEdit[];
}

/** Thrown for frontmatter the compiler cannot (or refuses to) emit. */
export class FrontmatterError extends Error {
  constructor(
    message: string,
    /** Offset in the frontmatter text. */
    public offset: number,
  ) {
    super(message);
    this.name = "FrontmatterError";
  }
}

/** Identifiers the generated module uses for its own bindings. */
const RESERVED_NAMES = /^\$\$(?:bangala|render)$/;

/** True for `$$bangala` / `$$render`, including `\\u`-escaped spellings. */
export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.test(identifierName(name));
}

const BANGALA_SPECIFIER = /\.bangala(?=(?:\?[^"'`]*)?["'`]$)/;

const TRAILING_CONTINUATION_PUNCT = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=",
  "&&=", "||=", "??=", ",", ".", "?.", "+", "-", "*", "/", "%", "**", "&", "|", "^",
  "&&", "||", "??", "!", "~", "<", "<=", ">=", "==", "===", "!=", "!==", "?", ":",
  "=>", "<<", "...",
]);
/**
 * Operator keywords that cannot end an expression. Contextual words that are
 * also common names or TypeScript types (`void`, `of`, `is`, `readonly`, …)
 * are left out, and a keyword used as a property name (`post.new`) never
 * counts.
 */
const TRAILING_CONTINUATION_KEYWORDS = new Set([
  "new", "typeof", "delete", "await", "in", "instanceof", "extends", "implements",
  "as", "satisfies",
]);
const LEADING_CONTINUATION_PUNCT = new Set([
  ".", "?.", "(", "[", ",", "=", "=>", "+", "-", "*", "/", "%", "**", "&", "|", "^",
  "&&", "||", "??", "?", ":", "<", ">", "<=", ">=", "==", "===", "!=", "!==", "<<",
  ">>", ">>>", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "&&=", "||=", "??=",
]);
const LEADING_CONTINUATION_KEYWORDS = new Set([
  "as", "satisfies", "instanceof", "in", "extends", "implements",
]);
/** Leading tokens that cannot continue a TypeScript type: `x as T` then `(…)` is a new statement. */
const NOT_AFTER_TYPE = new Set(["(", "["]);
/** Punctuators after which an expression (not a type) follows. */
const VALUE_OPERATORS = new Set([
  "=", "||", "&&", "??", "+", "-", "*", "/", "%", "**", ",", "?", "==", "===", "!=", "!==",
]);
/** Declarations whose statement ends with their `{…}` body. */
const BLOCK_KEYWORDS = new Set(["function", "class", "interface", "enum", "namespace", "module"]);
/** Tokens after which a `{` opens a type literal, not a declaration body. */
const TYPE_LITERAL_AFTER = new Set([
  ":", "|", "&", "<", ",", "=>", "=", "?", "(", "[",
  "extends", "implements", "keyof", "typeof", "infer", "is", "as", "satisfies", "readonly",
]);
const NAMED_DECLARATIONS = new Set(["class", "interface", "type", "enum", "namespace", "function"]);

const isPunct = (t: Token | undefined, value: string) => t?.kind === "punct" && t.value === value;
const isIdent = (t: Token | undefined, value: string) => t?.kind === "ident" && t.value === value;
/** The value of a string (or substitution-free template) literal token. */
const unquote = (t: Token) => unescapeString(t.value.slice(1, -1));

function unescapeString(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, esc: string) => {
    if ((esc[0] === "u" || esc[0] === "x") && esc.length > 1) return String.fromCodePoint(parseInt(esc.replace(/^[ux]\{?|\}$/g, ""), 16));
    if (esc === "\r\n" || esc === "\n" || esc === "\r" || esc === "\u2028" || esc === "\u2029") return "";
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[esc] ?? esc;
  });
}
const withoutQuery = (specifier: string) => specifier.split("?", 1)[0]!;

export interface FrontmatterOptions {
  /** Rewrite `.bangala` specifiers to `.js` (default true). */
  rewriteBangalaImports?: boolean;
}

export function analyzeFrontmatter(source: string, options: FrontmatterOptions = {}): FrontmatterModel {
  const rewrite = options.rewriteBangalaImports ?? true;
  const tokens = tokenize(source);
  const hoisted: HoistedStatement[] = [];
  const imports: ImportRecord[] = [];
  const edits: SourceEdit[] = [];
  const dependencies = new Set<string>();
  const moduleNames = new Set<string>();
  const localExports: { names: string[]; start: number }[] = [];

  for (const t of tokens) {
    if (t.kind === "ident" && isReservedName(t.value)) {
      throw new FrontmatterError(
        `'${t.value}' is reserved: the compiled module uses it for its own bindings`,
        t.start,
      );
    }
  }

  function at(i: number, what: string): Token {
    const t = tokens[i];
    if (!t) {
      const last = tokens[tokens.length - 1];
      throw new FrontmatterError(`Unexpected end of frontmatter: expected ${what}`, last ? last.end : 0);
    }
    return t;
  }

  function rewriteSpecifier(t: Token): void {
    if (t.kind !== "string" && t.kind !== "template") return;
    if (!BANGALA_SPECIFIER.test(t.value)) return;
    if (t.kind === "template" && t.value.includes("${")) return;
    dependencies.add(withoutQuery(unquote(t)));
    if (rewrite) edits.push({ start: t.start, end: t.end, text: t.value.replace(BANGALA_SPECIFIER, ".js") });
  }

  /**
   * End index (inclusive) of a statement starting at token `s`. This is an
   * approximation of automatic semicolon insertion, only ever applied to
   * statements that begin with `export` (or TS `import x = require()`).
   */
  function statementEnd(s: number, typeAlias = false): number {
    let depth = 0;
    let angles = 0; // `<` minus `>` seen at depth 0
    let arrowBody = -1;
    let arrowBodyClose = -1;
    let afterType = false; // the tokens just seen at depth 0 form a TS type
    for (let j = s + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      const prev = tokens[j - 1]!;
      if (depth === 0 && t.nl) {
        // An arrow function's block body cannot be called or continued.
        if (arrowBodyClose === j - 1) return j - 1;
        // A type (`x as T`, `let a: T`, `type A = …`) or a postfix `x++`
        // cannot be called, indexed or tagged by the next line.
        const startsCallLike = t.kind === "template" || (t.kind === "punct" && NOT_AFTER_TYPE.has(t.value));
        if (startsCallLike && (afterType || isPunct(prev, "++") || isPunct(prev, "--"))) return j - 1;
        if (!continuesStatement(j, angles)) return j - 1;
      }
      if (depth === 0 && (isIdent(t, "as") || isIdent(t, "satisfies")) && !isPropertyName(j)) afterType = true;
      if (t.kind !== "punct") continue;
      if (t.value === "(" || t.value === "[" || t.value === "{") {
        if (depth === 0 && t.value === "{" && isPunct(prev, "=>")) arrowBody = j;
        depth++;
      } else if (t.value === ")" || t.value === "]" || t.value === "}") {
        depth--;
        if (depth < 0) throw new FrontmatterError(`Unexpected '${t.value}'`, t.start);
        if (depth === 0 && arrowBody !== -1) {
          arrowBodyClose = j;
          arrowBody = -1;
        }
      } else if (depth === 0) {
        if (t.value === ";") return j;
        if (t.value === "<") angles++;
        else if (t.value === ">") angles--;
        else if (t.value === ">>") angles -= 2;
        else if (t.value === ">>>") angles -= 3;
        if (typeAlias && t.value === "=") afterType = true;
        else if (VALUE_OPERATORS.has(t.value)) afterType = false;
        else if (t.value === ":" && !tokens.slice(s, j).some((x) => isPunct(x, "?"))) afterType = true;
      }
    }
    return tokens.length - 1;
  }

  /**
   * End index of a function/class/interface/enum/namespace declaration:
   * the `}` closing its body. Before the body, a line break only continues
   * the declaration when the next line opens the body (Allman braces) or
   * continues the header; otherwise it is an overload or `declare` signature.
   */
  function blockDeclarationEnd(s: number): number {
    let depth = 0;
    let angles = 0;
    let body = false;
    for (let j = s + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      const prev = tokens[j - 1]!;
      if (!body && depth === 0 && t.nl && !isPunct(t, "{") && !continuesStatement(j, angles)) return j - 1;
      if (t.kind !== "punct") continue;
      if (t.value === "(" || t.value === "[" || t.value === "{") {
        if (depth === 0 && t.value === "{" && angles <= 0 && !TYPE_LITERAL_AFTER.has(prev.value)) body = true;
        depth++;
      } else if (t.value === ")" || t.value === "]" || t.value === "}") {
        depth--;
        if (depth < 0) throw new FrontmatterError(`Unexpected '${t.value}'`, t.start);
        if (depth === 0 && body) return isPunct(tokens[j + 1], ";") && !tokens[j + 1]!.nl ? j + 1 : j;
      } else if (depth === 0) {
        if (t.value === ";") return j;
        if (t.value === "<") angles++;
        else if (t.value === ">") angles--;
        else if (t.value === ">>") angles -= 2;
        else if (t.value === ">>>") angles -= 3;
      }
    }
    return tokens.length - 1;
  }

  /** True when `tokens[j]` follows `.` or `?.`, i.e. it is a property name. */
  function isPropertyName(j: number): boolean {
    return isPunct(tokens[j - 1], ".") || isPunct(tokens[j - 1], "?.");
  }

  /** Whether the line break before `tokens[j]` continues the current statement. */
  function continuesStatement(j: number, angles: number): boolean {
    const prev = tokens[j - 1]!;
    const next = tokens[j]!;
    if (prev.kind === "punct" && !prev.postfix) {
      // A trailing `>` closes a generic (`Array<Item>`) unless more `>` than
      // `<` were seen, in which case it is a comparison or a shift.
      if (prev.value === ">" || prev.value === ">>" || prev.value === ">>>") {
        if (angles < 0) return true;
      } else if (TRAILING_CONTINUATION_PUNCT.has(prev.value)) {
        return true;
      }
    }
    if (prev.kind === "ident" && TRAILING_CONTINUATION_KEYWORDS.has(prev.value) && !isPropertyName(j - 1)) return true;
    if (next.kind === "template") return true;
    if (next.kind === "punct" && LEADING_CONTINUATION_PUNCT.has(next.value)) return true;
    if (next.kind === "ident" && LEADING_CONTINUATION_KEYWORDS.has(next.value)) return true;
    // Allman-style braces: `function f()\n{`.
    return isPunct(next, "{") && isPunct(prev, ")");
  }

  /** Names bound by the declarators of `const|let|var` between `from` and `to`. */
  function declaredNames(from: number, to: number): string[] {
    const names: string[] = [];
    let depth = 0;
    let expectBinding = true;
    for (let j = from; j <= to; j++) {
      const t = tokens[j]!;
      if (expectBinding) {
        expectBinding = false;
        if (t.kind === "ident") {
          names.push(t.value);
          continue;
        }
        if (isPunct(t, "{") || isPunct(t, "[")) {
          const close = matchingBracket(j);
          names.push(...patternNames(j, close));
          j = close;
          continue;
        }
      }
      if (t.kind !== "punct") continue;
      if ("([{".includes(t.value)) depth++;
      else if (")]}".includes(t.value)) depth--;
      else if (t.value === "," && depth === 0) expectBinding = true;
    }
    return names;
  }

  /** Binding names of a destructuring pattern spanning `[open, close]`. */
  function patternNames(open: number, close: number): string[] {
    const names: string[] = [];
    let depth = 0;
    let defaultDepth = -1; // inside a `= default` value opened at this depth
    for (let j = open; j <= close; j++) {
      const t = tokens[j]!;
      if (t.kind === "punct" && "([{".includes(t.value)) {
        depth++;
        continue;
      }
      if (t.kind === "punct" && ")]}".includes(t.value)) {
        depth--;
        if (defaultDepth !== -1 && depth < defaultDepth) defaultDepth = -1;
        continue;
      }
      if (defaultDepth !== -1) {
        if (isPunct(t, ",") && depth === defaultDepth) defaultDepth = -1;
        continue;
      }
      if (isPunct(t, "=")) {
        defaultDepth = depth;
        continue;
      }
      const next = tokens[j + 1];
      if (t.kind === "ident" && !isPropertyName(j) &&
        (isPunct(next, ",") || isPunct(next, "}") || isPunct(next, "]") || isPunct(next, "="))) {
        names.push(t.value);
      }
    }
    return names;
  }

  function matchingBracket(open: number): number {
    let depth = 0;
    for (let j = open; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.kind !== "punct") continue;
      if ("([{".includes(t.value)) depth++;
      else if (")]}".includes(t.value) && --depth === 0) return j;
    }
    throw new FrontmatterError(`Unclosed '${tokens[open]!.value}'`, tokens[open]!.start);
  }

  /** Index of the last token of `from "x"` plus optional `with {…}` and `;`. */
  function afterSpecifier(j: number): number {
    let k = j;
    const next = tokens[k + 1];
    if ((isIdent(next, "with") || isIdent(next, "assert")) && !next!.nl && isPunct(tokens[k + 2], "{")) {
      k += 2;
      while (k < tokens.length && !isPunct(tokens[k], "}")) k++;
      at(k, "'}'");
    }
    if (isPunct(tokens[k + 1], ";")) k++;
    return k;
  }

  /** `tokens[i]` is `{`; returns the index of the matching `}`. */
  function parseNamedBindings(i: number, typeOnlyAll: boolean, out: ImportBinding[]): number {
    let j = i + 1;
    while (!isPunct(at(j, "'}'"), "}")) {
      let typeOnly = typeOnlyAll;
      const modifier = tokens[j]!;
      const named = tokens[j + 1];
      const isTypeModifier = isIdent(modifier, "type") && named !== undefined && named.kind !== "punct" &&
        !(isIdent(named, "as") && (isPunct(tokens[j + 3], ",") || isPunct(tokens[j + 3], "}")));
      if (isTypeModifier) {
        typeOnly = true;
        j++;
      }
      const name = at(j, "a binding name");
      if (name.kind !== "ident" && name.kind !== "string") {
        throw new FrontmatterError(`Unexpected '${name.value}' in braces`, name.start);
      }
      const imported = name.kind === "string" ? unquote(name) : name.value;
      let local = imported;
      if (isIdent(tokens[j + 1], "as")) {
        const alias = at(j + 2, "a name after 'as'");
        local = alias.kind === "string" ? unquote(alias) : alias.value;
        j += 2;
      }
      out.push({ imported, local, typeOnly });
      j++;
      if (isPunct(tokens[j], ",")) j++;
    }
    return j;
  }

  function hoist(first: number, last: number): void {
    hoisted.push({ start: tokens[first]!.start, end: tokens[last]!.end });
  }

  function importDeclaration(i: number): number {
    const record: ImportRecord = { specifier: "", bindings: [], typeOnly: false };
    let j = i + 1;
    if (isIdent(tokens[j], "type") && !isIdent(tokens[j + 1], "from") && !isPunct(tokens[j + 1], ",")) {
      record.typeOnly = true;
      j++;
    }
    const first = at(j, "an import clause or a module specifier");
    if (first.kind === "string") {
      record.specifier = unquote(first);
      rewriteSpecifier(first);
      const end = afterSpecifier(j);
      hoist(i, end);
      imports.push(record);
      return end;
    }
    if (first.kind === "ident" && !(isIdent(first, "from") && tokens[j + 1]?.kind === "string")) {
      if (isPunct(tokens[j + 1], "=")) {
        // TypeScript `import x = require("y")`.
        moduleNames.add(first.value);
        const end = statementEnd(i);
        hoist(i, end);
        return end;
      }
      record.bindings.push({ local: first.value, imported: "default", typeOnly: record.typeOnly });
      j++;
      if (isPunct(tokens[j], ",")) j++;
    }
    if (isPunct(tokens[j], "*")) {
      if (!isIdent(tokens[j + 1], "as")) throw new FrontmatterError("Expected 'as' after '*'", at(j, "'as'").start);
      record.bindings.push({ local: at(j + 2, "a namespace name").value, imported: "*", typeOnly: record.typeOnly });
      j += 3;
    } else if (isPunct(tokens[j], "{")) {
      j = parseNamedBindings(j, record.typeOnly, record.bindings) + 1;
    }
    const specifier = tokens[j + 1];
    if (!isIdent(tokens[j], "from") || specifier?.kind !== "string") {
      throw new FrontmatterError("Malformed import declaration: expected 'from \"module\"'", tokens[i]!.start);
    }
    record.specifier = unquote(specifier);
    rewriteSpecifier(specifier);
    const end = afterSpecifier(j + 1);
    hoist(i, end);
    imports.push(record);
    for (const binding of record.bindings) moduleNames.add(binding.local);
    return end;
  }

  function exportDeclaration(i: number): number {
    const exportToken = tokens[i]!;
    const next = at(i + 1, "a declaration after 'export'");
    if (isIdent(next, "default")) {
      throw new FrontmatterError(
        "'export default' is not allowed in frontmatter: the default export of a compiled .bangala module is the component itself",
        exportToken.start,
      );
    }
    if (isPunct(next, "=")) {
      throw new FrontmatterError("'export =' is not supported in frontmatter", exportToken.start);
    }

    let j = i + 1;
    const typeOnlyList = isIdent(tokens[j], "type") && isPunct(tokens[j + 1], "{");
    if (typeOnlyList) j++;
    if (isPunct(tokens[j], "{") || isPunct(tokens[j], "*")) {
      const bindings: ImportBinding[] = [];
      if (isPunct(tokens[j], "{")) {
        j = parseNamedBindings(j, typeOnlyList, bindings);
      } else if (isIdent(tokens[j + 1], "as")) {
        bindings.push({ imported: "*", local: at(j + 2, "a name after 'as'").value, typeOnly: false });
        j += 2;
      }
      for (const binding of bindings) checkExportedName(binding.local, exportToken.start);
      const specifier = tokens[j + 2];
      if (isIdent(tokens[j + 1], "from") && specifier?.kind === "string") {
        rewriteSpecifier(specifier);
        const end = afterSpecifier(j + 2);
        hoist(i, end);
        return end;
      }
      if (isPunct(tokens[j], "*")) {
        throw new FrontmatterError("Malformed re-export: expected 'from \"module\"'", exportToken.start);
      }
      const end = isPunct(tokens[j + 1], ";") ? j + 1 : j;
      // Type-only exports are erased by esbuild, so they may name local types.
      localExports.push({ names: bindings.filter((b) => !b.typeOnly).map((b) => b.imported), start: exportToken.start });
      hoist(i, end);
      return end;
    }

    // `export [declare] [abstract] [async] function|class|const|…`
    let k = i + 1;
    while (
      isIdent(tokens[k], "declare") || isIdent(tokens[k], "abstract") || isIdent(tokens[k], "async") ||
      (isIdent(tokens[k], "const") && isIdent(tokens[k + 1], "enum"))
    ) {
      k++;
    }
    const keyword = at(k, "a declaration").value;
    const end = BLOCK_KEYWORDS.has(keyword) ? blockDeclarationEnd(i) : statementEnd(i, keyword === "type");
    let names: string[] = [];
    if (keyword === "const" || keyword === "let" || keyword === "var") {
      names = declaredNames(k + 1, end);
    } else if (keyword === "function") {
      const name = isPunct(tokens[k + 1], "*") ? tokens[k + 2] : tokens[k + 1];
      if (name?.kind === "ident") names = [name.value];
    } else if (NAMED_DECLARATIONS.has(keyword) && tokens[k + 1]?.kind === "ident") {
      names = [tokens[k + 1]!.value];
    }
    for (const name of names) {
      checkExportedName(name, exportToken.start);
      moduleNames.add(name);
    }
    hoist(i, end);
    return end;
  }

  // Literal dynamic imports of .bangala files, anywhere (hoisted or not).
  for (let i = 0; i < tokens.length; i++) {
    if (!isIdent(tokens[i], "import") || !isPunct(tokens[i + 1], "(")) continue;
    const argument = tokens[i + 2];
    if (argument && (isPunct(tokens[i + 3], ")") || isPunct(tokens[i + 3], ","))) rewriteSpecifier(argument);
  }

  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const afterDot = isPunct(tokens[i - 1], ".") || isPunct(tokens[i - 1], "?.");
    if (depth === 0 && !afterDot && isIdent(t, "import") &&
      !isPunct(tokens[i + 1], "(") && !isPunct(tokens[i + 1], ".")) {
      i = importDeclaration(i);
      continue;
    }
    if (depth === 0 && !afterDot && isIdent(t, "export")) {
      i = exportDeclaration(i);
      continue;
    }
    if (t.kind === "punct") {
      if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
      else if (t.value === ")" || t.value === "]" || t.value === "}") depth--;
    }
  }

  // `export { name }` must name something that exists at module scope.
  // Frontmatter locals live inside render(), and esbuild's TypeScript loader
  // would silently drop the export (it assumes the name is a type).
  for (const { names, start } of localExports) {
    for (const name of names) {
      if (moduleNames.has(name)) continue;
      throw new FrontmatterError(
        `'export { ${name} }' refers to '${name}', which is not declared at module scope. ` +
          `Frontmatter code runs inside render(props); only imports and exported declarations live at module scope. ` +
          `Declare it with 'export const ${name} = …' or 'export function ${name}…' instead`,
        start,
      );
    }
  }

  const components: ComponentImport[] = [];
  for (const record of imports) {
    if (record.typeOnly || !/\.bangala(?:\?.*)?$/.test(record.specifier)) continue;
    for (const binding of record.bindings) {
      if (binding.typeOnly) continue;
      if (binding.imported !== "default" && binding.imported !== "*") continue;
      components.push({ name: binding.local, path: withoutQuery(record.specifier) });
    }
  }

  edits.sort((a, b) => a.start - b.start);
  return { source, hoisted, imports, components, dependencies: [...dependencies], edits };
}

/** Decodes `\\u` escapes so `\\u0024\\u0024bangala` is recognised as `$$bangala`. */
function identifierName(raw: string): string {
  return raw.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, braced: string | undefined, plain: string | undefined) =>
    String.fromCodePoint(parseInt(braced ?? plain!, 16)));
}

function checkExportedName(name: string, offset: number): void {
  if (name === "render" || name === "default") {
    throw new FrontmatterError(
      `Exporting '${name}' is not allowed in frontmatter: the compiled module defines it`,
      offset,
    );
  }
}

/** Returns `model.source[start, end)` with the specifier edits applied. */
function sliceWithEdits(model: FrontmatterModel, start: number, end: number): string {
  // Edits are sorted: binary-search the first one at or after `start`.
  let lo = 0;
  let hi = model.edits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (model.edits[mid]!.start < start) lo = mid + 1;
    else hi = mid;
  }
  let out = "";
  let pos = start;
  for (let i = lo; i < model.edits.length; i++) {
    const edit = model.edits[i]!;
    if (edit.end > end) break;
    out += model.source.slice(pos, edit.start) + edit.text;
    pos = edit.end;
  }
  return out + model.source.slice(pos, end);
}

/** The hoisted statements, as module-level source. */
export function moduleStatements(model: FrontmatterModel): string[] {
  return model.hoisted.map((h) => sliceWithEdits(model, h.start, h.end));
}

/**
 * The frontmatter code that runs inside render(): the source with every
 * hoisted statement replaced by `;` plus the same number of line breaks.
 * The `;` keeps the surrounding code from merging under automatic semicolon
 * insertion; the line breaks keep each render line at a constant offset
 * from its .bangala line.
 */
export function renderStatements(model: FrontmatterModel): string {
  let out = "";
  let pos = 0;
  for (const h of model.hoisted) {
    out += sliceWithEdits(model, pos, h.start);
    const breaks = model.source.slice(h.start, h.end).match(/\r\n|\r|\n|\u2028|\u2029/g) ?? [];
    out += ";" + "\n".repeat(breaks.length);
    pos = h.end;
  }
  return out + sliceWithEdits(model, pos, model.source.length);
}
