import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  guardedWorkflowFiles,
  interpolations,
  pasteViolations,
  readJustfile,
  variadicViolations,
  workflowExpressionViolations,
} from './releasePath';

/** The repository root, seen from this file. */
const ROOT = resolve(__dirname, '../../..');

function repoFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf-8');
}

const WORKFLOWS = '.github/workflows';

/** The exact form of a release tag, as the workflow checks it. */
const TAG_FORM = '^v[0-9]+\\.[0-9]+\\.[0-9]+$';

describe('the justfile guard', () => {
  /** A justfile with one variable assigned a literal, and `text` after it. */
  const withRecipe = (text: string) => `literal := "v"\n\n${text}\n`;

  it.each([
    ['a backtick', "crafted:\n    echo '{{`git describe --tags`}}'"],
    ['a function of no variable', 'crafted:\n    echo \'{{env("GITHUB_REF_NAME", "x")}}\''],
    ['a function of a literal variable', "crafted:\n    echo '{{env_var(literal)}}'"],
    ['a literal joined to a backtick', "crafted:\n    echo '{{literal + `git describe`}}'"],
    [
      'a condition on a literal variable',
      'crafted:\n    echo \'{{ if literal == "v" { `git describe` } else { "" } }}\'',
    ],
    ['a string literal', 'crafted:\n    echo \'{{"text"}}\''],
    [
      'a computed variable',
      "computed := `git describe --tags`\n\ncrafted:\n    echo '{{computed}}'",
    ],
    ['a recipe parameter', "crafted tag:\n    echo '{{tag}}'"],
    ['a parameter named like a literal variable', "crafted literal:\n    echo '{{literal}}'"],
    ['an unknown name', "crafted:\n    echo '{{unknown}}'"],
    ['an expression left open', "crafted:\n    echo '{{literal'"],
  ])('refuses %s pasted into a shell line', (_name, text) => {
    const violations = pasteViolations(readJustfile(withRecipe(text)));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^recipe crafted /);
  });

  it('lets a variable assigned a string literal through, and the escaped braces', () => {
    const justfile = readJustfile(withRecipe("crafted:\n    echo '{{literal}}' '{{{{x}}'"));

    expect(pasteViolations(justfile)).toEqual([]);
  });

  it('reads the expressions of a line, and none in escaped braces', () => {
    expect(interpolations('a {{ x }} b {{{{ c {{y}}')).toEqual(['x', 'y']);
  });

  it('refuses a variadic recipe without positional arguments, and lets one with them through', () => {
    const justfile = readJustfile(
      'bare *args:\n    echo "$@"\n\n[positional-arguments]\nplaced *args:\n    echo "$@"\n',
    );

    expect(variadicViolations(justfile)).toEqual([
      'recipe bare takes a variadic parameter without [positional-arguments]; its arguments are split at spaces',
    ]);
  });

  it('refuses a line it cannot read', () => {
    expect(() => readJustfile('crafted x=:\n    echo\n')).toThrow('cannot read');
  });
});

describe('the repository justfile', () => {
  const justfile = readJustfile(repoFile('justfile'));

  // The guard reads what it checks: these recipes have been there from the start.
  it('is read with its recipes and their parameters', () => {
    const names = justfile.recipes.map((recipe) => recipe.name);
    expect(names).toEqual(expect.arrayContaining(['ci', 'test', 'bun', 'dev', 'release-notes']));
    const test = justfile.recipes.find((recipe) => recipe.name === 'test');
    expect(test?.parameters).toEqual([{ name: 'args', isVariadic: true }]);
  });

  it('pastes only variables assigned a string literal into its shell lines', () => {
    expect(pasteViolations(justfile)).toEqual([]);
  });

  it('passes each argument of a variadic recipe on as one word', () => {
    expect(variadicViolations(justfile)).toEqual([]);
  });
});

