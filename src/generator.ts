import type {
  Template, TemplateNode, Attribute, CompileOptions,
} from "./types.js";
import { extractImports, type ComponentImport } from "./imports.js";

/** Escapes text for safe inclusion inside a JS template literal. */
function literal(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function attrsToObject(attributes: Attribute[]): string {
  const entries = attributes.map((a) => {
    const value = a.dynamic ? a.value : JSON.stringify(a.value);
    return `${JSON.stringify(a.name)}: ${value}`;
  });
  return `{${entries.join(", ")}}`;
}

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
          : ` ${a.name}="${literal(a.value)}"`,
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
          return `\${await island(${node.name}, ${props}, ${JSON.stringify(path)}, "client:load")}`;
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
  const lines = [
    `import { escape, renderComponent, island } from "bangala/runtime";`,
    ...imports,
    ``,
    `async function render(props) {`,
    body ? `  ${body.split("\n").join("\n  ")}` : "",
    `  return \`${renderBody}\`;`,
    `}`,
    ``,
    `export { render };`,
    `export default { render };`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}
