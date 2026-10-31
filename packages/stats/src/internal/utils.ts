import { normalPpf } from './normal.js'

/**
 * Source: gbstats/utils.py frequentist_diff @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function frequentistDiff(meanA: number, meanB: number, relative: boolean, meanAUnadjusted?: number): number {
  // Preserve Python's falsy fallback, including an explicit unadjusted mean of 0.
  if (!meanAUnadjusted) meanAUnadjusted = meanA
  return relative ? (meanB - meanA) / Math.abs(meanAUnadjusted) : meanB - meanA
}

/**
 * Source: gbstats/utils.py frequentist_variance @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function frequentistVariance(varA: number, meanA: number, nA: number, varB: number, meanB: number, nB: number, relative: boolean): number {
  return relative ? varianceOfRatios(meanB, varB / nB, meanA, varA / nA, 0) : varB / nB + varA / nA
}

/**
 * Source: gbstats/utils.py variance_of_ratios @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function varianceOfRatios(meanM: number, varM: number, meanD: number, varD: number, covMD: number): number {
  if (meanD === 0) return 0
  return varM / meanD ** 2 + varD * meanM ** 2 / meanD ** 4 - 2 * covMD * meanM / meanD ** 3
}

/**
 * Source: gbstats/utils.py gaussian_credible_interval @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function gaussianCredibleInterval(meanDiff: number, stdDiff: number, alpha: number): [number, number] {
  // scipy norm.ppf applies scale before location: ppf(q) * scale + loc.
  return [normalPpf(alpha / 2) * stdDiff + meanDiff, normalPpf(1 - alpha / 2) * stdDiff + meanDiff]
}
