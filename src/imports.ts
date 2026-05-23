export interface ComponentImport {
  name: string;
  path: string;
}

export interface ExtractedImports {
  /** Import statements, hoisted, with .bangala specifiers rewritten to .js. */
  imports: string[];
  /** Frontmatter with the import lines removed. */
  body: string;
  /** Default-imported .bangala components, by local name and original path. */
  components: ComponentImport[];
}

const IMPORT_RE = /^\s*import\s.+$/;
const DEFAULT_BANGALA_RE = /^\s*import\s+(\w+)\s+from\s+["']([^"']+\.bangala)["']/;

export function extractImports(frontmatter: string): ExtractedImports {
  const imports: string[] = [];
  const components: ComponentImport[] = [];
  const bodyLines: string[] = [];

  for (const line of frontmatter.split("\n")) {
    if (!IMPORT_RE.test(line)) {
      bodyLines.push(line);
      continue;
    }
    const component = line.match(DEFAULT_BANGALA_RE);
    if (component) {
      components.push({ name: component[1]!, path: component[2]! });
    }
    imports.push(line.replace(/(\.bangala)(["'])/g, ".js$2").trim());
  }

  return { imports, body: bodyLines.join("\n").trim(), components };
}
