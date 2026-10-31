import {
  DEFAULT_GAUSSIAN_PRIOR, bonferroniAlpha, capValues, createThetaAdjustedStatistics,
  effectBayesianABTest, sequentialOneSidedTreatmentGreaterTTest,
  sequentialOneSidedTreatmentLesserTTest, sequentialTwoSidedTTest, statisticMean, statisticVariance,
} from '@delmaredigital/experiments-stats'
import type { GaussianPrior, TestStatistic } from '@delmaredigital/experiments-stats'
import type { Arm, DocId, MetricSource } from '../types/contracts.js'
import type { Snapshot } from '../types/snapshot.js'
import type { ExposedUnit, Timestamp } from './aggregate.js'
import { timestampMs } from './aggregate.js'
import { outcomeStatistic } from './cuped.js'
import { guardrailStatus } from './guardrails.js'
import { remainingPower } from './power.js'
import { assembleSnapshot, jsonInterval } from './snapshot.js'
import { exposureSrm } from './srm.js'
import { computeVerdict } from './verdict.js'
import type { VerdictInput } from './verdict.js'

export interface FrozenMetric {
  metricId: DocId
  name: string
  kind: MetricSource['kind']
  role: 'primary' | 'secondary' | 'guardrail'
  direction: 'increase' | 'decrease'
  attributionWindowHours: number
  minSampleSize: number
  guardrailThreshold?: number
  capping?: { type: 'percentile' | 'absolute'; value: number }
  resolvedCap?: number | null
  historyUnits?: number
}

/** The caller decodes the phase JSON into this shape. No live metric or experiment
 * settings are read by analysis. Rollout arms carry weights {100-h,h} and include
 * only the shipped arm and holdout; units have already passed rolloutAnalysisUnits.
 */
export interface AnalysisPhase {
  experiment: DocId
  phase: number
  phaseKind: 'test' | 'rollout'
  startedAt: Timestamp
  endedAt?: Timestamp | null
  arms: readonly Pick<Arm, 'key' | 'label' | 'kind' | 'weight'>[]
  metricDefinitions: readonly FrozenMetric[]
  analysis: {
    method: 'sequential' | 'bayesian'
    alpha?: number
    sequentialTuningParameter: number
    cuped: 'auto' | 'off'
    cupedLookbackDays?: number
    minExposuresPerArm: number
    plannedDurationDays: number
    attributionWindowHours?: number
    minSampleSizes?: Record<DocId, number>
    guardrailThresholds?: Record<DocId, number>
    prior?: GaussianPrior
    bayesian?: { ctw: number; risk: number }
  }
  contentChanges?: Snapshot['contentChanges']
}

export interface MetricUnitData {
  metricId: DocId
  /** CORE-14a perUnitValues output, zero-filled over exposed units only. */
  values: ReadonlyMap<string, number>
  /** Host pre-period outcomes; absent entries in a supplied map mean zero. */
  covariates?: ReadonlyMap<string, number>
  unavailable?: string
}

export type AnalysePhaseInput = {
  phase: AnalysisPhase
  status: 'running' | 'stopped' | 'decided'
  now: Timestamp
  /** CORE-14a firstExposures output; same-unit multi-arm units already excluded. */
  units: ReadonlyMap<string, ExposedUnit>
  metricData: readonly MetricUnitData[]
  excludedMultiArm?: number
  armMismatch?: number
  /** Diagnostic from identity credit, supplied by the caller with its denominator. */
  identityConflictShare?: number
} & ({ winnerArm?: never } | { winnerArm: string })

type MetricSnapshot = Snapshot['metrics'][number]
type Comparison = MetricSnapshot['comparisons'][number]
const severity = { ok: 0, insufficient: 1, warning: 2, failing: 3 } as const

/** Pure exposure-based analysis (§6, §7.6, §8.4). All inference, moments, capping,
 * CUPED, power and SRM are delegated to experiments-stats; now is always injected.
 */
