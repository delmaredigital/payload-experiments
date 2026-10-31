export function expectedConfirm(action: 'decide' | 'discard' | 'hard-coded', winnerLabel: string): string {
  if (action === 'decide') return winnerLabel
  if (action === 'discard') return 'discard winner'
  return `the developer has hard-coded ${winnerLabel}`
}
export function matchesConfirm(expected: string, typed: string | undefined | null): boolean {
  const phrase = expected.trim()
  return phrase !== '' && typed != null && typed.trim() === phrase
}
import type { Arm } from '../types/contracts.js'

/** Confirmation uses the stored editor label, with fixed vocabulary as fallback. */
export function storedWinnerLabel(arm: Arm): string {
  return arm.label?.trim() || ({ control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C', holdout: 'Holdout' }[arm.key])
}
