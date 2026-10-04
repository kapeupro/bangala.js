import type {
  Template, TemplateNode, Attribute, CompileOptions,
} from "./types.js";
import { moduleStatements, renderStatements, type FrontmatterModel } from "./frontmatter.js";

/**
 * Identifiers of the generated module. The runtime helpers live behind one
 * namespace so that frontmatter bindings named `escape`, `island`, … can
 * never replace them (a local `escape` would otherwise silently disable
 * HTML escaping). Frontmatter may not declare these names.
 */
const RUNTIME = "$$bangala";
const RENDER = "$$render";

/** Escapes text for safe inclusion inside a JS template literal. */
function literal(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** A `&` that does not already start a character reference. */
const BARE_AMPERSAND = /&(?!(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/g;

/**
 * Escapes a static attribute value for HTML emission. Doubles up as both
 * an HTML-attribute escape (must escape bare `&` and `"`, while character
 * references the author wrote, like `&amp;`, are kept) AND a JS
 * template-literal escape (must escape backticks and `${`).
 */
function attrLiteral(text: string): string {
  const htmlEscaped = text
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(/"/g, "&quot;");
  return literal(htmlEscaped);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
};

/**
 * Decodes the character references of a static component prop, so that
 * `<Card title="Fish &amp; Chips"/>` passes the string `Fish & Chips` (the
 * component escapes it again when it renders it). Unknown named references
 * are kept as written.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (ref, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name] ?? ref;
    const hex = name[1] === "x" || name[1] === "X";
    const codePoint = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ref;
  });
}

/**
 * User code spliced into generated code. A `//` comment would swallow the
 * closing `)` the generator appends on the same line, so end with a line
 * break whenever the code might hold one.
 */
function js(code: string): string {
  return code.includes("//") ? `${code}\n` : code;
}

function attrsToObject(attributes: Attribute[]): string {
  const entries = attributes.map((a) => {
    const value = a.dynamic ? `(${js(a.value)})` : JSON.stringify(decodeEntities(a.value));
    return `${JSON.stringify(a.name)}: ${value}`;
  });
  return `{${entries.join(", ")}}`;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function generate(
  template: Template,
  frontmatter: FrontmatterModel,
  _options: CompileOptions,
): string {
  const byName = new Map(frontmatter.components.map((c) => [c.name, c.path]));

  function genNodes(nodes: TemplateNode[]): string {
    return nodes.map(genNode).join("");
  }

  function genElementAttrs(attributes: Attribute[]): string {
    return attributes
      .map((a) =>
        a.dynamic
          ? ` ${a.name}="\${${RUNTIME}.escape(${js(a.value)})}"`
          : ` ${a.name}="${attrLiteral(a.value)}"`,
      )
      .join("");
  }

  function genNode(node: TemplateNode): string {
    switch (node.type) {
      case "Text":
        return literal(node.value);
      case "Expression":
        return `\${${RUNTIME}.escape(${js(node.code)})}`;
      case "Slot":
        return `\${props.children ?? ""}`;
      case "Element": {
        const attrs = genElementAttrs(node.attributes);
        if (node.children.length === 0 && VOID_ELEMENTS.has(node.tag.toLowerCase())) {
          return `<${node.tag}${attrs}>`;
        }
        if (node.children.length === 0) return `<${node.tag}${attrs}></${node.tag}>`;
        return `<${node.tag}${attrs}>${genNodes(node.children)}</${node.tag}>`;
      }
      case "IfBlock": {
        const then = `\`${genNodes(node.then)}\``;
        const otherwise = node.otherwise ? `\`${genNodes(node.otherwise)}\`` : `""`;
        return `\${(${js(node.condition)}) ? ${then} : ${otherwise}}`;
      }
      case "EachBlock": {
        const inner = `\`${genNodes(node.body)}\``;
        return `\${await ${RUNTIME}.each(${js(node.list)}, async (${node.item}) => ${inner})}`;
      }
      case "Component": {
        const props = attrsToObject(node.attributes);
        if (node.island) {
          const path = byName.get(node.name)!.replace(/\.bangala$/, "");
          return `\${await ${RUNTIME}.island(${node.name}, ${props}, ${JSON.stringify(path)}, ${JSON.stringify(node.strategy!)})}`;
        }
        const children =
          node.children.length > 0
            ? `, async () => \`${genNodes(node.children)}\``
            : "";
        return `\${await ${RUNTIME}.renderComponent(${node.name}, ${props}${children})}`;
      }
    }
  }

  const renderBody = genNodes(template.nodes);
  // Hoisted imports/exports run at module scope; every other byte of the
  // frontmatter runs inside render(), verbatim (no re-indentation, so
  // multi-line strings keep their exact content).
  return [
    `import * as ${RUNTIME} from "bangala/runtime";`,
    ...moduleStatements(frontmatter).map((statement) =>
      statement.trimEnd().endsWith(";") ? statement : `${statement};`,
    ),
    `async function ${RENDER}(props) {`,
    renderStatements(frontmatter),
    `;return \`${renderBody}\`;`,
    `}`,
    `export { ${RENDER} as render };`,
    `export default { render: ${RENDER} };`,
  ].join("\n");
}
