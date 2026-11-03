import { expect, test, vi } from 'vitest'
import { runResults } from '../../src/server/runResults.js'
import { RESULTS_TIMEOUT_MARGIN_MS } from '../../src/db/executor.js'
import type { ResultsCandidate } from '../../src/db/snapshots.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'

function setup(hang: 'query' | 'covariate' | 'connect' | 'all-connections') {
  const started = Date.now(), calls: string[] = [], releases: unknown[] = []
  const options = sampleOptions()
  options.metricSources![0]!.query = hang === 'query' ? () => new Promise(() => {}) : async () => []
  options.metricSources![0]!.covariate = () => new Promise(() => {})
  const candidate: ResultsCandidate = { unitType: 'user', status: 'running', latestComputedAt: null, testArms: [], layerSlug: null, layerSlices: null,
    phase: { experiment: 'budget', phase: 1, phaseKind: 'test', startedAt: new Date(started - 86_400_000).toISOString(), seed: 'budget|', allocation: 100,
      arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50 }, { key: 'variantA', label: 'Variant', kind: 'variant', weight: 50 }],
      metricDefinitions: [{ metricId: 'primary', source: 'binomial', keyedBy: 'user', name: 'Signup', kind: 'binomial', role: 'primary', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }],
      analysis: { method: 'sequential', cuped: hang === 'covariate' ? 'auto' : 'off', plannedDurationDays: 14, minExposuresPerArm: 200, sequentialTuningParameter: 5000 },
    },
  }
  const candidates = [candidate]
  const client = {
    query: async ({ text }: { text: string }) => {
      calls.push(text)
      const rows = text.includes('jsonb_build_object') ? candidates : text.startsWith('SELECT "unit_id"')
        ? [{ unitId: 'user', arm: 'control', ts: started - 1000 }] : text.includes('unitCount') ? [{ unitCount: 0 }] : []
      return { rows, rowCount: text.startsWith('DELETE') ? 1 : rows.length }
    }, release: (error?: unknown) => releases.push(error),
  }
  let lateResolve: ((value: typeof client) => void) | undefined
  let acquisitions = 0
  const pool = { connect: vi.fn(async () => {
    acquisitions++
    if (hang === 'all-connections' || hang === 'connect' && acquisitions === 2) return new Promise<typeof client>(resolve => { lateResolve = resolve })
    return client
  }) }
  const payload = fakePayload({ config: { custom: { xp: options } }, overrides: { db: { pool } } })
  return { payload, options, candidate, candidates, calls, releases, pool, resolveLate: () => lateResolve?.(client) }
}

test.each(['query', 'covariate', 'connect', 'all-connections'] as const)('real executor bounds hung %s, reports the failure, and still attempts the sweep', async hang => {
  const context = setup(hang), budgetMs = 200, start = Date.now()
  const result = await runResults(context.payload, { budgetMs, experimentId: 'budget' })
  expect(Date.now() - start).toBeLessThan(budgetMs + RESULTS_TIMEOUT_MARGIN_MS)
  expect(result).toMatchObject({ ran: 0, skipped: 1, failed: 0, budgetExhausted: true, sweepAttempted: true })
  if (hang === 'query' || hang === 'covariate') expect(result.unavailableMetrics).toEqual([
    { experimentId: 'budget', phase: 1, metricId: 'primary', reason: 'Results budget exhausted' },
  ])
  expect(context.pool.connect.mock.calls.length).toBeGreaterThanOrEqual(2)
  if (hang !== 'all-connections') {
    expect(context.calls.some(text => text.startsWith('DELETE'))).toBe(true)
    const deletes = context.calls.filter(text => text.startsWith('DELETE'))
    expect(deletes).toHaveLength(3)
    expect(result.swept).toBe(deletes.length)
  }
  const warnings = context.payload.logs.filter(log => log.level === 'warn')
  if (hang === 'all-connections') expect(warnings).toEqual([{ level: 'warn', args: ['Experiment retention sweep made no progress before its budget expired; eligible rows may remain.'] }])
  else expect(warnings).toEqual([])
  expect(context.calls.some(text => text.startsWith('INSERT'))).toBe(false)
  context.resolveLate()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  if (hang === 'connect' || hang === 'all-connections') expect(context.releases.some(error => error instanceof Error)).toBe(true)
})

test('sweep:false leaves all of the bounded run for analysis and never starts retention', async () => {
  const context = setup('query')
  const result = await runResults(context.payload, { budgetMs: 100, sweep: false })
  expect(result).toMatchObject({ skipped: 1, failed: 0, sweepAttempted: false })
  expect(context.calls.some(text => text.startsWith('DELETE'))).toBe(false)
})

test('a timeout in the second phase does not persist the completed first phase', async () => {
  const context = setup('query')
  context.candidates.push({ ...context.candidate, phase: { ...context.candidate.phase, phase: 2 } })
  let queries = 0
  context.options.metricSources![0]!.query = () => ++queries === 1 ? Promise.resolve([]) : new Promise(() => {})
  const result = await runResults(context.payload, { budgetMs: 200 })
  expect(result).toMatchObject({ ran: 0, skipped: 1, failed: 0, sweepAttempted: true,
    unavailableMetrics: [{ experimentId: 'budget', phase: 2, metricId: 'primary' }] })
  expect(context.calls.some(text => text.startsWith('INSERT'))).toBe(false)
})
