import { describe, it, expect } from 'vitest';
import { formatVersionTag } from './versionTag';

/**
 * dist/version.json is written from `git describe --tags`, so its value
 * already carries the leading "v". Anything that renders it — the badge
 * label and the GitHub release link — must not add a second one, and must
 * still work if the value ever arrives bare.
 */
describe('formatVersionTag', () => {
  it.each([
    ['v0.2.0', 'v0.2.0'],
    ['0.2.0', 'v0.2.0'],
    ['v0.2.0-18-g962f1a2', 'v0.2.0-18-g962f1a2'],
    ['0.2.0-18-g962f1a2', 'v0.2.0-18-g962f1a2'],
    ['v1.0.0-rc.1', 'v1.0.0-rc.1'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatVersionTag(input)).toBe(expected);
  });

  it.each(['dev', 'unknown'])('leaves a non-numeric version such as %s alone', (input) => {
    expect(formatVersionTag(input)).toBe(input);
  });

  it('never produces a doubled v', () => {
    expect(formatVersionTag('v0.2.0')).not.toMatch(/^vv/);
  });

  it('returns an empty string for an empty version rather than a bare v', () => {
    expect(formatVersionTag('')).toBe('');
    expect(formatVersionTag('   ')).toBe('');
  });
});
