/**
 * Readers for the guard test of the release path: what the justfile
 * pastes into its shell lines, and what the GitHub workflows paste into
 * their `run:` scripts.
 *
 * just pastes a `{{…}}` expression into a recipe's shell line before the
 * shell reads it, and GitHub pastes a `${{ … }}` expression into a `run:`
 * script before the shell reads that. Either way the shell reads the
 * value as code: a quote in it ends the quoted string around it, and a
 * `;`, `$(` or backtick after that starts a command. A pushed tag name
 * may hold all of those (`v1.0.0';id;'` is a legal ref), and the version
 * a build stamps comes from `git describe`, which prints a tag name. So
 * a recipe pastes only variables the justfile assigns a string literal,
 * takes its arguments as `"$1"` or `"$@"`, and reads a computed value
 * from the environment; a workflow passes every expression to a script
 * through `env:`.
 *
 * The readers know the parts of just's syntax this repo uses and refuse
 * the rest: an expression they cannot read is reported, never let
 * through.
 */

/** A recipe of the justfile: its name, attributes, parameters and body lines. */
export interface JustRecipe {
  name: string;
  attributes: string[];
  parameters: { name: string; isVariadic: boolean }[];
  body: string[];
}

/** What the guard reads from a justfile. */
export interface Justfile {
  /** Each top-level variable, and whether its value is a string literal. */
  variables: Map<string, { isLiteral: boolean }>;
  recipes: JustRecipe[];
  /** `set positional-arguments`: every recipe takes its arguments as `$1`, `$2`, … */
  hasPositionalArguments: boolean;
}

const NAME = '[A-Za-z_][A-Za-z0-9_-]*';
const ASSIGNMENT = new RegExp(`^(?:export\\s+)?(${NAME})\\s*:=\\s*(.*)$`);
const STRING_LITERAL = /^(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/;
const ATTRIBUTE_LINE = /^\[([^\]]*)\]\s*$/;
const RECIPE_START = new RegExp(`^@?(${NAME})`);
/** A parameter after the recipe's name: `name`, `name='default'`, `*args`, `+args`, `$name`. */
const PARAMETER = new RegExp(
  `^\\s+([*+]?)\\$?(${NAME})(?:=(?:'[^']*'|"(?:[^"\\\\]|\\\\.)*"|[^\\s:'"]+))?`,
);
const SET_POSITIONAL = /^set\s+positional-arguments(?:\s*:=\s*true)?\s*$/;

/** The parameters of a recipe's header, from after its name to its `:`; throws on one it cannot read. */
function readParameters(rest: string, line: string): JustRecipe['parameters'] {
  const parameters: JustRecipe['parameters'] = [];
  let text = rest;
  for (;;) {
    if (/^\s*:(?!=)/.test(text)) return parameters;
    const match = PARAMETER.exec(text);
    if (!match) throw new Error(`cannot read the parameters of the recipe line: ${line}`);
    parameters.push({ name: match[2], isVariadic: match[1] !== '' });
    text = text.slice(match[0].length);
  }
}

/** Whether a line starts a recipe body: indented, or blank inside one. */
function isBodyLine(line: string): boolean {
  return line === '' || /^\s/.test(line);
}

/**
 * Read the variables, recipes and settings of a justfile. A line at the
 * left margin is a comment, a setting, an assignment, an attribute or a
 * recipe's header; the indented lines after a header are its body.
 * Throws on a line it cannot read.
 */
export function readJustfile(text: string): Justfile {
  const variables = new Map<string, { isLiteral: boolean }>();
  const recipes: JustRecipe[] = [];
  let hasPositionalArguments = false;
  let attributes: string[] = [];
  let recipe: JustRecipe | null = null;

  for (const line of text.split('\n')) {
    if (recipe !== null && isBodyLine(line)) {
      recipe.body.push(line);
      continue;
    }
    recipe = null;
    if (line.trim() === '' || line.startsWith('#')) continue;

    const attribute = ATTRIBUTE_LINE.exec(line);
    if (attribute) {
      attributes.push(...attribute[1].split(',').map((name) => name.trim()));
      continue;
    }
    if (line.startsWith('set ')) {
      hasPositionalArguments ||= SET_POSITIONAL.test(line);
      continue;
    }
    const assignment = ASSIGNMENT.exec(line);
    if (assignment) {
      variables.set(assignment[1], { isLiteral: STRING_LITERAL.test(assignment[2].trim()) });
      continue;
    }
    const start = RECIPE_START.exec(line);
    if (!start) throw new Error(`cannot read the justfile line: ${line}`);
    const parameters = readParameters(line.slice(start[0].length), line);
    recipe = { name: start[1], attributes, parameters, body: [] };
    recipes.push(recipe);
    attributes = [];
  }
  return { variables, recipes, hasPositionalArguments };
}

