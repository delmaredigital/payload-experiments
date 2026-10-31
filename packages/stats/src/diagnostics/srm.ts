import { chi2Sf } from '../internal/gamma.js'

/**
 * Source: gbstats/utils.py check_srm @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Port-exactly: nonpositive weights are skipped in the sum but still counted
 * in the degrees of freedom. Callers must omit arms, never zero them.
 */
export function checkSrm(users: readonly number[], weights: readonly number[]): number {
  const total = users.reduce((sum, n) => sum + n, 0)
  if (total === 0) return 1
  const totalWeight = weights.reduce((sum, n) => sum + n, 0)
  let x = 0
  for (let i = 0; i < users.length; i++) {
    if (weights[i]! <= 0) continue
    const expected = weights[i]! / totalWeight * total
    x += (users[i]! - expected) ** 2 / expected
  }
  return chi2Sf(x, users.length - 1)
}