export function analysePhase(input: AnalysePhaseInput): Snapshot {
  const { phase, units } = input
  const { analysis } = phase
  const alpha = analysis.alpha ?? 0.05
  const prior = analysis.prior ?? DEFAULT_GAUSSIAN_PRIOR
  const bayesian = analysis.bayesian ?? { ctw: 0.95, risk: 0.0125 }
  const rollout = phase.phaseKind === 'rollout'
  const baselineArm = phase.arms.find(arm => arm.kind === (rollout ? 'holdout' : 'control'))
  const winner = rollout ? phase.arms.find(arm => arm.key === input.winnerArm && arm.kind !== 'holdout') : undefined
  if (!baselineArm || (rollout && (!winner || phase.arms.length !== 2))) throw new RangeError('Phase comparison baseline or shipped arm is missing')
  const compared = phase.arms.filter(arm => rollout ? arm.key === winner!.key : arm.kind === 'variant')
  const k = compared.length
  const alphaAdjusted = analysis.method === 'sequential' ? bonferroniAlpha(alpha, k) : alpha
  const definitions = phase.metricDefinitions.map(metric => ({ ...metric,
    attributionWindowHours: analysis.attributionWindowHours ?? metric.attributionWindowHours,
    minSampleSize: analysis.minSampleSizes?.[metric.metricId] ?? metric.minSampleSize,
    guardrailThreshold: analysis.guardrailThresholds?.[metric.metricId] ?? metric.guardrailThreshold,
  }))
  const primaryDefinition = definitions.find(metric => metric.role === 'primary')
  if (!primaryDefinition || phase.metricDefinitions.filter(metric => metric.role === 'primary').length !== 1) {
    throw new RangeError('Phase must have exactly one primary metric')
  }
  if (new Set(phase.metricDefinitions.map(metric => String(metric.metricId))).size !== phase.metricDefinitions.length
    || new Set(input.metricData.map(metric => String(metric.metricId))).size !== input.metricData.length) {
    throw new RangeError('Duplicate metric id')
  }
  const from = timestampMs(phase.startedAt)
  const now = timestampMs(input.now)
  const to = Math.min(now, phase.endedAt == null ? now : timestampMs(phase.endedAt))
  if (to < from) throw new RangeError('Analysis window ends before the phase starts')
  const byArm = new Map(phase.arms.map(arm => [arm.key as string, [] as string[]]))
  for (const [id, unit] of units) {
    const ids = byArm.get(unit.arm)
    if (!ids) throw new RangeError('Exposed unit has an unknown arm')
    ids.push(id)
  }
  const perArm = Object.fromEntries([...byArm].map(([arm, ids]) => [arm, ids.length]))
  const excludedMultiArm = input.excludedMultiArm ?? 0
  const exposures: Snapshot['exposures'] = {
    total: units.size, perArm, excludedMultiArm,
    multiArmShare: units.size + excludedMultiArm === 0 ? 0 : excludedMultiArm / (units.size + excludedMultiArm),
    armMismatch: input.armMismatch ?? 0, identityConflictShare: input.identityConflictShare ?? 0, capped: {},
  }
  const params: Snapshot['params'] = {
    sequentialTuningParameter: analysis.sequentialTuningParameter, prior: { ...prior },
    cupedLookbackDays: analysis.cupedLookbackDays ?? 14, bayesian: { ...bayesian },
    caps: {}, attributionWindows: {}, guardrailThresholds: {}, minSampleSizes: {},
  }
  const guardrails: Snapshot['guardrails'] = []
  const verdictGuardrails: VerdictInput['guardrails'] = []
  let primaryStatistics: Map<string, TestStatistic> | undefined
  const metrics = definitions.map((definition): MetricSnapshot => {
    const { metricId, kind } = definition
    params.attributionWindows[metricId] = definition.attributionWindowHours
    params.minSampleSizes[metricId] = definition.minSampleSize
    if (definition.role === 'guardrail') params.guardrailThresholds[metricId] = definition.guardrailThreshold ?? 0.05
    if (kind === 'revenue' && definition.capping) params.caps[metricId] = {
      ...definition.capping, resolvedCap: definition.resolvedCap ?? null,
      ...(definition.historyUnits === undefined ? {} : { historyUnits: definition.historyUnits }),
    }
    exposures.capped[metricId] = 0
    const data = input.metricData.find(item => item.metricId === metricId)
    const metric: MetricSnapshot = { metricId, name: definition.name, kind, role: definition.role,
      cupedApplied: false, perArm: [], comparisons: [] }
    let worst: Snapshot['guardrails'][number]['status'] = 'ok'
    let worstArmLabel = compared[0]?.label ?? ''
    try {
      if (!data || data.unavailable !== undefined) throw new Error(data?.unavailable ?? 'Metric data was not supplied')
      const stats = new Map<string, TestStatistic>()
      const cap = kind === 'revenue' ? definition.resolvedCap ?? null : null
      const useCovariates = analysis.cuped === 'auto' && data.covariates !== undefined && data.covariates.size > 0
      for (const arm of phase.arms) {
        const ids = byArm.get(arm.key)!
        const values = ids.map(id => data.values.get(id) ?? 0)
        if (!values.every(Number.isFinite)) throw new RangeError('Metric values must be finite')
        const capped = capValues(values, cap)
        const rawPre = useCovariates ? ids.map(id => data.covariates!.get(id) ?? 0) : undefined
        if (rawPre && !rawPre.every(Number.isFinite)) throw new RangeError('Covariates must be finite')
        const pre = rawPre && capValues(rawPre, cap).values
        const built = outcomeStatistic(kind, capped.values, pre)
        stats.set(arm.key, built.statistic)
        exposures.capped[metricId] += capped.cappedCount
        // These are the observed post-period moments; pair-specific theta is
        // applied by the stats engine for inference, never to the displayed mean.
        const post = outcomeStatistic(kind, capped.values).statistic
        metric.perArm.push({ arm: arm.key, ...built.moments,
          converters: values.filter(value => value > 0).length,
          mean: statisticMean(post), variance: statisticVariance(post),
          ...(built.covariate ? { covariate: built.covariate } : {}),
          ...(cap === null ? {} : { capped: { resolvedCap: cap,
            uncappedTotal: capped.uncappedTotal, cappedCount: capped.cappedCount } }),
        })
      }
      if (definition.role === 'primary') primaryStatistics = stats
      for (const arm of compared) {
        const [a, b] = createThetaAdjustedStatistics(stats.get(baselineArm.key)!, stats.get(arm.key)!)
        metric.cupedApplied ||= a.type === 'regressionAdjusted' && b.type === 'regressionAdjusted'
        const config = { alpha, sequentialTuningParameter: analysis.sequentialTuningParameter }
        const inverse = definition.direction === 'decrease'
        let comparison: Comparison
        let status: Snapshot['guardrails'][number]['status'] = 'insufficient'
        if (analysis.method === 'sequential') {
          const raw = sequentialTwoSidedTTest(a, b, config)
          const adjusted = definition.role === 'primary' ? sequentialTwoSidedTTest(a, b, { ...config, alpha: alphaAdjusted }) : raw
          const ci = adjusted.errorMessage ? [null, null] as [null, null] : jsonInterval(adjusted.ci)
          const positive = ci[0] !== null && ci[0] > 0
          const negative = ci[1] !== null && ci[1] < 0
          comparison = { arm: arm.key, lift: raw.expected,
            ci: raw.errorMessage ? [null, null] : jsonInterval(raw.ci), ciAdjusted: ci,
            ...(raw.pValue === null ? {} : { pValue: raw.pValue }),
            ...(adjusted.pValue === null ? {} : { pValueAdjusted: Math.min(1, adjusted.pValue * (definition.role === 'primary' ? k : 1)) }),
            significant: positive ? (inverse ? 'worse' : 'better') : negative ? (inverse ? 'better' : 'worse') : 'none',
          }
          if (definition.role === 'guardrail') {
            const greater = sequentialOneSidedTreatmentGreaterTTest(a, b, config)
            const lesser = sequentialOneSidedTreatmentLesserTTest(a, b, config)
            status = guardrailStatus({ method: 'sequential', direction: definition.direction,
              n: Math.min(...metric.perArm.filter(group => group.arm === arm.key || group.arm === baselineArm.key).map(group => group.converters)),
              minSampleSize: definition.minSampleSize, threshold: definition.guardrailThreshold ?? 0.05,
              pointEstimate: raw.expected,
              lowerBound: greater.errorMessage ? null : jsonInterval(greater.ci)[0],
              upperBound: lesser.errorMessage ? null : jsonInterval(lesser.ci)[1],
            })
          }
        } else {
          const result = effectBayesianABTest(a, b, { alpha, priorEffect: prior, inverse })
          comparison = { arm: arm.key, lift: result.expected,
            ci: result.errorMessage ? [null, null] : jsonInterval(result.ci),
            ciAdjusted: result.errorMessage ? [null, null] : jsonInterval(result.ci),
            chanceToWin: result.chanceToWin, risk: result.risk[1],
            significant: result.errorMessage ? 'none' : result.chanceToWin >= bayesian.ctw ? 'better'
              : result.chanceToWin <= 1 - bayesian.ctw ? 'worse' : 'none',
          }
          if (definition.role === 'guardrail') {
            const safety = effectBayesianABTest(a, b, { alpha: 0.10, priorEffect: prior, inverse })
            status = guardrailStatus({ method: 'bayesian', direction: definition.direction,
              n: Math.min(...metric.perArm.filter(group => group.arm === arm.key || group.arm === baselineArm.key).map(group => group.converters)),
              minSampleSize: definition.minSampleSize, threshold: definition.guardrailThreshold ?? 0.05,
              pointEstimate: result.expected, lowerBound: safety.errorMessage ? null : jsonInterval(safety.ci)[0],
              upperBound: safety.errorMessage ? null : jsonInterval(safety.ci)[1],
              pWorse: safety.errorMessage ? undefined : 1 - safety.chanceToWin,
            })
          }
        }
        metric.comparisons.push(comparison)
        if (severity[status] > severity[worst]) { worst = status; worstArmLabel = arm.label }
      }
    } catch (error) {
      metric.unavailable = error instanceof Error ? error.message : 'Metric could not be analysed'
      metric.perArm = []; metric.comparisons = []; metric.cupedApplied = false
      exposures.capped[metricId] = 0
      if (definition.role === 'primary') primaryStatistics = undefined
      worst = 'insufficient'
    }
    if (definition.role === 'guardrail') {
      guardrails.push({ metricId, status: worst })
      verdictGuardrails.push(worst === 'failing' ? { name: definition.name, status: worst, worstArmLabel }
        : { name: definition.name, status: worst })
    }
    return metric
  })
  const primary = metrics.find(metric => metric.role === 'primary')!
  const srm = exposureSrm(phase.arms, perArm)
  let power: Snapshot['power'] = { daysRemaining: null, exposuresNeededPerArm: null,
    lowerBound: analysis.method === 'sequential', feasible: true }
  const common = {
    status: input.status, method: analysis.method,
    primary: { name: primary.name, direction: primaryDefinition.direction, ...(primary.unavailable === undefined ? {} : { unavailable: primary.unavailable }),
      minSampleSize: primaryDefinition.minSampleSize,
      convertersPerArm: primary.perArm.map(group => ({ arm: group.arm, kind: phase.arms.find(arm => arm.key === group.arm)!.kind, converters: group.converters })),
      comparisons: primary.comparisons.map(comparison => ({ ...comparison, ci: comparison.ciAdjusted, label: phase.arms.find(arm => arm.key === comparison.arm)!.label })),
    },
    exposures: { perArm: phase.arms.map(arm => ({ arm: arm.key, label: arm.label, kind: arm.kind, n: perArm[arm.key]! })),
      minExposuresPerArm: analysis.minExposuresPerArm, multiArmShare: exposures.multiArmShare },
    srm, guardrails: verdictGuardrails, power,
    plannedDurationPassed: to - from >= analysis.plannedDurationDays * 86_400_000,
    originalLabel: phase.arms.find(arm => arm.kind === 'control')?.label ?? 'Original', controlArm: baselineArm.key,
  }
  const verdictInput: VerdictInput = rollout ? { ...common, phaseKind: 'rollout', winnerArm: winner!.key, winnerLabel: winner!.label }
    : { ...common, phaseKind: 'test' }
  let verdict = computeVerdict(verdictInput)
  if (input.status === 'running' && !rollout && (verdict.row === 4 || verdict.row === 9) && primaryStatistics) {
    power = remainingPower({ baseline: primaryStatistics.get(baselineArm.key)!,
      variants: compared.map(arm => primaryStatistics!.get(arm.key)!), elapsedDays: (to - from) / 86_400_000,
      alpha: alphaAdjusted, method: analysis.method, prior, sequentialTuningParameter: analysis.sequentialTuningParameter })
    verdict = computeVerdict({ ...verdictInput, power })
  }
  return assembleSnapshot({ experiment: phase.experiment, phase: phase.phase, phaseKind: phase.phaseKind,
    computedAt: new Date(now).toISOString(), window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    method: analysis.method, alpha, alphaAdjusted, k, winnerArm: winner?.key ?? null,
    minExposuresPerArm: analysis.minExposuresPerArm, params, exposures, srm, metrics, guardrails, power, verdict,
    contentChanges: (phase.contentChanges ?? []).map(change => ({ ...change, doc: { ...change.doc } })),
  })
}
