import type { Snapshot } from '../types/snapshot.js'

export interface VerdictInput {
  phaseKind: 'test' | 'rollout'
  status: 'running' | 'stopped' | 'decided'
  method: 'sequential' | 'bayesian'
  primary: {
    name: string
    unavailable?: string
    converters: number
    minSampleSize: number
    comparisons: Array<{
      arm: string
      label: string
      significant: 'better' | 'worse' | 'none'
      lift: number
      ci: [number | null, number | null]
      chanceToWin?: number
    }>
  }
  exposures: {
    perArm: Array<{ arm: string; label: string; kind: 'control' | 'variant' | 'holdout'; n: number }>
    minExposuresPerArm: number
    multiArmShare: number
  }
  srm: { flagged: boolean }
  guardrails: Array<{ name: string; status: 'failing' | 'ok' | 'warning' | 'insufficient'; worstArmLabel?: string }>
  power: { daysRemaining: number | null; feasible: boolean }
  plannedDurationPassed: boolean
  winnerLabel?: string
  originalLabel: string
  controlArm: string
}

function percent(value: number | null): string {
  if (value === null) return '…'
  const rounded = Math.round(value * 100)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

function guardrailLine(input: VerdictInput): string {
  const warning = input.guardrails.find(item => item.status === 'warning')
  if (warning) return `Watch ${warning.name}: trending worse.`
  if (input.guardrails.some(item => item.status === 'insufficient')) return 'Too little data to rule out harm'
  // A rollout can still report a failing guardrail; do not describe that as safe.
  const failing = input.guardrails.find(item => item.status === 'failing')
  if (failing) return `Watch ${failing.name}: trending worse.`
  return 'No harm detected so far'
}

/** Apply spec §8.5 in order to already-computed results; no inference is performed here. */
export function computeVerdict(input: VerdictInput): Snapshot['verdict'] {
  const rollout = input.phaseKind === 'rollout'
  const make = (
    row: Snapshot['verdict']['row'], code: Snapshot['verdict']['code'],
    finding: string, action: string | null, detail: string, recommendedArm: string | null,
    line?: string,
  ): Snapshot['verdict'] => ({
    row, code, finding, action, headline: finding + (action ? ` ${action}` : ''), detail, recommendedArm,
    ...(line === undefined ? {} : { guardrailLine: line }),
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
  const collecting = minimum < input.exposures.minExposuresPerArm || input.primary.converters < input.primary.minSampleSize
  if (rollout) {
    const winner = input.winnerLabel ?? input.originalLabel
    if (collecting) return make('R2', 'rollout-collecting',
      `Since shipping ${winner}: collecting data (${minimum} of ${input.exposures.minExposuresPerArm}).`, null,
      'More people and conversions are needed to describe the shipped result.', null)
    const comparison = input.primary.comparisons.find(item => item.arm !== input.controlArm)
    const lift = comparison?.lift ?? null
    const ci = comparison?.ci ?? [null, null]
    return make('R3', 'rollout-readout',
      `Since shipping ${winner}: ${percent(lift)} vs the holdout (CI ${percent(ci[0])} to ${percent(ci[1])}).`, null,
      'This describes the shipped version compared with people still seeing the Original.', null, guardrailLine(input))
  }

  const failing = input.guardrails.find(item => item.status === 'failing')
  if (failing) return make(3, 'guardrail-failing',
    `Stop: ${failing.worstArmLabel ?? 'A variant'} harms ${failing.name}.`, null,
    'An outcome that must stay safe has become worse.', input.controlArm)
  if (collecting) return make(4, 'collecting', input.status === 'stopped'
    ? 'Stopped before enough data was collected.'
    : `Collecting data: ${minimum} of ${input.exposures.minExposuresPerArm} people, ${input.primary.converters} of ${input.primary.minSampleSize} conversions.`,
  null, 'More people or conversions are needed before drawing a conclusion.', null)

  const variantKeys = new Set(compared.filter(item => item.kind === 'variant').map(item => item.arm))
  const variants = input.primary.comparisons.filter(item => variantKeys.has(item.arm))
  const better = variants.filter(item => item.significant === 'better').sort((a, b) => b.lift - a.lift)
  const worse = variants.filter(item => item.significant === 'worse')
  const best = better[0]
  const worst = worse[0]
  if (variants.length > 0 && worse.length === variants.length) return make(5, 'original-better',
    'The Original is better.', 'Decide for the Original.', 'Every tested alternative performed worse.', input.controlArm)
  if (worst && !best) return make(6, 'worse-none-better',
    `${worst.label} is worse; no variant is better.`, 'Decide for the Original or restart without it.',
    'At least one alternative performed worse and none improved the main outcome.', input.controlArm)
  if (best && !worst) {
    const finding = better.length >= 2
      ? `Both beat the Original; not tested against each other — ${best.label} has the larger lift.`
      : input.method === 'bayesian'
        ? `${best.label} is very likely better (${Math.round((best.chanceToWin ?? 0) * 100)}%).`
        : `${best.label} is statistically better: ${percent(best.lift)} (CI ${percent(best.ci[0])} to ${percent(best.ci[1])}).`
    return make(7, 'winner', finding, null, 'The main outcome improved compared with the Original.', best.arm, guardrailLine(input))
  }
  if (best && worst) return make(8, 'mixed', `Mixed: ${best.label} better, ${worst.label} worse.`,
    'Review before deciding.', 'The tested alternatives moved the main outcome in different directions.', best.arm)
  if (input.status === 'running' && !input.plannedDurationPassed) {
    if (!input.power.feasible || input.power.daysRemaining === null || input.power.daysRemaining > 90) {
      return make(9, 'keep-running', 'A clear answer would take more than 90 days at this traffic.',
        'Consider a bigger change or a different metric.', 'Current traffic is too low for a timely answer.', null)
    }
    return make(9, 'keep-running', 'No clear winner yet.', `Keep running about ${Math.ceil(input.power.daysRemaining)} days.`,
      'The current results do not yet distinguish the tested versions.', null)
  }
  return make(10, 'no-difference', 'No detectable difference at this size.', null,
    'The data collected did not show a clear improvement or decline.', input.controlArm)
}
