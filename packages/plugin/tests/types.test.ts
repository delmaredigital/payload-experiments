import { expectTypeOf, test } from 'vitest'
import type { ExperimentsPluginOptions, MetricSource, EventBody, ErrorEnvelope, PreviewTokenResult, Snapshot, DocId, AddMetricBody, Assignment, FlagPointResult, ClientAssignments, ExperimentRef, ManifestExperiment, FlagDefault, FlagPoint, PreflightResult, MakeContentResult, ResultsResponse, EditableField, ArmIssueCode, RefusalCode, ExperimentsProxyRuntime } from '../src/types/index.js'

test('frozen shared contracts', () => {
  expectTypeOf<ExperimentsPluginOptions['access']>().toHaveProperty('manage')
  expectTypeOf<ExperimentsPluginOptions['access']['manage']>().toBeFunction()
  expectTypeOf<undefined>().not.toExtend<ExperimentsPluginOptions['access']['manage']>()
  expectTypeOf<'historicalValues'>().not.toExtend<keyof MetricSource>()
  type Exposure = Extract<EventBody['events'][number], { type: 'exposure' }>
  expectTypeOf<Exposure['phase']>().toEqualTypeOf<number>()
  expectTypeOf<Exposure>().not.toExtend<Omit<Exposure, 'phase'> & { phase?: undefined }>()
  expectTypeOf<Omit<Exposure, 'phase'>>().not.toExtend<Exposure>()
  expectTypeOf<Omit<Exposure, 'policy'>>().not.toExtend<Exposure>()
  expectTypeOf<ErrorEnvelope>().toEqualTypeOf<{ errors: Array<{ code: import('../src/types/endpoints.js').RefusalCode; message: string; detail?: unknown }> }>()
  expectTypeOf<PreviewTokenResult>().toEqualTypeOf<{ token: string }>()
  expectTypeOf<Snapshot['verdict']['action']>().toEqualTypeOf<string | null>()
})

test('reviewed numeric and statistical shapes', () => {
  type Comparison = Snapshot['metrics'][number]['comparisons'][number]
  expectTypeOf<Comparison['ci']>().toEqualTypeOf<[number | null, number | null]>()
  expectTypeOf<Comparison['ciAdjusted']>().toEqualTypeOf<[number | null, number | null]>()
  expectTypeOf<NonNullable<ResultsResponse['series']>[number]['ci']>().toEqualTypeOf<[number | null, number | null]>()
  expectTypeOf<Snapshot['power']['daysRemaining']>().toEqualTypeOf<number | null>()
  expectTypeOf<Snapshot['power']['exposuresNeededPerArm']>().toEqualTypeOf<number | null>()
  expectTypeOf<Snapshot['params']['prior']>().toEqualTypeOf<import('@delmaredigital/experiments-stats').GaussianPrior>()
  expectTypeOf<NonNullable<Snapshot['metrics'][number]['perArm'][number]['covariate']>>().toEqualTypeOf<{ preSum: number; preSumSquares: number; postPreSumOfProducts: number }>()
  expectTypeOf<ExperimentsProxyRuntime['secrets']>().toEqualTypeOf<readonly string[]>()
  expectTypeOf<'weights'>().not.toExtend<EditableField>()
  expectTypeOf<ArmIssueCode>().toEqualTypeOf<'weights-total' | 'control-count' | 'control-first' | 'holdout-last' | 'holdout-count' | 'variant-count' | 'duplicate-key' | 'duplicate-slot' | 'slot-required'>()
  expectTypeOf<ArmIssueCode>().toExtend<RefusalCode>()
  expectTypeOf<'not-found'>().toExtend<RefusalCode>()
  type Conversion = Extract<EventBody['events'][number], { type: 'conversion' }>
  expectTypeOf<Conversion['value']>().toEqualTypeOf<number | undefined>()
})
test('document references accept serial and UUID ids', () => {
  expectTypeOf<DocId>().toEqualTypeOf<string | number>()
  expectTypeOf<AddMetricBody['metric']>().toEqualTypeOf<DocId>()
  expectTypeOf<Assignment['experimentId']>().toEqualTypeOf<DocId>()
  expectTypeOf<FlagPointResult['experimentId']>().toEqualTypeOf<DocId | undefined>()
  expectTypeOf<ClientAssignments['experiments'][string]['experimentId']>().toEqualTypeOf<DocId>()
  expectTypeOf<ExperimentRef['id']>().toEqualTypeOf<DocId>()
  expectTypeOf<ManifestExperiment['id']>().toEqualTypeOf<DocId>()
  expectTypeOf<FlagDefault['experiment']>().toEqualTypeOf<DocId>()
  expectTypeOf<Parameters<NonNullable<FlagPoint['placements']>>[0]['experimentId']>().toEqualTypeOf<DocId>()
  expectTypeOf<Parameters<NonNullable<FlagPoint['makeContent']>>[0]['experimentId']>().toEqualTypeOf<DocId>()
  expectTypeOf<PreflightResult['placements'][number]['id']>().toEqualTypeOf<DocId>()
  expectTypeOf<PreflightResult['baseline']>().toEqualTypeOf<{ metricId: DocId; value: number; days: 28 } | null>()
  expectTypeOf<MakeContentResult['docs'][number]['id']>().toEqualTypeOf<DocId>()
  expectTypeOf<Snapshot['experiment']>().toEqualTypeOf<DocId>()
  expectTypeOf<Snapshot['metrics'][number]['metricId']>().toEqualTypeOf<DocId>()
  expectTypeOf<Snapshot['contentChanges'][number]['doc']>().toEqualTypeOf<DocId>()
  expectTypeOf<Snapshot['contentChanges'][number]['by']>().toEqualTypeOf<DocId>()
})
