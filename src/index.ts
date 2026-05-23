import { parse } from "./parser.js";
import { extractImports } from "./imports.js";
import { analyze } from "./analyzer.js";
import { generate } from "./generator.js";
import type { CompileOptions, CompileResult } from "./types.js";

export type { CompileOptions, CompileResult, IslandRef } from "./types.js";
export { ParseError } from "./parser.js";

export function compile(source: string, options: CompileOptions): CompileResult {
  const template = parse(source, options.filename);
  const { components } = extractImports(template.frontmatter);
  const analysis = analyze(template, components);
  const code = generate(template, components, options);
  return {
    code,
    islands: analysis.islands,
    dependencies: analysis.dependencies,
  };
}
