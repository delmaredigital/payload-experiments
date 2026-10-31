export function expectedConfirm(action: 'decide' | 'discard' | 'hard-coded', winnerLabel: string): string {
  if (action === 'decide') return winnerLabel
  if (action === 'discard') return 'discard winner'
  return `the developer has hard-coded ${winnerLabel}`
}
export function matchesConfirm(expected: string, typed: string | undefined | null): boolean {
  return typed != null && typed.trim() === expected.trim()
}
