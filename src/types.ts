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

export interface ComponentNode {
  type: "Component";
  name: string;
  attributes: Attribute[];
  children: TemplateNode[];
  island: boolean;
  strategy: "client:load" | null;
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
  frontmatter: string;
  nodes: TemplateNode[];
}

// --- Public compiler interfaces ---

export interface CompileOptions {
  filename: string;
}

export interface IslandRef {
  componentPath: string;
  strategy: "client:load";
}

export interface CompileResult {
  code: string;
  islands: IslandRef[];
  dependencies: string[];
}
