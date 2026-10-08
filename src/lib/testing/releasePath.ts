/**
 * Readers for the guard test of the release path: what the justfile
 * pastes into its shell lines, and where the GitHub workflows and the
 * repository's actions hold a `${{ … }}` expression.
 *
 * just pastes a `{{…}}` expression into a recipe's shell line before the
 * shell reads it, and GitHub pastes a `${{ … }}` expression into a `run:`
 * script (or a `shell:`, or the script of actions/github-script) before
 * the shell or the script reads it. Either way the value is read as
 * code: a quote in it ends the quoted string around it, and a `;`, `$(`
 * or backtick after that starts a command. A pushed tag name may hold
 * all of those (`v1.0.0';id;'` is a legal ref), and the version a build
 * stamps comes from `git describe`, which prints a tag name. So a recipe
 * pastes only variables the justfile assigns a string literal, takes its
 * arguments as `"$1"` or `"$@"`, and reads a computed value from the
 * environment; a workflow passes every expression to a script through
 * `env:`.
 *
 * The readers refuse what they cannot read: the justfile reader knows the
 * parts of just's syntax this repo uses, and the workflow reader lets an
 * expression stand only at the places listed in `EXPRESSION_PLACES`.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseAllDocuments, visit, type Document } from 'yaml';

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

/** A file GitHub reads steps from: a workflow, or an action kept in the repository. */
export type WorkflowFileKind = 'workflow' | 'action';

/** A file the workflow guard reads: its path from the repository root, and its kind. */
export interface GuardedWorkflowFile {
  path: string;
  kind: WorkflowFileKind;
}

/** What starts an expression GitHub evaluates and pastes into the value that holds it. */
const EXPRESSION = '${{';

/**
 * The places of a workflow or an action where GitHub hands a value to no
 * shell and no script: the only places a `${{ … }}` may stand. A place
 * names the mapping keys and sequence items from the document's root:
 * `*` is any key, `#` any item. Every other place is refused, so a new
 * form of a shell step (a key spelled another way, a value reached
 * through an alias or a merge) is refused rather than missed.
 */
const EXPRESSION_PLACES: Record<WorkflowFileKind, readonly string[]> = {
  workflow: [
    'run-name',
    'env.*',
    'jobs.*.name',
    'jobs.*.if',
    'jobs.*.runs-on',
    'jobs.*.env.*',
    'jobs.*.outputs.*',
    'jobs.*.with.*',
    'jobs.*.steps.#.name',
    'jobs.*.steps.#.if',
    'jobs.*.steps.#.env.*',
    'jobs.*.steps.#.with.*',
  ],
  action: [
    'inputs.*.default',
    'outputs.*.value',
    'runs.steps.#.name',
    'runs.steps.#.if',
    'runs.steps.#.env.*',
    'runs.steps.#.with.*',
  ],
};

/** Action inputs that hold code the action runs (actions/github-script runs `script`), refused under any `with`. */
const SCRIPT_INPUTS: ReadonlySet<string> = new Set(['script']);

/** The most aliases a file may resolve; more is refused (an alias can repeat a large value many times). */
const MAX_ALIASES = 100;

/** A place in a document: its mapping keys and sequence items from the root. */
type Place = readonly (string | number)[];

/** Whether `place` is the place `pattern` names (see `EXPRESSION_PLACES`). */
function isPlaceOf(place: Place, pattern: string): boolean {
  const steps = pattern.split('.');
  return (
    steps.length === place.length &&
    steps.every((step, i) => {
      const at = place[i];
      if (step === '#') return typeof at === 'number';
      return typeof at === 'string' && (step === '*' || step === at);
    })
  );
}

/** Whether GitHub hands the value at `place` of a `kind` file to no shell and no script. */
function isExpressionPlace(kind: WorkflowFileKind, place: Place): boolean {
  const name = place.at(-1);
  if (place.at(-2) === 'with' && typeof name === 'string' && SCRIPT_INPUTS.has(name)) return false;
  return EXPRESSION_PLACES[kind].some((pattern) => isPlaceOf(place, pattern));
}

/** A place as a person reads it: `jobs.build.steps[0].run`. */
function placeName(place: Place): string {
  return place
    .map((at, i) => (typeof at === 'number' ? `[${at}]` : i === 0 ? at : `.${at}`))
    .join('');
}

/** An expression found in a document: at a value's place, or in a key of the mapping at `place`. */
interface FoundExpression {
  place: Place;
  isKey: boolean;
}

/**
 * Every expression in a document read into plain values: each string
 * value or key that holds one. A value that holds itself (a recursive
 * alias) is reported as found where it repeats, never walked again.
 */
