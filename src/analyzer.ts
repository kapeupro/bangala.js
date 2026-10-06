import type { Template, TemplateNode, IslandRef } from "./types.js";
import type { FrontmatterModel } from "./frontmatter.js";

export interface AnalyzedTemplate {
  islands: IslandRef[];
  dependencies: string[];
}

export function analyze(
  template: Template,
  frontmatter: FrontmatterModel,
): AnalyzedTemplate {
  const byName = new Map(frontmatter.components.map((c) => [c.name, c.path]));
  const islands: IslandRef[] = [];

  function walk(nodes: TemplateNode[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Component": {
          const path = byName.get(node.name);
          if (path === undefined) throw new Error(missingComponentMessage(node.name, frontmatter));
          if (node.attributes.some((a) => a.name === "children")) {
            throw new Error(
              `<${node.name}>: the 'children' prop is reserved for slot content; pass content between the tags or rename the prop`,
            );
          }
          if (node.island) {
            const meaningful = node.children.filter((c) => !(c.type === "Text" && c.value.trim() === ""));
            if (meaningful.length > 0) {
              throw new Error(
                `Island <${node.name}> cannot have children in v1`,
              );
            }
            islands.push({ componentPath: path, strategy: node.strategy! });
          }
          walk(node.children);
          break;
        }
        case "Element":
          walk(node.children);
          break;
        case "IfBlock":
          walk(node.then);
          if (node.otherwise) walk(node.otherwise);
          break;
        case "EachBlock":
          walk(node.body);
          break;
        default:
          break;
      }
    }
  }

  walk(template.nodes);
  return { islands, dependencies: frontmatter.dependencies };
}

function missingComponentMessage(name: string, frontmatter: FrontmatterModel): string {
  for (const record of frontmatter.imports) {
    if (!record.bindings.some((b) => b.local === name)) continue;
    if (!/\.bangala(?:\?.*)?$/.test(record.specifier)) {
      return `<${name}> is imported from "${record.specifier}"; components must be default imports of .bangala files`;
    }
    return `<${name}> must be a default import of "${record.specifier}" (e.g. import ${name} from "${record.specifier}")`;
  }
  return `<${name}> is not imported in the frontmatter`;
}
