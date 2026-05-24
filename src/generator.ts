import type {
  Template, TemplateNode, Attribute, CompileOptions,
} from "./types.js";
import { extractImports, type ComponentImport } from "./imports.js";

/** Escapes text for safe inclusion inside a JS template literal. */
function literal(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * Escapes a static attribute value for HTML emission. Doubles up as both
 * an HTML-attribute escape (must escape `&`, `"`) AND a JS template-literal
 * escape (must escape backticks and `${`). The HTML escape runs first; the
 * template-literal escape then runs over the (already HTML-safe) text.
 */
function attrLiteral(text: string): string {
  const htmlEscaped = text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  return literal(htmlEscaped);
}

function attrsToObject(attributes: Attribute[]): string {
  const entries = attributes.map((a) => {
    const value = a.dynamic ? a.value : JSON.stringify(a.value);
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
  components: ComponentImport[],
  _options: CompileOptions,
): string {
  const byName = new Map(components.map((c) => [c.name, c.path]));
  const { imports, body } = extractImports(template.frontmatter);

  function genNodes(nodes: TemplateNode[]): string {
    return nodes.map(genNode).join("");
  }

  function genElementAttrs(attributes: Attribute[]): string {
    return attributes
      .map((a) =>
        a.dynamic
          ? ` ${a.name}="\${escape(${a.value})}"`
          : ` ${a.name}="${attrLiteral(a.value)}"`,
      )
      .join("");
  }

  function genNode(node: TemplateNode): string {
    switch (node.type) {
      case "Text":
        return literal(node.value);
      case "Expression":
        return `\${escape(${node.code})}`;
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
        return `\${(${node.condition}) ? ${then} : ${otherwise}}`;
      }
      case "EachBlock": {
        const inner = `\`${genNodes(node.body)}\``;
        return (
          `\${(await Promise.all([...${node.list}]` +
          `.map(async (${node.item}) => ${inner}))).join("")}`
        );
      }
      case "Component": {
        const props = attrsToObject(node.attributes);
        if (node.island) {
          const path = byName.get(node.name)!.replace(/\.bangala$/, "");
          return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, ${JSON.stringify(node.strategy!)})}`;
        }
        const children =
          node.children.length > 0
            ? `, async () => \`${genNodes(node.children)}\``
            : "";
        return `\${await renderComponent(${node.name}, ${props}${children})}`;
      }
    }
  }

  const renderBody = genNodes(template.nodes);
  const { topLevel, inRender } = splitFrontmatterExports(body);
  const lines = [
    `import { escape, renderComponent, island } from "bangala/runtime";`,
    ...imports,
    ``,
    topLevel,
    `async function render(props) {`,
    inRender ? `  ${inRender.split("\n").join("\n  ")}` : "",
    `  return \`${renderBody}\`;`,
    `}`,
    ``,
    `export { render };`,
    `export default { render };`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/**
 * Splits the frontmatter into two pieces:
 *  - `topLevel`: lines that must live at the top of the generated module
 *    (they use `export`, ESM doesn't allow that inside a function body)
 *  - `inRender`: everything else, executed inside the page's render(props).
 *
 * Function/class declarations whose header carries `export` are kept as a
 * single block by following brace depth across lines.
 */
function splitFrontmatterExports(body: string): { topLevel: string; inRender: string } {
  if (!body) return { topLevel: "", inRender: "" };
  const lines = body.split("\n");
  const topLines: string[] = [];
  const renderLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!/^\s*export\b/.test(line)) {
      renderLines.push(line);
      i++;
      continue;
    }
    const trimmed = line.trim();
    const isBlock = /^export\s+(?:async\s+)?(?:function|class)\b/.test(trimmed);
    if (!isBlock) {
      topLines.push(line);
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let opened = false;
    while (i < lines.length) {
      const cur = lines[i]!;
      for (const ch of cur) {
        if (ch === "{") { depth++; opened = true; }
        else if (ch === "}") depth--;
      }
      i++;
      if (opened && depth === 0) break;
    }
    topLines.push(lines.slice(start, i).join("\n"));
  }
  return { topLevel: topLines.join("\n"), inRender: renderLines.join("\n") };
}
