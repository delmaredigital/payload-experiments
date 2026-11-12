import type { MetricSource } from '../../types/contracts.js'
import { atLeast, atMost, intervalCopy } from '../copy/results.js'

const locale = 'en-US'
const missing = '—'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const minus = (value: string) => value.replace(/-/g, '−')

export function formatCount(value: number | null | undefined): string {
  return finite(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value) : missing
}

export function formatNumber(value: number | null | undefined): string {
  return finite(value) ? minus(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)) : missing
}

/** Increase precision near zero so a finite, nonzero bound never loses its sign. */
export function formatPercent(value: number | null | undefined, signed = false): string {
  if (!finite(value)) return missing
  const magnitude = Math.abs(value) * 100
  const digits = magnitude > 0 ? Math.max(1, 1 - Math.floor(Math.log10(magnitude))) : 1
  const options: Intl.NumberFormatOptions = digits > 20
    ? { style: 'percent', notation: 'scientific', maximumSignificantDigits: 3 }
    : { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: digits }
  return minus(new Intl.NumberFormat(locale, { ...options, signDisplay: signed ? 'exceptZero' : 'auto' }).format(value))
}

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  return finite(value) ? minus(new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)) : missing
}

/** Revenue alone is money; counts and conversion metrics never receive a currency symbol. */
export function formatMetric(value: number | null | undefined, kind: MetricSource['kind'], currency = 'USD'): string {
  return kind === 'revenue' ? formatCurrency(value, currency) : kind === 'binomial' ? formatPercent(value) : formatNumber(value)
}

export function formatProbability(value: number | null | undefined): string {
  return finite(value) ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(value) : missing
}

export function formatCI(ci: readonly [number | null, number | null] | undefined): string {
  if (!ci || ci.some(bound => bound !== null && !finite(bound))) return missing
  const [low, high] = ci
  if (low === null && high === null) return missing
  if (high === null) return atLeast(formatPercent(low, true))
  if (low === null) return atMost(formatPercent(high, true))
  return intervalCopy(formatPercent(low, true), formatPercent(high, true))
}
