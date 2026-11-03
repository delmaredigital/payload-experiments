const formatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

/** Shared calendar date for admin copy, chart axes and tooltips. */
export function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
  return date && Number.isFinite(date.valueOf()) ? formatter.format(date) : '—'
}
