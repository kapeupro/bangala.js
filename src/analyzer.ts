import type { Template, TemplateNode, IslandRef } from "./types.js";
import type { ComponentImport } from "./imports.js";

export interface AnalyzedTemplate {
  islands: IslandRef[];
  dependencies: string[];
}

export function analyze(
  template: Template,
  components: ComponentImport[],
): AnalyzedTemplate {
  const byName = new Map(components.map((c) => [c.name, c.path]));
  const islands: IslandRef[] = [];
  const dependencies = new Set<string>();

  function walk(nodes: TemplateNode[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Component": {
          const path = byName.get(node.name);
          if (path === undefined) {
            throw new Error(`<${node.name}> is not imported in the frontmatter`);
          }
          dependencies.add(path);
          if (node.island) {
            if (node.children.length > 0) {
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
  return { islands, dependencies: [...dependencies] };
}
