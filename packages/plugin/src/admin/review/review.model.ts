import type { MetricSource, Status } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { REVIEW_COPY as C, REVIEW_DONE, REVIEW_HINTS } from '../copy/review.js'

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
export function reviewView(preflight: PreflightResult, { status, primaryMetricKind }: {
  status: Status; primaryMetricKind?: MetricSource['kind']
}) {
  const { baseline, estimate } = preflight
  const weeks = estimate ? Math.round(estimate.weeks * 10) / 10 : 0
  const formatted = baseline ? new Intl.NumberFormat('en-US', primaryMetricKind === 'binomial'
    ? { style: 'percent', maximumFractionDigits: 1 }
    : { minimumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 0, maximumFractionDigits: primaryMetricKind === 'revenue' ? 2 : 1 }).format(baseline.value) : null
  return {
    checks: preflight.checks.map(check => {
      const detail = typeof check.detail === 'string' ? check.detail
        : check.detail && typeof check.detail === 'object' && 'message' in check.detail && typeof check.detail.message === 'string' ? check.detail.message : undefined
      const hint = check.ok ? undefined : REVIEW_HINTS[check.code] ?? detail ?? C.checkFallback
      return { ok: check.ok, done: check.ok ? REVIEW_DONE[check.code] ?? C.checkDoneFallback : undefined,
        hint, detail: detail === hint ? undefined : detail }
    }),
    placements: preflight.placements.map(placement => ({ ...placement, previewAvailable: Boolean(placement.url) })),
    baseline: formatted === null ? C.noBaseline : `Over the last 28 days: ${formatted}`,
    traffic: preflight.trafficPerDay === null ? C.unknownTraffic : `About ${number(preflight.trafficPerDay)} people a day`,
    estimate: !estimate ? C.noEstimate : !estimate.feasible ? C.infeasible : `≈ ${number(weeks)} weeks`,
    estimateWarning: Boolean(estimate && (weeks > 8 || !estimate.feasible)),
    canStart: preflight.checks.every(check => check.ok) && (status === 'draft' || status === 'stopped'),
    applyValues: estimate ? { plannedDurationDays: estimate.plannedDurationDays, sequentialTuningParameter: estimate.sequentialTuningParameter } : null,
  }
}