/**
 * The `{{…}}` expressions of a body line, each as written between the
 * braces. `{{{{` is just's escape for a literal `{{`. An expression that
 * is not closed on its line is given as `{{` and the rest of the line,
 * which no rule accepts.
 */
export function interpolations(line: string): string[] {
  const found: string[] = [];
  let at = 0;
  while (at < line.length) {
    if (line.startsWith('{{{{', at)) {
      at += 4;
    } else if (line.startsWith('{{', at)) {
      const end = line.indexOf('}}', at + 2);
      if (end < 0) return [...found, line.slice(at)];
      found.push(line.slice(at + 2, end).trim());
      at = end + 2;
    } else {
      at += 1;
    }
  }
  return found;
}

/**
 * Why a recipe may not paste `expression` into its shell line, or null
 * when it may: the expression is exactly a top-level variable assigned a
 * string literal, and no parameter of the recipe has its name.
 */
function pasteViolation(justfile: Justfile, recipe: JustRecipe, expression: string): string | null {
  const isName = new RegExp(`^${NAME}$`).test(expression);
  if (!isName) {
    return `recipe ${recipe.name} pastes the expression {{${expression}}} into its shell line; only a variable assigned a string literal may be pasted: export the value and read it as "$NAME"`;
  }
  if (recipe.parameters.some((parameter) => parameter.name === expression)) {
    return `recipe ${recipe.name} pastes its parameter {{${expression}}} into its shell line; give the recipe [positional-arguments] and read "$1" or "$@"`;
  }
  if (!justfile.variables.get(expression)?.isLiteral) {
    return `recipe ${recipe.name} pastes {{${expression}}}, a value just computes when it runs, into its shell line; export it and read it as "$NAME"`;
  }
  return null;
}

/** Every `{{…}}` a recipe of `justfile` pastes that is not a variable assigned a string literal. */
export function pasteViolations(justfile: Justfile): string[] {
  return justfile.recipes.flatMap((recipe) =>
    recipe.body
      .flatMap(interpolations)
      .map((expression) => pasteViolation(justfile, recipe, expression))
      .filter((violation): violation is string => violation !== null),
  );
}

/** Every recipe that takes a variadic parameter without receiving its arguments as `$1`, `$2`, … */
export function variadicViolations(justfile: Justfile): string[] {
  return justfile.recipes
    .filter((recipe) => recipe.parameters.some((parameter) => parameter.isVariadic))
    .filter(
      (recipe) =>
        !justfile.hasPositionalArguments && !recipe.attributes.includes('positional-arguments'),
    )
    .map(
      (recipe) =>
        `recipe ${recipe.name} takes a variadic parameter without [positional-arguments]; its arguments are split at spaces`,
    );
}

/** A `run:` script of a workflow: the line it starts on (from 1) and its text. */
export interface RunScript {
  line: number;
  text: string;
}

const RUN_KEY = /^(\s*)(?:-\s+)?run:\s*(.*)$/;
const BLOCK_SCALAR = /^[|>][-+]?\d*\s*(?:#.*)?$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The `run:` scripts of a workflow: a block (`run: |`) is every line
 * after the key indented more than the key, or blank; an inline value is
 * the rest of the key's line.
 */
export function runScripts(workflow: string): RunScript[] {
  const lines = workflow.split('\n');
  const scripts: RunScript[] = [];
  lines.forEach((line, index) => {
    const run = RUN_KEY.exec(line);
    if (!run) return;
    if (!BLOCK_SCALAR.test(run[2])) {
      scripts.push({ line: index + 1, text: run[2] });
      return;
    }
    const keyIndent = indentOf(line) + (line.trimStart().startsWith('-') ? 2 : 0);
    const block: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && indentOf(next) <= keyIndent) break;
      block.push(next);
    }
    scripts.push({ line: index + 1, text: block.join('\n') });
  });
  return scripts;
}

/** Every `run:` script of a workflow that holds a `${{ … }}` expression, by the line it starts on. */
export function runExpressionViolations(name: string, workflow: string): string[] {
  return runScripts(workflow)
    .filter((script) => script.text.includes('${{'))
    .map(
      (script) =>
        `${name}:${script.line}: a run: script holds a \${{ … }} expression; pass it through env: and read it as "$NAME"`,
    );
}
