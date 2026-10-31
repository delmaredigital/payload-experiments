import type { MetricSource, Status } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { REVIEW_COPY as C, REVIEW_HINTS } from '../copy/review.js'

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
export function reviewView(preflight: PreflightResult, { status, primaryMetricKind }: {
  status: Status; primaryMetricKind?: MetricSource['kind']
}) {
  const { baseline, estimate } = preflight
  const formatted = baseline ? new Intl.NumberFormat('en-US', primaryMetricKind === 'binomial'
    ? { style: 'percent', maximumFractionDigits: 1 }
    : { minimumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 0, maximumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 1 }).format(baseline.value) : null
  return {
    checks: preflight.checks.map(check => {
      const detail = typeof check.detail === 'string' ? check.detail
        : check.detail && typeof check.detail === 'object' && 'message' in check.detail && typeof check.detail.message === 'string' ? check.detail.message : undefined
      return { ok: check.ok, hint: REVIEW_HINTS[check.code] ?? detail ?? C.checkFallback, detail }
    }),
    placements: preflight.placements.map(placement => ({ ...placement, previewAvailable: Boolean(placement.url) })),
    baseline: formatted === null ? C.noBaseline : `Over the last 28 days: ${formatted}`,
    traffic: preflight.trafficPerDay === null ? C.unknownTraffic : `About ${number(preflight.trafficPerDay)} people a day`,
    estimate: !estimate ? C.noEstimate : !estimate.feasible ? C.infeasible : `≈ ${number(estimate.weeks)} weeks`,
    estimateWarning: Boolean(estimate && (estimate.weeks > 8 || !estimate.feasible)),
    canStart: preflight.checks.every(check => check.ok) && (status === 'draft' || status === 'stopped'),
    applyValues: estimate ? { plannedDurationDays: estimate.plannedDurationDays, sequentialTuningParameter: estimate.sequentialTuningParameter } : null,
  }
}
