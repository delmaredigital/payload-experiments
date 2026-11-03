import type { Snapshot } from '../types/snapshot.js'
import type { ArmKey } from '../types/contracts.js'
import { ARM_LABELS } from '../labels/arms.js'

/** Already-computed results. Rollouts require the shipped winner's key and label;
 * R3 reads that winner's comparison, regardless of comparison order. */
export type VerdictInput = VerdictInputFields & (
  | { phaseKind: 'test'; winnerArm?: string; winnerLabel?: string }
  | { phaseKind: 'rollout'; winnerArm: string; winnerLabel: string }
)

interface VerdictInputFields {
  status: 'running' | 'stopped' | 'decided'
  method: 'sequential' | 'bayesian'
  primary: {
    name: string
    direction: 'increase' | 'decrease'
    unavailable?: string
    /** Minimums apply per compared group, excluding the holdout in a test and
     * including it in a rollout. Copy uses the smallest converter count. */
    convertersPerArm: Array<{ arm: string; kind: 'control' | 'variant' | 'holdout'; converters: number }>
    minSampleSize: number
    /** Include every computed comparison. Multiple winners use "Both" for two
     * and "All N variants" for three or more; mixed/worse copy names each result. */
    comparisons: Array<{
      arm: string
      label: string
      significant: 'better' | 'worse' | 'none'
      lift: number
      /** Snapshot ciAdjusted: alpha/k in a test; raw interval in a rollout (k=1). */
      ci: [number | null, number | null]
      /** Probability in [0, 1]; copy floors whole percentages, uses "more than
       * 99%" at >=99.5%, and omits the parenthesis when unavailable. */
      chanceToWin?: number
    }>
  }
  exposures: {
    perArm: Array<{ arm: string; label: string; kind: 'control' | 'variant' | 'holdout'; n: number }>
    minExposuresPerArm: number
    multiArmShare: number
  }
  srm: { flagged: boolean }
  /** One status per guardrail across variants, holdout excluded: worst wins
   * (failing > warning > insufficient > ok). A failing result names the variant
   * that triggered it. R3 uses this order, with explicit harm wording for failing;
   * no configured guardrails means no guardrailLine, never a claim of safety. */
  guardrails: Array<{ name: string } & (
    | { status: 'failing'; worstArmLabel: string; worstArm: string }
    | { status: 'ok' | 'warning' | 'insufficient'; worstArmLabel?: string }
  )>
  /** Additional days needed, rounded up by CORE-15a: 0 = already enough data,
   * null = unknown. Infeasible or >90 days uses the long-duration copy; positive
   * days use an estimate; 0/null with feasible=true runs to the planned end date. */
  power: { daysRemaining: number | null; feasible: boolean }
  plannedDurationPassed: boolean
  /** Reserved for future use; "the Original" remains literal UI vocabulary. */
  originalLabel: string
  controlArm: string
}

