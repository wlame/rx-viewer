import { describe, expectTypeOf, it } from 'vitest';
import type { components } from './types.generated';
import type {
  AnomalyRangeResult,
  CategoryInfo,
  CompressTaskResult,
  DetectorInfo,
  DetectorsResponse,
  HealthResponse,
  IndexResponse,
  IndexTaskResponse,
  IndexTaskResult,
  LineIndexEntry,
  LineLengthStats,
  LongestLine,
  SamplesResponse,
  SeverityLevel,
  SeverityRange,
  TaskConflictError,
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

  it('type the index answers with their named schemas', () => {
    expectTypeOf<IndexResponse>().toEqualTypeOf<Schemas['IndexResponse']>();
    expectTypeOf<IndexTaskResult>().toEqualTypeOf<Schemas['IndexTaskResult']>();
    expectTypeOf<CompressTaskResult>().toEqualTypeOf<Schemas['CompressTaskResult']>();
    expectTypeOf<LineIndexEntry>().toEqualTypeOf<Schemas['LineIndexEntry']>();
    expectTypeOf<LineLengthStats>().toEqualTypeOf<Schemas['LineLengthStats']>();
    expectTypeOf<LongestLine>().toEqualTypeOf<Schemas['LongestLine']>();
    expectTypeOf<AnomalyRangeResult>().toEqualTypeOf<Schemas['AnomalyRangeResult']>();
    expectTypeOf<TaskConflictError>().toEqualTypeOf<Schemas['TaskConflictError']>();
  });

  it('type a task result as the contract union, null until the task completes', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<Schemas['TaskStatusResponse']>();
    expectTypeOf<TaskStatus['result']>().toEqualTypeOf<
      IndexTaskResult | CompressTaskResult | null
    >();
  });

  // A seekable-zstd index adds the frame number to each checkpoint.
  it('allow a line-index entry of two or three numbers', () => {
    expectTypeOf<[number, number]>().toMatchTypeOf<LineIndexEntry>();
    expectTypeOf<[number, number, number]>().toMatchTypeOf<LineIndexEntry>();
  });

  // Both are null when the index was built without an analysis.
  it('keep the line statistics nullable, and every one but max', () => {
    expectTypeOf<IndexResponse['line_length']>().toEqualTypeOf<LineLengthStats>();
    expectTypeOf<null>().toMatchTypeOf<LineLengthStats>();
    expectTypeOf<null>().toMatchTypeOf<LongestLine>();
    expectTypeOf<NonNullable<LineLengthStats>['max']>().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<LineLengthStats>['p99']>().toEqualTypeOf<number | null>();
  });
});
