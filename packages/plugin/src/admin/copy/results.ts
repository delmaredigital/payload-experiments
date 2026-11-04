import type { MetricUnavailableReason } from '../../types/reasons.js'

export const RESULTS_COPY = {
  chooseGroup: 'Choose a group',
  tests: 'Tests', results: 'Results', test: 'Test', backToSetup: 'Back to setup',
  days: 'Days', methods: { sequential: 'Sequential', bayesian: 'Bayesian' },
  asOfDecision: (date: string) => `numbers from ${date}, used for the decision`,
  kinds: { binomial: 'yes/no', count: 'amount', revenue: 'amount' },
  qualityStates: { ok: 'OK', watch: 'Watch', problem: 'Problem' },
  qualityOK: 'No data quality problems found.', previews: 'Preview links',
  releasePages: 'Release pages',
  releasePagesBody: 'Every address shows its own page again. The result stays recorded.',
  you: 'you',
  group: 'Group', people: 'People', conversions: 'Conversions', average: 'Average', rate: 'Rate',
  lift: 'Lift', ci: 'Confidence interval', adjustedCI: 'Adjusted confidence interval',
  pValue: 'p-value', adjustedPValue: 'Adjusted p-value', chanceToWin: 'Chance to win', risk: 'Risk',
  comparison: 'Comparison', original: 'Original', holdout: 'Measured, not compared',
  holdoutBaseline: 'Holdout · baseline', shippedGroup: 'the winner',
  significance: { better: 'Better', worse: 'Worse', none: 'No clear difference' },
  guardrails: { failing: 'Failing', ok: 'OK', warning: 'Watch', insufficient: 'Too little data' },
  plannedEnd: 'Keep running to the planned end date.',
  infeasible: 'A clear answer would take more than 90 days at this traffic.',
  noCap: 'Not capped: fewer than 20 people had this outcome in the 90 days before Start, so every value counts in full.',
  quality: 'Data quality',
  missingWinner: 'The stored winner is missing from this round’s results.',
  missingWinnerNext: 'Recompute; if it persists, contact a developer before trusting these results.',
  srm: "Traffic isn't splitting as set. Check for caching or a page placed twice.",
  multiGroup: 'People who saw more than one group were excluded.',
  multiGroupNext: 'Check for caching or a page placed twice before trusting the results.',
  mismatch: "Beacons that didn't match the assigned group were ignored.",
  mismatchNext: 'Check that the page reports the group it actually showed.',
  identity: 'Some linked identities were seen in different groups.',
  identityNext: 'Check identity linking at sign-in and registration.',
  tooFew: 'Too few people have seen the compared groups.',
  tooFewNext: 'Keep collecting results until each compared group reaches the planned minimum.',
  layerFull: 'The layer has fewer slices reserved than the requested allocation.',
  layerNext: 'Free slices in the layer, then use "Let more people in".',
  unavailable: {
    'source-failed': "couldn't be read this time; the next results run will try again.",
    'source-unavailable': "can't be read because its data source is no longer available. Ask a developer to check this goal.",
    'unit-type-unavailable': "can't be read for the people counted in this test. Ask a developer to check this goal.",
    'non-finite-values': "has values that can't be used. Ask a developer to check this goal's data.",
    'non-finite-covariates': "has earlier values that can't be used. Ask a developer to check this goal's data.",
    budget: "couldn't finish in time; the next results run will try again.",
    'not-supplied': "has no data for this results run; the next results run will try again.",
    'analysis-failed': "couldn't be calculated this time; the next results run will try again.",
  } satisfies Record<MetricUnavailableReason, string>,
  unavailableNext: 'Recompute; if it persists, contact a developer.',
  loading: 'Loading results…',
  refreshing: 'Refreshing…', retryPreview: 'Retry preview links',
  forbidden: "You don't have access to results.",
  empty: 'No results yet — the first results appear within the hour after Start.',
  retry: 'Retry', round: 'Round', recompute: 'Recompute', recomputing: 'Recomputing…',
  primary: 'Primary outcome', secondary: 'Supporting (not used for the decision)', guardrail: 'Guardrails',
  chart: 'Confidence interval over time', noHistory: 'Not enough history yet.',
} as const

export const pagesReleasedCopy = (date: string, name?: string) => `Pages released ${date}${name ? ` by ${name}` : ''}`

export const roundLabel = (round: number, kind: string) => `Round ${round} · ${kind}`
export const decidedTitle = (winner: string) => `Decided: ${winner}`
export const shippingTitle = (winner: string) => `Since shipping ${winner}`
export const moreDays = (days: string) => `About ${days} more ${days === '1' ? 'day' : 'days'}.`
export const collectingCopy = (n: string, minimum: string, conversions: string, conversionMinimum: string) =>
  `${n} of ${minimum} people, ${conversions} of ${conversionMinimum} conversions`
export const uncappedTotal = (total: string) => `Total ${total} (not capped)`
export const cappedCount = (count: string, cap: string) => `${count} capped at ${cap}`
export const atLeast = (bound: string) => `at least ${bound}`
export const atMost = (bound: string) => `at most ${bound}`
export const intervalCopy = (low: string, high: string) => `${low} to ${high}`
export const srmP = (p: string) => `Traffic split check: p = ${p}.`
export const shareCopy = (label: string, expected: string, observed: string) => `${label}: expected ${expected}, observed ${observed}`
export const exclusionCopy = (count: string, share: string) => `${count} excluded (${share}).`
export const ignoredCopy = (count: string) => `${count} ignored.`
export const conflictCopy = (share: string) => `${share} with identity conflicts.`
export const metricUnavailable = (name: string, reason: string) => `${name} ${RESULTS_COPY.unavailable[Object.hasOwn(RESULTS_COPY.unavailable, reason) ? reason as MetricUnavailableReason : 'source-failed']}`
export const chartSummary = (metric: string, groups: string, from: string, to: string, changes: string[] = []) =>
  `${metric}: lift and confidence intervals for ${groups}, ${from} to ${to}.${changes.length ? ` Content changed on ${new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(changes)}.` : ''}`
export const contentChangeTitle = (date: string) => `Content changed ${date} by an editor`

export const daysOfPlan = (days: string, planned: string) => `${days} of ${planned}`