function percent(value: number | null): string {
  if (value === null) return '…'
  const rounded = Math.round(value * 100)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

function guardrailLine(input: VerdictInput): string | undefined {
  if (input.guardrails.length === 0) return undefined
  const failing = input.guardrails.find(item => item.status === 'failing')
  if (failing) return `Harm detected: ${failing.name} is worse since shipping.`
  const warning = input.guardrails.find(item => item.status === 'warning')
  if (warning) return `Watch ${warning.name}: trending worse.`
  if (input.guardrails.some(item => item.status === 'insufficient')) return 'Too little data to rule out harm'
  return 'No harm detected so far'
}

function labels(items: Array<{ label: string }>): string {
  return items.length < 2 ? items[0]!.label
    : `${items.slice(0, -1).map(item => item.label).join(', ')} and ${items.at(-1)!.label}`
}

function chance(value: number | undefined): string {
  if (value === undefined) return ''
  return value >= 0.995 ? ' (more than 99%)' : ` (${Math.floor(value * 100)}%)`
}

/** Resolve a stored group label without exposing an internal key in verdict copy. */
export function verdictGroupLabel(key: string, label = ''): string {
  return label.trim() || (Object.hasOwn(ARM_LABELS, key) ? ARM_LABELS[key as ArmKey] : 'This group')
}

/** Apply spec §8.5 in order to already-computed results; no inference is performed here. */
export function computeVerdict(input: VerdictInput): Snapshot['verdict'] {
  const rollout = input.phaseKind === 'rollout'
  const make = (
    row: Snapshot['verdict']['row'], code: Snapshot['verdict']['code'],
    finding: string, action: string | null, detail: string, recommendedArm: string | null,
    line?: string, worstArm?: string,
  ): Snapshot['verdict'] => ({
    row, code, finding, action, headline: finding + (action ? ` ${action}` : ''), detail, recommendedArm,
    ...(line === undefined ? {} : { guardrailLine: line }),
    ...(worstArm === undefined ? {} : { worstArm }),
  })
  if (input.primary.unavailable !== undefined) {
    return make(rollout ? 'R1' : 1, 'unavailable',
      `Results unavailable: ${input.primary.name} could not be read.`,
      'Recompute; if it persists, contact a developer.', 'The main outcome could not be loaded.', null)
  }
  if (input.srm.flagged || input.exposures.multiArmShare >= 0.01) {
    return make(rollout ? 'R1' : 2, 'data-problem', "Data problem: traffic isn't splitting as set.",
      "Don't trust these results. Check for caching or a page placed twice; contact a developer.",
      'The people counted do not match the expected split.', null)
  }

  const compared = input.exposures.perArm.filter(item => rollout || item.kind !== 'holdout')
  const minimum = compared.length ? Math.min(...compared.map(item => item.n)) : 0
  const converters = input.primary.convertersPerArm.filter(item => rollout || item.kind !== 'holdout')
  const minimumConverters = converters.length ? Math.min(...converters.map(item => item.converters)) : 0
  const collecting = minimum < input.exposures.minExposuresPerArm || minimumConverters < input.primary.minSampleSize
  if (input.phaseKind === 'rollout') {
    const winner = input.winnerLabel
    if (collecting) return make('R2', 'rollout-collecting',
      `Since shipping ${winner}: collecting data (${minimum} of ${input.exposures.minExposuresPerArm} people, ${minimumConverters} of ${input.primary.minSampleSize} conversions).`, null,
      'More people and conversions are needed to describe the shipped result.', null)
    const comparison = input.primary.comparisons.find(item => item.arm === input.winnerArm)
    const lift = comparison?.lift ?? null
    const ci = comparison?.ci ?? [null, null]
    return make('R3', 'rollout-readout',
      `Since shipping ${winner}: ${percent(lift)} vs the holdout (CI ${percent(ci[0])} to ${percent(ci[1])}).`, null,
      'This describes the shipped version compared with people still seeing the Original.', null, guardrailLine(input))
  }

  const failing = input.guardrails.find(item => item.status === 'failing')
  if (failing) return make(3, 'guardrail-failing',
    `Stop: ${failing.worstArmLabel} harms ${failing.name}.`, null,
    'An outcome that must stay safe has become worse.', input.controlArm, undefined, failing.worstArm)
  if (collecting) {
    const smallest = compared.find(item => item.n === minimum)
    const fewest = converters.find(item => item.converters === minimumConverters)
    const groupLabel = (group: { arm: string; kind: string } | undefined): string => {
      if (!group || group.kind === 'control') return 'Original'
      const label = input.exposures.perArm.find(item => item.arm === group.arm)?.label
        ?? input.primary.comparisons.find(item => item.arm === group.arm)?.label
      return verdictGroupLabel(group.arm, label)
    }
    const detail = [
      minimum < input.exposures.minExposuresPerArm
        ? `Smallest group so far: ${groupLabel(smallest)}, ${minimum} of the ${input.exposures.minExposuresPerArm} people it needs.` : '',
      minimumConverters < input.primary.minSampleSize
        ? `Fewest conversions so far: ${groupLabel(fewest)}, ${minimumConverters} of the ${input.primary.minSampleSize} needed.` : '',
    ].filter(Boolean).join(' ') || 'More people or conversions are needed before drawing a conclusion.'
    return make(4, 'collecting', input.status === 'stopped'
      ? 'Stopped before enough data was collected.'
      : 'Collecting data.', null, input.status === 'stopped'
      ? 'More people or conversions are needed before drawing a conclusion.'
      : detail, null)
  }

  const variantKeys = new Set(compared.filter(item => item.kind === 'variant').map(item => item.arm))
  const variants = input.primary.comparisons.filter(item => variantKeys.has(item.arm))
  const better = variants.filter(item => item.significant === 'better')
  const worse = variants.filter(item => item.significant === 'worse')
  const direction = input.primary.direction === 'decrease' ? -1 : 1
  const best = [...better].sort((a, b) => direction * (b.lift - a.lift))[0]
  const worst = worse[0]
  if (variants.length > 0 && worse.length === variants.length) return make(5, 'original-better',
    'The Original is better.', 'Decide for the Original.', 'Every tested alternative performed worse.', input.controlArm)
  if (worst && !best) return make(6, 'worse-none-better',
    `${labels(worse)} ${worse.length === 1 ? 'is' : 'are'} worse; no variant is better.`,
    `Decide for the Original or restart without ${worse.length === 1 ? 'it' : 'them'}.`,
    'At least one alternative performed worse and none improved the main outcome.', input.controlArm, undefined, worst.arm)
  if (best && !worst) {
    const finding = better.length >= 2
      ? `${better.length === 2 ? 'Both' : `All ${better.length} variants`} beat the Original; not tested against each other — ${best.label} has the larger improvement.`
      : input.method === 'bayesian'
        ? `${best.label} is very likely better${chance(best.chanceToWin)}.`
        : `${best.label} is statistically better: ${percent(best.lift)} (CI ${percent(best.ci[0])} to ${percent(best.ci[1])}).`
    return make(7, 'winner', finding, null, 'The main outcome improved compared with the Original.', best.arm, guardrailLine(input))
  }
  if (best && worst) return make(8, 'mixed', `Mixed: ${labels(better)} better, ${labels(worse)} worse.`,
    'Review before deciding.', 'The tested alternatives moved the main outcome in different directions.', best.arm, undefined, worst.arm)
  if (input.status === 'running' && !input.plannedDurationPassed) {
    if (input.power.feasible === false || (input.power.daysRemaining !== null && input.power.daysRemaining > 90)) {
      return make(9, 'keep-running', 'A clear answer would take more than 90 days at this traffic.',
        'Consider a bigger change or a different metric.', 'Current traffic is too low for a timely answer.', null)
    }
    const action = input.power.daysRemaining !== null && input.power.daysRemaining >= 1
      ? `Keep running about ${Math.ceil(input.power.daysRemaining)} days.`
      : 'Keep running to the planned end date.'
    return make(9, 'keep-running', 'No clear winner yet.', action,
      'The current results do not yet distinguish the tested versions.', null)
  }
  return make(10, 'no-difference', 'No detectable difference at this size.', null,
    'The data collected did not show a clear improvement or decline.', input.controlArm)
}
