import { readdirSync, readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import type { PhaseSummary } from '../../../src/types/endpoints.js'
import type { Snapshot, VerdictCode } from '../../../src/types/snapshot.js'
import type { LegacySnapshot } from '../../../src/admin/results/snapshot.js'

type Check = (value: unknown, path: string) => void
function fail(path: string): never { throw new Error(`Incomplete snapshot: ${path}`) }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const string: Check = (value, path) => { if (typeof value !== 'string') fail(path) }
const boolean: Check = (value, path) => { if (typeof value !== 'boolean') fail(path) }
const id: Check = (value, path) => { if (typeof value !== 'string' && typeof value !== 'number') fail(path) }
const nullable = (check: Check): Check => (value, path) => { if (value !== null) check(value, path) }
const optional = (check: Check): Check => (value, path) => { if (value !== undefined) check(value, path) }
const oneOf = (values: readonly unknown[]): Check => (value, path) => { if (!values.includes(value)) fail(path) }
const shape = (fields: Record<string, Check>): Check => (value, path) => {
  if (!object(value)) fail(path)
  for (const [key, check] of Object.entries(fields)) check(value[key], `${path}.${key}`)
}
const array = (check: Check): Check => (value, path) => {
  if (!Array.isArray(value)) fail(path)
  value.forEach((entry, index) => check(entry, `${path}[${index}]`))
}
const record = (check: Check): Check => (value, path) => {
  if (!object(value)) fail(path)
  for (const [key, entry] of Object.entries(value)) check(entry, `${path}.${key}`)
}
const ci: Check = (value, path) => {
  if (!Array.isArray(value) || value.length !== 2) fail(path)
  value.forEach((bound, index) => nullable(number)(bound, `${path}[${index}]`))
}
const codes = {
  unavailable: true, 'data-problem': true, 'guardrail-failing': true, collecting: true,
  'original-better': true, 'worse-none-better': true, winner: true, mixed: true,
  'keep-running': true, 'no-difference': true, 'rollout-collecting': true, 'rollout-readout': true,
} satisfies Record<VerdictCode, true>

const snapshotShape = shape({
  experiment: id, phase: number, phaseKind: oneOf(['test', 'rollout']), computedAt: string,
  window: shape({ from: string, to: string }), method: oneOf(['sequential', 'bayesian']), alpha: number, alphaAdjusted: number, k: number,
  params: shape({
    sequentialTuningParameter: number, prior: shape({ mean: number, variance: number, proper: boolean }), cupedLookbackDays: number,
    caps: record(shape({ type: oneOf(['percentile', 'absolute']), value: number, resolvedCap: nullable(number), historyUnits: optional(number) })),
    attributionWindows: record(number), guardrailThresholds: record(number), minSampleSizes: record(number), bayesian: shape({ ctw: number, risk: number }),
  }),
  exposures: shape({ total: number, perArm: record(number), excludedMultiArm: number, multiArmShare: number, armMismatch: number, identityConflictShare: number, capped: record(number) }),
  srm: shape({ p: number, flagged: boolean, expected: record(number) }),
  metrics: array(shape({
    metricId: id, name: string, kind: oneOf(['binomial', 'count', 'revenue']), role: oneOf(['primary', 'secondary', 'guardrail']), cupedApplied: boolean, unavailable: optional(string),
    perArm: array(shape({
      arm: string, n: number, converters: number, sum: number, sumSquares: number, mean: number, variance: number,
      covariate: optional(shape({ preSum: number, preSumSquares: number, postPreSumOfProducts: number })),
      capped: optional(shape({ resolvedCap: number, uncappedTotal: number, cappedCount: number })),
    })),
    comparisons: array(shape({ arm: string, lift: number, ci, ciAdjusted: ci, pValue: optional(number), pValueAdjusted: optional(number), chanceToWin: optional(number), risk: optional(number), significant: oneOf(['better', 'worse', 'none']) })),
  })),
  guardrails: array(shape({ metricId: id, status: oneOf(['failing', 'ok', 'warning', 'insufficient']) })),
  power: shape({ daysRemaining: nullable(number), exposuresNeededPerArm: nullable(number), lowerBound: boolean, feasible: boolean }),
  verdict: shape({ row: oneOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'R1', 'R2', 'R3']), code: oneOf(Object.keys(codes)), finding: string, action: nullable(string), headline: string, detail: string, recommendedArm: nullable(string), guardrailLine: optional(string) }),
  contentChanges: array(shape({ at: string, doc: id, by: id })),
})

export function checkSnapshot(value: unknown): void { snapshotShape(value, 'snapshot') }
function loadSnapshot(value: unknown): Snapshot {
  checkSnapshot(value)
  // JSON literal types widen. This is the single cast shared by all fixture loads.
  return value as Snapshot
}
const directory = new NodeURL('../../_fixtures/snapshots/', import.meta.url)
export const fixtures: Record<string, Snapshot> = Object.fromEntries(
  readdirSync(directory).filter(file => file.endsWith('.json')).sort().map(file => [
    file.slice(0, -5), loadSnapshot(JSON.parse(readFileSync(new NodeURL(file, directory), 'utf8'))),
  ]),
)

export function fixture(name: string): Snapshot {
  const snapshot = fixtures[name]
  if (!snapshot) throw new Error(`Missing fixture ${name}`)
  return structuredClone(snapshot)
}

/** History predating both CORE-15a additions, deliberately outside the writer's current shape. */
export function legacyFixture(name: string): LegacySnapshot {
  const { winnerArm: _winner, minExposuresPerArm: _minimum, ...snapshot } = fixture(name)
  return snapshot
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...fixture('T7'), ...overrides } satisfies Snapshot
}

export function revenueSnapshot(): Snapshot {
  const snapshot = makeSnapshot()
  const metric = snapshot.metrics[0]!
  snapshot.metrics = [{
    ...metric, metricId: 'gifts', name: 'Gifts', kind: 'revenue', perArm: metric.perArm.map(arm => ({
      ...arm, mean: 12.5, capped: { resolvedCap: 100, uncappedTotal: 12345, cappedCount: 0 },
    })),
  }]
  snapshot.params.caps = { gifts: { type: 'percentile', value: 0.99, resolvedCap: 100, historyUnits: 50 } }
  return snapshot
}

export function phaseFor(snapshot: Pick<Snapshot, 'phase' | 'phaseKind' | 'window' | 'srm' | 'metrics'>): PhaseSummary {
  const labels: Record<string, string> = { control: 'Original form', variantA: 'Shorter form', variantB: 'One page form', variantC: 'Friendly form', holdout: 'Unchanged form' }
  return {
    phase: snapshot.phase, phaseKind: snapshot.phaseKind, startedAt: snapshot.window.from, endedAt: null,
    arms: Object.keys(snapshot.srm.expected).map(key => ({ key, label: labels[key] ?? key, kind: key === 'holdout' ? 'holdout' : key === 'control' ? 'control' : 'variant' })),
    metrics: snapshot.metrics.map(({ metricId, name, kind, role }) => ({ metricId, name, kind, role })),
  }
}