describe('the workflow guard', () => {
  /** A workflow whose one job runs `steps`, each line indented under `steps:`. */
  const workflowWith = (steps: string) =>
    ['on: push', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps:', steps, ''].join(
      '\n',
    );

  it.each([
    ['a run script in a block', '      - run: |\n          echo "${{ github.ref_name }}"'],
    [
      'a run script that starts on the next line',
      '      - name: x\n        run:\n          echo "${{ github.ref_name }}"',
    ],
    [
      'a plain run script continued on a second line',
      '      - name: x\n        run: echo start\n          "${{ github.ref_name }}"',
    ],
    [
      'a double-quoted run script continued on a second line',
      '      - name: x\n        run: "echo start\n          ${{ github.ref_name }}"',
    ],
    ['a step written as a flow mapping', '      - { name: x, run: "echo ${{ github.ref_name }}" }'],
    ['a quoted run key', '      - name: x\n        "run": echo ${{ github.ref_name }}'],
    [
      'a run script that is an alias of an anchored env value',
      '      - env:\n          S: &s echo ${{ github.ref_name }}\n        run: *s',
    ],
    [
      'a shell that holds the expression',
      '      - shell: bash -c "echo ${{ github.ref_name }}; {0}"\n        run: echo hi',
    ],
    [
      'the script input of actions/github-script',
      '      - uses: actions/github-script@v7\n        with:\n          script: console.log("${{ github.ref_name }}")',
    ],
    [
      'an expression spelled with an escape in a double-quoted script',
      '      - run: "echo \\x24{{ github.ref_name }}"',
    ],
    [
      'a run script merged in from an anchored mapping',
      '      - uses: some/action@v1\n        with: &inputs\n          run: echo ${{ github.ref_name }}\n      - <<: *inputs\n        name: merged',
    ],
  ])('refuses %s', (_name, steps) => {
    const violations = workflowExpressionViolations('w.yml', workflowWith(steps), 'workflow');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/^w\.yml: jobs\.build\.steps\[\d\]\./);
  });

  it('refuses an expression in the default shell of every run step', () => {
    const workflow = [
      'on: push',
      'defaults:',
      '  run:',
      '    shell: bash -c "${{ inputs.x }} {0}"',
      'jobs: {}',
    ].join('\n');

    expect(workflowExpressionViolations('w.yml', workflow, 'workflow')).toEqual([
      'w.yml: defaults.run.shell holds a ${{ … }} expression outside the places GitHub hands it to no shell and no script; pass it through env: and read it as "$NAME"',
    ]);
  });

  it('lets an expression through in an if, an env value or an action input', () => {
    const workflow = [
      'on: push',
      'env:',
      '  TOP: ${{ github.sha }}',
      'jobs:',
      '  build:',
      "    if: ${{ github.event_name == 'push' }}",
      '    runs-on: ubuntu-latest',
      '    env:',
      '      JOB: ${{ github.ref_name }}',
      '    steps:',
      '      - uses: actions/checkout@v4',
      "        if: ${{ github.ref == 'refs/heads/main' }}",
      '        with:',
      '          ref: ${{ github.ref }}',
      '      - run: echo "$TAG"',
      '        env:',
      '          TAG: ${{ github.ref_name }}',
    ].join('\n');

    expect(workflowExpressionViolations('w.yml', workflow, 'workflow')).toEqual([]);
  });

  it('refuses an expression in a key', () => {
    const workflow = workflowWith(
      '      - env:\n          "${{ github.ref_name }}": x\n        run: echo',
    );

    expect(workflowExpressionViolations('w.yml', workflow, 'workflow')).toEqual([
      'w.yml: jobs.build.steps[0].env holds a ${{ … }} expression in a key, where GitHub reads none',
    ]);
  });

  it.each([
    ['a file it cannot read as YAML', 'jobs:\n  a: [\n'],
    ['a value with an explicit tag', 'jobs:\n  a:\n    steps:\n      - run: !!binary JHt7\n'],
    ['a value with an unknown tag', 'jobs:\n  a:\n    steps:\n      - run: !custom x\n'],
  ])('refuses %s', (_name, workflow) => {
    const violations = workflowExpressionViolations('w.yml', workflow, 'workflow');

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^w\.yml: cannot read the YAML: /);
  });

  it('refuses a run step of a composite action, and lets its outputs and input defaults through', () => {
    const action = [
      'name: x',
      'inputs:',
      '  token:',
      '    default: ${{ github.token }}',
      'outputs:',
      '  out:',
      '    value: ${{ steps.a.outputs.b }}',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: echo "${{ inputs.token }}"',
      '      shell: bash',
    ].join('\n');

    expect(workflowExpressionViolations('action.yml', action, 'action')).toEqual([
      'action.yml: runs.steps[0].run holds a ${{ … }} expression outside the places GitHub hands it to no shell and no script; pass it through env: and read it as "$NAME"',
    ]);
  });

  it('lists the workflows by .yml and .yaml, and every YAML file under .github/actions', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-guard-'));
    try {
      const write = (path: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), 'name: x\n');
      };
      write('.github/workflows/a.yml');
      write('.github/workflows/b.yaml');
      write('.github/workflows/notes.txt');
      write('.github/actions/setup/action.yml');
      write('.github/actions/deep/inner/action.yaml');
      write('.github/dependabot.yml');

      expect(guardedWorkflowFiles(root)).toEqual([
        { path: '.github/actions/deep/inner/action.yaml', kind: 'action' },
        { path: '.github/actions/setup/action.yml', kind: 'action' },
        { path: '.github/workflows/a.yml', kind: 'workflow' },
        { path: '.github/workflows/b.yaml', kind: 'workflow' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the repository workflows', () => {
  const guarded = guardedWorkflowFiles(ROOT);

  it('are read: ci.yml and release.yml among them', () => {
    expect(guarded.map((file) => file.path)).toEqual(
      expect.arrayContaining([`${WORKFLOWS}/ci.yml`, `${WORKFLOWS}/release.yml`]),
    );
  });

  it('hold an expression only where GitHub hands it to no shell and no script', () => {
    const violations = guarded.flatMap((file) =>
      workflowExpressionViolations(file.path, repoFile(file.path), file.kind),
    );
    expect(violations).toEqual([]);
  });

  // A pushed tag stops the job before anything is checked out or run;
  // the tag a dispatch cuts is checked before any later step reads it.
  it('checks the tag name against vX.Y.Z first on a tag push, and before the release reads it', () => {
    const release = repoFile(`${WORKFLOWS}/release.yml`);
    const steps = release.split(/\n {6}- name: /).slice(1);

    expect(steps[0]).toContain("if: github.event_name == 'push'");
    expect(steps[0]).toContain(`"$GITHUB_REF_NAME" =~ ${TAG_FORM}`);
    const resolving = steps.find((step) => step.includes('GITHUB_OUTPUT'));
    expect(resolving).toContain(`"$tag" =~ ${TAG_FORM}`);
  });

  // `git describe`, the justfile's default version, prefers an annotated
  // tag on the release commit to the tag the release was started for.
  it('stamps the checked tag as the bundle version, and fails unless the stamp is exactly that tag', () => {
    const release = repoFile(`${WORKFLOWS}/release.yml`);
    const steps = release.split(/\n {6}- name: /).slice(1);
    const resolving = steps.findIndex((step) => step.includes('GITHUB_OUTPUT'));
    const packaging = steps.findIndex((step) => step.startsWith('package'));
    const verifying = steps.findIndex((step) => step.startsWith('verify the bundle'));

    expect(resolving).toBeGreaterThanOrEqual(0);
    expect(packaging).toBeGreaterThan(resolving);
    expect(steps[packaging]).toContain('TAG: ${{ steps.release_tag.outputs.name }}');
    expect(steps[packaging]).toContain('just --set version "$TAG" package');
    expect(verifying).toBeGreaterThan(packaging);
    expect(steps[verifying]).toContain('[ "$version" = "$TAG" ]');
  });
});
