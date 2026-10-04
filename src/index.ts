import { parse, parseErrorAt } from "./parser.js";
import { analyzeFrontmatter, FrontmatterError, type FrontmatterModel } from "./frontmatter.js";
import { analyze } from "./analyzer.js";
import { generate } from "./generator.js";
import type { CompileOptions, CompileResult, Template } from "./types.js";

export type { CompileOptions, CompileResult, IslandRef } from "./types.js";
export { ParseError } from "./parser.js";

export function compile(source: string, options: CompileOptions): CompileResult {
  const template = parse(source, options.filename);
  const frontmatter = modelFrontmatter(template, source);
  const analysis = analyze(template, frontmatter);
  const code = generate(template, frontmatter, options);
  return {
    code,
    islands: analysis.islands,
    dependencies: analysis.dependencies,
  };
}

/** Builds the frontmatter model, reporting problems as located ParseErrors. */
function modelFrontmatter(template: Template, source: string): FrontmatterModel {
  try {
    return analyzeFrontmatter(template.frontmatter);
  } catch (error) {
    if (error instanceof FrontmatterError) {
      throw parseErrorAt(error.message, source, template.frontmatterOffset + error.offset);
    }
    throw error;
  }
}
