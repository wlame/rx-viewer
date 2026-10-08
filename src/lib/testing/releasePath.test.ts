import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  interpolations,
  pasteViolations,
  readJustfile,
  runExpressionViolations,
  runScripts,
  variadicViolations,
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
  it('reads block and inline run scripts, and nothing after them', () => {
    const workflow = [
      'steps:',
      '  - name: one',
      '    run: |',
      '      echo "${{ github.ref_name }}"',
      '',
      '      echo done',
      '    env:',
      '      X: ${{ inputs.part }}',
      '  - run: just ci',
    ].join('\n');

    expect(runScripts(workflow)).toEqual([
      { line: 3, text: '      echo "${{ github.ref_name }}"\n\n      echo done' },
      { line: 9, text: 'just ci' },
    ]);
    expect(runExpressionViolations('w.yml', workflow)).toEqual([
      'w.yml:3: a run: script holds a ${{ … }} expression; pass it through env: and read it as "$NAME"',
    ]);
  });
});

describe('the repository workflows', () => {
  const names = readdirSync(resolve(ROOT, WORKFLOWS)).filter((name) => name.endsWith('.yml'));

  it('are read: ci.yml and release.yml run scripts', () => {
    expect(names).toEqual(expect.arrayContaining(['ci.yml', 'release.yml']));
    for (const name of names) {
      expect(runScripts(repoFile(`${WORKFLOWS}/${name}`)).length).toBeGreaterThan(0);
    }
  });

  it('paste no expression into a run script', () => {
    const violations = names.flatMap((name) =>
      runExpressionViolations(name, repoFile(`${WORKFLOWS}/${name}`)),
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
