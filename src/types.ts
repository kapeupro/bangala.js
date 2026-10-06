// --- AST node types ---

export interface Attribute {
  name: string;
  /** Static text, or JS expression source if `dynamic` is true. */
  value: string;
  dynamic: boolean;
}

export interface TextNode {
  type: "Text";
  value: string;
}

export interface ExpressionNode {
  type: "Expression";
  /** Raw JS source between the braces. Not parsed. */
  code: string;
}

export interface ElementNode {
  type: "Element";
  tag: string;
  attributes: Attribute[];
  children: TemplateNode[];
}

export type ClientDirective = "client:load" | "client:idle" | "client:visible";

export interface ComponentNode {
  type: "Component";
  name: string;
  attributes: Attribute[];
  children: TemplateNode[];
  island: boolean;
  strategy: ClientDirective | null;
}

export interface IfBlockNode {
  type: "IfBlock";
  condition: string;
  then: TemplateNode[];
  otherwise: TemplateNode[] | null;
}

export interface EachBlockNode {
  type: "EachBlock";
  list: string;
  item: string;
  body: TemplateNode[];
}

export interface SlotNode {
  type: "Slot";
}

export type TemplateNode =
  | TextNode
  | ExpressionNode
  | ElementNode
  | ComponentNode
  | IfBlockNode
  | EachBlockNode
  | SlotNode;

export interface Template {
  /** Frontmatter code, byte for byte (without the `---` fences). */
  frontmatter: string;
  /** Offset of the frontmatter code in the .bangala source. */
  frontmatterOffset: number;
  nodes: TemplateNode[];
}

// --- Public compiler interfaces ---

export interface CompileOptions {
  filename: string;
  /**
   * Returns the URL written in an island's `data-entry`, given the import
   * specifier of its component as written (e.g. `"./Counter.bangala"`).
   * Defaults to the specifier without `.bangala` (`"./Counter"`), which a
   * bundler has to resolve. The Vite plugin points it at the component's
   * client module (`Counter.client.ts`).
   */
  islandEntry?: (componentPath: string) => string;
  /**
   * Rewrite `.bangala` import specifiers to `.js` (default `true`), for
   * setups that compile every `.bangala` file to a sibling `.js` module.
   * Bundlers that load `.bangala` files themselves pass `false`.
   */
  rewriteBangalaImports?: boolean;
}

export interface IslandRef {
  componentPath: string;
  strategy: ClientDirective;
}

export interface CompileResult {
  code: string;
  islands: IslandRef[];
  dependencies: string[];
}
