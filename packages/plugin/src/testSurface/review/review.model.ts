import type { MetricSource } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { REVIEW_COPY as C } from '../copy/review.js'

/** Baseline shown below the selected goal, using the source's number format. */
export function reviewView({ baseline }: PreflightResult, { primaryMetricKind }: {
  primaryMetricKind?: MetricSource['kind']
}) {
  const formatted = baseline ? new Intl.NumberFormat('en-US', primaryMetricKind === 'binomial'
    ? { style: 'percent', maximumFractionDigits: 1 }
    : { minimumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 0, maximumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 1 }).format(baseline.value) : null
  return { baseline: formatted === null ? C.noBaseline : `Over the last 28 days: ${formatted}` }
}
