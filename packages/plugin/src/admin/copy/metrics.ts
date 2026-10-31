export const METRICS_COPY = {
  source: 'Outcome source',
  revenueHint: 'Unusually large values are capped at the 99th percentile of the 90 days before Start for the decision; totals are always shown in full.',
} as const

export const METRIC_KIND_LABELS = { binomial: 'yes/no', count: 'count', revenue: 'amount' } as const