function expressionsIn(value: unknown, place: Place, ancestors: Set<object>): FoundExpression[] {
  if (typeof value === 'string') return value.includes(EXPRESSION) ? [{ place, isKey: false }] : [];
  if (typeof value !== 'object' || value === null) return [];
  if (ancestors.has(value)) return [{ place, isKey: false }];
  const inside = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => expressionsIn(item, [...place, i], inside));
  }
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key.includes(EXPRESSION) ? [{ place, isKey: true }] : []),
    ...expressionsIn(item, [...place, key], inside),
  ]);
}

/**
 * Why a document cannot be checked as text: the first explicit tag it
 * holds (`!!binary` turns base64 into bytes that may spell `${{`), or
 * null when it holds none. Workflows have no use for a tag.
 */
function tagIn(document: Document.Parsed): string | null {
  let tag: string | null = null;
  visit(document, {
    Node(_key, node) {
      if (node.tag === undefined) return undefined;
      tag = `a value tagged ${node.tag}, which the guard does not read as text`;
      return visit.BREAK;
    },
  });
  return tag;
}

function expressionViolation(name: string, found: FoundExpression): string {
  const where = placeName(found.place);
  if (found.isKey) {
    return `${name}: ${where} holds a \${{ … }} expression in a key, where GitHub reads none`;
  }
  return `${name}: ${where} holds a \${{ … }} expression outside the places GitHub hands it to no shell and no script; pass it through env: and read it as "$NAME"`;
}

/**
 * Every `${{ … }}` of a workflow or an action file (`text`, named `name`
 * in the messages) that stands outside the places GitHub hands to no
 * shell and no script (`EXPRESSION_PLACES`). The file is read by a YAML
 * parser, so every form of a value counts: a block, a plain or quoted
 * scalar over several lines, a flow mapping, a quoted key, an escape
 * such as `\x24{{`, an alias, a merge key. Every scalar is read as text
 * (the failsafe schema). A file the parser cannot read, reads with a
 * warning, or that holds an explicit tag, is refused.
 */
export function workflowExpressionViolations(
  name: string,
  text: string,
  kind: WorkflowFileKind,
): string[] {
  const violations: string[] = [];
  for (const document of parseAllDocuments(text, { schema: 'failsafe' })) {
    const problem = document.errors[0]?.message ?? document.warnings[0]?.message ?? tagIn(document);
    if (problem !== null) {
      violations.push(`${name}: cannot read the YAML: ${problem}`);
      continue;
    }
    let value: unknown;
    try {
      value = document.toJS({ maxAliasCount: MAX_ALIASES });
    } catch (error) {
      violations.push(`${name}: cannot read the YAML: ${(error as Error).message}`);
      continue;
    }
    for (const found of expressionsIn(value, [], new Set())) {
      if (found.isKey || !isExpressionPlace(kind, found.place)) {
        violations.push(expressionViolation(name, found));
      }
    }
  }
  return violations;
}

/** The directory GitHub reads workflows from: its files, not its subdirectories. */
const WORKFLOWS_DIR = '.github/workflows';

/** The directory that holds the repository's own actions, at any depth. */
const ACTIONS_DIR = '.github/actions';

const YAML_NAME = /\.ya?ml$/i;

/** How many directories deep the guard reads under `ACTIONS_DIR`; deeper is refused, never skipped. */
const MAX_ACTION_DEPTH = 16;

/** The YAML files in `dir` (a path from `root`), and with `depth` in its subdirectories that deep. */
function yamlFilesIn(root: string, dir: string, depth: number): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .sort()
    .flatMap((entry) => {
      const path = `${dir}/${entry}`;
      // statSync follows a link, so a linked file or directory is read as what it names.
      const stat = statSync(join(root, path));
      if (stat.isFile()) return YAML_NAME.test(entry) ? [path] : [];
      if (!stat.isDirectory() || depth === 0) return [];
      if (depth === 1) throw new Error(`${path} is more than ${MAX_ACTION_DEPTH} directories deep`);
      return yamlFilesIn(root, path, depth - 1);
    });
}

/**
 * The files of the repository at `root` the workflow guard reads: every
 * `.yml` and `.yaml` workflow, and every YAML file under
 * `.github/actions` at any depth (a composite action's `action.yml`
 * runs steps too). Sorted by path.
 */
export function guardedWorkflowFiles(root: string): GuardedWorkflowFile[] {
  const workflows = yamlFilesIn(root, WORKFLOWS_DIR, 0).map((path) => ({
    path,
    kind: 'workflow' as const,
  }));
  const actions = yamlFilesIn(root, ACTIONS_DIR, MAX_ACTION_DEPTH + 1).map((path) => ({
    path,
    kind: 'action' as const,
  }));
  return [...workflows, ...actions].sort((a, b) => (a.path < b.path ? -1 : 1));
}
