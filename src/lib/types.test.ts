import { describe, expectTypeOf, it } from 'vitest';
import type { components } from './types.generated';
import type {
  CategoryInfo,
  DetectorInfo,
  DetectorsResponse,
  HealthResponse,
  IndexTaskResponse,
  SamplesResponse,
  SeverityLevel,
  SeverityRange,
  TaskStatus,
  TreeEntry,
  TreeResponse,
} from './types';

/**
 * The wire types must be the generated contract types, or a field the
 * contract allows to be null can reach the app typed as never null.
 * These assertions are checked by `just typecheck`, which reads test
 * files too; at run time they do nothing.
 */
type Schemas = components['schemas'];

describe('wire types', () => {
  it('are the generated contract schemas', () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<Schemas['HealthResponse']>();
    expectTypeOf<TreeEntry>().toEqualTypeOf<Schemas['TreeEntry']>();
    expectTypeOf<TreeResponse>().toEqualTypeOf<Schemas['TreeResponse']>();
    expectTypeOf<SamplesResponse>().toEqualTypeOf<Schemas['SamplesResponse']>();
    expectTypeOf<IndexTaskResponse>().toEqualTypeOf<Schemas['TaskResponse']>();
    expectTypeOf<DetectorsResponse>().toEqualTypeOf<Schemas['DetectorsResponse']>();
    expectTypeOf<DetectorInfo>().toEqualTypeOf<Schemas['DetectorInfo']>();
    expectTypeOf<CategoryInfo>().toEqualTypeOf<Schemas['CategoryInfo']>();
    expectTypeOf<SeverityRange>().toEqualTypeOf<Schemas['SeverityRange']>();
    expectTypeOf<SeverityLevel>().toEqualTypeOf<Schemas['SeverityScaleLevel']>();
  });

  it('keep the task status generated apart from its untyped result', () => {
    // The contract types a task's result as an open object; the viewer
    // reads it as index data until the contract describes that shape.
    expectTypeOf<Omit<TaskStatus, 'result'>>().toEqualTypeOf<
      Omit<Schemas['TaskStatusResponse'], 'result'>
    >();
  });
});
