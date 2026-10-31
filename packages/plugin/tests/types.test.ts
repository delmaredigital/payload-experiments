import { expectTypeOf, test } from 'vitest'
import type { ExperimentsPluginOptions, MetricSource, EventBody, ErrorEnvelope, PreviewTokenResult, Snapshot } from '../src/types/index.js'

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
