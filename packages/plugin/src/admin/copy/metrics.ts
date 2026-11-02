export const METRICS_COPY = {
  source: 'Measured by',
  revenueHint: 'Very large amounts are counted only up to the level that the top 1% of amounts reached in the 90 days before the test starts; totals are always shown in full.',
} as const

export const METRIC_KIND_LABELS = { binomial: 'yes/no', count: 'count', revenue: 'amount' } as const
